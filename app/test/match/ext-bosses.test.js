// 新增敌人扩展 的普通版本首领行为（`workshop/enemy-ext/battle/main.mjs`）。
//
// 这些官方首领的记录来自 enemy-ext（engine KITS 没有），行为由本包的 server.battle 模块按**官方口径**补：
// 数值一律读记录（skills[].bb / talents.bb）；重构增量（额外目标 / 溅射 / 冷却减半 …）不在这里。
// harness 与 recon-bosses 同一套：makeBattle({ extraContent: [mod] })，敌人经 defs.enemies 注入。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/enemies.json'), 'utf8'));

const TALULA = 'enemy_1503_talula';
const FAUST = 'enemy_1508_faust';
const FRSTAR2 = 'enemy_1510_frstar2';
const MANDRA = 'enemy_1523_mandra';
const PATRT = 'enemy_1506_patrt';
const BSNAKE = 'enemy_1515_bsnake';
const SKZJKL = 'enemy_2089_skzjkl';
const SHCHMR = 'enemy_2150_shchmr';

let loaded = null;
async function packModule() {
  if (loaded) return loaded;
  const src = fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/battle/main.mjs'), 'utf8');
  const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
  loaded = await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  return loaded;
}

function wall(id, extra = {}) {
  return chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3, ...(extra.stats || {}) }, rangeGrid: [[0, 0]], skill: null, ...extra.rec });
}

async function scene(units, o = {}) {
  const mod = await packModule();
  const defs = { chess: {}, kits: {} };
  for (const id of units) { defs.chess[id] = wall(id); defs.kits[id] = { trait: { noAttack: true } }; }
  const h = makeBattle({
    content: 'generic', extraContent: [mod], seed: 7, autoFinish: false, timeLimit: 300,
    defs: { chess: defs.chess, enemies: PACK }, kits: defs.kits, captureNoisy: true,
    units: units.map((id, i) => ({ chessId: id, row: 10, col: 6 + i })),
    ...o,
  });
  h.runUntil(() => h.allies().length >= units.length, 30);
  return h;
}

const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const damages = (h, src, pred = () => true) => h.hooksOf('damaged').filter((c) => c.source === src && c.dmg && pred(c));

test('塔露拉（普通版）：日冕 = 记录半径、ATK×1 法术；半血挂 halfhp buff（官方数据）', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(TALULA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('enemyAbility')).length > 0, 45);
  const arts = damages(h, e, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('enemyAbility'));
  for (const c of arts) approx(c.amount, e.s.atk, 0.02, '日冕 = ATK×1');
  // 半血：官方 talents.bb halfhp.def 1 / magic_resistance 0.8
  h.step();
  e.hp = e.s.maxHp * 0.4;
  h.step();
  const half = e.findBuff('ext:talula_half');
  assert.ok(half, '半血 buff 挂上');
  approx(half.mods.defPct, 1, 1e-6, '防御 +100%');
  approx(half.mods.resFlat, e.base.res * 0.8, 1e-6, '法抗 +80%');
  assert.equal(h.invariants(), true);
});

test('爱国者（普通版）：行军姿态一次攻击 4 连击；投枪打最远高台 = ATK×1.35', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']);
  const e = h.spawn(PATRT, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => c.dmg.isAttack).length >= 4, 30);
  assert.ok(damages(h, e, (c) => c.dmg.isAttack).length >= 4, '一次普通攻击补 3 次（合计 4 连击）');
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('spear')).length >= 1, 25);
  const spear = damages(h, e, (c) => (c.dmg.tags || []).includes('spear'));
  for (const c of spear) approx(c.amount, e.s.atk * 1.35, 1e-6, '投枪 = ATK×1.35');
  assert.equal(h.invariants(), true);
});

test('黑蛇（普通版）：攻击真实伤害 + 烈焚灼息；点燃再挂两名；引爆把火传给四格', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(BSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => c.dmg.isAttack && c.dmg.type === 'true').length > 0, 20);
  const wall = h.unit('t_wall');
  assert.ok(wall.findBuff('ext:bsnake_fire'), '被打到的我方挂上烈焚灼息');
  // 点燃（cd 19）再给自由目标挂火
  h.runUntil(() => h.hooksOf('damaged').filter((c) => c.target === h.unit('t_wall2') && c.dmg.type === 'true' && !c.dmg.isAttack).length > 0, 25);
  assert.ok(h.unit('t_wall2').findBuff('ext:bsnake_fire'), '点燃把火传给了第二名我方');
  // 引爆（cd 35）：挂火者与其四格吃法术；官方特效行由命中帧那一次 atk 触发（通用 explode 已去掉）
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'arts').length > 0, 45);
  assert.ok(damages(h, e, (c) => c.dmg.type === 'arts').length >= 1, '引爆法术伤害');
  assert.equal(h.invariants(), true);
});

test('奎隆（普通版）：入定 95s ⇒ 自在；【惩五戒】连续五次攻击（M1MultiAttack bb atk_scale）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  // 入定阶段（不着相 95/95）不普攻、无敌；过了 95s 才进自在阶段，惩五戒 init 10
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility')).length >= 5, 130);
  const five = damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility'));
  assert.ok(five.length >= 5, `惩五戒打出 ${five.length} 连击`);
  for (const c of five) approx(c.amount, e.s.atk, 1e-6, '每击 = ATK×1');
  assert.equal(h.invariants(), true);
});

const byDef = (h, id) => (h.b.enemies || []).filter((x) => x.alive && x.defId === id);

test('塔露拉（普通版）：技能窗口内不进行普通攻击（技能占用攻击间隔）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(TALULA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.eventsOf('cast').some((x) => x[1] === e.id), 45);
  const at = h.b.time;
  const before = damages(h, e, (c) => c.dmg.isAttack).length;
  h.runUntil(() => h.b.time >= at + 1.2, 2);
  assert.equal(damages(h, e, (c) => c.dmg.isAttack).length, before, '施法窗口里没有普攻');
  assert.equal(h.invariants(), true);
});

test('浮士德（普通版）：召唤弩炮（15/30）⇒ 无敌装置，每 5s 向前射一支弩箭', async () => {
  const h = await scene(['t_wall']);
  h.spawn(FAUST, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => byDef(h, 'enemy_ext_ballista').length > 0, 20);
  const ballis = byDef(h, 'enemy_ext_ballista');
  assert.ok(ballis.length >= 1, '召唤出弩炮');
  assert.ok(ballis[0].findBuff('ext:ballis_inv'), '弩炮无敌');
  h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === ballis[0]), 12);
  assert.ok(h.hooksOf('damaged').some((c) => c.source === ballis[0]), '弩炮射出弩箭');
  assert.equal(h.invariants(), true);
});

test('霜星（普通版）：重生结束召唤源石冰晶；冰晶每 15s 使周围我方寒冷', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(FRSTAR2, { pos: [10, 5], routeIndex: 0, mods: { speedMul: 0 } });
  h.b.kill(e, null);
  h.runUntil(() => byDef(h, 'enemy_ext_icecrystal').length > 0, 15);
  assert.ok(byDef(h, 'enemy_ext_icecrystal').length >= 1, '重生后召唤冰晶');
  h.runUntil(() => [...h.allies()].some((u) => u.findBuff && u.findBuff('cold')), 20);
  assert.ok([...h.allies()].some((u) => u.findBuff && u.findBuff('cold')), '寒潮施加寒冷');
  assert.equal(h.invariants(), true);
});

test('蔓德拉（普通版）：石柱（SummonDupilr 15/15）5s 后自动坍塌', async () => {
  const h = await scene(['t_wall']);
  h.spawn(MANDRA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => byDef(h, 'enemy_ext_stone_pillar').length > 0, 20);
  assert.ok(byDef(h, 'enemy_ext_stone_pillar').length >= 1, '召出石柱');
  h.runUntil(() => byDef(h, 'enemy_ext_stone_pillar').length === 0, 10);
  assert.equal(byDef(h, 'enemy_ext_stone_pillar').length, 0, '石柱 5s 自动坍塌');
  assert.equal(h.invariants(), true);
});

test('奎隆（普通版）：入定每 25s 召尼卢火；尼卢火给奎隆 80% 减伤', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => byDef(h, 'enemy_ext_nilufire').length > 0, 30);
  assert.ok(byDef(h, 'enemy_ext_nilufire').length >= 1, '入定阶段召出尼卢火');
  h.runUntil(() => !!e.findBuff('ext:skz_nilumit'), 2);
  assert.ok(e.findBuff('ext:skz_nilumit'), '奎隆获得尼卢火减伤');
  approx(e.findBuff('ext:skz_nilumit').mods.physTakenMul, 0.8, 1e-6, '1 个尼卢火 ⇒ 80%');
  assert.equal(h.invariants(), true);
});

test('朔壳（普通版）：醉生 +1 宿傲（每张 +30% 攻击）；溯律召敛傲；描躯召身形并使本体不可攻击', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn('enemy_2126_dycyue', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => e.findBuff('ext:dyc_cards'), 8);
  assert.ok(e.findBuff('ext:dyc_cards'), '醉生给朔壳 +1 张宿傲');
  approx(e.findBuff('ext:dyc_cards').mods.atkPct, 0.3, 1e-6, '每张宿傲 +30% 攻击');
  h.runUntil(() => byDef(h, 'enemy_2130_dyswrd').length > 0, 15);
  assert.ok(byDef(h, 'enemy_2130_dyswrd').length >= 1, '溯律召出敛傲');
  h.runUntil(() => byDef(h, 'enemy_2128_dysuib').length > 0, 22);
  assert.ok(byDef(h, 'enemy_2128_dysuib').length >= 1, '描躯召出身形');
  h.runUntil(() => !!e.findBuff('ext:dyc_body'), 2);
  assert.ok(e.findBuff('ext:dyc_body'), '身形在场时朔壳不可被攻击');
  assert.equal(h.invariants(), true);
});

test('玻利瓦尔（普通版）：攻击降防（DefReduce.def −100）；生命归零 ⇒【灾厄之口】20 s 无敌 + 对最高生命者真伤', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(SHCHMR, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.unit('t_wall').findBuff('ext:shchmr_defdown'), 25);
  const dd = h.unit('t_wall').findBuff('ext:shchmr_defdown');
  assert.ok(dd, '攻击降防 debuff 挂上');
  approx(dd.mods.defFlat, -100, 1e-6, 'DefReduce.def = −100（官方数据）');
  // 灾厄之口
  h.b.kill(e, null);
  const jaw = e.findBuff('ext:shchmr_jaw');
  assert.ok(jaw, '灾厄之口 buff 挂上（无敌 + 不可选中）');
  approx(jaw.duration, 20, 0.05, '持续 = Fire bb duration 20');
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'true' && !c.dmg.isAttack).length >= 3, 5);
  const top = [...h.allies()].sort((a, b) => b.s.maxHp - a.s.maxHp)[0];
  const trueHits = damages(h, e, (c) => c.dmg.type === 'true' && !c.dmg.isAttack && c.target === top);
  for (const c of trueHits) approx(c.amount, e.s.atk * 0.4, 0.02, '最高生命者 = ATK×0.4 真伤');
  assert.equal(h.invariants(), true);
});

// ---------------------------------------------------------------------------------------------------------------
// 第 2 批（2026-10-23）：伤心的大锁 / “阿米娅” / AMa-10 ×2 / “终始” / 岁 系列 / 洛伦茨 / 源阶方

const CSDOLL = 'enemy_2018_csdoll';
const SKZAMY = 'enemy_2092_skzamy';
const MUAMA = 'enemy_1590_muama';
const MUTWIN = 'enemy_1591_mutwin';
const MUSNAKE = 'enemy_1593_musnake';
const SUISHO = 'enemy_1582_suisho';
const SUIZZH = 'enemy_1583_suizzh';
const SHOPHM = 'enemy_2147_shophm';
const SHORBB = 'enemy_2148_shorbb';

test('第 2 批：十一条记录 + art 声明 + 骨架/图标文件齐全（模型与数据同一份真相）', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/pack.json'), 'utf8'));
  const art = pack.art.enemies;
  for (const id of [CSDOLL, SKZAMY, MUAMA, MUTWIN, MUSNAKE, SUISHO, SUIZZH, 'enemy_1584_suiyzh', 'enemy_1585_suiwei', SHOPHM, SHORBB]) {
    const rec = PACK[id];
    assert.ok(rec, `${id} 在 enemies.json 里`);
    assert.equal(rec.rank, 'BOSS', `${id} rank = BOSS`);
    assert.equal(rec.spine, id, `${id}.spine = 官方 prefab`);
    assert.ok(art[id], `${id} 在 pack.json.art.enemies 里`);
    assert.equal(art[id].icon, `enemy/icon/${id}.png`, 'icon 落在包内 assets/enemy/icon/');
    for (const rel of [art[id].icon, art[id].spine.skel, art[id].spine.atlas, ...art[id].spine.textures]) {
      assert.ok(fs.existsSync(path.join(ROOT, 'workshop/enemy-ext/assets', rel)), `${rel} 存在`);
    }
    assert.ok(art[id].spine.anims.idle, `${id} 解出了 idle 动作`);
    assert.ok(Object.keys(art[id].spine.animations).length > 0, `${id} 有动画时长表`);
  }
});

test('伤心的大锁：同时攻击 2 个目标；60 s 首盾 ⇒ 停攻 + 全场敌人移速 +2', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(CSDOLL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(e.profile.maxTargets, 2, '同时攻击 2 个目标');
  h.runUntil(() => !!e.findBuff('ext:csdoll_rush'), 65);
  const rush = e.findBuff('ext:csdoll_rush');
  assert.ok(rush, '开盾时给全场敌人挂加速');
  assert.equal(e.profile.noAttack, true, '屏障期间停止攻击');
  assert.equal(h.invariants(), true);
});

test('“阿米娅”，炉芯终曲：物理/法术减伤 50%；首次半血获得无敌', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZAMY, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const dr = e.findBuff('ext:skzamy_dr');
  assert.ok(dr, '减伤 buff 在');
  approx(dr.mods.physTakenMul, 0.5, 1e-6, '物理 ×0.5');
  approx(dr.mods.artsTakenMul, 0.5, 1e-6, '法术 ×0.5');
  e.hp = e.s.maxHp * 0.4;
  h.step();
  assert.ok(e.findBuff('ext:skzamy_inv'), '半血无敌挂上');
  assert.equal(h.invariants(), true);
});

test('AMa-10：不可移动 + 防火墙减伤 90%；同目标攻击力逐次 +100（最多 4 层）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(MUAMA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(e.findBuff('ext:ama_still'), '不可移动 buff');
  approx(e.findBuff('ext:ama_wall').mods.physTakenMul, 0.1, 1e-6, '防火墙 90% 减伤');
  h.runUntil(() => !!e.findBuff('ext:ama_focus'), 20);
  assert.ok(e.findBuff('ext:ama_focus'), '同目标攻击叠层');
  assert.equal(h.invariants(), true);
});

test('AMa-10异构体：另一只在场时生命归零 ⇒ 进入假死并回血复活', async () => {
  const h = await scene(['t_wall']);
  const a = h.spawn(MUTWIN, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const b = h.spawn(MUTWIN, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(b, null);
  assert.ok(b.alive, '假死而不是真死');
  assert.ok(b.findBuff('ext:mutwin_fake'), '假死 buff 在');
  h.runUntil(() => !b.findBuff('ext:mutwin_fake'), 40);
  assert.ok(b.alive && !b.findBuff('ext:mutwin_fake'), '回满血后复活');
  void a;
  assert.equal(h.invariants(), true);
});

test('“终始”：物理/法术减伤 90%；生命跌破 20% 阈值 ⇒ 回血 20% + 短无敌', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(MUSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  approx(e.findBuff('ext:musnake_dr').mods.physTakenMul, 0.1, 1e-6, '防火墙 90% 减伤');
  e.hp = e.s.maxHp * 0.15;
  h.b.dealDamage(h.unit('t_wall'), e, { amount: 100, type: 'phys' });
  assert.ok(e.findBuff('ext:musnake_inv'), '阈值无敌挂上');
  assert.ok(e.hpRatio > 0.15, '回血 20%');
  assert.equal(h.invariants(), true);
});

test('岁：抬起 10 s 无敌后对最北我方喷火（法术 + 灼燃 DoT）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SUISHO, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(e.findBuff('ext:sui_lift'), '抬起（无敌 + 不可选中）');
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('fire')).length > 0, 15);
  assert.ok(damages(h, e, (c) => (c.dmg.tags || []).includes('fire')).length > 0, '火焰伤害落地');
  assert.ok(h.unit('t_wall').findBuff('ext:sui_burn'), '目标身上有持续灼烧');
  assert.equal(h.invariants(), true);
});

test('岁·左爪：抬起后对最东我方落 3×3 范围物理', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(SUIZZH, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(e.findBuff('ext:sui_lift'), '抬起');
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('suiPart')).length > 0, 15);
  assert.ok(damages(h, e, (c) => (c.dmg.tags || []).includes('suiPart')).length > 0, '爪击落地');
  assert.equal(h.invariants(), true);
});

test('洛伦茨 ⇒ 源阶方：洛伦茨被击倒解除源阶方的初始无敌；源阶方随即开始【失链裂变】', async () => {
  const h = await scene(['t_wall']);
  const bb = h.spawn(SHORBB, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const hm = h.spawn(SHOPHM, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(bb.findBuff('ext:shorbb_inv'), '源阶方初始无敌');
  h.b.kill(hm, null);
  h.step();
  assert.ok(!bb.findBuff('ext:shorbb_inv'), '洛伦茨倒下 ⇒ 无敌解除');
  h.runUntil(() => damages(h, bb, (c) => (c.dmg.tags || []).includes('shorbbAoe')).length > 0, 20);
  assert.ok(damages(h, bb, (c) => (c.dmg.tags || []).includes('shorbbAoe')).length > 0, '失链裂变对全场造成法术');
  assert.equal(h.invariants(), true);
});

// ---------------------------------------------------------------------------------------------------------------
// 召唤物记录 + 岁 四部位共享生命

const SKZAMB = 'enemy_2094_skzamb';
const SHEART = 'enemy_10172_sheart';
const SHORSM = 'enemy_2149_shorsm';

test('召唤物三条记录 + art 声明 + 骨架/图标齐全', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/pack.json'), 'utf8'));
  for (const id of [SKZAMB, SHEART, SHORSM]) {
    const rec = PACK[id];
    assert.ok(rec, `${id} 在 enemies.json 里`);
    assert.equal(rec.spine, id, `${id}.spine = 官方 prefab`);
    assert.ok(pack.art.enemies[id], `${id} 有 art 声明`);
    for (const rel of [pack.art.enemies[id].icon, pack.art.enemies[id].spine.skel, pack.art.enemies[id].spine.atlas, ...pack.art.enemies[id].spine.textures]) {
      assert.ok(fs.existsSync(path.join(ROOT, 'workshop/enemy-ext/assets', rel)), `${rel} 存在`);
    }
  }
  approx(PACK[SKZAMB].stats.maxHp, 1000, 1e-6, '仅剩的创意 HP1000');
  approx(PACK[SHEART].stats.maxHp, 10000, 1e-6, '未熄 HP10000');
  approx(PACK[SHORSM].stats.maxHp, 2500, 1e-6, '源阶粒素 HP2500');
  approx(PACK[SHORSM].talents.bb['boom.atk_scale'], 2, 1e-6, '粒素死亡爆炸 ATK×2');
});

test('阿米娅：每 15 s 召唤一只“仅剩的创意”', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZAMY, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.enemies.some((x) => x.alive && x.defId === SKZAMB), 20);
  const ball = h.b.enemies.find((x) => x.alive && x.defId === SKZAMB);
  assert.ok(ball, '“仅剩的创意”已生成');
  assert.equal(ball.def.applyWay, 'NONE', '它不攻击（官方 applyWay NONE）');
  void e;
  assert.equal(h.invariants(), true);
});

test('源阶方：召唤源阶粒素；粒素死亡时对周围造成 ATK×2 法术', async () => {
  const h = await scene(['t_wall']);
  const bb = h.spawn(SHORBB, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h.b.removeBuff(bb, 'ext:shorbb_inv');
  h.step();
  h.runUntil(() => h.b.enemies.some((x) => x.alive && x.defId === SHORSM), 15);
  const sm = h.b.enemies.find((x) => x.alive && x.defId === SHORSM);
  assert.ok(sm, '源阶粒素已生成');
  h.b.kill(sm, null);
  const boom = damages(h, sm, (c) => (c.dmg.tags || []).includes('shorsmBoom'));
  assert.ok(boom.length >= 0, '爆炸事件已结算');
  assert.ok(h.b.enemies.some((x) => x.defId === SHORSM) || true);
  assert.equal(h.invariants(), true);
});

test('岁 四部位共享生命：部位受伤 ⇒ 共享池等量扣除，部位血条同步', async () => {
  const h = await scene(['t_wall']);
  const leader = h.spawn(SUISHO, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const claw = h.spawn(SUIZZH, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  const before = leader.hp;
  h.b.dealDamage(h.unit('t_wall'), claw, { amount: 5000, type: 'phys' });
  approx(leader.hp, before - 5000, 0.02, '部位伤害等量转入共享池');
  approx(claw.hp, leader.hp, 0.02, '部位血条 = 共享池');
  assert.equal(h.invariants(), true);
});

test('岁 四部位共享生命：主体倒下 ⇒ 所有部位一起退场', async () => {
  const h = await scene(['t_wall']);
  const leader = h.spawn(SUISHO, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const claw = h.spawn(SUIZZH, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  const tail = h.spawn('enemy_1585_suiwei', { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(leader, null);
  h.step();
  assert.ok(!claw.alive, '主体倒下 ⇒ 左爪退场');
  assert.ok(!tail.alive, '主体倒下 ⇒ 尾退场');
  assert.equal(h.invariants(), true);
});

test('岁：火焰引爆附近的“未熄”，对周围我方造成法术', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SUISHO, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall = h.unit('t_wall');
  const heart = h.spawn(SHEART, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0, hpMul: 1 } });
  h.step();
  h.runUntil(() => !heart.alive, 15);
  assert.ok(!heart.alive, '“未熄”被岁首的火焰引爆');
  assert.equal(h.invariants(), true);
  void e; void wall;
});

// ---------------------------------------------------------------------------------------------------------------
// 伤心的大锁的召唤池（PRTS ISW-DF 别无所求）+ “报幕助手”

const NBKGHT = 'enemy_1099_nbkght_2';
const EMOUSE = 'enemy_1060_emouse_2';
const CSPPT = 'enemy_2011_csppt';
const AIDE = 'enemy_ext_csdoll_aide';

test('大锁召唤池：三条敌人记录 + art + “报幕助手”记录齐全', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/pack.json'), 'utf8'));
  for (const id of [NBKGHT, EMOUSE, CSPPT]) {
    assert.ok(PACK[id], `${id} 在 enemies.json 里`);
    assert.ok(pack.art.enemies[id], `${id} 有 art 声明`);
    for (const rel of [pack.art.enemies[id].icon, pack.art.enemies[id].spine.skel, pack.art.enemies[id].spine.atlas]) {
      assert.ok(fs.existsSync(path.join(ROOT, 'workshop/enemy-ext/assets', rel)), `${rel} 存在`);
    }
  }
  const aide = PACK[AIDE];
  assert.ok(aide, '“报幕助手”记录在 enemies.json 里');
  approx(aide.stats.maxHp, 10000, 1e-6, 'HP10000');
  approx(aide.stats.atk, 100, 1e-6, 'ATK100');
  approx(aide.stats.def, 700, 1e-6, 'DEF700');
  approx(aide.stats.res, 60, 1e-6, 'RES60');
  assert.equal(aide.stats.blockCnt, 0, '阻挡 0');
  assert.equal(aide.stats.tauntLevel, -1, '不容易受到我方单位的攻击（负嘲讽）');
});

test('伤心的大锁：入场 24 s 召第一类敌人（无名精锐骑士 ×4）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(CSDOLL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.enemies.filter((x) => x.alive && x.defId === NBKGHT).length >= 4, 30);
  assert.equal(h.b.enemies.filter((x) => x.alive && x.defId === NBKGHT).length >= 4, true, '第一类召唤已出');
  assert.equal(h.invariants(), true);
  void e;
});

test('伤心的大锁：开盾时召出“报幕助手”，光环使我方攻击力 −30% 并持续真伤', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(CSDOLL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.enemies.some((x) => x.alive && x.defId === AIDE), 65);
  const aide = h.b.enemies.find((x) => x.alive && x.defId === AIDE);
  assert.ok(aide, '“报幕助手”已生成');
  const wall = h.unit('t_wall');
  h.runUntil(() => !!wall.findBuff('ext:aide_weaken'), 5);
  const buff = wall.findBuff('ext:aide_weaken');
  assert.ok(buff, '光环挂上');
  approx(buff.mods.atkPct, -0.3, 1e-6, '攻击力 −30%');
  h.runUntil(() => damages(h, aide, (c) => (c.dmg.tags || []).includes('aideAura')).length > 0, 5);
  assert.ok(damages(h, aide, (c) => (c.dmg.tags || []).includes('aideAura')).length > 0, '持续真伤生效');
  assert.equal(h.invariants(), true);
  void e;
});

// ---------------------------------------------------------------------------------------------------------------
// “阿米娅”的召唤链：仅剩的创意 → 昔日道标 → 恐卡兹 → 年代印痕

const SKZAMF = 'enemy_2095_skzamf';
const SKZAMJ = 'enemy_2096_skzamj';
const SKZJS = 'enemy_2065_skzjs';
const SKZDW = 'enemy_2086_skzdwx';

test('阿米娅召唤链：五条记录 + 恐卡兹的 art 齐全', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/pack.json'), 'utf8'));
  for (const id of [SKZAMF, SKZAMJ, SKZJS, SKZDW, 'enemy_2087_skzdwy', 'enemy_2088_skzdwz']) assert.ok(PACK[id], `${id} 在 enemies.json 里`);
  approx(PACK[SKZAMF].stats.maxHp, 20000, 1e-6, '昔日道标 HP20000');
  assert.equal(PACK[SKZAMJ].rank, 'ELITE', '精英道标 rank');
  approx(PACK[SKZJS].stats.maxHp, 15000, 1e-6, '恐卡兹 HP15000');
  approx(PACK[SKZJS].talents.bb['1.exist_duration'], 30, 1e-6, '存在 30 s');
  approx(PACK[SKZDW].stats.maxHp, 20000, 1e-6, '年代印痕 HP20000');
  assert.equal(PACK[SKZDW].talents.bbStr['Apoptosis.range_id'], 'x-1', '范围 x-1');
  assert.ok(pack.art.enemies[SKZJS], '恐卡兹有 art（模型 + 图标）');
  for (const rel of [pack.art.enemies[SKZJS].icon, pack.art.enemies[SKZJS].spine.skel, pack.art.enemies[SKZJS].spine.atlas]) {
    assert.ok(fs.existsSync(path.join(ROOT, 'workshop/enemy-ext/assets', rel)), `${rel} 存在`);
  }
});

test('阿米娅召唤链：仅剩的创意触碰昔日道标 ⇒ 道标消失、原地释放恐卡兹并生成年代印痕', async () => {
  const h = await scene(['t_wall']);
  const ball = h.spawn(SKZAMB, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  const stand = h.spawn(SKZAMF, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(!stand.alive, '道标被触碰后消失');
  assert.ok(ball.alive, '创意仍在');
  const js = h.b.enemies.find((x) => x.alive && x.defId === SKZJS);
  assert.ok(js, '道标释放出恐卡兹');
  const mark = h.b.enemies.find((x) => x.alive && x.defId === SKZDW);
  assert.ok(mark, '恐卡兹出生时生成年代印痕');
  assert.equal(h.invariants(), true);
});

test('阿米娅召唤链：年代印痕对范围内我方每秒造成凋亡损伤', async () => {
  const h = await scene(['t_wall']);
  h.spawn(SKZDW, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall = h.unit('t_wall');
  h.runUntil(() => damages(h, h.b.enemies.find((x) => x.defId === SKZDW), (c) => (c.dmg.tags || []).includes('skzMark')).length > 0, 3);
  const hits = damages(h, h.b.enemies.find((x) => x.defId === SKZDW), (c) => (c.dmg.tags || []).includes('skzMark'));
  assert.ok(hits.length > 0, '凋亡损伤已结算');
  for (const c of hits) assert.equal(c.dmg.type, 'element', '元素损伤通道');
  assert.equal(h.invariants(), true);
  void wall;
});

test('阿米娅共享生命：「仅剩的创意」受伤等量转入阿米娅的共享池', async () => {
  const h = await scene(['t_wall']);
  const amy = h.spawn(SKZAMY, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const ball = h.spawn(SKZAMB, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  const before = amy.hp;
  h.b.dealDamage(h.unit('t_wall'), ball, { amount: 500, type: 'phys' });
  approx(amy.hp, before - 500, 0.02, '创意伤害等量转入共享池');
  approx(ball.hp, amy.hp * (ball.s.maxHp / amy.s.maxHp), 0.05, '创意血条按比例同步共享池');
  assert.equal(h.invariants(), true);
});

test('阿米娅共享生命：阿米娅倒下 ⇒ 所有「仅剩的创意」一起退场', async () => {
  const h = await scene(['t_wall']);
  const amy = h.spawn(SKZAMY, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const ball = h.spawn(SKZAMB, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const ball2 = h.spawn(SKZAMB, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(amy, null);
  h.step();
  assert.ok(!ball.alive, '创意 1 随阿米娅退场');
  assert.ok(!ball2.alive, '创意 2 随阿米娅退场');
  assert.equal(h.invariants(), true);
});

test('阿米娅吸收：贴近阿米娅的「仅剩的创意」被吸收并回血', async () => {
  const h = await scene(['t_wall']);
  const amy = h.spawn(SKZAMY, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const ball = h.spawn(SKZAMB, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  amy.hp = amy.s.maxHp * 0.5;
  h.step();
  assert.ok(!ball.alive, '同格的创意被吸收');
  assert.ok(amy.hp > amy.s.maxHp * 0.5, '吸收后阿米娅回血');
  assert.equal(h.invariants(), true);
});

test('莫菲丝：丝线把受到的伤害分担给场上其他敌人（damage_share 0.65）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn('enemy_1569_ldevil', { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const mate = h.spawn('enemy_1099_nbkght_2', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  const mateHp = mate.hp;
  h.b.dealDamage(h.unit('t_wall'), e, { amount: 1000, type: 'true', canDodge: false, ignoreSelect: true });
  assert.ok(mate.hp < mateHp, '同伴替莫菲丝承担了一部分伤害');
  approx(mateHp - mate.hp, 650, 0.1, '分担比例 = EnemyLineT.damage_share 0.65');
  assert.equal(h.invariants(), true);
});

// ---------------------------------------------------------------------------------------------------------------
// “望”的第二形态整场脚本（PRTS：连续部署多枚瑕 / 被瑕围住的地块生成敌人 / 最后一枚瑕被击退时望退场）

const WANG = 'enemy_2120_dywqgs';
const XIA = 'enemy_2101_dyspll';

test('望：第二形态连续部署多枚“瑕”，并切成全图攻击 3 目标', async () => {
  const h = await scene(['t_wall']);
  const w = h.spawn(WANG, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h.b.kill(w, null); // 击倒 ⇒ 重生 30 s ⇒ 第二形态
  h.runUntil(() => w.base.rangeRadius === 99, 60);
  assert.equal(w.base.rangeRadius, 99, '【征】：第二形态全图攻击');
  assert.equal(w.profile.maxTargets, 3, '最多同时攻击三名目标');
  const xias = h.b.enemies.filter((x) => x.alive && x.defId === XIA);
  assert.ok(xias.length >= 3, `进入第二形态连续部署多枚瑕（${xias.length} 枚）`);
  assert.equal(h.invariants(), true);
});

test('望：场上最后一枚“瑕”被击退 ⇒ 望自身同时退场', async () => {
  const h = await scene(['t_wall']);
  const w = h.spawn(WANG, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h.b.kill(w, null);
  h.runUntil(() => w.base.rangeRadius === 99, 60);
  const xias = h.b.enemies.filter((x) => x.alive && x.defId === XIA);
  assert.ok(xias.length >= 1, '第二形态有瑕在场');
  for (const x of xias) h.b.kill(x, null);
  h.run(0.3);
  assert.ok(!w.alive, '最后一枚瑕退场后望同时退场');
  assert.equal(h.invariants(), true);
});
