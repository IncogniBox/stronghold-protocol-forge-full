// public/js/ui/cloudPrefs.js — 云配置同步的**唯一开口**（DESIGN §28.58）。
//
// 这一格补的是设计稿里那条边界的缺口：「面板拿不到 store」（§28.8）在**对局状态**上是正确的，但**偏好**不在其中。
// 一个真实账号系统要在登录之后把云端的那一份偏好落到这台机器上，而面板够不到 `sp.pref.*` —— 它连 localStorage
// 都没有（§28.8 的注入面里没有它）。所以这里给一个**闭白名单**的读写口：只碰引擎自己已经落盘的那七个键，
// **对局状态（`match` / `room` / `me`）一个字都不许动** —— 那是这一层从头到尾在避免的事（store 不在这里露面，
// 连 import 都没有：读写走的是 `store.js` 那两条**既有的**偏好函数 `loadPref` / `savePref`）。
//
// 三条纪律，每一条都有对应的拒绝码（见下面的常量）：
//   * **闭白名单**：只有 `CLOUD_PREF_KEYS` 里那七个键。别的名字一律**点名**拒绝**整次**调用，不静默丢弃 ——
//     一个被悄悄丢掉的键会让作者以为写入成功（§28.31 的 `CLIENT_VOICE_*` 同一条理由）。
//   * **危险键递归拒绝**：`__proto__` / `constructor` / `prototype` 在任何一层都不许出现（`JSON.parse` 出来的
//     `{"__proto__": …}` 是一个**自有**键，只查顶层 `Object.keys` 是看不全的）。
//   * **值有界**：必须 JSON 可序列化（函数 / `undefined` / `Symbol` / `BigInt` / 非有限数 / 类实例一律拒 ——
//     `JSON.stringify` 会把其中几种**静默丢掉**，静默丢掉正是这一层到处在拒绝的形态）、不超过
//     `CLOUD_PATCH_MAX_BYTES`、嵌套不超过 `CLOUD_PATCH_MAX_DEPTH`。
//
// **不在模块顶层碰任何环境**：`loadPref` / `savePref`（`store.js`，可选链 + try/catch）只在**调用时**读，
// `location.reload` 只在**真的写了**之后才碰（默认那个 `deps.reload` 才读 `globalThis.location`）。这个文件因此
// 能在 Node 下整套跑（`test/modClientCloud.test.mjs`），测试注入一个假的 `reload` 就能数「安排了几次」。
//
// 与 `extensions.js` 的分工：这个模块**不认识面板、也不认识注册点**（它没有 `refuse` 的上下文），所以**拒绝码由
// 调用方点名** —— `applyCloudPrefs(patch, { refuse })` 把 `refuse(code, detail)` 当依赖注入，`read` 则根本不需要
// （读失败就是那一格 `null`，不抛、不编造）。

import { loadPref, savePref } from '../store.js';

/**
 * 这一格认的**全部**键，也就是引擎自己已经落盘的那七个偏好（顺序即快照的键序，固定不变 ⇒ 字节确定）：
 *
 * | 键 | 谁在写它 |
 * |---|---|
 * | `settings` | `public/js/ui/settings.js:71`（`settingsStore.subscribe` → `savePref('settings', …)`） |
 * | `loadout` | `public/js/ui/loadoutModel.js:23`（`LOADOUT_PREF`，`ui/loadoutSync.js` 落盘） |
 * | `ownership` | `public/js/ui/ownershipModel.js:19`（`OWNERSHIP_PREF`） |
 * | `diy` | `public/js/ui/diyModel.js:22`（`DIY_PREF`） |
 * | `conflict` | `public/js/ui/conflictModel.js:18`（`CONFLICT_PREF`） |
 * | `appearance` | `public/js/main.js:111`（`OWN_APPEARANCE_PREF`，`setOwnAppearanceStore` 的 load/save） |
 * | `lang` | `public/js/ui/lang.js:31`（`PREF_KEY`） |
 *
 * 刻意**不是**「所有 `sp.pref.` 键」：`sp.pref.panel.<包>/<键>`（面板自己的偏好，§28.8）与
 * `sp.pref.stats` / `sp.pref.hub.backdrop` / `sp.pref.recentRooms` 这些都不在这里 —— 这一格的名字叫「引擎自己
 * 已经落盘的那几个偏好」，加一个键要同时改这张表、它的读取点、一条测试与一节文档（与 §28.43 加一格的纪律同形）。
 */
export const CLOUD_PREF_KEYS = Object.freeze([
  'settings', 'loadout', 'ownership', 'diy', 'conflict', 'appearance', 'lang',
]);

/** 一个键的值序列化之后的**字节**上限（不是字符数：`JSON.stringify` 的 UTF-16 长度会低估）。 */
export const CLOUD_PATCH_MAX_BYTES = 128 * 1024;

/** 嵌套深度上限（标量是第 1 层）：超过它就拒，**不**做「再深也能过」的例外。 */
export const CLOUD_PATCH_MAX_DEPTH = 8;

/** 递归拒绝的危险键（原型污染 / 影子继承成员）。 */
export const CLOUD_BAD_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

/** 未知类别（不在 `CLOUD_PREF_KEYS` 里）—— 点名 + 整次拒绝。 */
export const CLIENT_CLOUD_UNKNOWN_CATEGORY = 'CLIENT_CLOUD_UNKNOWN_CATEGORY';
/** `__proto__` / `constructor` / `prototype`（任何一层）。 */
export const CLIENT_CLOUD_BAD_KEY = 'CLIENT_CLOUD_BAD_KEY';
/** 值不可 JSON 序列化 / 超 `CLOUD_PATCH_MAX_BYTES` / 嵌套超 `CLOUD_PATCH_MAX_DEPTH` / patch 本身不是普通对象。 */
export const CLIENT_CLOUD_BAD_VALUE = 'CLIENT_CLOUD_BAD_VALUE';

/**
 * 普通对象（且**只有**普通对象）：原型必须是 `Object.prototype` 或 `null`。
 *
 * 比 `extensions.js` 那一份严一档，理由是这一格的语义是「写下去的就是 JSON」：类实例 / `Date` / `Map` / 盒子值
 * 过 `JSON.stringify` 时**原型与行为被静默丢掉**（`Date` 变成字符串、`Map` 变成 `{}`）—— 那正是「写下去的和
 * 面板以为的不一样」，所以在这里当成坏值点名，而不是让它悄悄过去。
 */
const isPlainObj = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** UTF-8 字节数（`TextEncoder` 在 Node 与浏览器里都有；没有就退到字符数，**不抛**）。 */
function utf8Bytes(text) {
  try { return new TextEncoder().encode(text).length; } catch { return text.length; }
}

/**
 * 一个值 JSON 安全的判据（**递归**）。返回 `null` = 可以写，否则返回一句人话说明为什么不行。
 *
 * 为什么不是「`JSON.stringify` 没抛就算过」：那会把函数 / `undefined` / `Symbol` / 类实例**静默丢掉**，
 * 把非有限数变成 `null` —— 四种都是「写下去的与面板以为的不一样」，而这一层到处在拒绝这种形态。
 * 循环引用由**深度上限**兜住（每绕一圈深一层，绕到 `CLOUD_PATCH_MAX_DEPTH` 就拒），所以这里不会死循环。
 * @param {any} value @param {number} depth
 * @returns {string|null}
 */
function jsonValueProblem(value, depth) {
  if (depth > CLOUD_PATCH_MAX_DEPTH) return `nesting deeper than ${CLOUD_PATCH_MAX_DEPTH} levels`;
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return null;
  if (type === 'number') return Number.isFinite(value) ? null : 'a non-finite number (JSON.stringify would silently turn it into null)';
  if (type !== 'object') return `a ${type} (JSON has no such value, and JSON.stringify would silently drop it)`;
  if (Array.isArray(value)) {
    for (const item of value) {
      const bad = jsonValueProblem(item, depth + 1);
      if (bad) return bad;
    }
    return null;
  }
  if (!isPlainObj(value)) return 'a non-plain object (a class instance or a boxed value)';
  for (const v of Object.values(value)) {
    const bad = jsonValueProblem(v, depth + 1);
    if (bad) return bad;
  }
  return null;
}

/**
 * 危险键的**递归**扫描（自有键，含不可枚举的那些 —— `{"__proto__": …}` 正是靠这一点才看得见）。
 *
 * 深度与值判据**逐层对齐**（patch 本身算第 0 层、它的值算第 1 层，与 `jsonValueProblem` 同一个口径）：
 * 扫到 `CLOUD_PATCH_MAX_DEPTH` 就停 —— 更深的那一段本来就会被值判据拒（`BAD_VALUE`），而**循环引用**
 * 因此在这里就结束（每绕一圈深一层），不会把栈打穿。
 * @param {any} value @param {number} [depth] @returns {string|null} 命中的键名，或 `null`
 */
function findBadKey(value, depth = 0) {
  if (!value || typeof value !== 'object') return null;
  if (depth > CLOUD_PATCH_MAX_DEPTH) return null;
  for (const name of Object.getOwnPropertyNames(value)) {
    if (CLOUD_BAD_KEYS.includes(name)) return name;
  }
  for (const name of Object.keys(value)) {
    const found = findBadKey(value[name], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 深冻结一份**刚刚解析出来**的对象（无缓存：`loadPref` 每次都是一份新解析，缓存它等于每次读往缓存里塞一个新键）。
 * @template T @param {T} value @returns {T}
 */
function freezeDeep(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
    return Object.freeze(value);
  }
  for (const v of Object.values(value)) freezeDeep(v);
  return Object.freeze(value);
}

/**
 * **一次取全**的冻结快照：每个键 = `loadPref(<键>, null)` 解析后的 JSON，缺档 = `null`。
 *
 * 只读语义与 `ctx.data.get()` 同形：冻结（深一层），面板改它 `TypeError`，下一次读是一份**新的**副本。
 * **读失败不抛**：`loadPref` 自己吞掉 localStorage 的异常（配额 / 隐私模式 / 坏 JSON），这里再兜一次
 * —— 那一格就是 `null`，不是「整格都没了」。
 * @param {{ loadPref?: (key: string, fallback: any) => any }} [deps]
 * @returns {{ settings: any, loadout: any, ownership: any, diy: any, conflict: any, appearance: any, lang: any }}
 */
export function readCloudPrefs(deps = {}) {
  const load = typeof deps.loadPref === 'function' ? deps.loadPref : loadPref;
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of CLOUD_PREF_KEYS) {
    let value = null;
    try {
      const raw = load(key, null);
      if (raw !== undefined) value = raw;
    } catch { /* loadPref already swallows its own failures: this cell stays null */ }
    out[key] = freezeDeep(value);
  }
  return Object.freeze(out);
}

/**
 * 把一份 patch 写进偏好（**整次拒绝**，绝不部分静默）。
 *
 * 判据顺序（写死在这里，所以「同时坏两处时报哪个码」有唯一答案）：patch 不是普通对象 ⇒ `BAD_VALUE`；
 * 任何一层的危险键 ⇒ `BAD_KEY`；不在白名单里的类别 ⇒ `UNKNOWN_CATEGORY`；值不可序列化 / 超限 ⇒ `BAD_VALUE`。
 * 全过之后才**整份**写入（只有 patch 里出现过的键，按 `CLOUD_PREF_KEYS` 的顺序 ⇒ 结果字节确定），
 * 并且**只安排一次**重载：`deps.reload`（缺省是 `globalThis.location?.reload?.()`，`location` 不存在时跳过 ——
 * 顶层一个字节都不碰）。没有任何键被写入（空 patch）⇒ `{ applied: [], reload: false }`，**不重载**。
 *
 * 落盘之后的重载是「**偏好已变、这一页里读的是旧值**」的唯一出口：`settings` / `loadout` / `lang` 那几份内存
 * 副本在各自模块里是**单例**（`settingsStore` / `loadoutStore` / 语言包），不重载就看不见新值。
 * 写失败由 `store.js savePref` 自己吞（可选链 + try/catch，与引擎其余偏好写口同一条口径）—— 这里不能因此抛。
 *
 * @param {any} patch @param {{ savePref?: (key: string, value: any) => any, reload?: () => void,
 *   refuse?: (code: string, detail: string) => void }} [deps]
 * @returns {{ applied: string[], reload: boolean }|false}
 */
export function applyCloudPrefs(patch, deps = {}) {
  const refuse = typeof deps.refuse === 'function' ? deps.refuse : () => {};
  const save = typeof deps.savePref === 'function' ? deps.savePref : savePref;

  if (!isPlainObj(patch)) {
    refuse(CLIENT_CLOUD_BAD_VALUE, `cloud apply(...) — the patch must be a plain object of whitelisted preference categories (got ${patch === null ? 'null' : Array.isArray(patch) ? 'an array' : typeof patch})`);
    return false;
  }
  let badKey = null;
  try { badKey = findBadKey(patch); } catch { /* a scan that could not run is treated as no hit (the value check below still applies) */ }
  if (badKey) {
    refuse(CLIENT_CLOUD_BAD_KEY, `cloud apply(...) — "${badKey}" is never accepted, at the top level and at any depth: it rewires or shadows an object's inherited members instead of carrying a preference value`);
    return false;
  }
  const named = Object.keys(patch);
  const unknown = named.filter((k) => !CLOUD_PREF_KEYS.includes(k));
  if (unknown.length) {
    refuse(CLIENT_CLOUD_UNKNOWN_CATEGORY, `cloud apply(...) — ${unknown.map((k) => `"${k}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the closed whitelist of engine preferences (${CLOUD_PREF_KEYS.join(', ')}); nothing was written`);
    return false;
  }
  // 值有界：先整份判完（**整次拒绝**要求「一个坏键 ⇒ 一个字节都不写」），再落盘。
  for (const key of CLOUD_PREF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];
    let problem = null;
    let bytes = 0;
    try {
      const verdict = jsonValueProblem(value, 1);
      if (verdict) problem = verdict; else bytes = utf8Bytes(JSON.stringify(value) ?? '');
    } catch (err) {
      problem = `a value that could not be inspected (${err && err.message ? err.message : String(err)})`;
    }
    if (!problem && bytes > CLOUD_PATCH_MAX_BYTES) {
      problem = `${bytes} bytes, over the ${CLOUD_PATCH_MAX_BYTES}-byte limit`;
    }
    if (problem) {
      refuse(CLIENT_CLOUD_BAD_VALUE, `cloud apply({ ${key}: … }) — ${problem}; nothing was written (every category in a patch is validated before any of them is stored)`);
      return false;
    }
  }
  /** @type {string[]} */
  const applied = [];
  for (const key of CLOUD_PREF_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    try { save(key, patch[key]); } catch { /* savePref never throws; a broken injection must not take the panel down */ }
    applied.push(key);
  }
  if (!applied.length) return { applied: [], reload: false };
  const reload = typeof deps.reload === 'function' ? deps.reload : () => globalThis.location?.reload?.();
  try { reload(); } catch { /* a refused reload is not a refused write: the bytes are already stored */ }
  return { applied, reload: true };
}
