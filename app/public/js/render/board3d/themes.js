// render/board3d/themes.js — the 3D board's themes (DESIGN §15): a theme swaps the **backdrop** (the plane behind the
// board), the **mood** (clear colour / fog / hemisphere light / backdrop brightness), and — when it carries an `atlas`
// — the **tile textures** themselves (its own diffuse / emission / device atlases + the rects that dress each surface).
//
// Without an `atlas` a theme keeps the official autochess tile atlas: every map theme's atlas has its own layout and
// its own size (a stage theme's TX_<Theme>_D is 1024², the board's TX_autochessi_D is 2048²), and board3d/atlas.js
// SURFACES was picked off the autochess atlas by eye — dressing tiles with another theme's atlas would smear them.
// A theme that DOES carry one lists the rects it needs, picked off its own atlas exactly the way
// tools/crop-board-atlas.mjs picked the autochess ones (the rects are in that atlas' own pixels).
//
//   bg     = [manifest group, image name] of the backdrop (optional at runtime: a theme whose image is not installed
//            keeps the plain colour backdrop)
//   mood   = the theme's lighting override (scene.js LIGHTING), null for the official rig: any of
//            { clear, fog, hemiSky, hemiGround, bgColor, keyIntensity } — keyIntensity because a night-time atlas
//            (天镜阁 averages 18–79/255) needs a stronger key light or the board reads as black
//   atlas  = { d, e, n, r, common, commonE: manifest image names of this theme's atlases (e/n/r/common/commonE
//              optional; n / r are the DERIVED _rgb / _rough maps, tools/local-extract DERIVED),
//              wood: [image name, w, h] optional — this theme's OWN high-ground material (a whole image, not a crop)
//              sources: { D: { w, h } } — the pixel size of the atlas each src is measured in (surfaceUV divides by it;
//                         the shape is board3d/atlas.js SOURCES' one),
//              surfaces: { <board3d/atlas.js surface name>: { src, rect: [x, y, w, h], rot?, flipX? } } }
//
// The DISPLAY LABELS are deliberately not here: the map designer's i18n dictionary is keyed by Chinese source strings
// that must appear in its own UI files (a dictionary entry no page uses is a failure), so the designer owns them
// (stage3d.js THEME_LABELS) and this module stays pure data.

export const DEFAULT_BOARD_THEME = 'autochess';

/**
 * SideStory「辞岁行」的两张图集各切了 8×8 格、每格 128px（autochess 那张是 8×8、每格 256px）。
 *
 * 注意：这两张 `_D` **不是「一格一种地表」的图集** —— 里面是大块地表/岩石/木纹/字格面板，而且边界不对齐 128px 网格。
 * 所以下面的矩形是**逐块裁图核对过**的（先按 8×8 网格猜、再把裁出来的块放大看，偏了就改坐标），每块都能平铺：
 * 把 20 多个「地表」映射到每张图集里少数几块干净的贴图上，让整张棋盘是那个主题的材质。
 */
const SKYMIRROR_R = Object.freeze({
  navy: [0, 0, 128, 128],        // 素深蓝石面（细微波纹）—— 天镜阁的地面：**一块砖一整块石头**，没有画上去的格子
  dark: [896, 384, 128, 128],    // 深蓝波浪镜面 —— 侧壁 / 与地面区分开的变体面
  wood: [790, 256, 100, 100],    // 红棕木板 —— 高台（参考图里的木板走道）
  grid: [640, 448, 128, 128],    // 3×3 银框格板 —— 玻璃栅格（不是地面！店主：「还是方格的地板」）
  zige: [896, 0, 128, 128],      // 红框字格板（参考图里那些发光的字格）—— 禁部署区/目标点
  shelf: [0, 256, 128, 128],     // 蓝条纹书架 —— 升降台
  brown: [896, 258, 60, 60],     // 素红棕块 —— 货箱
});
const SKYMIRROR_SURFACES = Object.freeze({
  concrete: 'navy', concreteRailTL: 'navy', concreteRailT: 'navy', concreteRailL: 'navy',
  concreteStripe: 'dark', concreteArrow: 'dark', concreteRed: 'zige',
  // `hatch` 在官方棋盘上同时是「低地可部署的地面 f / 预览围栏 p」和「抬高的阻隔块 #」——一个面名两种用途。
  // 低地那批不该看起来像画上去的格子，所以给它素石面；X（高台）已拆成 blockX，顶面走 atlas.wood 那条木板通道。
  hatch: 'navy', blockX: 'navy', lift: 'shelf', ringHatch: 'zige',
  slats: 'dark', mech: 'dark', steel: 'navy',
  plateL: 'wood', plateM: 'wood', plateR: 'wood', plateS: 'wood',
  padReinf: 'navy', padEquip: 'grid',
  goldSide: 'dark', graySide: 'dark', benchRail: 'dark', restPanel: 'dark', evacPanel: 'dark',
  pipePanel: 'dark', crateSide: 'brown', crateTop: 'brown',
});
const SUILING_R = Object.freeze({
  ground: [636, 256, 80, 80],    // 平坦暗棕地面 —— 道路
  redrock: [128, 0, 128, 128],   // 斑驳红岩（细密、无方向）
  mason: [8, 196, 64, 64],       // 浅色石砌的干净一小块 —— 高台
  dark: [16, 336, 60, 60],       // 深色雕花墙的一小块 —— 侧壁
  panel: [520, 200, 64, 64],     // 红框暗板 —— 目标点/栅格
});
const SUILING_SURFACES = Object.freeze({
  concrete: 'ground', concreteRailTL: 'ground', concreteRailT: 'ground', concreteRailL: 'ground',
  concreteStripe: 'mason', concreteArrow: 'mason', concreteRed: 'redrock',
  hatch: 'panel', lift: 'mason', ringHatch: 'panel',
  slats: 'dark', mech: 'dark', steel: 'mason',
  plateL: 'mason', plateM: 'mason', plateR: 'mason', plateS: 'mason',
  padReinf: 'mason', padEquip: 'dark',
  goldSide: 'dark', graySide: 'dark', benchRail: 'dark', restPanel: 'dark', evacPanel: 'dark',
  pipePanel: 'dark', crateSide: 'redrock', crateTop: 'redrock',
});

/** Rect key → surface record: `{ concrete: 'slate', … }` read against that theme's rect table. */
function toSurfaces(rects, names) {
  const out = {};
  for (const [k, n] of Object.entries(names)) out[k] = { src: 'D', rect: rects[n] };
  return out;
}

export const BOARD_THEMES = Object.freeze({
  autochess: Object.freeze({
    bg: Object.freeze(['map/autochess', 'TX_autochessi_BG']),
    mood: null,
    atlas: null,
  }),
  // SideStory「辞岁行」的两个作战场地（炎国 飞雪天镜 / 炎国 岁陵），taken from the local client's map themes
  // (tools/local-extract/extract.py JOBS).
  skymirror: Object.freeze({
    bg: Object.freeze(['map/skymirror', 'TX_SkyMirror_background']),
    mood: Object.freeze({ clear: 0x060a12, fog: 0x060a12, hemiSky: 0xc6d4e6, hemiGround: 0x40495a, bgColor: 1, keyIntensity: 6.4 }),
    atlas: Object.freeze({
      d: 'TX_SkyMirror_D', e: 'TX_SkyMirror_E',
      n: 'TX_SkyMirror_N_rgb', r: 'TX_SkyMirror_M_rough',
      // 天镜阁的高台是一整片木板：用这张材质图（1024² 纯木纹）当高台顶面，而不是从 _D 切一小块重复平铺
      // （用户参考图：「整片大木板」）。它是 [图名, 宽, 高]。
      wood: Object.freeze(['TX_SkyMirror_Wood_D', 1024, 1024]),
      // 哪种「面」用这张木板图：抬高的方块里 surface 是 blockX 的那些 —— 那是 X（高台 / 竞技场块），
      // #（阻隔块 / 分隔带）保持深色。官方棋盘上 X 与 # 本是同一块贴图，我拆成了两个面名（atlas.js `blockX`）。
      woodOn: Object.freeze(['blockX']),
      common: 'TX_SkyMirror_common_D', commonE: 'TX_SkyMirror_common_E',
      sources: Object.freeze({ D: Object.freeze({ w: 1024, h: 1024 }) }),
      surfaces: Object.freeze(toSurfaces(SKYMIRROR_R, SKYMIRROR_SURFACES)),
    }),
  }),
  suilingcave: Object.freeze({
    bg: Object.freeze(['map/suilingcave', 'TX_SuilingCave_BG']),
    mood: Object.freeze({ clear: 0x120c08, fog: 0x120c08, hemiSky: 0xd9c3a8, hemiGround: 0x2a1d16, bgColor: 0.9, keyIntensity: 3.1 }),
    atlas: Object.freeze({
      d: 'TX_SuilingCave_D', e: 'TX_SuilingCave_E',
      n: 'TX_SuilingCave_N_rgb', r: 'TX_SuilingCave_M_rough',
      common: 'TX_SuilingCave_common_D', commonE: 'TX_SuilingCave_common_E',
      sources: Object.freeze({ D: Object.freeze({ w: 1024, h: 1024 }) }),
      surfaces: Object.freeze(toSurfaces(SUILING_R, SUILING_SURFACES)),
    }),
  }),
});

/** Theme ids in declaration order (the editor's picker order). */
export const BOARD_THEME_IDS = Object.freeze(Object.keys(BOARD_THEMES));

/** The theme record of `id`, falling back to the default one for an unknown id. */
export function boardTheme(id) {
  return BOARD_THEMES[id] || BOARD_THEMES[DEFAULT_BOARD_THEME];
}
