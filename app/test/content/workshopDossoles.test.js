// test/content/workshopDossoles.test.js — 工坊包 `workshop/dossoles` 的盟约【多索雷斯】与假日威龙陈的特性。
//
// 机制这一半在包模块里（`@battle/mod.js` 的白名单导入 → `rewriteKitImports` → `data:` 模块，与 `server/battlePack.js`
// 同一条装载路径，见 test/match/recon-bosses.test.js）；数据这一半（`bonds.json` / `garrisons.json`）按
// `setGameData` 注入 —— 测试套件把进程数据单例钉在**官方基线**上（test/official-data.mjs），所以包自己的盟约记录
// 与干员特质一律经这里并进去，绝不假设它们出现在 `data/*.json` 里。
//
// 钉住的四件事（都是玩家报的问题）：
//   1. **阈值 2 / 4**：第 2 档要 4 名不同【多索雷斯】干员 —— 2 名时它的两条效果（爆发降防 / 爆发期元素伤害）不触发；
//   2. **特殊水地形看得见**：并集真的发出去（fx 种类 `dosWater`，带 `tiles` 地块表），而且**只有那些格**，不是全场；
//   3. **假日威龙陈的攻击范围 = 特殊水地形**（并集，**不是整张战场**），且**敌人站在水地形上时她的技能就会释放**
//      （不必走进她本体的攻击范围）；
//   4. **减速叠层的 80% 上限**：层数堆到 208 层，`moveMul` / `aspd` 仍停在 80%（卡片那一侧是 `effectDescParams.cap`，
//      见 test/ui/richText.test.js）。
//
// ⚠ `content: 'full'` 是必须的：盟约 installer 由 `content/bonds/core.js install` 调起（`extraContent` 只是把模块
// 的注册面挂上），`'generic'` 那一档不装 domain 模块。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import { setGameData, gameData } from '../../server/sim/content/support/index.js';
import { COLS } from '../../server/sim/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = path.join(ROOT, 'workshop/dossoles');
const BOND_REC = JSON.parse(fs.readFileSync(path.join(PACK, 'bonds.json'), 'utf8')).dossolesShip;
const GARRISONS = JSON.parse(fs.readFileSync(path.join(PACK, 'garrisons.json'), 'utf8'));

const BOND = 'dossolesShip';
const CHEN = 'chess_ws_dos_holungday_a';
/** 三名合成同伴（不带特质）+ 陈（带 `garrison_dos_holungday_a`）。 */
const MEMBERS = [CHEN, 'dos_mem_b', 'dos_mem_c', 'dos_mem_d'];
/** 各自 1-2 格的短范围：并集小到能逐格断言，同时**远小于**整张战场（19×21）。 */
const GRID = [[0, 0], [0, 1]];
const key = (r, c) => r * COLS + c;

let loaded = null;
/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块）。 */
async function packModule() {
  if (loaded) return loaded;
  const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
  const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
  loaded = await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  return loaded;
}

/** 把包的盟约记录 + 干员特质并进进程数据单例（`after` 里还原）。 */
function withPackData() {
  const d = gameData();
  setGameData({ ...d, bonds: { ...d.bonds, [BOND]: BOND_REC }, garrisons: { ...d.garrisons, ...GARRISONS } });
}
after(() => setGameData(null));

/** 一名合成【多索雷斯】干员（陈加上包里的特质记录，技能一开局就是满技力 → 条件满足即自动释放）。 */
function member(id, extra = {}) {
  const { garrisonIds, ...rest } = extra;
  const rec = { ...chessRec({ id, bonds: [BOND], rangeGrid: GRID, stats: { atk: 500, maxHp: 4000, def: 0 }, ...rest }), bonds: [BOND] };
  if (garrisonIds) rec.garrisonIds = garrisonIds;
  return rec;
}

/** 陈：带上包里的特质，技能满技力待放（MANUAL 引擎也会自动放，条件是 DEFAULT 触发判据 + 操作冷却）。 */
const chenRec = () => member(CHEN, {
  garrisonIds: ['garrison_dos_holungday_a'],
  skill: { initSp: 10, spCost: 10, skillType: 'MANUAL' },
});

/** 一只原地不动的靶子（高血、无攻击、不移动）。key 自带 `enemy_` 前缀 —— 引擎的 defId 就是它。 */
const DUMMY = 'enemy_dos_dummy';
const dummy = (o = {}) => enemyRec({ key: DUMMY, hp: 1e6, atk: 0, speed: 0, def: 0, ...o });

/**
 * 场地：成员（陈 + 若干同伴，各在一行上排开）+ 一只站在同伴视野里的靶子。
 * 陈自己的范围只有她脚下那一格，靶子离她 3 格 —— 所以「打得到」只可能来自水地形的延伸。
 */
async function scene(units, o = {}) {
  const mod = await packModule();
  const defs = { chess: {}, enemies: { [DUMMY]: dummy(o.dummy) } };
  for (const id of MEMBERS) defs.chess[id] = id === CHEN ? chenRec() : member(id);
  Object.assign(defs.chess, o.recs || {});
  const h = makeBattle({
    content: 'full', seed: 7, autoFinish: false, timeLimit: 60, captureNoisy: true,
    extraContent: [mod],
    defs,
    units: units.map((u) => ({ chessId: u.chessId, row: u.row, col: u.col })),
    enemies: [{ key: DUMMY, time: 0, route: 0, pos: o.enemyPos ?? [10, 8] }],
    bonds: { [BOND]: o.bond ?? { count: 4, active: true, tier: 2, layers: 0 } },
  });
  h.runUntil(() => h.allies().length >= units.length, 30);
  return h;
}

/** 4 名成员摆开的一条线：陈在最左，三个同伴依次向右。 */
const LINE = [
  { chessId: CHEN, row: 10, col: 5 },
  { chessId: 'dos_mem_b', row: 10, col: 7 },
  { chessId: 'dos_mem_c', row: 11, col: 8 },
  { chessId: 'dos_mem_d', row: 12, col: 7 },
];
/** 每名成员**本体**范围格子的并集（`baseRangeKeys` = 本体网格 + 永久 rangeExtend，不含延伸）。 */
const ownUnion = (h) => {
  const out = new Set();
  for (const u of MEMBERS.map((id) => h.unit(id)).filter(Boolean)) for (const k of u.baseRangeKeys || []) out.add(k);
  return out;
};
const fxOf = (h, kind) => h.eventsOf('fx').filter((e) => e[1] === kind);

test('特殊水地形：并集画在地块上（浅蓝波纹），且只有那些格 —— 不是全场', async () => {
  withPackData();
  const h = await scene(LINE);
  h.run(1.5);

  const painted = new Set();
  // fx 事件是四元组 + 载荷：`['fx', kind, x, y, extra]`（events.js `fx()`）
  for (const ev of fxOf(h, 'dosWater')) for (const [r, c] of ev[4].tiles || []) painted.add(key(r, c));
  const expected = ownUnion(h);
  assert.ok(expected.size >= 7, `并集应当有 4 名成员的本体格子：${expected.size}`);
  assert.deepEqual([...painted].sort((a, b) => a - b), [...expected].sort((a, b) => a - b), '画出来的正是并集');
  const all = [...expected].sort((a, b) => a - b).map((k) => `${Math.floor(k / COLS)},${k % COLS}`);
  assert.deepEqual(all, ['10,5', '10,6', '10,7', '10,8', '11,8', '11,9', '12,7', '12,8'], '并集就是这 8 格');
  h.invariants();
});

test('假日威龙陈：攻击范围 = 特殊水地形（并集），不是整张战场；技能在敌人处于水地形时即释放', async () => {
  withPackData();
  const h = await scene([...LINE]);
  h.run(1.5);
  const chen = h.unit(CHEN);
  const water = ownUnion(h);
  for (const k of water) assert.ok(chen.rangeKeySet.has(k), `水地形格 ${Math.floor(k / COLS)},${k % COLS} 在她的范围里`);
  assert.equal(chen.rangeKeySet.size, water.size, '她的范围**就是**并集（没有别的）');
  assert.ok(!chen.rangeKeySet.has(key(2, 10)), '不是整张战场（boss 半场那格不在里面）');
  assert.ok(chen.rangeKeySet.size < 30, `并集有界：${chen.rangeKeySet.size} 格`);
  // 靶子站在 (10,8)：陈本体范围只有 (10,5)，所以「打得到」只可能来自水地形的延伸
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === chen), 6), '她打到水地形上的敌人');
  // 技能：DEFAULT 触发判据只看 baseRangeKeys，所以是她那条「水地形触发范围」让技能放出来的
  assert.ok(h.runUntil(() => h.hooksOf('skillStart').some((c) => c.unit === chen), 6), '敌人处于特殊水地形中时技能就会释放');
  h.invariants();
});

test('假日威龙陈：没有别的成员（水地形只剩她自己脚下）时，视野外的敌人既打不到也放不出技能', async () => {
  withPackData();
  // 只上陈一个人：并集 = 她脚下那一格，(10,8) 上的靶子既不在水地形里、也不在她本体范围里
  const h = await scene([{ chessId: CHEN, row: 10, col: 5 }], { bond: { count: 2, active: true, tier: 1, layers: 0 } });
  h.run(6);
  const chen = h.unit(CHEN);
  assert.equal(chen.rangeKeySet.size, (chen.baseRangeKeys || []).length, '只剩她自己本体那几格');
  assert.ok(chen.rangeKeySet.has(key(10, 5)));
  assert.ok(!chen.rangeKeySet.has(key(10, 8)), '(10,8) 不是水地形');
  assert.equal(h.hooksOf('damaged').filter((c) => c.source === chen).length, 0, '打不到 (10,8)');
  assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === chen).length, 0, '技能也不放');
  h.invariants();
});

test('减速叠层：80% 上限（208 层仍是 80%，10 层是 15%）', async () => {
  withPackData();
  for (const [layers, pct] of [[0, 10], [10, 15], [208, 80]]) {
    const h = await scene([...LINE], { bond: { count: 4, active: true, tier: 2, layers } });
    h.run(0.5);
    const e = h.enemy(DUMMY);
    const b = e.buffs.find((x) => x.key === `bond:${BOND}:water`);
    assert.ok(b, `${layers} 层：站在水地形的敌人被减速`);
    assert.equal(b.mods.aspd, -pct, `${layers} 层：攻速 −${pct}`);
    assert.ok(Math.abs(b.mods.moveMul - (1 - pct / 100)) < 1e-9, `${layers} 层：移动 ×${1 - pct / 100}`);
    h.invariants();
  }
});

test('阈值 2 / 4：第 2 档（爆发降防 + 爆发期元素伤害）要 4 名成员', async () => {
  withPackData();
  /** 本包的伤害都带 `tags: [BOND]`（引擎自己那份侵蚀爆发的元素伤害不带）—— 按它分辨「谁打的」。 */
  const ours = (h) => h.hooksOf('damaged').filter((c) => c.dmg?.tags?.includes(BOND));
  // 2 名成员（count 2 / tier 1）：两条第 2 档效果都不触发
  const two = await scene([LINE[0], LINE[1]], { bond: { count: 2, active: true, tier: 1, layers: 10 } });
  two.run(1);
  const e2 = two.enemy(DUMMY);
  two.b.emit('elementBurst', { source: null, target: e2, element: 'erosion' });
  two.b.addBuff(e2, { key: 'erosionBurst', duration: 2, persist: true, allowDead: true, visible: true });
  two.run(1.5);
  assert.equal(e2.buffs.some((b) => b.key === `bond:${BOND}:sunder`), false, '2 名：没有额外降防');
  assert.equal(ours(two).some((c) => c.type === 'elemental'), false, '2 名：没有爆发期元素伤害');

  // 4 名成员（count 4 / tier 2）：两条都生效
  const four = await scene([...LINE], { bond: { count: 4, active: true, tier: 2, layers: 10 } });
  four.run(1);
  const e4 = four.enemy(DUMMY);
  four.b.emit('elementBurst', { source: null, target: e4, element: 'erosion' });
  const sunder = e4.buffs.find((b) => b.key === `bond:${BOND}:sunder`);
  assert.ok(sunder, '4 名：爆发时额外降防');
  assert.equal(sunder.mods.defFlat, -70, '−(50 + 2×10)');
  four.b.addBuff(e4, { key: 'erosionBurst', duration: 2, persist: true, allowDead: true, visible: true });
  assert.ok(four.runUntil(() => ours(four).some((c) => c.type === 'elemental'), 3), '爆发期每 0.5 s 一次元素伤害');
  four.invariants();
  two.invariants();
});

test('① 成员站在特殊水地形里攻击时附带侵蚀损伤（元素损伤 rider）', async () => {
  withPackData();
  const h = await scene([...LINE]);
  const chen = h.unit(CHEN);
  const rider = (h2) => h2.hooksOf('damaged').filter((c) => c.type === 'element' && c.dmg?.tags?.includes(BOND));
  assert.ok(h.runUntil(() => rider(h).length > 0, 6), '侵蚀损伤 rider');
  assert.ok(rider(h).some((c) => c.source === chen), '来自水地形里的成员');
  h.invariants();
});
