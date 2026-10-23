// Pre-recon — PHASE.PRE_RECON 「预重构」（模式扩展-重构模拟，第一轮骨架）：策略选择之后、协议启动之前，
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
//   3. 重构走向 —— 重构协助（全局增益）与熔芯负载（全局减益）各选 1。**选项表同样占位**（ASSIST_OPTS /
//      LOAD_OPTS 是接口占位：id 会随 g.reconChoice 提交并留在服务器 reconChoices 里，机制轮按 id 生效）。
//
// 提交：g.reconChoice（shared/protocol.js —— 全字段可选、逐键覆盖合并），已提交后可改选重交直到阶段结束。
// 观战席没有选择（pub.recon.choices 里不会有它的键）：整屏只读。
// 盟约选项的画法与简报的盟约行同一套（ui/matchInfo.js 的 MatchBondRow：圆盘 + 图标 + 名称，见 图4），
// 所以这里的池与那两块读的是同一份数据、同一个 `bondIconUrl`。
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, BondDisc, Icon, MicroLabel, useTicker, secondsLeft } from '../ui/components.js';
import { useGameData, PlayerAvatar, Img } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { act } from '../ui/gameActions.js';
import { bondIconUrl, enemyIconUrl } from '../ui/assetUrls.js';
import { phaseTotalSeconds, sortedPlayers } from '../ui/gameLogic.js';
import { useStore, isSpectating } from '../store.js';
import { RECON_TRIAL_ROUNDS, RECON_TRIAL_BOSSES, RECON_BOND_ID } from '../../../shared/reconModes.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * 重构协助的选项表（全局增益，单选一项）。`id` 就是接口：`g.reconChoice.assist` 交上去、留在服务器 reconChoices 里，
 * 机制轮的实现按这些 id 生效；本轮的界面只负责把它们念出来（效果数值与文案由业主给定，逐字照抄）。
 */
const ASSIST_OPTS = Object.freeze([
  { id: 'recon_assist_bond', name: N_('盟约重构'), desc: N_('<修整期结束时>已激活层数最高的核心盟约、附加盟约、故事集盟约各+10层。') },
  { id: 'recon_assist_equip', name: N_('装备重构'), desc: N_('每回合前3次销毁装备时，获得1件不低于销毁装备阶级的随机装备，干员的装备可进行拆卸。') },
  { id: 'recon_assist_data', name: N_('数据重构'), desc: N_('场上干员的基础攻击力、基础防御力、基础生命上限提升各+25%，法术抗性+25点。') },
]);
/**
 * 熔芯负载的选项表（全局减益，单选一项）：与 ASSIST_OPTS 同一条纪律 —— id 即接口，文案逐字照抄业主给的数值。
 */
const LOAD_OPTS = Object.freeze([
  { id: 'recon_load_bond', name: N_('盟约负载'), desc: N_('已激活层数最高的核心盟约、附加盟约、故事集盟约每层使敌人的生命上限提高0.1%。') },
  { id: 'recon_load_equip', name: N_('装备负载'), desc: N_('干员未携带装备时的伤害下降25%，携带的装备阶级高于自身时使该装备的效果-50%并在3回合后自动销毁。（源石辅助仪、变形同构体不受自动销毁影响）') },
  { id: 'recon_load_data', name: N_('数据负载'), desc: N_('敌人的基础攻击力、基础防御力、基础生命上限各+25%，法术抗性+25点。') },
]);

const MAJOR_MAX = 2;
const MINOR_MAX = 3;
const STORY_MAX = 1;

/** 一名博士已交的选择（pub.recon.choices[pid]），容错成 { major, minor, story, bosses, assist, load }。 */
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
  };
}

const STORY_BOND_TYPE = 'SIDE_STORY';

/** 盟约倾向的一组（主 / 副 / 故事集）：圆盘瓦片（简报的盟约行同一套画法），点到上限后未选的置灰。 */
function BondGroup({ assets, title, kind, micro, max, pool, picks, onToggle, taken }) {
  if (!pool.length) return null;
  const full = picks.length >= max;
  return html`<div class="prc-bonds__group">
    <div class="prc-bonds__ghead"><${MicroLabel} tone="ice">${micro}<//><span>${title}${kind ? html`<small class="prc-bonds__kind">${kind}</small>` : null}</span><b class="num">${picks.length}/${max}</b></div>
    <div class="prc-bonds__row" role="group" aria-label=${title}>
      ${pool.map((b) => {
        const on = picks.includes(b.bondId);
        // 到上限 / 已被另一组选走的，不再点得动（不画 BondDisc 的 ✕ 徽标 —— 那不是「本局禁用」，只是「这一格满了」）。
        const locked = !on && (full || taken.has(b.bondId));
        return html`<div key=${b.bondId} class=${cx('prc-bond', on && 'is-on', locked && 'is-locked')} data-bond=${b.bondId}
          title=${b.name}>
          <${BondDisc} name=${b.name} icon=${bondIconUrl(assets, b.bondId)} active=${on}
            tier=${on ? Math.max(1, b.thresholds?.length || 1) : 0} maxTier=${Math.max(1, b.thresholds?.length || 1)}
            size="md" showName=${true} onClick=${locked ? undefined : () => onToggle(b.bondId)} />
        </div>`;
      })}
    </div>
  </div>`;
}

/** 占位选项的一组（重构协助 / 熔芯负载）：单选卡。 */
function OptGroup({ title, micro, opts, pick, onPick }) {
  return html`<div class="prc-opts__group">
    <div class="prc-opts__ghead"><${MicroLabel} tone="ice">${micro}<//><span>${title}</span></div>
    <div class="prc-opts__list" role="radiogroup" aria-label=${title}>
      ${opts.map((o) => html`<button key=${o.id} type="button" role="radio" aria-checked=${pick === o.id ? 'true' : 'false'}
        class=${cx('prc-opt', pick === o.id && 'is-on')} onClick=${() => onPick(o.id)}>
        <b class="prc-opt__name">${t(o.name)}</b>
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

export function PreReconScreen() {
  const pub = useStore((s) => s.match.public);
  const myId = useStore((s) => s.me.playerId);
  const room = useStore((s) => s.room);
  const gd = useGameData();
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);

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
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !submitted) return;
    filled.current = true;
    const c = normalizeChoice(choices[myId]);
    setMajor(c.major); setMinor(c.minor); setStory(c.story); setBosses(c.bosses); setAssist(c.assist); setLoad(c.load);
  }, [submitted]);

  const toggle = (list, setList, max) => (id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list);
  // 主 / 副互斥：在一组里选中的盟约从另一组里摘掉。
  const toggleMajor = (id) => { setMinor((m) => m.filter((x) => x !== id)); toggle(major, setMajor, MAJOR_MAX)(id); };
  const toggleMinor = (id) => { setMajor((m) => m.filter((x) => x !== id)); toggle(minor, setMinor, MINOR_MAX)(id); };
  // 试炼首领（带候选的回合格，单选）：再点一次已选中的那一张 = 撤回（回到「默认随机」）。
  const pickTrial = (r, key) => setBosses((cur) => {
    const next = { ...(cur || {}) };
    if (next[r] === key) delete next[r]; else next[r] = key;
    return next;
  });

  const submit = async () => {
    if (busy || spectating) return;
    setBusy('send');
    await act('g.reconChoice', { major, minor, story, bosses, assist, load }, { sfx: 'confirm' });
    setBusy(null);
  };

  const total = pub ? phaseTotalSeconds(pub, gd.config, myId) : null;
  useTicker(pub?.deadline ? 500 : 0);
  const remain = pub?.deadline ? secondsLeft(pub.deadline) : null;
  const players = sortedPlayers(pub);
  const doneCount = players.filter((p) => choices[p.playerId] !== undefined).length;

  return html`<div class="screen pre-recon">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${3} of=${3} title=${t('预重构')} micro="PRE-RECON // PROTOCOL" pub=${pub} total=${total} onExit=${() => setExit(true)} />
    <main class="prc__main">
      <aside class="prc__players">
        <h3 class="brief-h"><span>${t('重构状态')}</span><${MicroLabel}>RECON STATUS<//></h3>
        ${players.map((p) => {
          const done = choices[p.playerId] !== undefined;
          return html`<div key=${p.playerId} class=${cx('prc-p', done && 'is-done', p.playerId === myId && 'is-self')}>
            <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
            <div class="prc-p__text">
              <b>${p.name || t('博士')}${p.isBot ? html`<span class="prc-p__ai">AI</span>` : null}</b>
              <span class=${done ? 't-mint' : 't-dim'}>${done ? t('已提交') : t('决策中')}</span>
            </div>
            <span class="prc-p__box">${done ? html`<${Icon} name="check" />` : html`<${Icon} name="hourglass" />`}</span>
          </div>`;
        })}
        <p class="prc__hint t-dim">${t('全员提交后提前进入下一阶段（{done}/{total}）', { done: doneCount, total: players.length })}</p>
      </aside>

      <section class="prc__body">
        <div class="prc-block brackets">
          <h3 class="brief-h"><span>${t('盟约倾向')}</span><${MicroLabel} tone="ice">BOND LEANINGS<//></h3>
          <p class="prc-block__note">${t('定下本局重点经营的盟约：主盟约（核心盟约）至多 {major} 个，副盟约（附加盟约）至多 {minor} 个，故事集盟约至多 {story} 个。', { major: MAJOR_MAX, minor: MINOR_MAX, story: STORY_MAX })}</p>
          <${BondGroup} assets=${gd.m} title=${t('主盟约')} kind=${t('核心盟约')} micro="MAJOR // CORE" max=${MAJOR_MAX} pool=${corePool} picks=${major} onToggle=${toggleMajor} taken=${new Set(minor)} />
          <${BondGroup} assets=${gd.m} title=${t('副盟约')} kind=${t('附加盟约')} micro="MINOR // ADD-ON" max=${MINOR_MAX} pool=${addonPool} picks=${minor} onToggle=${toggleMinor} taken=${new Set(major)} />
          <${BondGroup} assets=${gd.m} title=${t('故事集盟约')} micro="SIDE STORY" max=${STORY_MAX} pool=${storyPool}
            picks=${story ? [story] : []} onToggle=${(id) => setStory((s) => (s === id ? null : id))} taken=${new Set()} />
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
          <p class="prc-block__note">${t('重构协助（全局增益）与熔芯负载（全局减益）各选一项。选项已成表，效果的实例化将在后续版本生效。')}</p>
          <${OptGroup} title=${t('重构协助')} micro="ASSIST" opts=${ASSIST_OPTS} pick=${assist} onPick=${setAssist} />
          <${OptGroup} title=${t('熔芯负载')} micro="LOAD" opts=${LOAD_OPTS} pick=${load} onPick=${setLoad} />
        </div>
      </section>

      <aside class="prc__side brackets">
        <h3 class="brief-h"><span>${t('我的重构走向')}</span><${MicroLabel} tone="ice">SUMMARY<//></h3>
        <dl class="prc-sum">
          <dt>${t('主盟约')}<//><dd>${major.length ? major.map((id) => gd.bond(id)?.name || id).join(t('、')) : t('未选择')}</dd>
          <dt>${t('副盟约')}<//><dd>${minor.length ? minor.map((id) => gd.bond(id)?.name || id).join(t('、')) : t('未选择')}</dd>
          ${storyPool.length ? html`<dt>${t('故事集盟约')}<//><dd>${story ? gd.bond(story)?.name || story : t('未选择')}</dd>` : null}
          <dt>${t('试炼首领')}<//><dd>${(() => {
            const labels = RECON_TRIAL_ROUNDS.filter((r) => typeof bosses[r] === 'string' && bosses[r])
              .map((r) => choiceNames(RECON_TRIAL_BOSSES[r], bosses[r], gd.enemy));
            return labels.length ? labels.join(t('、')) : t('默认随机');
          })()}</dd>
          <dt>${t('重构协助')}<//><dd>${assist ? t(ASSIST_OPTS.find((o) => o.id === assist)?.name || '') : t('未选择')}</dd>
          <dt>${t('熔芯负载')}<//><dd>${load ? t(LOAD_OPTS.find((o) => o.id === load)?.name || '') : t('未选择')}</dd>
        </dl>
        ${spectating
          ? html`<p class="prc__status t-lo"><${Icon} name="eye" />${t('观战中 · 不参与预重构')}</p>`
          : html`<${Button} variant="primary" size="lg" icon="check" block=${true} loading=${busy === 'send'} onClick=${submit}>
              ${submitted ? t('重新提交') : t('确认重构走向')}<//>
            ${submitted ? html`<p class="prc__status t-mint"><${Icon} name="check" />${t('已提交 · 阶段结束前可改选重交')}</p>` : null}
            ${remain != null ? html`<p class="prc__status t-dim">${t('阶段剩余 {s} 秒', { s: remain })}</p>` : null}`}
      </aside>
    </main>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${false} />
  </div>`;
}
