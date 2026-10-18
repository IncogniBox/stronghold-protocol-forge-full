// 模组管理 —— 工坊包 mod-manager 的客户端改写模块（`pack.json.client.panels[].wraps`）。
//
// 一个模块三条链，`ctx.component` 说明这一帧自己是哪一条：
//   * `lobby.modManager` —— 大厅**顶栏工具栏**（`screens/lobby.js` 的 `.topbar__tools`：设置 / 说明 / 背景 /
//     全屏 / 安装那一排）里的一块方图标按钮（业主 2026-10-14：从右栏搬过来，与顶栏邻居同尺寸），
//     点开是「一行一个模组、右边一个开关」的浮层。**这里能改**。
//   * `lobby.modPicker`  —— 大厅创建框里那张旧的「本房间使用的模组」列表。本包把它**收走**：返回的树里不放
//     `orig`，于是那张列表不再出现在创建框里（它的内容已经搬进上面的浮层）。
//   * `room.modManager`  —— 房间顶栏「玩法说明」右边那块位置。**只读**：集合在 `room.create` 那一刻就定死了
//     （协议里没有局内改集合的消息），所以这里只列出「这一局真正跑哪几个包」，不给开关。
//
// **状态不在包里**：`available`（服务器声明了哪些包）/ `selected`（本房间点名了哪些）/ `onSet`（那一份点名的
// 唯一写入口，`roomMods.js`；收的是「要点名的那些包」的完整清单）全都是引擎这一帧交给链的 props。包只画，
// 不改对局、不碰 store —— 与面板那条「没有 store」的边界逐字相同（docs/design/mod-layer.md §28.19）。
//
// 三条口径来自引擎（`screens/lobby.js` 的 ModPicker / ModManagerSlot 注释）：
//   * **空 `selected` = 全选**：「本房间没声明集合」与「声明了全部」在服务端是同一件事，所以开关默认全开；
//     要点名一个子集就先把它展开（`expanded()`），于是每一次点击都是它字面上的意思。子集真的会被
//     `server/roomAssets.js` 逐包实体化 —— 关掉的那一个这一局就不载入。
//   * **不列出自己**：关掉本包就是把这套界面一起关掉（`ctx.pack` 就是自己），所以它只参与状态判定、不进清单。
//   * **「全部停用」**（标题行右上那个总开关）= `onSet([selfId])`：只点名自己一个包，这一局于是只物化管理器
//     那份（它不贡献任何数据），其余模组一律不生效。它与「把下面每一个都关掉」是同一个状态，默认关闭。
//   * **一行写的是模组的中文名**（该包 `pack.json` 的 `name`），不是包 id：名字由服务器发布在
//     `GET /mods/catalog.json`，取不到才回落包 id（见下面的 `usePackNames`）；包 id 留在这一行的 `title` 里。
//   * **四格不列出**（业主 2026-10-18）：`dev-ext` / `skin-picker` / `skin-supplement` / `operator-conflict`
//     与「管理器自己不列出自己」同一条口径 —— 关掉它们等于把那份功能一起关掉，所以它们**不占清单里的一行**，
//     只参与状态判定与整份写入（永远写进「本房点名的清单」，连「全部停用」也关不掉）。判据是**包 id**，
//     不是显示名：名字由包自己声明，改个名字不该把锁解掉。
//
// 浮层的开合是本模块自己的视图状态，用 Preact 的 `useState` 放在一个**本地组件**里：改写链每帧都会重新求值，
// 挂在链上的组件实例由 Preact 按「同一位置同一类型」复用，所以开合状态活得比一帧长；而勾选一变，引擎那边
// （`store.roomMods.selected`）就会重画大厅，链跟着重算，开关与计数自动跟上。

import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';

/**
 * htm 会把**全静态**子树的 vnode 缓存进模板对象里，而 Preact 挂载时会把 DOM 节点与父链写进那个共享 vnode ——
 * 屏幕卸载之后模块级缓存还指着旧 DOM。`this[0] = 3` 是 htm 的 opt-out（与引擎 `components.js` 的 `hFresh` 同一条）。
 */
const hFresh = function (type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
};
const html = htm.bind(hFresh);

const CLS = 'mm';
/** 数据层/逻辑层/客户端（引擎 `screens/lobby.js LAYER_TEXT` 的同一张表：改写拿不到引擎的 t()，这里照抄一份）。 */
const LAYER_TEXT = { A: '数据', B: '逻辑', C: '客户端' };
const layerText = (layer) => LAYER_TEXT[layer] || String(layer || '');

/**
 * **不进清单的那几格**（包 id）。它们与「管理器自己不列出自己」同一条口径：关掉它们等于把那份功能一起关掉，
 * 所以它们不占清单里的一行 —— 只参与状态判定与整份写入：`expanded()` 永远把它们写进「本房点名的清单」，
 * `flipAll`（全部停用）也带上它们。
 *
 * 判据是**包 id**而不是显示名：显示名是包自己声明的（`pack.json` 的 `name`），改个名字不该把锁解掉。
 * 服务器上没有那个包时（不在 `available` 里）它自然不出现，也不会被写进清单 —— 点名一个服务器没有的包会被
 * 服务端判 `MOD_UNKNOWN`。
 */
const LOCKED = Object.freeze(['dev-ext', 'skin-picker', 'skin-supplement', 'operator-conflict']);
const isLocked = (id) => LOCKED.includes(id);

/**
 * 模组的**显示名**。这个名字**不抄第二份对照表**：服务器已经把它发布在 `GET /mods/catalog.json`
 * （`server/modCatalog.js loadOnePack` 的 `name` —— 就是该包 `pack.json` 的 `name`，作者没写才回落包 id），
 * 所以新包一进服务器就带着自己的名字，这个界面不用跟着改一行。
 *
 * 一页只取一次；失败**不记住**（下一次渲染再试），取不到就回落包 id —— 界面永远有字可写。
 * 为什么不直接用引擎 `public/js/mods/align.js` 的 `loadCatalog`：那条链会把 OPFS 存储模块（`mods/store.js`）
 * 一并拉进大厅的模块图，而这里只要几个名字。同一个 URL、同一份数据，只是不背它的依赖。
 */
const NAMES_URL = '/mods/catalog.json';
let packNames = new Map();
let namesLoading = false;
const nameWatchers = new Set();
function ensureNames() {
  if (namesLoading) return;
  namesLoading = true;
  globalThis.fetch(NAMES_URL, { cache: 'no-cache' })
    .then((res) => (res && res.ok ? res.json() : null))
    .then((body) => {
      const list = body && Array.isArray(body.packs) ? body.packs : [];
      packNames = new Map(list
        .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name)
        .map((p) => [p.id, p.name]));
      namesLoading = false;
      for (const fn of [...nameWatchers]) fn(); // 名字到了 → 让正在显示的那几份清单重画一次
    })
    .catch(() => { namesLoading = false; });
}
/**
 * 订阅「名字到了」。返回值是当前这张 `id → name` 表：还没取到就是空表，调用方用 `|| m.id` 回落成包 id。
 * @returns {Map<string, string>}
 */
function usePackNames() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    nameWatchers.add(fn);
    ensureNames();
    return () => { nameWatchers.delete(fn); };
  }, []);
  return packNames;
}

/**
 * 浮层本体。`available` / `selected` / `onSet` 每次渲染都是引擎刚给的那一份（只读快照，直接当 props 用）。
 *
 * `available` 是**服务器声明的全部包**（含本包自己）：它同时是「展开全开」的底稿，所以不能先把本包滤掉。
 * `selfId` 只用来做两件事：把自己那一行从**显示**里去掉，以及表达「全部停用」（= 只点名自己一个包）。
 * @param {{ available?: Array<{ id: string, layer?: string, combat?: boolean }>, selected?: string[],
 *   onSet?: (ids: string[]) => void, selfId?: string }} props
 */
function Manager({ available = [], selected = [], onSet, selfId }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const names = usePackNames();
  /** 这一行的显示名：目录里有就用它，没有就用包 id。 */
  const nameOf = (id) => names.get(id) || id;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 服务器一个包都没声明时整块控件缺席（不是空态）—— 与引擎那张列表同一条规矩。
  if (!available.length) return null;

  // 自己与「不进清单的那几格」同一条口径：关掉它们等于把这份界面 / 那份功能一起关掉，所以它们只参与状态
  // 判定与整份写入，不占清单里的一行。
  const rows = available.filter((m) => m && m.id !== selfId && !isLocked(m.id));
  /** 这一台服务器上**真的存在**、且恒为开的那几格：写「本房点名的清单」时永远带上它们。 */
  const lockedIds = available.filter((m) => m && isLocked(m.id)).map((m) => m.id);
  /** 空 `selected` = 全选（本房间「没声明集合」与「声明了全部」在服务端是同一件事）。 */
  const isOn = (id) => (selected.length ? selected.includes(id) : true);
  /** 「本房要点名的包」的当前展开：空清单（= 不声明集合 = 全开）先展开成显式清单，之后才谈得上改哪一个。 */
  const expanded = () => {
    const base = selected.length ? selected.slice() : available.map((m) => m.id);
    for (const id of lockedIds) if (!base.includes(id)) base.push(id);
    return base;
  };
  const onCount = rows.filter((m) => isOn(m.id)).length;
  /** 「全部停用」= 只点名自己 + 没有开关的那几格：这一局只物化它们，其余一律不载入。 */
  const offSet = () => [selfId, ...lockedIds];
  const sameIds = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const allOff = selected.length > 0 && sameIds(selected, offSet());

  /** 整份写入：`onSet` 收的就是「要点名的那些包」的完整清单。 */
  const write = (ids) => { if (typeof onSet === 'function') onSet(ids); };
  const flip = (id) => {
    const base = expanded();
    const at = base.indexOf(id);
    if (at >= 0) base.splice(at, 1); else base.push(id);
    write(base);
  };
  const flipAll = () => write(allOff ? [] : offSet());

  return html`<div class=${`${CLS} ${CLS}--tools`} ref=${rootRef}>
    <button type="button" class=${`btn btn--secondary btn--sm btn--square ${CLS}__btn${open ? ' is-active' : ''}`}
      aria-haspopup="true" aria-expanded=${open ? 'true' : 'false'} aria-label="模组管理"
      title=${onCount === rows.length ? '模组管理：本房间声明了全部模组' : `模组管理：本房间点名了 ${onCount}/${rows.length} 个模组`}
      onClick=${() => setOpen(!open)}>
      <span class=${`btn__icon ${CLS}__glyph`} aria-hidden="true"></span>
      ${onCount === rows.length ? null : html`<span class=${`${CLS}__count num`} aria-hidden="true">${onCount}</span>`}
    </button>

    ${open ? html`<section class=${`panel panel--mint brackets ${CLS}__pop`} role="dialog" aria-label="模组管理">
      <header class="panel__head">
        <div class="panel__titles">
          <span class="micro micro--mint">ROOM MODS</span>
          <h2 class="panel__title">模组管理</h2>
        </div>
        <div class="panel__actions">
          <span class=${`${CLS}__master-label`}>全部停用</span>
          <button type="button" class=${`${CLS}__switch${allOff ? ' is-on' : ''}`} role="switch"
            aria-checked=${allOff ? 'true' : 'false'} title="开启后本房间只保留模组管理器与几个常开的模组：其余模组一律不载入"
            aria-label="全部停用（除模组管理器与几个常开的模组外，一律不载入）" onClick=${flipAll}>
            <span class=${`${CLS}__track`}><span class=${`${CLS}__knob`}></span></span>
          </button>
        </div>
      </header>
      <div class="panel__body">
        <ul class=${`${CLS}__list`}>
          ${rows.map((m) => {
            const on = isOn(m.id);
            const label = nameOf(m.id);
            return html`<li key=${m.id} class=${`${CLS}__row${on ? ' is-on' : ''}`} title=${`${label}（${m.id}）`}>
              <button type="button" class=${`${CLS}__switch${on ? ' is-on' : ''}`} role="switch"
                aria-checked=${on ? 'true' : 'false'} aria-label=${`${on ? '停用' : '启用'} ${label}（${m.id}）`}
                onClick=${() => flip(m.id)}>
                <span class=${`${CLS}__track`}><span class=${`${CLS}__knob`}></span></span>
              </button>
              <span class=${`${CLS}__text`}>
                <b class=${`${CLS}__id`}>${label}</b>
                <span class=${`${CLS}__meta`}>${layerText(m.layer)}${m.combat ? ' · 会改动战斗结果' : ''}</span>
              </span>
              <span class=${`${CLS}__state num`}>${on ? '启用' : '停用'}</span>
            </li>`;
          })}
        </ul>
        <p class=${`${CLS}__note`}>默认全部启用。关掉一个 = 这一局不载入它：对应的盟约 / 策略 / 装备不再出现，被它从自选编队摘掉的干员也会回来。下面这张清单不含模组管理器自己与几个常开的模组 —— 它们不受这里的开关影响，右上「全部停用」也关不掉它们。</p>
      </div>
    </section>` : null}
  </div>`;
}

/**
 * 房间里的**只读**版本（`room.modManager`）。房间里能给的只有「这一局真正跑哪几个包」：集合在 `room.create`
 * 那一刻就定死了（协议里没有局内改集合的消息），所以这里没有开关，只有状态。
 *
 * 一遍「点开 / 点外收起 / Esc」与大厅那份是同一套，只是没有 `onSet` 可写。
 * @param {{ mods?: { digest?: string, packs?: Array<any> } | null, declared?: boolean, selfId?: string }} props
 *   `mods` = 这一局真正跑的集合；`declared` = 它是「本房点名」的还是「按服务器全集（本房没声明）」。
 */
function RoomMods({ mods, declared, selfId }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const names = usePackNames();
  /** 这一行的显示名：目录里有就用它，没有就用包 id。 */
  const nameOf = (id) => names.get(id) || id;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const all = mods && Array.isArray(mods.packs) ? mods.packs : [];
  // 管理器自己与「不进清单的那几格」都不列（与大厅那份同一条口径）：它们跑着，但不占这里的一行。
  const rows = all.filter((m) => m && m.id !== selfId && !isLocked(m.id));
  if (!rows.length) return null;

  const digest = typeof mods.digest === 'string' ? mods.digest : '';
  const short = digest ? `${digest.slice(0, 12)}…` : '';

  return html`<div class=${CLS} ref=${rootRef}>
    <button type="button" class=${`btn btn--secondary btn--sm ${CLS}__btn${open ? ' is-active' : ''}`}
      aria-haspopup="true" aria-expanded=${open ? 'true' : 'false'} title="这一局跑哪几个模组"
      onClick=${() => setOpen(!open)}>
      <span class=${`${CLS}__pip is-on`} aria-hidden="true"></span>
      <span class="btn__label">模组管理<span class=${`${CLS}__count num`}>${rows.length}</span></span>
      <svg class="icon btn__icon btn__icon--right" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
        <path d="M7 10l5 5 5-5z" fill="currentColor" />
      </svg>
    </button>

    ${open ? html`<section class=${`panel panel--mint brackets ${CLS}__pop`} role="dialog" aria-label="模组管理">
      <header class="panel__head">
        <div class="panel__titles">
          <span class="micro micro--mint">ROOM MODS</span>
          <h2 class="panel__title">模组管理</h2>
        </div>
        <div class="panel__actions">
          ${short ? html`<span class="micro num" title=${digest}>${short}</span>` : null}
        </div>
      </header>
      <div class="panel__body">
        <ul class=${`${CLS}__list`}>
          ${rows.map((m) => html`<li key=${m.id} class=${`${CLS}__row is-on`} title=${`${nameOf(m.id)}（${m.id}）`}>
            <span class=${`${CLS}__track is-fixed`} aria-hidden="true"><span class=${`${CLS}__knob`}></span></span>
            <span class=${`${CLS}__text`}>
              <b class=${`${CLS}__id`}>${nameOf(m.id)}</b>
              <span class=${`${CLS}__meta`}>${layerText(m.layer)}${m.combat ? ' · 会改动战斗结果' : ''}</span>
            </span>
            <span class=${`${CLS}__state num`}>运行中</span>
          </li>`)}
        </ul>
        <p class=${`${CLS}__note`}>${declared
          ? '本房间点名的模组在上面这些（模组管理器自己与几个常开的模组不列出）。集合在创建房间那一刻就已定下，局内不可更改 —— 要调整请在创建房间前，于大厅顶栏的「模组管理」里设置。'
          : '本房间没有点名模组，按服务器加载的全部模组运行。'}</p>
      </div>
    </section>` : null}
  </div>`;
}

/**
 * 改写工厂（每帧调用一次，必须只依赖 `ctx`）。
 * @param {{ component: string, props: any, pack?: string }} ctx 面板那份冻结注入面 + `component` + `props`
 * @returns {(orig: any) => any}
 */
export function wrap(ctx) {
  // 旧位置：这一条链返回的树里**不放** orig —— 创建框里那张列表就此收走（内容已经搬进顶栏的浮层）。
  if (ctx.component === 'lobby.modPicker') return () => html`<span class=${`${CLS}__void`} hidden aria-hidden="true"></span>`;
  // 房间里那份是只读的：只有「这一局跑什么」，没有写入口。
  if (ctx.component === 'room.modManager') {
    const { mods, declared } = ctx.props || {};
    return () => html`<${RoomMods} mods=${mods} declared=${declared} selfId=${ctx.pack} />`;
  }
  const { available, selected, onSet } = ctx.props || {};
  // `available` 原样传下去（本包自己也在里面：「展开全开」与「全部停用」都要用到它）；`selfId` 交给组件去滤显示。
  return () => html`<${Manager} available=${available} selected=${selected} onSet=${onSet} selfId=${ctx.pack} />`;
}