// accounts.mjs —— 「服务器功能扩展」包的**账号服务**（`server.modules`，DESIGN §28.14 / §28.56）。
//
// ## 它是什么
// 参考文档 `registration.md` 那套「注册 / 登录 / 服务端分配四位编号 / 头像待审 / 名称审核 / 云配置」的**等价子集**，
// 与它的架构关系也是一样的：参考那套是**中央账号服务**（香港 2 :3053），**不驱动游戏握手** —— 它靠游戏核心签发的
// 票据把 playerId 绑到账号上。本包站在同一层：它是**旁路服务**，自己带一条 WebSocket lane
// （`/mod-ws/server-ext/accounts`），与 `/ws`（游戏本体协议）井水不犯河水。
//
// ## 为什么不是 `host.route`
// `host.route(path, fn)` 的处理器**收不到任何参数**（`server/http/routeMount.js` 的 `runDynamicRoute` 调用
// `handler()`），所以带参数的读（`?ids=`）根本写不出来；而且它**只有 GET/HEAD**、**没有鉴权** —— `docs/MOD-SURFACE.md`
// 明写「不要把凭据塞进 URL、靠路径保密」。于是：**所有读写都走本条 lane**，一条通道，一套 JSON 信封。
//
// ## 与引擎自带那层账号（`server/accounts.js`）的关系
// **不共用**。引擎那层在 `SP_ACCOUNTS=1` 时接管 `hello` 的认证、给跨会话稳定的 `playerId`；本包这套是**旁路**，
// 不碰握手、不碰 `playerId`（详见包内 README「边界」一节：没有引擎签发票据这一格，绑定 playerId 做不到，
// 所以「别人的头像/编号」与「战绩归属」不在本包能力范围内）。
//
// ## 落盘
// `host.io`（`write: true` 才拿到），被限定在 `<状态目录>/mod/server-ext/`：
//   * `accounts.json` —— 账号（salt/hash、四位编号、QQ、头像、审核标记）、会话（只存 token 的 SHA256）、
//     审核词表与人工裁决、云配置分区。**永不明文口令**、**永不回显**。
//   * `admin.json` —— 管理口令，**首次启动随机生成并写进启动日志**（本包没有别的管理鉴权来源，见下）。
//
// ## 口令
// 与引擎那层同一个取舍：每账号 16 字节随机盐 + scrypt 派生 32 字节，`N=2^15, r=8, p=1, maxmem=64MiB`，
// 比对一律 `timingSafeEqual`；登录失败**不区分**「账号不存在」与「口令不对」（都是 `BAD_CREDENTIALS`），
// 注册才分开（`NAME_TAKEN` / `WEAK_PASSWORD`）。
//
// ## 静态扫描
// `server/modModules.js` 在 `import()` 之前扫 `SERVER_CODE_FORBIDDEN_GLOBALS`（`process` / `globalThis` /
// `require` / `eval` / `new Function`）。所以本文件**不读环境变量**（要宿主给的 `host.metrics` 才有进程读数），
// 时间用 `Date.now`（不在该名单里，且本层没有确定性要求 —— 那条线是 `server.battle` / `server.meta` 的事）。

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { WsServer, acceptUpgrade } from './wsMini.mjs';

const scrypt = promisify(scryptCallback);

/** 本包的 lane 路径（形状判据在 `server/http/wsLanes.js`；命名空间 `/mod-ws/<包id>` 是强制的）。 */
export const LANE_PATH = '/mod-ws/server-ext/accounts';

/** scrypt 参数（与引擎自带那层同一条取舍，见 `server/accounts.js` 的注释）。 */
const SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const KEY_LEN = 32;
const SALT_LEN = 16;

/** 落盘文件名与库格式版本。 */
const DB_FILE = 'accounts.json';
const ADMIN_FILE = 'admin.json';
const DB_VERSION = 1;

/** 边界（参考文档 §1/§4 的口径）。 */
export const LIMITS = Object.freeze({
  nicknameMax: 12,
  qqMin: 5,
  qqMax: 12,
  passwordMin: 6,
  passwordMax: 64,
  avatarMax: 48 * 1024,        // data URL 字符串长度上限（客户端先裁成 PNG）
  sessionsPerAccount: 10,
  /** 身份绑定的有效期（参考文档 §4：6 小时）与每账号最多几个当前绑定。 */
  bindTtlMs: 6 * 3600 * 1000,
  bindsPerAccount: 6,
  prefsMaxBytes: 128 * 1024,
  prefsMaxDepth: 8,
  frameMax: 262144,
  // 限流（每分钟的额度，按「操作 + 主体」计）
  // 注册限流：**每客户端地址每小时 N 次**。参考文档 §4 写的是 5 —— 那是一个面向公网的多服部署的口径，
  // 而这套是**自建单服**：运营方与玩家常常同一条出口地址（本机测试更是全部落回环），5 次/小时会让
  // 「自己先注册两个号看看」都做不成（本包第一次真机自测就是被它挡下的）。所以这里放宽到 20，并在**报错信息里
  // 写出这个数字**，让玩家/运营方一眼看出是限流而不是「账号出问题了」。桶在内存里，**重启即清零**。
  registerPerIpPerHour: 20,
  loginFailPerIpPer10Min: 10,
  loginFailPerAccountPer10Min: 6,
  namePerHour: 6,
  avatarPerHour: 6,
  prefsPerMinute: 60,
});

/** 昵称里**非法**的字符：C0/C1 控制码、DEL、以及常见零宽/方向控制（参考文档 §1）。 */
const ILLEGAL_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;
/** QQ：5..12 位、首位非 0。 */
const QQ_RE = /^[1-9][0-9]{4,11}$/;

/** `#` 的三种写法：ASCII、全角 `＃`、小号 `﹟`（中文输入法下 `＃` 是默认输出）。 */
const HASHES = ['#', '\uff03', '\ufe5f'];

/**
 * 登录名的**归一**：NFKC（把全角 `＃` / 全角数字都收成半角）+ 去零宽字符 + 收空白。
 *
 * 为什么必须做：界面上的提示写的是「昵称#编号」，而中文输入法按出来的是全角 `＃` —— 认不出它，玩家就只会看到
 * 「登录名或口令不对」，也就是「登录坏了」（本包的真机自测就是这么复现出来的）。
 */
const normalizeLogin = (value) => String(value == null ? '' : value)
  .normalize('NFKC')
  .replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** 默认词表（**保守的起步表**，24 条；运营方在管理后台里改）。命中**只影响注册/改名这一次请求**。 */
export const DEFAULT_RULES = Object.freeze([
  '官方', '客服', '管理员', '管理组', '维护组', '系统公告', '系统消息', '运营',
  'gm', 'admin', 'administrator', 'moderator', 'official', 'support', 'root', 'sysop',
  '卫戍协议官方', '卫戍协议运营', '开发者', '策划', '充值', '代充', '外挂', '脚本狗',
]);

// ---------------------------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------------------------

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isHex = (v, n) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);

/** 账号名的**键**：NFC 归一 + 小写（`Alice` 与 `alice` 互相占用，与引擎那层同一条纪律）。 */
export const nameKey = (name) => String(name).normalize('NFC').toLowerCase();

/** 审核用的规范化：NFKC + 小写 + 去掉空白与常见标点（挡「夹符号」写法）。 */
export const moderationKey = (name) => String(name).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** 昵称：1..12 个 UTF-16 单位、不含 `#`、不含控制/零宽字符。 */
export function validNickname(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= LIMITS.nicknameMax
    && !name.includes('#') && !ILLEGAL_NAME_CHARS.test(name);
}

/** QQ：5..12 位、首位非 0。 */
export const validQq = (qq) => typeof qq === 'string' && QQ_RE.test(qq);

/** 口令：6..64 字符、无控制字符（**不是**强度评分 —— 那会变成一张要维护的规则表）。 */
export const validPassword = (password) => typeof password === 'string'
  && password.length >= LIMITS.passwordMin && password.length <= LIMITS.passwordMax
  && !/[\u0000-\u001f\u007f]/.test(password);

/** 云配置的形状判据：普通对象、无危险键、深度有界、可序列化、有字节上限。 */
export function validPrefsValue(value, { depth = 0, maxDepth = LIMITS.prefsMaxDepth } = {}) {
  if (depth > maxDepth) return 'too deep';
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'not a finite number';
  if (Array.isArray(value)) {
    for (const item of value) { const bad = validPrefsValue(item, { depth: depth + 1, maxDepth }); if (bad) return bad; }
    return null;
  }
  if (!isPlain(value)) return `unsupported type ${typeof value}`;
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return `dangerous key "${k}"`;
    const bad = validPrefsValue(v, { depth: depth + 1, maxDepth });
    if (bad) return bad;
  }
  return null;
}

/**
 * 云配置的**类别闭集**：逐字等于引擎那一格（`public/js/ui/cloudPrefs.js` 的 `CLOUD_PREF_KEYS`）读写的本机偏好键
 * —— `settings`（音量/画质/快捷键…）、`loadout`（干员调配+持有）、`ownership`、`diy`（自选编队）、
 * `conflict`（冲突干员自选）、`appearance`（时装/换装，参考文档 §5 里叫 `skins`）、`lang`。
 *
 * **这不是一份可以自己拟的名单**：客户端把 `ctx.cloud.read()` 的一整份快照原样发上来，所以服务端认识的名字必须与
 * 引擎给出的键**逐一对应**，否则会出现「读得到、存不上」（本包第一次真机自测就是这样：多收/少收一个 `conflict`
 * 就让整个上传被拒）。
 */
export const PREFS_CATEGORIES = Object.freeze(['settings', 'loadout', 'ownership', 'diy', 'conflict', 'appearance', 'lang']);

/** 简单令牌桶（按「操作 + 主体」的键）。返回 `true` = 放行。 */
function allow(buckets, key, perMs, burst, now = Date.now()) {
  let b = buckets.get(key);
  if (!b) { b = { tokens: burst, at: now }; buckets.set(key, b); }
  const gained = (now - b.at) * perMs;
  b.tokens = Math.min(burst, b.tokens + gained);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ---------------------------------------------------------------------------------------------
// 库（`host.io` 上的单个 JSON 文件）
// ---------------------------------------------------------------------------------------------

/** 名片背景的可选 id（与 shared/namecards.js 的目录同一份顺序：nc00…nc33，共 34 个官方主题）。 */
export const NAMECARD_IDS = Object.freeze(Array.from({ length: 34 }, (_, i) => `nc${String(i).padStart(2, '0')}`));

/** 账号库：**纯数据**，不认识 socket，也不认识 WebSocket 信封（那些在下面）。 */
export class AccountDb {
  /** @param {{ read: (rel: string) => string|null, write: (rel: string, data: string) => boolean }} io */
  constructor(io) {
    this.io = io;
    /** @type {{ v: number, nextTag: number, accounts: any[], sessions: Record<string, any>, moderation: any, prefs: Record<string, any> }} */
    this.data = { v: DB_VERSION, nextTag: 1001, accounts: [], sessions: {}, bindings: {}, friends: {}, moderation: { rules: [...DEFAULT_RULES], pending: [], banned: [], allow: [], observations: [] }, prefs: {} };
    /** 键 → 账号（内存索引；`accounts[]` 才是真相）。 */
    this.byKey = new Map();
  }

  /**
   * 装载。**坏库 ⇒ 抛**（fail closed）：绝不「当空的用」—— 那等于静默注销所有人。
   * 文件不存在 ⇒ 建一份空库（第一次启动的正常状态）。
   */
  load() {
    const raw = this.io.read(DB_FILE);
    if (typeof raw === 'string' && raw.trim()) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch (err) { throw new Error(`account database is not readable JSON: ${err && err.message ? err.message : err}`); }
      if (!isPlain(parsed) || parsed.v !== DB_VERSION || !Array.isArray(parsed.accounts)) throw new Error('invalid account database');
      this.data = parsed;
      if (!isPlain(this.data.sessions)) this.data.sessions = {};
      if (!isPlain(this.data.bindings)) this.data.bindings = {};
      if (!isPlain(this.data.friends)) this.data.friends = {};
      if (!isPlain(this.data.prefs)) this.data.prefs = {};
      if (!isPlain(this.data.moderation)) this.data.moderation = { rules: [...DEFAULT_RULES], pending: [], banned: [], allow: [], observations: [] };
      if (!Number.isInteger(this.data.nextTag) || this.data.nextTag < 1001) this.data.nextTag = 1001;
    }
    this.reindex();
    return this;
  }

  /** 重建键索引（装载后与每次改名后调用）。 */
  reindex() {
    this.byKey.clear();
    for (const row of this.data.accounts) this.byKey.set(nameKey(row.name), row);
    return this;
  }

  save() {
    this.io.write(DB_FILE, JSON.stringify(this.data));
  }

  /** 分配一个没用过的四位编号。 */
  allocateTag() {
    const used = new Set(this.data.accounts.map((a) => a.tag));
    let tag = this.data.nextTag;
    for (let i = 0; i < 10000; i++) {
      if (!used.has(tag)) { this.data.nextTag = tag < 9999 ? tag + 1 : 1001; return tag; }
      tag = tag < 9999 ? tag + 1 : 1001;
    }
    return null;
  }

  accountByKey(key) { return this.byKey.get(key) || null; }
  accountById(id) { return this.data.accounts.find((a) => a.id === id) || null; }

  /** 去掉一切内部字段（salt/hash）之后的对外形状。 */
  publicAccount(row) {
    const banned = row.nameBanned === true;
    return {
      id: row.id,
      name: banned ? (row.originalName || '已停用') : row.name,
      tag: row.tag,
      qq: row.qq,
      avatar: row.avatar || null,
      pending: row.pending === true,
      rejected: row.rejected === true,
      uploadBanned: row.uploadBanned === true,
      nameBanned: banned,
      namecard: typeof row.namecard === 'string' && NAMECARD_IDS.includes(row.namecard) ? row.namecard : null,
      ...(banned && row.originalName ? { originalName: row.originalName } : {}),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// 账号服务
// ---------------------------------------------------------------------------------------------

/**
 * 账号服务。**一条 lane、一个 JSON 信封**：
 * ```
 * 请求  { id: <number>, op: '<名字>', ...字段 }        （客户端 → 服务端）
 * 成功  { id, ok: true, ...载荷 }
 * 失败  { id, ok: false, error: { code, message } }
 * ```
 * `id` 由客户端给，服务端原样回；没有 `id` 的请求**不回答**（它是心跳之类的无名消息）。
 */
export class AccountService {
  /**
   * @param {{ host: any, db: AccountDb, adminToken: string, log?: any }} deps
   */
  constructor({ host, db, adminToken, log = null }) {
    this.host = host;
    this.db = db;
    this.adminToken = adminToken;
    this.log = log || host.log;
    /** @type {Set<WsServer>} 活着的连接（停机时一并关）。 */
    this.sockets = new Set();
    /** @type {Map<string, any>} 限流桶（`操作:主体`）。 */
    this.buckets = new Map();
  }

  // ---- 口令 ---------------------------------------------------------------------------------

  async derive(password, salt) {
    return scrypt(password, salt, KEY_LEN, SCRYPT);
  }

  async checkPassword(row, password) {
    if (typeof password !== 'string') return false;
    const derived = await this.derive(password, Buffer.from(row.salt, 'hex'));
    const stored = Buffer.from(row.hash, 'hex');
    return derived.length === stored.length && timingSafeEqual(derived, stored);
  }

  // ---- 审核 ---------------------------------------------------------------------------------

  /** 命中判定：人工 `ban` 优先；人工 `allow` 放行；否则看词表。返回 `null`（干净）或拒绝码。 */
  assessName(name) {
    const key = moderationKey(name);
    const mod = this.db.data.moderation;
    if (mod.banned.some((b) => moderationKey(b.name) === key)) return 'NAME_BANNED';
    if (mod.allow.some((b) => moderationKey(b.name) === key)) return null;
    for (const word of mod.rules) {
      const needle = moderationKey(word);
      if (needle && key.includes(needle)) return 'NAME_BLOCKED_BY_RULE';
    }
    return null;
  }

  // ---- 会话 ---------------------------------------------------------------------------------

  static tokenHash(token) { return createHash('sha256').update(String(token)).digest('hex'); }

  issueSession(row) {
    const token = randomBytes(32).toString('hex');
    const hash = AccountService.tokenHash(token);
    const now = Date.now();
    this.db.data.sessions[hash] = { accountId: row.id, at: now };
    // 每账号最多 N 个会话：先按时间排序，超出的就撤掉（谁撤谁不撤不随对象键序变）。
    const mine = Object.entries(this.db.data.sessions).filter(([, s]) => s.accountId === row.id).sort((a, b) => a[1].at - b[1].at);
    for (const [key] of mine.slice(0, Math.max(0, mine.length - LIMITS.sessionsPerAccount))) delete this.db.data.sessions[key];
    return token;
  }

  /** token → 账号；无效返回 `null`（调用方一律用 `BAD_CREDENTIALS` 回，不区分原因）。 */
  sessionAccount(token) {
    if (typeof token !== 'string' || !token) return null;
    const rec = this.db.data.sessions[AccountService.tokenHash(token)];
    if (!rec) return null;
    const row = this.db.accountById(rec.accountId);
    if (!row) { delete this.db.data.sessions[AccountService.tokenHash(token)]; return null; }
    return row;
  }

  revokeOthers(row, keepToken) {
    const keep = AccountService.tokenHash(keepToken);
    for (const key of Object.keys(this.db.data.sessions)) {
      if (this.db.data.sessions[key].accountId === row.id && key !== keep) delete this.db.data.sessions[key];
    }
  }

  // ---- 操作 ---------------------------------------------------------------------------------

  async register(nickname, qq, password, peer) {
    if (!allow(this.buckets, `register:${peer}`, LIMITS.registerPerIpPerHour / 3600000, LIMITS.registerPerIpPerHour)) {
      return { error: 'RATE_LIMIT', message: `注册过于频繁：这条规则是「每 IP 每小时 ${LIMITS.registerPerIpPerHour} 次」；重启服务器会把计数清零` };
    }
    if (!validNickname(nickname)) return { error: 'BAD_NAME', message: '昵称需 1～12 个字，且不含「#」或控制字符' };
    if (!validQq(qq)) return { error: 'BAD_QQ', message: 'QQ 需为 5～12 位数字且首位不为 0' };
    if (!validPassword(password)) return { error: 'WEAK_PASSWORD', message: `口令需 ${LIMITS.passwordMin}～${LIMITS.passwordMax} 个字符` };
    const blocked = this.assessName(nickname);
    if (blocked) return { error: blocked, message: '这个昵称不可用，请换一个' };
    if (this.db.accountByKey(nameKey(nickname))) return { error: 'NAME_TAKEN', message: '这个昵称已经被占用' };
    if (this.db.data.accounts.some((a) => a.qq === qq)) return { error: 'QQ_TAKEN', message: '这个 QQ 已经注册过账号' };
    const salt = randomBytes(SALT_LEN);
    const hash = await this.derive(password, salt);
    if (this.db.accountByKey(nameKey(nickname))) return { error: 'NAME_TAKEN', message: '这个昵称已经被占用' };
    const tag = this.db.allocateTag();
    if (tag === null) return { error: 'NO_TAG', message: '编号已用尽' };
    const row = {
      id: randomBytes(12).toString('hex'),
      name: nickname,
      tag,
      qq,
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
      avatar: null,
      pending: false,
      rejected: false,
      uploadBanned: false,
      nameBanned: false,
      originalName: null,
      namecard: NAMECARD_IDS[tag % NAMECARD_IDS.length],
      createdAt: Date.now(),
    };
    this.db.data.accounts.push(row);
    this.db.reindex();
    const token = this.issueSession(row);
    this.db.save();
    return { account: this.db.publicAccount(row), token };
  }

  async login(login, password, peer) {
    // `login` 是 QQ、`昵称#编号`，或昵称本身。三种 `#` 写法都认（见 `normalizeLogin`）。
    const raw = String(login == null ? '' : login);
    const text = normalizeLogin(raw);
    // 「最后一个 # 分界」按**原串**找，这样「名字里恰好含全角字符」的人也能对上（名字的键用 NFC，与库一致）。
    const hashAt = Math.max(...HASHES.map((h) => raw.lastIndexOf(h)));
    let row = null;
    if (hashAt >= 0) {
      const rawName = raw.slice(0, hashAt).trim();
      const name = normalizeLogin(rawName);
      const tag = Number(normalizeLogin(raw.slice(hashAt + 1)).replace(/\D/g, ''));
      // 名字先按归一后的样子找，找不到再按原串找（NFKC 与 NFC 在极少数兼容字符上不等价）。
      const byName = this.db.accountByKey(nameKey(name)) || this.db.accountByKey(nameKey(rawName));
      if (byName && byName.tag === tag) row = byName;
    } else if (QQ_RE.test(text)) {
      row = this.db.data.accounts.find((a) => a.qq === text) || null;
    } else {
      row = this.db.accountByKey(nameKey(text)) || this.db.accountByKey(nameKey(raw.trim())) || null;
    }
    const ok = row ? await this.checkPassword(row, password) : false;
    if (!ok) {
      // 失败限流：IP 与账号各一只桶（账号不存在时只算 IP 那一只）。
      const ipOk = allow(this.buckets, `loginfail-ip:${peer}`, LIMITS.loginFailPerIpPer10Min / 600000, LIMITS.loginFailPerIpPer10Min);
      const acctOk = !row || allow(this.buckets, `loginfail-account:${row.id}`, LIMITS.loginFailPerAccountPer10Min / 600000, LIMITS.loginFailPerAccountPer10Min);
      if (!ipOk || !acctOk) {
        return { error: 'RATE_LIMIT', message: '失败次数过多：本账号 10 分钟内最多 6 次失败，请过几分钟再试（重新登录不受影响：口令对了立刻放行）' };
      }
      // **不区分**「账号不存在」与「口令不对」：区分就是账号枚举。但把**可用的登录名形状**说清楚 ——
      // 「登录坏了」这类反馈里，绝大多数其实是名字打错（改名之后还用旧名、或者 `#` 打成了全角）。
      return { error: 'BAD_CREDENTIALS', message: '登录名或口令不对。登录名可以填：QQ、昵称#编号，或昵称本身' };
    }
    const token = this.issueSession(row);
    this.db.save();
    return { account: this.db.publicAccount(row), token };
  }

  rename(row, name) {
    if (!validNickname(name)) return { error: 'BAD_NAME', message: '昵称需 1～12 个字，且不含「#」或控制字符' };
    if (!allow(this.buckets, `name:${row.id}`, LIMITS.namePerHour / 3600000, LIMITS.namePerHour)) {
      return { error: 'RATE_LIMIT', message: '改名过于频繁，请稍后再试' };
    }
    const blocked = this.assessName(name);
    if (blocked) return { error: blocked, message: '这个昵称不可用，请换一个' };
    const taken = this.db.accountByKey(nameKey(name));
    if (taken && taken.id !== row.id) return { error: 'NAME_TAKEN', message: '这个昵称已经被占用' };
    this.db.byKey.delete(nameKey(row.name));
    if (row.nameBanned) { row.originalName = row.originalName || row.name; row.nameBanned = false; }
    row.name = name;
    this.db.reindex();
    this.db.save();
    return { account: this.db.publicAccount(row) };
  }

  async changePassword(row, current, next, keepToken) {
    if (!(await this.checkPassword(row, current))) return { error: 'BAD_CREDENTIALS', message: '当前口令不对' };
    if (!validPassword(next)) return { error: 'WEAK_PASSWORD', message: `口令需 ${LIMITS.passwordMin}～${LIMITS.passwordMax} 个字符` };
    const salt = randomBytes(SALT_LEN);
    row.salt = salt.toString('hex');
    row.hash = (await this.derive(next, salt)).toString('hex');
    this.revokeOthers(row, keepToken);   // 改密撤销其他设备的会话
    this.db.save();
    return { ok: {} };
  }

  /** 头像：只收 PNG/JPEG/WebP 的 data URL，写进「待审核」；审核前对别人不公开。 */
  setAvatar(row, data) {
    if (!allow(this.buckets, `avatar:${row.id}`, LIMITS.avatarPerHour / 3600000, LIMITS.avatarPerHour)) {
      return { error: 'RATE_LIMIT', message: '上传过于频繁，请稍后再试' };
    }
    if (row.uploadBanned === true) return { error: 'UPLOAD_BANNED', message: '本账号已被禁止上传头像' };
    if (typeof data !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) {
      return { error: 'BAD_AVATAR', message: '头像需为 PNG / JPEG / WebP 图片' };
    }
    if (data.length > LIMITS.avatarMax) return { error: 'AVATAR_TOO_BIG', message: '头像过大（建议 256×256 以内）' };
    row.avatar = data;
    row.pending = true;
    row.rejected = false;
    row.avatarAt = Date.now();      // 管理台按它排序/显示「等了多久」
    this.db.save();
    return { account: this.db.publicAccount(row) };
  }

  // ---- 头像审核（管理后台） -------------------------------------------------------------------

  /**
   * 头像名单。**带上图** —— 管理台要看的就是那张图（`lookup` 那边对别人是不给的，这一条只在管理口令之后）。
   * @param {'pending'|'rejected'|'banned'|'all'} [status]
   */
  adminAvatars(status = 'pending') {
    const now = Date.now();
    const rows = this.db.data.accounts
      .filter((row) => {
        if (status === 'pending') return row.pending === true;
        if (status === 'rejected') return row.rejected === true;
        if (status === 'banned') return row.uploadBanned === true;
        return !!(row.avatar || row.pending || row.rejected || row.uploadBanned);
      })
      .map((row) => ({
        accountId: row.id,
        name: row.name,
        tag: row.tag,
        avatar: row.avatar || null,
        pending: row.pending === true,
        rejected: row.rejected === true,
        uploadBanned: row.uploadBanned === true,
        at: Number.isFinite(row.avatarAt) ? row.avatarAt : 0,
        ageMs: Number.isFinite(row.avatarAt) ? Math.max(0, now - row.avatarAt) : 0,
      }))
      .sort((a, b) => b.at - a.at);
    return { rows, status };
  }

  /**
   * 人工裁决一张头像。四种动作（与参考文档的「待审核 → 通过 / 驳回」同义，另加「禁止这个账号再上传」）：
   *   * `approve` —— 待审撤销，图片**对所有人公开**（`lookup` 与名单随之可见）；
   *   * `reject`  —— 保留图片、但**不**公开：本人那一侧会看到「头像被驳回，请重新上传」，别人看不到；
   *   * `ban`     —— 这个账号**不许再上传**（`uploadBanned`，本人那一侧的上传按钮会禁用）；
   *   * `unban`   —— 解除上面的禁止。
   * 裁决只动这一张与这些标记，**不动**账号、口令、编号与云配置。
   */
  adminAvatarReview(token, accountId, action, note) {
    if (!this.adminGuard(token)) return { error: 'ADMIN_DENIED', message: '管理口令不对' };
    const row = this.db.accountById(typeof accountId === 'string' ? accountId : '');
    if (!row) return { error: 'ADMIN_BAD_INPUT', message: '没有这个账号' };
    if (!['approve', 'reject', 'ban', 'unban'].includes(action)) {
      return { error: 'ADMIN_BAD_INPUT', message: '动作只支持 approve / reject / ban / unban' };
    }
    if (action === 'approve') { row.pending = false; row.rejected = false; }
    if (action === 'reject') { row.pending = false; row.rejected = true; }
    if (action === 'ban') { row.uploadBanned = true; row.pending = false; }
    if (action === 'unban') { row.uploadBanned = false; }
    row.avatarNote = String(note || '');
    row.avatarReviewedAt = Date.now();
    this.db.save();
    return { rows: this.adminAvatars('pending').rows, reviewed: { accountId: row.id, action } };
  }

  // ---- 身份绑定（参考文档 §3 的 `/accounts/bind`） ---------------------------------------------

  /**
   * 用**引擎签发的票据**把当前 game 的 `playerId` 绑到这个账号上。
   *
   * 为什么非得是票据：客户端自报 `playerId` 永远不可信（谁都能填别人的号）。票据由**引擎**签发（本仓
   * `server/bindTickets.js`，挂在 `welcome.bindTicket` 上、120 秒、一票一用），验证由引擎交给包的 `host.tickets`
   * ——包**拿不到密钥**，所以它只能验、不能签（「同一份包字节 ⇒ 同一份行为」那条不变量因此成立）。
   * 包也**不需要**自己保存密钥，所以这里只调 `verify`。
   * @param {any} row 已认证的账号
   * @param {unknown} ticket `welcome.bindTicket` 里那一串（客户端原样转发，不经它自己加工）
   */
  bind(row, ticket) {
    const tickets = this.host && this.host.tickets;
    if (!tickets || typeof tickets.verify !== 'function') {
      return { error: 'TICKETS_UNAVAILABLE', message: '这台服务器没有装票据验证面（server.modules 的 uses 里缺 "tickets"）' };
    }
    let verdict;
    try { verdict = tickets.verify(ticket, { consume: true }); }
    catch (err) { return { error: 'BAD_TICKET', message: `票据验证抛错：${err && err.message ? err.message : err}` }; }
    if (!verdict || verdict.ok !== true || typeof verdict.playerId !== 'string' || !verdict.playerId) {
      return { error: 'BAD_TICKET', message: `票据无效或已过期${verdict && verdict.reason ? `（${verdict.reason}）` : ''}` };
    }
    const now = Date.now();
    // 每账号最多 N 个当前绑定：超了就按时间淘汰最旧的那一条（谁被淘汰不随对象键序变）。
    const mine = Object.entries(this.db.data.bindings).filter(([, b]) => b.accountId === row.id).sort((a, b) => a[1].at - b[1].at);
    const drop = Math.max(0, mine.length - LIMITS.bindsPerAccount + 1);
    for (const [pid] of mine.slice(0, drop)) delete this.db.data.bindings[pid];
    this.db.data.bindings[verdict.playerId] = { accountId: row.id, at: now, exp: now + LIMITS.bindTtlMs };
    this.db.save();
    return { playerId: verdict.playerId, expiresAt: now + LIMITS.bindTtlMs, bound: true };
  }

  /**
   * 绑定的**展示面**（参考文档 §3 的 `/accounts/lookup?ids=`）：`ids` 是 **game 的 playerId**，不是账号 id ——
   * 「知道座位号就能查到那个座位是谁」正是绑定存在的意义（也正是这里**必须**限流的原因）。游客也能读
   * （参考文档同一条），所以它不要求登录会话；头像同样遵守「待审不对别人公开」。
   * @param {unknown} ids
   */
  lookupPlayer(ids) {
    const now = Date.now();
    const out = [];
    for (const playerId of ids) {
      const binding = this.db.data.bindings[playerId];
      if (!binding) continue;
      if (!(binding.exp > now)) { delete this.db.data.bindings[playerId]; continue; }   // 顺手清过期的那一条
      const row = this.db.accountById(binding.accountId);
      if (!row) continue;
      const view = this.db.publicAccount(row);
      out.push({
        playerId, accountId: row.id, name: view.name, tag: view.tag,
        avatar: view.pending || view.rejected ? null : (row.avatar || null),
        namecard: view.namecard,
      });
    }
    return { players: out };
  }

  prefsGet(row) {
    const prefs = this.db.data.prefs[row.id];
    return { prefs: isPlain(prefs) ? prefs : {} };
  }

  prefsPut(row, patch) {
    if (!allow(this.buckets, `prefs:${row.id}`, LIMITS.prefsPerMinute / 60000, LIMITS.prefsPerMinute)) {
      return { error: 'RATE_LIMIT', message: '同步过于频繁，请稍后再试' };
    }
    if (!isPlain(patch)) return { error: 'BAD_PREFS', message: '配置补丁需为一个对象' };
    const clean = {};
    for (const [category, value] of Object.entries(patch)) {
      if (!PREFS_CATEGORIES.includes(category)) return { error: 'BAD_PREFS_CATEGORY', message: `未知的配置类别「${category}」` };
      const bad = validPrefsValue(value);
      if (bad) return { error: 'BAD_PREFS_VALUE', message: `配置「${category}」不合法：${bad}` };
      clean[category] = value;
    }
    const current = isPlain(this.db.data.prefs[row.id]) ? this.db.data.prefs[row.id] : {};
    // **只合并请求里出现的类别**：保存 settings 时不许覆盖 loadout / skins（参考文档 §5）。
    const next = { ...current, ...clean };
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > LIMITS.prefsMaxBytes) {
      return { error: 'PREFS_TOO_BIG', message: '云配置超过上限（128 KiB）' };
    }
    this.db.data.prefs[row.id] = next;
    this.db.save();
    return { prefs: next };
  }

  // ---- 名片 / 好友 / 成就（engine UI 的三个模块读它们） ---------------------------------------

  /** 自己的公开资料（`ui/accounts.js` 的 `me()`）。 */
  profileOf(row) { return { profile: this.db.publicAccount(row) }; }

  /** 名片背景：只接受 `NAMECARD_IDS`（客户端配色表同一份字面量）。 */
  setNamecard(row, namecard) {
    const id = typeof namecard === 'string' ? namecard : '';
    if (!NAMECARD_IDS.includes(id)) return { error: 'BAD_NAMECARD', message: '未知的名片背景' };
    row.namecard = id;
    this.db.save();
    return { profile: this.db.publicAccount(row) };
  }

  friendIds(row) {
    const list = this.db.data.friends[row.id];
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  }

  /** 在线 = 这个账号还有一个活着的登录会话（`sessions` 由 `issueSession` / `logout` 维护）。 */
  onlineAccountIds() {
    const online = new Set();
    for (const s of Object.values(this.db.data.sessions)) if (s && typeof s.accountId === 'string') online.add(s.accountId);
    return online;
  }

  /** 好友列表（含在线状态）。 */
  friendView(row) {
    const online = this.onlineAccountIds();
    const friends = this.friendIds(row).map((id) => this.db.accountById(id)).filter(Boolean).map((a) => {
      const view = this.db.publicAccount(a);
      return { id: view.id, name: view.name, tag: view.tag, avatar: view.avatar, namecard: view.namecard, online: online.has(view.id) };
    });
    return { friends };
  }

  /** 加好友：`login` 可以是昵称、`昵称#编号`，或 QQ。双向写入 —— 私有服不需要「申请/同意」两步。 */
  friendAdd(row, login) {
    if (typeof login !== 'string' || !login.trim()) return { error: 'BAD_LOGIN', message: '请填写好友的昵称或 昵称#编号' };
    const text = login.trim();
    const hashAt = text.lastIndexOf('#');
    const name = hashAt >= 0 ? text.slice(0, hashAt).trim() : text;
    const tag = hashAt >= 0 ? Number(text.slice(hashAt + 1).replace(/\D/g, '')) : null;
    let target = this.db.accountByKey(nameKey(name));
    if (!target && QQ_RE.test(text)) target = this.db.data.accounts.find((a) => a.qq === text) || null;
    if (!target || (tag !== null && Number.isFinite(tag) && target.tag !== tag)) return { error: 'NOT_FOUND', message: '没有这个账号' };
    if (target.id === row.id) return { error: 'SELF', message: '不能加自己' };
    const add = (a, b) => {
      const list = Array.isArray(this.db.data.friends[a]) ? this.db.data.friends[a] : (this.db.data.friends[a] = []);
      if (!list.includes(b)) list.push(b);
    };
    add(row.id, target.id);
    add(target.id, row.id);
    this.db.save();
    return this.friendView(row);
  }

  friendRemove(row, id) {
    const drop = (a, b) => {
      const list = this.db.data.friends[a];
      if (!Array.isArray(list)) return;
      this.db.data.friends[a] = list.filter((x) => x !== b);
    };
    if (typeof id === 'string' && id) { drop(row.id, id); drop(id, row.id); this.db.save(); }
    return this.friendView(row);
  }

  /**
   * 账号侧成就：全部由这台服务器**已有的账号数据**推出来（注册、头像过审、名片、好友、绑定、账号年龄）。
   * 不伪造对局战绩 —— 没有战绩来源就不列「通关」这类条目。
   */
  achievementsOf(row) {
    const friends = this.friendIds(row).length;
    const binds = Object.values(this.db.data.bindings).filter((b) => b && b.accountId === row.id).length;
    const ageDays = Math.max(0, Math.floor((Date.now() - (Number(row.createdAt) || Date.now())) / 86400000));
    const approved = !!row.avatar && row.pending !== true && row.rejected !== true;
    return {
      achievements: [
        { id: 'account', progress: 1, total: 1 },
        { id: 'avatar', progress: approved ? 1 : 0, total: 1 },
        { id: 'namecard', progress: row.namecard ? 1 : 0, total: 1 },
        { id: 'bind', progress: binds > 0 ? 1 : 0, total: 1 },
        { id: 'friends', progress: Math.min(3, friends), total: 3 },
        { id: 'veteran', progress: Math.min(30, ageDays), total: 30 },
      ],
    };
  }

  // ---- 管理 ---------------------------------------------------------------------------------

  adminGuard(token) {
    return typeof token === 'string' && token.length > 0 && token === this.adminToken;
  }

  adminView(status = 'pending', q = '') {
    const mod = this.db.data.moderation;
    const needle = moderationKey(q);
    const pick = (list) => list
      .filter((item) => !needle || moderationKey(item.name).includes(needle))
      .map((item) => ({ name: item.name, note: item.note || '', at: item.at || 0 }));
    if (status === 'banned') return { rows: pick(mod.banned) };
    if (status === 'allow') return { rows: pick(mod.allow) };
    if (status === 'accounts') {
      return { rows: this.db.data.accounts.filter((a) => !needle || moderationKey(a.name).includes(needle))
        .map((a) => ({ name: a.name, tag: a.tag, qq: a.qq, pending: a.pending === true, nameBanned: a.nameBanned === true })) };
    }
    // `pending` 与 `all`：按当前词表重新判一遍（只标记，不动账号名）。
    const hit = [];
    for (const row of this.db.data.accounts) {
      if (needle && !moderationKey(row.name).includes(needle)) continue;
      const assessed = this.assessName(row.name);
      if (status === 'all' || assessed) hit.push({ name: row.name, tag: row.tag, source: assessed || 'ok' });
    }
    return { rows: hit, rules: [...mod.rules] };
  }

  adminReview(token, name, action, note) {
    if (!this.adminGuard(token)) return { error: 'ADMIN_DENIED', message: '管理口令不对' };
    if (typeof name !== 'string' || !name.trim()) return { error: 'ADMIN_BAD_INPUT', message: '要处理的名字不能为空' };
    if (!['allow', 'ban', 'unban'].includes(action)) return { error: 'ADMIN_BAD_INPUT', message: '动作只支持 allow / ban / unban' };
    const mod = this.db.data.moderation;
    const keep = (list, target) => list.filter((item) => moderationKey(item.name) !== moderationKey(target));
    mod.allow = keep(mod.allow, name);
    mod.banned = keep(mod.banned, name);
    const row = this.db.accountByKey(nameKey(name));
    if (action === 'allow') mod.allow.push({ name, note: String(note || ''), at: Date.now() });
    if (action === 'ban') {
      mod.banned.push({ name, note: String(note || ''), at: Date.now() });
      // 只停用这个名字与它的规范化变体；账号、头像、编号、口令与配置**全部保留**（参考文档 §6）。
      if (row && !row.nameBanned) { row.originalName = row.name; row.nameBanned = true; }
    }
    if (action === 'unban' && row && row.nameBanned) { row.nameBanned = false; }
    this.db.reindex();
    this.db.save();
    return { rows: this.adminView('banned').rows };
  }

  adminRules(token, words) {
    if (!this.adminGuard(token)) return { error: 'ADMIN_DENIED', message: '管理口令不对' };
    if (!Array.isArray(words)) return { error: 'ADMIN_BAD_INPUT', message: '词表需为一个数组' };
    const cleaned = [];
    for (const word of words) {
      if (typeof word !== 'string') continue;
      const trimmed = word.trim();
      if (trimmed && !cleaned.includes(trimmed)) cleaned.push(trimmed);
    }
    this.db.data.moderation.rules = cleaned;
    this.db.save();
    return { rules: [...cleaned] };
  }

  /** 采集：把所有已注册名字按**当前**词表重判一次，命中的进 `observations`（只标记，不拒绝任何东西）。 */
  adminScan(token) {
    if (!this.adminGuard(token)) return { error: 'ADMIN_DENIED', message: '管理口令不对' };
    const mod = this.db.data.moderation;
    const now = Date.now();
    const seen = [];
    for (const row of this.db.data.accounts) {
      const assessed = this.assessName(row.name);
      if (assessed) seen.push({ name: row.name, source: assessed, at: now });
    }
    mod.observations = seen;
    this.db.save();
    return { observations: seen };
  }

  // ---- lane 信封 ----------------------------------------------------------------------------

  /** 一条请求 → 一条应答（异步，因为有 scrypt）。 */
  async dispatch(msg, peer) {
    const id = msg && typeof msg.id === 'number' ? msg.id : null;
    if (id === null) return null;
    const op = typeof msg.op === 'string' ? msg.op : '';
    const token = typeof msg.token === 'string' ? msg.token : '';
    try {
      switch (op) {
        case 'register': return { id, ...await this.register(msg.nickname, msg.qq, msg.password, peer) };
        case 'login': return { id, ...await this.login(msg.login, msg.password, peer) };
        case 'me': {
          const row = this.sessionAccount(token);
          return row ? { id, account: this.db.publicAccount(row) } : { id, account: null };
        }
        case 'logout': {
          const hash = AccountService.tokenHash(token);
          if (this.db.data.sessions[hash]) { delete this.db.data.sessions[hash]; this.db.save(); }
          return { id, ok: {} };
        }
        case 'name': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.rename(row, msg.name) };
        }
        case 'password': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...await this.changePassword(row, msg.current, msg.next, token) };
        }
        case 'avatar': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.setAvatar(row, msg.data) };
        }
        case 'prefsGet': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.prefsGet(row) };
        }
        case 'prefsPut': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.prefsPut(row, msg.patch) };
        }
        case 'profile': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.profileOf(row) };
        }
        case 'namecard': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.setNamecard(row, msg.namecard) };
        }
        case 'friendList': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.friendView(row) };
        }
        case 'friendAdd': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.friendAdd(row, msg.login) };
        }
        case 'friendRemove': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.friendRemove(row, msg.id) };
        }
        case 'achievements': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.achievementsOf(row) };
        }
        case 'bind': {
          const row = this.sessionAccount(token);
          if (!row) return { id, error: 'BAD_CREDENTIALS', message: '需要先登录' };
          return { id, ...this.bind(row, msg.ticket) };
        }
        case 'lookup': {
          // 游客也能读（参考文档 §3 同一条），但**必须限流**：这条端点按座位号查人，不限制就是一台「谁在这个座位」
          // 的探针。桶按客户端地址分（与服务端其余限流同一条口径）。
          if (!allow(this.buckets, `lookup:${peer}`, 1 / 1000, 20)) {
            return { id, error: 'RATE_LIMIT', message: '查询过于频繁' };
          }
          const ids = Array.isArray(msg.ids) ? msg.ids.filter((v) => typeof v === 'string' && v).slice(0, 64) : [];
          return { id, ...this.lookupPlayer(ids) };
        }
        case 'admin': {
          // **每一个管理动作都要口令** —— 包括只读的列表。把这一句放在分支里逐个写，正是「新增一个动作时忘了
          // 加鉴权」最容易发生的地方（本包的第一次自测就是这么漏掉 `names` 的）。
          if (!this.adminGuard(msg.adminToken)) return { id, error: 'ADMIN_DENIED', message: '管理口令不对' };
          if (msg.action === 'names') return { id, ...this.adminView(msg.status, msg.q) };
          if (msg.action === 'avatars') return { id, ...this.adminAvatars(msg.status) };
          if (msg.action === 'avatar-review') return { id, ...this.adminAvatarReview(msg.adminToken, msg.accountId, msg.reviewAction, msg.note) };
          if (msg.action === 'scan') return { id, ...this.adminScan(msg.adminToken) };
          if (msg.action === 'review') return { id, ...this.adminReview(msg.adminToken, msg.name, msg.reviewAction, msg.note) };
          if (msg.action === 'rules') return { id, ...this.adminRules(msg.adminToken, msg.words) };
          return { id, error: 'ADMIN_BAD_INPUT', message: `未知的管理动作「${msg.action}」` };
        }
        default: return { id, error: 'UNKNOWN_OP', message: `未知操作「${op}」` };
      }
    } catch (err) {
      this.log?.error?.(`${op} threw: ${err && err.message ? err.message : err}`);
      return { id, error: 'INTERNAL', message: '服务器内部错误' };
    }
  }

  /** 收一条文本消息：能解析出 `id` 就回一条应答，解析不了就静默丢掉并记一行。 */
  async onMessage(ws, text, peer) {
    let msg;
    try { msg = JSON.parse(text); }
    catch { this.log?.warn?.('dropped a non-JSON message'); return; }
    if (!isPlain(msg) || typeof msg.id !== 'number') return;
    if (!allow(this.buckets, `msg:${peer}`, 20 / 1000, 60)) {
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: { code: 'RATE_LIMIT', message: '请求过于频繁' } }));
      return;
    }
    const out = await this.dispatch(msg, peer);
    if (!out) return;
    const { id, error, message, ...rest } = out;
    const payload = error
      ? { id, ok: false, error: { code: error, message: message || error } }
      : { id, ok: true, ...rest };
    ws.send(JSON.stringify(payload));
  }

  /**
   * 一条升级请求 → 一条 lane 连接。**同源性检查在这里**（`Origin` 的主机名必须等于目标主机名）：
   * 这条通道只有本页面的 JS 该用得上，跨站页面拿着浏览器里那份 cookie/本地存储来打它才是要挡的东西
   * （参考文档 §3 同一条：服务不向任意跨域请求开放）。
   *
   * 目标主机名优先取 `X-Forwarded-Host` 的**第一段**（逗号分隔、去空白、小写），没有它才退回 `Host`：反代
   * （例如线上那台）转发时会把 `Host` 改写成它自己的回环地址（`127.0.0.1:3001`），拿它跟浏览器看到的
   * `Origin` 比永不相等 ⇒ 线上账号面板必然 403。本机 `:3000` 直连时 `Origin` 与 `Host` 相同，所以本地
   * E2E 撞不到这个坑（这坑只在反代后暴露）。
   *
   * 比较用**主机名**（`URL#hostname`）而不是 `URL#host`：威胁是「跨**站**」，端口差异不构成风险，反代又常会
   * 带上 `:443` 之类；取主机名后两侧都不带端口。
   *
   * 这条放宽**不降低安全性**：浏览器**无法**给 `new WebSocket()` 的握手加自定义请求头，所以跨站页面**伪造不了**
   * `X-Forwarded-Host` —— 只有反代（可信的同机一跳）能设它。没有 `Origin` 头（非浏览器客户端）照旧放行；
   * `Origin` 解析不出来照旧拒。
   */
  onUpgrade(req, socket, head, ctx, peer) {
    const headers = (req && req.headers) || {};
    const origin = headers.origin;
    if (origin) {
      const xfh = headers['x-forwarded-host'];
      const targetHost = typeof xfh === 'string' && xfh.trim()
        ? xfh.split(',')[0].trim()
        : String(headers.host || '');
      let originName = null;
      try { originName = new URL(origin).hostname.toLowerCase(); } catch { originName = null; }
      let targetName = '';
      try { targetName = new URL(`http://${targetHost}`).hostname.toLowerCase(); } catch { targetName = ''; }
      if (!originName || !targetName || originName !== targetName) {
        ctx?.log?.warn?.(`refused a cross-origin upgrade (origin ${origin}, host ${targetHost})`);
        if (typeof ctx?.reject === 'function') ctx.reject(403, 'cross-origin upgrade refused');
        else { try { socket.destroy(); } catch { /* already gone */ } }
        return;
      }
    }
    if (!acceptUpgrade(req, socket)) {
      if (typeof ctx?.reject === 'function') ctx.reject(400, 'websocket handshake refused');
      else { try { socket.destroy(); } catch { /* already gone */ } }
      return;
    }
    const ws = new WsServer(socket, {
      maxPayload: LIMITS.frameMax,
      log: this.log,
      onMessage: (text) => { void this.onMessage(ws, text, peer); },
      onClose: () => { this.sockets.delete(ws); },
    });
    this.sockets.add(ws);
  }

  /** 停机：把所有活着的连接关掉（`host.onShutdown` 调它）。 */
  closeAll() {
    for (const ws of this.sockets) ws.close(1001);
    this.sockets.clear();
  }
}

// ---------------------------------------------------------------------------------------------
// 装载
// ---------------------------------------------------------------------------------------------

/**
 * 本包的 `server.modules` 入口：`registerServer(host)`。
 *
 * 挂四样：`lane`（那一条 WebSocket）、`boot`（装载库 + 生成/读管理口令 + 起一行日志）、`shutdown`（关连接）、
 * `healthz`（账号数/待审数）。**没声明过的挂载点碰不到**（宿主会抛 `MODULE_USE_UNDECLARED`）。
 */
export function registerServer(host) {
  const db = new AccountDb(host.io).load();
  let adminToken = null;
  const service = new AccountService({ host, db, adminToken: '', log: host.log });

  host.onBoot(() => {
    const stored = host.io.read(ADMIN_FILE);
    let parsed = null;
    try { parsed = stored ? JSON.parse(stored) : null; } catch { parsed = null; }
    if (isPlain(parsed) && typeof parsed.token === 'string' && parsed.token.length >= 16) {
      adminToken = parsed.token;
    } else {
      // 首次启动：随机生成并**写进启动日志**（本包没有别的管理鉴权来源；运营方自己保存它）。
      adminToken = randomBytes(18).toString('hex');
      host.io.write(ADMIN_FILE, JSON.stringify({ token: adminToken, at: Date.now() }));
      host.log.info(`admin token generated: ${adminToken} (stored in ${host.io.dir}/accounts.json 的同一目录，文件 ${ADMIN_FILE})`);
    }
    service.adminToken = adminToken;
    host.log.info(`lane ${LANE_PATH} ready; ${db.data.accounts.length} account(s) in ${host.io.dir}`);
  });

  host.lane((req, socket, head, ctx) => {
    const peer = (req && req.socket && (req.socket.remoteAddress || '')) || '';
    service.onUpgrade(req, socket, head, ctx, peer === '' ? 'unknown' : peer);
  });

  host.onShutdown(() => service.closeAll());

  host.healthz(() => ({
    accounts: db.data.accounts.length,
    pendingAvatars: db.data.accounts.filter((a) => a.pending === true).length,
    sessions: Object.keys(db.data.sessions).length,
    bindings: Object.keys(db.data.bindings).length,
  }));

  return { db, service };
}
