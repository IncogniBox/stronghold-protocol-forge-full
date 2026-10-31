// test/ui/recon-chess-alias.test.js — 重构模拟的棋子别名（客户端 `public/js/data.js`，业主 2026-10-31）。
//
// 根因：`aliasChess` 从前只把 `chessId` 换成正式 id，`baseId` / `goldenId` / `upgradeChessId` 仍带 `recon_` 前缀。
// `server/sim/content/index.js kitKeyOf` 只认 `baseId` / `id` / 去 `_a` `_b` 后缀的 id —— 三处都带着 `recon_` 时
// 一个都命中不了，浏览器跑的战斗里**被覆盖的官方棋子**（普通与金色）整块退回 generic kit：技能 / 特质 / 天赋全丢。
// 现在与服务器 `shared/reconModes.js reconChessAlias` 同口径去掉前缀，这里钉住这条回归。
//
// 跑法：node --test test/ui/recon-chess-alias.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OFFICIAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const RECON = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/chess.json'), 'utf8'));

const { data } = await import('../../public/js/data.js');
const { normalizeChess } = await import('../../server/sim/simdata.js');
const { kitOf } = await import('../../server/sim/content/index.js');

/** 与 `public/js/screens/game.js` 里那段 useEffect 同一条口径（`recon_<id>` → 正式 id）。 */
function aliasMap(file) {
  const map = {};
  for (const id of Object.keys(file)) {
    if (id.startsWith('recon_') && id.length > 'recon_'.length) map[id.slice('recon_'.length)] = id;
  }
  return map;
}

/** 一份把包内 `recon_*` 记录并进官方表的文件（客户端拿到的就是它：服务器按 `pack.json.content` 合并）。 */
const FILE = { ...OFFICIAL, ...RECON };

data.setContent({ id: 'recon-alias-test', values: { chess: FILE } });
data.setChessAlias(aliasMap(FILE));

/** 别名后的记录 → 引擎的 kit（`kitOf` 与浏览器战斗运行器同一条路径）。 */
function kitOfRecord(rec) {
  const def = normalizeChess(rec);
  const build = kitOf(def);
  assert.equal(typeof build, 'function', `${rec.chessId} 应有 kit`);
  return { def, kit: build(rec.trait?.bb ?? {}, rec, def) };
}

test('别名去掉 recon_ 前缀：被覆盖的官方棋子（含金色）仍命中官方 kit', () => {
  const table = data.get('chess');
  const normal = table['chess_char_5_23_a'];
  const elite = table['chess_char_5_23_b'];
  assert.ok(normal && elite, '普通与精锐都在表里');
  for (const rec of [normal, elite]) {
    assert.equal(rec.chessId, rec.isGolden ? 'chess_char_5_23_b' : 'chess_char_5_23_a', 'chessId 用正式 id');
    assert.ok(!String(rec.baseId).startsWith('recon_'), 'baseId 不带 recon_ 前缀');
    assert.ok(!String(rec.goldenId).startsWith('recon_'), 'goldenId 不带 recon_ 前缀');
  }
  assert.equal(normal.baseId, 'chess_char_5_23_a');
  assert.equal(elite.baseId, 'chess_char_5_23_a', '普通与金色共享同一个正式 baseId');
  for (const rec of [normal, elite]) {
    const { kit } = kitOfRecord(rec);
    assert.notEqual(kit?.generic, true, `${rec.chessId} 不应退回 generic kit`);
    assert.ok(kit?.skills && Object.keys(kit.skills).length > 0, '技能还在');
  }
});

test('别名新增干员（官方的 id + kitRef）：官方 kit 照常命中', () => {
  const table = data.get('chess');
  const rec = table['chess_ws_recon_zuole_a'];
  assert.ok(rec, '新增干员按正式 id 加入');
  assert.equal(rec.chessId, 'chess_ws_recon_zuole_a');
  assert.equal(rec.baseId, 'chess_ws_recon_zuole_a', 'baseId 同样去掉 recon_ 前缀');
  assert.equal(rec.kitRef, 'char_4121_zuole');
  const { kit } = kitOfRecord(rec);
  assert.notEqual(kit?.generic, true, '走官方自选 kit，不是 generic');
  assert.ok(kit?.skills && Object.keys(kit.skills).length > 0);
  assert.ok(Array.isArray(kit?.talents) && kit.talents.length > 0, '天赋随 kit 一起装上');
});

test('撤销别名：表回到官方 + 包内记录原样（对局之外不生效）', () => {
  data.setChessAlias(null);
  const table = data.get('chess');
  const official = table['chess_char_5_23_a'];
  assert.equal(official.baseId, 'chess_char_5_23_a');
  assert.equal(table['chess_ws_recon_zuole_a'], undefined, '新增干员不在官方表里');
  assert.ok(table['recon_chess_ws_recon_zuole_a'], 'recon_* 记录仍在原始文件里');
  // 复原，免得影响同进程的其他 UI 测试
  data.setChessAlias(aliasMap(FILE));
});
