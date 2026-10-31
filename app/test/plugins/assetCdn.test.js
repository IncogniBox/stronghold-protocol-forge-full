// test/plugins/assetCdn.test.js — 素材 CDN 的两个基址：`SP_ASSET_CDN`（官方素材）与 `SP_WORKSHOP_CDN`
// （工坊包自带素材，可指向 GitHub / ghfast.top 镜像）。
//
// 只在**响应层**改写 `data/assets.json`（`local-assets.json` / `emotes.json` 同一支）：磁盘上的清单一个字节都不动。
// 三个情形逐条钉住：两个都没设 ⇒ 原样；只有官方基址 ⇒ 沿旧契约（包素材进 `packs/<pack>/…`）；工坊基址给了 ⇒
// `/workshop-assets/<pack>/<rel>` 改写成 `<workshopBase><pack>/assets/<rel>`（仓库镜像的目录形状），官方素材仍走官方基址。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../../server/http/static.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CDN = 'https://downcdn.jiangjiangze.icu/';
const WORKSHOP = 'https://ghfast.top/https://raw.githubusercontent.com/IncogniBox/stronghold-protocol-forge-full/main/app/workshop/';

const FIXTURE = {
  chars: {
    c1: {
      avatar: '/workshop-assets/pack-a/art/avatar.png',
      portrait: '/assets/char/portrait/c1.png',
      spine: { front: { skel: '/workshop-assets/pack-a/art/op.skel' } },
    },
  },
  bonds: { b1: '/workshop-assets/pack-a/bond/icon.png' },
  fonts: ['/fonts/game.woff2'],
  emotes: { e1: '/assets/ui/emote/e1.png' },
};

/** 起一个 handler（env 在**创建时**读一次，与真实服务器一致），请求一次 `/data/assets.json`。 */
function fetchAssets(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-asset-cdn-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'assets.json'), JSON.stringify(FIXTURE));
  const saved = { asset: process.env.SP_ASSET_CDN, workshop: process.env.SP_WORKSHOP_CDN };
  try {
    if (env.asset === undefined) delete process.env.SP_ASSET_CDN; else process.env.SP_ASSET_CDN = env.asset;
    if (env.workshop === undefined) delete process.env.SP_WORKSHOP_CDN; else process.env.SP_WORKSHOP_CDN = env.workshop;
    const serve = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(dir, 'data'), sharedDir: path.join(ROOT, 'shared') });
    return (async () => {
      const chunks = [];
      /** 一个可写流：没设基址时清单走 `serveFile`（`stream.pipe`），设了就 `writeHead` + `end`。 */
      const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
      /** @type {any} */ (res).writeHead = (code, headers) => { /** @type {any} */ (res).statusCode = code; /** @type {any} */ (res).headers = headers; };
      const finished = once(res, 'finish');
      await serve({ method: 'GET', headers: {} }, res, '/data/assets.json', '');
      await finished;
      return { code: /** @type {any} */ (res).statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    })();
  } finally {
    if (saved.asset === undefined) delete process.env.SP_ASSET_CDN; else process.env.SP_ASSET_CDN = saved.asset;
    if (saved.workshop === undefined) delete process.env.SP_WORKSHOP_CDN; else process.env.SP_WORKSHOP_CDN = saved.workshop;
  }
}

test('两个变量都没设 ⇒ 清单逐字节原样（这一段完全不执行）', async () => {
  const { json } = await fetchAssets({});
  assert.deepEqual(json, FIXTURE);
});

test('只有 SP_ASSET_CDN ⇒ 旧契约不变：官方素材 `<base>assets/…`，包素材 `<base>packs/<pack>/…`', async () => {
  const { json } = await fetchAssets({ asset: CDN });
  assert.equal(json.chars.c1.avatar, `${CDN}packs/pack-a/art/avatar.png`);
  assert.equal(json.chars.c1.portrait, `${CDN}assets/char/portrait/c1.png`);
  assert.equal(json.chars.c1.spine.front.skel, `${CDN}packs/pack-a/art/op.skel`);
  assert.equal(json.bonds.b1, `${CDN}packs/pack-a/bond/icon.png`);
  assert.deepEqual(json.fonts, [`${CDN}fonts/game.woff2`]);
  assert.equal(json.emotes.e1, `${CDN}assets/ui/emote/e1.png`);
});

test('只有 SP_WORKSHOP_CDN ⇒ 包素材拼到仓库的 `<pack>/assets/` 下，官方素材仍是站内路径', async () => {
  const { json } = await fetchAssets({ workshop: WORKSHOP });
  assert.equal(json.chars.c1.avatar, `${WORKSHOP}pack-a/assets/art/avatar.png`);
  assert.equal(json.chars.c1.spine.front.skel, `${WORKSHOP}pack-a/assets/art/op.skel`);
  assert.equal(json.bonds.b1, `${WORKSHOP}pack-a/assets/bond/icon.png`);
  assert.equal(json.chars.c1.portrait, '/assets/char/portrait/c1.png');
  assert.deepEqual(json.fonts, ['/fonts/game.woff2']);
});

test('两个都设 ⇒ 官方素材走素材 CDN，包素材走 GitHub 镜像', async () => {
  const { json } = await fetchAssets({ asset: CDN, workshop: WORKSHOP });
  assert.equal(json.chars.c1.portrait, `${CDN}assets/char/portrait/c1.png`);
  assert.equal(json.chars.c1.avatar, `${WORKSHOP}pack-a/assets/art/avatar.png`);
  assert.deepEqual(json.fonts, [`${CDN}fonts/game.woff2`]);
});

test('非 http(s) 的工坊前缀被当作没设（不会拼出坏地址）', async () => {
  const { json } = await fetchAssets({ asset: CDN, workshop: 'ftp://mirror.example/' });
  assert.equal(json.chars.c1.avatar, `${CDN}packs/pack-a/art/avatar.png`, '回落到官方基址的 packs/ 命名空间');
});
