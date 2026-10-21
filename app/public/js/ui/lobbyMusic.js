import { PHASE } from '../../../shared/constants.js';
import { html, Button, Modal } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute, useStore } from '../store.js';
import { net } from '../net.js';
import { effectiveFeverMusic, getFeverMusic, saveFeverMusic, musicLibrary, primeFeverTrack, formatSeconds, FEVER_MIN_SEGMENT, FEVER_MAX_SEGMENT, FEVER_MAX_SECONDS } from './feverMusic.js';
import { audio, bgmKeyFor } from '../audio.js';
import { t, N_ } from '../../../shared/i18n.js';

export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
const listeners = new Set();
let record = null, url = null, media = null, source = null, revision = 0, installed = false, dbPromise;
let status = N_('默认大厅音乐'), busy = false, lastRoute;
const notify = () => listeners.forEach(fn => fn(music.snapshot()));
let videoAudible=false;
const inMusicArea = () => { const s=store.get(),route=selectRoute(s);return ['lobby','room'].includes(route)||(route==='game'&&[PHASE.INFO_CHECK,PHASE.BAND_DRAFT,PHASE.BATTLE_CHECK].includes(s.match?.public?.phase)); };
let customGain=null,fadeTarget=0,fadeTimer,handoff=false,handoffTimer;
const areaKey = () => selectRoute(store.get()) + ':' + inMusicArea();
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('sp-lobby-music', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('tracks');
    req.onsuccess = () => { const result = req.result; result.onversionchange = () => result.close(); resolve(result); };
    req.onerror = () => { dbPromise = null; reject(Error(t('浏览器无法保存音乐，请检查可用空间'))); };
  });
}
async function saved(write, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tracks', write ? 'readwrite' : 'readonly'), table = tx.objectStore('tracks');
    const req = write ? value ? table.put(value, 'lobby') : table.delete('lobby') : table.get('lobby');
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(Error(t('音乐保存失败，可能是浏览器存储空间不足')));
  });
}
async function validate(file) {
  if (!file || file.size <= 0) throw Error('请选择有效的音频文件');
  if (file.size > MAX_MUSIC_BYTES) throw Error('音乐不能超过 20MB，请选择较小的文件');
  if (!/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name || '') || (file.type && !file.type.startsWith('audio/') && file.type !== 'video/webm' && file.type !== 'application/ogg')) throw Error('请选择 MP3、M4A、OGG、WAV 等音频文件');
  const objectUrl = URL.createObjectURL(file), probe = new Audio(); probe.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(t('音频读取超时，请尝试其他文件'))), 10000);
      probe.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(probe.duration) && probe.duration > 0 ? resolve() : reject(Error(t('音频文件无效'))); };
      probe.onerror = () => { clearTimeout(timer); reject(Error(t('浏览器无法播放该音频，请尝试 MP3 或 M4A'))); };
      probe.src = objectUrl;
    });
  } finally { probe.onloadedmetadata = probe.onerror = null; probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(objectUrl); }
}
/**
 * 把存下来 / 新提交的形态收成 `{ list, mode, index, enabled, paused }`。
 * 兼容旧版单曲记录（`{ blob }` 或 `{ track: { id, url } }`）—— 旧数据不丢，读出来就是只有一项的轮播列表。
 */
function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.list)) {
    const list = value.list
      .filter((it) => it && typeof it === 'object' && (typeof it.url === 'string' || it.blob) && !(it.blob && it.blob.size > MAX_MUSIC_BYTES))
      .map((it) => ({
        id: String(it.id || it.url || `local:${it.name || ''}`).slice(0, 200),
        name: String(it.name || '').slice(0, 180),
        ...(typeof it.url === 'string' ? { url: it.url } : { blob: it.blob }),
      }));
    if (!list.length) return null;
    const raw = Number.isInteger(value.index) ? value.index : 0;
    return {
      list, mode: value.mode === 'shuffle' ? 'shuffle' : 'loop',
      index: Math.max(0, Math.min(list.length - 1, raw)),
      enabled: value.enabled !== false, paused: !!value.paused,
    };
  }
  const item = value.blob && value.blob.size <= MAX_MUSIC_BYTES
    ? { id: `local:${value.name || 'track'}`, name: value.name || '', blob: value.blob }
    : value.track?.url ? { id: String(value.track.id || value.track.url), name: value.name || '', url: value.track.url }
      : null;
  return item ? { list: [item], mode: 'loop', index: 0, enabled: value.enabled !== false, paused: !!value.paused } : null;
}
/** 轮播列表里当前那一项。 */
function currentItem() { return (record && record.list[record.index]) || null; }
/** 一项的可播放 URL：服务器曲目用原 URL，本地上传的现建 Blob URL（CSP 已放行 `media-src blob:`）。 */
function itemUrl(item) {
  if (!item) return null;
  if (item.url) return item.url;
  if (item.blob) return URL.createObjectURL(item.blob);
  return null;
}
const modeText = () => (record?.mode === 'shuffle' ? t('随机播放') : t('列表循环'));
/**
 * 切到列表第 i 项：换 src、记下播放位置对应项。`announce` = 顺手把播放状态同步一遍
 * （`ended` 自动切下一首时用；用户点选时由调用方自己 `refresh()`）。
 */
function playIndex(i, { announce = false } = {}) {
  if (!record || !record.list.length) return;
  const list = record.list;
  record.index = ((i % list.length) + list.length) % list.length;
  const item = list[record.index];
  const src = itemUrl(item);
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  if (url) URL.revokeObjectURL(url);
  url = src;
  if (media && src) media.src = src;
  status = record.paused ? t('已暂停') : t('正在播放 · {mode}', { mode: modeText() });
  notify();
  if (announce) sync();
}
/** 下一首的下标：列表循环 = 顺位；随机播放 = 随机且**不重复当前这首**（只有一首时原地重播）。 */
function advance() {
  if (!record || record.list.length < 2) return 0;
  if (record.mode === 'shuffle') {
    let i = record.index;
    while (i === record.index) i = Math.floor(Math.random() * record.list.length);
    return i;
  }
  return (record.index + 1) % record.list.length;
}
function fadeCustom(on, immediate = false) {
  const target = on ? 1 : 0;
  if (target === fadeTarget && !immediate) return;
  clearTimeout(fadeTimer);fadeTarget = target;
  if (!customGain || !audio.ctx || immediate) { if (!on) media?.pause();if(customGain)customGain.gain.value=target;return; }
  const t=audio.ctx.currentTime,g=customGain.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
  else {g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);}
  g.linearRampToValueAtTime(target,t+0.9);
  if (!on) fadeTimer=setTimeout(()=>{if(fadeTarget===0){media.pause();notify();}},1000);
}
function clearHandoff() { clearTimeout(handoffTimer);handoff=false; }
function sync() {
  if (!media || !record) return;
  if ((videoAudible&&selectRoute(store.get())==='lobby') || !record.enabled || record.paused || document.hidden || audio.bgmSilent) {clearHandoff();fadeCustom(false,true);return;}
  if (!inMusicArea()) {
    // Keep the old music while the next game's BGM buffer is loading.
    if (selectRoute(store.get())==='game' && !media.paused && fadeTarget>0) {
      if (!handoff) {handoff=true;handoffTimer=setTimeout(()=>{clearHandoff();fadeCustom(false);},10000);}
    } else fadeCustom(false);
    return;
  }
  clearHandoff();
  if (!audio.ctx) return;
  if (!source) {source=audio.ctx.createMediaElementSource(media);customGain=audio.ctx.createGain();customGain.gain.value=0;source.connect(customGain);customGain.connect(audio.bgmGain);}
  fadeCustom(true);
  if (!media.paused) return;
  media.play().then(()=>{status=t('正在播放 · {mode}', { mode: modeText() });notify();},()=>{status=t('点击“播放”开始音乐');notify();});
}

function refresh() {
  const s = store.get(); audio.playBgm(bgmKeyFor(selectRoute(s), s.match?.public)); sync(); notify();
}
function install() {
  if (installed) return; installed = true;
  media = new Audio(); media.loop = false; media.preload = 'none';
  media.onerror = () => { record && (record.enabled = false); status = t('音乐播放失败，已恢复默认音乐'); refresh(); };
  // 一首放完 ⇒ 按模式切下一首（列表循环 = 顺位；随机播放 = 随机另一首）。单曲循环由 advance() 返回 0 原地重播。
  media.addEventListener('ended', () => {
    if (!record || !record.list.length || record.paused || !record.enabled) return;
    playIndex(advance(), { announce: true });
  });
  audio.lobbyMusicOverride = key => {
    const override = key === 'lobby' && ((videoAudible&&selectRoute(store.get())==='lobby') || (record?.enabled&&inMusicArea()));
    sync();
    return !!override;
  };
  audio.lobbyMusicBgmStarted = () => { if (!inMusicArea()) {clearHandoff();fadeCustom(false);} };
  window.addEventListener('sp:lobby-video-audio', e => {videoAudible=!!e.detail?.active;refresh();});
  lastRoute = areaKey();
  store.subscribe(s => { const route = areaKey(); if (route !== lastRoute) { lastRoute = route; refresh(); } else sync(); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointerdown', () => { if (record?.enabled) { audio._unlock(); sync(); } }, { passive: true });
  const initialRevision = revision;
  saved(false).then(value => {
    const rec = normalizeRecord(value);
    if (revision !== initialRevision || !rec) return;
    record = rec;
    playIndex(rec.index);
    status = rec.paused ? t('已暂停') : t('点击“播放”开始音乐');
    refresh();
  }).catch(() => { status = t('浏览器暂不能保存音乐，可稍后重试'); notify(); });
}
export const music = {
  snapshot: () => {
    const item = currentItem();
    return {
      name: item?.name || '', size: item?.blob?.size || 0,
      enabled: !!record?.enabled, paused: !!record?.paused,
      playing: !!media && !media.paused, status, busy,
      track: item?.url ? item.id : '',
      list: (record?.list || []).map((x) => ({ id: x.id, name: x.name, current: x.id === item?.id })),
      mode: record?.mode || 'loop', index: record?.index || 0,
    };
  },
  /**
   * 从**本服务器**的音乐库里选一首：**加入轮播列表**并立即播放（已在列表里就切到它）。
   *
   * ⚠️ 换源 / 解锁 / 开播必须在**同一个用户手势**里同步跑完 —— 先 `await` 存盘再建 AudioContext
   * 的话，上下文可能建在暂停态：界面显示「正在播放」，实际一点声音都没有（业主 2026-10-21 报的现象）。
   */
  pick(track) {
    if (busy || !track || typeof track.url !== 'string') return Promise.resolve();
    install(); ++revision; busy = true; notify();
    const item = { id: String(track.id), name: String(track.name || '').slice(0, 180), url: track.url };
    const list = record ? [...record.list] : [];
    let index = list.findIndex((x) => x.id === item.id);
    if (index < 0) { list.push(item); index = list.length - 1; } else list[index] = item;
    const next = { ...(record || {}), list, mode: record?.mode === 'shuffle' ? 'shuffle' : 'loop', index, enabled: true, paused: false };
    record = next;
    playIndex(index);
    audio._unlock();
    refresh();
    return saved(true, next)
      .catch((e) => { status = e.message || t('音乐播放失败，已恢复默认音乐'); refresh(); })
      .finally(() => { busy = false; notify(); });
  },
  /** 把上传的文件**追加**进轮播列表并播放它。 */
  async upload(file) {
    if (busy) return; install(); ++revision; busy = true; notify();
    try {
      await validate(file);
      const item = { id: `local:${Date.now()}`, name: file.name.slice(0, 180), blob: file };
      const list = record ? [...record.list, item] : [item];
      const next = { ...(record || {}), list, mode: record?.mode || 'loop', index: list.length - 1, enabled: true, paused: false };
      record = next; playIndex(next.index);
      status = t('已保存音乐'); audio._unlock(); refresh();
      await saved(true, next);
    } catch (e) { status = e.message || t('音乐导入失败'); throw e; }
    finally { busy = false; notify(); }
  },
  async toggle() {
    if (!record || busy) return; ++revision;
    const next = { ...record, enabled: true, paused: !!record.enabled && !media.paused };
    record = next; status = next.paused ? t('已暂停') : t('正在播放 · {mode}', { mode: modeText() }); audio._unlock(); refresh();
    try { await saved(true, next); } catch { /* 隐私模式：本次会话仍然生效 */ }
  },
  /** 切到列表里的某一项（点列表行）。 */
  playItem(id) {
    if (busy || !record) return;
    const i = record.list.findIndex((x) => x.id === id);
    if (i < 0) return;
    ++revision; record.enabled = true; record.paused = false;
    playIndex(i); audio._unlock(); refresh();
    saved(true, record).catch(() => { /* 隐私模式 */ });
  },
  /** 把某一项移出列表；移的正好是当前这首就顺位接上下一首。 */
  remove(id) {
    if (busy || !record) return Promise.resolve();
    const idx = record.list.findIndex((x) => x.id === id);
    if (idx < 0) return Promise.resolve();
    ++revision;
    const list = record.list.filter((_, i) => i !== idx);
    if (!list.length) return music.reset();
    const wasCurrent = idx === record.index;
    const index = wasCurrent ? Math.min(idx, list.length - 1) : (idx < record.index ? record.index - 1 : record.index);
    const next = { ...record, list, index };
    record = next;
    if (wasCurrent) { playIndex(index); audio._unlock(); refresh(); } else notify();
    return saved(true, next).catch(() => { /* 隐私模式 */ });
  },
  /** 轮播模式：列表循环 / 随机播放。 */
  setMode(mode) {
    if (!record) return Promise.resolve();
    ++revision;
    const next = { ...record, mode: mode === 'shuffle' ? 'shuffle' : 'loop' };
    record = next;
    if (!record.paused) status = t('正在播放 · {mode}', { mode: modeText() });
    notify();
    return saved(true, next).catch(() => { /* 隐私模式 */ });
  },
  reset() {
    if (busy) return Promise.resolve();
    ++revision; record = null;
    if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
    if (url) URL.revokeObjectURL(url);
    url = null; status = t('默认大厅音乐'); refresh();
    return saved(true, null).catch(() => { /* 隐私模式：本次会话仍然生效 */ });
  },
};
/**
 * 大厅音乐弹窗里的「服务器音乐」选择（放在默认大厅音乐卡片下面）：只列**已装工坊包**的 bgm
 * （业主 2026-10-21：官方 BGM 不进这张表），选中后与上传的音乐走同一条播放路径
 * （`audio.lobbyMusicOverride` 接管大厅 BGM）。
 */
function ServerMusicPicker({ value, busy, onPick }) {
  const [lib, setLib] = useState(null);
  useEffect(() => {
    let live = true;
    musicLibrary().then((list) => { if (live) setLib(list.filter((x) => x.kind === 'workshop')); });
    return () => { live = false; };
  }, []);
  const list = lib || [];
  const packs = [...new Set(list.map((x) => x.pack))].sort();
  const field = 'width:100%;min-height:36px;background:#000;color:inherit;border:1px solid rgba(255,255,255,.16);padding:4px 8px;font:inherit;font-size:13px;color-scheme:dark';
  return html`<section style="display:grid;gap:6px;min-width:0">
    <label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t('服务器音乐')}
      <select disabled=${busy || lib === null} value=${value} onChange=${(e) => onPick(list.find((x) => x.id === e.currentTarget.value) || null)} style=${field}>
        <option value="">${t('不使用 · 默认大厅音乐')}</option>
        ${packs.map((pack) => html`<optgroup key=${pack} label=${t('工坊包 · {pack}', { pack: list.find((x) => x.pack === pack)?.packName || pack })}>${list.filter((x) => x.pack === pack).map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}<//>`)}
      </select>
    </label>
    <small style="color:var(--muted);font-size:12px">${lib && !list.length ? t('服务器里没有可选音乐。') : t('从本服务器的官方 BGM / 工坊包曲目里选一首循环播放；选「不使用」恢复默认。')}</small>
  </section>`;
}

/**
 * 轮播列表：模式（列表循环 / 随机播放）+ 曲目行（点行切歌、✕ 移出）。
 * 列表存的是 `{ id, name, url | blob }`，服务器曲目与上传的文件共用一个列表。
 */
function PlaylistPanel({ state, busy, onPlay, onRemove, onMode }) {
  const list = state.list || [];
  const seg = (active) => `flex:1;min-height:32px;font-size:12px;cursor:pointer;background:${active ? 'rgba(88,217,181,.16)' : 'rgba(0,0,0,.25)'};color:${active ? 'var(--mint,#58d9b5)' : 'inherit'};border:1px solid ${active ? 'var(--mint,#58d9b5)' : 'rgba(255,255,255,.16)'};font:inherit`;
  return html`<section style="display:grid;gap:8px;min-width:0">
    <strong style="font-size:13px">${t('轮播列表')} · ${list.length}</strong>
    <div style="display:flex;gap:8px">
      <button type="button" disabled=${busy || !list.length} style=${seg(state.mode !== 'shuffle')} onClick=${() => onMode('loop')}>${t('列表循环')}</button>
      <button type="button" disabled=${busy || !list.length} style=${seg(state.mode === 'shuffle')} onClick=${() => onMode('shuffle')}>${t('随机播放')}</button>
    </div>
    ${list.length ? html`<ul style="margin:0;padding:0;list-style:none;display:grid;gap:2px;max-height:150px;overflow:auto">
      ${list.map((it) => html`<li key=${it.id} style="display:flex;align-items:center;gap:6px;min-width:0">
        <button type="button" disabled=${busy} onClick=${() => onPlay(it.id)} title=${t('播放这首')}
          style="flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:${it.current ? 'rgba(88,217,181,.12)' : 'transparent'};border:1px solid rgba(255,255,255,.1);color:inherit;font:inherit;font-size:12px;padding:4px 8px;cursor:pointer">${it.current ? '▶ ' : ''}${it.name}</button>
        <button type="button" disabled=${busy} onClick=${() => onRemove(it.id)} title=${t('移出列表')} aria-label=${t('移出列表')}
          style="width:28px;min-height:28px;background:transparent;border:1px solid rgba(255,255,255,.14);color:var(--muted);cursor:pointer">✕</button>
      </li>`)}
    </ul>` : html`<small style="color:var(--muted);font-size:12px">${t('列表为空：在「服务器音乐」里选一首，它会加入轮播并立即播放。')}</small>`}
  </section>`;
}

/**
 * 大厅音乐弹窗里的 Fever 音乐段（颂乐人偶）：曲目与片段在房间里由房主同步，音量永远只作用于本浏览器。
 * 不在房间里时改的是本浏览器自己的默认值；房间里只有房主、开局前能改。
 */
function FeverMusicSection() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me);
  const [draft, setDraft] = useState(() => effectiveFeverMusic(room));
  const [lib, setLib] = useState([]);
  const [libState, setLibState] = useState('loading');
  const [duration, setDuration] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [note, setNote] = useState('');
  const preview = useRef(null);
  const inRoom = !!room;
  const isHost = inRoom && room.hostId === me?.playerId;
  const editable = !inRoom || (isHost && !room.inMatch);
  const track = draft.track ? lib.find((x) => x.id === draft.track) || null : null;
  const official = lib.filter((x) => x.kind === 'official');
  const packs = [...new Set(lib.filter((x) => x.kind === 'workshop').map((x) => x.pack))].sort();

  useEffect(() => {
    let live = true;
    musicLibrary().then((list) => { if (live) { setLib(list); setLibState('ready'); } }, () => { if (live) setLibState('error'); });
    return () => { live = false; };
  }, []);
  // 房间那份变了（房主改 / 换房 / 回大厅）⇒ 曲目与片段跟着走；音量始终取本浏览器那份。
  useEffect(() => { setDraft(effectiveFeverMusic(room)); }, [room?.code, room?.feverMusic?.track, room?.feverMusic?.start, room?.feverMusic?.end]);
  // 房主进到一个**还没设过** Fever 音乐的房间：把他在大厅选好的那份推成房间设置（全房同一份，不用再手动改一次）。
  const pushedRoom = useRef('');
  useEffect(() => {
    if (!isHost || !inRoom || room.inMatch || room.feverMusic) return;
    if (pushedRoom.current === room.code) return;
    const own = getFeverMusic();
    if (!own.track) return;
    pushedRoom.current = room.code;
    net.send('room.feverMusic', { track: own.track, start: own.start, end: own.end });
  }, [isHost, inRoom, room?.code, room?.feverMusic?.track, room?.inMatch]);
  // 选中曲目的总时长（metadata 即可；官方曲目走 Range，工坊曲目本来就会整段发过来）。
  useEffect(() => {
    setDuration(0);
    if (!track) return undefined;
    let live = true;
    const a = new Audio(); a.preload = 'metadata';
    const done = () => { if (live && Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration); };
    a.addEventListener('loadedmetadata', done);
    a.src = track.url;
    return () => { live = false; a.removeEventListener('loadedmetadata', done); a.removeAttribute('src'); a.load(); };
  }, [track?.id]);
  useEffect(() => () => stopPreview(), []);

  function stopPreview() {
    const a = preview.current;
    preview.current = null;
    if (a) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* ignore */ } }
    setPreviewing(false);
  }
  function validSegment(next) {
    return !!next.track && Number.isFinite(next.start) && Number.isFinite(next.end) && next.start >= 0
      && next.end > next.start && next.end - next.start >= FEVER_MIN_SEGMENT && next.end - next.start <= FEVER_MAX_SEGMENT;
  }
  function commit(patch) {
    if (!editable) return;
    const next = { ...draft, ...(patch || {}) };
    if (next.track && !validSegment(next)) { setNote(t('片段需 0.5–600 秒，且结束晚于开始')); return; }
    setNote('');
    setDraft(next);
    if (inRoom) net.send('room.feverMusic', next.track ? { track: next.track, start: next.start, end: next.end } : { track: null });
    else saveFeverMusic({ track: next.track, start: next.start, end: next.end });
  }
  function pickTrack(id) {
    if (!id) { commit({ track: null, start: 0, end: 0 }); return; }
    commit({ track: id, start: 0, end: Math.max(FEVER_MIN_SEGMENT, Math.min(20, duration > 0 && track ? duration : 20)) });
  }
  function setVolume(v) {
    const volume = Math.max(0, Math.min(1, (Number(v) || 0) / 100));
    setDraft((d) => ({ ...d, volume }));
    saveFeverMusic({ volume });
  }
  async function startPreview() {
    if (!track) return;
    stopPreview(); setNote('');
    const url = await primeFeverTrack(track);
    if (!url) { setNote(t('无法试听这首曲目（素材加载失败）')); return; }
    const a = new Audio(url);
    preview.current = a;
    a.volume = draft.volume;
    const stop = () => { if (preview.current === a) stopPreview(); };
    a.addEventListener('ended', stop);
    a.addEventListener('timeupdate', () => { if (a.currentTime >= draft.end) stop(); });
    try { a.currentTime = draft.start; await a.play(); setPreviewing(true); }
    catch { setNote(t('浏览器阻止了播放，请再点一次')); stopPreview(); }
  }

  const field = 'min-height:34px;background:rgba(0,0,0,.25);color:inherit;border:1px solid rgba(255,255,255,.16);padding:4px 8px;font:inherit;font-size:13px';
  // 曲目下拉要**黑底**（业主 2026-10-21）：半透明底在深色主题上仍会透出墙纸，下拉面板也会是浅色。
  const selField = `${field};background:#000;color-scheme:dark`;
  return html`<section style="display:grid;gap:10px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12);min-width:0">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
      <strong style="font-size:14px">${t('Fever 音乐')}</strong>
      <small style="color:var(--muted);font-size:11px">FEVER MUSIC</small>
    </div>
    <p style="margin:0;color:var(--muted);font-size:12px;line-height:1.6">${t('颂乐人偶盟约触发 Fever 时播放；曲目与片段按房间同步，音量只作用于本浏览器。')}</p>
    ${inRoom ? html`<p style="margin:0;color:var(--mint,#58d9b5);font-size:12px">${editable ? t('本房间的 Fever 音乐由房主设置，开局前可改。') : t('由房主设置；开局后不可改。')}</p>` : null}
    <label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t('曲目')}
      <select disabled=${!editable || libState !== 'ready'} value=${draft.track || ''} onChange=${(e) => pickTrack(e.currentTarget.value)} style=${selField}>
        <option value="">${t('默认（KillKiss 伴奏 / 人声）')}</option>
        ${official.length ? html`<optgroup label=${t('官方音乐')}>${official.map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}<//>` : null}
        ${packs.map((pack) => html`<optgroup key=${pack} label=${t('工坊包 · {pack}', { pack: lib.find((x) => x.pack === pack)?.packName || pack })}>${lib.filter((x) => x.pack === pack).map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}<//>`)}
      </select>
    </label>
    ${libState === 'error' ? html`<p role="alert" style="margin:0;color:#ff9393;font-size:12px">${t('服务器音乐库加载失败，仍可使用默认两首。')}</p>` : null}
    ${libState === 'ready' && !lib.length ? html`<p style="margin:0;color:var(--muted);font-size:12px">${t('服务器里没有可选音乐。')}</p>` : null}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t('开始（秒）')}
        <input type="number" min="0" step="0.1" max=${FEVER_MAX_SECONDS} disabled=${!editable || !draft.track} value=${draft.start}
          onChange=${(e) => setDraft((d) => ({ ...d, start: Number(e.currentTarget.value) || 0 }))} onBlur=${() => commit()} style=${field} />
      </label>
      <label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t('结束（秒）')}
        <input type="number" min="0" step="0.1" max=${duration > 0 ? Math.round(duration * 10) / 10 : FEVER_MAX_SECONDS} disabled=${!editable || !draft.track} value=${draft.end}
          onChange=${(e) => setDraft((d) => ({ ...d, end: Number(e.currentTarget.value) || 0 }))} onBlur=${() => commit()} style=${field} />
      </label>
    </div>
    <small style="color:var(--muted);font-size:12px">${duration > 0 ? t('曲目时长 {time}', { time: formatSeconds(duration) }) : t('片段需 0.5–600 秒')}</small>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <${Button} size="sm" disabled=${!draft.track || libState !== 'ready'} onClick=${previewing ? stopPreview : startPreview}>${previewing ? t('停止试听') : t('试听片段')}<//>
      <${Button} size="sm" variant="secondary" disabled=${!editable} onClick=${() => commit({ track: null, start: 0, end: 0 })}>${t('恢复默认')}<//>
    </div>
    <label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t('Fever 音量')} · ${Math.round(draft.volume * 100)}%
      <input type="range" min="0" max="100" step="1" value=${Math.round(draft.volume * 100)} onInput=${(e) => setVolume(e.currentTarget.value)} style="width:100%" />
    </label>
    ${note ? html`<p role="alert" style="margin:0;color:#ff9393;font-size:12px">${note}</p>` : null}
  </section>`;
}

export function LobbyMusicButton() {
  const [open,setOpen]=useState(false),[state,setState]=useState(music.snapshot),[error,setError]=useState('');const input=useRef(null);
  useEffect(()=>{install();const fn=s=>setState(s);listeners.add(fn);fn(music.snapshot());return()=>listeners.delete(fn);},[]);
  const action=async fn=>{setError('');try{await fn();}catch(e){setError(e.message||t('操作失败'));}};
  return html`<${Button} variant="secondary" size="sm" square=${true} class="hub-music-btn" title=${t('大厅音乐')} aria-label=${t('大厅音乐')} onClick=${()=>setOpen(true)}><span style="font-size:22px;line-height:1" aria-hidden="true">♫</span><//>
    <style>.lobby-music-panel .modal__head{padding:14px 16px 4px}.lobby-music-panel .modal__title{font-size:18px}.lobby-music-panel .modal__head>:first-child{font-size:10px}.lobby-music-panel .modal__body{padding:12px 16px 16px}.lobby-music-panel .modal__actions{padding:10px 16px}.lobby-music-panel button{font-size:13px;min-height:36px;padding:8px 12px}</style>
    <${Modal} class="lobby-music-panel" open=${open} title=${t('大厅音乐')} micro="LOBBY MUSIC" width="min(420px, calc(100vw - 32px))" onClose=${()=>setOpen(false)} actions=${html`<${Button} variant="secondary" onClick=${()=>setOpen(false)}>${t('关闭')}<//>`}>
      <div style="display:grid;gap:14px;padding:8px 0;min-width:0">
        <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.7">${t('选择你喜欢的大厅音乐，每首最大 20MB。保存在当前浏览器，无需上传服务器；房间、战前信息和选人时继续播放，进入战场淡出并切换游戏音乐。')}</p>
        <div style="padding:14px;border:1px solid var(--mint,#58d9b5);background:rgba(30,90,75,.12);min-width:0">
          <strong style="display:block;font-size:15px;overflow-wrap:anywhere">${state.name||t('默认大厅音乐')}</strong>
          <small style="display:block;font-size:12px;margin-top:8px;color:var(--mint,#58d9b5)">${t(state.status)}${state.size?` · ${(state.size/1024/1024).toFixed(1)} MB`:''}</small>
        </div>
        <${ServerMusicPicker} value=${state.track} busy=${state.busy} onPick=${(tr) => action(() => tr ? music.pick(tr) : music.reset())} />
        <input ref=${input} type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac,.webm" hidden onChange=${e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)action(()=>music.upload(file));}} />
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <${Button} disabled=${state.busy} onClick=${()=>input.current?.click()}>${state.busy?t('正在导入…'):t('上传音乐')}<//>
          <${Button} disabled=${!state.name||state.busy} onClick=${()=>action(()=>music.toggle())}>${state.playing?t('暂停'):t('播放')}<//>
          <${Button} disabled=${!state.name||state.busy} variant="secondary" onClick=${()=>action(()=>music.reset())}>${t('恢复默认')}<//>
        </div>
        <small style="color:var(--muted);font-size:12px;line-height:1.6">${t('音量和静音沿用游戏设置。刷新后保留；清理浏览器数据会删除音乐。')}</small>
        <${PlaylistPanel} state=${state} busy=${state.busy}
          onPlay=${(id) => action(() => music.playItem(id))}
          onRemove=${(id) => action(() => music.remove(id))}
          onMode=${(mode) => action(() => music.setMode(mode))} />
        <${FeverMusicSection} />
        ${error?html`<p role="alert" style="margin:0;color:#ff9393;overflow-wrap:anywhere">${error}</p>`:null}
      </div>
    <//>`;
}
