// 重构模拟的战斗侧载荷（`workshop/mode-recon/battle/main.mjs`）在真 sim 上的四条规则（机制轮）。
//
// 这个包模块 import 了 `@battle/mod.js` —— 那是个两端共用的白名单前缀（浏览器靠 index.html 的 import map、
// 服务端靠装载器把它改写成真实 `file:` URL），裸 Node 解析不了。所以这里照 `server/battlePack.js` 的同一条路走：
// 读出源码 → `rewriteKitImports` 把白名单说明符换掉 → 以 `data:` 模块 import（装载器就是用 data: 装的），再把它
// 的 `install` 通过 `makeBattle({ battleInstallers: [install] })`（DESIGN §28.17 的测试口）交给战场。
//
// 选择怎么到战场：`PlayerState.battleInput()` 把 `battle !== false` 的效果按 `playerEffects` 交给 BattleSpec，
// 所以这里直接在 `players[].playerEffects` 里放一条 `key === 'effect:recon_protocol'` 的 ref（物化那份在
// meta/main.mjs，两处同一个字符串）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import { itemStatMods } from '../../server/sim/content/items/battle.js';
import { DataSource, getDefaultSource } from '../../server/sim/simdata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EFFECT_KEY = 'effect:recon_protocol';
const SLIME = 'enemy_1000_gopro_2'; // 猎狗pro：maxHp 1700 / atk 260 / res 20（data/enemies.json）
/** 原始 `data/items.json`（`itemStatMods` 吃的就是这种记录）。 */
const ITEMS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));

/** 一条选择 ref（`params` 就是 meta/main.mjs 物化出来的那一份）。 */
const ref = (params) => [{ id: 'recon_protocol', key: EFFECT_KEY, battle: true, params }];

let loaded = null;
/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块）。 */
async function packModule() {
  if (loaded) return loaded;
  const src = fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/battle/main.mjs'), 'utf8');
  const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
  loaded = await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  return loaded;
}

/** 一个炮台（t_o，属性是断言用的那几个数）+ 一个肉盾；`extra` 覆盖炮台的字段。 */
function arena(o = {}) {
  const { params = null, items = [], bonds = {}, run = 6, ...rest } = o;
  const defs = {
    chess: {
      t_o: chessRec({
        id: 't_o', tier: 1, profession: 'SNIPER', projectile: 'none', rangeGrid: [[0, 0]], skill: null,
        stats: { atk: 100, def: 50, maxHp: 1000, res: 0, bat: 1, blockCnt: 0 },
      }),
      t_b: chessRec({
        id: 't_b', tier: 1, profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: null,
        stats: { atk: 0, def: 0, maxHp: 1e7, bat: 1, blockCnt: 3 },
      }),
    },
  };
  return { ...makeBattle({
    content: 'full', seed: 11, autoFinish: false, timeLimit: 60,
    defs, bonds,
    units: [{ chessId: 't_o', row: 10, col: 4, items }, { chessId: 't_b', row: 10, col: 5 }],
    playerEffects: params ? ref(params) : [],
    ...rest,
  }), run, defs };
}

/** 建场 → 把包的战斗载荷当 `extraContent` 交给战场（`sim/content/index.js installContent` 会调它的 `install`）→ 跑到部署完成。 */
async function deployed(o = {}) {
  const mod = await packModule();
  const h = arena({ ...o, extraContent: [mod] });
  h.runUntil(() => h.allies().length >= 2, 30);
  return h;
}

test('装上这个包之前：同样的场地上没有任何 recon: 前缀的 buff（对照）', async () => {
  const h = arena({ params: { assist: 'recon_assist_data' } });
  h.runUntil(() => h.allies().length >= 2, 30);
  for (const u of h.allies()) assert.equal(u.findBuff('recon:assist_data'), null, `${u.defId} 不该有战斗侧 buff（没装 installer）`);
});

test('数据重构：我方基础攻/防/生命上限 +25%、法术抗性 +25', async () => {
  const h = await deployed({ params: { assist: 'recon_assist_data' } });
  const u = h.unit('t_o');
  assert.ok(u && u.deployed, '炮台已部署');
  assert.ok(Math.abs(u.atk - 125) < 1e-6, `atk 100 → ${u.atk}（期望 125）`);
  assert.ok(Math.abs(u.s.def - 62.5) < 1e-6, `def 50 → ${u.s.def}（期望 62.5）`);
  assert.ok(Math.abs(u.maxHp - 1250) < 1e-6, `maxHp 1000 → ${u.maxHp}（期望 1250）`);
  assert.ok(Math.abs(u.s.res - 25) < 1e-6, `res 0 → ${u.s.res}（期望 25）`);
  assert.ok(h.unit('t_b').findBuff('recon:assist_data'), '同一个玩家名下的每个干员都吃到（部署时挂）');
});

test('数据负载 / 盟约负载：敌人的基础攻防血 +25%、法抗 +25；盟约每层再抬 0.1% 生命上限', async () => {
  const control = arena();
  control.runUntil(() => control.allies().length >= 2, 30);
  const base = control.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(base && base.maxHp > 0, '对照局里刷出了敌人');

  // 业主 2026-10-30：交上去的是「被排除的那一条」—— 排除盟约负载 ⇒ 数据负载生效
  const data = await deployed({ params: { load: 'recon_load_bond' } });
  const loaded = data.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(base.findBuff('recon:load'), null, '对照局的敌人身上没有这条负载');
  // 挂上去的那条 buff 就是规则本身（数值 → mods 的映射由引擎的公式负责，下面两条按实际读数再验一次）
  assert.deepEqual(loaded.findBuff('recon:load').mods, { atkPct: 0.25, defPct: 0.25, resFlat: 25, hpPct: 0.25 });
  assert.ok(Math.abs(loaded.maxHp / base.maxHp - 1.25) < 0.02, `数据负载：生命上限 ×${loaded.maxHp / base.maxHp}（期望 1.25）`);
  assert.ok(Math.abs(loaded.atk / base.atk - 1.25) < 0.02, `数据负载：攻击力 ×${loaded.atk / base.atk}`);

  // 盟约负载：三类里最高层的那几条盟约，每层 0.1% → 100 层 = ×1.1（排除数据负载 ⇒ 盟约负载生效）
  const bond = await deployed({ params: { load: 'recon_load_data' }, bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 100 } } });
  const blown = bond.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(blown.findBuff('recon:load').mods.hpPct, 0.1, '100 层 × 每层 0.1%');
  assert.ok(Math.abs(blown.maxHp / base.maxHp - 1.1) < 0.02, `盟约负载 100 层：生命上限 ×${blown.maxHp / base.maxHp}（期望 1.1）`);

  // 三类各取「已激活且层数最高」的那一条，**求和**；未激活的同类不计数
  const both = await deployed({ params: { load: 'recon_load_data' }, bonds: {
    yanShip: { count: 3, active: true, tier: 1, layers: 100 },     // 核心
    swiftShip: { count: 2, active: true, tier: 1, layers: 50 },    // 附加
    preciShip: { count: 3, active: false, tier: 1, layers: 999 },  // 未激活 ⇒ 不计数
  } });
  const blownBoth = both.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(blownBoth.findBuff('recon:load').mods.hpPct, 0.15, '(100 + 50) 层 × 每层 0.1%；未激活的 999 层不计');
  assert.ok(Math.abs(blownBoth.maxHp / base.maxHp - 1.15) < 0.02, `核心 + 附加：生命上限 ×${blownBoth.maxHp / base.maxHp}（期望 1.15）`);
});

// 业主 2026-10-30：熔芯负载三选一 = 选一项**排除**，另外两项同时生效（从前是单选一条生效）
test('熔芯负载：排除装备负载 ⇒ 敌人的数据负载 + 盟约负载同时生效，我方不再 -25%', async () => {
  const control = arena();
  control.runUntil(() => control.allies().length >= 2, 30);
  const base = control.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });

  const h = await deployed({ params: { load: 'recon_load_equip' }, bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 100 } } });
  const e = h.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  // 数据负载 25% + 盟约负载 100 层 × 0.1% = 生命上限 +35%；攻防照数据负载 -25% 的读数
  assert.deepEqual(e.findBuff('recon:load').mods, { atkPct: 0.25, defPct: 0.25, resFlat: 25, hpPct: 0.35 });
  assert.ok(Math.abs(e.maxHp / base.maxHp - 1.35) < 0.02, `生命上限 ×${e.maxHp / base.maxHp}（期望 1.35）`);
  assert.equal(h.unit('t_b').findBuff('recon:load_bare'), null, '装备负载被排除：不带装备的干员不再 -25%');
});

test('熔芯负载：不指定（没有 load）⇒ 三条都不生效', async () => {
  const control = arena();
  control.runUntil(() => control.allies().length >= 2, 30);
  const base = control.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });

  const h = await deployed({ params: { assist: 'recon_assist_data' }, bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 100 } } });
  const e = h.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(e.findBuff('recon:load'), null, '敌人身上没有任何负载');
  assert.ok(Math.abs(e.maxHp / base.maxHp - 1) < 0.02, `生命上限不变（×${e.maxHp / base.maxHp}）`);
});

test('装备负载：未携带装备的干员伤害 -25%；装备阶级高于携带者的那件装备效果 -50%', async () => {
  // 业主 2026-10-30：交上去的是「被排除的那一条」—— 排除数据负载 ⇒ 装备负载生效（敌人不吃数据负载，读数与对照局同底）
  const h = await deployed({ params: { load: 'recon_load_data' } });
  const bare = h.unit('t_b');
  const bareBuff = bare.findBuff('recon:load_bare');
  assert.ok(bareBuff, '没带装备的干员挂上了伤害 -25% 的那条');
  assert.equal(bareBuff.mods.dmgDealtMul, 0.75);

  // 阶级 2 的装备装在 tier 1 的干员身上 → 这件装备的全部数值效果减半（引擎缩放通道重装，不再挂补偿 buff）
  const g = await deployed({ params: { load: 'recon_load_data' }, items: ['chess_item_2_03_e_a'] });
  const gear = g.unit('t_o');
  const full = itemStatMods(ITEMS['chess_item_2_03_e_a']);
  assert.deepEqual(full, { atkPct: 0.2 }, '引擎给出的这件装备的属性贡献');
  // 100 × (1 + 0.2 × 0.5) = 110（未缩放时是 120）
  assert.ok(Math.abs(gear.atk - 110) < 1e-6, `atk 100 → ${gear.atk}（期望 110，效果减半）`);
  assert.equal(gear.findBuff('recon:load_bare'), null, '带装备的干员不享受 -25%（两种情形互斥）');
});

test('装备阶级不高于携带者时不缩放（阶级 1 的装备装在 tier 1 的干员身上）', async () => {
  const g = await deployed({ params: { load: 'recon_load_data' }, items: ['chess_item_1_01_e_a'] });
  const gear = g.unit('t_o');
  assert.ok(Math.abs(gear.atk - 115) < 1e-6, `atk 100 → ${gear.atk}（期望 115，维式重锤 +15% 未缩放）`);
});

test('装备效果缩放覆盖**触发类**：精准狙击镜的 damage_scale 也减半；系数恢复 1 后全额', async () => {
  const { setItemEffectScale } = await import('../../server/sim/content/items/battle.js');
  // 对照局：同一件装备、没交选择 ⇒ 不缩放，狙击镜按 1.3 倍结算
  const base = await deployed({ items: ['chess_item_3_02_e_a'] });
  const u0 = base.unit('t_o');
  const e0 = base.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  const hp0 = e0.hp;
  base.b.dealDamage(u0, e0, { amount: 1000, type: 'true' });
  const full = (hp0 - e0.hp) / (u0.s.dmgDealtMul || 1);
  assert.ok(Math.abs(full - 1300) < 1e-6, `1.3 倍：${full}`);

  // 装备负载（装备阶级 3 > 携带者 1）⇒ 缩放通道把触发类参数一起减半：1.3 → 0.65
  const half = await deployed({ params: { load: 'recon_load_data' }, items: ['chess_item_3_02_e_a'] });
  const u1 = half.unit('t_o');
  const e1 = half.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  const hp1 = e1.hp;
  half.b.dealDamage(u1, e1, { amount: 1000, type: 'true' });
  const halved = (hp1 - e1.hp) / (u1.s.dmgDealtMul || 1);
  assert.ok(Math.abs(halved - 650) < 1e-6, `0.65 倍：${halved}`);

  // 恢复系数 1 → 下一次重装回到全额（同一件装备）
  assert.equal(setItemEffectScale(half.b, u1, 'chess_item_3_02_e', 1), true, '系数真的变了');
  const e2 = half.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  const hp2 = e2.hp;
  half.b.dealDamage(u1, e2, { amount: 1000, type: 'true' });
  const restored = (hp2 - e2.hp) / (u1.s.dmgDealtMul || 1);
  assert.ok(Math.abs(restored - 1300) < 1e-6, `恢复全额：${restored}`);
});

test('没交过选择 / 别的模式：一条 buff 都不挂（playerEffects 里没有那条 ref）', async () => {
  const h = await deployed({});
  const u = h.unit('t_o');
  assert.equal(u.findBuff('recon:assist_data'), null);
  assert.equal(u.findBuff('recon:load_bare'), null);
  const e = h.spawn(SLIME, { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(e.findBuff('recon:load'), null);
  assert.equal(h.invariants(), true, '整场的不变式仍然成立');
});

// ---------------------------------------------------------------------------------------------------------------
// 【重构】盟约（`bond_recon`）4 人档（业主 2026-10-30）：在场 ≥4 名（阈值 [2,4] ⇒ tier 2）时成员的生命上限与
// 基础攻击力 +50%。数值走包里 `bonds.json` 的 `bb.recon_stat_pct`，与预重构的两条选择无关（没交选择也生效）。

test('【重构】盟约 4 人档：≥4 名成员的攻击力与生命上限 ×1.5；2 人档不加；没装包不加', async () => {
  const mod = await packModule();
  const BOND = 'bond_recon';
  const rec = { bondId: BOND, name: '重构', thresholds: [2, 4], activeCount: 2, bb: { recon_trait_extra: 1, recon_stat_pct: 0.5 } };
  const mk = (state, install) => {
    const ids = Array.from({ length: 4 }, (_, i) => `rb${i}_a`);
    const chess = {};
    for (const id of ids) {
      chess[id] = chessRec({
        id, bonds: [BOND], profession: 'WARRIOR', rangeGrid: [[0, 0], [0, 1]], skill: null,
        stats: { atk: 1000, def: 0, maxHp: 5000, res: 0, bat: 1, blockCnt: 1 },
      });
    }
    const data = new DataSource({ chess, bonds: { [BOND]: rec } }, getDefaultSource());
    const h = makeBattle({
      data, content: 'full', seed: 5, autoFinish: false, timeLimit: 60,
      units: ids.map((chessId, i) => ({ chessId, row: 10, col: 3 + i })),
      bonds: { [BOND]: state },
      ...(install ? { extraContent: [mod] } : {}),
    });
    h.runUntil(() => h.allies().length >= 4, 30);
    return h;
  };
  const four = mk({ count: 4, active: true, tier: 2, layers: 0 }, true);
  const u = four.unit('rb0_a');
  assert.ok(Math.abs(u.atk - 1500) < 1e-6, `atk 1000 → ${u.atk}（期望 1500）`);
  assert.ok(Math.abs(u.maxHp - 7500) < 1e-6, `maxHp 5000 → ${u.maxHp}（期望 7500）`);
  assert.ok(u.findBuff('bond:recon:stat'), '加成挂成一条盟约 buff');

  const two = mk({ count: 2, active: true, tier: 1, layers: 0 }, true);
  assert.equal(Math.round(two.unit('rb0_a').atk), 1000, '2 人档不加攻');
  assert.equal(two.unit('rb0_a').maxHp, 5000, '2 人档不加生命上限');
  assert.equal(two.unit('rb0_a').findBuff('bond:recon:stat'), null);

  const control = mk({ count: 4, active: true, tier: 2, layers: 0 }, false);
  assert.equal(Math.round(control.unit('rb0_a').atk), 1000, '没装包的对照组');
});
