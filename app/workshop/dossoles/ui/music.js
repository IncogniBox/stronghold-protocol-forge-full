// workshop/dossoles/ui/music.js —— 多索雷斯包的对局音乐面板（`pack.json.client.panels[]`，`screen.game.overlay`）。
//
// 作用只有一件：**场上 4 名【多索雷斯】成员**时，把对局 BGM 换成本包自带的「多索雷斯假日」，人数掉下去就换回来。
//
// 判断从哪来：本包的战斗模块（`battle/main.mjs`，浏览器里跑的是同一份 `server.battle`）在盟约 installer 里
// 每 0.25 s 写一次 `DOS_LIVE`；面板用**与战斗运行器同一条 URL** `import()` 它（ES module 按 URL 去重 ⇒ 同一个
// 实例），读到的就是本场实时状态。不另建一条「客户端自己数人数」的真相。
//
// 播放方式：本包自己没有音频通道（`pack.json` 的 `art.audio` 不存在），所以照 `ave-mujica` 的 Fever 曲那套
// 做法 —— 一个长期复用的 `<audio>`（走 `media-src 'self'`，同源 mp3），开始时 `audio.playBgm(null)` 压掉引擎的
// 对局 BGM，结束时把原曲还回去。淡入淡出只动元素音量，不依赖 WebAudio 增益图。

import { battleRunner } from '/js/battle/runner.js';
import { audio } from '/js/audio.js';

const PACK_ID = 'dossoles';
const TRACK = `/workshop-assets/${PACK_ID}/bgm/dossoles_holiday.mp3`;
const VOLUME = 0.55;
const POLL_MS = 500;

/** 本面板自持的播放器（模块级：换一局仍复用同一个元素，`play()` 不再重新过自动播放门）。 */
let el = null;
let on = false;
let prevBgm = null;
let fadeTimer = 0;

function player() {
  if (!el) {
    el = new Audio(TRACK);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
  }
  return el;
}
/** 线性调到 `target` 音量；到 0 时暂停。 */
function fadeTo(target) {
  const a = el;
  if (!a) return;
  clearInterval(fadeTimer);
  fadeTimer = setInterval(() => {
    const d = target - a.volume;
    if (Math.abs(d) <= 0.04) {
      a.volume = target;
      clearInterval(fadeTimer);
      if (target === 0) { try { a.pause(); } catch { /* ignore */ } }
      return;
    }
    a.volume = Math.max(0, Math.min(1, a.volume + d * 0.25));
  }, 60);
}
function start() {
  if (on) return;
  on = true;
  prevBgm = audio.lastBgmKey != null ? audio.lastBgmKey : null;
  try { audio.playBgm(null); } catch { /* ignore */ }
  const a = player();
  a.volume = 0;
  try { const p = a.play(); if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放门：下一次手势再试 */ }); } catch { /* ignore */ }
  fadeTo(VOLUME);
}
function stop() {
  if (!on) return;
  on = false;
  fadeTo(0);
  const prev = prevBgm;
  prevBgm = null;
  if (prev != null) { try { audio.playBgm(prev); } catch { /* ignore */ } }
}

/** 这一帧的「场上是否 4 名」：从本包战斗模块的同一个实例读 `DOS_LIVE`。 */
async function want() {
  try {
    const b = battleRunner.currentBattle && battleRunner.currentBattle();
    const list = b && b.spec && Array.isArray(b.spec.workshopBattle) ? b.spec.workshopBattle : null;
    const entry = list ? list.find((m) => m && m.id === PACK_ID) : null;
    if (!entry || typeof entry.url !== 'string') return false;
    const mod = await import(entry.url);
    return !!(mod && mod.DOS_LIVE && mod.DOS_LIVE.on);
  } catch { return false; }
}

/**
 * 面板挂载（引擎对 `client.panels[]` 的契约：导出 `mount(ctx)`，返回的 `unmount()` 在离开这一屏时调用）。
 * @returns {{ unmount: () => void }}
 */
export function mount() {
  let live = true;
  const tick = async () => {
    if (!live) return;
    const yes = await want();
    if (!live) return;
    if (yes && !on) start();
    else if (!yes && on) stop();
    // 自动播放门兜底：该响却没在往前走 ⇒ 下一次轮询再点一次 `play()`（战斗里玩家一直在操作，很快就会放行）。
    else if (yes && on && el && el.paused) {
      try { const p = el.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch { /* ignore */ }
    }
  };
  tick();
  const timer = setInterval(tick, POLL_MS);
  return {
    unmount() {
      live = false;
      clearInterval(timer);
      clearInterval(fadeTimer);
      stop();
      if (el) { try { el.pause(); } catch { /* ignore */ } }
    },
  };
}
