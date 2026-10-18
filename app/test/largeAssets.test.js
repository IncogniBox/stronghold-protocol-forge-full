// test/largeAssets.test.js — 「大型资源」的清单 / 核对 / 补齐（tools/large-assets.mjs 的纯函数，注入 fetchImpl 与临时目录，
// 不碰真实安装里的素材）＋ 一次真子进程的 `--check --json`（服务器那条路的形状）。
//
// 这条判据钉的四件事：
//   1. 清单的范围规则（scope 前缀全收 + 前缀之外按 size 阈值）；
//   2. 核对的四种分类（missing / short / longer / sha）与「只有前者可补」；
//   3. 状态文件的省哈希语义（同 size + 同 mtime 才信；mtime 变了就重算，于是**同尺寸的改坏**能被发现）；
//   4. 补齐真能落盘（注入的 fetch 回真实字节）＋ NDJSON 事件序列。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { snapshot, verify, jobsOf, repair, manifestHash, MANIFEST_REL, groupOf, groupsOf, listPayload, forceRows, needRows, normalizeTarget, repairFromPacks, packRows, packSafeRel } from '../tools/large-assets.mjs';
import { zipWrite } from '../shared/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-large-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const write = (root, rel, buf) => {
  const abs = path.join(root, 'public', ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return abs;
};

describe('大资源清单（tools/large-assets.mjs snapshot）', () => {
  test('scope 前缀全收；前缀之外只收 ≥ minBytes 的', () => {
    const root = tmp();
    write(root, 'assets/local/scene/a.bin', Buffer.alloc(10, 1));
    write(root, 'assets/local/ui/b.png', Buffer.alloc(5, 2));
    write(root, 'assets/audio/small.mp3', Buffer.alloc(100, 3));
    write(root, 'assets/audio/big.mp3', Buffer.alloc(4096, 4));
    const snap = snapshot({ root, scope: 'assets/local/', minBytes: 2048 });
    assert.deepEqual(Object.keys(snap.files), [
      'assets/audio/big.mp3', 'assets/local/scene/a.bin', 'assets/local/ui/b.png',
    ], '排序稳定 + 只收该收的');
    assert.equal(snap.files['assets/audio/big.mp3'].size, 4096);
    assert.equal(snap.files['assets/local/ui/b.png'].sha256, sha(Buffer.alloc(5, 2)), 'sha256 是真的算出来的');
  });
});

describe('大资源核对（verify）', () => {
  const manifestOf = (root, rels) => ({ v: 1, files: Object.fromEntries(rels.map((rel) => {
    const abs = write(root, rel, Buffer.from(rel));
    const buf = fs.readFileSync(abs);
    return [rel, { size: buf.length, sha256: sha(buf) }];
  })) });

  test('missing / short / longer / sha 四类分开，只有 missing + short 可补', () => {
    const root = tmp();
    const manifest = manifestOf(root, ['assets/a.bin', 'assets/b.bin', 'assets/c.bin', 'assets/d.bin', 'assets/e.bin']);
    fs.rmSync(path.join(root, 'public/assets/a.bin'));
    fs.writeFileSync(path.join(root, 'public/assets/b.bin'), 'x');           // 短了
    fs.writeFileSync(path.join(root, 'public/assets/c.bin'), 'assets/c.bin long');  // 长了
    fs.writeFileSync(path.join(root, 'public/assets/d.bin'), 'assets/d.biX');        // 同尺寸、内容不同
    const { rows, totals } = verify({ root, manifest });
    const byRel = Object.fromEntries(rows.map((r) => [r.rel, r]));
    assert.deepEqual([byRel['assets/a.bin'].status, byRel['assets/a.bin'].need], ['missing', true]);
    assert.deepEqual([byRel['assets/b.bin'].status, byRel['assets/b.bin'].need], ['short', true]);
    assert.deepEqual([byRel['assets/c.bin'].status, byRel['assets/c.bin'].need], ['longer', false], '比清单大只报告');
    assert.deepEqual([byRel['assets/d.bin'].status, byRel['assets/d.bin'].need], ['sha', false], '同尺寸哈希不符也只报告');
    assert.equal(byRel['assets/e.bin'], undefined, '对的文件不进 rows');
    assert.deepEqual(
      [totals.checked, totals.ok, totals.missing, totals.short, totals.longer, totals.sha],
      [5, 1, 1, 1, 1, 1],
    );
    assert.equal(totals.needBytes, manifest.files['assets/a.bin'].size + manifest.files['assets/b.bin'].size, '待补字节数只算可补的两类');
  });

  test('状态文件：同 size + 同 mtime 才免哈希；mtime 一变就重算（于是同尺寸改坏能发现）', () => {
    const root = tmp();
    const manifest = manifestOf(root, ['assets/a.bin']);
    const first = verify({ root, manifest });
    assert.equal(first.totals.ok, 1);
    assert.equal(first.totals.sha, 0);
    // 免哈希那一次：把状态文件喂回去，再把内存里的「答案」当输入 —— 过程不报错、结论是完整的
    const second = verify({ root, manifest, state: first.nextState });
    assert.equal(second.totals.ok, 1);
    // 同尺寸改坏 + 刷新 mtime ⇒ 必须重算并抓到
    const abs = path.join(root, 'public/assets/a.bin');
    fs.writeFileSync(abs, 'assets/!.bin');
    const future = new Date(Date.now() + 1000);
    fs.utimesSync(abs, future, future);
    const third = verify({ root, manifest, state: first.nextState });
    assert.equal(third.totals.sha, 1, '同尺寸的改坏被算出哈希后抓住');
    assert.equal(third.totals.needBytes, 0, '但它是「只报告」的那一类，不下载');
    // 清单换了 ⇒ 状态文件作废（不能拿旧清单的结论免哈希）
    assert.notEqual(manifestHash('{"a":1}'), manifestHash('{"a":2}'));
  });

  test('jobsOf：URL 是 CDN 基址 + 同一段相对路径（逐段编码），bytes/kind 跟着清单', () => {
    const jobs = jobsOf([
      { rel: 'assets/local/scene/m01/scene.bin', kind: 'bin', size: 100, need: true },
      { rel: 'assets/audio/a b.mp3', kind: 'mp3', size: 50, need: true },
      { rel: 'assets/local/ui/x.png', kind: 'png', size: 10, need: false },
    ], 'https://cdn.example.com/');
    assert.deepEqual(jobs.map((j) => j.rel), ['assets/local/scene/m01/scene.bin', 'assets/audio/a b.mp3']);
    assert.equal(jobs[0].urls[0], 'https://cdn.example.com/assets/local/scene/m01/scene.bin');
    assert.equal(jobs[1].urls[0], 'https://cdn.example.com/assets/audio/a%20b.mp3', '空格逐段编码');
    assert.deepEqual([jobs[0].kind, jobs[0].bytes], ['bin', 100]);
  });
});

describe('大资源补齐（repair，注入 fetchImpl）', () => {
  test('缺的文件真落盘、字节一致；事件序列是 start → file → progress → done', async () => {
    const root = tmp();
    const body = Buffer.from('scene-bytes-'.repeat(64));
    const manifest = { v: 1, files: { 'assets/local/scene/m01/scene.bin': { size: body.length, sha256: sha(body) } } };
    const rows = verify({ root, manifest }).rows;
    assert.equal(rows.length, 1);
    const events = [];
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      if (String(url).endsWith('/scene.bin')) return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
      return new Response('nope', { status: 404 });
    };
    const out = await repair({ root, rows, base: 'https://cdn.example.com', fetchImpl, concurrency: 2, onEvent: (e) => events.push(e) });
    assert.deepEqual([out.repaired, out.failed], [1, 0]);
    assert.deepEqual(asked, ['https://cdn.example.com/assets/local/scene/m01/scene.bin'], '只问该问的那一个 URL');
    const abs = path.join(root, 'public/assets/local/scene/m01/scene.bin');
    assert.equal(sha(fs.readFileSync(abs)), sha(body), '落盘字节与清单一致');
    assert.deepEqual(events.map((e) => e.type), ['start', 'file', 'progress', 'done']);
    assert.deepEqual([events[1].status, events[1].sha], ['ok', true], 'file 事件里带着「哈希与清单一致」');
    assert.equal(events[3].repaired, 1);
    assert.deepEqual(verify({ root, manifest }).totals.missing, 0, '补完就不缺了');
  });

  test('源上没有（404）⇒ 失败被记下，文件不落盘', async () => {
    const root = tmp();
    const manifest = { v: 1, files: { 'assets/local/scene/m02/scene.bin': { size: 16, sha256: sha(Buffer.alloc(16)) } } };
    const rows = verify({ root, manifest }).rows;
    const events = [];
    const out = await repair({ root, rows, base: 'https://cdn.example.com', fetchImpl: async () => new Response('x', { status: 404 }), onEvent: (e) => events.push(e) });
    assert.deepEqual([out.repaired, out.failed], [0, 1]);
    assert.deepEqual(events.filter((e) => e.type === 'file').map((e) => e.status), ['miss']);
    assert.equal(fs.existsSync(path.join(root, 'public/assets/local/scene/m02/scene.bin')), false);
    assert.deepEqual(events.at(-1).failed, 1);
  });
});

describe('资源查看面板要的那份清单 + 「重新下载」的目标', () => {
  const manifest = {
    v: 1,
    files: {
      'assets/local/scene/m01/scene.bin': { size: 100, sha256: 'a' },
      'assets/local/scene/m02/scene.bin': { size: 200, sha256: 'b' },
      'assets/local/ui/outer/x.png': { size: 10, sha256: 'c' },
      'assets/audio/bgm/m_loop.mp3': { size: 3000, sha256: 'd' },
    },
  };

  test('groupOf：`assets/` 之后的前两段（不足两段就一段）', () => {
    assert.equal(groupOf('assets/local/scene/m01/scene.bin'), 'local/scene');
    assert.equal(groupOf('assets/audio/bgm/m_loop.mp3'), 'audio/bgm');
    assert.equal(groupOf('assets/single.bin'), 'single.bin');
  });

  test('groupsOf：每组文件数 / 总字节 / 各类问题条数；组排序按体积降序', () => {
    const rows = [
      { rel: 'assets/local/scene/m02/scene.bin', status: 'missing' },
      { rel: 'assets/local/ui/outer/x.png', status: 'sha' },
    ];
    const groups = groupsOf(manifest, rows);
    assert.deepEqual(groups.map((g) => g.id), ['audio/bgm', 'local/scene', 'local/ui'], '按总字节降序');
    const scene = groups.find((g) => g.id === 'local/scene');
    assert.deepEqual([scene.files, scene.bytes, scene.missing, scene.short, scene.longer, scene.sha], [2, 300, 1, 0, 0, 0]);
    assert.deepEqual([groups.find((g) => g.id === 'local/ui').sha], [1]);
  });

  test('listPayload：每个文件都进表，没问题的标 ok（面板据此画「完整」）', () => {
    const rows = [{ rel: 'assets/local/scene/m01/scene.bin', status: 'short' }];
    const p = listPayload({ manifest, rows, totals: { checked: 4 } });
    assert.equal(p.files.length, 4);
    assert.deepEqual(p.files.map((f) => [f.rel, f.size, f.status]), [
      ['assets/local/scene/m01/scene.bin', 100, 'short'],
      ['assets/local/scene/m02/scene.bin', 200, 'ok'],
      ['assets/local/ui/outer/x.png', 10, 'ok'],
      ['assets/audio/bgm/m_loop.mp3', 3000, 'ok'],
    ]);
    assert.equal(p.totals.checked, 4);
  });

  test('normalizeTarget：面板给的是**组名**、清单里是 `assets/…`，两边必须对上', () => {
    assert.equal(normalizeTarget('all'), 'all');
    assert.equal(normalizeTarget('local/scene'), 'local/scene');
    assert.equal(normalizeTarget('assets/local/scene/m01/scene.bin'), 'local/scene/m01/scene.bin');
    assert.equal(normalizeTarget('/local/ui/'), 'local/ui');
    assert.equal(normalizeTarget(''), 'all');
    assert.equal(normalizeTarget(undefined), 'all');
  });

  test('forceRows：组名匹配得到该组的文件；`all` 是全量；精确文件只匹配它自己', () => {
    assert.deepEqual(forceRows(manifest, 'local/scene').map((r) => r.rel), [
      'assets/local/scene/m01/scene.bin', 'assets/local/scene/m02/scene.bin',
    ]);
    // 这条是回归：拿组名去 `startsWith` 一个**带 assets/ 前缀**的路径会一条都匹配不到（表现是「重下了 0 项」而没有任何报错）
    assert.notEqual(forceRows(manifest, 'local/scene').length, 0);
    assert.equal(forceRows(manifest, 'all').length, 4);
    assert.equal(forceRows(manifest, 'assets/local/ui/outer/x.png').length, 1);
    assert.equal(forceRows(manifest, 'local/nothing').length, 0, '不存在的组就是空');
    // 强制重下不看核对结论：每一行都带 need + kind（`jobsOf` 再把它折成 Downloader 的 job，`size` → `bytes`）
    const row = forceRows(manifest, 'local/ui')[0];
    assert.deepEqual([row.need, row.kind, row.size], [true, 'png', 10]);
    assert.equal(jobsOf([row], 'https://cdn.example.com')[0].bytes, 10, 'jobsOf 把 size 折成 bytes');
  });

  test('needRows：只挑缺的/短的，且同样认组名与精确路径', () => {
    const rows = [
      { rel: 'assets/local/scene/m01/scene.bin', need: true, status: 'missing' },
      { rel: 'assets/local/scene/m02/scene.bin', need: false, status: 'ok' },
      { rel: 'assets/local/ui/outer/x.png', need: true, status: 'short' },
    ];
    assert.deepEqual(needRows(rows, 'all').map((r) => r.rel), ['assets/local/scene/m01/scene.bin', 'assets/local/ui/outer/x.png']);
    assert.deepEqual(needRows(rows, 'local/scene').map((r) => r.rel), ['assets/local/scene/m01/scene.bin'], '整组完整的那一项不带出来');
    assert.deepEqual(needRows(rows, 'local/ui/outer/x.png').map((r) => r.rel), ['assets/local/ui/outer/x.png']);
  });
});

describe('真子进程那条路（node tools/large-assets.mjs --check --json）', () => {
  test('清单里有一项缺 ⇒ plan 事件说 repairable、退出码 1；补齐一项也不碰网络（--check 不下载）', () => {
    const root = tmp();
    const keep = write(root, 'assets/local/ui/ok.png', Buffer.from('ok'));
    const gone = path.join(root, 'public/assets/local/scene/x.bin');
    const files = {
      'assets/local/ui/ok.png': { size: 2, sha256: sha(Buffer.from('ok')) },
      'assets/local/scene/x.bin': { size: 32, sha256: sha(Buffer.alloc(32)) },
      'assets/audio/big.mp3': { size: 4096, sha256: sha(Buffer.alloc(4096, 7)) },
    };
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, MANIFEST_REL), JSON.stringify({ v: 1, files }, null, 1));
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, 'tools/large-assets.mjs'), '--check', '--json', '--root', root],
        { encoding: 'utf8', cwd: ROOT, env: { ...process.env, SP_CDN_BASE: 'http://127.0.0.1:1/' } });
    } catch (e) { code = e.status; out = String(e.stdout || ''); }
    const lines = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.type), ['plan', 'done']);
    assert.equal(lines[0].state, 'repairable');
    assert.deepEqual([lines[0].totals.checked, lines[0].totals.missing, lines[0].totals.ok], [3, 2, 1], '清单 3 项：盘上只有 1 项');
    assert.equal(lines[0].totals.needBytes, 32 + 4096);
    assert.equal(code, 1, '有缺失 ⇒ 退出码 1（运维看得见）');
    assert.ok(fs.existsSync(keep), '--check 不动盘上的东西');
    assert.equal(fs.existsSync(gone), false, '也不凭空造文件');
  });
});

describe('备用来源：Release 组包（repairFromPacks，注入 fetchImpl 与本地造的 zip）', () => {
  const absFor = (root, rel) => path.join(root, 'public', ...rel.split('/'));
  const packConfig = (groups, extra = {}) => ({
    v: 1, repo: 'o/n', tag: 't', releaseBase: 'https://rel.example.com/download', mirrors: [], groups, ...extra,
  });
  const zipResponse = (zip) => new Response(zip, { status: 200, headers: { 'content-length': String(zip.length) } });

  test('好条目写盘、size 不符的条目被点名丢弃（只写校验通过的）', async () => {
    const root = tmp();
    const good = Buffer.from('scene-bytes-'.repeat(64));
    const bad = Buffer.from('short');
    const relGood = 'assets/local/scene/m01/scene.bin';
    const relBad = 'assets/local/scene/m02/scene.bin';
    const manifest = {
      v: 1,
      files: {
        [relGood]: { size: good.length, sha256: sha(good) },
        [relBad]: { size: 4096, sha256: sha(Buffer.alloc(4096, 9)) },
      },
    };
    const rows = verify({ root, manifest }).rows;            // 两项都缺
    assert.equal(rows.length, 2);
    const zip = zipWrite([{ name: relGood, data: good }, { name: relBad, data: bad }]);
    const config = packConfig([{ id: 'local/scene', name: 'local/scene', file: 'local__scene.zip', bytes: zip.length }]);
    const asked = [];
    const events = [];
    const out = await repairFromPacks({
      root, manifest, rows, config, onEvent: (e) => events.push(e),
      fetchImpl: async (url) => { asked.push(url); return zipResponse(zip); },
    });
    assert.deepEqual([out.repaired, out.failed], [1, 1], '好的收下、坏的记一笔');
    assert.deepEqual(asked, ['https://rel.example.com/download/t/local__scene.zip'], '只按声明的 file 拼一个 URL');
    assert.equal(sha(fs.readFileSync(absFor(root, relGood))), sha(good), '好条目落盘且字节一致');
    assert.equal(fs.existsSync(absFor(root, relBad)), false, 'size 不符的条目丢弃、不落盘');
    assert.deepEqual(events.filter((e) => e.type === 'file').map((e) => [e.rel, e.status]), [[relGood, 'ok'], [relBad, 'error']], '好坏都进事件（坏的带着理由）');
    assert.deepEqual([verify({ root, manifest }).totals.missing, verify({ root, manifest }).totals.short], [1, 0]);
  });

  test('盘上已经好的那一项不被覆盖（好文件不换，哪怕清单那一行还标着缺）', async () => {
    const root = tmp();
    const same = Buffer.from('same-bytes-'.repeat(32));
    const rel = 'assets/local/scene/m01/scene.bin';
    const manifest = { v: 1, files: { [rel]: { size: same.length, sha256: sha(same) } } };
    write(root, rel, same);                                   // 盘上已经是对的
    assert.equal(verify({ root, manifest }).rows.length, 0, '核对结论：没问题');
    const zip = zipWrite([{ name: rel, data: Buffer.from('DIFFERENT-BYTES') }]);   // 组包里是另一份
    const config = packConfig([{ id: 'local/scene', file: 'local__scene.zip', bytes: zip.length }]);
    // 一个**过期**的行（标着仍缺）：落盘时必须以盘上的真相为准，别覆盖好文件
    const out = await repairFromPacks({ root, manifest, config, fetchImpl: async () => zipResponse(zip),
      rows: [{ rel, size: same.length, sha256: sha(same), kind: 'bin', need: true, status: 'missing' }] });
    assert.deepEqual([out.repaired, out.failed], [0, 0], '盘上没问题就不写、也不点名');
    assert.equal(sha(fs.readFileSync(absFor(root, rel))), sha(same), '好文件原样，没被组包那份换掉');
  });

  test('白名单：只取声明过的 groups[].file；未声明的组一个请求都不发', async () => {
    const root = tmp();
    const a = Buffer.from('a'.repeat(64));
    const b = Buffer.from('b'.repeat(64));
    const relScene = 'assets/local/scene/m01/scene.bin';
    const relUi = 'assets/local/ui/outer/x.png';
    const manifest = { v: 1, files: { [relScene]: { size: a.length, sha256: sha(a) }, [relUi]: { size: b.length, sha256: sha(b) } } };
    const rows = verify({ root, manifest }).rows;
    const zip = zipWrite([{ name: relScene, data: a }, { name: relUi, data: b }]);
    const config = packConfig([{ id: 'local/scene', name: 'local/scene', file: 'local__scene.zip', bytes: zip.length }]);   // 只声明 scene
    const asked = [];
    const out = await repairFromPacks({ root, manifest, rows, config, fetchImpl: async (url) => { asked.push(url); return zipResponse(zip); } });
    assert.deepEqual(asked, ['https://rel.example.com/download/t/local__scene.zip'], '只取声明过的那个 file，绝不自由拼 URL');
    assert.equal(out.repaired, 1, 'scene 那一项补上');
    assert.equal(out.failed, 1, '未声明的 local/ui 那一项如实点名');
    assert.equal(sha(fs.readFileSync(absFor(root, relScene))), sha(a));
    assert.equal(fs.existsSync(absFor(root, relUi)), false, '未声明的组不写');
  });

  test('只收 https：http 的源带理由拒绝、不尝试；回退到 https 的镜像', async () => {
    const root = tmp();
    const body = Buffer.from('q'.repeat(64));
    const rel = 'assets/local/scene/m01/scene.bin';
    const manifest = { v: 1, files: { [rel]: { size: body.length, sha256: sha(body) } } };
    const rows = verify({ root, manifest }).rows;
    const zip = zipWrite([{ name: rel, data: body }]);
    const config = packConfig([{ id: 'local/scene', file: 'local__scene.zip', bytes: zip.length }], { releaseBase: 'http://plain.example.com/dl', mirrors: ['https://ok.example.com'] });
    const asked = [];
    const out = await repairFromPacks({ root, manifest, rows, config, fetchImpl: async (url) => { asked.push(url); return zipResponse(zip); } });
    assert.deepEqual(asked, ['https://ok.example.com/local__scene.zip'], 'http 的 releaseBase 不尝试，回退到 https 的 mirror');
    assert.equal(out.repaired, 1);
  });

  test('组包取不到时不阻断：逐条点名，别的组照补', async () => {
    const root = tmp();
    const goodScene = Buffer.from('s'.repeat(128));
    const goodUi = Buffer.from('u'.repeat(128));
    const relScene = 'assets/local/scene/m01/scene.bin';
    const relUi = 'assets/local/ui/outer/x.png';
    const manifest = { v: 1, files: { [relScene]: { size: goodScene.length, sha256: sha(goodScene) }, [relUi]: { size: goodUi.length, sha256: sha(goodUi) } } };
    const rows = verify({ root, manifest }).rows;
    const zipUi = zipWrite([{ name: relUi, data: goodUi }]);
    const config = packConfig([
      { id: 'local/scene', file: 'local__scene.zip', bytes: 100 },
      { id: 'local/ui', file: 'local__ui.zip', bytes: zipUi.length },
    ]);
    const asked = [];
    const logs = [];
    const out = await repairFromPacks({
      root, manifest, rows, config, log: (s) => logs.push(s),
      fetchImpl: async (url) => { asked.push(url); return String(url).endsWith('local__scene.zip') ? new Response('gone', { status: 404 }) : zipResponse(zipUi); },
    });
    assert.deepEqual([out.repaired, out.failed], [1, 1], 'scene 取不到只点名，ui 照补');
    assert.equal(sha(fs.readFileSync(absFor(root, relUi))), sha(goodUi));
    assert.equal(fs.existsSync(absFor(root, relScene)), false);
    assert.ok(asked.every((u) => u.includes('local__scene.zip') || u.includes('local__ui.zip')), '只问了两个声明的包');
    assert.ok(logs.some((l) => l.includes('组包 local__scene.zip 没取到')), '取不到的那一组如实点名');
  });

  test('坏归档（zipRead 拒 `..` 路径）整份被拒、什么都不写、也不写到 public/ 之外', async () => {
    const root = tmp();
    const body = Buffer.from('z'.repeat(64));
    const rel = 'assets/local/scene/m01/scene.bin';
    const manifest = { v: 1, files: { [rel]: { size: body.length, sha256: sha(body) } } };
    const rows = verify({ root, manifest }).rows;
    const evil = zipWrite([{ name: '../escape.bin', data: body }]);
    const config = packConfig([{ id: 'local/scene', file: 'local__scene.zip', bytes: evil.length }]);
    const out = await repairFromPacks({ root, manifest, rows, config, fetchImpl: async () => zipResponse(evil) });
    assert.deepEqual([out.repaired, out.failed], [0, 1]);
    assert.equal(fs.existsSync(absFor(root, rel)), false);
    assert.equal(fs.existsSync(path.join(root, 'public/escape.bin')), false, '没有写到 public/ 之外');
    assert.equal(packSafeRel('../escape.bin'), false);
  });

  test('packRows：缺/短/哈希不符都收；好的与「比清单大」不收', () => {
    const rows = [
      { rel: 'assets/local/scene/a.bin', need: true, status: 'missing' },
      { rel: 'assets/local/scene/b.bin', need: true, status: 'short' },
      { rel: 'assets/local/scene/c.bin', need: false, status: 'sha' },
      { rel: 'assets/local/scene/d.bin', need: false, status: 'longer' },
      { rel: 'assets/local/scene/e.bin', need: false, status: 'ok' },
      { rel: 'assets/local/ui/f.png', need: true, status: 'missing' },
    ];
    assert.deepEqual(packRows(rows, 'all').map((r) => r.rel), ['assets/local/scene/a.bin', 'assets/local/scene/b.bin', 'assets/local/scene/c.bin', 'assets/local/ui/f.png']);
    assert.deepEqual(packRows(rows, 'local/scene').map((r) => r.rel), ['assets/local/scene/a.bin', 'assets/local/scene/b.bin', 'assets/local/scene/c.bin']);
  });
});

describe('真子进程：--repair 的备用来源那条路（两个源都不可达也不崩）', () => {
  test('CDN 与组包都取不到 ⇒ 退出码 1、summary 里如实记「仍缺」、stderr 有人话点名', () => {
    const root = tmp();
    const rel = 'assets/local/scene/m01/scene.bin';
    const manifest = { v: 1, files: { [rel]: { size: 64, sha256: sha(Buffer.alloc(64, 5)) } } };
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, MANIFEST_REL), JSON.stringify(manifest, null, 1));
    fs.writeFileSync(path.join(root, 'data/asset-pack.json'), JSON.stringify({
      v: 1, repo: 'o/n', tag: 't', releaseBase: 'https://127.0.0.1:1', mirrors: [],
      groups: [{ id: 'local/scene', name: 'local/scene', file: 'local__scene.zip', bytes: manifest.files[rel].size }],
    }, null, 1));
    let out;
    let err;
    let code = 0;
    try {
      out = execFileSync(process.execPath, [path.join(ROOT, 'tools/large-assets.mjs'), '--repair', '--json', '--root', root],
        { encoding: 'utf8', cwd: ROOT, env: { ...process.env, SP_CDN_BASE: 'http://127.0.0.1:1/' } });
    } catch (e) { code = e.status; out = String(e.stdout || ''); err = String(e.stderr || ''); }
    assert.equal(code, 1, '仍有缺项 ⇒ 退出码 1（工具没崩、也没假装成功）');
    const lines = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines[0].type, 'plan');
    const summary = lines.at(-1);
    assert.equal(summary.type, 'summary');
    assert.equal(summary.failed, 1, 'CDN 失败 + 组包取不到，最后仍是 1 项缺（不是两手相加）');
    assert.ok(err.includes('组包 local__scene.zip 没取到'), 'stderr 点名了取不到的组包');
  });
});
