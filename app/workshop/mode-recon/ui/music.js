// workshop/mode-recon/ui/music.js —— 重构模拟的**首领战斗音乐**（`pack.json.client.panels` 的 `screen.game.overlay` 面板）。
//
// 业主 2026-10-28：给每只·重构首领配上自己的战斗曲（文件在 `assets/bgm/`，源文件按回合分目录给的；霜星的
// 「绝对零度」在源目录 12 里，但按**首领**认，不看目录）。杰斯顿有两首（王妃 / 铁手），每局随机挑一首。
//
// 怎么知道现在场上是哪只：本包的战斗模块（`battle/main.mjs`，浏览器里跑的是同一份 `server.battle`）每个 tick 写
// `RECON_MUSIC.key`；这里用**与战斗运行器同一条 URL** `import()` 它（ES module 按 URL 去重 ⇒ 同一个实例），
// 读到的就是本场实时状态 —— 与多索雷斯包的 `DOS_LIVE` 同一做法。
//
// 播放方式：一个长期复用的 <audio>（同源 mp3，走 `media-src 'self'`），接进 `audio.bgmGain`（音乐音量 / 静音沿用
// 游戏设置）。开播前 `audio.playBgm(null)` 压掉引擎的对局 BGM，首领离开 / 战斗结束把当前阶段该有的引擎 BGM 还回去
// （按 `bgmKeyFor` 现算，不缓存旧 key —— 阶段可能已经换了）。引擎自己又起 BGM 时，下一次轮询再压一次。
//
// 没有曲目的首领（碎骨 / 庞贝 / 萨卡兹百夫长…）不接管，引擎原本的战斗音乐照旧。

import { battleRunner } from '/js/battle/runner.js';
import { audio, bgmKeyFor, combatTrackFor } from '/js/audio.js';
import { store, selectRoute } from '/js/store.js';

const PACK_ID = 'mode-recon';
const BGM_BASE = `/workshop-assets/${PACK_ID}/bgm/`;
const POLL_MS = 400;
/** 战斗中会响的相位（引擎的 boss / combat 两档）。 */
const BATTLE_PHASES = new Set(['COMBAT', 'FINAL_ASSAULT', 'HIDDEN_CORE']);

/**
 * 首领 key → 曲目文件（与 `battle/main.mjs` 的 MUSIC_BOSSES 同一份名单）。成对 / 成组的首领共用一首：
 * 腐败 + 凋零 = 光芒的重量；梅菲斯特 + 浮士德 = 落子无悔；岁的四个部位 = 千秋岁；洛伦茨 + 源阶方 = 谬因&源阶方；
 * AMa-10 与异构体 = 协议空间。**“终始”单独一首（诺言）** —— R21 的 AMa 组按战场分开，各自听到自己那只的曲子。
 */
const TRACKS = {
  // R4
  enemy_ws_recon_cqbw: 'r4_w.mp3',
  enemy_ws_recon_mousek: 'r4_mousek.mp3',
  enemy_ws_recon_mdrock: 'r4_mdrock.mp3',
  // R8
  enemy_ws_recon_dekght: 'r8_knights.mp3',
  enemy_ws_recon_dekght_2: 'r8_knights.mp3',
  enemy_ws_recon_blkswb: 'r8_blkswb.mp3',
  enemy_ws_recon_xi: 'r8_xi.mp3',
  enemy_ws_recon_mephi: 'r8_mephi_faust.mp3',
  enemy_ws_recon_faust: 'r8_mephi_faust.mp3',
  enemy_ws_recon_frstar2: 'r12_frstar2.mp3',
  // R12
  enemy_ws_recon_reid: 'r12_reid.mp3',
  enemy_ws_recon_patrt: 'r12_patrt.mp3',
  enemy_ws_recon_talula: 'r12_talula.mp3',
  enemy_ws_recon_mirbst: 'r12_mirbst.mp3',
  // R16
  enemy_ws_recon_dirctr: 'r16_dirctr.mp3',
  enemy_ws_recon_bldkgt: 'r16_bldkgt.mp3',
  enemy_ws_recon_dywqgs: 'r16_dywqgs.mp3',
  enemy_ws_recon_morphis: 'r16_morphis.mp3',
  enemy_ws_recon_mandra: 'r16_mandra.mp3',
  // R20
  enemy_ws_recon_bsnake: 'r20_bsnake.mp3',
  enemy_ws_recon_syskad: 'r20_syskad.mp3',
  enemy_ws_recon_shchmr: 'r20_shchmr.mp3',
  enemy_ws_recon_dycyue: 'r20_dycyue.mp3',
  enemy_ws_recon_skzjkl: 'r20_skzjkl.mp3',
  // R21
  enemy_ws_recon_csdoll: 'r21_csdoll.mp3',
  enemy_ws_recon_skzamy: 'r21_skzamy.mp3',
  enemy_ws_recon_muama: 'r21_muama.mp3',
  enemy_ws_recon_mutwin: 'r21_muama.mp3',
  enemy_ws_recon_musnake: 'r21_musnake.mp3',
  enemy_ws_recon_suisho: 'r21_suisho.mp3',
  enemy_ws_recon_suizzh: 'r21_suisho.mp3',
  enemy_ws_recon_suiyzh: 'r21_suisho.mp3',
  enemy_ws_recon_suiwei: 'r21_suisho.mp3',
  enemy_ws_recon_shophm: 'r21_shophm.mp3',
  enemy_ws_recon_shorbb: 'r21_shophm.mp3',
};

/** 有两首的首领：每局（按 battleId）随机挑一首，中途不换。 */
const ALTERNATIVES = {
  enemy_ws_recon_jakill: ['r8_jakill_a.mp3', 'r8_jakill_b.mp3'],
};

/** battleId → 随机挑中的那首（只记本页面，规模与对局数同阶）。 */
const altPicks = new Map();

let el = null;
let srcNode = null;
let holding = false;
let currentFile = '';
let currentKey = null;

function trackFor(key, battleId) {
  const alts = ALTERNATIVES[key];
  if (alts) {
    const seen = altPicks.get(battleId);
    if (seen && alts.includes(seen)) return seen;
    const pick = alts[Math.floor(Math.random() * alts.length)] || alts[0];
    altPicks.set(battleId, pick);
    return pick;
  }
  return TRACKS[key] || null;
}

/** 当前阶段引擎该放的那条 BGM（把音乐还回去时现算，阶段可能已经换了）。 */
function engineKeyNow() {
  const s = store.get();
  const pub = s.match && s.match.public;
  return bgmKeyFor(selectRoute(s), pub, combatTrackFor(pub && pub.round));
}

function player() {
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.addEventListener('error', () => { currentFile = ''; stop(); });
  }
  return el;
}

/** 把 <audio> 接进游戏的音乐增益（音量 / 静音跟随设置）；没有音频上下文时返回 false，下一次轮询再试。 */
function attach() {
  if (srcNode) return true;
  if (!audio.ctx || !audio.bgmGain) return false;
  try {
    srcNode = audio.ctx.createMediaElementSource(player());
    srcNode.connect(audio.bgmGain);
    return true;
  } catch {
    return false;
  }
}

function takeOver() {
  if (holding) return;
  holding = true;
  try { audio.playBgm(null); } catch { /* ignore */ }
  // 首领曲接管**其他所有音乐**（业主 2026-10-29）：战斗自定曲（ui/battleMusic.js）让路；
  // 多索雷斯 / 颂乐人偶 Fever 那两个例外不覆盖，只把自己压到 50%。
  try { audio.setBossMusic(true); } catch { /* ignore */ }
}

function start(file, key) {
  const a = player();
  takeOver();
  if (currentFile !== file) {
    currentFile = file;
    a.src = BGM_BASE + file;
  }
  currentKey = key;
  if (!attach()) return; // 没有音频上下文：等下一次手势 / 轮询
  if (a.paused) {
    try {
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放门：下一次轮询再试 */ });
    } catch { /* ignore */ }
  }
}

function stop() {
  currentKey = null;
  if (el && !el.paused) { try { el.pause(); } catch { /* ignore */ } }
  try { audio.setBossMusic(false); } catch { /* ignore */ }
  if (!holding) return;
  holding = false;
  try { audio.playBgm(engineKeyNow()); } catch { /* ignore */ }
}

/** 本场战斗里本包的模块（`spec.workshopBattle` 的 `{ id, url }`，与运行器同一个 URL）。 */
function battleModule(b) {
  const list = b && b.spec && Array.isArray(b.spec.workshopBattle) ? b.spec.workshopBattle : null;
  return (list && list.find((m) => m && m.id === PACK_ID && typeof m.url === 'string')) || null;
}

async function tick() {
  const s = store.get();
  const pub = s.match && s.match.public;
  const b = battleRunner.currentBattle();
  const entry = battleModule(b);
  if (!pub || !pub.recon || !entry || !BATTLE_PHASES.has(pub.phase)) return stop();
  let key = null;
  try {
    const mod = await import(entry.url);
    key = mod && mod.RECON_MUSIC ? mod.RECON_MUSIC.key : null;
  } catch { key = null; }
  const file = key ? trackFor(key, b.battleId) : null;
  if (!file) return stop();
  if (holding && audio.lastBgmKey != null) {
    // 引擎在首领曲响着的时候又想开 BGM（阶段事件）：再压一次
    try { audio.playBgm(null); } catch { /* ignore */ }
  }
  start(file, key);
}

/**
 * 面板挂载（引擎对 `client.panels[]` 的契约：导出 `mount(ctx)`，返回的 `unmount()` 在离开这一屏时调用）。
 * @returns {{ unmount: () => void }}
 */
export function mount() {
  let live = true;
  const run = () => { if (live) tick().catch(() => {}); };
  run();
  const timer = setInterval(run, POLL_MS);
  return {
    unmount() {
      live = false;
      clearInterval(timer);
      stop();
      if (el) { try { el.pause(); } catch { /* ignore */ } }
    },
  };
}
