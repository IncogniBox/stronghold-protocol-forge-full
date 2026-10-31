// Pre-recon — PHASE.PRE_RECON 「预重构」（模式扩展-重构模拟 · 机制轮）：策略选择之后、协议启动之前，
// 每名博士在 60 秒内钉下本局的重构走向，服务端收齐全员（或计时耗尽）即进入 BATTLE_CHECK
// （server/match/match/phases.js enterPreRecon / maybeEndPreRecon / finishPreRecon）。
//
// 三块内容（与需求同一顺序）：
//   1. 盟约倾向 —— 主盟约（**核心盟约**，isCore）≤2 / 副盟约（**附加盟约**，非核心、非故事集）≤3 /
//      故事集盟约（bondType 'SIDE_STORY'）≤1。「故事集」是 side-story 包认识的概念，引擎数据没有这一类，见
//      workshop/side-story/ui/sweep.js 的说明；这一栏的候选池**不受**模式盟约表限制 —— 故事集盟约的抽签与禁用
//      由故事集层按 match 自己管（同 README「接口一」），所以它按加载到的数据取。
//      候选池 = 本模式**不禁止**的盟约（config.modes[modeId].inactiveBondIds 才是「本局禁用」的那张表；
//      activeBondIds 只是静态可用清单，不当作闸门）+ 故事集那一类，再按 id 排除本模式专属的【重构】（特训授予，
//      不是玩家能倾向的东西）。主 / 副互斥（同一盟约不能既是主又是副）。
//   2. 试炼首领 —— 4 / 8 / 12 / 16 回合的首领格（shared/reconModes.js RECON_TRIAL_ROUNDS）。**带候选的回合**
//      （RECON_TRIAL_BOSSES 里有名的那几个，今天第 4 / 8 / 12 回合）是本局真选择器：候选是工坊包 workshop/mode-recon 的
//      「·重构」首领，每一条候选 = `{ id, keys }`；选中的候选按 id 随 `bosses` 交进 g.reconChoice；
//      余下的 16 回合（以及首领回合 20）仍是只读的「默认随机」。
//      没装那个包时这些 key 在数据里查无此敌 —— 界面照反查到的记录画，画不出来就退回 key 本身（引擎侧同理丢弃）。
//   3. 重构走向 —— 重构协助（全局增益）与熔芯负载（全局减益）各选 1。六个 `id` 就是接口：随 g.reconChoice
//      提交、留在服务器 reconChoices 里；机制已落在工坊包 workshop/mode-recon（休整期的两条在 meta/main.mjs，
//      战场上的四条在 battle/main.mjs），两处按同一批 id 生效。
//
// 提交：g.reconChoice（shared/protocol.js —— 全字段可选、逐键覆盖合并），已提交后可改选重交直到阶段结束。
// 观战席没有选择（pub.recon.choices 里不会有它的键）：整屏只读。
// 盟约选项的画法与简报的盟约行同一套（ui/matchInfo.js 的 MatchBondRow：圆盘 + 图标 + 名称，见 图4），
// 所以这里的池与那两块读的是同一份数据、同一个 `bondIconUrl`。
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, BondDisc, Icon, MicroLabel, Modal, useTicker, secondsLeft } from '../ui/components.js';
import { useGameData, PlayerAvatar, Img } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { act } from '../ui/gameActions.js';
import { bondIconUrl, enemyIconUrl } from '../ui/assetUrls.js';
import { phaseTotalSeconds, sortedPlayers } from '../ui/gameLogic.js';
import { useStore, isSpectating } from '../store.js';
import { MatchInfoDialog, matchInfoModel } from '../ui/matchInfo.js';
import { data } from '../data.js';
import { RECON_TRIAL_ROUNDS, RECON_TRIAL_BOSSES, RECON_BOND_ID } from '../../../shared/reconModes.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * 重构协助的选项表（全局增益，单选一项）。`id` 就是接口：`g.reconChoice.assist` 交上去、留在服务器 reconChoices 里，
 * 机制在 `workshop/mode-recon` 的两处按这些 id 生效（休整期的两条在 meta/main.mjs，战场上的四条在
 * battle/main.mjs）；文案与数值由业主给定，逐字照抄。
 */
const ASSIST_OPTS = Object.freeze([
  { id: 'recon_assist_bond', name: N_('盟约重构'), desc: N_('<修整期结束时>已激活层数最高的核心盟约、附加盟约、故事集盟约各+10层。') },
  { id: 'recon_assist_equip', name: N_('装备重构'), desc: N_('每回合前3次销毁装备时，获得1件不低于销毁装备阶级的随机装备，干员的装备可进行拆卸。') },
  { id: 'recon_assist_data', name: N_('数据重构'), desc: N_('场上干员的基础攻击力、基础防御力、基础生命上限提升各+25%，法术抗性+25点。') },
]);
/**
 * 熔芯负载的选项表（全局减益）。**业主 2026-10-30 改规则**：交上去的是「要**排除**的那一条」，另外两条同时生效
 * （从前是单选一条生效）。id 即接口，文案逐字照抄业主给的数值（三条的说明就是它们生效时的效果）。
 */
const LOAD_OPTS = Object.freeze([
  { id: 'recon_load_bond', name: N_('盟约负载'), desc: N_('已激活层数最高的核心盟约、附加盟约、故事集盟约每层使敌人的生命上限提高0.1%。') },
  { id: 'recon_load_equip', name: N_('装备负载'), desc: N_('干员未携带装备时的伤害下降25%，携带的装备阶级高于自身时使该装备的效果-50%并在3回合后自动销毁。（源石辅助仪、变形同构体不受自动销毁影响）') },
  { id: 'recon_load_data', name: N_('数据负载'), desc: N_('敌人的基础攻击力、基础防御力、基础生命上限各+25%，法术抗性+25点。') },
]);

/** 三条负载里**没有被排除**的那两条（`load` 不是三条之一时返回空 —— 那等于「不指定」，一条都不生效）。 */
function activeLoadOpts(load) {
  if (!load || !LOAD_OPTS.some((o) => o.id === load)) return [];
  return LOAD_OPTS.filter((o) => o.id !== load);
}

const MAJOR_MAX = 2;
const MINOR_MAX = 3;
const STORY_MAX = 1;

/**
 * 局内「策略效果」（screens/game.js 的 EFFECTS 列）读的行：这名玩家本局选定的**重构协助**与**生效中的熔芯负载**。
 * 名称与说明直接取自上面两张表（与预重构屏同一份 i18n），这里只按 id 反查，不复制文案。
 * 熔芯负载交上去的是「要排除的那一条」，所以这一列给出的是另外**两条**（业主 2026-10-30）。
 * @param {Record<string, { assist?: string|null, load?: string|null }>|null} choices `pub.recon.choices`
 * @param {string|null} selfId 自己
 * @returns {{ id: string, key: 'assist'|'load', kind: string, name: string, desc: string }[]}
 */
export function reconProtocolRows(choices, selfId) {
  const c = choices && selfId ? choices[selfId] : null;
  if (!c) return [];
  const rows = [];
  const assist = ASSIST_OPTS.find((o) => o.id === c.assist);
  if (assist) rows.push({ id: assist.id, key: 'assist', kind: t('重构协助'), name: t(assist.name), desc: t(assist.desc) });
  for (const o of activeLoadOpts(c.load)) rows.push({ id: o.id, key: 'load', kind: t('熔芯负载'), name: t(o.name), desc: t(o.desc) });
  return rows;
}

/** 一名博士已交的选择（pub.recon.choices[pid]），容错成 { major, minor, story, bosses, assist, load, ban }。 */
function normalizeChoice(c) {
  const o = c && typeof c === 'object' ? c : {};
  return {
    major: Array.isArray(o.major) ? o.major.filter((x) => typeof x === 'string') : [],
    minor: Array.isArray(o.minor) ? o.minor.filter((x) => typeof x === 'string') : [],
    story: typeof o.story === 'string' ? o.story : null,
    // 试炼首领：{ 回合号字符串 → 候选 key }（只留「数字回合 + 字符串 key」的条目，其余一律当没交）
    bosses: o.bosses && typeof o.bosses === 'object' && !Array.isArray(o.bosses)
      ? Object.fromEntries(Object.entries(o.bosses).filter(([k, v]) => typeof v === 'string' && /^\d+$/.test(k)))
      : {},
    assist: typeof o.assist === 'string' ? o.assist : null,
    load: typeof o.load === 'string' ? o.load : null,
    // 自主禁用（只影响自己的卡牌池）：至多 1 个盟约 id
    ban: typeof o.ban === 'string' ? o.ban : null,
  };
}

const STORY_BOND_TYPE = 'SIDE_STORY';

/**
 * 盟约倾向的一组（主 / 副 / 故事集）：圆盘瓦片（简报的盟约行同一套画法），点到上限后未选的置灰。
 * 右上角的小 ⊘ 是「自主禁用」：每名博士至多禁 1 个盟约，只影响自己的卡牌池（`ban` / `onBan`）。
 */
function BondGroup({ assets, title, kind, micro, max, pool, picks, onToggle, taken, ban, onBan }) {
  if (!pool.length) return null;
  const full = picks.length >= max;
  return html`<div class="prc-bonds__group">
    <div class="prc-bonds__ghead"><${MicroLabel} tone="ice">${micro}<//><span>${title}${kind ? html`<small class="prc-bonds__kind">${kind}</small>` : null}</span><b class="num">${picks.length}/${max}</b></div>
    <div class="prc-bonds__row" role="group" aria-label=${title}>
      ${pool.map((b) => {
        const on = picks.includes(b.bondId);
        const banned = ban === b.bondId;
        // 到上限 / 已被另一组选走的，不再点得动（不画 BondDisc 的 ✕ 徽标 —— 那不是「本局禁用」，只是「这一格满了」）。
        const locked = !on && (full || taken.has(b.bondId));
        return html`<div key=${b.bondId} class=${cx('prc-bond', on && 'is-on', locked && 'is-locked', banned && 'is-banned')} data-bond=${b.bondId}
          title=${b.name}>
          <${BondDisc} name=${b.name} icon=${bondIconUrl(assets, b.bondId)} active=${on}
            tier=${on ? Math.max(1, b.thresholds?.length || 1) : 0} maxTier=${Math.max(1, b.thresholds?.length || 1)}
            size="md" showName=${true} onClick=${locked ? undefined : () => onToggle(b.bondId)} />
          <button type="button" class=${cx('prc-bond__ban', banned && 'is-on')} data-ban=${b.bondId}
            aria-pressed=${banned ? 'true' : 'false'} title=${t('自主禁用「{name}」：只从你自己的卡牌池中排除', { name: b.name })}
            onClick=${(e) => { e.preventDefault(); e.stopPropagation(); onBan(b.bondId); }}>
            <${Icon} name="close" />
          </button>
        </div>`;
      })}
    </div>
  </div>`;
}

/**
 * 单选卡的一组（重构协助 / 熔芯负载）。选中的卡打一枚标记：重构协助是 ✓（它生效），
 * 熔芯负载是 ✕（选中 = 排除它，另外两条生效，业主 2026-10-30）。
 * @param {{ title: string, micro: string, opts: any[], pick: string|null, onPick: (id: string) => void,
 *   hint?: string|null, mark?: string }} props
 */
function OptGroup({ title, micro, opts, pick, onPick, hint = null, mark = 'check' }) {
  return html`<div class="prc-opts__group">
    <div class="prc-opts__ghead"><${MicroLabel} tone="ice">${micro}<//><span>${title}</span>
      ${hint ? html`<span class="prc-opts__hint">${hint}</span>` : null}</div>
    <div class="prc-opts__list" role="radiogroup" aria-label=${title}>
      ${opts.map((o) => html`<button key=${o.id} type="button" role="radio" aria-checked=${pick === o.id ? 'true' : 'false'}
        class=${cx('prc-opt', pick === o.id && 'is-on')} onClick=${() => onPick(o.id)}>
        <b class="prc-opt__name">${pick === o.id ? html`<${Icon} name=${mark} class="prc-opt__tick" />` : null}${t(o.name)}</b>
        <span class="prc-opt__desc">${t(o.desc)}</span>
      </button>`)}
    </div>
  </div>`;
}

/**
 * 一个「带候选的试炼回合」的候选行（RECON_TRIAL_BOSSES 里那个键）：单选瓦片组，瓦片 = 候选**每一位首领**的图标 + 名字。
 *
 * 一条候选可以含**两只**（第 8 回合第 3 项 = 梅菲斯特·重构 + 浮士德·重构）：两只并排画在**同一张**瓦片上，点一下就是
 * 选中**整条**候选（业主确认它们算一次选择）。图标按 `记录.iconId` 反查（·重构首领沿用官方首领的外观 —— enemies.json
 * 的 `iconId` 指向官方 key，正是资源清单里有图的那一个）；查不到就退回 key 本身，`Img` 再画不出来时才落 `warn` 图标。
 * 名字取数据里的 `name`（业主给的中文名），拿不到就显示 key。再点一次已选中的那一张 = 撤回（回到「默认随机」）。
 * 提交的值是候选的 **id**（单选时 id = 它唯一的 key）。
 * @param {{ m: any, enemy: (k: string) => any, round: number, choices: Array<{ id: string, keys: string[] }>, pick: string|null, onPick: (id: string) => void }} props
 */
function TrialPick({ m, enemy, round, choices, pick, onPick }) {
  return html`<div class="prc-trials__pool">
    <div class="prc-trials__phead"><${MicroLabel} tone="ice">R${String(round).padStart(2, '0')}<//><span>${t('第 {round} 回合候选', { round })}</span></div>
    <div class="prc-trials__row" role="radiogroup" aria-label=${t('试炼首领候选')}>
      ${choices.map((ch) => {
        const on = pick === ch.id;
        return html`<button key=${ch.id} type="button" role="radio" aria-checked=${on ? 'true' : 'false'}
          class=${cx('prc-trial-pick', on && 'is-on', ch.keys.length > 1 && 'is-pair')} data-choice=${ch.id} onClick=${() => onPick(ch.id)}>
          ${on ? html`<span class="prc-trial-pick__tick"><${Icon} name="check" /></span>` : null}
          ${ch.keys.map((key) => {
            const rec = enemy(key);
            return html`<span key=${key} class="prc-trial-pick__unit">
              <span class="prc-trial-pick__icon"><${Img} src=${enemyIconUrl(m, rec?.iconId || key)} fallback=${html`<${Icon} name="warn" />`} /></span>
              <b class="prc-trial-pick__name">${rec?.name || key}</b>
            </span>`;
          })}
        </button>`;
      })}
    </div>
  </div>`;
}

/**
 * 一条候选的全部名字（用「、」连接）—— 提交值（候选 id）→ 它 `keys` 上每个敌人的 `name`（查不到就退回 key）。
 * 单只候选与两只候选同一段代码，界面各处的「已选了什么」都读这里，免得出现两套念法。
 * @param {Array<{ id: string, keys: string[] }>|null} choices
 * @param {string} id @param {(k: string) => any} enemy
 */
function choiceNames(choices, id, enemy) {
  const ch = Array.isArray(choices) ? choices.find((c) => c && c.id === id) : null;
  if (!ch) return id;
  return ch.keys.map((k) => enemy(k)?.name || k).join(t('、'));
}

/**
 * 一份已交的选择 → 「标签 / 值 / 说明」三段：右侧摘要、提交确认弹窗、队友详情弹窗共用同一份念法。
 * `storyVisible` 为假时（数据里没有故事集一类）不画那一行 —— 与候选池同一个判据。
 * @param {any} c 已交的选择（normalizeChoice 容错）
 * @param {any} gd useGameData() 的句柄
 * @param {boolean} storyVisible
 * @returns {{ k: string, v: string, desc?: string|null }[]}
 */
function summaryRows(c, gd, storyVisible) {
  const o = normalizeChoice(c);
  const names = (ids) => ids.map((id) => gd.bond(id)?.name || id).join(t('、'));
  const optOf = (opts, id) => (id ? opts.find((x) => x.id === id) || null : null);
  const assistOpt = optOf(ASSIST_OPTS, o.assist);
  const loadOpt = optOf(LOAD_OPTS, o.load);
  const activeLoads = activeLoadOpts(o.load).map((x) => t(x.name)).join(t('、'));
  const trials = RECON_TRIAL_ROUNDS
    .filter((r) => typeof o.bosses[r] === 'string' && o.bosses[r])
    .map((r) => choiceNames(RECON_TRIAL_BOSSES[r], o.bosses[r], gd.enemy));
  const rows = [
    { k: t('主盟约'), v: o.major.length ? names(o.major) : t('未选择') },
    { k: t('副盟约'), v: o.minor.length ? names(o.minor) : t('未选择') },
  ];
  if (storyVisible) rows.push({ k: t('故事集盟约'), v: o.story ? (gd.bond(o.story)?.name || o.story) : t('未选择') });
  rows.push(
    { k: t('试炼首领'), v: trials.length ? trials.join(t('、')) : t('默认随机') },
    { k: t('重构协助'), v: assistOpt ? t(assistOpt.name) : t('未选择'), desc: assistOpt ? t(assistOpt.desc) : null },
    {
      // 熔芯负载交上去的是「被排除的那一条」：值写排除的是谁，说明写另外两条都生效（业主 2026-10-30）
      k: t('熔芯负载'),
      v: loadOpt ? t('排除 {name}', { name: t(loadOpt.name) }) : t('未选择'),
      desc: loadOpt ? t('生效：{names}', { names: activeLoads }) : null,
    },
    {
      k: t('自主禁用'),
      v: o.ban ? (gd.bond(o.ban)?.name || o.ban) : t('无'),
      desc: o.ban ? t('本局这个盟约只从你自己的卡牌池中排除，队友不受影响。') : null,
    },
  );
  return rows;
}

/** 摘要（右侧与两个弹窗同一套画法）。 */
function Summary({ rows }) {
  return html`<dl class="prc-sum">
    ${rows.map((r) => html`<dt key=${r.k}>${r.k}<//><dd>${r.v}${r.desc ? html`<span class="prc-sum__desc">${r.desc}</span>` : null}</dd>`)}
  </dl>`;
}

/** 左侧队友行的一行速览：`协助 数据重构 · 负载 排除装备负载 · 禁用 炎`（没选的写「不指定」）。 */
function briefOf(c, gd) {
  const o = normalizeChoice(c);
  const nameOf = (opts, id) => t((id && opts.find((x) => x.id === id)?.name) || '不指定');
  const loadOpt = o.load ? LOAD_OPTS.find((x) => x.id === o.load) || null : null;
  const loadName = loadOpt ? t('排除 {name}', { name: t(loadOpt.name) }) : t('不指定');
  const head = `${t('协助')} ${nameOf(ASSIST_OPTS, o.assist)} · ${t('负载')} ${loadName}`;
  return o.ban ? `${head} · ${t('禁用')} ${gd?.bond(o.ban)?.name || o.ban}` : head;
}

/** 总览里的一枚盟约圆盘（主 / 副 / 故事集 / 自主禁用同一套画法）。 */
function OvBond({ gd, id, kind, banned = false }) {
  const rec = gd.bond(id);
  const n = Math.max(1, rec?.thresholds?.length || 1);
  return html`<span class=${cx('prc-ov__bond', banned && 'is-ban')} title=${rec?.name || id}>
    <${BondDisc} name=${rec?.name || id} icon=${bondIconUrl(gd.m, id)} size="sm"
      active=${true} tier=${1} maxTier=${n} />
    <small>${kind}</small>
  </span>`;
}

/**
 * 「队伍预重构总览」的一列（一名队友的已选内容）：盟约倾向（含自主禁用）/ 试炼首领 / 重构走向。
 * 只画**选中的**东西 —— 没选的整块不出现（过场动画里「未选淡出、已选留下」的落点就是这里）。
 */
function OverviewColumn({ p, choice, gd, self, storyVisible, continued, index }) {
  const c = normalizeChoice(choice);
  const missing = choice === undefined;
  const bonds = [
    ...c.major.map((id) => ({ id, kind: t('主') })),
    ...c.minor.map((id) => ({ id, kind: t('副') })),
    ...(c.story ? [{ id: c.story, kind: t('故') }] : []),
  ];
  const assist = ASSIST_OPTS.find((o) => o.id === c.assist) || null;
  const load = LOAD_OPTS.find((o) => o.id === c.load) || null;
  const activeLoads = activeLoadOpts(c.load).map((x) => t(x.name)).join(t('、'));
  return html`<article class=${cx('prc-ov', self && 'is-self')} style=${`--i:${index}`} data-player=${p.playerId}>
    <header class="prc-ov__head">
      <b class="prc-ov__name">${p.name || t('博士')}${p.isBot ? html`<span class="prc-p__ai">AI</span>` : null}</b>
      <span class="prc-ov__team">${t('第 {n} 队', { n: p.team || 1 })}</span>
      ${self ? html`<span class="prc-ov__me">${t('你')}</span>` : null}
      <span class=${cx('prc-ov__ok', continued && 'is-on')}>${continued ? html`<${Icon} name="check" />` : t('待确认')}</span>
    </header>
    ${missing ? html`<p class="prc-ov__missing t-dim">${t('未提交（按不指定进入）')}</p>` : html`
    <div class="prc-ov__sec">
      <h4>${t('盟约倾向')}</h4>
      <div class="prc-ov__bonds">
        ${bonds.map((b) => html`<${OvBond} key=${b.id} gd=${gd} id=${b.id} kind=${b.kind} />`)}
        ${c.ban ? html`<${OvBond} gd=${gd} id=${c.ban} kind=${t('禁')} banned=${true} />` : null}
        ${!bonds.length && !c.ban ? html`<span class="prc-ov__none t-dim">${t('未选择')}</span>` : null}
      </div>
    </div>
    <div class="prc-ov__sec">
      <h4>${t('试炼首领')}</h4>
      <div class="prc-ov__trials">
        ${(() => {
          // 只画**指定过的**回合 —— 没选的回合在过场里就被移除了（业主：没选的部分移除、选中的留下）。
          const picked = RECON_TRIAL_ROUNDS.map((r) => {
            const id = typeof c.bosses[r] === 'string' ? c.bosses[r] : null;
            return { r, ch: id ? (RECON_TRIAL_BOSSES[r] || []).find((x) => x.id === id) || null : null };
          }).filter((x) => !!x.ch);
          if (!picked.length) return html`<span class="prc-ov__none t-dim">${t('全部默认随机')}</span>`;
          return picked.map(({ r, ch }) => html`<div key=${r} class="prc-ov__trial">
            <span class="prc-ov__round num">R${String(r).padStart(2, '0')}</span>
            ${ch.keys.map((k) => {
              const rec = gd.enemy(k);
              return html`<span key=${k} class="prc-ov__unit">
                <span class="prc-ov__uicon"><${Img} src=${enemyIconUrl(gd.m, rec?.iconId || k)} fallback=${html`<${Icon} name="warn" />`} /></span>
                <b>${rec?.name || k}</b>
              </span>`;
            })}
          </div>`);
        })()}
      </div>
    </div>
    <div class="prc-ov__sec">
      <h4>${t('重构走向')}</h4>
      <div class="prc-ov__picks">
        ${[[t('协助'), assist && { name: t(assist.name), desc: t(assist.desc) }],
          [t('负载'), load && { name: t('排除 {name}', { name: t(load.name) }), desc: t('生效：{names}', { names: activeLoads }) }]]
          .map(([label, pick]) => html`<div key=${label} class=${cx('prc-ov__pick', !pick && 'is-empty')}>
          <span class="prc-ov__plabel">${label}</span>
          <b class="prc-ov__pname">${pick ? pick.name : t('未选择')}</b>
          ${pick ? html`<span class="prc-ov__pdesc">${pick.desc}</span>` : null}
        </div>`)}
      </div>
    </div>`}
  </article>`;
}

export function PreReconScreen() {
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const room = useStore((s) => s.room);
  const gd = useGameData();
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);
  // 提交确认弹窗 / 队友详情弹窗（后者存 playerId；null = 关）
  const [confirm, setConfirm] = useState(false);
  const [viewing, setViewing] = useState(null);
  // 本局信息弹窗（禁用盟约 / 禁用干员 / 特训敌人 …，与简报、策略选择屏同一份 ui/matchInfo.js 的 MatchInfo）
  const [infoOpen, setInfoOpen] = useState(false);

  const mode = gd.config?.modes?.[pub?.modeId];
  // 候选盟约池：本模式**不禁止**的盟约（inactiveBondIds 才是「本局禁用」的那张表；activeBondIds 不是闸门），
  // 按 bonds.json 原序。本模式专属的【重构】（特训授予）不在倾向里，按 id 排除。
  const pool = useMemo(() => {
    const inactive = new Set(Array.isArray(mode?.inactiveBondIds) ? mode.inactiveBondIds : []);
    return gd.list('bonds').filter((b) => !!b && b.bondId !== RECON_BOND_ID && !inactive.has(b.bondId));
  }, [gd.ready, mode?.inactiveBondIds]);
  // 主盟约 = 核心盟约（isCore）；副盟约 = 附加盟约；故事集盟约 = bondType 'SIDE_STORY'。
  const corePool = useMemo(() => pool.filter((b) => b.isCore === true), [pool]);
  const addonPool = useMemo(() => pool.filter((b) => b.isCore !== true && b.bondType !== STORY_BOND_TYPE), [pool]);
  const storyPool = useMemo(() => pool.filter((b) => b.bondType === STORY_BOND_TYPE), [pool]);

  const choices = pub?.recon?.choices && typeof pub.recon.choices === 'object' ? pub.recon.choices : {};
  const submitted = myId && choices[myId] !== undefined;
  const spectating = isSpectating(room, myId);

  // 本地选择：已提交过的选择第一次出现时回填（之后的本地改动不被广播覆盖 —— 允许改选重交）。
  const [major, setMajor] = useState([]);
  const [minor, setMinor] = useState([]);
  const [story, setStory] = useState(null);
  const [bosses, setBosses] = useState({});
  const [assist, setAssist] = useState(null);
  const [load, setLoad] = useState(null);
  /** 自主禁用：至多 1 个盟约 id（只影响自己的卡牌池） */
  const [ban, setBan] = useState(null);
  /** 总览上的「继续」在途 */
  const [contBusy, setContBusy] = useState(false);
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !submitted) return;
    filled.current = true;
    const c = normalizeChoice(choices[myId]);
    setMajor(c.major); setMinor(c.minor); setStory(c.story); setBosses(c.bosses); setAssist(c.assist); setLoad(c.load); setBan(c.ban);
  }, [submitted]);

  const toggle = (list, setList, max) => (id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list);
  // 主 / 副互斥：在一组里选中的盟约从另一组里摘掉；把它选成倾向时自动解除自主禁用（两者不该同时存在）。
  const toggleMajor = (id) => { setMinor((m) => m.filter((x) => x !== id)); setBan((b) => (b === id ? null : b)); toggle(major, setMajor, MAJOR_MAX)(id); };
  const toggleMinor = (id) => { setMajor((m) => m.filter((x) => x !== id)); setBan((b) => (b === id ? null : b)); toggle(minor, setMinor, MINOR_MAX)(id); };
  /** 自主禁用（单选）：再点一次同一个 = 解除；禁掉的那条同时从三组倾向里摘掉。 */
  const toggleBan = (id) => {
    setBan((b) => (b === id ? null : id));
    setMajor((m) => m.filter((x) => x !== id));
    setMinor((m) => m.filter((x) => x !== id));
    setStory((s) => (s === id ? null : s));
  };
  // 试炼首领（带候选的回合格，单选）：再点一次已选中的那一张 = 撤回（回到「默认随机」）。
  const pickTrial = (r, key) => setBosses((cur) => {
    const next = { ...(cur || {}) };
    if (next[r] === key) delete next[r]; else next[r] = key;
    return next;
  });

  // 主按钮只开确认弹窗；真正提交在 doSubmit（阶段结束前仍可改选重交）。
  const doSubmit = async () => {
    if (busy || spectating || pub?.recon?.summary) return;
    setBusy('send');
    await act('g.reconChoice', { major, minor, story, bosses, assist, load, ban }, { sfx: 'confirm' });
    setBusy(null);
    setConfirm(false);
  };
  // 队伍预重构总览上的「继续」（业主 2026-10-26）：全员点过才进入下一阶段。
  const continueNow = async () => {
    if (contBusy || spectating) return;
    setContBusy(true);
    await act('g.reconContinue', {}, { sfx: 'confirm' });
    setContBusy(false);
  };

  const total = pub ? phaseTotalSeconds(pub, gd.config, myId) : null;
  useTicker(pub?.deadline ? 500 : 0);
  const remain = pub?.deadline ? secondsLeft(pub.deadline) : null;
  // 倒计时末段（最后 10 秒）：状态行换成警示色，并把「未提交按不指定进入」说出来。
  const urgent = remain != null && remain <= 10;
  const players = sortedPlayers(pub);
  const doneCount = players.filter((p) => choices[p.playerId] !== undefined).length;
  // 本地选择的摘要（右侧 / 提交确认共用）；没有选中任何一项时提交确认里多一句提醒。
  const localRows = summaryRows({ major, minor, story, bosses, assist, load, ban }, gd, storyPool.length > 0);
  const emptyPick = !major.length && !minor.length && !story && !Object.keys(bosses).length && !assist && !load && !ban;
  // 本局信息弹窗（禁用盟约 / 禁用干员 / 特训敌人 …，与简报、策略选择屏同一份 MatchInfo）：只在打开时构建
  const info = infoOpen
    ? matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } })
    : null;
  const viewingPlayer = viewing != null ? players.find((p) => p.playerId === viewing) || null : null;
  // ---- 总览（全员交齐后）---------------------------------------------------------------
  const summaryOn = pub?.recon?.summary === true;
  const continued = Array.isArray(pub?.recon?.continued) ? pub.recon.continued : [];
  const myTeam = players.find((p) => p.playerId === myId)?.team || 1;
  const teamPlayers = players.filter((p) => (p.team || 1) === myTeam);
  const humans = players.filter((p) => !p.isBot && p.alive !== false && !p.left);
  const confirmed = humans.filter((p) => continued.includes(p.playerId)).length;
  const myConfirmed = continued.includes(myId);

  return html`<div class=${cx('screen pre-recon', summaryOn && 'is-summary')}>
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${3} of=${3} title=${t('预重构')} micro="PRE-RECON // PROTOCOL" pub=${pub} total=${total} onExit=${() => setExit(true)} />
    <main class="prc__main">
      <aside class="prc__players">
        <h3 class="brief-h"><span>${t('重构状态')}</span><${MicroLabel}>RECON STATUS<//></h3>
        ${players.map((p) => {
          const done = choices[p.playerId] !== undefined;
          const c = done ? choices[p.playerId] : null;
          return html`<div key=${p.playerId} class=${cx('prc-p', done && 'is-done', p.playerId === myId && 'is-self')}>
            <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
            <div class="prc-p__text">
              <b>${p.name || t('博士')}${p.isBot ? html`<span class="prc-p__ai">AI</span>` : null}</b>
              <span class=${done ? 't-mint' : 't-dim'}>${done ? t('已提交') : t('决策中')}</span>
              ${done ? html`<button type="button" class="prc-p__picks" title=${t('查看完整走向')} onClick=${() => setViewing(p.playerId)}>${briefOf(c, gd)}</button>` : null}
            </div>
            <span class="prc-p__box">${done ? html`<${Icon} name="check" />` : html`<${Icon} name="hourglass" />`}</span>
          </div>`;
        })}
        <p class="prc__hint t-dim">${t('全员提交后进入队伍总览（{done}/{total}）', { done: doneCount, total: players.length })}</p>
        <${Button} variant="secondary" icon="search" block=${true} class="draft-order__info" data-testid="match-info-open"
          aria-haspopup="dialog" onClick=${() => setInfoOpen(true)}>${t('查看禁用盟约与干员')}<//>
      </aside>

      <section class="prc__body">
        <div class="prc-block brackets">
          <h3 class="brief-h"><span>${t('盟约倾向')}</span><${MicroLabel} tone="ice">BOND LEANINGS<//></h3>
          <p class="prc-block__note">${t('定下本局重点经营的盟约：主盟约（核心盟约）至多 {major} 个，副盟约（附加盟约）至多 {minor} 个，故事集盟约至多 {story} 个。', { major: MAJOR_MAX, minor: MINOR_MAX, story: STORY_MAX })}${t('所选盟约会提高其干员的出现概率：主盟约合计 +{major}%、副盟约合计 +{minor}%、故事集盟约合计 +{story}%（组内平分，其余盟约相应降低）。', { major: 10, minor: 20, story: 10 })}</p>
          <${BondGroup} assets=${gd.m} title=${t('主盟约')} kind=${t('核心盟约')} micro="MAJOR // CORE" max=${MAJOR_MAX} pool=${corePool} picks=${major} onToggle=${toggleMajor} taken=${new Set(minor)} ban=${ban} onBan=${toggleBan} />
          <${BondGroup} assets=${gd.m} title=${t('副盟约')} kind=${t('附加盟约')} micro="MINOR // ADD-ON" max=${MINOR_MAX} pool=${addonPool} picks=${minor} onToggle=${toggleMinor} taken=${new Set(major)} ban=${ban} onBan=${toggleBan} />
          <${BondGroup} assets=${gd.m} title=${t('故事集盟约')} micro="SIDE STORY" max=${STORY_MAX} pool=${storyPool}
            picks=${story ? [story] : []} onToggle=${(id) => { setBan((b) => (b === id ? null : b)); setStory((s) => (s === id ? null : id)); }} taken=${new Set()} ban=${ban} onBan=${toggleBan} />
        </div>

        <div class="prc-block brackets">
          <h3 class="brief-h"><span>${t('试炼首领')}</span><${MicroLabel} tone="ice">TRIAL BOSSES<//></h3>
          <p class="prc-block__note">${t('第 {rounds} 回合将有首领加入战斗。带候选的回合可从下列候选中指定（本局座位靠前的博士首选即生效），其余回合默认随机。', { rounds: RECON_TRIAL_ROUNDS.join(' / ') })}</p>
          <div class="prc-trials">
            ${RECON_TRIAL_ROUNDS.map((r) => {
              const choices = RECON_TRIAL_BOSSES[r] || null;
              const pick = choices ? bosses[r] || null : null;
              // 带候选的回合：格子画**本局已指定的那一条候选**（没指定就是「默认随机」）；其余回合保持只读的默认随机。
              // 一条候选可能含两只（第 8 回合第 3 项）——「已选」按候选的名字串念出来。
              return html`<div key=${r} class=${cx('prc-trial', choices && 'is-pick', pick && 'is-on')} data-round=${r}>
                <span class="prc-trial__round num">R${String(r).padStart(2, '0')}</span>
                <span class=${cx('prc-trial__boss', !pick && 't-dim')}><${Icon} name=${pick ? 'key' : 'warn'} />${pick ? choiceNames(choices, pick, gd.enemy) : t('默认随机')}</span>
              </div>`;
            })}
          </div>
          ${RECON_TRIAL_ROUNDS.map((r) => {
            const choices = RECON_TRIAL_BOSSES[r];
            if (!choices) return null;
            return html`<${TrialPick} key=${r} m=${gd.m} enemy=${gd.enemy} round=${r} choices=${choices} pick=${bosses[r] || null} onPick=${(id) => pickTrial(r, id)} />`;
          })}
        </div>

        <div class="prc-block brackets">
          <h3 class="brief-h"><span>${t('重构走向')}</span><${MicroLabel} tone="ice">RECON PROTOCOL<//></h3>
          <p class="prc-block__note">${t('重构协助（全局增益）三选一，选中的一项生效；熔芯负载（全局减益）三选一，选中的一项被排除，其余两项同时生效。提交后本局生效。')}</p>
          <${OptGroup} title=${t('重构协助')} micro="ASSIST" opts=${ASSIST_OPTS} pick=${assist} onPick=${setAssist} />
          <${OptGroup} title=${t('熔芯负载')} micro="LOAD" opts=${LOAD_OPTS} pick=${load} onPick=${setLoad}
            hint=${t('选中的一项排除')} mark="close" />
        </div>
      </section>

      <aside class="prc__side brackets">
        <h3 class="brief-h"><span>${t('我的重构走向')}</span><${MicroLabel} tone="ice">SUMMARY<//></h3>
        <${Summary} rows=${localRows} />
        ${spectating
          ? html`<p class="prc__status t-lo"><${Icon} name="eye" />${t('观战中 · 不参与预重构')}</p>`
          : html`<${Button} variant="primary" size="lg" icon="check" block=${true} loading=${busy === 'send'} onClick=${() => setConfirm(true)}>
              ${submitted ? t('重新提交') : t('确认重构走向')}<//>
            ${submitted ? html`<p class="prc__status t-mint"><${Icon} name="check" />${t('已提交 · 阶段结束前可改选重交')}</p>` : null}
            ${remain != null ? html`<p class=${cx('prc__status', urgent ? 'prc__status--urgent' : 't-dim')}>
              ${urgent
                ? html`<${Icon} name="hourglass" />${t('即将结束：{s} 秒（未提交按不指定进入）', { s: remain })}`
                : t('阶段剩余 {s} 秒', { s: remain })}
            </p>` : null}`}
      </aside>
    </main>

    ${summaryOn ? html`<section class="prc-overview" aria-label=${t('队伍预重构总览')}>
      <header class="prc-overview__head">
        <h2>${t('队伍预重构总览')}</h2>
        <${MicroLabel} tone="ice">TEAM RECON OVERVIEW<//>
        <span class="prc-overview__team">${t('第 {n} 队', { n: myTeam })}</span>
      </header>
      <div class="prc-overview__cols">
        ${teamPlayers.map((p, i) => html`<${OverviewColumn} key=${p.playerId} p=${p} choice=${choices[p.playerId]} gd=${gd}
          self=${p.playerId === myId} continued=${continued.includes(p.playerId)} index=${i} />`)}
      </div>
      <footer class="prc-overview__foot">
        ${spectating
          ? html`<span class="prc-overview__wait"><${Icon} name="eye" />${t('观战中 · 等待队伍继续')}</span>`
          : html`<${Button} variant="primary" size="lg" icon="check" loading=${contBusy} disabled=${myConfirmed} onClick=${continueNow}>
              ${myConfirmed ? t('已确认 · 等待队友') : t('继续')}<//>`}
        <span class="prc-overview__count t-dim">${t('已确认 {n}/{m}', { n: confirmed, m: humans.length })}</span>
      </footer>
    </section>` : null}

    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${false} />
    <${MatchInfoDialog} open=${infoOpen} onClose=${() => setInfoOpen(false)} model=${info}
      status=${html`<span class=${cx('minfo-dlg__turn', submitted ? 'is-mint' : 'is-warn')}>
        <${Icon} name=${submitted ? 'check' : 'hourglass'} />${submitted
          ? t('已提交 · 阶段结束前可改选重交')
          : `${t('决策中')} · ${t('全员提交后进入队伍总览（{done}/{total}）', { done: doneCount, total: players.length })}`}
      </span>`} />

    <${Modal} open=${confirm} onClose=${() => setConfirm(false)} title=${t('确认重构走向')} micro="PRE-RECON // CONFIRM"
      tone="ice" width="min(92vw, 7.2rem)"
      actions=${html`<${Button} variant="ghost" onClick=${() => setConfirm(false)}>${t('返回修改')}<//>
        <${Button} variant="primary" icon="check" loading=${busy === 'send'} onClick=${doSubmit}>${t('确认提交')}<//>`}>
      <p class="prc-confirm__note">${t('提交后阶段结束前仍可改选重交；时间耗尽时未提交的选择按「不指定」进入下一阶段。')}</p>
      ${emptyPick ? html`<p class="prc-confirm__warn">${t('当前没有选中任何项：提交后本局按「不指定」处理。')}</p>` : null}
      <${Summary} rows=${localRows} />
    </${Modal}>

    <${Modal} open=${viewingPlayer != null && choices[viewingPlayer.playerId] !== undefined} onClose=${() => setViewing(null)}
      title=${t('{name} 的重构走向', { name: viewingPlayer?.name || t('博士') })} micro="RECON STATUS"
      tone="ice" width="min(92vw, 7.2rem)">
      ${viewingPlayer && choices[viewingPlayer.playerId] !== undefined
        ? html`<${Summary} rows=${summaryRows(choices[viewingPlayer.playerId], gd, storyPool.length > 0)} />`
        : null}
    </${Modal}>
  </div>`;
}
