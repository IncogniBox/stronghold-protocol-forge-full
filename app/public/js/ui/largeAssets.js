// public/js/ui/largeAssets.js — 「大型资源」（3D 棋盘的地图与场景那类大文件）在客户端的两块界面：
//
//   1. `LargeAssetsBar` —— 标题屏顶端的一行：服务器**正在补齐**时显示「已收 / 应下 MB」与进度条。
//   2. `ResourceButton` / `ResourceModal` —— 标题屏右上角那一排（统计 / 公告 / 语言）里的「资源」：点开是一张
//      **资源清单**，能看见每个分组与每个文件的大小与状态，并能**重新下载**某一组、某一个文件或全部。
//
// 三份只读状态，都在 `/assets-status.json`（进度）与 `/assets-list.json`（清单）上，服务器算好了字节数：
//   * 平时页面上**不多一个元素**（`phase` 不是 repairing / needs-attention / checking 时那块根本不渲染）；
//   * 见到「不在跑」就**不再轮询**（补齐只发生在起服之后，页面这时是刚打开的）—— 不打无谓的请求；
//   * 清单那份快照在服务器侧是子进程算的（冷缓存要哈希 192 MB），所以面板打开时先显示「正在读取…」。
// 「重新下载」是 `GET /assets-redownload.json?target=…`（引擎的 HTTP 面只开 GET/HEAD，理由写在 routes.js 那一处）。
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal, MicroLabel } from './components.js';
import { assetImport } from '../assetPack.js';
import { importSupport } from '../assetCache.js';
import { t } from '../../../shared/i18n.js';

/** 在跑的时候两秒问一次（服务端每两秒推一次进度），够跟得上又不吵。 */
const POLL_MS = 2000;
const MB = (n) => (Number(n) || 0) / 1048576;
const fmtMb = (n) => MB(n).toFixed(MB(n) < 9.95 ? 2 : 1);
const getJson = async (url) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
};

/** 状态里那几种「不在跑」的相位（`checking` 也算在跑：核对要读盘）。 */
const isLive = (st) => !!st && (st.running || st.phase === 'repairing' || st.phase === 'checking');

/**
 * 服务器进度（`/assets-status.json`）。`active` 为假时一次都不问（面板关着、标题屏那一行已经收工）。
 * 只要还在跑就继续问；跑到不跑了就停手 —— 所以**自己发起一次重下之后要 `bump()` 一下**（`nonce` 变了这个
 * effect 会重跑一遍），否则「第一次读到的结论是不在跑」会让它永远不再看服务器一眼、那次重下就白点了。
 */
function useAssetsStatus(active, nonce = 0) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!active) return undefined;
    let stop = false;
    let timer = null;
    const tick = async () => {
      let next = null;
      try { next = await getJson('/assets-status.json'); } catch { next = null; }
      if (stop) return;
      setSt(next);
      if (isLive(next) || next?.phase === 'needs-attention') timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [active, nonce]);
  return st;
}

/** 标题屏顶端那一行（服务器在补 / 补不动的时候才出现）。`nonce` 由 `title.js` 与资源面板共用一个计数器：
    面板点下一次重新下载时会 +1，这一行于是**重新**去看服务器一眼（否则它早在「不在跑」那一次就收工了）。 */
export function LargeAssetsBar({ nonce = 0 }) {
  const st = useAssetsStatus(true, nonce);
  if (!st || st.phase === 'off') return null;
  if (!isLive(st) && st.phase !== 'needs-attention') return null;

  const p = st.progress || {};
  const expected = Number(p.expectedBytes) || Number(st.totals?.needBytes) || 0;
  const got = Number(p.receivedBytes) || 0;
  const pct = expected > 0 ? Math.min(100, Math.round((got / expected) * 100)) : 0;
  const failed = Number(st.failed) || 0;
  const redo = st.mode === 'redownload';
  // 总数还不知道（`start` 事件还没到）就先不报数：`0.0 / 0.0 MB` 看着像坏了。
  const line = expected > 0
    ? redo
      ? t('正在重新下载大型资源：{got} / {total} MB', { got: MB(got).toFixed(1), total: MB(expected).toFixed(1) })
      : t('正在补齐大型资源（地图与场景）：{got} / {total} MB', { got: MB(got).toFixed(1), total: MB(expected).toFixed(1) })
    : t('正在下载大型资源…');
  return html`<div class="large-assets" role="status" aria-live="polite">
    <span class="large-assets__text">${st.phase === 'repairing' || st.phase === 'checking'
      ? line
      : failed
        ? t('大型资源有 {n} 项没补上，服务器会再试', { n: failed })
        : t('正在核对大型资源（地图与场景）…')}</span>
    <span class="large-assets__bar" aria-hidden="true"><span class="large-assets__fill" style=${`width:${pct}%`}></span></span>
    <span class="large-assets__pct num">${pct}%</span>
  </div>`;
}

/** 标题屏右上角那一排里的「资源」按钮。 */
export function ResourceButton({ onOpen }) {
  return html`<${Button} variant="ghost" size="sm" class="title-resources" onClick=${onOpen} title=${t('资源查看')}>${t('资源')}<//>`;
}

/** 一个分组的「状态」由它自己那几类问题的条数决定：都没有就是完整。 */
const worstOf = (g) => (g.missing ? 'missing' : g.short ? 'short' : g.longer ? 'longer' : g.sha ? 'sha' : 'ok');
// 五个状态标签的字面量**直接写在 `t()` 里**（不要收进一张对象表：`tools/i18n.mjs` 的扫描器只认 `t('…')`
// 这个形状，散在别处的裸中文会被 `test/i18n.test.js` 判成「没包起来的字面量」）。
const Chip = ({ status }) => html`<span class=${`res-chip res-chip--${status}`}>${status === 'missing'
  ? t('缺失') : status === 'short'
    ? t('截断') : status === 'longer'
      ? t('偏大') : status === 'sha'
        ? t('哈希不符') : t('完整')}</span>`;

// ── 备用源（data/asset-pack.json）────────────────────────────────────────────────────────────────
// 一条**备用下载路**：整包从维护者 GitHub Release 的附件（或自建镜像）下下来，交给「导入素材包」那条路自动导入
// （`public/js/assetPack.js`：只读服务器清单、按 SHA-256 逐文件收下、不上传内容）。这里只做「下载整包」这件事：
//   数据来源 `data/asset-pack.json`（`tools/asset-pack.mjs` 产出的 manifest.json 就是它的形状），**照面板读
//   `/assets-list.json` 的同一套机制**取（`getJson`，`fetch(url, { cache: 'no-store' })`）；读不到 / `groups` 为空 /
//   没有 `repo`+`tag` 都算「没配」。
//   **下载只打同源** `/asset-pack/<file>`（server/assetPack.js 的代理）：页面的 CSP 是 `connect-src 'self'`
//   （server/http/csp.js），浏览器直连外域时**连请求都发不出去**（真机实测，见 docs/ASSETS.md），所以跨域那一跳
//   ——含 GitHub Release 的 302 —— 交给服务端走，源回退与理由也都归服务端。这里**只校验字节数**；
//   **逐文件的 SHA-256 校验交给导入那条路**（不在浏览器里对一个 600 MB 的包算哈希）。
const PACK_URL = '/data/asset-pack.json';

/** 备用源算不算「配好了」：要有 repo、tag，且 groups 非空。 */
const isConfiguredPack = (p) => !!p && typeof p === 'object' && !!p.repo && !!p.tag
  && Array.isArray(p.groups) && p.groups.length > 0;

/** 备用源的**同源** URL：服务端按 data/asset-pack.json 的声明按序回退，客户端只跟自己的源说话。 */
const packProxyUrl = (file) => `/asset-pack/${file}`;
const sha8 = (s) => String(s || '').slice(0, 8);

/**
 * 备用源区块：一行标题「备用完整资源包（GitHub）」+ 每个组一行（名称 · 大小 · 该组的 sha256 前 8 位）与
 * 「下载并导入」，再加一个「全部下载并导入」。没配时只有一行提示。
 * 下载是**客户端**的：整包落到内存里的 Blob，直接交给 `assetImport.start({ type: 'zip', data })`。
 */
function AssetPackSection({ pack }) {
  const [imported, setImported] = useState(() => assetImport.get());
  const [note, setNote] = useState('');
  const [prog, setProg] = useState(null);
  const [busy, setBusy] = useState(false);
  const lastAt = useRef(0);
  useEffect(() => {
    const off = assetImport.subscribe(setImported);
    setImported(assetImport.get());
    return off;
  }, []);
  if (!isConfiguredPack(pack)) {
    return html`<p class="res-pack__hint t-dim">${t('还没配备用源。把 node tools/asset-pack.mjs 产出的 manifest.json 放进 data/asset-pack.json（要有 repo、tag 与 groups）。')}</p>`;
  }
  const support = importSupport();
  const importBusy = ['reading', 'importing'].includes(imported.phase);

  /** 读一个已到手的响应的字节（带进度）：响应体流式读，边读边报 MB；没有流就退化成一次 blob。 */
  const pull = async (res, want, file) => {
    const total = Number(res.headers.get('content-length')) || Number(want) || 0;
    const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
    if (!reader) {
      const blob = await res.blob();
      setProg(null);
      return blob;
    }
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      const now = Date.now();
      if (now - lastAt.current > 120) { lastAt.current = now; setProg({ file, got, want: total }); }
    }
    setProg(null);
    return new Blob(chunks, { type: 'application/zip' });
  };

  /** 一个组：只打**同源代理**，源回退与「为什么失败」都在服务端（server/assetPack.js）；字节数对上了就交给导入那条路。 */
  const one = async (g) => {
    if (!support.ok) { setNote(t('导入需要 HTTPS 或 localhost。')); return false; }
    const url = packProxyUrl(g.file);
    setNote(t('正在从 {src} 下载…', { src: url }));
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        // 服务端全失败时会给一份点名清单（试了哪些源、各自为什么失败）—— 直接显示给玩家。
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (Array.isArray(body?.tried) && body.tried.length) {
            detail = `${detail} · ${body.tried.map((x) => `${x.source} → ${x.reason}`).join('；')}`;
          }
        } catch { /* 不是 JSON：就用状态码 */ }
        setNote(t('每个源都失败了：{src}', { src: detail }));
        return false;
      }
      const blob = await pull(res, g.bytes, g.file);
      if (Number(g.bytes) && blob.size !== Number(g.bytes)) {
        setNote(t('字节数不对（{got} / {want}），已丢弃这个包', { got: blob.size, want: g.bytes }));
        return false;
      }
      setNote(t('下载完成，正在交给导入…'));
      await assetImport.start({ type: 'zip', data: blob });
      return true;
    } catch (e) {
      setNote(t('每个源都失败了：{src}', { src: `${url} → ${e && e.message ? e.message : e}` }));
      return false;
    }
  };

  const runOne = async (g) => { setBusy(true); try { await one(g); } finally { setBusy(false); } };
  const runAll = async () => {
    setBusy(true);
    try { for (const g of pack.groups) await one(g); } finally { setBusy(false); }
  };
  const counts = ['complete', 'partial', 'empty', 'cancelled', 'error'].includes(imported.phase)
    && (imported.accepted + imported.rejected + imported.skipped + imported.failed) > 0;

  return html`<div class="res-pack">
    <div class="res-pack__head">
      <${MicroLabel} tone="mint">${t('备用完整资源包（GitHub）')}<//>
      <span class="res-pack__act">
        <${Button} variant="secondary" size="sm" disabled=${busy || importBusy || !support.ok}
          data-testid="asset-pack-all" onClick=${() => void runAll()}>${t('全部下载并导入')}<//>
      </span>
    </div>
    ${pack.groups.map((g) => html`<div key=${g.id} class="res-pack__row">
      <b class="res-pack__name">${g.name || g.id}</b>
      <span class="res-pack__num num">${fmtMb(g.bytes)} MB · ${sha8(g.sha256)}</span>
      <${Button} variant="ghost" size="sm" disabled=${busy || importBusy || !support.ok}
        data-testid=${`asset-pack-${g.id}`} onClick=${() => void runOne(g)}>${t('下载并导入')}<//>
    </div>`)}
    ${prog ? html`<p class="res-pack__prog num">${t('正在下载 {file}：{got} / {want} MB', {
      file: prog.file, got: MB(prog.got).toFixed(1), want: MB(prog.want).toFixed(1),
    })}</p>` : null}
    ${note ? html`<p class="res-note">${note}</p>` : null}
    ${!support.ok ? html`<p class="t-dim">${t('导入需要 HTTPS 或 localhost。')}</p>` : null}
    ${importBusy ? html`<p class="t-dim">${t('正在校验并写入…')} ${t('已完成 {done} / {total} 个文件', {
      done: imported.done, total: imported.total || 1,
    })}</p>` : null}
    ${counts ? html`<p data-testid="asset-pack-counts">${t('已导入 {accepted} 个，校验不符 {rejected} 个，跳过 {skipped} 个，无法读取 {failed} 个', {
      accepted: imported.accepted, rejected: imported.rejected, skipped: imported.skipped, failed: imported.failed,
    })}</p>` : null}
  </div>`;
}

/** 清单面板：全部分组 + 展开后的每个文件，每一行都能重新下载。 */
export function ResourceModal({ open, onClose, onStarted }) {
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [lastRun, setLastRun] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [pack, setPack] = useState(null);
  const st = useAssetsStatus(open, nonce);
  const wasRunning = useRef(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try { setList(await getJson('/assets-list.json')); } catch { setFailed(true); }
    setLoading(false);
  };
  // 打开时读一次；关着的时候什么都不做
  useEffect(() => { if (open && !list) load(); /* eslint-disable-line */ }, [open]);
  // 备用源那份配置也照同一套机制读（`getJson`，no-store）：读不到（文件不在）就当「没配」，只多一行提示。
  useEffect(() => {
    if (!open) return undefined;
    let stop = false;
    getJson(PACK_URL).then((p) => { if (!stop) setPack(p); }, () => { if (!stop) setPack(null); });
    return () => { stop = true; };
  }, [open]);
  // 一次重下是怎么结束的：从「在跑」变成「不在跑」⇒ 刷新清单，并记下这一趟的结果
  useEffect(() => {
    if (!open || !st) return;
    if (st.running) { wasRunning.current = true; return; }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    setLastRun({ repaired: st.repaired || 0, failed: st.failed || 0 });
    load();
  }, [open, st]);

  const redownload = async (target) => {
    setNote('');
    try {
      const r = await getJson(`/assets-redownload.json?target=${encodeURIComponent(target)}`);
      if (r.started) { setNonce((n) => n + 1); onStarted?.(); }   // 重新去看服务器（并让 `wasRunning` 抓住这一趟的收尾）
      else setNote(r.reason === 'DISABLED' ? t('重新下载没有开始：这个功能被关掉了') : t('服务器正忙（起服核对或另一次重下在跑），稍后再试'));
    } catch { setNote(t('服务器没有接受这次重新下载')); }
  };

  const filesOf = useMemo(() => {
    const byGroup = new Map();
    for (const f of list?.files || []) {
      const id = f.rel.split('/').slice(1, 3).join('/') || f.rel.split('/')[1];
      if (!byGroup.has(id)) byGroup.set(id, []);
      byGroup.get(id).push(f);
    }
    return byGroup;
  }, [list]);

  const totals = list?.totals || {};
  const busy = !!st?.running || !!st?.busy;
  const p = st?.progress || {};
  const expected = Number(p.expectedBytes) || 0;
  const got = Number(p.receivedBytes) || 0;
  // 一次重下的总数由服务端的 `start` 事件给（那时才知道这一批有多大）；还没到就先不报数。
  const runLine = expected > 0
    ? t('正在重新下载大型资源：{got} / {total} MB', { got: MB(got).toFixed(1), total: MB(expected).toFixed(1) })
    : t('正在下载大型资源…');

  return html`<${Modal} open=${open} title=${t('资源查看')} micro="LARGE ASSETS" onClose=${onClose} width="lg" class="res-modal">
    ${!list ? (loading ? html`<p class="t-dim">${t('正在读取资源清单…')}</p>` : failed ? html`<p class="t-dim">${t('资源清单读取失败，请稍后再看。')}</p>` : null) : html`
      <div class="res-head">
        <${MicroLabel} tone="mint">${t('大型资源（地图与场景）')}<//>
        <span class="res-head__sum num">${t('共 {files} 个文件 · {mb} MB', { files: totals.checked ?? 0, mb: fmtMb(totals.totalBytes) })}</span>
        <span class="res-head__chips">
          ${totals.missing ? html`<${Chip} status="missing" />` : null}
          ${totals.short ? html`<${Chip} status="short" />` : null}
          ${totals.longer ? html`<${Chip} status="longer" />` : null}
          ${totals.sha ? html`<${Chip} status="sha" />` : null}
          ${!totals.missing && !totals.short && !totals.longer && !totals.sha ? html`<${Chip} status="ok" />` : null}
        </span>
        <span class="res-head__act">
          <${Button} variant="secondary" size="sm" icon="refresh" disabled=${busy} onClick=${() => redownload('all')}>${t('全部重新下载')}<//>
        </span>
      </div>
      ${busy && st?.mode === 'redownload' ? html`<div class="res-run" role="status">
        <${MicroLabel} tone="hi">${runLine}<//>
      </div>` : null}
      ${!busy && st?.mode === 'redownload' && st?.finishedAt ? html`<div class="res-run">
        <span class="t-dim num">${t('上次重新下载：{n} 项，失败 {failed}', { n: lastRun?.repaired ?? st.repaired ?? 0, failed: lastRun?.failed ?? st.failed ?? 0 })}</span>
      </div>` : null}
      ${note ? html`<p class="res-note">${note}</p>` : null}
      <${AssetPackSection} pack=${pack} />
      <div class="res-groups">
        ${(list?.groups || []).map((g) => {
          const open_ = expanded.has(g.id);
          const files = filesOf.get(g.id) || [];
          const bit = `assets/${g.id}/`.length;
          return html`<div key=${g.id} class="res-group">
            <div class="res-group__row">
              <button type="button" class=${`res-group__head${open_ ? ' is-open' : ''}`} aria-expanded=${open_ ? 'true' : 'false'}
                onClick=${() => setExpanded((prev) => { const n = new Set(prev); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
                <span class="res-group__caret" aria-hidden="true">${open_ ? '▾' : '▸'}</span>
                <b class="res-group__id">${g.id}</b>
                <span class="res-group__num num">${t('共 {files} 个文件 · {mb} MB', { files: g.files, mb: fmtMb(g.bytes) })}</span>
                <${Chip} status=${worstOf(g)} />
              </button>
              <${Button} variant="ghost" size="sm" icon="refresh" disabled=${busy} onClick=${() => redownload(g.id)}>${t('重新下载')}<//>
            </div>
            ${open_ ? html`<ul class="res-files">${files.map((f) => html`<li key=${f.rel} class="res-file">
              <span class="res-file__rel">${f.rel.slice(bit)}</span>
              <span class="res-file__num num">${fmtMb(f.size)} MB</span>
              <${Chip} status=${f.status} />
              <button type="button" class="res-file__redo" disabled=${busy} onClick=${() => redownload(f.rel)}>${t('重新下载')}</button>
            </li>`)}</ul>` : null}
          </div>`;
        })}
      </div>`}
  <//>`;
}
