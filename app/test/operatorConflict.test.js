// test/operatorConflict.test.js — 同一个 id 被两个包各贡献一份时，合并层**留下被丢掉的那一份**（`data.workshopConflicts`），
// 供「干员冲突兼容」这类包让玩家自己挑；以及那条索引的形状（赢家在 `packs[0]`、覆盖官方 id 时候选是合成体）。
//
// 这一份钉的是**引擎格**，不含那个包的界面：合并规则本身一字未改（赢家仍是字典序小的包 id，`PACK_ID_COLLISION`
// 一条不少），多出来的只是「输家那一份还在」。六段：① 合并层留输家；② `room.conflict` 的判据（宽松）；
// ③ 对局内**按玩家**换记录（`server/match/player/conflict.js`）；④ 只读路由 `/workshop-conflicts.json`；
// ⑤ 客户端纯逻辑（`public/js/ui/conflictModel.js`）；⑥ 接线（同步那一条消息 + 界面只读只读索引）。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { applyWorkshop } from '../shared/workshop.js';
import { loadWorkshop } from '../server/workshop.js';
import { checkConflictPicks, isConflictPicks, CONFLICT_LIMITS, C2S } from '../shared/protocol.js';
import { PlayerConflict, conflictGameData } from '../server/match/player/conflict.js';
import { createRequestHandler } from '../server/http/routes.js';
import {
  cleanConflictPicks, parseStoredConflict, toStoredConflict, conflictCandidates, conflictWinner,
  effectiveConflictor, withConflictPick, sanitizeConflictPicks,
} from '../public/js/ui/conflictModel.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

let tmp;
let ws;
const packDir = (id, root = ws) => join(root, id);
const writePack = (id, raw, files = {}, root = ws) => {
  fs.mkdirSync(packDir(id, root), { recursive: true });
  fs.writeFileSync(join(packDir(id, root), 'pack.json'), `${JSON.stringify(raw, null, 2)}\n`);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(packDir(id, root), ...rel.split('/'));
    fs.mkdirSync(dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
};
const load = (root = ws) => loadWorkshop(root, { log: quiet });
/** The chess record the overlay produced for `id` (the winner). */
const merged = (data, id) => data.chess[id];
/** The conflict entry for `id`, or null. */
const conflictOf = (data, id) => (data.workshopConflicts?.chess?.[id] ?? null);

before(() => {
  tmp = fs.mkdtempSync(join(tmpdir(), 'sp-op-conflict-'));
  ws = join(tmp, 'workshop');
  fs.mkdirSync(ws, { recursive: true });
});
after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

describe('合并层：同一个新 id 被两个包各加一份', () => {
  const ID = 'chess_dup_amiya_a';

  test('合并结果仍是字典序小的那一份，但**丢掉的那一份**留在 workshopConflicts 里', () => {
    // 每个用例住自己的工坊根（`loadWorkshop` 只列根目录下的包）
    const root = join(tmp, 'same-new-id');
    writePack('b-pack', { id: 'b-pack', content: ['chess'] }, {
      'chess.json': { [ID]: { chessId: ID, charId: 'char_dup_b', name: 'B 的那一份', tier: 1, stats: { atk: 2 } } },
    }, root);
    writePack('a-pack', { id: 'a-pack', content: ['chess'] }, {
      'chess.json': { [ID]: { chessId: ID, charId: 'char_dup_a', name: 'A 的那一份', tier: 1, stats: { atk: 1 } } },
    }, root);
    const loaded = load(root);
    assert.deepEqual(loaded.errors, [], JSON.stringify(loaded.errors));
    const { data, report } = applyWorkshop({ chess: {} }, loaded.packs);

    // ① 合并规则一字未改：`a-pack` < `b-pack`，赢家还是 a-pack
    assert.equal(merged(data, ID).name, 'A 的那一份', '合并结果仍是字典序小的那一份');
    assert.equal(merged(data, ID).charId, 'char_dup_a');
    // ② 那条点名报告一条不少（输的一方仍要看到一行字）
    const hit = report.errors.find((e) => e.code === 'PACK_ID_COLLISION');
    assert.ok(hit, JSON.stringify(report.errors));
    assert.equal(hit.pack, 'b-pack');
    assert.equal(hit.definedBy, 'a-pack');
    assert.equal(hit.file, 'chess');
    assert.equal(hit.id, ID);
    // ③ 新增：丢掉的那一份留下来了，赢家在最前面
    const c = conflictOf(data, ID);
    assert.ok(c, 'workshopConflicts 里应当有这条冲突');
    assert.equal(c.winner, 'a-pack');
    assert.deepEqual(c.packs.map((p) => p.pack), ['a-pack', 'b-pack'], 'packs[0] 恒是赢家');
    assert.equal(c.packs[0].record.name, 'A 的那一份');
    assert.equal(c.packs[1].record.name, 'B 的那一份', '输家那一份是**完整记录**，不是补丁');
    assert.equal(c.packs[1].record.stats.atk, 2, '输家那份的数值原样带出来');
  });

  test('三个包撞同一个 id：赢家 + 两个输家的候选都在', () => {
    const root = join(tmp, 'three-way');
    const mk = (pack, name, atk) => writePack(pack, { id: pack, content: ['chess'] }, {
      'chess.json': { [ID]: { chessId: ID, charId: `char_${pack}`, name, tier: 1, stats: { atk } } },
    }, root);
    mk('c-pack', 'C 的那一份', 3); mk('b-pack', 'B 的那一份', 2); mk('a-pack', 'A 的那一份', 1);
    const { data } = applyWorkshop({ chess: {} }, load(root).packs);
    const c = conflictOf(data, ID);
    assert.deepEqual(c.packs.map((p) => p.pack), ['a-pack', 'b-pack', 'c-pack']);
    assert.deepEqual(c.packs.map((p) => p.record.name), ['A 的那一份', 'B 的那一份', 'C 的那一份']);
  });
});

describe('合并层：两个包各覆盖同一条官方 id（patch）', () => {
  const OFFICIAL = 'chess_char_1_01_a';

  test('候选是「官方 + 那条补丁」的**合成体**，不是一条缺一半字段的补丁', () => {
    const root = join(tmp, 'override-same-id');
    const base = { chess: { [OFFICIAL]: { chessId: OFFICIAL, charId: 'char_off', name: '官方的那一份', tier: 2, stats: { atk: 1, hp: 100 }, trait: { desc: '官方特性' } } } };
    writePack('a-pack', { id: 'a-pack', content: ['chess'], overrides: [`chess:${OFFICIAL}`] }, {
      'chess.json': { [OFFICIAL]: { stats: { atk: 10 } } },
    }, root);
    writePack('b-pack', { id: 'b-pack', content: ['chess'], overrides: [`chess:${OFFICIAL}`] }, {
      'chess.json': { [OFFICIAL]: { stats: { hp: 999 } } },
    }, root);
    const { data } = applyWorkshop(base, load(root).packs);

    // 赢家仍是 a-pack 的那条补丁：官方其余字段原样保留（覆盖是逐字段打补丁，不是整条替换）
    assert.equal(merged(data, OFFICIAL).stats.atk, 10);
    assert.equal(merged(data, OFFICIAL).stats.hp, 100, '官方那个数没被另一个包改掉');
    assert.equal(merged(data, OFFICIAL).trait.desc, '官方特性');

    const c = conflictOf(data, OFFICIAL);
    assert.ok(c, '两条补丁撞在同一条官方 id 上，也算这次冲突');
    assert.equal(c.winner, 'a-pack');
    assert.deepEqual(c.packs.map((p) => p.pack), ['a-pack', 'b-pack']);
    assert.equal(c.packs[0].record.stats.atk, 10, '赢家的候选就是合并结果里那份');
    assert.equal(c.packs[1].record.stats.atk, 1, 'b-pack 的候选 = 官方 + b 的补丁（atk 仍是官方那个数）');
    assert.equal(c.packs[1].record.stats.hp, 999);
    assert.equal(c.packs[1].record.name, '官方的那一份', '补丁没写的字段从官方补齐');
    assert.equal(c.packs[1].record.trait.desc, '官方特性');
  });
});

describe('合并层：没有冲突时不留痕迹', () => {
  test('一个包自己加的记录（或各加各的）不产生 workshopConflicts 键', () => {
    const root = join(tmp, 'no-conflict');
    writePack('a-pack', { id: 'a-pack', content: ['chess'] }, {
      'chess.json': { chess_only_a: { chessId: 'chess_only_a', charId: 'char_1', name: '唯一', tier: 1, stats: { atk: 1 } } },
    }, root);
    writePack('b-pack', { id: 'b-pack', content: ['chess'] }, {
      'chess.json': { chess_only_b: { chessId: 'chess_only_b', charId: 'char_2', name: '另一个', tier: 1, stats: { atk: 1 } } },
    }, root);
    const { data } = applyWorkshop({ chess: {} }, load(root).packs);
    assert.equal(Object.hasOwn(data, 'workshopConflicts'), false, '没有冲突就不设这个键（与 0.18.7 逐字节相同）');
    assert.ok(merged(data, 'chess_only_a') && merged(data, 'chess_only_b'));
  });

  test('压根没有工坊（workshopDir: null）时同样什么都没有', () => {
    const { data } = applyWorkshop({ chess: {} }, []);
    assert.equal(Object.hasOwn(data, 'workshopConflicts'), false);
  });
});

// ---- ② 判据：宽松（过期的选择逐项丢掉，绝不整条 BAD_MSG）---------------------------------------------------------

describe('room.conflict 的判据：宽松（过期的选择逐项丢掉，绝不整条 BAD_MSG）', () => {
  const ID = 'chess_dup_amiya_a';   // 被 a/b 两包各加一份（冲突）
  const SOLO = 'chess_only_a';      // 只有一个来源（不冲突）

  /** 一份合并结果：`ID` 冲突、`SOLO` 唯一。 */
  const merged = (root) => {
    writePack('a-pack', { id: 'a-pack', content: ['chess'] }, {
      'chess.json': {
        [ID]: { chessId: ID, charId: 'char_a', name: 'A 的', tier: 1 },
        [SOLO]: { chessId: SOLO, charId: 'char_s', name: '独一份', tier: 1 },
      },
    }, root);
    writePack('b-pack', { id: 'b-pack', content: ['chess'] }, {
      'chess.json': { [ID]: { chessId: ID, charId: 'char_b', name: 'B 的', tier: 1 } },
    }, root);
    return applyWorkshop({ chess: {} }, load(root).packs).data;
  };
  let d;
  before(() => { d = merged(join(tmp, 'judge')); });

  test('结构判据：一个 id → id 的映射，至多 CONFLICT_LIMITS.picks 条', () => {
    assert.equal(isConflictPicks({}), true);
    assert.equal(isConflictPicks({ [ID]: 'a-pack' }), true);
    assert.equal(isConflictPicks({ [ID]: 1 }), false);
    assert.equal(isConflictPicks({ '': 'a-pack' }), false, '空 id 不是 id');
    assert.equal(isConflictPicks('nope'), false);
    const many = {};
    for (let i = 0; i < CONFLICT_LIMITS.picks + 1; i++) many[`c_${i}`] = 'a-pack';
    assert.equal(isConflictPicks(many), false, `多过 ${CONFLICT_LIMITS.picks} 条是结构错`);
    delete many[`c_${CONFLICT_LIMITS.picks}`];
    assert.equal(isConflictPicks(many), true);
    assert.equal(typeof C2S['room.conflict'].picks, 'function', 'C2S 里必须真有这一条');
  });

  test('语义判据：认得的留下，认不得的逐项丢掉（整条仍是 ok）', () => {
    const res = checkConflictPicks({ [ID]: 'b-pack', [SOLO]: 'a-pack', ghost_chess: 'a-pack' }, d);
    assert.equal(res.ok, true);
    assert.deepEqual(res.picks, { [ID]: 'b-pack' }, '只留真的有冲突、且那个包真的贡献过的那一条');
    assert.equal(res.dropped, 2, '不冲突的 id 与不存在的 id 各算一条丢掉');
    const notCandidate = checkConflictPicks({ [ID]: 'c-pack' }, d);
    assert.deepEqual(notCandidate.picks, {}, '不是候选的包丢掉');
    assert.equal(notCandidate.dropped, 1);
    assert.equal(checkConflictPicks('nope', d).error, 'BAD_MSG', '畸形输入才是 BAD_MSG');
    assert.equal(checkConflictPicks({ [ID]: 42 }, d).error, 'BAD_MSG');
    const noIndex = checkConflictPicks({ [ID]: 'a-pack' }, {});
    assert.equal(noIndex.ok, true, '没有索引的数据不是错：任何选择都丢掉');
    assert.deepEqual(noIndex.picks, {});
    assert.equal(noIndex.dropped, 1);
  });
});

// ---- ③ 对局内按玩家换记录（server/match/player/conflict.js）-------------------------------------------------------

describe('对局内按玩家换记录（server/match/player/conflict.js）', () => {
  const ID = 'chess_dup_amiya_a';
  const SOLO = 'chess_only_a';
  let d;
  let gd;      // 比赛自己那一份 GameData（这里是它的两个方法：raw / chess）
  let player;  // 一个玩家的视图（PlayerConflict 只有一个 m.gd 依赖）

  before(() => {
    const root = join(tmp, 'player');
    writePack('a-pack', { id: 'a-pack', content: ['chess'] }, {
      'chess.json': {
        [ID]: { chessId: ID, charId: 'char_a', name: 'A 的', tier: 1 },
        [SOLO]: { chessId: SOLO, charId: 'char_s', name: '独一份', tier: 1 },
      },
    }, root);
    writePack('b-pack', { id: 'b-pack', content: ['chess'] }, {
      'chess.json': { [ID]: { chessId: ID, charId: 'char_b', name: 'B 的', tier: 1 } },
    }, root);
    d = applyWorkshop({ chess: {} }, load(root).packs).data;
    gd = { raw: d, chess: (id) => (typeof id === 'string' && Object.hasOwn(d.chess, id) ? d.chess[id] : null) };
    player = Object.assign(Object.create(PlayerConflict.prototype), {
      m: { gd, log: quiet, roomCode: 'TST' }, isBot: false, playerId: 'p1', _diyRecords: new Map(),
    });
  });

  test('没挑（或没冲突）时视图就是比赛那一份：每条记录原样', () => {
    assert.equal(player.gd, undefined, '还没挑过：没有视图');
    assert.equal(player.setConflict({}), true);
    assert.equal(player.gd.chess(ID), gd.chess(ID), '没有选择 → 落到比赛那一份（赢家）');
    assert.equal(player.gd.chess(SOLO), gd.chess(SOLO));
    assert.equal(player.gd.chess('ghost'), null, '不认识的 id 也落到比赛那一份');
  });

  test('挑输家那一份：这个玩家的 gd.chess(id) 换成那一份，别的查询一律不变', () => {
    assert.equal(player.setConflict({ [ID]: 'b-pack' }), true);
    assert.deepEqual({ ...player.conflict }, { [ID]: 'b-pack' }, '记下的就是那一格');
    assert.equal(player.gd.chess(ID).name, 'B 的', '挑中的那一份就是它');
    assert.equal(player.gd.chess(ID).charId, 'char_b');
    assert.equal(player.gd.chess(SOLO), gd.chess(SOLO), '不冲突的记录仍落到比赛那一份');
    assert.equal(player.gd.matchData, gd, '视图挂着比赛那一份数据');
    // 而比赛自己那一份**一点没变**（per-player 视图的意义就在这）
    assert.equal(gd.chess(ID).name, 'A 的');
    assert.equal(d.chess[ID].name, 'A 的');
  });

  test('挑赢家 = 缺省：视图回到比赛那一份（同一条记录，不是复制）', () => {
    player.setConflict({ [ID]: 'b-pack' });
    assert.equal(player.setConflict({ [ID]: 'a-pack' }), true);
    assert.equal(player.gd.chess(ID), gd.chess(ID), '挑赢家与不挑逐字同一条');
  });

  test('过期 / 不认识的选择逐项丢掉；畸形输入整条拒掉且不改视图', () => {
    assert.equal(player.setConflict({ [ID]: 'zz-pack' }), true, '结构合法、语义全丢：仍是「收下」');
    assert.deepEqual({ ...player.conflict }, {}, '过期的选择被丢掉');
    assert.equal(player.gd.chess(ID).name, 'A 的', '回落到赢家');
    player.setConflict({ [ID]: 'b-pack' });
    const before = player.gd;
    assert.equal(player.setConflict('nope'), false, '畸形输入：拒掉');
    assert.equal(player.gd, before, '视图一个字节不动');
    assert.equal(player.gd.chess(ID).name, 'B 的');
  });

  test('`conflictGameData` 只是又一层视图：包裹的查询原样穿透', () => {
    const view = conflictGameData(gd, new Map([[ID, { chessId: ID, name: '替身' }]]));
    assert.equal(view.chess(ID).name, '替身');
    assert.equal(view.chess(SOLO), gd.chess(SOLO), '没换的 id 穿透');
    assert.equal(Object.getPrototypeOf(view), gd, '视图是 Object.create(gd)');
    assert.equal(view.matchData, gd, '视图自己带一份「比赛那一份」的指针');
  });
});

// ---- ④ 只读路由（server/http/routes.js）---------------------------------------------------------------------------

describe('只读路由 /workshop-conflicts.json', () => {
  const HEALTH = { startedAt: Date.now(), network: { connectionCount: 0 }, registry: { size: 0 }, lobby: { stats: () => ({}) } };
  const INDEX = { chess: { chess_dup_amiya_a: { winner: 'a-pack', packs: [{ pack: 'a-pack', record: { chessId: 'chess_dup_amiya_a', name: 'A 的' } }] } } };

  const boot = async (extra) => {
    const handler = createRequestHandler({
      serveStatic: async (_req, res, rawPath) => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end(`static:${rawPath}`); },
      health: HEALTH, log: quiet, ...extra,
    });
    const server = http.createServer((req, res) => handler(req, res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = /** @type {{ port: number }} */ (server.address());
    return {
      ask: async (method, path) => {
        const r = await fetch(`http://127.0.0.1:${port}${path}`, { method });
        return { status: r.status, text: await r.text(), allow: r.headers.get('allow') };
      },
      close: () => new Promise((r) => server.close(r)),
    };
  };

  test('有冲突：200 + 那份索引（客户端靠它列出「有哪些可挑」）', async () => {
    const t = await boot({ workshopConflicts: { path: '/workshop-conflicts.json', list: () => INDEX } });
    try {
      const r = await t.ask('GET', '/workshop-conflicts.json');
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.text), INDEX);
    } finally { await t.close(); }
  });

  test('没有冲突：200 + null（不是 {}，也不是 404 —— 「根本没有冲突」与「列表是空的」不是同一件事）', async () => {
    const t = await boot({ workshopConflicts: { path: '/workshop-conflicts.json', list: () => null } });
    try {
      const r = await t.ask('GET', '/workshop-conflicts.json');
      assert.equal(r.status, 200);
      assert.equal(r.text, 'null');
    } finally { await t.close(); }
  });

  test('没接线：这条路根本不存在，未知路径照旧落静态处理器', async () => {
    const t = await boot({});
    try {
      const r = await t.ask('GET', '/workshop-conflicts.json');
      assert.equal(r.status, 404);
      assert.equal(r.text, 'static:/workshop-conflicts.json');
    } finally { await t.close(); }
  });

  test('源码级 + 真请求：这条路**只读**（选择不走 HTTP，POST 仍平铺 405）', async () => {
    const src = fs.readFileSync(join(ROOT, 'server/http/routes.js'), 'utf8');
    assert.match(src, /if \(workshopConflicts && parts\.rawPath === workshopConflicts\.path\) \{/, '那条分支必须只比较路径');
    assert.match(src, /sendJson\(req, res, 200, workshopConflicts\.list\(\)\)/, '只回同一份索引');
    const t = await boot({ workshopConflicts: { path: '/workshop-conflicts.json', list: () => INDEX } });
    try {
      const r = await t.ask('POST', '/workshop-conflicts.json');
      assert.equal(r.status, 405, '选择本身走 WebSocket，这条路只回答「有什么可挑」');
      assert.equal(r.allow, 'GET, HEAD');
    } finally { await t.close(); }
  });
});

// ---- ⑤ 客户端纯逻辑（public/js/ui/conflictModel.js）---------------------------------------------------------------

describe('客户端纯逻辑（public/js/ui/conflictModel.js）', () => {
  // 现实里的索引只在真的撞了 id 时才有一条（`packs` 至少两条：赢家 + 至少一个输家）。`one` 那条是「只有一个
  // 来源」的假想形状 —— 合并层不会产出它，但客户端那两个读索引的纯函数仍要判对它。
  const CONFLICTS = {
    chess: {
      c1: { winner: 'a-pack', packs: [{ pack: 'a-pack', record: { name: 'A' } }, { pack: 'b-pack', record: { name: 'B' } }] },
      c2: { winner: 'x-pack', packs: [{ pack: 'x-pack', record: { name: 'X' } }, { pack: 'y-pack', record: { name: 'Y' } }] },
      one: { winner: 'a-pack', packs: [{ pack: 'a-pack', record: { name: 'A' } }] },
    },
  };

  test('候选：只有真的多于一个来源的 id 才有候选（赢家在最前）', () => {
    assert.deepEqual(conflictCandidates(CONFLICTS, 'c1').map((p) => p.pack), ['a-pack', 'b-pack']);
    assert.deepEqual(conflictCandidates(CONFLICTS, 'c2').map((p) => p.pack), ['x-pack', 'y-pack']);
    assert.equal(conflictCandidates(CONFLICTS, 'one'), null, '只有一个来源不算冲突');
    assert.equal(conflictCandidates(CONFLICTS, 'ghost'), null);
    assert.equal(conflictCandidates(null, 'c1'), null);
    assert.equal(conflictCandidates({}, 'c1'), null);
    assert.equal(conflictWinner(CONFLICTS, 'c1'), 'a-pack');
    assert.equal(conflictWinner(CONFLICTS, 'ghost'), null);
  });

  test('缺省 = 赢家；挑赢家 = 取消（设置里只留「和默认不一样」的那几格）', () => {
    assert.equal(effectiveConflictor(CONFLICTS, 'c1', {}), 'a-pack');
    assert.equal(effectiveConflictor(CONFLICTS, 'c1', { c1: 'b-pack' }), 'b-pack');
    assert.equal(effectiveConflictor(CONFLICTS, 'c1', { c1: 'zz' }), 'a-pack', '候选里没有的包 → 回落到赢家');
    assert.deepEqual(withConflictPick({}, 'c1', 'b-pack', 'a-pack'), { c1: 'b-pack' });
    assert.deepEqual(withConflictPick({ c1: 'b-pack' }, 'c1', 'a-pack', 'a-pack'), {}, '挑赢家即清除');
    assert.deepEqual(withConflictPick({ c1: 'b-pack' }, 'c1', null, 'a-pack'), {});
    assert.deepEqual(withConflictPick({ c1: 'b-pack' }, 'c1', 42, 'a-pack'), {}, '不合法的值一律当作清除');
    const input = { c1: 'b-pack' };
    withConflictPick(input, 'c1', null, 'a-pack');
    assert.deepEqual(input, { c1: 'b-pack' }, '纯函数：入参不改');
  });

  test('结构与存量：干净化、上限、过期选择被丢掉', () => {
    assert.deepEqual(cleanConflictPicks({ c1: 'a-pack', bad: 1, '': 'x', c2: 'x-pack' }), { c1: 'a-pack', c2: 'x-pack' });
    assert.deepEqual(cleanConflictPicks('junk'), {});
    const many = {};
    for (let i = 0; i < CONFLICT_LIMITS.picks + 3; i++) many[`c_${i}`] = 'a-pack';
    assert.equal(Object.keys(cleanConflictPicks(many)).length, CONFLICT_LIMITS.picks, '上限与协议同一条');
    assert.deepEqual(parseStoredConflict({ v: 1, picks: { c1: 'b-pack' } }), { c1: 'b-pack' });
    assert.deepEqual(parseStoredConflict('junk'), {});
    assert.deepEqual(parseStoredConflict([{ c1: 'b-pack' }]), {});
    assert.deepEqual(toStoredConflict({ c1: 'b-pack' }), { v: 1, picks: { c1: 'b-pack' } });
    assert.deepEqual(sanitizeConflictPicks({ c1: 'b-pack', c2: 'x-pack', ghost: 'a-pack' }, CONFLICTS),
      { c1: 'b-pack', c2: 'x-pack' }, '认得的留下、认不得的丢掉（与服务端 checkConflictPicks 同一条判据）');
    assert.deepEqual(sanitizeConflictPicks({ c2: 'a-pack' }, CONFLICTS), {}, '不是这条记录的候选的包 → 丢掉');
  });
});

// ---- ⑥ 接线（同步那一条消息 + 界面在引擎侧）------------------------------------------------------------------------

describe('接线：第四条同步 + 界面在引擎侧（不新造面板通道）', () => {
  const read = (p) => fs.readFileSync(join(ROOT, p), 'utf8');

  test('同步走既有 installPrefSync，消息是 room.conflict，索引来自只读路由', () => {
    const sync = read('public/js/ui/loadoutSync.js');
    assert.match(sync, /msgType: 'room\.conflict'/, '发送的就是那一条 C2S');
    assert.match(sync, /export function installConflictSync\(/, '装一次的那条导出');
    assert.match(sync, /export function setConflictPick\(/, '编辑落点是 setConflictPick');
    assert.match(sync, /CONFLICT_URL = '\/workshop-conflicts\.json'/, '索引来自只读路由');
    assert.match(read('public/js/main.js'), /installConflictSync\(\{ net \}\);/, 'main.js 装上它');
  });

  test('界面在引擎侧：选择不进显示型白名单（面板改不了对局状态）', () => {
    const ext = read('public/js/ui/extensions.js');
    // 0.19.0 上游把 `room.mods` 加进这张闭枚举（房主改本房间**装载面**，服务端另有三道点名闸门）；本刀
    // 又加了 `room.chat`（**用户动作**，与玩家自己点「发送」同一条 C2S）—— 两刀都不是「改对局状态」的那一类；
    // 本条守的仍然是「**改对局状态**的消息一条都不许进」。
    assert.match(ext, /PANEL_SEND_TYPES = Object\.freeze\(\['room\.appearance', 'room\.mods', 'room\.chat'\]\)/, '闭枚举里只有展示 / 装载 / 用户动作三条');
    assert.doesNotMatch(ext, /room\.conflict/, '一条会改对局状态的消息不许顶掉「面板只能展示」这条边界');
    const screen = read('public/js/screens/loadout.js');
    assert.match(screen, /data-testid="loadout-conflict"/, '那一排按钮画在干员详情里');
    assert.match(screen, /<\$\{ConflictSwitch\}/, '渲染点就是这个组件');
    assert.match(screen, /conflict=\$\{st\.conflict\} conflicts=\$\{st\.conflicts\} onConflict=\$\{setConflictPick\}/, '详情卡接的是商店里那三格');
    assert.match(screen, /useEffect\(\(\) => \{ void loadConflicts\(\); \}, \[\]\)/, '打开浮层时拉一次只读索引');
  });
});
