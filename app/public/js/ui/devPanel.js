// public/js/ui/devPanel.js — 局内**开发者面板**（「全量模拟」对局专属，`m.public.dev === true`）。
//
// 为什么是核心而不是工坊包：包面板的注入面是冻结只读的（ui/extensions.js：没有 store / match 句柄），
// 而这张面板要**读**对局状态、**写**这一局（改策略 / 玩家数据 / 加干员 / 加敌人）。所以它是核心客户端，
// 只在与 `Match.dev` 的对局里被判定显示（screens/game.js），读写都走核心的 `g.dev` 指令
// （`shared/protocol.js DEV_ACTIONS` → `server/match/match/intents.js devEdit`）。
//
// 四个大分区（每区展开子分支）：
//   策略  列出全部策略（图标 + 名字），点一下就替换成它
//   敌人  列出全部敌人 → 查看/改默认数值 →「添加至怪物预览区」（下一个回合的预览与战斗一起出现）
//   玩家  改资金 / 生命 / 调度中心阶级 / 槽位 / 盟约层数 / 装备获取
//   干员  列出全部干员 → 查看/改数值 →「添加至待部署区」

import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { BandIcon, UnitThumb } from './gameComponents.js';
import { net } from '../net.js';
import { data } from '../data.js';
import { useStore } from '../store.js';
import { t, N_ } from '../../../shared/i18n.js';

const SECTIONS = [
  { id: 'band', label: N_('策略相关'), icon: 'flag' },
  { id: 'enemy', label: N_('敌人相关'), icon: 'skull' },
  { id: 'player', label: N_('玩家相关'), icon: 'user' },
  { id: 'op', label: N_('干员相关'), icon: 'users' },
  { id: 'scene', label: N_('场景相关'), icon: 'rook' },
];

/** 发送一条 dev 指令（`g.dev`）。 */
const dev = (action, fields = {}) => net.send('g.dev', { action, ...fields });

/** 一张数据表按 id 字段排好的列表（缺表 / 缺字段时给空数组）。 */
function table(name) {
  const list = data.list(name);
  return Array.isArray(list) ? list : [];
}

const numOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 搜索栏（策略 / 敌人 / 干员三页共用）：一个放大镜 + 一个输入框。 */
function SearchBox({ value, onChange }) {
  return html`<label class="devpanel__search">
    <${Icon} name="search" />
    <input class="devpanel__search-input" type="search" value=${value} placeholder=${t('搜索')}
      aria-label=${t('搜索')} onInput=${(e) => onChange(e.currentTarget.value)} />
  </label>`;
}

/** `query` 是不是这些字段里任意一个的子串（忽略大小写；空查询恒真）。 */
function matches(query, ...fields) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
}

/** 一个受控数字输入（应用于某个 action 字段）。 */
function NumRow({ label, value, onChange, hint }) {
  return html`<label class="devpanel__row">
    <span class="devpanel__lab">${label}${hint ? html`<i class="devpanel__hint">${hint}</i>` : null}</span>
    <input class="devpanel__num" type="number" value=${String(value)} onInput=${(e) => onChange(e.currentTarget.value)} />
  </label>`;
}

function SectionBand({ close }) {
  const [q, setQ] = useState('');
  const bands = table('bands').filter((b) => matches(q, b.name, b.bandId));
  return html`<div class="devpanel__col">
    <${SearchBox} value=${q} onChange=${setQ} />
    ${bands.length ? html`<div class="devpanel__grid">
      ${bands.map((b) => html`<button key=${b.bandId} type="button" class="devpanel__cell" title=${b.name || b.bandId}
          onClick=${() => { dev('band', { bandId: b.bandId }); close(); }}>
        <${BandIcon} bandId=${b.bandId} size="sm" /><span>${b.name || b.bandId}</span>
      </button>`)}
    </div>` : html`<p class="devpanel__tip">${t('没有匹配的项')}</p>`}
  </div>`;
}

function SectionPlayer() {
  const [funds, setFunds] = useState('100');
  const [lp, setLp] = useState('1');
  const [level, setLevel] = useState('1');
  const [chessSlots, setChessSlots] = useState('0');
  const [itemSlots, setItemSlots] = useState('0');
  const [bondId, setBondId] = useState('');
  const [layers, setLayers] = useState('10');
  const [itemId, setItemId] = useState('');
  const bonds = table('bonds');
  const items = table('items');
  const bond = bondId || (bonds[0] && bonds[0].bondId) || '';
  const item = itemId || (items[0] && items[0].id) || '';
  return html`<div class="devpanel__form">
    <div class="devpanel__group">
      <${NumRow} label=${t('资金 +N')} value=${funds} onChange=${setFunds} />
      <button type="button" class="devpanel__go" onClick=${() => dev('funds', { funds: Math.trunc(numOf(+funds)) })}>${t('应用')}</button>
    </div>
    <div class="devpanel__group">
      <${NumRow} label=${t('生命值')} value=${lp} onChange=${setLp} />
      <button type="button" class="devpanel__go" onClick=${() => dev('lp', { lp: Math.trunc(numOf(+lp)) })}>${t('应用')}</button>
    </div>
    <div class="devpanel__group">
      <${NumRow} label=${t('调度中心阶级')} value=${level} onChange=${setLevel} />
      <button type="button" class="devpanel__go" onClick=${() => dev('shopLevel', { shopLevel: Math.trunc(numOf(+level)) })}>${t('应用')}</button>
    </div>
    <div class="devpanel__group">
      <${NumRow} label=${t('干员槽位')} value=${chessSlots} onChange=${setChessSlots} />
      <${NumRow} label=${t('装备槽位')} value=${itemSlots} onChange=${setItemSlots} />
      <button type="button" class="devpanel__go" onClick=${() => dev('shopSlots', { chessSlots: Math.trunc(numOf(+chessSlots)), itemSlots: Math.trunc(numOf(+itemSlots)) })}>${t('应用')}</button>
    </div>
    <div class="devpanel__group">
      <label class="devpanel__row"><span class="devpanel__lab">${t('盟约')}</span>
        <select class="devpanel__sel" value=${bond} onChange=${(e) => setBondId(e.currentTarget.value)}>
          ${bonds.map((b) => html`<option key=${b.bondId} value=${b.bondId}>${b.name || b.bondId}</option>`)}
        </select>
      </label>
      <${NumRow} label=${t('层数 +N')} value=${layers} onChange=${setLayers} />
      <button type="button" class="devpanel__go" disabled=${!bond} onClick=${() => dev('layers', { bondId: bond, layers: Math.trunc(numOf(+layers)) })}>${t('应用')}</button>
    </div>
    <div class="devpanel__group">
      <label class="devpanel__row"><span class="devpanel__lab">${t('装备获取')}</span>
        <select class="devpanel__sel" value=${item} onChange=${(e) => setItemId(e.currentTarget.value)}>
          ${items.map((it) => html`<option key=${it.id} value=${it.id}>${it.name || it.id}</option>`)}
        </select>
      </label>
      <button type="button" class="devpanel__go" disabled=${!item} onClick=${() => dev('item', { itemId: item })}>${t('应用')}</button>
    </div>
  </div>`;
}

function SectionEnemy() {
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState('');
  const [count, setCount] = useState('1');
  const [hp, setHp] = useState('');
  const [atk, setAtk] = useState('');
  const [def, setDef] = useState('');
  const [res, setRes] = useState('');
  const enemies = table('enemies').slice().sort((a, b) => String(a.key).localeCompare(String(b.key)))
    .filter((e) => matches(q, e.name, e.key));
  const rec = pick ? data.lookup('enemies', pick) : null;
  const stat = (k) => (rec && rec.stats && Number.isFinite(rec.stats[k]) ? String(rec.stats[k]) : '');
  const overrides = () => {
    const stats = {};
    if (hp !== '' && Number.isFinite(+hp)) stats.maxHp = +hp;
    if (atk !== '' && Number.isFinite(+atk)) stats.atk = +atk;
    if (def !== '' && Number.isFinite(+def)) stats.def = +def;
    if (res !== '' && Number.isFinite(+res)) stats.res = +res;
    return Object.keys(stats).length ? { stats } : null;
  };
  return html`<div class="devpanel__col">
    <${SearchBox} value=${q} onChange=${setQ} />
    ${enemies.length ? html`<div class="devpanel__grid">
      ${enemies.map((e) => html`<button key=${e.key} type="button" class=${`devpanel__cell${pick === e.key ? ' is-on' : ''}`}
          title=${e.name || e.key} onClick=${() => { setPick(e.key); setHp(stat('maxHp')); setAtk(stat('atk')); setDef(stat('def')); setRes(stat('res')); }}>
        <${UnitThumb} kind="enemy" id=${e.key} size="sm" /><span>${e.name || e.key}</span>
      </button>`)}
    </div>` : html`<p class="devpanel__tip">${t('没有匹配的项')}</p>`}
    ${rec ? html`<div class="devpanel__detail">
      <div class="devpanel__detail-head"><b>${rec.name || pick}</b><button type="button" class="devpanel__close" onClick=${() => setPick(null)} aria-label=${t('收起')}><${Icon} name="close" /></button></div>
      <span class="devpanel__id">${pick}</span>
      <div class="devpanel__form">
        <${NumRow} label=${t('最大生命值')} value=${hp} onChange=${setHp} />
        <${NumRow} label=${t('攻击力')} value=${atk} onChange=${setAtk} />
        <${NumRow} label=${t('防御力')} value=${def} onChange=${setDef} />
        <${NumRow} label=${t('法术抗性')} value=${res} onChange=${setRes} />
        <${NumRow} label=${t('数量')} value=${count} onChange=${setCount} />
      </div>
      <button type="button" class="devpanel__go devpanel__go--wide"
        onClick=${() => dev('spawnEnemy', { enemyKey: pick, count: Math.max(1, Math.trunc(numOf(+count))), ...(overrides() ? { overrides: overrides() } : {}) })}>
        ${t('添加至怪物预览区')}
      </button>
    </div>` : html`<p class="devpanel__tip">${t('选一个敌人查看 / 修改它的默认数值')}</p>`}
  </div>`;
}

function SectionOp() {
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState('');
  const [atk, setAtk] = useState('');
  const [def, setDef] = useState('');
  const [hp, setHp] = useState('');
  const [aspd, setAspd] = useState('');
  const [res, setRes] = useState('');
  const [bat, setBat] = useState('');
  const [block, setBlock] = useState('');
  const chess = table('chess').filter((c) => !c.isGolden).sort((a, b) => (a.tier | 0) - (b.tier | 0) || String(a.chessId).localeCompare(String(b.chessId)))
    .filter((c) => matches(q, c.name, c.chessId, c.charId));
  const rec = pick ? data.lookup('chess', pick) : null;
  const overrides = () => {
    const o = {};
    const put = (k, v) => { if (v !== '' && Number.isFinite(+v) && +v !== 0) o[k] = +v; };
    put('atk', atk); put('def', def); put('hp', hp); put('aspd', aspd); put('res', res); put('bat', bat); put('blockCnt', block);
    return Object.keys(o).length ? o : null;
  };
  return html`<div class="devpanel__col">
    <${SearchBox} value=${q} onChange=${setQ} />
    ${chess.length ? html`<div class="devpanel__grid devpanel__grid--op">
      ${chess.map((c) => html`<button key=${c.chessId} type="button" class=${`devpanel__cell${pick === c.chessId ? ' is-on' : ''}`}
          title=${c.name || c.chessId} onClick=${() => setPick(c.chessId)}>
        <${UnitThumb} kind="chess" id=${c.chessId} size="sm" /><span>${c.name || c.chessId}</span>
      </button>`)}
    </div>` : html`<p class="devpanel__tip">${t('没有匹配的项')}</p>`}
    ${rec ? html`<div class="devpanel__detail">
      <div class="devpanel__detail-head"><b>${rec.name || pick}</b><button type="button" class="devpanel__close" onClick=${() => setPick(null)} aria-label=${t('收起')}><${Icon} name="close" /></button></div>
      <span class="devpanel__id">${pick}</span>
      <p class="devpanel__tip">${t('比例：0.5 = +50%；点数：直接加减')}</p>
      <div class="devpanel__form">
        <${NumRow} label=${t('攻击力')} hint=${t('比例')} value=${atk} onChange=${setAtk} />
        <${NumRow} label=${t('防御力')} hint=${t('比例')} value=${def} onChange=${setDef} />
        <${NumRow} label=${t('生命上限')} hint=${t('比例')} value=${hp} onChange=${setHp} />
        <${NumRow} label=${t('攻击速度')} hint=${t('点数')} value=${aspd} onChange=${setAspd} />
        <${NumRow} label=${t('法术抗性')} hint=${t('点数')} value=${res} onChange=${setRes} />
        <${NumRow} label=${t('攻击间隔')} hint=${t('比例')} value=${bat} onChange=${setBat} />
        <${NumRow} label=${t('阻挡数')} hint=${t('点数')} value=${block} onChange=${setBlock} />
      </div>
      <button type="button" class="devpanel__go devpanel__go--wide"
        onClick=${() => dev('grantChess', { chessId: pick, ...(overrides() ? { overrides: overrides() } : {}) })}>
        ${t('添加至待部署区')}
      </button>
    </div>` : html`<p class="devpanel__tip">${t('选一个干员查看 / 修改它的数值')}</p>`}
  </div>`;
}

/** 场景相关：换地图（立刻生效）+ 下一回合打普通还是首领 + 替换首领场景正中的首领（可改它的数值）。 */
function SectionScene({ cur, armed, bossCur }) {
  const [stagePick, setStagePick] = useState(null);
  const [pick, setPick] = useState(null);
  const [hp, setHp] = useState('');
  const [atk, setAtk] = useState('');
  const [def, setDef] = useState('');
  const [res, setRes] = useState('');
  const stages = table('stages').slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const bosses = table('bosses').slice().sort((a, b) => String(a.bossId).localeCompare(String(b.bossId)));
  const rec = pick ? data.lookup('bosses', pick) : null;
  // 默认值：这只首领对应的**敌人记录**（领袖单位的数据），像「敌人相关」那样填进输入框
  const enemy = rec && rec.enemyKey ? data.lookup('enemies', rec.enemyKey) : null;
  const stat = (k) => (enemy && enemy.stats && Number.isFinite(enemy.stats[k]) ? String(enemy.stats[k]) : '');
  const overrides = () => {
    const stats = {};
    if (hp !== '' && Number.isFinite(+hp)) stats.maxHp = +hp;
    if (atk !== '' && Number.isFinite(+atk)) stats.atk = +atk;
    if (def !== '' && Number.isFinite(+def)) stats.def = +def;
    if (res !== '' && Number.isFinite(+res)) stats.res = +res;
    return Object.keys(stats).length ? { stats } : null;
  };
  return html`<div class="devpanel__col">
    <p class="devpanel__tip">${t('当前地图')}：${cur || '—'}</p>
    <div class="devpanel__grid">
      ${stages.map((s) => {
        const on = stagePick === s.id || (!stagePick && cur === s.id);
        return html`<button key=${s.id} type="button" class=${`devpanel__cell${on ? ' is-on' : ''}`} title=${s.name || s.id}
            onClick=${() => { setStagePick(s.id); dev('stage', { stageId: s.id }); }}>
          <span>${s.name || s.id}</span>
        </button>`;
      })}
    </div>
    <p class="devpanel__tip">${t('对战类型（下一回合生效）')}</p>
    <div class="devpanel__group">
      <button type="button" class=${`devpanel__go${armed === 'normal' ? ' is-on' : ''}`} onClick=${() => dev('roundKind', { kind: 'normal' })}>${t('普通对战')}</button>
      <button type="button" class=${`devpanel__go${armed === 'boss' ? ' is-on' : ''}`} onClick=${() => dev('roundKind', { kind: 'boss' })}>${t('首领对战')}</button>
    </div>
    ${armed ? html`<p class="devpanel__armed">${t('已武装，下一回合生效')}</p>` : null}
    <p class="devpanel__tip">${t('首领')}：${bossCur || '—'}</p>
    <div class="devpanel__grid">
      ${bosses.map((b) => html`<button key=${b.bossId} type="button" class=${`devpanel__cell${(pick || bossCur) === b.bossId ? ' is-on' : ''}`}
          title=${b.name || b.bossId} onClick=${() => { setPick(b.bossId); setHp(stat('maxHp')); setAtk(stat('atk')); setDef(stat('def')); setRes(stat('res')); }}>
        <${UnitThumb} kind="enemy" id=${b.enemyKey} size="sm" /><span>${b.name || b.bossId}</span>
      </button>`)}
    </div>
    ${rec ? html`<div class="devpanel__detail">
      <div class="devpanel__detail-head"><b>${rec.name || pick}</b><button type="button" class="devpanel__close" onClick=${() => setPick(null)} aria-label=${t('收起')}><${Icon} name="close" /></button></div>
      <span class="devpanel__id">${pick}</span>
      <p class="devpanel__tip">${t('首领血量池：留空 = 官方值')}</p>
      <div class="devpanel__form">
        <${NumRow} label=${t('最大生命值')} value=${hp} onChange=${setHp} />
        <${NumRow} label=${t('攻击力')} value=${atk} onChange=${setAtk} />
        <${NumRow} label=${t('防御力')} value=${def} onChange=${setDef} />
        <${NumRow} label=${t('法术抗性')} value=${res} onChange=${setRes} />
      </div>
      <button type="button" class="devpanel__go devpanel__go--wide"
        onClick=${() => dev('boss', { bossId: pick, ...(overrides() ? { overrides: overrides() } : {}) })}>
        ${t('替换首领')}
      </button>
    </div>` : html`<p class="devpanel__tip">${t('选一个首领查看 / 修改它的数值')}</p>`}
  </div>`;
}

/** 局内开发者面板：收起态是一个左侧把手，点开占左栏。 */
export function DevPanel() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('band');
  const dev = useStore((s) => !!s.match.public?.dev);
  const curStage = useStore((s) => s.match.public?.stageId || null);
  const armedKind = useStore((s) => s.match.public?.devNextKind || null);
  const bossCur = useStore((s) => s.match.public?.bossId || null);
  if (!dev) return null;
  if (!open) {
    return html`<button type="button" class="devpanel__handle" onClick=${() => setOpen(true)} title=${t('开发者面板')} aria-label=${t('开发者面板')}>
      <${Icon} name="gear" /><span>${t('开发者面板')}</span>
    </button>`;
  }
  const close = () => setOpen(false);
  return html`<aside class="devpanel" role="complementary" aria-label=${t('开发者面板')}>
    <header class="devpanel__head">
      <b>${t('开发者面板')}</b>
      <button type="button" class="devpanel__close" onClick=${close} aria-label=${t('收起')}><${Icon} name="chevronLeft" /></button>
    </header>
    <nav class="devpanel__tabs">
      ${SECTIONS.map((s) => html`<button key=${s.id} type="button" class=${`devpanel__tab${section === s.id ? ' is-on' : ''}`}
          onClick=${() => setSection(s.id)}><${Icon} name=${s.icon} />${t(s.label)}</button>`)}
    </nav>
    <div class="devpanel__body">
      ${section === 'band' ? html`<${SectionBand} close=${close} />` : null}
      ${section === 'enemy' ? html`<${SectionEnemy} />` : null}
      ${section === 'player' ? html`<${SectionPlayer} />` : null}
      ${section === 'op' ? html`<${SectionOp} />` : null}
      ${section === 'scene' ? html`<${SectionScene} cur=${curStage} armed=${armedKind} bossCur=${bossCur} />` : null}
    </div>
  </aside>`;
}

export default DevPanel;
