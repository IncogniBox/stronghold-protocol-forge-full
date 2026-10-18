// workshop/side-story/battle/main.mjs — 「故事集」盟约前置包的**战斗侧预设运行时**（`pack.json.server.battle`，DESIGN §28.17）。
//
// 这个包不是某一个故事集，而是「故事集」这个**盟约类型的公共层**：把这一类盟约都会用到的战斗侧通用效果沉淀成
// 一份**数据驱动的预设**，让每个独立的故事集包**只写数据**就能生效，不必各自重复实现同样的东西。
//
// ── 约定：独立故事集包要照做的全部事情 ───────────────────────────────────────────────
//   1. 盟约记录里写 `"bondType": "SIDE_STORY"`。引擎里 `bondType` 只是一个**数据标签**（服务端只用 `identifier`
//      排序、客户端只按 `isCore` 显示核心/附加），本包是它唯一真正的消费者：客户端按它打「故事集」徽标，
//      这里按它挑出故事集盟约。取值不在引擎的 `SEASON`/`REGULAR` 闭枚举里，但**工坊管线不做枚举校验**
//      （`shared/bondAuthoring.js` 的 `BOND_TYPES` 只约束编辑器 `deriveBondRecord`），所以能原样进客户端。
//   2. 记录带一块可解析的黑板：`buffParams(rec, 'env_gbuff_new').bb`，或回退到记录顶层 `bb`（与引擎
//      `bonds/dataDriven.js genericMods` 同一处取法）。
//   3. 想要**预设效果**，就在黑板里写本包认的键（见下表，全部 `story_` 前缀）；不写就没有预设效果。
//   4. 想要**专属效果**（护盾、发放装备/干员、特殊触发…），在自己的 `pack.json.server.battle` 里
//      `registerBondInstaller('<你的bondId>', fn)` —— 本包**不占用任何 bondId 的 installer 槽位**（见下），
//      所以两边互不顶掉。
//   5. 想要**本局的禁用规则**（几个故事集盟约、禁哪几个），**什么都不用写** —— 本包已经用 `isCore: false` +
//      `weight > 0` 把它们登记成本局的附加盟约，并按「N ≥ 3 禁 1 个、此后每 2 个再禁 1 个」抽签（见接口四）。
//
// ── 为什么用 `install(battle)` 而不是 `registerBondInstaller` ──────────────────────────
//   `sim/content/bonds/core.js registerBondInstaller(bondId, fn)` 是**一个 bondId 一个 installer、先到先得**
//   （`EXTRA_INSTALLERS.has(bondId)` 会直接忽略第二次注册）。前置包若替别人的盟约注册 installer，就会把故事集包
//   自己的注册顶掉，而**包之间的加载顺序不是契约** —— 这种失效是静默的。所以这里走另一条路：每个战场建起来时，
//   引擎都会调用本模块的 `install(battle)`（`sim/content/index.js installContent`，在官方 MODULES 之后），
//   我们在这时按 `bondType === 'SIDE_STORY'` 自己找出故事集盟约、自己挂预设效果 —— 一个 installer 槽位都不碰。
//
// ── 预设键表（黑板键 → 效果；`*_per_stack` 是每层增量，量纲同引擎的 buff mods）────────────
//   story_aspd        + story_aspd_per_stack        → 攻击速度（绝对值加算）
//   story_res         + story_res_per_stack         → 法术抗性（绝对值）
//   story_sp          + story_sp_per_stack          → 每秒技力
//   story_redeploy    + story_redeploy_per_stack    → 再部署时间（比例；-0.3 = 减少 30%）
//   只写 base（不看层数）或只写 per_stack（base 按 0）都合法；两个都没有 = 该盟约没有预设效果。
//   层数变化时按新层数重算（`onLayers`，与官方盟约一致）。
//
// ⚠ 与引擎通用加成的边界：敌人/盟约的**攻击力/防御/生命上限按层数百分比**走的是引擎自带的
//   `bonds/dataDriven.js`（记录写 `"genericBuffs": true` + `base_atk`/`atk_per_stack` 等）。本包**不碰**那条通路，
//   免得同一份加成被算两次；想加属性%就打开 `genericBuffs`，想加攻速/法抗/技力/再部署就用上表的 `story_*` 键。

import * as S from '@battle/mod.js';
import { num, onLayers } from '@battle/mod.js';

/** 故事集盟约的类型标记 —— 本包与所有独立故事集包之间的**唯一约定**。 */
export const STORY_BOND_TYPE = 'SIDE_STORY';

// ── 接口四：本局盟约抽签策略 `matchBondPolicy`（引擎 `server/match/pool.js drawDisabledBonds` 的 `policies`）──
//
// 引擎在**自己抽签之前**把每个声明了 `server.battle` 的包的 `matchBondPolicy(ctx)` 依次跑一遍（`ctx` = `{ gd, rng,
// eligible }`），收下它返回的 `{ claim, drawn, removed }`。本包在这里实现「故事集盟约」这一类盟约的**本局禁用规则**：
//
//   * `claim`   —— **所有**故事集盟约：引擎不再把它们丢进自己的核心/附加抽签池，改由下面这条规则说了算。
//   * `drawn` / `removed` —— 按数量抽出来的那几个：既并入本局的禁用表 D（于是「全身只有这一个盟约」的**专属干员**
//     照引擎既有规则进「本局禁用干员」），也进**摘除表**（于是有其他盟约的成员**不被禁**，只是身上这一个盟约本局不作数）。
//
// 规则：故事集盟约有 N 个时，N ≥ 3 就抽 1 个禁掉，此后**每多 2 个再多禁 1 个** —— 即禁 `N >= 3 ? floor((N-1)/2) : 0` 个。
// （N = 3/4 → 1 个，5/6 → 2 个，7/8 → 3 个 …）
//
// 被禁的是哪几个由 `rng` 决定（同一个种子 + 同一批包 ⇒ 同一个结果；引擎不带 `Math.random` 一类的东西进这一层）。

/** 用引擎的种子随机数打乱一份拷贝（引擎的 `createRng` 自带 `shuffle`；保底再写一遍 Fisher–Yates）。 */
function shuffled(list, rng) {
  const a = list.slice();
  if (rng && typeof rng.shuffle === 'function') { rng.shuffle(a); return a; }
  const rand = typeof rng === 'function' ? rng : () => 0;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * 本局要禁用的故事集盟约个数：N 个故事集盟约 → `N >= 3 ? floor((N-1)/2) : 0`。
 * @param {number} n 本局参与抽签的故事集盟约数
 */
export function storyBanCount(n) {
  const k = Math.floor(Number(n) || 0);
  return k >= 3 ? Math.floor((k - 1) / 2) : 0;
}

/**
 * 引擎的本局盟约抽签策略（`server.battle` 的可选导出，见文件头的接口四）。
 * @param {{ gd: any, rng: Function, eligible: string[] }} ctx
 * @returns {{ claim: string[], drawn: string[], removed: string[] }|null}
 */
export function matchBondPolicy({ gd, rng }) {
  if (!gd || typeof gd.bond !== 'function' || !Array.isArray(gd.bondIds)) return null;
  const story = gd.bondIds.filter((id) => {
    const rec = gd.bond(id);
    return !!rec && rec.bondType === STORY_BOND_TYPE && Number(rec.weight) > 0 && !gd.modeInactiveBonds.has(id);
  });
  if (!story.length) return null;
  const bans = storyBanCount(story.length);
  const picked = bans > 0 ? shuffled(story, rng).slice(0, bans) : [];
  return { claim: story, drawn: picked, removed: picked };
}

/** 预设键表：`[buff mods 键, 黑板 base 键, 黑板 per_stack 键, 变换]`。 */
const PRESETS = Object.freeze([
  ['aspd', 'story_aspd', 'story_aspd_per_stack', (v) => v],
  ['resFlat', 'story_res', 'story_res_per_stack', (v) => v],
  ['spRecoveryFlat', 'story_sp', 'story_sp_per_stack', (v) => v],
  ['redeployMul', 'story_redeploy', 'story_redeploy_per_stack', (v) => Math.max(0, 1 + v)],
]);

/** 一条盟约记录的黑板（官方写法 `env_gbuff_new` 优先，其次记录顶层 `bb`；都没有返回 null）。 */
function blackboard(rec) {
  const p = S.buffParams(rec, 'env_gbuff_new');
  if (p) return p;
  return rec && typeof rec.bb === 'object' && rec.bb ? rec.bb : null;
}

/** 故事集盟约按当前层数算出的预设 mods（一个认得的键都没有时返回 null）。 */
function presetMods(rec, layers) {
  const bb = blackboard(rec);
  if (!bb) return null;
  const m = {};
  for (const [key, baseKey, perKey, tx] of PRESETS) {
    const v = num(bb[baseKey]) + num(bb[perKey]) * num(layers);
    if (Number.isFinite(v) && v !== 0) m[key] = tx(v);
  }
  return Object.keys(m).length ? m : null;
}

/**
 * 给一个玩家的一条故事集盟约挂/更新预设效果（非故事集盟约直接返回）。
 * 用 `passiveBuff`（同键替换、死后保留）——与哥伦比亚盟约等的写法一致，层数变化时可重复调用。
 */
function applyBond(battle, pid, bondId) {
  const rec = S.bondRecord(bondId);
  if (!rec || rec.bondType !== STORY_BOND_TYPE) return;
  const members = S.bondMembers(battle, pid, bondId);
  if (!members.length) return;
  const key = `bond:story:${bondId}`;
  const mods = presetMods(rec, S.bondLayers(battle, pid, bondId));
  if (!mods) { for (const u of members) battle.removeBuff(u, key); return; }
  const dm = S.directMods({}, mods);
  for (const u of members) S.passiveBuff(battle, u, key, dm);
}

/** 每个战场建起来时跑一次（`installContent` 在官方内容模块之后调用）：给所有**已激活**的故事集盟约挂预设。 */
export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  const watched = [];
  for (const p of battle.players) {
    const pid = p && p.playerId;
    const live = p && p.bonds && typeof p.bonds === 'object' ? p.bonds : null;
    if (!live) continue;
    for (const bondId of Object.keys(live)) {
      const rec = S.bondRecord(bondId);
      if (!rec || rec.bondType !== STORY_BOND_TYPE) continue;
      if (!S.bondActive(battle, pid, bondId)) continue;
      applyBond(battle, pid, bondId);
      watched.push([pid, bondId]);
    }
  }
  // 层数变化 → 按新层数重算（onLayers 的刷新回调晚一个 tick 读层数，与引擎一致）。
  for (const [pid, bondId] of watched) onLayers(battle, pid, bondId, () => applyBond(battle, pid, bondId));
}