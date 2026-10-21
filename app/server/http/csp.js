// Site policy (DESIGN §34.11). Hash only import maps, never arbitrary inline script. Worker/UI policies are independent.
// worker-src 'self' is the asset service worker at /sw.js. blob: stays for workers the page already creates
// (the simulation worker). Do not add a remote worker origin. SIM_WORKER_CSP is that worker's own policy and
// must not gain the asset worker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// SES evaluates confined code. This relaxation belongs only to the simulation Worker, never its parent document.
export const SIM_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

/**
 * The asset CDN's **origin**, read from `SP_CDN_BASE` — the same variable `tools/large-assets.mjs` uses (default
 * `https://speedcdn.jiangjiangze.icu`). A deployment that serves the art from a CDN sets it (the sidecar
 * `cdn-serve.mjs` rewrites `/data/assets.json` `local-assets.json` `emotes.json` to absolute `SP_CDN_BASE` URLs, and
 * the server's own `SP_ASSET_CDN` does the same in response) — so the browser then fetches the art, audio and the
 * spine files from that origin, and the policy below has to name it.
 *
 * Anything other than a clean absolute `http(s)` URL — unset, empty, `ftp:`, a typo — returns `null`, and the policy
 * falls back to exactly what it is today, so a clean install and a CDN-less deployment are unchanged.
 * @param {string} [base] defaults to `process.env.SP_CDN_BASE`
 * @returns {string|null} e.g. `https://speedcdn.jiangjiangze.icu`
 */
export function assetCdnOrigin(base = process.env.SP_CDN_BASE) {
  if (typeof base !== 'string' || !base.trim()) return null;
  let u;
  try { u = new URL(base.trim()); } catch { return null; }
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
}

export function siteCsp(publicDir, cdnBase = process.env.SP_CDN_BASE) {
  const hashes = new Set();
  for (const rel of ['index.html', 'studio/index.html', 'studio/console.html', 'dev/game-mock.html', 'dev/render-demo.html', 'dev/battle-perf.html', 'dev/uikit.html']) {
    let html;
    try { html = fs.readFileSync(path.join(publicDir, rel), 'utf8'); } catch { continue; }
    for (const m of html.matchAll(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  // The CDN origin goes into **passive** resource types only: `img-src` (portraits, maps, spine pages) and
  // `connect-src` (the game fetches audio with `fetch`, and the spine `.skel`/`.atlas` too — measured on the live box:
  // a CDN mp3 was refused with "Connects to … violates connect-src 'self'").
  // It must NEVER reach `script-src` / `style-src` / `frame-src` / `object-src`: those would let a poisoned CDN run
  // code or load a frame, which is the whole point of the policy. `script-src` stays self + the importmap hashes.
  const cdn = assetCdnOrigin(cdnBase);
  const imgSrc = `img-src 'self' data: blob:${cdn ? ` ${cdn}` : ''};`;
  const connectSrc = `connect-src 'self'${cdn ? ` ${cdn}` : ''};`;
  // `media-src` 显式放行 `blob:`：本地上传的大厅音乐与「工坊曲目整段 fetch 成 Blob」的 Fever 音乐都靠它播放。
  // 没有这一条时它们落回 `default-src 'self'`，浏览器直接拒播（实测报错：Loading media from 'blob:…' violates
  // default-src 'self'）。音频与图片同属**被动**资源，所以 CDN 源也照 `img-src` 那条规矩进这里。
  const mediaSrc = `media-src 'self' blob:${cdn ? ` ${cdn}` : ''};`;
  return `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; ${imgSrc} ${mediaSrc} ${connectSrc} worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'`;
}
