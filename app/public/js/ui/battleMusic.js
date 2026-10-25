// 对局左下角的战斗音乐切换（用户 2026-10-25：和大厅音乐播放器一样）。
//
// 大厅那套（ui/lobbyMusic.js）只接管 `lobby` 这一条 BGM；这里接管**战斗侧**的 key：`prep` / `combat` /
// `combat:<i>` / `boss` / `boss:<id>` / `unite`。做法与大厅一致：在 `audio.battleMusicOverride` 上挂一个判断，
// `audio.playBgm` 看到它返回 true 就淡出引擎自己的 BGM，由这里的一个 <audio>（loop）接管；音量 / 静音仍走
// `audio.bgmGain`（与引擎 BGM 同一条通道），所以设置里的音乐音量与静音照常生效。
//
// 选择只存本浏览器（`sp.pref.battleMusic` = { id, name, url }），下一局自动沿用；「跟随本局默认音乐」清掉它，
// 引擎的 `prep/combat/boss/unite` 立刻回来。曲目取自服务器音乐库（feverMusic.musicLibrary：官方 BGM + 工坊包），
// 与大厅的「服务器音乐」同一个来源。

import { html, Button, Modal } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute, loadPref, savePref } from '../store.js';
import { audio, bgmKeyFor } from '../audio.js';
import { musicLibrary } from './feverMusic.js';
import { t } from '../../../shared/i18n.js';

const PREF = 'battleMusic';

/** 战斗侧接管哪些 BGM key：除大厅外的全部（prep / combat[:i] / boss[:id] / unite）。 */
const isBattleKey = (key) => typeof key === 'string' && key !== 'lobby';

const listeners = new Set();
let saved = normalize(loadPref(PREF, null));
let media = null;
let source = null;
let gain = null;
let installed = false;
let failed = false;
let currentUrl = '';

function normalize(v) {
  if (!v || typeof v !== 'object' || typeof v.url !== 'string' || !v.url) return null;
  return { id: String(v.id || v.url), name: String(v.name || '').slice(0, 180), url: v.url };
}

function snapshot() {
  return {
    id: saved?.id || '', name: saved?.name || '', hasTrack: !!(saved && saved.url),
    playing: !!media && !media.paused, failed,
  };
}
const notify = () => listeners.forEach((fn) => fn(snapshot()));

/** 当前这一帧是不是战斗（用它来决定自定义曲目要不要响）。 */
function battleNow() {
  const s = store.get();
  const key = bgmKeyFor(selectRoute(s), s.match?.public);
  return isBattleKey(key);
}

function ensure() {
  if (installed) return;
  installed = true;
  media = new Audio();
  media.loop = true;
  media.preload = 'none';
  media.addEventListener('error', () => {
    failed = true;
    // 这首播不了：把引擎的战斗 BGM 还回去，界面提示一句
    if (saved) audio.playBgm(audio.lastBgmKey);
    notify();
  });
  // 引擎每次 playBgm 都会先问这里：有曲目且没播坏 ⇒ 引擎淡出，自定曲目接管
  audio.battleMusicOverride = (key) => isBattleKey(key) && !!saved && !failed;
  store.subscribe(() => sync());
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointerdown', () => { audio._unlock?.(); sync(); }, { passive: true });
  sync();
  // 开局的那条 prep BGM 可能在本面板挂上之前就已经开播：重问一次，让引擎淡出、自定曲目接手
  if (saved) audio.refreshBgm?.();
}

function sync() {
  if (!installed || !media) return;
  const want = battleNow() && !!saved && !failed && !audio.bgmSilent && !document.hidden;
  if (!want) {
    if (!media.paused) media.pause();
    return;
  }
  if (!audio.ctx || !audio.bgmGain) return;             // 第一次手势之前没有音频上下文
  if (!source) {
    try {
      source = audio.ctx.createMediaElementSource(media);
      gain = audio.ctx.createGain();
      source.connect(gain);
      gain.connect(audio.bgmGain);
    } catch { return; }
  }
  if (currentUrl !== saved.url) {
    currentUrl = saved.url;
    media.src = saved.url;
  }
  if (media.paused) media.play().catch(() => { /* 自动播放被拦：下一次手势再试 */ });
  notify();
}

function pick(track) {
  ensure();
  failed = false;
  if (!track) {
    saved = null;
    savePref(PREF, null);
    if (media) media.pause();
    currentUrl = '';
    audio.playBgm(audio.lastBgmKey);      // 取消接管：引擎按当前阶段重新起 BGM
    notify();
    return;
  }
  saved = { id: String(track.id), name: String(track.name || '').slice(0, 180), url: track.url };
  savePref(PREF, saved);
  audio._unlock?.();
  audio.playBgm(audio.lastBgmKey);        // 让引擎意识到要淡出（override 现在为 true）
  sync();
  notify();
}

function toggle() {
  if (!saved) return;
  ensure();
  audio._unlock?.();
  if (media && !media.paused) { media.pause(); notify(); return; }
  sync();
}

/** 大厅音乐弹窗里那套「服务器音乐」下拉，这里只换标题文案。 */
function TrackPicker({ value, busy, onPick }) {
  const [lib, setLib] = useState(null);
  useEffect(() => {
    let live = true;
    musicLibrary().then((list) => { if (live) setLib(list); }, () => { if (live) setLib([]); });
    return () => { live = false; };
  }, []);
  const list = lib || [];
  const official = list.filter((x) => x.kind === 'official');
  const packs = [...new Set(list.filter((x) => x.kind === 'workshop').map((x) => x.pack))].sort();
  const field = 'width:100%;min-height:36px;background:#000;color:inherit;border:1px solid rgba(255,255,255,.16);padding:4px 8px;font:inherit;font-size:13px;color-scheme:dark';
  return html`<label style="display:grid;gap:4px;font-size:12px;color:var(--muted)">${t('曲目')}
    <select disabled=${busy || lib === null} value=${value} onChange=${(e) => onPick(list.find((x) => x.id === e.currentTarget.value) || null)} style=${field}>
      <option value="">${t('跟随本局默认音乐')}</option>
      ${official.length ? html`<optgroup label=${t('官方音乐')}>${official.map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}<//>` : null}
      ${packs.map((pack) => html`<optgroup key=${pack} label=${t('工坊包 · {pack}', { pack: list.find((x) => x.pack === pack)?.packName || pack })}>${list.filter((x) => x.pack === pack).map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}<//>`)}
    </select>
    <small style="color:var(--muted);font-size:11px">${lib === null ? t('正在加载音乐库…') : !list.length ? t('服务器里没有可选音乐。') : ''}</small>
  </label>`;
}

/**
 * The battle music button (`.gm__corner`, bottom-left of the match) + its dialog.
 */
export function BattleMusicButton() {
  // 模块一被加载就挂好接管（不必等玩家点开面板：存过的曲目要能在下一局自动响）
  useEffect(() => { ensure(); }, []);
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    const fn = (s) => setSnap(s);
    listeners.add(fn);
    fn(snapshot());
    return () => listeners.delete(fn);
  }, []);
  return html`<button type="button" class="gm__gear gm__music" title=${t('战斗音乐')} aria-label=${t('战斗音乐')}
      aria-haspopup="dialog" onClick=${() => setOpen(true)}><span aria-hidden="true">♫</span></button>
    <${Modal} open=${open} title=${t('战斗音乐')} micro="BATTLE MUSIC" width="min(440px, calc(100vw - 32px))"
      onClose=${() => setOpen(false)} actions=${html`<${Button} variant="secondary" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <div style="display:grid;gap:14px;padding:8px 0;min-width:0">
        <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.7">${t('选择一首替换战斗中的开战 / 首领 / 联防音乐；选择保存在本浏览器，之后每局沿用。音量与静音沿用游戏设置。')}</p>
        <div style="padding:14px;border:1px solid var(--mint,#58d9b5);background:rgba(30,90,75,.12);min-width:0">
          <strong style="display:block;font-size:15px;overflow-wrap:anywhere">${snap.name || t('跟随本局默认音乐')}</strong>
          <small style="display:block;font-size:12px;margin-top:8px;color:var(--mint,#58d9b5)">${snap.failed
    ? t('这首无法播放，已回到默认音乐')
    : snap.playing ? t('正在播放') : t('已暂停')}</small>
        </div>
        <${TrackPicker} value=${snap.id} busy=${false} onPick=${(track) => pick(track)} />
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <${Button} disabled=${!snap.hasTrack} onClick=${toggle}>${snap.playing ? t('暂停') : t('播放')}<//>
          <${Button} variant="secondary" disabled=${!snap.hasTrack} onClick=${() => pick(null)}>${t('恢复默认')}<//>
        </div>
        <small style="color:var(--muted);font-size:12px;line-height:1.6">${t('和默认音乐一样，进入结算 / 大厅时自动停下；大厅音乐另有自己的播放器。')}</small>
      </div>
    <//>`;
}
