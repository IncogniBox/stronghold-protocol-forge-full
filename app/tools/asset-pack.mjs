// tools/asset-pack.mjs — 「大型资源」的**备用下载源**（方案 A：整包 zip、客户端下、复用「导入素材包」那条路）。
//
// 业主的服务器上那批大文件（面板上「共 1751 个文件 · 1927 MB」）本来靠 `tools/large-assets.mjs --repair` 从
// `SP_CDN_BASE` 逐个补齐。这里给一条备用路：把 `data/large-assets.json`（那份清单就是权威）里的文件**按它的分组**
// 打成**每组一个 zip**，挂到维护者**公开 GitHub 仓**的 Release 附件（或自建镜像）上；玩家那侧由
// `public/js/ui/largeAssets.js` 的备用源区块下载整包，**逐文件的 SHA-256 校验交给已经存在的导入那条路**
// （`public/js/assetPack.js`，它只读服务器清单、按哈希收下、不上传内容）。
//
// 为什么自己写 ZIP 容器：这个仓库的 dependencies 刻意很小（整合包用 `npm ci --omit=dev` 重装），不为一个
// 打包脚本引第三方库；而 ZIP 的写法在本仓库里有一份现成的判据（`shared/zip.js` 的确定性规则：条目按名字排序、
// 固定 DOS 时间戳、deflate 只在真的更小时用）。这里**不 import 它**（本工具按约定只依赖 Node 内建），但遵守
// 同一套确定性规则 —— 同样的输入永远得到同样的字节（时间戳固定 1980-01-01，压缩等级固定）。体积都在 4 GiB
// 以内，所以不写 ZIP64；条目里不写 extra field，字节完全由内容决定。
//
// 用法：
//   node tools/asset-pack.mjs [--out dist/asset-pack] [--repo <owner/name>] [--tag <tag>] [--full|--only-full] [--base-url <前缀>] [--apply]
//     --out       产物目录（默认 dist/asset-pack；git 忽略 dist/）
//     --repo      公开仓 owner/name：给了它（配合 --tag）就打印每个包的 Release 直链
//     --tag       Release 的 tag（如 asset-pack-2026-10）
//     --full      额外再合一个 full.zip（全部文件打一起）
//     --only-full 只打 full.zip、**不**打每组那份（给「导入素材包」手动整包导入用；manifest 的 groups 因此为空）
//     --base-url  覆盖 releaseBase（默认 https://github.com/<repo>/releases/download）
//     --apply     把本次的 repo / tag / releaseBase 与产出的 groups **写进** `data/asset-pack.json`（原子写：临时文件 +
//                 rename）。既有 `mirrors` 非空则**原样保留**（那是运维手填的，工具不许清掉）；不给 --apply 就只打印。
//   产物：每组一个 zip（组名 local/scene → 文件名 local__scene.zip）、manifest.json（形状与 data/asset-pack.json
//   逐字段一致）、可选的 full.zip。
//   若 `data/asset-pack.json` **不存在**且没给 --apply：写一份骨架
//   `{v:1, repo:'', tag:'', releaseBase:'', mirrors:[], groups:[]}` —— 「还没配备用源」的面板据此显示提示；
//   已存在时**一个字节都不碰**（那是维护者填的配置，要覆盖就显式 --apply）。

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { groupOf, MANIFEST_REL as LARGE_MANIFEST_REL } from './large-assets.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 备用源的配置（维护者填；面板与打包脚本都认它）。 */
export const PACK_REL = 'data/asset-pack.json';
/** 默认产物目录（git 忽略）。 */
export const DEFAULT_OUT = 'dist/asset-pack';
/** GitHub Release 单个附件的上限（2 GiB）—— 超过 1.9 GiB 就提示会被拒收。 */
export const RELEASE_LIMIT_BYTES = Math.floor(1.9 * 1024 * 1024 * 1024);

// ── ZIP（确定性写侧，规则与 shared/zip.js 一致） ──────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** IEEE CRC-32（ZIP 每条本地头与中央目录项都带它）。 */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 固定的 DOS 时间戳 1980-01-01 00:00:00（DOS 零点：`date = (1<<5)|1 = 0x0021`）—— 字节因此与打包时刻无关。 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;
const DEFLATE_LEVEL = 9;

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * 把一个文件流式写进 zip（逐条：本地头 + payload），最后写中央目录与 EOCD。
 * 逐条读写，所以一个 600 MB 的组不会在内存里再叠一份整包。
 * @param {string} outAbs 产物绝对路径
 * @param {Array<{ name: string, abs: string }>} items 条目（名字就是清单里的 rel，导入侧按同一前缀识别）
 * @returns {{ bytes: number, files: number }}
 */
export function writeZip(outAbs, items) {
  const sorted = [...items].sort(byName);
  const fd = fs.openSync(outAbs, 'w');
  try {
    /** @type {Array<{ name: Buffer, utf8: boolean, method: number, crc: number, compSize: number, rawSize: number, offset: number }>} */
    const central = [];
    let offset = 0;
    for (const item of sorted) {
      const raw = fs.readFileSync(item.abs);
      const name = Buffer.from(item.name, 'utf8');
      if (name.length === 0 || name.length > 0xffff) throw new Error(`条目名长度不合法：${item.name}`);
      const crc = crc32(raw);
      const deflated = deflateRawSync(raw, { level: DEFLATE_LEVEL });
      const useDeflate = deflated.length < raw.length;
      const payload = useDeflate ? deflated : raw;
      const utf8 = /[^\x20-\x7e]/.test(item.name);
      if (offset + 30 + name.length + payload.length > 0xffffffff) throw new Error(`包超过 4 GiB，需要 ZIP64：${item.name}`);
      const local = Buffer.alloc(30 + name.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);                       // version needed 2.0（deflate 的最低要求）
      local.writeUInt16LE(utf8 ? 0x0800 : 0, 6);        // bit 11 = 名字是 UTF-8
      local.writeUInt16LE(useDeflate ? 8 : 0, 8);
      local.writeUInt16LE(DOS_TIME, 10);
      local.writeUInt16LE(DOS_DATE, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(payload.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);                       // extra：不写，字节就完全由内容决定
      name.copy(local, 30);
      fs.writeSync(fd, local);
      fs.writeSync(fd, payload);
      central.push({ name, utf8, method: useDeflate ? 8 : 0, crc, compSize: payload.length, rawSize: raw.length, offset });
      offset += local.length + payload.length;
    }
    let centralSize = 0;
    for (const e of central) {
      const rec = Buffer.alloc(46 + e.name.length);
      rec.writeUInt32LE(0x02014b50, 0);
      rec.writeUInt16LE(20, 4);
      rec.writeUInt16LE(20, 6);
      rec.writeUInt16LE(e.utf8 ? 0x0800 : 0, 8);
      rec.writeUInt16LE(e.method, 10);
      rec.writeUInt16LE(DOS_TIME, 12);
      rec.writeUInt16LE(DOS_DATE, 14);
      rec.writeUInt32LE(e.crc, 16);
      rec.writeUInt32LE(e.compSize, 20);
      rec.writeUInt32LE(e.rawSize, 24);
      rec.writeUInt16LE(e.name.length, 28);
      rec.writeUInt16LE(0, 30);                         // extra
      rec.writeUInt16LE(0, 32);                         // comment
      rec.writeUInt16LE(0, 34);                         // disk number
      rec.writeUInt16LE(0, 36);                         // internal attrs
      rec.writeUInt32LE(0, 38);                         // external attrs
      rec.writeUInt32LE(e.offset, 42);
      e.name.copy(rec, 46);
      fs.writeSync(fd, rec);
      centralSize += rec.length;
    }
    if (central.length > 0xffff) throw new Error('条目数超过 65535，需要 ZIP64');
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);                           // this disk
    eocd.writeUInt16LE(0, 6);                           // disk with the central directory
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);                          // comment length
    fs.writeSync(fd, eocd);
    return { bytes: offset + centralSize + 22, files: central.length };
  } finally {
    fs.closeSync(fd);
  }
}

/** SHA-256（hex）of a file on disk, read in chunks (a pack can be hundreds of MB). */
export function sha256File(abs) {
  const h = createHash('sha256');
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(1 << 22);
    let at = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, at);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
      at += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// ── 分组与产物 ─────────────────────────────────────────────────────────────────

/** rel → 绝对路径（都在 public/ 下）。 */
export const absOf = (root, rel) => path.join(root, 'public', ...rel.split('/'));
/** 组名 → 附件文件名：`local/scene` → `local__scene.zip`（`/` 换成 `__`）。 */
export const packFileName = (id) => `${String(id).replace(/\//g, '__')}.zip`;

/**
 * 清单里的文件按组切开（组的划分与 `tools/large-assets.mjs groupOf` 同一份实现，面板也是这么分的）。
 * @param {{ files?: Record<string, { size: number, sha256: string }> }} manifest
 * @returns {Array<{ id: string, name: string, file: string, rels: string[], bytes: number }>}
 */
export function planGroups(manifest) {
  const byGroup = new Map();
  for (const rel of Object.keys(manifest.files || {}).sort()) {
    const id = groupOf(rel);
    if (!byGroup.has(id)) byGroup.set(id, []);
    byGroup.get(id).push(rel);
  }
  return [...byGroup]
    .map(([id, rels]) => ({ id, name: id, file: packFileName(id), rels, bytes: rels.reduce((s, r) => s + (manifest.files[r].size || 0), 0) }))
    .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
}

/** `data/asset-pack.json` 的形状（见任务接口 ③）。 */
export function packManifest({ repo = '', tag = '', releaseBase = '', mirrors = [], groups = [] }) {
  return { v: 1, repo, tag, releaseBase, mirrors, groups };
}

/** 骨架：文件不存在时写这一份，面板据此显示「还没配备用源」。 */
export const emptyPack = () => packManifest({});

const readJson = (abs) => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } };
const MB = (n) => (Number(n) || 0) / 1048576;

/** 原子写 JSON：先写 `<path>.tmp` 再 rename（与 tools/fetch-assets.mjs `writeJsonAtomic` 同一做法）。 */
function writeJsonAtomic(abs, value) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(`${abs}.tmp`, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(`${abs}.tmp`, abs);
}

/**
 * 打包：读清单 → 每组一个 zip → 写 manifest.json（+ 可选的 full.zip）。
 * `apply` 为真时把本次的 repo / tag / releaseBase 与产出的 groups 写进 `data/asset-pack.json`（原子写；
 * 既有 `mirrors` 原样保留）。
 * @param {{ root?: string, out?: string, repo?: string, tag?: string, baseUrl?: string, full?: boolean, onlyFull?: boolean, apply?: boolean, log?: (s: string) => void }} o
 */
export function pack({ root = ROOT, out = path.join(root, DEFAULT_OUT), repo = '', tag = '', baseUrl = '', full = false, onlyFull = false, apply = false, log = console.log } = {}) {
  const manifestAbs = path.join(root, LARGE_MANIFEST_REL);
  const manifest = readJson(manifestAbs);
  if (!manifest || !manifest.files) {
    throw new Error(`没有 ${LARGE_MANIFEST_REL}（先跑 node tools/large-assets.mjs --snapshot）`);
  }
  const groups = planGroups(manifest);
  fs.mkdirSync(out, { recursive: true });
  const releaseBase = String(baseUrl || (repo ? `https://github.com/${repo}/releases/download` : '')).replace(/\/+$/, '');

  const itemsOf = (rels) => rels.map((rel) => ({
    name: rel,
    abs: absOf(root, rel),
  }));
  const made = [];
  // `onlyFull`：只打整包 ⇒ 每组那份不写（manifest 的 groups 为空），但仍要先确认清单里的文件都在盘上。
  if (onlyFull) {
    const missing = Object.keys(manifest.files).filter((rel) => !fs.existsSync(absOf(root, rel)));
    if (missing.length) throw new Error(`清单里的文件不在盘上：${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}`);
  } else {
    for (const g of groups) {
      const missing = g.rels.filter((rel) => !fs.existsSync(absOf(root, rel)));
      if (missing.length) throw new Error(`清单里的文件不在盘上：${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}`);
      const abs = path.join(out, g.file);
      const { bytes } = writeZip(abs, itemsOf(g.rels));
      made.push({ id: g.id, name: g.name, file: g.file, bytes, sha256: sha256File(abs), files: g.rels.length });
      log(`[素材包] ${g.file} ← ${g.rels.length} 个文件 / ${MB(bytes).toFixed(1)} MB（zip）`);
      if (bytes > RELEASE_LIMIT_BYTES) log(`[素材包] ⚠ ${g.file} ${MB(bytes).toFixed(1)} MB 超过 1.9 GiB —— GitHub Release 单个附件上限 2 GiB，会被拒收`);
    }
  }
  if (full || onlyFull) {
    const allRels = [...Object.keys(manifest.files || {})].sort();
    const abs = path.join(out, 'full.zip');
    const { bytes } = writeZip(abs, itemsOf(allRels));
    log(`[素材包] full.zip ← ${allRels.length} 个文件 / ${MB(bytes).toFixed(1)} MB（zip）`);
    if (bytes > RELEASE_LIMIT_BYTES) log(`[素材包] ⚠ full.zip ${MB(bytes).toFixed(1)} MB 超过 1.9 GiB —— GitHub Release 单个附件上限 2 GiB，会被拒收`);
  }

  const doc = packManifest({ repo, tag, releaseBase, mirrors: [], groups: made });
  const manifestOut = path.join(out, 'manifest.json');
  fs.writeFileSync(manifestOut, `${JSON.stringify(doc, null, 1)}\n`);
  log(`[素材包] 清单已写 ${path.relative(root, manifestOut)}（形状就是 data/asset-pack.json 要的那份）`);

  // 配置：`--apply` 才写盘（原子写）；既有 mirrors 原样保留；没给 --apply 时只在文件**不存在**时放一份骨架。
  const packAbs = path.join(root, PACK_REL);
  const existing = readJson(packAbs);
  if (apply) {
    const mirrors = Array.isArray(existing?.mirrors) ? existing.mirrors : [];
    const next = packManifest({ repo, tag, releaseBase, mirrors, groups: made });
    log(`[素材包] 将写入 ${next.groups.length} 个组、repo=${repo || '(空)'} tag=${tag || '(空)'} → ${PACK_REL}`
      + `${mirrors.length ? `（保留既有 ${mirrors.length} 个 mirrors）` : ''}`);
    writeJsonAtomic(packAbs, next);
    log(`[素材包] 已原子写入 ${PACK_REL}`);
  } else if (!existing) {
    writeJsonAtomic(packAbs, emptyPack());
    log(`[素材包] 已生成骨架 ${PACK_REL}（groups 为空 ⇒ 面板显示「还没配备用源」；要把它填上就加 --apply）`);
  } else {
    log(`[素材包] ${PACK_REL} 已存在，未改动（加 --apply 才会写；它由维护者填 repo / tag / mirrors）`);
  }

  if (repo && tag) {
    log('[素材包] Release 直链：');
    for (const m of made) log(`  <${releaseBase}/${tag}/${m.file}>`);
    if (full || onlyFull) log(`  <${releaseBase}/${tag}/full.zip>`);
  } else {
    log('[素材包] 未给 --repo/--tag：不打印 Release 直链（给了才打印）');
  }
  return { out, groups: made, manifest: doc, full };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  if (has('--help') || has('-h')) {
    console.log('node tools/asset-pack.mjs [--out dist/asset-pack] [--repo <owner/name>] [--tag <tag>] [--full|--only-full] [--base-url <前缀>] [--apply]');
    return 0;
  }
  const root = path.resolve(val('--root', ROOT));
  const out = path.resolve(val('--out', path.join(root, DEFAULT_OUT)));
  const r = pack({
    root, out,
    repo: val('--repo', ''),
    tag: val('--tag', ''),
    baseUrl: val('--base-url', ''),
    full: has('--full'),
    onlyFull: has('--only-full'),
    apply: has('--apply'),
  });
  const total = r.groups.reduce((s, g) => s + g.bytes, 0);
  console.log(r.groups.length
    ? `[素材包] 完成：${r.groups.length} 个包 / ${MB(total).toFixed(1)} MB → ${path.relative(root, r.out)}`
    : `[素材包] 完成：只有 full.zip → ${path.relative(root, r.out)}`);
  return 0;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code ?? 0; }, (e) => {
    console.error(`[素材包] 出错：${e?.message || e}`);
    process.exitCode = 1;
  });
}
