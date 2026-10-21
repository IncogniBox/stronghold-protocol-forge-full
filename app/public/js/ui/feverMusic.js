// Fever 音乐（颂乐人偶 mod）的客户端偏好：音量、房间同步的曲目/片段、服务器音乐库与可 seek 的播放 URL。
//
// 三个来源，各管一半：
//   * **房间**（`room.state.feverMusic`，房主在开局前设）—— 曲目与起止秒数，全员一致；没设过 = 包内默认两首；
//   * **本浏览器**（`sp.pref.feverMusic`）—— 音量，以及「不在房间里」时自己的曲目/片段；
//   * **服务器音乐库**（`GET /api/music`）—— 官方 BGM 与已装工坊包 `assets/bgm` 的只读清单。
//
// 工坊素材路由（`/workshop-assets/**`）不宣告 `Accept-Ranges`，直接对 `<audio>` seek 可能落不下去；
// 所以工坊曲目先整段抓成 Blob URL（`primeTrack`），官方曲目走原 URL（静态路由支持 206）。
import { loadPref, savePref, store } from '../store.js';

export const FEVER_VOLUME_DEFAULT = 1;
export const FEVER_MIN_SEGMENT = 0.5;
export const FEVER_MAX_SEGMENT = 600;
export const FEVER_MAX_SECONDS = 3600;
const PREF = 'feverMusic';
const MUSIC_URL = '/api/music';
const LIBRARY_TTL_MS = 60_000;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round1 = (n) => Math.round(n * 10) / 10;
const TRACK_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** 本地偏好（`sp.pref.feverMusic`）的内存副本；首次读盘后一直复用。 */
let local = null;
const listeners = new Set();

/** 音乐库（`GET /api/music`）的缓存与单飞 Promise。 */
let library = null;
let libraryAt = 0;
let libraryPromise = null;

/** 工坊曲目的 Blob 缓存：url → { url: string|null, promise: Promise<string|null> }。 */
const blobCache = new Map();

/**
 * 把一份存下来的 Fever 设置收成合法值。
 * 曲目 id 形状不对、或片段不是「0 ≤ start < end、0.5–600 秒」⇒ 整条回落默认（宁可放包内两首，也不放错片段）。
 * @param {any} raw
 * @returns {{ track: string|null, start: number, end: number, volume: number }}
 */
export function sanitizeFeverMusic(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? clamp01(r.volume) : FEVER_VOLUME_DEFAULT;
  const track = typeof r.track === 'string' && TRACK_ID_RE.test(r.track) ? r.track : null;
  if (!track) return { track: null, start: 0, end: 0, volume };
  const start = Number.isFinite(r.start) ? round1(typeof r.start === 'number' ? r.start : NaN) : NaN;
  const end = Number.isFinite(r.end) ? round1(typeof r.end === 'number' ? r.end : NaN) : NaN;
  if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= FEVER_MAX_SECONDS
    && end > start && end - start >= FEVER_MIN_SEGMENT && end - start <= FEVER_MAX_SEGMENT)) {
    return { track: null, start: 0, end: 0, volume };
  }
  return { track, start, end, volume };
}

/** 本浏览器的 Fever 设置（音量 + 不在房间时自己的曲目/片段）。 */
export function getFeverMusic() {
  if (!local) {
    let raw;
    try { raw = loadPref(PREF, null); } catch { raw = null; }
    local = sanitizeFeverMusic(raw);
  }
  return { ...local };
}

/** 改本浏览器的设置并把音量变化立刻通知订阅者（面板 / 对话框）。 */
export function saveFeverMusic(patch) {
  const next = sanitizeFeverMusic({ ...getFeverMusic(), ...(patch || {}) });
  local = next;
  try { savePref(PREF, next); } catch { /* 隐私模式：本次会话仍然生效 */ }
  for (const fn of listeners) { try { fn({ ...next }); } catch { /* ignore */ } }
  return { ...next };
}

/** 订阅本浏览器设置的变化（房间那份走 store 的 `room.state`，不在这里）。 */
export function subscribeFeverMusic(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 房间同步的那一份（`room.state.feverMusic`），形状不对 / 没设过 ⇒ null（= 包内默认两首）。 */
export function roomFeverMusic(room) {
  const f = room && room.feverMusic;
  if (!f || typeof f.track !== 'string' || !TRACK_ID_RE.test(f.track)) return null;
  const start = Number(f.start);
  const end = Number(f.end);
  if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= FEVER_MAX_SECONDS
    && end > start && end - start >= FEVER_MIN_SEGMENT && end - start <= FEVER_MAX_SEGMENT)) return null;
  return { track: f.track, start: round1(start), end: round1(end) };
}

/**
 * 这一帧真正生效的 Fever 音乐：在房间里 ⇒ 曲目/片段取房间那份（没设过 = 默认），音量永远取本浏览器；
 * 不在房间 ⇒ 本浏览器的那一份。
 * @param {any} [room] 缺省读 `store.get().room`
 * @returns {{ track: string|null, start: number, end: number, volume: number, room: boolean }}
 */
export function effectiveFeverMusic(room = store.get().room) {
  const own = getFeverMusic();
  if (!room || typeof room !== 'object') return { ...own, room: false };
  const inRoom = roomFeverMusic(room);
  // 房间**还没设过**（刚建的单人局 / 房主还没动过）：用本浏览器自己那份 —— 玩家在大厅选的曲目不该一进房就被丢回默认两首。
  // 房主进房后会把这份选择推成房间设置（`FeverMusicSection` 的同步 effect），所以全房仍按房主那一份走。
  if (!inRoom) return { ...own, room: true };
  return { track: inRoom.track, start: inRoom.start, end: inRoom.end, volume: own.volume, room: true };
}

/** 秒数 → `m:ss`（面板 / 对话框的时长）。 */
export function formatSeconds(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 服务器音乐库（官方 BGM + 工坊包 bgm）。失败时返回上一次结果（或空表），不抛 —— 对话框负责说「加载失败」。
 * @param {{ force?: boolean }} [o]
 */
export function musicLibrary({ force = false } = {}) {
  const now = Date.now();
  if (!force && library && now - libraryAt < LIBRARY_TTL_MS) return Promise.resolve(library);
  if (!force && libraryPromise) return libraryPromise;
  libraryPromise = fetch(MUSIC_URL, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => {
      const list = Array.isArray(j?.tracks) ? j.tracks.filter((t) => t && typeof t.id === 'string' && typeof t.url === 'string') : [];
      library = list;
      libraryAt = Date.now();
      return list;
    })
    .catch(() => library || [])
    .finally(() => { libraryPromise = null; });
  return libraryPromise;
}

/** 库里按 id 找一曲（没加载过 / 找不到 ⇒ null）。 */
export function findFeverTrack(id) {
  if (!id || !library) return null;
  return library.find((t) => t.id === id) || null;
}

/** 按 id 解析曲目（必要时拉一次音乐库）；找不到 ⇒ null。 */
export async function resolveFeverTrack(id) {
  if (!id) return null;
  const list = await musicLibrary();
  return list.find((t) => t.id === id) || null;
}

/**
 * 这一曲现在能不能同步拿到一个**可 seek** 的 URL：
 *   * 官方曲目（静态路由支持 Range）⇒ 原 URL；
 *   * 工坊曲目 ⇒ 整段抓好的 Blob URL（`primeFeverTrack` 之后），没抓完时 null（调用方回落默认两首）。
 * @param {{ kind?: string, url?: string }|null} track
 */
export function feverTrackUrl(track) {
  if (!track || typeof track.url !== 'string') return null;
  if (track.kind !== 'workshop') return track.url;
  return blobCache.get(track.url)?.url || null;
}

/**
 * 预取一首曲目的可播放 URL。官方曲目直接返回；工坊曲目整段 `fetch` 成 Blob（页面内缓存一份）。
 * @param {{ kind?: string, url?: string }|null} track
 * @returns {Promise<string|null>}
 */
export function primeFeverTrack(track) {
  if (!track || typeof track.url !== 'string') return Promise.resolve(null);
  if (track.kind !== 'workshop') return Promise.resolve(track.url);
  let rec = blobCache.get(track.url);
  if (!rec) {
    rec = { url: null, promise: null };
    rec.promise = fetch(track.url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((blob) => { rec.url = URL.createObjectURL(blob); return rec.url; })
      .catch(() => null);
    blobCache.set(track.url, rec);
  }
  return rec.promise;
}
