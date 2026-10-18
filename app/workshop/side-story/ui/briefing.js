// workshop/side-story/ui/briefing.js — 「故事集」盟约前置包的**简报分区**（组件级改写 DESIGN §28.19）。
//
// 它把「确认本局信息」简报里属于故事集的那两块单独分出来，独立故事集包**零客户端代码**：
//
//   1. 故事集盟约 SIDE STORY BONDS —— 在**附加盟约**下面新开一栏，只列故事集盟约（把它们从附加盟约行里拿出来，
//      不重复显示）。改写引擎具名组件 `briefing.bonds`（`mode: "replace"`：引擎那两块盟约行由本模块重画）。
//      被禁用的故事集盟约由引擎的数据自己画成灰盘（`model.stateOf` → 「本局禁用」，见 gameLogic disabledBondSets
//      把 m.public.removedBonds 并入 off）。
//   2. 本局禁用故事集干员 BANNED SIDE STORY OPERATORS —— 在**本局禁用干员**下面新开一栏，列出被禁用的故事集盟约的
//      **专属干员**（身上只带故事集盟约的那些 —— 引擎既有的「全身盟约都被禁就禁人」规则已经把它们禁了）。
//      改写引擎具名组件 `briefing.banned`（`mode: "wrap"`：引擎那一块照旧，本模块在它后面补一栏）。
//
// 两份改写都只是**只读视图**：只读 `props.model`（matchInfoModel 的结果）与合并后的 `bonds` / `chess` 数据表，
// 不碰对局结果。用的 `html` 就是引擎那一份（`/js/ui/components.js` 的 htm 绑定），所以卡片与图标的样式/组件与简报
// 其余部分逐字同源。
//
// ⚠ 引擎里没有「故事集」这个概念：这个模块与 `battle/main.mjs` 是本包唯一认识 `bondType === 'SIDE_STORY'` 的两处。

import { html, MicroLabel } from '/js/ui/components.js';
import { MatchBondRow } from '/js/ui/matchInfo.js';
import { UnitThumb } from '/js/ui/gameComponents.js';

/** 故事集类型标记（与 `battle/main.mjs` 的 `STORY_BOND_TYPE` 同一约定）。 */
const STORY_BOND_TYPE = 'SIDE_STORY';

/** `bonds` 是合并后的 bonds.json（以 bondId 为键）：这一条是不是故事集盟约。 */
const isStory = (bonds, id) => !!bonds && !!bonds[id] && bonds[id].bondType === STORY_BOND_TYPE;

/**
 * `ctx.props` 是引擎造的**只读深拷贝**，其中 `model.perBond`（一张 `Map`）在里面会退化成一个空对象（快照只走
 * `Object.entries`）—— 而 `MatchBondRow` 要用 `perBond.get(bondId)`。这里用引擎的同一份口径（`visibleMembers ∩ banned`，
 * 与 gameLogic bannedPerBond 逐字相同）把它重建出来，其余字段原样透传。
 * @param {any} model 引擎那一帧的 model（快照）
 * @param {any} bonds 合并后的 bonds.json
 * @returns {any}
 */
function withPerBond(model, bonds) {
  const banned = new Set(Array.isArray(model && model.banned) ? model.banned : []);
  const perBond = new Map();
  for (const list of [(model && model.core) || [], (model && model.addon) || []]) {
    for (const b of list) {
      const rec = bonds && b ? bonds[b.bondId] : null;
      const members = rec && Array.isArray(rec.visibleMembers) ? rec.visibleMembers : [];
      perBond.set(b.bondId, members.filter((id) => banned.has(id)).length);
    }
  }
  return { ...model, perBond };
}

/**
 * 分区一：核心盟约 / 附加盟约（去掉故事集）/ 故事集盟约（`briefing.bonds`，replace 档 —— `orig` 是 null）。
 * @param {{ model: any, bonds: any }} props
 */
function StoryBondRows({ model, bonds }) {
  const core = (model && model.core) || [];
  const addon = (model && model.addon) || [];
  const story = addon.filter((b) => isStory(bonds, b.bondId));
  const rest = addon.filter((b) => !isStory(bonds, b.bondId));
  const m = withPerBond(model, bonds);
  return html`<${MatchBondRow} title="核心盟约" micro="CORE BONDS" bonds=${core} model=${m} />
    <${MatchBondRow} title="附加盟约" micro="ADD-ON BONDS" bonds=${rest} model=${m} />
    ${story.length ? html`<${MatchBondRow} title="故事集盟约" micro="SIDE STORY BONDS" bonds=${story} model=${m} />` : null}`;
}

/**
 * 被禁用的故事集盟约的**专属干员**：本局被禁、且它列在的**每一个**盟约都是故事集盟约的干员。
 *
 * 判据只用合并后的 `bonds` 表（引擎自己也是用 `visibleMembers` 算「某盟约被禁了几名干员」的）：先反查出每个被禁
 * 干员出现在哪些盟约的 `visibleMembers` 里，再看这些盟约是不是清一色故事集 —— 于是「还带别的盟约的干员」（不会被禁）
 * 自然被排除，只有**专属干员**留下。列表沿用模型自己的排序（= `本局禁用干员` 那一栏的顺序）。
 * @param {{ model: any, bonds: any }} props
 * @returns {string[]}
 */
function storyBannedOperators({ model, bonds }) {
  const banned = Array.isArray(model && model.banned) ? model.banned : [];
  if (!banned.length || !bonds) return [];
  const bannedSet = new Set(banned);
  /** @type {Map<string, Set<string>>} 被禁干员 → 它出现在哪些盟约的 visibleMembers 里 */
  const appearsIn = new Map();
  for (const id of Object.keys(bonds)) {
    const members = Array.isArray(bonds[id] && bonds[id].visibleMembers) ? bonds[id].visibleMembers : [];
    for (const m of members) {
      if (!bannedSet.has(m)) continue;
      let set = appearsIn.get(m);
      if (!set) appearsIn.set(m, (set = new Set()));
      set.add(id);
    }
  }
  const out = [];
  const seen = new Set();
  for (const id of banned) {
    const own = appearsIn.get(id);
    if (!own || !own.size) continue;
    // 专属 = 它列在的每一个盟约都是故事集盟约（还带别的盟约的干员不与故事集一栏重复列出）
    if (![...own].every((b) => isStory(bonds, b))) continue;
    // 其中至少有一个本局被禁（它才会进 banned；写全判据）
    if (![...own].some((b) => !!(model && model.stateOf) && model.stateOf(b) !== null)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 分区二：本局禁用故事集干员（`briefing.banned`，wrap 档 —— 引擎那一块照旧渲染，本块补在它后面）。
 * @param {{ model: any, bonds: any }} props
 */
function StoryBannedBlock({ model, bonds }) {
  const ids = storyBannedOperators({ model, bonds });
  if (!ids.length) return null;
  return html`<div class="brief-banned" data-mod="story-banned">
    <h3 class="brief-h"><span>本局禁用故事集干员</span><${MicroLabel}>BANNED SIDE STORY OPERATORS</${MicroLabel}><b class="num brief-banned__n">${ids.length}</b></h3>
    <div class="brief-banned__grid">
      ${ids.map((id) => html`<${UnitThumb} key=${id} kind="chess" id=${id} size="sm" dim=${true} />`)}
    </div>
  </div>`;
}

/**
 * 组件级改写入口（`pack.json.client.panels[].wraps`）：同一个模块声明了两条链，按 `ctx.component` 分派。
 * `ctx.data.get('bonds')` 是合并后的盟约表（已在 `client.panels[].data` 里声明）。
 */
export function wrap(ctx) {
  const bonds = ctx && ctx.data && typeof ctx.data.get === 'function' ? ctx.data.get('bonds') : null;
  const model = ctx && ctx.props ? ctx.props.model : null;
  if (ctx.component === 'briefing.bonds') {
    // replace：引擎那两块盟约行不再渲染，由本模块重画（并补上故事集那一栏）
    return () => html`<${StoryBondRows} model=${model} bonds=${bonds} />`;
  }
  if (ctx.component === 'briefing.banned') {
    // wrap：引擎那一块作为 `orig` 原样留着，本块补在它后面
    return (orig) => [orig, html`<${StoryBannedBlock} model=${model} bonds=${bonds} />`];
  }
  return (orig) => orig;
}