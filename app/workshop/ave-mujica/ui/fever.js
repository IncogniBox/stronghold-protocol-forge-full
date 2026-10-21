// 颂乐人偶 —— 工坊包 ave-mujica 的客户端面板（`pack.json.client.panels[]`）。
//
// 作用：在对局战场上，给每一名**在场**的【颂乐人偶】干员、贴一个「连音符」样式的 **Fever 积攒进度**图标
// （半透明黑底剪影 + 品红自下而上填充；触发 Fever 后 Fever 清零 ⇒ 图标同步清空）。
// 图标本身用业主给的两张 PNG（`assets/ui/fever_note_{empty,full}.png`），见下面「连音符图标」一节。
//
// 以下几件事都**不需要**引擎为它新增扩展点：
//   * **数据**：`battle/main.mjs`（本包的 `server.battle` 模块，客户端战斗时也在浏览器里跑）把每名玩家当前的
//     `{ fever, cap, on, until, full, sp }` 写进模块级表 `FEVER_LIVE`（`full` = 五名是否齐全 ⇒ 选曲；
//     `sp[uid] = [当前技力, 上限]` ⇒ Fever 期间技力条改画玫红时的填充比例）。面板从 `battleRunner.currentBattle().spec.workshopBattle`
//     里取到那条**同 URL**（`/workshop-battle/ave-mujica/battle/main.mjs?v=<hash>`）再 `import()` —— ES module 按 URL
//     去重，拿到的就是运行器加载的**同一个实例**，于是读得到那张表。
//   * **谁在场上**：本包另声明一条 `game.hud.topBar` 的**组件改写**，把顶栏 props 里的 `pub` / `priv` / `myId`
//     抄进本模块（顶栏每帧都有最新的一份），再对照只读的 `chess` 表筛出棋盘上带 `aveMujica` 盟约的棋子。
//   * **贴在哪**：引擎的战场视图（`globalThis.__SP_VIEW__`，fieldHost 挂载时写入）给了 `tileScreen(row, col)` ——
//     把一枚棋子所在的 **board 格子**映射成屏幕上的位置与大小（`public/js/render/app.js`）。用格子、不用
//     `pieceScreenRect(uid)`：后者解析不了战斗单位（实测两枚在不同格上的棋子会返回**同一个**身体矩形 ⇒ 图标全叠一处）；
//     面板用 `position: fixed` 把图标贴到该格的**右下角**（干员模型右下方，尺寸/偏移都按「一格在屏幕上的高度」缩放）。
//   * **Fever 技能条 / 技力条**：Fever 的「特殊技能条」是**全员共用**的那一条 —— 每名成员身上的连音符 Fever
//     进度图标（读数同样来自 `FEVER_LIVE`）。另按业主 2026-10-17 的裁决，**Fever 期间成员自己那条技力条整条
//     换成玫红的 Fever 条**（引擎 `view.setUnitSpBar`，填充 = 共用的 Fever 窗口剩余比例 ⇒ 全员同时结束）；
//     Fever 结束后恢复成员自己的技力条（单位自己的 sp 从未被改动）。
//   * **颂乐音符**（2026-10-17 补）：祥子的音符由 `battle/main.mjs` 自建积分（引擎不渲染自建弹道），位置经
//     `NOTES_LIVE` 交给本面板，按 `tileScreen` **双线性插值**贴到屏幕上（贴图用本包自带的官方音符轨迹贴图）。
//   * **Fever 音乐**（2026-10-17 补）：进入 Fever 时按「五名成员是否齐全」播放包内 KillKiss 伴奏 / 人声
//     （业主指定秒起止、1 秒淡入淡出），同时用 `audio.playBgm(null)` 压低场地 BGM，结束/片段播完再
//     `audio.playBgm(prev)` 恢复（见 MUSIC / driveMusic）。**同一场战斗内**没播完就中断 ⇒ 下次接着播；
//     **换一场战斗**（`battleId` 变了）⇒ 续播点作废，新一场从指定秒重新起播（业主 2026-10-17）。

import { h, Fragment } from 'preact';
import { useEffect } from 'preact/hooks';
import htm from 'htm';
import { battleRunner } from '/js/battle/runner.js';
import { audio } from '/js/audio.js';
import { effectiveFeverMusic, resolveFeverTrack, primeFeverTrack } from '/js/ui/feverMusic.js';

const html = htm.bind(h);

const CLS = 'amfv';
const PACK_ID = 'ave-mujica';
const BOND_ID = 'aveMujica';
/**
 * 图标相对**所在格子**的摆法（都以「一格在屏幕上的高度」为单位，随镜头缩放/远景自适应）：
 * 贴在干员模型的**右下角** —— 水平在身体右缘外侧、竖直落在脚下（业主 2026-10-13 用红框标的位置）。
 * 干员身体大约高 1.45 格、宽 0.8 格、脚底在格中心下方约 0.12 格。
 */
const ANCHOR_RIGHT = 0.43;  // 格中心 → 图标**左缘**的距离（格高倍数，向右）
const ANCHOR_BOTTOM = 0.12; // 格中心 → 图标**底缘**的距离（格高倍数，向下 ≈ 脚底）
const SIZE_RATIO = 0.44;    // 图标边长 = 格高 × 该比例，并夹在 [16, 32]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const nowSec = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/**
 * Fever 期间成员**技力条**的玫红（业主 2026-10-17）：取自包内 Fever 图标实心的那个色（`rgb(235,63,116)`），
 * 与 `render/fx/kinds.js` 的 `fever` 光环同族。它替换的是**成员自己那条技力条**（引擎 `setUnitSpBar`），
 * 与上面那枚连音符积攒图标是两件事。
 */
const FEVER_ROSE = 0xeb3f74;

/**
 * Fever 音乐（业主 2026-10-17 指定）：按「场上五名成员是否齐全」选曲，**1 秒淡入淡出**。
 *   inst  = KillKiss 伴奏（佑天寺若麦/八幡海玲/三角初华/若叶睦/丰川祥子 缺任意一名）
 *   vocal = KillKiss 人声（五名全部在场）
 *
 * ⚠️ 两首**都是 20 秒片段**（业主 2026-10-18「把素材裁成 20 秒片段替换掉」），起点就是文件 0 秒 ⇒ **完全不 seek**。
 * 原先放的是整首（3:25 / 3:28）再 seek 到 102 / 103 秒，踩了这条路由的坑：`/workshop-assets/**` **不宣告
 * `Accept-Ranges`**（实测：带 `Range` 的请求仍回 `200` + 整段，没有 `Content-Range`），media element 只能在
 * 已缓冲到的那一段里 seek ⇒ 素材没整段下完时 `currentTime = 102` 落不下去，于是「从 0:00 播 / 播错位置 / 干脆
 * 不出声」，而且时好时坏（`Cache-Control: max-age=86400` 命中缓存就正常）。裁成片段后这条路彻底消失。
 * 素材来历：`killkiss_inst.m4a` = 原 `killkiss_inst.mp3`（**其实装的是 MP4/AAC**，只是扩展名写成了 `.mp3`）的
 * 102–122 s **无损**切段（`ffmpeg -ss 102 -t 20 -c copy`；扩展名随之改成 `.m4a` ⇒ 服务端按
 * `WORKSHOP_ASSET_TYPES` 发 `audio/mp4`，不必再靠浏览器嗅探）；`killkiss_vocal.mp3` = 真 MP3 的 103–123 s 无损切段。
 * 两首都经 `/workshop-assets/<pack>/bgm/...` 送达（那张表已放行 `.mp3` / `.m4a`）。
 */
const MUSIC_BASE = `/workshop-assets/${PACK_ID}/bgm/`;
const MUSIC = Object.freeze({
  inst: { url: `${MUSIC_BASE}killkiss_inst.m4a`, start: 0, end: 20 },   // 原 1:42 → 2:02 的 20 秒片段
  vocal: { url: `${MUSIC_BASE}killkiss_vocal.mp3`, start: 0, end: 20 }, // 原 1:43 → 2:03 的 20 秒片段
});
const MUSIC_FADE = 1; // 淡入 / 淡出各 1 秒
/**
 * 起播宽限：Fever 开始后这么久**还没听见 Fever 曲出声** ⇒ 先把场地 BGM 放回来，同时继续重试 Fever 曲
 * （它一旦真的出声就再压掉 BGM）。理由：`startMusic` 会立刻 `audio.playBgm(null)`，若 Fever 曲因为
 * 「自动播放门 / 素材还在下载」迟迟不出声，玩家听到的就是**整场静音** —— 业主 2026-10-18 报的「触发 Fever 时
 * 有时会丢失音乐」。宁可先听到场地 BGM，也不要死寂。
 */
const MUSIC_START_GRACE = 2.5;

/** 面板的模块级表（同一槽位只有一个实例）。 */
const state = {
  feed: { priv: null, myId: null },
  data: null,
  root: null,
  els: new Map(), // uid -> { box, fill }
  noteRoot: null,
  noteEls: [], // 音符元素池（按下标复用）
  raf: 0,
  mods: new Map(), // url -> Promise<module|null>
  /** 上一帧被换成玫红 Fever 条的成员 uid（帧间清账：这一帧不再需要的要恢复成自己的技力条）。 */
  spSet: new Set(),
  /** 已经见过的音符 id（`NOTES_LIVE` 每项第 4 位）：新出现的「无目标」音符 ⇒ 替祥子补一次攻击动作。 */
  noteSeen: new Set(),
  /** 音符 id → 官方音符特效的句柄（`OfficialFx.spawn`；面板每帧 `place` 跟住、音符消失即 `kill`）。 */
  fxNotes: new Map(),
  /** 已经因为「引擎的 setUnitAttack 缺席」报过一次警（避免每帧刷 console）。 */
  warnedNoAttackApi: false,
  /** 攻击动作触发成功时报过一次（诊断用：面板→引擎这一段通没通）。 */
  attackLogged: false,
  /** fx 入口探测只报一次（诊断用：`raw.ofx` 在有些构建上是 undefined）。 */
  fxProbeLogged: false,
  /** 上一帧引擎侧官方音符特效**是否已起**（成功 ⇒ 这帧不再画面板那套贴图）。 */
  noteFxOn: false,
  /** 上一帧看到的 `currentBattle().battleId`（那一场战斗的身份）：换了它 = 换了一场战斗（下面的「每场重播」靠它判）。 */
  battleKey: null,
  /** Fever 音乐状态：on = 上一帧的 Fever 开关；fading = 正在 1 秒淡出；resume = 每条曲「上次没播完时中断到的秒数」；
   *  pendingFrom = 还没落地的起播时间点（元数据未就绪时先记下来，到了再 seek+play）。 */
  music: { on: false, el: null, which: null, t0: 0, fading: false, fadeStart: 0, prevBgm: null, resume: { inst: null, vocal: null }, pendingFrom: null, retryAt: 0,
    /** 当前这一首的片段规格 `{ url, start, end }`（默认两首或房间里选的服务器曲目）。 */
    spec: null,
    /** 房间里选的 Fever 曲目：`{ id, url, spec, pending }`（解析中 / 失效时回落默认两首）。 */
    custom: { id: null, url: null, spec: null, pending: null },
    /** 每首曲子各自一个**长期复用**的 `<audio>`（`which -> el`）：提前预取、换曲不再动 `src`（改 src 会打断正在加载的流）。 */
    pool: Object.create(null),
    /** 场地 BGM 是否已被我们压掉（`bgmMuted`）—— `MUSIC_START_GRACE` 的兜底要靠它决定要不要放回来。 */
    bgmMuted: false,
    /** 上一帧的播放位置：判「位置有没有在往前走」用（**不只看 `paused`**，见 driveMusic）。 */
    lastPos: null,
    /** 到片段末尾却 seek 落不下去的起始时刻（工坊素材无 Range 支持时可能发生）—— 超时就收尾，别空转。 */
    stuckSince: null },
};

/**
 * 不画任何东西的数据喂食器：把顶栏这一帧的 `priv` / `myId` 抄进模块级表（面板每帧的 rAF 循环直接读它）。
 * @param {{ pub?: any, priv?: any, myId?: any }} props
 */
function Feed({ pub, priv, myId }) {
  useEffect(() => {
    state.feed.priv = priv ?? null;
    state.feed.myId = myId ?? null;
  });
  return null;
}

/**
 * 改写工厂：引擎那一份原样返回，旁边挂一个不画东西的数据喂食器（`game.hud.topBar` 每帧都有 `pub`/`priv`/`myId`）。
 * @param {{ component: string, props: any }} ctx
 * @returns {(orig: any) => any}
 */
export function wrap(ctx) {
  const { pub, priv, myId } = ctx.props || {};
  return (orig) => html`<${Fragment}>${orig}<${Feed} pub=${pub} priv=${priv} myId=${myId} /></${Fragment}>`;
}

// ---- 连音符图标（用业主给的两张 PNG：空态 = 半透明黑底剪影，满态 = 实心品红剪影）----------------------------------

/**
 * 两张素材都是**同一枚实心连音符剪影**、同尺寸且像素级对齐（业主在 500×500 同 bbox 上做的），所以实现是
 * 「把满态那张按 Fever 比例**从下往上切一条**，叠在空态那张上」——比用 SVG 描形状更忠实于他的稿：
 *   * `fever_note_empty.png`：黑、`alpha=72/255` 的半透明底；
 *   * `fever_note_full.png`：实心 `rgb(235,63,116)`。
 * 素材走 `/workshop-assets/<pack>/<rel>`（服务端把包内 `assets/` 下的任意文件按扩展名放行）。
 */
const ART_BASE = `/workshop-assets/${PACK_ID}/ui/`;
const ART_EMPTY = `${ART_BASE}fever_note_empty.png`;
const ART_FULL = `${ART_BASE}fever_note_full.png`;
/**
 * 「颂乐音符」的两张素材 —— 都取自本包自带的**官方音符 prefab** 用的那几张贴图（随 `fx.manifest` 一起分发）：
 *   `oblvns_trail_01` = 拖尾（官方 prefab 的 `main`），`star_02` = 那枚星光（音符头部）。
 * 只画一张拖尾贴图会变成「一条平线」（业主 2026-10-17 反馈的两条白线），所以轨迹**沿运动方向拉长并按屏幕投影角
 * 旋转**、头部再叠一枚星光（见 paintNotes）。
 */
const ART_NOTE = `/workshop-assets/${PACK_ID}/fx/tex/oblvns_trail_01-a1b995c3.webp`;
const ART_NOTE_HEAD = `/workshop-assets/${PACK_ID}/fx/tex/star_02-76db3d03.webp`;

/**
 * **官方音符 prefab**（业主 2026-10-17：自动普攻的音符特效要用官方的）：`oblvns_attack_01_trail` 是她普攻弹道
 * 的 `main`，随本包 `fx.manifest` 分发 ⇒ 引擎的 `OfficialFx` 认它。面板拿 `__SP_VIEW__.raw.ofx.spawn(key, place)`
 * 给每枚音符起一枚、每帧 `place()` 把它的锚点推到音符当前位置（轨迹粒子跟着锚点动 ⇒ 是一条真的拖尾），
 * 音符消失时 `kill()`。官方特效没装 / 设置关着时 `spawn` 返回 null ⇒ 落到下面那套贴图近似（拖尾 + 星光）。
 */
const FX_NOTE_KEY = 'oblvns_attack_01_trail';
const NOTE_LIFT = 0.35;   // 音符离地高度（格）
/** 颂乐音符是**祥子**的：引擎按这位 charId 查当前时装的 `fx` 后缀（`paintNoteFx` 的第 3 个参数）。 */
const NOTE_CHAR_ID = 'char_4182_oblvns';
/** 这些音符归哪一席：面板自己那一席（`state.feed.myId`）+ 祥子的 charId。 */
const noteFxOwner = () => ({ owner: state.feed && state.feed.myId != null ? state.feed.myId : null, charId: NOTE_CHAR_ID });

/**
 * 棋盘世界坐标（列 x / 行 y，可为小数）→ 引擎 fx 的 **Unity** 位置：与 `render/vfx/mounts.js unitPoint`
 * 的落点换算逐字一致（`out[0] = x-10, out[1] = y-9, out[2] = -z`），高度按骨架 30° 倾斜分解
 * （`SKELETON_TILT`：竖直分量 → `(0, up·cos t, −up·sin t)`）。
 * @param {number} x 列 @param {number} y 行 @returns {number[]} [x, y, z]（Unity 帧）
 */
function noteFxPos(x, y) {
  const up = NOTE_LIFT;
  return [x - 10, y - 9 + up * 0.866, -(up * 0.5)];
}

/** 收掉所有官方音符特效（离开战斗 / 换一场 / 卸载时用）。 */
function clearNoteFx() {
  for (const h of state.fxNotes.values()) { try { h.kill(); } catch { /* ignore */ } }
  state.fxNotes.clear();
}

/**
 * 让祥子补一次攻击动作（自建音符那条虚拟普攻没有引擎的 atk 事件可跟）。三条路，前两条通一条即可：
 *   ① 引擎新开的 `view.setUnitAttack(uid)`（最正规：走 `UnitView.playAttack`，按它自己学到的 `atkInterval` 播）；
 *   ② 退一步直接拿 `view.views` 里那条 UnitView 的 `actor.attack()` —— 这是引擎**任何版本都有**的方法，
 *      所以页面/模块版本比面板旧、①不存在时它兜住（`actor` 用自己缺省的 interval，≈ 1 s，够用）；
 *   ③ 两条都不通 ⇒ 报一次 console.warn（那时才是真的没入口，提示刷新页面）。
 * @returns {boolean} 是否真的让 actor 播了一次
 */
function triggerAttack(raw) {
  const ob = oblivionisUid();
  if (ob == null) return false;
  if (typeof raw.setUnitAttack === 'function' && raw.setUnitAttack(ob)) return noteTriggered('setUnitAttack');
  const views = raw.views;
  if (views && typeof views.get === 'function') {
    let v = views.get('p:' + ob) || null;
    if (!v && typeof views.values === 'function') {
      for (const x of views.values()) if (x && (x.uid === ob || x.info?.uid === ob)) { v = x; break; }
    }
    if (v && v.actor && typeof v.actor.attack === 'function') {
      try { v.actor.attack(); return noteTriggered('views.actor'); } catch { /* 落到下面那条 warn */ }
    }
  }
  if (!state.warnedNoAttackApi) {
    state.warnedNoAttackApi = true;
    console.warn('[ave-mujica] 找不到可用的攻击动作入口（view.setUnitAttack / views.actor 都没有）—— 请刷新页面（老页面会把旧模块一直用下去）');
  }
  return false;
}

/** 触发成功时**报到控制台一次**（业主报「没生效」时，有/没有这一行就能定责：面板→引擎这一段到底通没通）。 */
function noteTriggered(via) {
  if (!state.attackLogged) {
    state.attackLogged = true;
    console.info(`[ave-mujica] 音符攻击动作：触发成功（${via}）`);
  }
  return true;
}

/** 建 / 取某个 uid 的图标元素（建一次，之后只改进度）。 */
function elementFor(uid) {
  let e = state.els.get(uid);
  if (e) return e;
  const box = document.createElement('div');
  box.className = CLS;
  box.setAttribute('aria-hidden', 'true');
  // 空态（半透明黑底剪影）在下、满态的**下缘切片**在上：切片靠一个 overflow:hidden 的壳从底部对齐
  box.innerHTML = `<img class="${CLS}__plate" src="${ART_EMPTY}" alt="">`
    + `<div class="${CLS}__fillwrap"><img class="${CLS}__full" src="${ART_FULL}" alt=""></div>`;
  state.root.appendChild(box);
  e = { box, fillwrap: box.querySelector(`.${CLS}__fillwrap`) };
  state.els.set(uid, e);
  return e;
}

function hide(e) { if (e && e.box.style.display !== 'none') e.box.style.display = 'none'; }

// ---- 丰川祥子「颂乐音符」：把 `NOTES_LIVE` 的世界坐标画到屏幕上（自建弹道引擎不渲染，只能自己画）-----------

/** 音符元素池：第 i 个音符复用第 i 组元素（拖尾 + 头部星光），音符短命且数量少，池子按下标够用。 */
function noteElementFor(i) {
  let e = state.noteEls[i];
  if (e) return e;
  const trail = document.createElement('img');
  trail.className = `${CLS}__trail`;
  trail.setAttribute('aria-hidden', 'true');
  trail.src = ART_NOTE;
  const head = document.createElement('img');
  head.className = `${CLS}__note`;
  head.setAttribute('aria-hidden', 'true');
  head.src = ART_NOTE_HEAD;
  state.noteRoot.appendChild(trail);
  state.noteRoot.appendChild(head);
  e = { trail, head };
  state.noteEls[i] = e;
  return e;
}

/** 收起池子里第 n 个及其后的所有音符元素。 */
function hideNotesFrom(n) {
  for (let i = n; i < state.noteEls.length; i++) {
    state.noteEls[i].trail.style.display = 'none';
    state.noteEls[i].head.style.display = 'none';
  }
}

/**
 * 世界坐标（x = 列、y = 行，可为小数）→ 屏幕点：对所在格四角的 `tileScreen` 做**双线性插值**。
 * `tileScreen` 只接受整数格（`public/js/render/app.js`：`cam.project` + canvas 矩形），而投影在一格之内近似线性，
 * 所以按小数权重混合四角即可（误差远小于一格，肉眼与真投影一致）。
 */
function projectWorld(raw, x, y, cache) {
  const tile = (r, c) => {
    const k = `${r},${c}`;
    let v = cache.get(k);
    if (v === undefined) {
      try { v = raw.tileScreen(r, c); } catch { v = null; }
      cache.set(k, v);
    }
    return v;
  };
  const c0 = Math.floor(x), r0 = Math.floor(y);
  const fx = x - c0, fy = y - r0;
  const p00 = tile(r0, c0), p10 = tile(r0 + 1, c0), p01 = tile(r0, c0 + 1), p11 = tile(r0 + 1, c0 + 1);
  if (!p00 || !p10 || !p01 || !p11) return p00 || null;
  return {
    x: (1 - fy) * ((1 - fx) * p00.x + fx * p01.x) + fy * ((1 - fx) * p10.x + fx * p11.x),
    y: (1 - fy) * ((1 - fx) * p00.y + fx * p01.y) + fy * ((1 - fx) * p10.y + fx * p11.y),
    s: p00.s,
  };
}

/** 本机棋盘上的丰川祥子棋子 uid（只有她有「颂乐音符」这条自建弹道）。 */
function oblivionisUid() {
  const priv = state.feed.priv;
  const board = priv && Array.isArray(priv.board) ? priv.board : null;
  if (!board) return null;
  for (const p of board) {
    if (p && p.kind === 'chess' && Number.isInteger(p.uid) && /^chess_char_6_30/.test(String(p.id))) return p.uid;
  }
  return null;
}

/**
 * 每帧把「颂乐音符」贴到屏幕上（无音符 / 不在战斗时全部收起）。
 *
 * 每个音符画两笔（都是官方音符 prefab 用的素材，业主 2026-10-17：要和主动攻击的音符特效一样）：
 *   · **拖尾**：`oblvns_trail_01` 那张贴图沿**运动方向**拉长、并按**屏幕上**的投影方向旋转（`projectWorld` 取
 *     音符点与「音符点 + 方向 × 0.35 格」两点算夹角 ⇒ 透视下也是对的），这样它是一条拖尾而不是一条平线；
 *   · **头部**：`star_02` 那枚星光，叠在拖尾的前端；`tracking`（`it[2]`）时略微放大一点（索敌阶段更亮眼）。
 * `NOTES_LIVE` 的每项现在是 `[x, y, tracking, id, dirX, dirY]`（`id` 让面板能跨帧把同一个音符认出来）。
 */
function paintNotes(raw, mod) {
  if (!state.noteRoot) return;
  const myId = state.feed.myId;
  const list = mod && mod.NOTES_LIVE && myId != null ? mod.NOTES_LIVE.byPid[myId] : null;
  if (!Array.isArray(list) || !list.length) {
    hideNotesFrom(0); state.noteSeen.clear();
    if (raw && typeof raw.paintNoteFx === 'function') { try { raw.paintNoteFx(FX_NOTE_KEY, []); } catch { /* ignore */ } }
    return;
  }
  const cache = new Map();
  const liveIds = new Set();
  // 官方音符特效**只能由引擎侧起**（业主实机控制台实测：guarded view 只透方法，`raw.ofx/wiring/fx` 全读不到）
  const canPaint = !!(raw && typeof raw.paintNoteFx === 'function');
  const fxPos = [];
  if (!state.fxProbeLogged) {
    state.fxProbeLogged = true;
    console.info('[ave-mujica] 音符官方特效入口：' + (canPaint ? '可用（引擎侧 paintNoteFx 起官方 prefab）' : '不可用 —— 回落贴图'));
  }
  let n = 0;
  for (const it of list) {
    if (!Array.isArray(it)) continue;
    // ⚠️ 记账放在**屏幕投影之前**：音符的**动作**触发不该被「这一帧投影不出来」挡住（离屏 / 刚出生那一帧）
    const nid = Number(it[3]);
    if (Number.isFinite(nid)) {
      liveIds.add(nid);
      // ⚠️ 业主 2026-10-17 最终裁决：自建音符（自动普攻的持续演奏）**不播任何攻击动作** ——
      // 技能外她保持 `Idle`、技能期间保持该技能的**待机**（三技能即 `Skill_3_Idle`）。
      // （早先那几轮我理解反了，往「替她补一次攻击动作」的方向改，现已停用 ⇒ 该分支不再触发。）
      // if (it[6] === 1 && it[7] === 1) triggerAttack(raw);
    }
    if (!Number.isFinite(it[0]) || !Number.isFinite(it[1])) continue;
    const p = projectWorld(raw, it[0], it[1], cache);
    if (!p || !(p.s > 0)) continue;
    // 官方音符特效（**由引擎侧起**：面板拿不到 `ofx` 实例，只交落点给 `view.paintNoteFx`）：
    // 每帧把可见音符的位置收集起来，帧末一次性交上去；上一帧成功 → 这帧就不画贴图（官方特效在画）
    if (Number.isFinite(nid) && canPaint) {
      // 交上去的是 `[音符 id, x, y, z]` —— 引擎按 **id** 建映射，音符出列时不会因下标前移把特效拽到别的音符上
      const q3 = noteFxPos(it[0], it[1]);
      fxPos.push([nid, q3[0], q3[1], q3[2]]);
      if (state.noteFxOn) continue;
    }
    const dx = Number(it[4]) || 0, dy = Number(it[5]) || 0;
    const q = dx || dy ? projectWorld(raw, it[0] + dx * 0.35, it[1] + dy * 0.35, cache) : null;
    const el = noteElementFor(n);
    const tracking = it[2] === 1;
    const size = Math.max(10, Math.min(40, Math.round(p.s * (tracking ? 0.5 : 0.42))));
    const len = size * 2.2;
    const th = Math.max(4, Math.round(size * 0.55));
    let ang = 0;
    if (q && (Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5)) ang = Math.atan2(q.y - p.y, q.x - p.x);
    const trail = el.trail;
    trail.style.display = '';
    trail.style.width = `${Math.round(len)}px`;
    trail.style.height = `${th}px`;
    trail.style.left = `${(p.x - len / 2).toFixed(1)}px`;
    trail.style.top = `${(p.y - th / 2 - p.s * 0.28).toFixed(1)}px`;   // 抬到约胸口高度
    trail.style.transform = `rotate(${((ang * 180) / Math.PI).toFixed(1)}deg)`;
    const hs = Math.max(8, Math.round(size * (tracking ? 1.05 : 0.85)));
    const head = el.head;
    head.style.display = '';
    head.style.width = `${hs}px`;
    head.style.height = `${hs}px`;
    head.style.left = `${(p.x + Math.cos(ang) * len * 0.36 - hs / 2).toFixed(1)}px`;
    head.style.top = `${(p.y - p.s * 0.28 + Math.sin(ang) * len * 0.36 - hs / 2).toFixed(1)}px`;
    n++;
  }
  // 已经不在场上的音符 id 从「见过」里去掉（同一个 id 只会认一次 ⇒ 下次新音符必然触发一次攻击动作）
  for (const id of state.noteSeen) if (!liveIds.has(id)) state.noteSeen.delete(id);
  // 帧末把落点交给引擎（数量变少/为 0 时，引擎那边会 kill 多出来的条目）。第 3 个参数说明这些音符是**祥子的** ——
  // 她穿着时装时，引擎会改成起那套时装的 `<key>_<fx>` 变体（`paintNoteFx`）。
  if (canPaint) { try { state.noteFxOn = raw.paintNoteFx(FX_NOTE_KEY, fxPos, noteFxOwner()) > 0; } catch { state.noteFxOn = false; } }
  else state.noteFxOn = false;
  hideNotesFrom(n);
}

// ---- Fever 音乐：进入 Fever 时按「五名是否齐全」播放，1 秒淡入；结束/播完 1 秒淡出并恢复场地 BGM ----------

/**
 * 取 / 建某一首 Fever 曲的 `<audio>`（**每首一个、长期复用**）。
 * ⚠️ 这个元素**只建一次**：新建元素会丢掉「用户手势解锁」的状态 ⇒ 浏览器自动播放门会把 `play()` 直接挡掉
 * （rejected promise 被静默吞 ⇒ 听不到声音）。这里也**不再动 `src`**（改 src 会打断正在加载的流）。
 * `key` 是池的身份（默认两首 = `inst` / `vocal`；自定义曲目 = `custom:<url>`），`spec` 给出它的 URL。
 */
function musicElFor(key, spec) {
  const m = state.music;
  const cached = m.pool[key];
  if (cached) return cached;
  if (!spec || !spec.url) return null;
  let el = null;
  try { el = new Audio(); } catch { return null; }
  el.preload = 'auto';
  el.loop = false;
  el.volume = 0;
  el.muted = false;
  el.src = spec.url;
  m.pool[key] = el;
  try { el.load(); } catch { /* ignore */ }
  return el;
}

/**
 * **提前把两首 Fever 曲抓下来**（战斗一开始就抓，触发 Fever 时不必现下载）。
 * 裁成片段 + 从 0 秒起播之后，这已经不是「seek 落不下去」的必需项了（起点就是 0），但冷缓存时仍能省掉
 * 一整段下载等待；`preload='auto'` 只是提示、不保证下完 —— 真没下完也不会再播错位置。
 */
function preloadMusic() {
  musicElFor('inst', MUSIC.inst);
  musicElFor('vocal', MUSIC.vocal);
  syncCustom();
}

/**
 * 把房间里选的服务器曲目解析成可播放的片段（官方曲目直接给 URL；工坊曲目先整段抓成 Blob URL）。
 * 解析失败 / 还没好时 `custom.spec` 为 null ⇒ `driveMusic` 回落包内默认两首。
 */
function syncCustom() {
  const m = state.music;
  const sel = effectiveFeverMusic();
  const c = m.custom;
  if (!sel.track) { c.id = null; c.url = null; c.spec = null; return; }
  if (c.id === sel.track && c.spec && c.spec.start === sel.start && c.spec.end === sel.end) return;
  c.id = sel.track;
  if (c.pending) return;
  c.spec = null;
  c.url = null;
  c.pending = resolveFeverTrack(sel.track)
    .then((track) => (track ? primeFeverTrack(track) : null))
    .then((url) => {
      if (!url || m.custom.id !== sel.track) return;
      m.custom.url = url;
      m.custom.spec = { url, start: sel.start, end: sel.end };
      if (m.pool[`custom:${url}`] == null) musicElFor(`custom:${url}`, m.custom.spec);
    })
    .catch(() => { /* 回落默认两首 */ })
    .finally(() => { c.pending = null; });
}

/** 这一帧该播哪一首：房间里选了可用的服务器曲目就用它，否则按「五名是否齐全」用默认两首。 */
function chooseMusic(full) {
  const c = state.music.custom;
  if (c.id && c.spec) return { key: `custom:${c.spec.url}`, spec: c.spec };
  const key = full ? 'vocal' : 'inst';
  return { key, spec: MUSIC[key] };
}

/** 压掉场地 BGM（记下原曲目，供 Fever 收尾 / 兜底恢复）。幂等。 */
function muteBgm() {
  const m = state.music;
  if (m.bgmMuted) return;
  const k = (audio && audio.lastBgmKey != null) ? audio.lastBgmKey : null;
  if (k != null && m.prevBgm == null) m.prevBgm = k;
  if (audio && typeof audio.playBgm === 'function') { try { audio.playBgm(null); } catch { /* ignore */ } }
  m.bgmMuted = true;
}

/** 把场地 BGM 放回来（Fever 曲迟迟出不了声的兜底，或 Fever 收尾）。幂等。 */
function restoreBgm() {
  const m = state.music;
  if (!m.bgmMuted) return;
  const prev = m.prevBgm;
  m.bgmMuted = false;
  if (prev != null && audio && typeof audio.playBgm === 'function') { try { audio.playBgm(prev); } catch { /* ignore */ } }
}

/** 停掉当前 Fever 曲并（默认）恢复场地 BGM。`restore=false` 用于换曲前的清理 —— 那时**保留** `prevBgm`。 */
function stopMusic(restore = true) {
  const m = state.music;
  if (m.el) { try { m.el.pause(); } catch { /* ignore */ } }   // 元素留着复用（pool）：不 removeAttribute('src')
  if (restore) { restoreBgm(); m.prevBgm = null; }
}

/** 起播一首 Fever 曲：压低场地 BGM、从 `start` 秒（或上次中断处）起播、音量 0 起（1 秒淡入由 driveMusic 推进）。 */
function startMusic(choice, now) {
  stopMusic(false); // 换曲前的清理：BGM 交给 muteBgm / restoreBgm 统一处理
  if (!choice || !choice.spec) return;
  const spec = choice.spec;
  const m = state.music;
  const el = musicElFor(choice.key, spec);
  if (!el) return;
  m.el = el;
  muteBgm();
  // 上一次这段没播完（Fever 提前结束）⇒ **从上次中断处续播**；整段播完过 / 换了一场战斗 ⇒ 从 `start` 重来。
  const resumeAt = Number.isFinite(m.resume[choice.key]) ? m.resume[choice.key] : spec.start;
  const from = Math.max(spec.start, Math.min(spec.end, resumeAt));
  el.volume = 0;
  m.which = choice.key; m.spec = spec; m.t0 = now; m.fading = false; m.fadeStart = 0;
  m.lastPos = null; m.stuckSince = null;
  // ⚠️ **先定位、再 play**：片段起点是 0 ⇒ 全新的 Fever **不需要 seek**；这一路只服务「同一场内续播」那个
  // 几秒的 `from`（元数据还没到就写 `currentTime = x`，浏览器会把它丢掉，于是从 0 开始播 —— 那只影响续播点）。
  // 所以改在 `loadedmetadata` / `canplay` 里 seek + play（driveMusic 里另有一条守卫，帧帧往后补）。
  m.pendingFrom = from;
  const begin = () => {
    if (m.el !== el) return;                                  // 已经换曲 / 收过尾了
    try { el.currentTime = from; } catch { /* 元数据还没到：交给 driveMusic 的守卫 */ }
    if (Math.abs(el.currentTime - from) < 0.25) m.pendingFrom = null;
    try { const p = el.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* ignore */ }
  };
  if (el.readyState >= 1) begin();
  else {
    try { el.addEventListener('loadedmetadata', begin, { once: true }); } catch { /* ignore */ }
    try { el.addEventListener('canplay', begin, { once: true }); } catch { /* ignore */ }
  }
}

/** 片段**整段播完**之后才允许的「再播一次」：回到起点重播（同一元素，不换 BGM）。 */
function replayMusic(now) {
  const m = state.music;
  const spec = m.spec;
  if (!m.el || !spec) return;
  m.resume[m.which] = null;      // 这一整段已经播完了 ⇒ 续播点作废，下一次从头开始
  m.pendingFrom = null;          // ⚠️ 守卫也要一并作废：否则 driveMusic 每帧会把位置再 seek 回 `end`（见下）
  try { m.el.currentTime = spec.start; } catch { /* ignore */ }
  m.t0 = now;
  m.el.volume = 0;
  try { const p = m.el.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* ignore */ }
}

/**
 * 每帧驱动音乐：Fever 开 ⇒ 按 `full` 选曲起播；到片段末尾 ⇒ **整段播完后**才回到起点重播（Fever 还在时）或淡出
 * 收尾；Fever 结束 ⇒ 1 秒淡出并恢复场地 BGM。淡入淡出用 `volume` 线性斜坡（包内自持 `<audio>`，不依赖 WebAudio 增益图）。
 */
function driveMusic(on, full) {
  const m = state.music;
  const now = nowSec();
  const sel = effectiveFeverMusic();
  const vol = clamp(sel.volume, 0, 1);      // 音量来自本浏览器的设置（房间里也只听自己这份）
  const onNow = on && vol > 0;
  // 换了曲目 / 上次解析没成（`spec` 仍为空）⇒ 重新解析；解析期间不重复发起。
  if (sel.track !== m.custom.id ? !m.custom.pending : sel.track && !m.custom.spec && !m.custom.pending) syncCustom();
  if (onNow && !m.on) startMusic(chooseMusic(full), now);
  else if (!onNow && m.on) {
    if (m.el && !m.fading) {
      // 记下**中断位置**：这一段没播完（确实停在**片段中间**）⇒ 下一次 Fever 从这儿接着播（业主 2026-10-17 裁决）。
      // ⚠️ 判据必须两头都卡住：Fever 时长 == 片段时长（都是 20 s）⇒ 正常结束往往恰好停在 `end`，
      // 若把 `end` 记成续播点，下一次 Fever 会「从 end 起播」→ 立刻触发末尾重播分支 → 整段静音（业主 2026-10-18 报的回归）。
      const pos = Number.isFinite(m.el.currentTime) ? m.el.currentTime : null;
      const sp = m.spec;
      if (pos != null && sp && pos > sp.start + 0.25 && pos < sp.end - 0.25) m.resume[m.which] = pos;
      m.fading = true;
      m.fadeStart = now;
    }
  }
  m.on = onNow;
  const el = m.el;
  if (!el) return;
  const spec = m.spec;
  if (!spec) return;
  // 自动播放门 / 卡顿兜底：**只看「位置有没有在往前走」，不看 `el.paused`** —— `play()` 被挡时返回 rejected
  // promise，某些浏览器在它落地之前 `paused` 已经变回 false，只盯 paused 会漏掉这一种（表现就是整场没声音）。
  // 该响却没在响 ⇒ **每 0.5 s 重试一次 `play()`**（战斗里用户一直在点，下一次手势就能放行）。
  const advancing = m.lastPos == null || el.currentTime > m.lastPos + 1e-4;
  m.lastPos = el.currentTime;
  if (m.on && m.which && !m.fading && !advancing) {
    if (now - m.retryAt > 0.5) {
      m.retryAt = now;
      try { const p = el.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* ignore */ }
    }
  } else m.retryAt = 0;
  // 起播宽限兜底（见 MUSIC_START_GRACE）：迟迟没出声就**先把场地 BGM 放回来**，一旦出声再压掉它。
  if (m.on && !m.fading) {
    if (advancing && el.currentTime > 0.01) muteBgm();
    else if (now - m.t0 > MUSIC_START_GRACE) restoreBgm();
  }
  // 起播定位守卫（见 startMusic）：只服务「同一场内续播」那个几秒的偏移 —— 片段起点是 0，全新的 Fever 不 seek。
  if (Number.isFinite(m.pendingFrom) && el.readyState >= 1) {
    // `seekable` 空（工坊素材路由不宣告 `Accept-Ranges`）时别每帧空转，认输
    const seekableEmpty = !el.seekable || el.seekable.length === 0;
    if (el.currentTime >= m.pendingFrom - 0.25 || seekableEmpty) m.pendingFrom = null;
    else { try { el.currentTime = m.pendingFrom; } catch { /* ignore */ } }
  }
  if (m.fading) {
    const k = 1 - (now - m.fadeStart) / MUSIC_FADE;
    if (k <= 0) { stopMusic(true); return; }
    el.volume = clamp(k, 0, 1) * vol;
    return;
  }
  const pos = Number.isFinite(el.currentTime) ? el.currentTime : spec.start;
  // 到片段末尾：Fever 还在 ⇒ 整段已播完，回起点重播；Fever 已结束 ⇒ 淡出收尾
  if (el.ended || pos >= spec.end) {
    if (!m.on) { m.fading = true; m.fadeStart = now; return; }
    // 回起点重播：`spec.start` = 0 ⇒ 这一步不需要 seek、必定落地。仍留超时兜底 —— 真出不来声就收尾，
    // 别每帧把 `volume` 钉在 0（外层的 grace 兜底会把场地 BGM 放回来）。
    if (m.stuckSince == null) { m.stuckSince = now; replayMusic(now); }
    else if (now - m.stuckSince > 1.5) { m.fading = true; m.fadeStart = now; }
    return;
  }
  m.stuckSince = null;
  const fadeIn = clamp((now - m.t0) / MUSIC_FADE, 0, 1);        // 起播 1 秒淡入
  const fadeOut = clamp((spec.end - pos) / MUSIC_FADE, 0, 1);   // 末尾 1 秒淡出
  el.volume = Math.min(fadeIn, fadeOut) * vol;
}

// ---- 每帧：定位 + 填进度 ------------------------------------------------------------------------------------

/**
 * 取本包战斗模块的**同一实例**（按 URL 去重；与运行器 `import()` 的是同一条 URL ⇒ 同一个模块实例）。
 *
 * `paint()` 是同步的（rAF 回调），所以 `import()` 只**发起一次**、把 Promise 的结果落进记录里；
 * 解析完成之后的帧才读得到 `FEVER_LIVE`（之前先当作「还没到」，`paint` 会因此不画）。
 * @param {string} url
 * @returns {any|null} 已解析的模块，或 null（尚未解析完 / 加载失败 / 没有 url）
 */
function liveModule(url) {
  if (!url) return null;
  let rec = state.mods.get(url);
  if (!rec) {
    rec = { mod: null, ready: false };
    state.mods.set(url, rec);
    import(/* @vite-ignore */ url).then((m) => { rec.mod = m; rec.ready = true; }, () => { rec.ready = true; });
  }
  return rec.ready ? rec.mod : null;
}

/** 本机当前这一场的战斗对象（来自运行器；没有战斗 ⇒ null）。 */
function currentBattle() {
  if (!battleRunner || typeof battleRunner.currentBattle !== 'function') return null;
  return battleRunner.currentBattle() || null;
}

/**
 * 这一场战斗的身份（与包侧 `FEVER_LIVE` 记录里的 `key` 同一条）：只取两处都拿得到的那几项。
 * ⚠️ 不用 `battleId`：包里的 installer 在 Battle 的构造期跑，那时 `battle.battleId` 还没赋值（见 `battle/main.mjs`）。
 * @param {{ fieldId?: any, kind?: any, spec?: any }} b
 * @returns {string}
 */
function battleKeyOf(b) {
  const s = (b && b.spec) || {};
  return `${b && b.fieldId != null ? b.fieldId : ''}|${s.round ?? 0}|${s.seed ?? 1}|${(b && b.kind) || ''}`;
}

/** 本机当前这一场的战斗模块 URL（来自 spec；没有战斗 / 没有本包 ⇒ null）。 */
function battleModuleUrl() {
  const b = currentBattle();
  const list = b && b.spec && Array.isArray(b.spec.workshopBattle) ? b.spec.workshopBattle : null;
  const entry = list ? list.find((m) => m && m.id === PACK_ID) : null;
  return entry && typeof entry.url === 'string' ? entry.url : null;
}

/** 棋盘上带【颂乐人偶】盟约的本机棋子：`{ uid, row, col }`。 */
function members() {
  const priv = state.feed.priv;
  const board = priv && Array.isArray(priv.board) ? priv.board : null;
  if (!board || !state.data) return [];
  const chess = state.data.get('chess');
  if (!chess) return [];
  const out = [];
  for (const p of board) {
    if (!p || p.kind !== 'chess' || !Number.isInteger(p.uid)) continue;
    const rec = chess[p.id];
    if (rec && Array.isArray(rec.bonds) && rec.bonds.includes(BOND_ID)) out.push({ uid: p.uid, row: p.row, col: p.col });
  }
  return out;
}

/**
 * 一枚棋子在屏幕上的锚点（视口坐标）+ 该处一格在屏幕上的高度（用来定图标大小/偏移）。
 *
 * **优先用所在格里子的屏幕位置** `view.tileScreen(row, col)`：单位在战斗里就站在它的 board 格上，格子是**逐棋子**的。
 * 不用 `view.pieceScreenRect(uid)` —— 实测它解析不了战斗单位（两枚在不同格上的棋子会返回**同一个**身体矩形 ⇒
 * 图标全叠在一处）；它只作为没有 `tileScreen` 时的兜底。
 * @param {any} raw 战场视图（`view.raw`）
 * @param {{ uid: number, row?: number, col?: number }} m
 * @returns {{ x: number, y: number, h: number }|null}
 */
function anchorOf(raw, m) {
  if (typeof raw.tileScreen === 'function' && Number.isInteger(m.row) && Number.isInteger(m.col)) {
    let ts = null;
    try { ts = raw.tileScreen(m.row, m.col); } catch { ts = null; }
    if (ts && Number.isFinite(ts.x) && Number.isFinite(ts.y)) {
      const p = Array.isArray(ts.poly) && ts.poly.length >= 4 ? ts.poly : null;
      const h = p ? Math.hypot(p[0][0] - p[3][0], p[0][1] - p[3][1]) : (Number(ts.s) || 60);
      return { x: ts.x, y: ts.y, h: h || 60 };
    }
  }
  if (typeof raw.pieceScreenRect === 'function') {
    let r = null;
    try { r = raw.pieceScreenRect(m.uid); } catch { r = null; }
    if (r && r.width > 0 && r.height > 0) {
      return { x: (r.left + r.right) / 2, y: r.top + r.height, h: r.height * 0.6 };
    }
  }
  return null;
}

/** 把所有被换掉的技力条**恢复原样**（离开战斗 / 离开对局时用）。 */
function clearSpBars(raw) {
  if (typeof raw?.setUnitSpBar === 'function') for (const uid of state.spSet) raw.setUnitSpBar(uid, null);
  state.spSet.clear();
}

function paint() {
  const root = state.root;
  if (!root) return;
  const view = globalThis.__SP_VIEW__;
  const raw = (view && view.raw) || view || null;
  const canAnchor = !!raw && (typeof raw.tileScreen === 'function' || typeof raw.pieceScreenRect === 'function');
  // 换一场战斗（`battleId` 变了）⇒ 续播点作废、上一场那条曲子收掉：新一场的 Fever 必须**从指定秒重新起播**，
  // 不接上一场留下的尾音（业主 2026-10-17）。同一场之内的「中断处续播」照旧（见 driveMusic / startMusic）。
  const b = currentBattle();
  const key = b ? b.battleId : null;
  if (key !== state.battleKey) {
    state.battleKey = key;
    stopMusic(true);
    state.music.resume = {};          // 换场 ⇒ 续播点作废（键按曲目身份，这里整表清空）
    // `on` 也归零：换场时若它还停在 `true`，新一场的 Fever **不会再触发 `startMusic`**（那一支只看 off→on 边沿）
    // —— 那也是「有时听不到音乐」的一条路径。⭐ 同时**预取两首 Fever 曲**（战斗一开始就抓，Fever 触发时不必现下载）。
    state.music.on = false;
    // 上一场那条曲子/片段一并作废：新一场的 `startMusic` 会按当前的设置重新选曲、重新取规格。
    state.music.el = null;
    state.music.which = null;
    state.music.spec = null;
    state.music.lastPos = null;
    state.music.stuckSince = null;
    if (b) preloadMusic();
    state.noteSeen.clear();   // 新一场：音符 id 的「见过」从头算（id 由 sim 侧每场从 1 重新数）
    clearNoteFx();            // 上一场的音符特效一并收掉
  }
  const url = canAnchor ? battleModuleUrl() : null;
  const mod = url ? liveModule(url) : null;

  // 没在战斗 / 没视图 / 本包战斗模块还没到 ⇒ 全部收起（不清表：等下一次条件满足再画）
  // ⚠️ 只认**这一场**写的记录（`key` 相同）：`FEVER_LIVE` 是模块级表、跨战斗不清 —— 上一场在 Fever 进行中
  // 结束时留下的 `on: true` 会被新一场直接当成「Fever 正在开」，于是音乐在战斗一开始就起播、片段播完还
  // `replayMusic` 一直循环（业主 2026-10-20 报的「Fever 音乐在战斗开始后异常出现，需要刷新页面」）。
  const rec = canAnchor && b && mod && mod.FEVER_LIVE && state.feed.myId != null
    ? mod.FEVER_LIVE.byPid[state.feed.myId] : null;
  const live = rec && rec.key === battleKeyOf(b) ? rec : null;
  if (!canAnchor || !live) {
    for (const e of state.els.values()) hide(e);
    hideNotesFrom(0);
    clearNoteFx();               // 官方的音符特效也收掉（不在战斗 / 本包模块还没到）
    if (raw && typeof raw.paintNoteFx === 'function') { try { raw.paintNoteFx(FX_NOTE_KEY, []); } catch { /* ignore */ } }
    clearSpBars(raw);            // Fever 条也一起恢复成成员自己的技力条
    driveMusic(false, false);
    return;
  }

  const list = members();
  const want = new Set(list.map((m) => m.uid));
  for (const [uid, e] of state.els) if (!want.has(uid)) { e.box.remove(); state.els.delete(uid); }

  // 玫红 Fever 条：`on` 时把成员自己的技力条整条换成它，填充 = **共用的 Fever 窗口剩余比例**
  // （`until` 是同一个时间点 ⇒ 所有成员同一条进度、同时走完 ⇒ 同时结束）；`on` 为假 ⇒ null（恢复自己的技力条）。
  const canBar = typeof raw.setUnitSpBar === 'function';
  const dur = Number(live.len) > 0 ? Number(live.len) : 20;
  const now = b && Number.isFinite(b.time) ? b.time : null;
  const bars = !!live.on && Number.isFinite(Number(live.until)) && now != null
    ? { tint: FEVER_ROSE, fill: clamp((Number(live.until) - now) / dur, 0, 1) }
    : null;
  const barsWanted = new Set();
  const driveBar = (uid) => {
    if (!canBar) return;
    raw.setUnitSpBar(uid, bars);
    if (bars) barsWanted.add(uid);
  };

  const cap = Number(live.cap) > 0 ? Number(live.cap) : 450;
  const ratio = Math.max(0, Math.min(1, (Number(live.fever) || 0) / cap));
  for (const m of list) {
    const a = anchorOf(raw, m);
    driveBar(m.uid);
    if (!a || !(a.h > 0)) { const e = state.els.get(m.uid); if (e) hide(e); continue; }
    const size = Math.max(16, Math.min(32, Math.round(a.h * SIZE_RATIO)));
    const e = elementFor(m.uid);
    e.box.style.display = '';
    e.box.style.width = `${size}px`;
    e.box.style.height = `${size}px`;
    e.box.style.left = `${Math.round(a.x + a.h * ANCHOR_RIGHT)}px`;
    e.box.style.top = `${Math.round(a.y + a.h * ANCHOR_BOTTOM - size)}px`;
    // 满态切片：壳的高度 = Fever 比例（底部对齐 ⇒ 品红自下而上）
    if (e.fillwrap) e.fillwrap.style.height = `${(ratio * 100).toFixed(1)}%`;
  }
  // 这一帧不再需要（Fever 结束 / 成员退场）的那些，恢复成它们自己的技力条
  if (typeof raw.setUnitSpBar === 'function') for (const uid of state.spSet) if (!barsWanted.has(uid)) raw.setUnitSpBar(uid, null);
  state.spSet = barsWanted;

  // 按「五名是否齐全」驱动 Fever 音乐（Fever 的特殊技能条是**全员共用**的那条 —— 就是上面每名成员身上的
  // 连音符 Fever 图标；成员自身的技力条在 Fever 期间被换成玫红那一条，见 FEVER_ROSE / setUnitSpBar）
  driveMusic(!!live.on, !!live.full);
  // 丰川祥子的「颂乐音符」：自建弹道引擎不渲染，按 `NOTES_LIVE` 的世界坐标自己画
  paintNotes(raw, mod);
}

/**
 * 面板挂载：在对局屏根部的 `.mod-host`（`screen.game.overlay`）里建一层**不吃指针**的全屏层，
 * 用 `requestAnimationFrame` 每帧把图标贴到各成员身上。
 * @param {{ host: any, data: any }} ctx
 * @returns {{ unmount?: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  if (!host || typeof host.appendChild !== 'function') return {};
  if (!state.data) state.data = ctx.data;
  const root = document.createElement('div');
  root.className = `${CLS}-layer`;
  root.setAttribute('aria-hidden', 'true');
  host.appendChild(root);
  state.root = root;
  // 音符层（颂乐音符：自建弹道引擎不渲染，自己画）
  const noteRoot = document.createElement('div');
  noteRoot.className = `${CLS}-layer`;
  noteRoot.setAttribute('aria-hidden', 'true');
  host.appendChild(noteRoot);
  state.noteRoot = noteRoot;
  const tick = () => { state.raf = requestAnimationFrame(tick); paint(); };
  state.raf = requestAnimationFrame(tick);
  return {
    unmount() {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
      const view = globalThis.__SP_VIEW__;
      clearSpBars((view && view.raw) || view || null); // 玫红 Fever 条恢复成成员自己的技力条
      state.root = null;
      state.noteRoot = null;
      for (const e of state.els.values()) e.box.remove();
      state.els.clear();
      hideNotesFrom(0);
      for (const e of state.noteEls) { e.trail.remove(); e.head.remove(); }
      state.noteEls.length = 0;
      state.noteSeen.clear();
      clearNoteFx();
      stopMusic(true); // 离开对局：收掉 Fever 曲并恢复场地 BGM
      state.music.resume = {}; // 离开对局 ⇒ 续播点作废
      state.music.on = false;                           // 同理归零：下次进入对局的 Fever 才能重新起播
    },
  };
}
