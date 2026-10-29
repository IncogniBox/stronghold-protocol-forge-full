// 重构模拟 · Boss 机制修复的**行为回归**（《重构模拟-Boss机制修复与自查交接.md》§5.1 / §5.2 / §5.4 / §5.6 / §5.7 /
// §5.8 / §5.9 / §5.10 / §5.11 / §5.12）。
//
// 每一条都钉住一个「修前会失败」的判据（断言**最终属性 / 实际行为**，不是 buff 内部字段），与 `recon-bosses.test.js`
// 同一条装载路径（`rewriteKitImports` → data: 模块；记录一律经 `defs.enemies` 注入）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { ReconChannel, ChannelBossPool } from '../../server/match/match/reconChannel.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';
import { MatchBoss } from '../../server/match/match/bossRounds.js';
import { battleSourceIssues } from '../../server/battlePack.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/enemies.json'), 'utf8'));

const BSNAKE = 'enemy_ws_recon_bsnake';
const SYSKAD = 'enemy_ws_recon_syskad';
const SHCHMR = 'enemy_ws_recon_shchmr';
const SKZJKL = 'enemy_ws_recon_skzjkl';
const PATRT = 'enemy_ws_recon_patrt';
const MUAMA = 'enemy_ws_recon_muama';
const CSDOLL = 'enemy_ws_recon_csdoll';
const CQBW = 'enemy_ws_recon_cqbw';
const DEKGHT = 'enemy_ws_recon_dekght';
const DEKGHT_2 = 'enemy_ws_recon_dekght_2';

let loaded = null;
async function packModule() {
  if (loaded) return loaded;
  const src = fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/battle/main.mjs'), 'utf8');
  const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
  loaded = await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  return loaded;
}

function wall(id, extra = {}) {
  return chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3, ...(extra.stats || {}) }, rangeGrid: [[0, 0]], skill: null, ...extra.rec });
}
const NOATK = () => ({ trait: { noAttack: true } });

async function scene(units, o = {}) {
  const mod = await packModule();
  const defs = { chess: {}, kits: {} };
  for (const id of units) { defs.chess[id] = wall(id); defs.kits[id] = NOATK; }
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod, mod], seed: 7, autoFinish: false, timeLimit: 300,
    defs: { chess: defs.chess, enemies: PACK }, kits: defs.kits, captureNoisy: true,
    units: units.map((id, i) => ({ chessId: id, row: 10, col: 6 + i })),
    ...o,
  });
  h.runUntil(() => h.allies().length >= units.length, 30); // 部署完成
  return h;
}
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const damages = (h, src, pred = () => true) => h.hooksOf('damaged').filter((c) => c.source === src && c.dmg && pred(c));

// ===============================================================================================================
// §5.1 `hpMul` 语义：它是**乘数**键，「+50%」必须走 `hpPct`

test('§5.1 伊莎玛拉变身：生命 ×75%（不是 1 血）、攻击 ×80%、防御 ×50%、法抗 ×70%、攻速 ×2', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SYSKAD, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const ok = h.runUntil(() => e.findBuff('recon:syskad_form2'), 90);
  assert.ok(ok, '技力充满后进入变身形态');
  approx(e.s.maxHp, e.base.maxHp * 0.75, 1e-6, '生命上限 = 基础 ×0.75');
  assert.ok(e.s.maxHp > 1, `生命上限没有被夹成 1（${e.s.maxHp}）`);
  approx(e.s.atk, e.base.atk * 0.8, 1e-6, '攻击 = 基础 ×0.8');
  approx(e.s.def, e.base.def * 0.5, 1e-6, '防御 = 基础 ×0.5');
  approx(e.s.res, e.base.res * 0.7, 1e-6, '法抗 = 基础 ×0.7');
  approx(e.s.aspd, e.base.aspd * 2, 1e-6, '攻击间隔 ×50% ⇒ 攻速 ×2');
  assert.equal(h.invariants(), true);
});

test('§5.1 玻利瓦尔三形态：生命上限 ×1.6（替换二形态的 ×1.5，不累乘）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SHCHMR, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);                    // → 灾厄之口 → 二形态
  h.runUntil(() => e.findBuff('recon:shchmr_form'), 14);
  approx(e.s.maxHp, e.base.maxHp * 1.5, 1e-6, '二形态生命上限 ×1.5');
  h.b.kill(e, null);                    // → 灾厄之口 → 三形态
  h.runUntil(() => e.s.maxHp >= e.base.maxHp * 1.6 - 1, 20);
  approx(e.s.maxHp, e.base.maxHp * 1.6, 1e-6, '三形态生命上限 ×1.6（不是 1.5×1.6）');
  approx(e.s.atk, e.base.atk * 1.2, 1e-6, '三形态攻击 ×1.2（替换二形态的 ×1.5）');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// §5.6 R8 / R12 记录的旧参数

test('§5.6 腐败/凋零骑士：技能首次/冷却 10/10；亡语 +50% 攻 / +50 攻速 / +150% 移速', () => {
  for (const [key, name] of [[DEKGHT, 'ChargeAttack'], [DEKGHT_2, 'TripleAttack']]) {
    const sk = PACK[key].skills.find((s) => s.prefabKey === name);
    assert.equal(sk.initCooldown, 10, `${key} ${name} 首次 10`);
    assert.equal(sk.cooldown, 10, `${key} ${name} 冷却 10`);
    const t = PACK[key].talents.bb;
    assert.equal(t['triggerrage.atk'], 0.5, `${key} 亡语攻击 +50%`);
    assert.equal(t['triggerrage.attack_speed'], 50, `${key} 亡语攻速 +50`);
    assert.equal(t['triggerrage.move_speed'], 1.5, `${key} 亡语移速仍 +150%`);
  }
});

test('§5.6 自在 / 霜星 / 塔露拉 / 爱国者：冷却与重生参数回到规格值', () => {
  const xiShield = PACK['enemy_ws_recon_xi'].skills.find((s) => s.prefabKey === 'ShieldBurst');
  assert.deepEqual([xiShield.initCooldown, xiShield.cooldown], [20, 40], '自在 破桎而出 首次 20 / 冷却 40');
  assert.equal(xiShield.bb.dynamic, 15000, '自在 屏障 15000');
  assert.equal(xiShield.bb.duration, 10, '自在 蓄力 10 秒');
  const xiReborn = PACK['enemy_ws_recon_xi'].skills.find((s) => s.prefabKey === 'ShieldBurstReborn');
  assert.equal(xiReborn.bb.dynamic, 20000, '自在 重生屏障 20000（冷却不在规格内、保持原样）');

  for (const name of ['IceShield', 'IceShield[Reborn]']) {
    const sk = PACK['enemy_ws_recon_frstar2'].skills.find((s) => s.prefabKey === name);
    assert.equal(sk.cooldown, 20, `霜星 ${name} 冷却 20（两形态都要）`);
  }
  const fsT = PACK['enemy_ws_recon_frstar2'].talents.bb;
  assert.deepEqual([fsT['reborn.duration'], fsT['reborn.reborn_invincible.duration']], [5, 10], '霜星 重生 5 / 无敌 10');

  const dance = PACK['enemy_ws_recon_talula'].skills.find((s) => s.prefabKey === 'DanceFire');
  assert.deepEqual([dance.initCooldown, dance.cooldown], [20, 20], '塔露拉 日冕 20/20');
  const danceHalf = PACK['enemy_ws_recon_talula'].skills.find((s) => s.prefabKey === 'DanceFire[Half]');
  assert.equal(danceHalf.cooldown, 10, '塔露拉 [Half] 日冕冷却 10');

  const pt = PACK['enemy_ws_recon_patrt'];
  assert.equal(pt.talents.bb['reborn.duration'], 10, '爱国者 重生 10 秒');
  assert.equal(pt.talents.bb['reborn.patrt_t_state_2[reborn_invincible].duration'], 10, '爱国者 重生后无敌 10 秒');
  assert.equal(pt.talents.bb['immo_trigger[rage].interval'], 0.6, '爱国者 重生真伤间隔 0.6 秒');
  const spear = pt.skills.find((s) => s.prefabKey === 'throwspear[Rage]');
  assert.equal(spear.cooldown, 15, '爱国者 投枪冷却 15');
  approx(spear.bb.atk_scale, 1.755, 1e-9, '爱国者 投枪倍率 1.755');
});

// ===============================================================================================================
// §5.7 骑士同伴死亡强化（官方 kit 的正则只认官方 key）

test('§5.7 腐败骑士倒下 ⇒ 凋零骑士获得亡语强化一次（反向同样，无关死亡不触发）', async () => {
  const h = await scene(['t_wall']);
  const a = h.spawn(DEKGHT, { pos: [8, 4], routeIndex: 0, mods: { speedMul: 0 } });
  const b = h.spawn(DEKGHT_2, { pos: [8, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(a, null);
  assert.ok(b.findBuff('recon:knight_rage'), '存活的一方获得亡语');
  approx(b.s.atk / b.base.atk, 1.5, 1e-6, '攻击 ×1.5');
  approx(b.s.aspd, b.base.aspd + 50, 1e-6, '攻速 +50');
  approx(b.s.moveSpeed, b.base.moveSpeed * 2.5, 1e-6, '移速 +150%');

  const h2 = await scene(['t_wall']);
  const c = h2.spawn(DEKGHT, { pos: [8, 4], routeIndex: 0, mods: { speedMul: 0 } });
  const d = h2.spawn(DEKGHT_2, { pos: [8, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const mob = h2.spawn('enemy_ws_recon_demonk', { pos: [8, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h2.step();
  h2.b.kill(mob, null);
  assert.ok(!c.findBuff('recon:knight_rage') && !d.findBuff('recon:knight_rage'), '无关单位死亡不强化');

  const h3 = await scene(['t_wall']);
  const e1 = h3.spawn(DEKGHT, { pos: [8, 4], routeIndex: 0, mods: { speedMul: 0 } });
  const e2 = h3.spawn(DEKGHT_2, { pos: [8, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h3.step();
  h3.b.kill(e2, null);
  assert.ok(e1.findBuff('recon:knight_rage'), '另一种死亡顺序同样触发');
  assert.ok(!e2.findBuff('recon:knight_rage'), '自己死亡不给自己强化');
});

// ===============================================================================================================
// §5.12 W 的 C4：锁定目标在引信期间走出落点，仍然吃到伤害

test('§5.12 C4 锁定目标：引信期间移出爆炸范围也吃到；单枚 C4 对同一单位只结算一次', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(CQBW, { pos: [10, 4], routeIndex: 0, mods: { speedMul: 0 } });
  const w = h.unit('t_wall');
  h.step();
  const ok = h.runUntil(() => h.eventsOf('fx').some((x) => x[1] === 'telegraph' && x[4] && x[4].kind === 'c4'), 12);
  assert.ok(ok, 'C4 已安装');
  const before = w.hp;
  const seen = damages(h, e, (c) => c.target === w && c.dmg.tags && c.dmg.tags.includes('enemyAbility')).length;
  w.tileC += 4;
  w.x = w.x + 4;
  w.markDirty();
  h.run(1.5);
  const hits = damages(h, e, (c) => c.target === w && c.dmg.tags && c.dmg.tags.includes('enemyAbility')).slice(seen);
  assert.equal(hits.length, 1, '锁定目标吃到且只吃到一次 C4');
  assert.ok(w.hp < before, '血量确实下降');
  // 这一条测试直接改了单位的格子坐标（模拟「引信期间走开」），占位表不会跟着变 ⇒ 不跑 invariants。
});

// ===============================================================================================================
// §5.8 爱国者：重生阶段先推进专用状态；切形态清理行军增益

test('§5.8 爱国者：10 秒重生窗口内按 0.6 秒出真伤，切毁灭姿态后行军增益被清掉', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(PATRT, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(e.findBuff('recon:patrt_shield'), '行军姿态增益在场');
  h.b.kill(e, null);
  assert.ok(e.findBuff('recon:patrt_reborn'), '进入重生窗口');
  h.runUntil(() => !e.findBuff('recon:patrt_reborn'), 12);
  const trueHits = damages(h, e, (c) => c.dmg.type === 'true' && c.dmg.tags && c.dmg.tags.includes('enemyAbility'));
  assert.ok(trueHits.length >= 12, `10 秒 / 0.6 秒 ≈ 16 跳（实际 ${trueHits.length}）`);
  assert.ok(!e.findBuff('recon:patrt_shield'), '行军姿态增益已随形态切换移除');
  assert.ok(e.findBuff('recon:patrt_rage'), '毁灭姿态增益已挂上');
  approx(e.base.rangeRadius, 2, 1e-6, '毁灭姿态射程 2');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// §5.10 奎隆：只在第一次击倒时重生 7 秒，最终死亡不再回入定

test('§5.10 奎隆：第一次击倒重生一次，第二次击倒真死', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.time >= 10.5, 12);   // 离开入定
  h.b.kill(e, null);
  assert.equal(e.alive, true, '第一次击倒进入 7 秒重生');
  assert.ok(e.findBuff('recon:skz_reborn'));
  h.runUntil(() => !e.findBuff('recon:skz_reborn'), 9);
  assert.equal(e.alive, true, '重生后回到自在');
  h.b.kill(e, null);
  assert.equal(e.alive, false, '第二次击倒直接死亡（不再无限重生）');
  assert.equal(h.invariants(), true);
});

test('§5.10 奎隆：阶段重生的清场不带走自己召唤的尼卢火，之后它仍按自己的计时退场', async () => {
  const NILU = 'enemy_ws_recon_nilu';
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const add = h.spawn('enemy_ws_recon_bldbld', { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const grown = h.runUntil(() => h.b.enemies.some((o) => o.alive && o.defId === NILU), 45);
  assert.ok(grown, '自在阶段召唤出尼卢火');
  const n = h.b.enemies.find((o) => o.alive && o.defId === NILU);
  assert.equal(n.counted, true, '召唤物计入数量（本轮业主口径）');
  assert.ok(n.lpr >= 1, `召唤物漏怪扣目标生命（lpr ${n.lpr}）`);
  h.b.kill(e, null);
  h.runUntil(() => !e.findBuff('recon:skz_reborn'), 10);
  assert.equal(add.alive, false, '场上别的敌人照常被清场带走');
  assert.equal(n.alive, true, '自己召唤的尼卢火不随首领的阶段退场');
  h.b.kill(e, null);
  assert.equal(e.alive, false, '第二次击倒 = 最终死亡');
  assert.equal(n.alive, true, '首领退场后尼卢火仍留在场上');
  const gone = h.runUntil(() => !n.alive, 40);
  assert.ok(gone, '尼卢火按自己的 30 秒计时退场');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// §5.9 血骑士：复活姿态**只靠凝血之刃回血**（业主 2026-10-28 定稿）

test('§5.9 血骑士：复活姿态没有自动回血，每枚凝血之刃回复 10% 最大生命', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn('enemy_ws_recon_bldkgt', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);
  assert.ok(e.findBuff('recon:bldkgt_reborn'), '进入复活姿态');
  const start = e.hp;
  h.run(1.9);   // 第一波凝血之刃在 2 s 才召出，落点还在 2.5 格外
  approx(e.hp, start, 1e-9, '这 1.9 秒里没有自动回血');
  const unit = e.s.maxHp * 0.1;
  h.runUntil(() => e.hp > start + 1, 8);
  const gained = e.hp - start;
  const k = Math.round(gained / unit);
  assert.ok(k >= 1, `凝血之刃抵达后回了血（${gained}）`);
  approx(gained, unit * k, 1e-6, '每次回复都是 10% 最大生命的整数倍（Wiki 的 Devour.hp_ratio = 0.1）');
  assert.equal(h.invariants(), true);
});

test('§5.9 血骑士：复活姿态每波 20 枚，落点在自身 2.5 格之外的随机格', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn('enemy_ws_recon_bldkgt', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);
  h.run(2.15);  // 首波已入场，最近的也要 1.25 s 才走到
  const blades = h.b.enemies.filter((x) => x.alive && x.defId === 'enemy_ws_recon_bldbld');
  assert.equal(blades.length, 20, `首波 20 枚（实际 ${blades.length}）`);
  for (const bl of blades) {
    const d = Math.hypot(bl.tileR - e.tileR, bl.tileC - e.tileC);
    assert.ok(d > 2.5 - 1e-9, `落点距本体 > 2.5 格（实际 ${d.toFixed(2)}）`);
  }
  // 随机性：不是全部落在同一格
  const spots = new Set(blades.map((x) => `${Math.round(x.tileR)},${Math.round(x.tileC)}`));
  assert.ok(spots.size > 1, '落点是随机格（不是同一个位置叠 20 枚）');
});

test('§5.9 血骑士：20 秒内刀全被清掉 ⇒ 第二形态（目标 2 / 射程 2 / 减伤 ×0.5 / 攻击 ×1.5）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn('enemy_ws_recon_bldkgt', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);
  const t0 = h.b.time;
  while (h.b.time - t0 < 20.8) {
    for (const bl of h.b.enemies.filter((x) => x.alive && x.defId === 'enemy_ws_recon_bldbld')) h.b.kill(bl, null);
    h.step();
  }
  assert.ok(e.findBuff('recon:bldkgt_form2'), '20 秒没回满 ⇒ 第二形态');
  assert.equal(e.profile.maxTargets, 2, '第二形态攻击目标 2');
  approx(e.base.rangeRadius, 2, 1e-6, '第二形态远程（射程 2）');
  approx(e.findBuff('recon:bldkgt_reduce').mods.physTakenMul, 0.5, 1e-6, '第二形态减伤 ×0.5');
  approx(e.s.atk / e.base.atk, 1.5, 1e-6, '第二形态攻击 ×1.5');
  assert.equal(h.invariants(), true);
});

test('§5.9 血骑士：放满凝血之刃（≥100%）⇒ 回第一形态，且可再次进入复活姿态', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn('enemy_ws_recon_bldkgt', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);
  assert.ok(e.findBuff('recon:bldkgt_reborn'));
  // 10 枚 ×10% ⇒ 回满（每枚直接落在本体脚下、当帧抵达）
  for (let i = 0; i < 10; i++) h.b.spawnEnemy('enemy_ws_recon_bldbld', { pos: [e.y, e.x] });
  const back = h.runUntil(() => !e.findBuff('recon:bldkgt_reborn'), 5);
  assert.ok(back, '回满后回第一形态');
  assert.ok(e.findBuff('recon:bldkgt_reduce'), '恢复第一形态减伤');
  h.b.kill(e, null);
  assert.ok(e.findBuff('recon:bldkgt_reborn'), '第二次击倒仍进入复活姿态（不再直接真死）');
  assert.equal(h.invariants(), true);
});

test('§5.9 凝血之刃：移速按业主 2026-10-29 降低 75%（2 → 0.5）', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.BLDKGT_BLADE_SPEED, 0.5);
});

test('“不死的黑蛇”【不息恶火】：官方全屏火雨（`official` fx 点名 `screen_bsnake`），不再逐目标发 `atk` / 施放技能槽 3', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(BSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);                                  // → 5 s 重生 → 不息恶火
  h.runUntil(() => h.b.time >= 5.2, 7);
  const atkBefore = h.eventsOf('atk').filter((x) => x[1] === e.id).length;
  const dmgBefore = damages(h, e, (c) => c.dmg.type === 'arts').length;
  h.runUntil(() => h.b.time >= 9, 10);
  const atkAfter = h.eventsOf('atk').filter((x) => x[1] === e.id).length;
  assert.equal(atkAfter, atkBefore, '火雨期间首领**不挥普攻**（旧：逐目标 `atk` ⇒ 每轮挥 7 次）');
  assert.equal(h.eventsOf('cast').filter((x) => x[2] === 3).length, 0, '不再施放技能槽 3（官方那个模式没有动作 clip）');
  const screen = h.eventsOf('fx').filter((x) => x[1] === 'official' && x[4] && x[4].key === 'screen_bsnake');
  assert.equal(screen.length, 1, '整段只起一枚官方全屏特效');
  assert.ok(screen[0][4].holdS >= 10, `撑满整段火雨（holdS=${screen[0][4].holdS}）`);
  const rc = h.b.rect;
  assert.ok(Math.abs(screen[0][2] - (rc.c0 + rc.c1) / 2) < 0.02 && Math.abs(screen[0][3] - (rc.r0 + rc.r1) / 2) < 0.02,
    `起在战场中心（${screen[0][2]},${screen[0][3]} vs 中心 ${(rc.c0 + rc.c1) / 2},${(rc.r0 + rc.r1) / 2}）`);
  const flames = h.eventsOf('fx').filter((x) => x[1] === 'flame');
  assert.ok(flames.length >= 10, `每轮都有火团（${flames.length} 条）`);
  assert.ok(flames.every((x) => x[4].id == null), '火团不带 id（客户端按 src 认同一股火，带 id 会并成一股）');
  const dmgAfter = damages(h, e, (c) => c.dmg.type === 'arts').length;
  assert.ok(dmgAfter > dmgBefore, `火雨真的打到了我方（${dmgBefore} → ${dmgAfter}）`);
  assert.equal(h.invariants(), true);
});

test('“不死的黑蛇” 普攻附带的烈焚灼息不再施放 Ignite（次数/冷却都由脚本自己数）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(BSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const w = h.unit('t_wall');
  h.runUntil(() => w.findBuff('recon:bsnake_fire'), 8);
  assert.ok(w.findBuff('recon:bsnake_fire'), '普攻命中挂上火');
  assert.equal(h.eventsOf('cast').length, 0, '前 8 秒（点燃首次 15 s、引爆首次 25 s 之前）一次技能都不该施放');
  assert.ok(h.eventsOf('atk').filter((x) => x[1] === e.id).length > 0, '普攻本身照常');
  assert.equal(h.invariants(), true);
});

test('§5.11 AMa-10：防火墙用官方墙材拼的 3×3 / 10×7 盒（passive 能力）；信息洪流/刷新会发 cast + skill', async () => {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/assets/fx/index.json'), 'utf8'));
  const want = { enemy_1590_muama: 'recon_muama_firewall_3x3', enemy_1591_mutwin: 'recon_muama_firewall_3x3', enemy_1593_musnake: 'recon_muama_firewall_10x7' };
  for (const [spine, key] of Object.entries(want)) {
    const ab = (index.units[spine].abilities || []).find((a) => a && a.name === 'recon_firewall');
    assert.ok(ab && ab.when === 'passive', `${spine} 有 passive 防火墙能力`);
    assert.deepEqual(ab.uses[0].keys, [key], `${spine} 用 ${key}`);
    assert.ok(index.prefabs[key], `${key} 在特效索引里`);
    assert.ok(fs.existsSync(path.join(ROOT, 'workshop/mode-recon/assets/fx/prefabs', `${key}.json`)), `${key} 的 prefab 文件在包里`);
    const prefab = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/assets/fx/prefabs', `${key}.json`), 'utf8'));
    assert.equal(prefab.nodes[0].children.length, 4, `${key} 四面墙`);
  }
  const h = await scene(['t_wall']);
  const e = h.spawn(MUAMA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  const ok = h.runUntil(() => h.eventsOf('cast').some((x) => x[1] === e.id), 35);
  assert.ok(ok, '信息洪流/刷新发了 cast');
  assert.ok(h.eventsOf('skill').some((x) => x[1] === e.id && x[2] === 1), '技能姿态已开');
});

test('§5.11 “终始”：受伤挡位会发 Injured 的 cast 与受伤形态', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn('enemy_ws_recon_musnake', { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  e.hp = e.s.maxHp * 0.5;
  e.markDirty();
  h.step();
  assert.ok(h.eventsOf('cast').some((x) => x[1] === e.id), 'Injured 发了 cast');
  assert.ok(h.eventsOf('fx').some((x) => x[4] && x[4].form === 'injured'), '受伤形态 fx');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// §5.11 AMa：越过 4% 的致命一击先转成假死，不提前广播 down

test('§5.11 AMa：从阈值上方一击打到 0 时进入假死而不是死亡', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(MUAMA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const w = h.unit('t_wall');
  h.step();
  e.hp = e.s.maxHp * 0.5;
  e.markDirty();
  h.b.dealDamage(w, e, { amount: e.s.maxHp, type: 'true', canDodge: false });
  assert.equal(e.alive, true, '没有被打死');
  h.step();
  assert.ok(e.findBuff('recon:ama_fake'), '进入假死');
  approx(e.hpRatio, 0.04, 1e-4, '血量停在 4%（不是 0）');
  assert.equal(h.invariants(), true);
});

test('§5.11 AMa（跨战场共享池）：一击打穿池也不提前广播 amaDown；两块场地假死回复只算一次', async () => {
  const ch = new ReconChannel({ areas: { p1: 1 }, pools: { ama: { maxHp: 10000000 }, core: { maxHp: 15000000 } } });
  const h = await scene(['t_wall'], { reconChannel: ch });
  const e = h.spawn(MUAMA, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  const w = h.unit('t_wall');
  h.step();
  ch.setHp('ama', ch.pool('ama').maxHp * 0.5);
  h.b.dealDamage(w, e, { amount: ch.pool('ama').maxHp, type: 'true', canDodge: false });
  assert.equal(e.alive, true, '没有被打死');
  assert.ok(!ch.log.some((ev) => ev.kind === 'amaDown'), '没有提前广播 amaDown');
  h.step();
  assert.ok(e.findBuff('recon:ama_fake'), '进入假死');
  approx(ch.pool('ama').hp, ch.pool('ama').maxHp * 0.04, 1e-6, '共享池锁在 4%');

  // 两块 AMa 战场同时假死 ⇒ 每秒只回一次 1%
  const ch2 = new ReconChannel({ areas: { p1: 1 }, pools: { ama: { maxHp: 10000000 }, core: { maxHp: 15000000 } } });
  const h1 = await scene(['t_wall'], { reconChannel: ch2 });
  h1.spawn(MUAMA, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  h1.step();
  const twinScene = await scene(['t_wall'], { reconChannel: ch2 });
  twinScene.spawn('enemy_ws_recon_mutwin', { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  ch2.setHp('ama', ch2.pool('ama').maxHp * 0.03);
  h1.run(0.05); twinScene.run(0.05);
  const before = ch2.pool('ama').hp;
  h1.run(1); twinScene.run(1);
  const gained = ch2.pool('ama').hp - before;
  assert.ok(gained <= ch2.pool('ama').maxHp * 0.0102 + 1, `1 秒只回 1%（实际 ${gained / ch2.pool('ama').maxHp * 100}%）`);
  assert.equal(h1.invariants(), true);
});

// ===============================================================================================================
// §5.4 大锁的自愈要回**共享池**（下一帧的 `_syncBossHp` 不会把它冲掉），且多块场地不翻倍

test('§5.4 大锁自愈：回共享池而不是只写单位血条；两块场地不重复回血', async () => {
  const pool = new SharedBossPool(25000000);
  const h = await scene(['t_wall'], { sharedBoss: pool });
  const e = h.spawn(CSDOLL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  h.step();
  pool.damage(null, 15000000);
  const before = pool.hp;
  h.run(1.0);
  const healed = pool.hp - before;
  // 每秒 min(0.25% × 2500 万, 100000) = 62500
  assert.ok(healed >= 60000 && healed <= 70000, `每秒回复 ≈ 62500（实际 ${healed}）`);
  // 池是唯一真相：再同步一帧，血条仍然等于「回血后的池比率」（旧的只写 e.hp 会被这里冲回去）
  h.b._syncBossHp(e);
  approx(e.hp / e.s.maxHp, pool.hp / pool.maxHp, 1e-9, '同步后单位血条 = 池比率（回血没被冲掉）');

  const shared = new SharedBossPool(25000000);
  const a = await scene(['t_wall'], { sharedBoss: shared });
  a.spawn(CSDOLL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  const b = await scene(['t_wall'], { sharedBoss: shared });
  b.spawn(CSDOLL, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  a.step(); b.step();
  shared.damage(null, 15000000);
  const twoBefore = shared.hp;
  a.run(1.0); b.run(1.0);
  const twoHealed = shared.hp - twoBefore;
  assert.ok(twoHealed <= 70000, `两块场地共用一条池时不翻倍（实际 ${twoHealed}）`);
  assert.equal(a.invariants(), true);
});

// ===============================================================================================================
// §5.5 AMa 的池只扣一次（战场共享池接通道池适配器）

test('§5.5 AMa：共享池接通道池适配器时，同一伤害只扣一次', async () => {
  // 对照组：没有池 / 没有通道 —— 这一次伤害扣掉多少血
  const ctrl = await scene(['t_wall']);
  const e0 = ctrl.spawn(MUAMA, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  ctrl.step();
  const hp0 = e0.hp;
  ctrl.b.dealDamage(ctrl.unit('t_wall'), e0, { amount: 1000000, type: 'phys', canDodge: false });
  const single = hp0 - e0.hp;
  assert.ok(single > 0 && single < 1000000, `单次伤害 ${single}`);

  const ch = new ReconChannel({ areas: { p1: 1 }, pools: { ama: { maxHp: 10000000 }, core: { maxHp: 15000000 } } });
  const pool = new ChannelBossPool(ch, 'ama');
  const h = await scene(['t_wall'], { sharedBoss: pool, reconChannel: ch });
  const e = h.spawn(MUAMA, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  h.step();
  const before = ch.pool('ama').hp;
  h.b.dealDamage(h.unit('t_wall'), e, { amount: 1000000, type: 'phys', canDodge: false });
  const lost = before - ch.pool('ama').hp;
  approx(lost, single, 1e-6, '通道池只扣一次（与无池对照组同值，不是两倍）');
  approx(pool.hp, ch.pool('ama').hp, 1e-9, '战场池 = 通道池（同一份）');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// §5.3 多阶段首领 × 真实共享血池（池驱动阶段，包侧 kill 只代表最终死亡）

test('§5.3 黑蛇（真实共享池）：两次阶段死亡都被池接管，第三次才真死', async () => {
  const pool = new SharedBossPool(2500000);
  const h = await scene(['t_wall'], { sharedBoss: pool });
  const e = h.spawn(BSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  const w = h.unit('t_wall');
  h.step();
  assert.equal(pool.lives, 3, '包侧把这条池声明成 3 条命');
  h.b.dealDamage(w, e, { amount: 1e9, type: 'true', canDodge: false });
  assert.equal(e.alive, true, '中间阶段不会被池归零打死');
  assert.ok(pool.hp <= 1 + 1e-9, '池被夹在 1 血等阶段推进');
  h.step();
  assert.equal(pool.phase, 1, '第一次击穿 ⇒ 阶段 1');
  assert.ok(pool.hp >= pool.maxHp * 0.999, '池被回填');
  assert.ok(e.findBuff('recon:bsnake_reborn'), '本地脚本进入了重生窗口');

  h.runUntil(() => !!e.findBuff('recon:bsnake_rage'), 8);
  assert.ok(e.findBuff('recon:bsnake_rage'), '重生 5 秒后进入狂暴');
  h.runUntil(() => !e.findBuff('recon:bsnake_inv'), 12);   // 等狂暴期的 10 秒无敌结束
  h.b.dealDamage(w, e, { amount: 1e9, type: 'true', canDodge: false });
  h.step();
  assert.equal(pool.phase, 2, '第二次击穿 ⇒ 阶段 2');
  assert.ok(pool.hp <= pool.maxHp * 0.1 + 1, '第二次阶段回来只留 10% 生命');
  assert.ok(e.findBuff('recon:bsnake_dying'), '进入第二次消失窗口');

  // 消失 5 s + 不息恶火 10 轮 ⇒ 余烬；最后一条命打空 = 真死
  h.runUntil(() => !!e.findBuff('recon:bsnake_ash'), 25);
  h.runUntil(() => !e.findBuff('recon:bsnake_inv'), 12);
  h.b.dealDamage(w, e, { amount: 1e9, type: 'true', canDodge: false });
  h.step();
  assert.equal(pool.phase, 2, '最后一条命不再推进阶段');
  assert.equal(pool.hp, 0, '池归零');
  assert.equal(e.alive, false, '最终死亡');
});

test('§5.3 两块战场共用一条池：阶段只推进一次、回填只发生一次', async () => {
  const pool = new SharedBossPool(2500000);
  const a = await scene(['t_wall'], { sharedBoss: pool });
  const b = await scene(['t_wall'], { sharedBoss: pool });
  const ea = a.spawn(BSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  const eb = b.spawn(BSNAKE, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  a.step(); b.step();
  a.b.dealDamage(a.unit('t_wall'), ea, { amount: 1e9, type: 'true', canDodge: false });
  b.b.dealDamage(b.unit('t_wall'), eb, { amount: 1e9, type: 'true', canDodge: false });
  a.step(); b.step();
  assert.equal(pool.phase, 1, '整轮只推进一次');
  assert.ok(pool.hp >= pool.maxHp * 0.999, '池只回填一次（没有被回填两遍）');
  assert.ok(ea.findBuff('recon:bsnake_reborn') && eb.findBuff('recon:bsnake_reborn'), '两块战场各自进入重生');
  assert.ok(ea.alive && eb.alive, '两块战场的首领都活着');
});

test('§5.3 奎隆（真实共享池）：池只给一次重生', async () => {
  const pool = new SharedBossPool(2500000);
  const h = await scene(['t_wall'], { sharedBoss: pool });
  const e = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  const w = h.unit('t_wall');
  h.runUntil(() => h.b.time >= 10.5, 12);   // 离开入定
  assert.equal(pool.lives, 2, '池两条命');
  h.b.dealDamage(w, e, { amount: 1e9, type: 'true', canDodge: false });
  h.step();
  assert.equal(pool.phase, 1, '第一次击穿 ⇒ 重生阶段');
  assert.ok(e.findBuff('recon:skz_reborn'));
  h.runUntil(() => !e.findBuff('recon:skz_reborn'), 9);
  assert.equal(e.alive, true, '重生后回到自在');
  h.b.dealDamage(w, e, { amount: 1e9, type: 'true', canDodge: false });
  h.step();
  assert.equal(e.alive, false, '第二次击穿 = 最终死亡');
});

// ===============================================================================================================
// 素材 / 特效声明（Boss 只「站桩普攻、技能没有表现」的根因）

test('素材：每条记录用的 spine 要么官方清单有、要么本包 art 声明；模型/图标文件都在包里', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/pack.json'), 'utf8'));
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).enemies || {};
  const art = (pack.art && pack.art.enemies) || {};
  const spines = [...new Set(Object.values(PACK).map((r) => r.spine).filter(Boolean))];
  for (const s of spines) {
    assert.ok(official[s] || art[s], `${s} 有模型来源（官方清单或本包 art）`);
  }
  for (const [id, e] of Object.entries(art)) {
    const files = [e.icon, e.spine && e.spine.skel, e.spine && e.spine.atlas, ...((e.spine && e.spine.textures) || [])].filter(Boolean);
    for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, 'workshop/mode-recon/assets', f)), `${id} 的 ${f} 在包里`);
  }
  // 会攻击的首领必须有 attackAnim（R21 那批从前是 null ⇒ 攻击动作不对）
  for (const key of ['enemy_ws_recon_skzamy', 'enemy_ws_recon_muama', 'enemy_ws_recon_suisho', 'enemy_ws_recon_shophm']) {
    assert.ok(PACK[key].attackAnim && PACK[key].attackAnim.clip, `${key} 有攻击动作`);
  }
});

test('召唤物：每条内联 def 都带 spine / iconId，模型与特效都有来源（否则客户端只画空占位）', async () => {
  const mod = await packModule();
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/pack.json'), 'utf8'));
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).enemies || {};
  const art = (pack.art && pack.art.enemies) || {};
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/assets/fx/index.json'), 'utf8'));
  const localPath = path.join(ROOT, 'public/assets/local/fx/index.json');
  const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) : { units: {} };
  const defs = mod.RECON_SUMMON_DEFS;
  assert.ok(defs && Object.keys(defs).length >= 9, '召唤物内联记录都在');
  for (const [key, def] of Object.entries(defs)) {
    assert.ok(def.spine, `${key} 写了 spine（快照按它找模型）`);
    assert.ok(def.iconId, `${key} 写了 iconId`);
    assert.equal(def.notCountInTotal, undefined, `${key} 计入数量（不再是场景装置）`);
    assert.ok(Number(def.stats.lpr) >= 1, `${key} 漏怪扣目标生命（lpr ≥ 1）`);
    assert.ok(official[def.spine] || art[def.spine], `${key} 的模型 ${def.spine} 有来源（官方清单或本包 art）`);
    assert.ok((index.units || {})[def.spine] || (local.units || {})[def.spine], `${key} 的 ${def.spine} 有特效来源`);
  }
});

test('形态：pack.json.forms 的每个 clip 都在该模型上存在，next 指向已声明形态', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/pack.json'), 'utf8'));
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).enemies || {};
  const forms = (pack.forms && pack.forms.enemies) || {};
  const animsOf = (spine) => ((pack.art.enemies[spine] || {}).spine || {}).animations
    || (official[spine] && official[spine].spine && official[spine].spine.animations) || null;
  assert.ok(Object.keys(forms).length >= 10, '形态声明覆盖本轮用到的首领');
  for (const [spine, kinds] of Object.entries(forms)) {
    const anims = animsOf(spine);
    assert.ok(anims, `${spine} 有 clip 清单`);
    for (const [kind, spec] of Object.entries(kinds)) {
      for (const [role, v] of Object.entries(spec.roles || {})) {
        if (v == null) continue;
        const clips = typeof v === 'string' ? [v] : [v.begin, v.loop, v.end].filter(Boolean);
        for (const c of clips) assert.ok(c in anims, `${spine}.${kind}.${role} 的 clip ${c} 在模型上`);
      }
      for (const f of ['change', 'end', 'leave']) {
        if (spec[f]) assert.ok(spec[f] in anims, `${spine}.${kind}.${f} 的 clip ${spec[f]} 在模型上`);
      }
      if (spec.next) assert.ok(spec.next in kinds, `${spine}.${kind}.next 指向已声明形态`);
    }
  }
  // 本轮点名的两只：奎隆 自在 / 无忧觉，阿米娅 第二形态
  assert.ok(forms.enemy_2089_skzjkl && forms.enemy_2089_skzjkl.M1 && forms.enemy_2089_skzjkl.M3, '奎隆 M1 / M3');
  assert.ok(forms.enemy_2092_skzamy && forms.enemy_2092_skzamy.form2, '阿米娅 form2');
  // 玻利瓦尔：D_* 是飞行那套（Fly/Return 的 animKey 是 D_Begin / D_End），灾厄之口靠技能槽 0 的 C_Skill_1_Begin
  const sh = forms.enemy_2150_shchmr;
  assert.ok(sh && sh.fly && !sh.jaw, '玻利瓦尔 只有 fly 形态，灾厄之口不再换形态');
  const shAnims = animsOf('enemy_2150_shchmr');
  const shSkills = pack.art.enemies.enemy_2150_shchmr.spine.anims.skills;
  for (const k of ['0', '1', '6']) {
    assert.ok(shSkills && shSkills[k], `玻利瓦尔技能槽 ${k} 有 clip`);
    for (const c of [shSkills[k].begin, shSkills[k].loop, shSkills[k].end]) if (c) assert.ok(c in shAnims, `槽 ${k} 的 ${c} 在模型上`);
  }
});

test('包的战斗模块能过服务端静态扫描（一条 BATTLE_BAD_SOURCE 就会让整包在启动时被丢弃）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/battle/main.mjs'), 'utf8');
  assert.deepEqual(battleSourceIssues(src, 'mode-recon'), []);
});

test('特效：本包声明了 fx.manifest，索引（或引擎自带的本地 fx）覆盖每一只重构首领的 spine', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/pack.json'), 'utf8'));
  assert.ok(pack.fx && pack.fx.manifest === 'fx/manifest.json', 'pack.json 声明 fx.manifest');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/assets', pack.fx.manifest), 'utf8'));
  assert.equal(manifest.format, 'sp-fx-pack/1');
  assert.equal(manifest.pack, 'mode-recon', '清单里的 pack 名与本包一致');
  const s = JSON.stringify(manifest);
  assert.equal(/enemy-ext/.test(s), false, '清单路径已改写到本包（没有 enemy-ext 的残留）');
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/assets/fx/index.json'), 'utf8'));
  // 引擎自带的那份官方特效（/data/local-fx.json 的源）由客户端先加载，工坊包的 fx 再深合并上去
  const localPath = path.join(ROOT, 'public/assets/local/fx/index.json');
  const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) : { units: {} };
  const spines = [...new Set(Object.values(PACK).map((r) => r.spine).filter(Boolean))];
  const units = index.units || {};
  const localUnits = local.units || {};
  for (const sp of spines) {
    assert.ok(units[sp] || localUnits[sp], `${sp} 有特效来源（本包 fx 或引擎本地 fx）`);
  }
});


test('§5.2 首领血池：重构首领取包记录的 stats.maxHp（share = 1），官方首领仍读 bosses 表', () => {
  const raw = { ...DATA, enemies: { ...DATA.enemies, ...PACK } };
  const gd = new GameData(raw, 'mode_multi_abyss');
  gd.modeId = 'mode_recon_abyss';
  assert.equal(gd.isRecon, true, '按重构对局判定');
  const self = Object.create(MatchBoss.prototype);
  Object.assign(self, { dev: false, devBossOverrides: null, gd });
  const hp = MatchBoss.prototype._bossPoolHp.call(self, BSNAKE, 1);
  assert.equal(hp, PACK[BSNAKE].stats.maxHp * gd.bossPoolShare(1), '黑蛇 = 记录 250 万 × 人数份额');
  assert.ok(hp > 500000, `不再回退 50 万（${hp}）`);
  const r21 = MatchBoss.prototype._bossPoolHp.call(self, MUAMA, 1);
  assert.equal(r21, PACK[MUAMA].stats.maxHp * gd.bossPoolShare(1), 'AMa = 记录 1000 万 × 人数份额');
  const official = MatchBoss.prototype._bossPoolHp.call(self, 'boss_8', 1);
  assert.ok(official !== 500000, `官方首领不受影响（${official}）`);
  const plain = new GameData(DATA, 'mode_multi_abyss');
  const plainSelf = Object.create(MatchBoss.prototype);
  Object.assign(plainSelf, { dev: false, devBossOverrides: null, gd: plain });
  assert.equal(MatchBoss.prototype._bossPoolHp.call(plainSelf, 'boss_8', 2), plain.bossPoolHp('boss_8', 2));
});
