// 时装切换 —— 工坊包 skin-picker 的客户端面板模块（`pack.json.client.panels[]`）。
//
// 挂两处（`pack.json.client.panels[]` 里同一条声明的两份）：
//   * `screen.loadout.card` —— 干员调配 界面详情卡的右上角（`.lo-dhead`，CSS 里绝对定位）；
//   * `screen.diy.card` —— 自选编队 每一格已填的干员卡里（`.diy-slot__body`，就排在「潜能 / 此干员语音」下面）。
// 两处的宿主 `.mod-host` 都是 `display: contents`，所以本面板的根元素直接落进那张卡里。区别只有「钥匙是谁」：
// 干员调配的宿主键是**棋子 id**，自选编队的宿主键是**干员 id 本人**（见 `charIdOf`）。
//
// **「我是哪个干员」每次现读**：宿主元素是被框架**复用**的 —— 换一个干员只是把宿主的 `data-mod-slot-key` 改掉。
// 注册点要等到**下一次状态变化**才会回看 DOM 发现身份变了，那一段空档里这里会挂着上一个干员的时装名。所以本
// 模块不把 `ctx.hostKey` 当身份，而是每次都用宿主的**当前**属性重新解析（`liveChessId`），并用一个 MutationObserver
// 在同一帧跟上（见 `sync`）。`data-mod-slot-key` 是引擎与包作者约定的那一个真相（extensions.js 的 `SLOT_KEY_ATTR`），
// 包只**读**它。
//
// 本模块**只画界面**：
//   * 读 `assets.skins[charId]` —— 各包用 `pack.json.skins` 声明、由 `shared/workshop.js mergeWorkshopSkins`
//     合并出来的那张表（按干员分组的一列，`{ pack, id, name, series?, desc?, art?, voices? }`）；
//   * 选择写进本地偏好（`ctx.session.setPref`），并广播 `room.appearance`（`ctx.session.send`）。
//
// 立绘 / 头像的替换由引擎的解析链完成（`public/js/ui/portraitChain.js` 读引擎记下的这份选择），本模块不碰渲染。
//
// 与引擎的约定（`public/js/ui/extensions.js` 的 `ctx.session.send`）：
//   * `{ picks: { [charId]: { skinId } } }` = 给该干员选一套时装；
//   * `{ picks: { [charId]: null } }`      = 清掉该干员的选择 —— 引擎把 `null` 当作「移除这一位」，补齐成
//     **完整**的 picks 表之后才发上线（协议本身没有「清除」的表达，见 shared/protocol.js 的 room.appearance）。
//     「默认」就是这一条。

const PREF_PREFIX = 'pick:';
const CLS = 'sp-skins';
/** 宿主键的属性名（引擎的 `SLOT_KEY_ATTR`）：这个槽位**此刻**是谁。包只读它。 */
const SLOT_KEY_ATTR = 'data-mod-slot-key';

/**
 * @param {{ host: any, hostKey: string|null, data: any, session: any }} ctx 注册点给的冻结注入面
 * @returns {{ unmount?: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  if (!host || typeof host.appendChild !== 'function') return {};

  let chessId;                        // undefined = 还没对齐过；null = 这个槽位此刻没有目标
  let charId = null;
  let skins = [];
  let open = false;
  let current = '';                   // skinId | ''（「默认」）

  const root = document.createElement('div');
  root.className = CLS;
  root.style.display = 'none';        // 先藏：sync() 决定这个干员有没有时装可换
  host.appendChild(root);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `${CLS}__btn`;
  root.appendChild(btn);

  const pop = document.createElement('div');
  pop.className = `${CLS}__pop`;
  pop.setAttribute('role', 'radiogroup');
  pop.hidden = true;
  root.appendChild(pop);

  const labelOf = () => {
    const s = skins.find((x) => x && x.id === current);
    return s ? s.name || s.id : '默认';
  };

  function tile(id, name, group, usable) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${CLS}__tile`;
    b.setAttribute('role', 'radio');
    const on = (id || '') === current;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    if (on) b.classList.add('is-on');
    if (!usable) {
      b.disabled = true;
      b.classList.add('is-off');
    }
    const art = document.createElement('span');
    art.className = `${CLS}__art`;
    const url = thumbUrl(ctx, charId, id);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      art.appendChild(img);
    }
    const text = document.createElement('span');
    text.className = `${CLS}__text`;
    const bName = document.createElement('b');
    bName.className = `${CLS}__name`;
    bName.textContent = name;
    const bGroup = document.createElement('span');
    bGroup.className = `${CLS}__group num`;
    bGroup.textContent = group || 'SPECIAL';
    text.append(bName, bGroup);
    b.append(art, text);
    if (!usable) {
      const tag = document.createElement('span');
      tag.className = `${CLS}__badge is-off`;
      tag.textContent = '未安装';
      b.appendChild(tag);
    } else if (on) {
      const tag = document.createElement('span');
      tag.className = `${CLS}__badge`;
      tag.textContent = '已装配';
      b.appendChild(tag);
    }
    b.addEventListener('click', () => pick(id || null));
    return b;
  }

  function paint() {
    btn.textContent = `时装 · ${labelOf()}`;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('is-open', open);
    pop.hidden = !open;
    // 图块每次都重建：`is-on` / `aria-checked` 跟着 `current` 走，关着的时候也保持与选择一致。
    const tiles = [tile('', '默认', 'DEFAULT', true)];
    for (const s of skins) tiles.push(tile(s.id, s.name || s.id, s.series || '', installed(s)));
    pop.replaceChildren(...tiles);
  }

  /**
   * 把「我是谁」重新对齐一次：宿主键变了就是换了干员（换了干员，这里显示的选择也随之换成他的偏好）。
   * 没有时装可换的干员 → 整个控件隐藏（不是空态），但控件本身留着，这样下一次切换不用等注册点重建面板。
   */
  function sync() {
    const id = liveChessId(ctx);
    if (id === chessId) return;
    chessId = id;
    charId = charIdOf(ctx, chessId);
    skins = skinsOf(ctx, charId);
    current = charId ? prefGet(ctx, charId) : '';
    open = false; // 换了角色，上一个角色的浮层不该留在屏幕上
    root.style.display = charId && skins.length ? '' : 'none';
    paint();
  }

  function pick(skinId) {
    if (!charId) return;
    current = skinId || '';
    ctx.session.setPref(PREF_PREFIX + charId, current);
    // 广播：`null` = 清掉这一位（「默认」）。引擎补齐成完整的 picks 表之后才发上线。
    ctx.session.send('room.appearance', { picks: { [charId]: skinId ? { skinId } : null } });
    open = false;
    paint();
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); open = !open; paint(); });
  pop.addEventListener('click', (e) => e.stopPropagation());
  const onDocClick = () => { if (open) { open = false; paint(); } };
  document.addEventListener('click', onDocClick);

  // 宿主键一变就立刻跟上：`data-mod-slot-key` 只在换干员（或这个槽位出现 / 消失）时才动，观察整棵子树的开销就是
  // 浏览器原生的「属性变化数」，可以忽略。没有它，这里要等到**下一次状态变化**才被注册点重新挂载。
  const watcher = typeof MutationObserver === 'function' ? new MutationObserver(() => sync()) : null;
  const watchRoot = document.body;
  if (watcher && watchRoot) watcher.observe(watchRoot, { subtree: true, attributes: true, attributeFilter: [SLOT_KEY_ATTR] });

  sync();

  return {
    unmount() {
      watcher?.disconnect?.();
      document.removeEventListener('click', onDocClick);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/**
 * **此刻**这个宿主管的是哪个棋子。
 *
 * 为什么不直接用 `ctx.hostKey`：那个值在 `mount` 那一刻就固定了，而宿主元素是被框架**复用**的 —— 换一个干员
 * 只是把 `data-mod-slot-key` 改掉（同一个 DOM 节点，属性变了）。所以身份要每次现读。宿主元素读不到时（还没进
 * DOM）才回退 `ctx.hostKey`；宿主在、属性却是空的 ⇒ **这个槽位此刻没有目标**（`null`，面板随之隐藏），
 * 而不是拿旧身份硬撑。
 */
function liveChessId(ctx) {
  const host = ctx && ctx.host;
  const holder = host && host.parentNode;
  if (!holder || typeof holder.getAttribute !== 'function') return (ctx && ctx.hostKey) || null;
  const live = holder.getAttribute(SLOT_KEY_ATTR);
  return typeof live === 'string' && live ? live : null;
}

/** `data/assets.json` 的冻结快照（面板已在 `client.panels[].data` 里声明过 `assets`）。 */
function assetsOf(ctx) {
  const a = ctx.data.get('assets');
  return a && typeof a === 'object' ? a : null;
}

/**
 * 槽位键对应的干员 id。两种宿主给的键**不是同一种东西**：
 *   * `screen.loadout.card`（干员调配）给的是**棋子 id** ⇒ 查 `chess[chessId].charId`；
 *   * `screen.diy.card`（自选编队）给的是**干员 id 本人** —— 那一格装的就是干员（6★ 池外 / 原型），没有棋子记录。
 * 认不出就当这个槽位此刻没有目标（`null`，面板隐藏）。
 */
function charIdOf(ctx, key) {
  const t = ctx.data.get('chess');
  const rec = t ? t[key] : null;
  if (rec && typeof rec.charId === 'string' && rec.charId) return rec.charId;
  return typeof key === 'string' && key.startsWith('char_') ? key : null;
}

/** 某干员被各包声明的全部时装（`assets.skins[charId]`）。 */
function skinsOf(ctx, charId) {
  const a = assetsOf(ctx);
  const list = a && a.skins ? a.skins[charId] : null;
  return Array.isArray(list) ? list : [];
}

/** 一套时装是否带来了模型 / 图（带 `art` 才算）；没带的显示「未安装」且不可选。 */
function installed(skin) {
  const art = skin && skin.art;
  return !!(art && (art.avatar || art.portrait || art.spine));
}

/** 图块用的那张图：某套时装自己的头像 / 立绘，或「默认」档用干员本人的头像。 */
function thumbUrl(ctx, charId, skinId) {
  const a = assetsOf(ctx);
  if (!a) return null;
  if (skinId) {
    const list = a.skins ? a.skins[charId] : null;
    const s = Array.isArray(list) ? list.find((x) => x && x.id === skinId) : null;
    const art = s && s.art;
    const url = art ? art.avatar || art.portrait : null;
    return typeof url === 'string' && url ? url : null;
  }
  const rec = a.chars ? a.chars[charId] : null;
  return rec && typeof rec.avatar === 'string' && rec.avatar ? rec.avatar : null;
}

function prefGet(ctx, charId) {
  const v = ctx.session.getPref(PREF_PREFIX + charId, '');
  return typeof v === 'string' ? v : '';
}
