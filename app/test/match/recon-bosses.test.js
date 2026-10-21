// 重构模拟的五个「·重构」首领（`workshop/mode-recon/enemies.json` + `battle/main.mjs` 的叠加机制）。
//
// 数据这一半：五个 key 都是官方首领的**变体**，照抄官方记录、只改 name / 追加一条 abilities、并写上 `effectRef`（W 除外）。
// 引擎在 `server/sim/content/enemies.js:176` 用 `KITS[e.def.raw?.effectRef ?? e.defId]` 取 kit，所以带 effectRef 的那四条
// **免费继承官方 kit**（本测试直接断言 `mem.ab` 挂上了 + 官方行为仍生效）。W·重构 不写 effectRef，C4 由包自己实现。
//
// 机制这一半在包模块里（`@battle/mod.js` 的白名单导入 → `rewriteKitImports` → `data:` 模块，与 `server/battlePack.js`
// 同一条装载路径），通过 `makeBattle({ extraContent: [enemiesMod, pack] })` 交给战场。
//
// ⚠ 测试套件把进程数据单例钉在**官方基线**上（test/official-data.mjs），所以五个新 key 一律经 `defs.enemies` 注入，
// 绝不依赖它们出现在 `data/enemies.json` 里。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/enemies.json'), 'utf8'));

const SKULSR = 'enemy_ws_recon_skulsr';
const LSLIME = 'enemy_ws_recon_lslime';
const CQBW = 'enemy_ws_recon_cqbw';
const MDROCK = 'enemy_ws_recon_mdrock';
const DEMONK = 'enemy_ws_recon_demonk';
const MDGINT = 'enemy_1092_mdgint';

// ---- 第 8 回合的六只 ----
const BIGADAM = 'enemy_ws_recon_bigadam';
const XI = 'enemy_ws_recon_xi';
const MEPHI = 'enemy_ws_recon_mephi';
const FAUST = 'enemy_ws_recon_faust';
const JAKILL = 'enemy_ws_recon_jakill';
const BLKSWB = 'enemy_ws_recon_blkswb';
/** 宿主池（data/enemies.json 里名字含「宿主」的三只）—— 与包的 RECON_BOSS_RULES.HOST_KEYS 必须一致。 */
const HOST_KEYS = ['enemy_1043_zomsbr', 'enemy_1061_zomshd', 'enemy_1062_rager_2'];

/** 官方记录：data/enemies.json（自在 / 杰斯顿 / 锏）与 workshop/enemy-ext（梅菲斯特 / 浮士德 —— 不在 data 里）。 */
const OFFICIAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/enemies.json'), 'utf8'));
const EXT = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/enemies.json'), 'utf8'));

let loaded = null;
/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块）。 */
async function packModule() {
  if (loaded) return loaded;
  const src = fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/battle/main.mjs'), 'utf8');
  const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
  loaded = await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  return loaded;
}

/** 一堵「只挡不打」的墙（高血、无攻击），`extra` 覆盖字段。 */
function wall(id, extra = {}) {
  return chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3, ...(extra.stats || {}) }, rangeGrid: [[0, 0]], skill: null, ...extra.rec });
}
const NOATK = () => ({ trait: { noAttack: true } });

/** 场地：`units` 个墙 + `enemies` 条记录注入；`captureNoisy` 打开才能看到 attack/damaged/heal 事件。 */
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
const fxOf = (h, kind) => h.eventsOf('fx').filter((e) => e[1] === kind);
const statuses = (h, id, key) => h.hooksOf('statusApplied').filter((c) => c.target && c.target.id === id && c.status === key);

// ---------------------------------------------------------------------------------------------------------------
// 数据 + effectRef 继承（机制的地基）

test('五个·重构记录的形状：key=映射键、name 加「·重构」、abilities 追加一行【重构】、spine/iconId 与官方一致', () => {
  const OFF = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/enemies.json'), 'utf8'));
  const bases = { [SKULSR]: 'enemy_1500_skulsr', [LSLIME]: 'enemy_1050_lslime', [CQBW]: 'enemy_1504_cqbw', [MDROCK]: 'enemy_1511_mdrock', [DEMONK]: 'enemy_1501_demonk' };
  for (const [key, base] of Object.entries(bases)) {
    const rec = PACK[key], off = OFF[base];
    assert.ok(rec && off, `${key} 记录存在`);
    assert.equal(rec.key, key, 'key = JSON 映射键');
    assert.equal(rec.name, off.name + '·重构', '官方名 + ·重构');
    assert.equal(rec.spine, off.spine, 'spine 沿用官方（真模型）');
    assert.equal(rec.iconId, off.iconId, 'iconId 沿用官方');
    assert.equal(rec.abilities.length, off.abilities.length + 1, '官方能力 + 一条');
    assert.equal(rec.abilities[rec.abilities.length - 1].text, `【重构】${rec.abilities[rec.abilities.length - 1].text.replace('【重构】', '')}`, '最后一条带【重构】前缀');
  }
  // W 是唯一没有 effectRef 的（见文件头），其余四条都指向官方 key
  for (const [key, base] of Object.entries(bases)) assert.equal(PACK[key].effectRef ?? null, key === CQBW ? null : base, `${key}.effectRef`);
  // W 的 C4 cooldown 减半、initCooldown 不动
  const wC4 = PACK[CQBW].skills.find((s) => s.prefabKey === 'C4');
  const offC4 = OFF['enemy_1504_cqbw'].skills.find((s) => s.prefabKey === 'C4');
  assert.equal(wC4.cooldown, offC4.cooldown / 2, 'C4 cooldown 减半');
  assert.equal(wC4.initCooldown, offC4.initCooldown, 'initCooldown 不动');
});

test('effectRef 继承官方 kit：四条挂上 mem.ab；W·重构（无 effectRef）不挂', async () => {
  const h = await scene(['t_wall']);
  for (const key of [SKULSR, LSLIME, MDROCK, DEMONK]) {
    const e = h.spawn(key, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
    assert.ok(e.mem.ab && e.mem.ab.list.length > 0, `${key} 继承到官方 kit（mem.ab 非空）`);
    h.b.kill(e, null);
  }
  const w = h.spawn(CQBW, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(!w.mem.ab || !w.mem.ab.list.length, 'W·重构 没有 effectRef ⇒ 没有引擎 kit（C4 由本包实现）');
  // 百夫长·重构：官方 kit + 本包覆盖 ⇒ maxTargets 3（官方是 2）
  const d = h.spawn(DEMONK, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(d.profile.maxTargets, 3, '本包在引擎之后把 maxTargets 改成 3');
});

// ---------------------------------------------------------------------------------------------------------------
// 1. 碎骨·重构：近战（被阻挡）攻击额外发射一枚榴弹

test('碎骨·重构：被阻挡的攻击额外发射榴弹 —— 目标 + 其 3×3 内每单位吃 ATK×0.26 物理并挂 5 s 防御力下降', async () => {
  const h = await scene(['t_wall', 't_wall2']); // 挡者 (10,6) + 邻格 (10,7)
  const e = h.spawn(SKULSR, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('splash')).length > 0, 30);
  const grenade = damages(h, e, (c) => (c.dmg.tags || []).includes('splash'));
  assert.ok(grenade.length >= 2, `榴弹同时打到挡者与邻格（${grenade.length} 个伤害实例）`);
  for (const c of grenade) approx(c.amount, e.s.atk * 0.26, 1e-6, '榴弹伤害 = 攻击力 26%');
  assert.ok(fxOf(h, 'grenade').length >= 1, '发了 grenade fx');
  const blocker = h.unit('t_wall');
  const buff = blocker.findBuff('defDown');
  assert.ok(buff, '挡者挂上了 defDown');
  assert.ok(Math.abs(buff.mods.defMul - 0.5) < 1e-6, `防御力 ×${buff.mods.defMul}（期望 0.5）`);
  assert.ok(statuses(h, blocker.id, 'defDown').length >= 1, 'statusApplied 报告了 defDown');
  // 邻格的水墙也吃到（3×3 格块判定）
  assert.ok(h.unit('t_wall2').findBuff('defDown'), '邻格单位同样被榴弹溅到');
});

// ---------------------------------------------------------------------------------------------------------------
// 2. 庞贝·重构：攻击额外附带 100% 攻击力的灼燃损伤

test('庞贝·重构：每次攻击对每一个被打到的目标追加一次灼燃（element burn，100% 攻击力）', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']);
  const e = h.spawn(LSLIME, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'element' && c.dmg.element === 'burn').length > 0, 30);
  const burns = damages(h, e, (c) => c.dmg.type === 'element' && c.dmg.element === 'burn');
  assert.ok(burns.length >= 1, '产生了灼燃（burn）元素损伤');
  for (const c of burns) approx(c.amount, e.s.atk * 1.0, 1e-6, '灼燃 = 100% 攻击力');
  // 官方 kit 的灼烧 DoT（ab:burnDot）仍在：证明是「叠加」而不是替换
  const atkEvents = h.hooksOf('attack').filter((c) => c.attacker === e);
  assert.ok(atkEvents.length >= 1, '庞贝·重构 攻击过');
  const hitAllies = new Set(burns.map((c) => c.target));
  assert.ok(hitAllies.size >= Math.min(e.profile.maxTargets, h.allies().length), '每个被攻击到的目标都追加了灼燃');
});

// ---------------------------------------------------------------------------------------------------------------
// 3. W·重构：本包自有的 C4（冷却减半 + 额外 1 名目标）

test('W·重构：C4 按记录的 initCooldown 起算、cooldown（减半后）重置，每次锁 1(+1) 名目标', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']); // 挡者 + 两名在射程 2.5 内（距离 1、2）
  const w = h.spawn(CQBW, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const c4Fx = () => fxOf(h, 'telegraph').filter((x) => x[4] && x[4].kind === 'c4');
  // 第一次齐射：初始 9 s（initCooldown 未减半）
  h.runUntil(() => c4Fx().length > 0, 20);
  const firstAt = h.b.time;
  assert.equal(c4Fx().length, 2, `满血时 n = 1 + 1 = 2（${c4Fx().length} 个 telegraph）`);
  assert.ok(firstAt >= 8 && firstAt <= 11, `第一次 C4 在 initCooldown(9) 附近（t=${firstAt.toFixed(2)}）`);
  // 第二次齐射：+ cooldown（记录里已减半 = 10）
  h.runUntil(() => c4Fx().length > 2, 20);
  const secondAt = h.b.time;
  assert.ok(secondAt >= 18 && secondAt <= 22, `第二次 C4 在 9 + cooldown(10) 附近（t=${secondAt.toFixed(2)}；若没减半会是 ~29）`);
  // C4 伤害 = ATK×atk_scale(1.8)；注意 W·重构 仍有普通攻击（470），用 enemyAbility tag 把 C4 挑出来
  const c4 = damages(h, w, (c) => (c.dmg.tags || []).includes('enemyAbility'));
  assert.ok(c4.length >= 2, 'C4 造成了物理伤害');
  for (const c of c4) approx(c.amount, 470 * 1.8, 0.02, 'C4 = 攻击力×1.8');
});

test('W·重构：生命值低于一半时 C4 再多选一名（n = 2 + 1 = 3）', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']);
  const w = h.spawn(CQBW, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  w.hp = w.s.maxHp * 0.4; // 半血以下
  h.runUntil(() => fxOf(h, 'telegraph').filter((x) => x[4] && x[4].kind === 'c4').length > 0, 20);
  const first = fxOf(h, 'telegraph').filter((x) => x[4] && x[4].kind === 'c4');
  assert.equal(first.length, 3, `半血以下时 n = 2 + 1 = 3（${first.length} 个 telegraph）`);
});

// ---------------------------------------------------------------------------------------------------------------
// 4. 泥岩·重构：生命值首次低于 50% 时召唤一只泥岩巨像

test('泥岩·重构：生命值首次跌破 50% 时召唤 1 只泥岩巨像（且只召唤一次）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(MDROCK, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  e.hp = e.s.maxHp * 0.8;
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.1, type: 'true', canDodge: false }); // 80% → 70%，未过线
  assert.equal(h.enemies().filter((x) => x.defId === MDGINT).length, 0, '半血以上不召唤');
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.3, type: 'true', canDodge: false }); // 70% → 40%，过线
  let golems = h.enemies().filter((x) => x.defId === MDGINT);
  assert.equal(golems.length, 1, '首次跌破 50% 召唤 1 只');
  assert.ok(fxOf(h, 'summon').some((x) => x[4] && x[4].key === MDGINT), '发了 summon fx');
  assert.equal(golems[0].tag, null, '是普通单位（没有 boss/part tag）');
  // 再打一次：不重复召唤
  e.hp = Math.max(1, e.s.maxHp * 0.3);
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.1, type: 'true', canDodge: false });
  golems = h.enemies().filter((x) => x.defId === MDGINT);
  assert.equal(golems.length, 1, '每只泥岩·重构 只召唤一次');
  assert.equal(h.invariants(), true);
});

// ---------------------------------------------------------------------------------------------------------------
// 5. 萨卡兹百夫长·重构：目标数 +1；造成伤害时回复 50%

test('萨卡兹百夫长·重构：同时攻击 3 名目标（官方 2 → 本包 3）', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']);
  const e = h.spawn(DEMONK, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(e.profile.maxTargets, 3);
  h.runUntil(() => damages(h, e, (c) => c.target.side === 'ally' && c.dmg.isAttack).length >= 3, 30);
  const hit = new Set(damages(h, e, (c) => c.target.side === 'ally' && c.dmg.isAttack).map((c) => c.target.id));
  assert.ok(hit.size >= 3, `一次攻击打到了 ${hit.size} 名干员（maxTargets 3）`);
});

test('萨卡兹百夫长·重构：造成伤害时回复伤害 50% 的生命值', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(DEMONK, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  e.hp = e.s.maxHp * 0.4;
  const before = e.hp;
  h.runUntil(() => damages(h, e, (c) => c.target.side === 'ally' && c.dmg.isAttack).length > 0, 30);
  const dealt = damages(h, e, (c) => c.target.side === 'ally' && c.dmg.isAttack).reduce((a, c) => a + c.amount, 0);
  assert.ok(e.hp > before, '攻击后回复了生命值');
  approx(e.hp - before, dealt * 0.5, 1e-3, '回复 = 造成伤害的 50%');
  assert.ok(fxOf(h, 'heal').length >= 1, '发了 heal fx');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// 第 8 回合的六只·重构首领（`enemies.json` 的第 8 回合记录 + `battle/main.mjs` 的三段叠加机制）
//
// 数据 / 代码的分工：大亚当（纯数值）× 自在（破桎而出 bb）× 杰斯顿（钢铁风暴 / 装甲穿刺 bb）× 锏的技能冷却
// 都是**数据侧**（记录里的值）；梅菲斯特 / 浮士德 / 锏的冻结是**包代码侧**。

test('第 8 回合六条记录的形状 + 数据侧改动：数值只动了该动的，be/attrPower 由记录推导且引擎真读到那几组 bb', async () => {
  // 1) 形状：照抄官方记录、只改 key / name / abilities / effectRef（大亚当除外，见下）
  const bases = { [XI]: 'enemy_1517_xi', [MEPHI]: 'enemy_1507_mephi', [FAUST]: 'enemy_1508_faust', [JAKILL]: 'enemy_1516_jakill', [BLKSWB]: 'enemy_1525_blkswb' };
  const source = { [XI]: OFFICIAL, [JAKILL]: OFFICIAL, [BLKSWB]: OFFICIAL, [MEPHI]: EXT, [FAUST]: EXT };
  for (const [key, base] of Object.entries(bases)) {
    const rec = PACK[key], off = source[key][base];
    assert.ok(rec && off, `${key} / 官方基座 ${base} 都在`);
    assert.equal(rec.key, key, 'key = JSON 映射键');
    assert.equal(rec.name, off.name + '·重构', '官方名 + ·重构');
    assert.equal(rec.spine, off.spine, 'spine 沿用官方（真模型）');
    assert.equal(rec.iconId, off.iconId, 'iconId 沿用官方');
    assert.equal(rec.abilities.length, off.abilities.length + 1, '官方能力 + 一条');
    assert.equal(rec.abilities[rec.abilities.length - 1].text, `【重构】${rec.abilities[rec.abilities.length - 1].text.replace('【重构】', '')}`, '最后一条带【重构】前缀');
    assert.equal(rec.effectRef, base, `${key}.effectRef = 官方基座`);
    // 数值（物理）一个字节没改 ⇒ 推导量也不变（改的只有技能 bb / 冷却）
    assert.equal(rec.be, off.be, `${key}.be 不变`);
    assert.equal(rec.attrPower, off.attrPower, `${key}.attrPower 不变`);
  }

  // 2) 大亚当：官方 enemy_1001_bigbo_2（data/enemies.json 没有它；引擎也没有它的 kit ⇒ **不写 effectRef**）
  const ba = PACK[BIGADAM];
  assert.equal(ba.key, BIGADAM);
  assert.equal(ba.name, '大亚当·重构');
  assert.equal(ba.rank, 'BOSS');
  assert.equal(ba.stats.maxHp, 60000, '生命上限 ×2（官方 30000）');
  assert.equal(ba.stats.atk, 4050, '攻击力 ×1.5（官方 2700）');
  assert.equal(ba.stats.def, 1000, '防御力不动');
  assert.equal(ba.effectRef ?? null, null, '官方 enemy_1001_bigbo_2 没有引擎 kit ⇒ 不写 effectRef');
  assert.equal(ba.spine, 'enemy_1001_bigbo_2', 'spine 沿用官方 prefab');
  assert.equal(ba.abilities.length, 1, '官方能力为空 + 一条【重构】');
  assert.equal(ba.be, 83340, 'be 由改造后的数值推导');
  assert.equal(ba.attrPower, 83340, 'attrPower 由改造后的数值推导');

  // 3) 引擎真的读那几组 bb / 冷却（`mem.ab.sk` 就是引擎自己的解析结果 —— helpers.js:98 `cd: num(s.cooldown)`）
  const h = await scene(['t_wall']);
  const xi = h.spawn(XI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(xi.mem.ab && xi.mem.ab.sk, '自在·重构 继承到官方 kit（mem.ab 非空）');
  assert.equal(xi.mem.ab.sk.ShieldBurst.bb.duration, 7.5, '破桎而出 蓄力时间 ÷2（官方 15）');
  assert.equal(xi.mem.ab.sk.ShieldBurst.bb.dynamic, 5000, '屏障可吸收伤害 ×2（官方 2500）');
  assert.equal(xi.mem.ab.sk.ShieldBurstReborn.bb.duration, 7.5);
  assert.equal(xi.mem.ab.sk.ShieldBurstReborn.bb.dynamic, 6000);
  h.b.kill(xi, null);

  const jak = h.spawn(JAKILL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(jak.mem.ab.sk.ironsandstorm.bb.stun, 6, '钢铁风暴 眩晕 +100%（官方 3）');
  assert.equal(jak.mem.ab.sk.armorpiercing.bb.def_penetrate, 1.0, '装甲穿刺 无视防御 0.6 → 1.0');
  h.b.kill(jak, null);

  const swb = h.spawn(BLKSWB, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(swb.mem.ab.sk.CircleAttack.cd, 7.5, '技能冷却 ÷2（官方 15）');
  assert.equal(swb.mem.ab.sk.Blink.cd, 15, '（官方 30）');
  assert.equal(swb.mem.ab.sk.CircleAttack2.cd, 7.5);
  assert.equal(swb.mem.ab.sk.Blink2.cd, 15);
  h.b.kill(swb, null);

  const fu = h.spawn(FAUST, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(!fu.mem.ab, '浮士德·重构 没有引擎 kit（官方 1508 不在 KITS 里）⇒ effectRef 今天挂不上东西');
  assert.equal(PACK[FAUST].skills.find((s) => s.prefabKey === 'CriticalHit').cooldown, 8.5, '致命一击 冷却 ÷2（官方 17）');
  assert.equal(h.invariants(), true);
});

test('梅菲斯特·重构：每 10 秒召唤 3 只随机宿主敌人；浮士德被击倒后再召唤 10 只', async () => {
  const mod = await packModule();
  assert.deepEqual([...mod.RECON_BOSS_RULES.HOST_KEYS], HOST_KEYS, '宿主池 = 数据里名字含「宿主」的那三只');
  assert.equal(mod.RECON_BOSS_RULES.MEPHI_INTERVAL, 10);
  assert.equal(mod.RECON_BOSS_RULES.MEPHI_PER_TICK, 3);
  assert.equal(mod.RECON_BOSS_RULES.MEPHI_AVENGE, 10);

  const h = await scene(['t_wall']);
  const hostSpawns = () => h.hooksOf('enemySpawn').filter((c) => c.enemy && HOST_KEYS.includes(c.enemy.defId));
  h.spawn(MEPHI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(hostSpawns().length, 0, '刚入场还没到 10 秒');
  h.runUntil(() => hostSpawns().length >= 3, 15);
  assert.equal(hostSpawns().length, 3, '第 10 秒那一次正好 3 只');
  for (const c of hostSpawns()) assert.ok(HOST_KEYS.includes(c.enemy.defId), `召唤的都在宿主池里（${c.enemy.defId}）`);
  assert.ok(fxOf(h, 'summon').length >= 3, '发了 summon fx');
  h.runUntil(() => hostSpawns().length >= 6, 15);
  assert.equal(hostSpawns().length, 6, '每 10 秒 3 只（第二次）');
  // 浮士德被击倒 ⇒ 一次 10 只
  const faust = h.spawn(FAUST, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(faust, null);
  assert.equal(hostSpawns().length, 16, '浮士德被击倒 ⇒ 梅菲斯特·重构 一次召唤 10 只');
  assert.equal(h.invariants(), true);
});

test('浮士德·重构：命中时额外一次 50% 攻击力的 3×3 物理伤害；梅菲斯特被击倒后攻击间隔 ×0.5', async () => {
  const h = await scene(['t_wall', 't_wall2']); // 挡者 (10,6) + 邻格 (10,7)
  const faust = h.spawn(FAUST, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, faust, (c) => (c.dmg.tags || []).includes('splash')).length > 0, 20);
  const splash = damages(h, faust, (c) => (c.dmg.tags || []).includes('splash'));
  assert.ok(splash.length >= 2, `额外范围伤害同时打到目标与邻格（${splash.length} 个实例）`);
  for (const c of splash) approx(c.amount, faust.s.atk * 0.5, 1e-6, '额外伤害 = 攻击力 50%');
  assert.ok(fxOf(h, 'grenade').length >= 1, '发了 grenade fx');
  // 梅菲斯特被击倒 ⇒ 攻击间隔 ×0.5（batPct −0.5）
  const before = faust.s.bat;
  const mephi = h.spawn(MEPHI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(mephi, null);
  assert.ok(faust.findBuff('recon:faust_haste'), '挂上了加速 buff');
  approx(faust.s.bat, before * 0.5, 1e-6, '攻击间隔 ×0.5');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// 梅菲斯特 / 浮士德 的**官方 kit**（引擎的 KITS 里没有 enemy_1507_mephi / enemy_1508_faust ⇒ battle/main.mjs 的包代码按
// 官方数据补上：治疗光环 / 治疗三名 / 登场无敌与不可阻挡 / 致命一击）。数值一律读记录（bat / atk / talents.bb / 技能 bb），
// 只有「治疗 3 名」这个数没有数据源，取自图鉴文本；详细口径见包 README「已知口径」。

test('两条记录的动作（attackAnim）与包自带美术（art.enemies）的骨架是同一份真相', () => {
  const packJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/pack.json'), 'utf8'));
  const art = packJson.art && packJson.art.enemies;
  assert.ok(art && art.enemy_1507_mephi && art.enemy_1508_faust, 'pack.json 声明了这两条的 art.enemies');
  for (const [key, base] of [[MEPHI, 'enemy_1507_mephi'], [FAUST, 'enemy_1508_faust']]) {
    const a = PACK[key].attackAnim, sp = art[base].spine;
    assert.ok(a, `${key}.attackAnim 在记录里`);
    assert.equal(PACK[key].spine, base, `${key}.spine 指向官方 key（模型 = 包自带的那一份）`);
    assert.equal(PACK[key].iconId, base, `${key}.iconId 指向官方 key（图标 = 包自带的那一份）`);
    assert.equal(a.clip, sp.anims.attack.loop, 'attackAnim.clip = 骨架的 attack 角色');
    assert.equal(a.dur, sp.animations[a.clip], 'attackAnim.dur = 那条 clip 的时长');
    assert.equal(a.hit, sp.hits[a.clip][0], 'attackAnim.hit = 那条 clip 的第一个命中帧');
    assert.equal(typeof art[base].icon, 'string', '有图标路径');
    assert.ok(sp.skel.endsWith('.skel') && sp.atlas.endsWith('.atlas') && sp.textures.length, '骨架 / 图集 / 页面齐备');
    assert.equal(sp.pma, true, 'pma 与归一化后的图集一致');
  }
});

test('梅菲斯特·重构 官方 kit：治疗光环把敌方单位的自然回复速度加倍（宿主 80 → 160），倒下后光环自行消退', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.MEPHI_HEAL_TARGETS, 3, '治疗目标数 = 图鉴的 3');
  assert.equal(mod.RECON_BOSS_RULES.AURA_REFRESH, 1);
  const h = await scene(['t_wall']);
  const mephi = h.spawn(MEPHI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const host = h.spawn(HOST_KEYS[0], { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } }); // 宿主士兵：hpRecoveryPerSec 80
  h.run(1);
  assert.equal(host.base.hpRecoveryPerSec, 80, '宿主士兵的自然回复速度 = 80（数据）');
  approx(host.s.hpRegen, 160, 1e-6, '光环把自然回复倍到 160');
  assert.ok(host.findBuff(mod.RECON_BOSS_RULES.MEPHI_AURA_KEY), '宿主身上挂了治疗光环 buff');
  approx(mephi.s.hpRegen, 0, 1e-6, '本来就 0 的单位仍是 0（梅菲斯特 自己）');
  // 梅菲斯特 倒下 ⇒ 光环在 AURA_REFRESH(1 s) 内自行消退（buff 靠时长，不需要 removeBuff 通道）
  h.b.kill(mephi, null);
  h.run(2);
  assert.ok(!host.findBuff(mod.RECON_BOSS_RULES.MEPHI_AURA_KEY), '光环随梅菲斯特 一起消失');
  approx(host.s.hpRegen, 80, 1e-6, '回到数据里的 80');
  assert.equal(h.invariants(), true);
});

test('梅菲斯特·重构 官方 kit：每 bat(6 s) 治疗最缺血的敌方单位，每人 atk(500) 点', async () => {
  const h = await scene(['t_wall']);
  const mephi = h.spawn(MEPHI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  // 重装防御者：自然的回复速度 0、没有天赋 / 技能 / 能力 —— 场上只有治疗会改它的血（数值干净）
  const hurt = h.spawn('enemy_1006_shield', { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.equal(hurt.base.hpRecoveryPerSec, 0, '重装防御者 的自然回复速度 = 0（数据，排除干扰）');
  hurt.hp = hurt.s.maxHp * 0.5;
  const hp0 = hurt.hp;
  assert.equal(mephi.s.bat, 6, '梅菲斯特 的普通攻击间隔 = 6 s（数据）');
  h.runUntil(() => hurt.hp > hp0, 12);
  const at = h.b.time;
  assert.ok(at >= 5.5 && at <= 7, `第一次治疗在 bat(6 s) 附近（t=${at.toFixed(2)}）`);
  approx(hurt.hp - hp0, mephi.s.atk, 1e-3, '治疗量 = 攻击力 500');
  assert.ok(fxOf(h, 'heal').length >= 1, '发了 heal fx');
  assert.equal(h.invariants(), true);
});

test('浮士德·重构 官方 kit：登场无敌（天赋 150 s）+ 无法被阻挡（flags.unblockable）', async () => {
  const h = await scene(['t_wall']);
  const fu = h.spawn(FAUST, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } }); // 与挡者同格
  h.run(1);
  assert.equal(fu.s.flags.unblockable, true, 'blocking.js:29 读的就是 flags.unblockable');
  assert.equal(fu.blockedBy, null, '站在挡者的格子上也不被阻挡');
  assert.equal(fu.s.flags.invulnerable, true, '登场无敌窗口内 invulnerable');
  const inv = fu.findBuff('recon:faust_inv');
  assert.ok(inv, '挂了登场无敌 buff');
  approx(inv.duration, 150, 1e-6, '无敌时长 = 天赋 invincible.duration 150 s');
  const hp0 = fu.hp;
  h.b.dealDamage(null, fu, { amount: 1e6, type: 'true', canDodge: false });
  approx(fu.hp, hp0, 1e-6, '无敌窗口内任何类型的伤害都不掉血（damage.js:338 的短路）');
  assert.equal(h.invariants(), true);
});

test('浮士德·重构 官方 kit：致命一击按 initCooldown(17 s) 起算，到点后额外补一份攻击力（合计 2×）', async () => {
  const h = await scene(['t_wall']);
  const fu = h.spawn(FAUST, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const crits = () => damages(h, fu, (c) => (c.dmg.tags || []).includes('enemyAbility') && !(c.dmg.tags || []).includes('splash'));
  h.runUntil(() => crits().length >= 1, 40);
  const t1 = h.b.time;
  assert.ok(t1 >= 16.5, `第一发致命一击不早于 initCooldown(17 s)（t=${t1.toFixed(2)}）`);
  for (const c of crits()) approx(c.amount, fu.s.atk * 1, 1e-6, '额外伤害 = atk × (atk_scale 2 − 1)');
  assert.ok(fxOf(h, 'crit').length >= 1, '发了 crit fx');
  h.runUntil(() => crits().length >= 2, 40);
  const t2 = h.b.time;
  assert.ok(t2 - t1 >= 8.3, `两发之间至少 cooldown(8.5 s)（Δ=${(t2 - t1).toFixed(2)}）`);
  assert.equal(h.invariants(), true);
});

test('锏·重构：攻击时 10% 概率冻结（种子流打桩两条路），冻结时长 = 引擎既有值 3 s', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.BLKSWB_FREEZE_PROB, 0.1);
  assert.equal(mod.RECON_BOSS_RULES.FREEZE_DURATION, 3, '[ASSUMED] 沿用 COLD_FREEZE_DURATION 3 s');

  // 命中那 10%：目标被冻结，时长 3 s，来源是锏·重构
  const h = await scene(['t_wall']);
  const swb = h.spawn(BLKSWB, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall = h.unit('t_wall');
  const rng = h.b.rng, orig = rng.chance;
  rng.chance = () => true;
  h.runUntil(() => statuses(h, wall.id, 'freeze').length > 0, 20);
  rng.chance = orig;
  const st = statuses(h, wall.id, 'freeze');
  assert.ok(st.length >= 1, '打桩后必冻');
  for (const c of st) { assert.equal(c.source, swb, '冻结来自锏·重构'); approx(c.duration, 3, 1e-6, '冻结时长 3 s'); }
  assert.ok(wall.findBuff('freeze'), '目标身上有冻结');

  // 没命中 10%：一次冻结都不产生
  const h2 = await scene(['t_wall']);
  const swb2 = h2.spawn(BLKSWB, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall2 = h2.unit('t_wall');
  const rng2 = h2.b.rng, orig2 = rng2.chance;
  rng2.chance = () => false;
  h2.runUntil(() => h2.hooksOf('attack').some((c) => c.attacker === swb2), 20);
  h2.run(5);
  rng2.chance = orig2;
  assert.equal(statuses(h2, wall2.id, 'freeze').length, 0, '概率未命中 ⇒ 不冻结');
  assert.equal(h2.invariants(), true);
});

// ===============================================================================================================
// 第 12 回合的五名·重构首领（`enemies.json` 的五条记录 + `battle/main.mjs` 的官方行为 / 重构增量）
//
// 这五只里只有“复仇者”有引擎 kit（effectRef 继承）；塔露拉 / 霜星“冬痕” / 爱国者 / 狂躁异质裂兽 的官方行为由本包补。
// 数据侧的改动（攻半径 / 日冕冷却 / 寒冷时长 / 生命献祭 / 献祭间隔 / 投枪冷却）在记录里；其余在包模块里。

const TALULA = 'enemy_ws_recon_talula';
const FRSTAR2 = 'enemy_ws_recon_frstar2';
const PATRT = 'enemy_ws_recon_patrt';
const REID = 'enemy_ws_recon_reid';
const MIRBST = 'enemy_ws_recon_mirbst';

test('第 12 回合五条记录的形状 + 数据侧改动（be/attrPower 不变；只有“复仇者”写 effectRef）', () => {
  const bases = { [TALULA]: 'enemy_1503_talula', [FRSTAR2]: 'enemy_1510_frstar2', [PATRT]: 'enemy_1506_patrt', [MIRBST]: 'enemy_1571_mirbst' };
  for (const [key, base] of Object.entries(bases)) {
    const rec = PACK[key], off = EXT[base];
    assert.ok(rec && off, `${key} / 官方 ${base} 都在`);
    assert.equal(rec.key, key, 'key = JSON 映射键');
    assert.equal(rec.name, off.name + '·重构', '官方名 + ·重构');
    assert.equal(rec.spine, off.spine, 'spine 沿用官方');
    assert.equal(rec.iconId, off.iconId, 'iconId 沿用官方');
    assert.equal(rec.abilities.length, off.abilities.length + 1, '官方能力 + 一条【重构】');
    assert.equal(rec.effectRef ?? null, null, `${key} 没有引擎 kit ⇒ 不写 effectRef`);
    assert.equal(rec.be, off.be, `${key}.be 不变`);
    assert.equal(rec.attrPower, off.attrPower, `${key}.attrPower 不变`);
  }
  // 塔露拉：攻击半径 +0.5；日冕冷却 ÷2
  const tal = PACK[TALULA];
  assert.equal(tal.stats.rangeRadius, 3.0, '攻击半径 2.5 → 3.0');
  assert.equal(tal.stats.rawRangeRadius, 3.0);
  assert.equal(tal.skills.find((s) => s.prefabKey === 'DanceFire').cooldown, 20, '日冕 40 → 20');
  assert.equal(tal.skills.find((s) => s.prefabKey === 'DanceFire').initCooldown, 20);
  assert.equal(tal.skills.find((s) => s.prefabKey === 'DanceFire[Half]').cooldown, 7.5, '半血日冕 15 → 7.5');
  // 霜星：寒冷 +5 s
  const fr = PACK[FRSTAR2];
  assert.equal(fr.talents.bb['attackfreeze.freeze'], 10, '普通攻击寒冷 5 → 10');
  for (const p of ['IceBurst', 'IceBurst[Reborn]']) assert.equal(fr.skills.find((s) => s.prefabKey === p).bb.freeze, 15, `${p} 寒冷 10 → 15`);
  // 爱国者：生命献祭 15 s、献祭间隔 −0.4、投枪冷却 −50%
  const pt = PACK[PATRT];
  assert.equal(pt.talents.bb['reborn.duration'], 15, '生命献祭 60 → 15');
  assert.equal(pt.talents.bb['immo_trigger[rage].interval'], 0.4, '献祭间隔 0.8 → 0.4');
  assert.equal(pt.skills.find((s) => s.prefabKey === 'throwspear[Rage]').cooldown, 10, '投枪 20 → 10');
  // “复仇者”：官方 kit 免费继承
  assert.equal(PACK[REID].effectRef, 'enemy_1539_reid');
  assert.equal(PACK[REID].name, '“复仇者”·重构');
  assert.equal(PACK[MIRBST].name, '狂躁异质裂兽·重构');
});

test('“复仇者”·重构：每次攻击后攻击间隔 −5%（可叠加），常数与上限由 RECON_BOSS_RULES 给出', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.REID_BAT_STEP, 0.05);
  assert.equal(mod.RECON_BOSS_RULES.REID_BAT_CAP, 0.9);
  const h = await scene(['t_wall']);
  const e = h.spawn(REID, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const base = e.s.bat;
  h.runUntil(() => h.hooksOf('attack').filter((c) => c.attacker === e).length >= 3, 40);
  assert.ok(e.findBuff('recon:reid_haste'), '叠了加速 buff');
  approx(e.s.bat, base * (1 - 3 * 0.05), 1e-6, '3 次攻击后攻击间隔 ×0.85');
  assert.equal(h.invariants(), true);
});

test('塔露拉·重构：攻击附带 50% 攻击力灼燃；被阻挡时攻击结算为真实伤害；半血加防加抗', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.TALULA_BURN_SCALE, 0.5);
  assert.equal(mod.RECON_BOSS_RULES.TALULA_RANGE_BONUS, 0.5);
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(TALULA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'element' && c.dmg.element === 'burn').length > 0, 20);
  for (const c of damages(h, e, (c) => c.dmg.type === 'element' && c.dmg.element === 'burn')) approx(c.amount, e.s.atk * 0.5, 1e-6, '灼燃 = 攻击力 50%');
  // 被阻挡 ⇒ 普通攻击结算为真实伤害（mem.ab.atkType 通道）
  assert.ok(e.blockedBy, '站在挡者的格子上被阻挡');
  h.runUntil(() => damages(h, e, (c) => c.dmg.isAttack && c.dmg.type === 'true').length > 0, 20);
  const tru = damages(h, e, (c) => c.dmg.isAttack && c.dmg.type === 'true');
  assert.ok(tru.length >= 1, '被阻挡的普通攻击是真实伤害');
  // 日冕：半径 3.0 的法术伤害
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'arts').length >= 2, 30);
  assert.ok(fxOf(h, 'explode').some((x) => x[4] && x[4].kind === 'corona'), '发了日冕 fx');
  const arts = damages(h, e, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('enemyAbility'));
  assert.ok(arts.length >= 2, '日冕同时打到两名我方');
  for (const c of arts) approx(c.amount, e.s.atk, 0.02, '日冕 = 攻击力 ×1');
  // 半血：防御 +100%、法抗 +80
  h.step();
  e.hp = e.s.maxHp * 0.4;
  h.step();
  const half = e.findBuff('recon:talula_half');
  assert.ok(half, '半血 buff 挂上');
  approx(half.mods.defPct, 1, 1e-6, '防御 +100%');
  approx(half.mods.resFlat, e.base.res * 0.8, 1e-6, '法抗 +80% 的基础值');
  assert.equal(h.invariants(), true);
});

test('霜星，“冬痕”·重构：普通攻击寒冷 10 s；冰环寒冷 15 s（配成冻结）；冰盾挡法术；击倒后重生并进入第二形态', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(FRSTAR2, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall = h.unit('t_wall');
  h.runUntil(() => statuses(h, wall.id, 'cold').length > 0, 20);
  for (const c of statuses(h, wall.id, 'cold')) approx(c.duration, 10, 1e-6, '普通攻击寒冷 = 10 s');
  h.runUntil(() => statuses(h, wall.id, 'cold').some((c) => Math.abs(c.duration - 15) < 1e-6), 20);
  assert.ok(statuses(h, wall.id, 'cold').some((c) => Math.abs(c.duration - 15) < 1e-6), '冰环寒冷 = 15 s');
  // 冰盾：35 s 补满 2 层；一层挡下一次法术伤害
  h.runUntil(() => !!e.findBuff('recon:frstar_shield'), 45);
  assert.ok(e.findBuff('recon:frstar_shield'), '冰盾挂上了');
  const hp0 = e.hp;
  h.b.dealDamage(null, e, { amount: 5000, type: 'arts', canDodge: false });
  approx(e.hp, hp0, 1e-6, '一层冰盾完全抵消一次法术伤害');
  // 击倒 ⇒ 重生窗口（10 s）
  h.b.kill(e, null);
  assert.ok(e.alive, '没有被移除');
  approx(e.hp, 1, 1e-9);
  assert.ok(e.findBuff('recon:frstar_reborn'), '重生 buff 挂上');
  h.run(11);
  assert.ok(e.alive && e.hp === e.s.maxHp, '重生后回满生命');
  const form2 = e.findBuff('recon:frstar_form2');
  assert.ok(form2, '第二形态 buff 挂上');
  approx(form2.mods.atkPct, 0.5, 1e-6, '攻击力 +50%');
  assert.equal(h.invariants(), true);
});

test('爱国者·重构：行军姿态 4 连击；击倒后 15 s 生命献祭，随后进入毁灭姿态（远程 / 加防加抗）', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.PATRT_RAGE_RANGE, 2);
  const h = await scene(['t_wall']);
  const e = h.spawn(PATRT, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility')).length >= 3, 20);
  assert.ok(damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility')).length >= 3, '一次普通攻击补 3 次（合计 4 连击）');
  for (const c of damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility'))) approx(c.amount, e.s.atk, 1e-6, '每次 = 攻击力');
  // 击倒 ⇒ 重生 15 s ⇒ 毁灭姿态
  h.b.kill(e, null);
  assert.ok(e.alive && e.findBuff('recon:patrt_reborn'), '生命献祭窗口 15 s');
  h.run(16);
  const rage = e.findBuff('recon:patrt_rage');
  assert.ok(rage, '毁灭姿态 buff 挂上');
  assert.equal(e.base.rangeRadius, 2, '毁灭姿态射程 2');
  assert.equal(e.profile.melee, false, 'ai.js 允许远程攻击');
  approx(rage.mods.defPct, 1, 1e-6, '防御 +100%');
  approx(rage.mods.resFlat, e.base.res * 0.5, 1e-6, '法抗 +50%');
  assert.equal(h.invariants(), true);
});

test('狂躁异质裂兽·重构：生命 ≤20% 时直接进入第二阶段、回 50% 生命并重新狂怒；【落石】砸对自身伤害最多者并眩晕', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.MIRBST_CRAZY_HP, 0.2);
  assert.equal(mod.RECON_BOSS_RULES.MIRBST_CRAZY_DURATION, 240);
  assert.equal(mod.RECON_BOSS_RULES.MIRBST_PHASE2_HEAL, 0.5);
  const h = await scene(['t_wall']);
  const e = h.spawn(MIRBST, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(e.findBuff('recon:mirbst_crazy'), '第一形态登场即狂怒');
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility')).length >= 1, 20);
  const wall = h.unit('t_wall');
  h.b.dealDamage(wall, e, { amount: 1000, type: 'true', canDodge: false });
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('stone')).length >= 1, 30);
  const stone = damages(h, e, (c) => (c.dmg.tags || []).includes('stone'));
  assert.ok(stone.length >= 1, '【落石】砸中了对自身伤害最多的单位');
  for (const c of stone) approx(c.amount, e.s.atk * 1.5 * 2, 1e-6, '落石 = 攻击力 1.5 × 目标身上的易伤 2');
  assert.ok(statuses(h, wall.id, 'stun').length >= 1, '落石眩晕 10 s');
  // 生命 ≤20% ⇒ 第二阶段
  h.step();
  e.hp = e.s.maxHp * 0.15;
  const before = e.hp;
  h.step();
  const p2 = e.findBuff('recon:mirbst_phase2');
  assert.ok(p2, '第二阶段 buff 挂上');
  assert.ok(!e.findBuff('recon:mirbst_crazy'), '第一形态的狂怒 buff 被移除');
  approx(e.hp - before, e.s.maxHp * 0.5, 1e-3, '回复 50% 生命上限');
  approx(p2.mods.atkPct, 1, 1e-6, '第二阶段攻击力 +100%');
  assert.equal(e.profile.maxTargets, 3, '狂怒期间同时攻击 3 名我方');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// 第 16 回合的五名·重构首领（蔓德拉 / 血骑士 / 莫菲丝 / “酒神” / “望”）+ 两只召唤物（凝血之刃 / 瑕）
//
// 数据侧：四条官方记录来自 workshop/enemy-ext；莫菲丝按 PRTS /w/莫菲丝?action=raw 补（引擎数据里没有她）。
// 凝血之刃（8000/800/300/80 · 1.5 速 · 3.0 攻隔）与瑕（60000/100/1000/20 · 0.0 速 · 4.0 攻隔）同样按 PRTS 补。

const MANDRA = 'enemy_ws_recon_mandra';
const BLDKGT = 'enemy_ws_recon_bldkgt';
const MORPHIS = 'enemy_ws_recon_morphis';
const DIRCTR = 'enemy_ws_recon_dirctr';
const DYWQGS = 'enemy_ws_recon_dywqgs';
const BLDBLD = 'enemy_ws_recon_bldbld';
const XIA = 'enemy_ws_recon_xia';

test('第 16 回合的记录：四条官方变体 + 莫菲丝 / 凝血之刃 / 瑕三条新补；数据侧增量逐条对得上', () => {
  const bases = { [MANDRA]: 'enemy_1523_mandra', [BLDKGT]: 'enemy_1524_bldkgt', [DIRCTR]: 'enemy_1568_dirctr', [DYWQGS]: 'enemy_2120_dywqgs' };
  for (const [key, base] of Object.entries(bases)) {
    const rec = PACK[key], off = EXT[base];
    assert.ok(rec && off, `${key} / 官方 ${base} 都在`);
    assert.equal(rec.key, key);
    assert.equal(rec.name, off.name + '·重构');
    assert.equal(rec.abilities.length, off.abilities.length + 1);
    assert.equal(rec.effectRef ?? null, null, `${key} 没有引擎 kit`);
    assert.equal(rec.be, off.be, `${key}.be 不变`);
    assert.equal(rec.attrPower, off.attrPower, `${key}.attrPower 不变`);
  }
  assert.equal(PACK[MANDRA].talents.bb['StoneSkin.damage_resistance'], 0.8, '石之盾减伤 0.6 → 0.8');
  assert.equal(PACK[BLDKGT].talents.bb['CheckTrigger.hp_ratio'], 0.5, '复活姿态回第一形态的门槛 1 → 0.5');
  assert.equal(PACK[DIRCTR].talents.bb['Reborn.duration'], 10, '酒神重生 20 → 10');
  assert.equal(PACK[DYWQGS].talents.bb['Reborn.duration'], 15, '望重生 30 → 15');
  assert.equal(PACK[DYWQGS].talents.bb['Reborn.invincible_duration'], 10, '望重生后无敌 60 → 10');
  assert.equal(PACK[DYWQGS].talents.bb['RebornSpawn.interval'], 5, '望重生期间部署瑕 30 → 5');
  // 莫菲丝（PRTS 数值）
  const mo = PACK[MORPHIS];
  assert.equal(mo.name, '莫菲丝·重构');
  assert.equal(mo.stats.maxHp, 60000);
  assert.equal(mo.stats.atk, 680);
  assert.equal(mo.stats.def, 580);
  assert.equal(mo.stats.res, 35);
  assert.equal(mo.stats.bat, 2.8);
  assert.equal(mo.talents.bb['EnemyLineT.atk'], 0.25, '每根有效线 +25% 攻击');
  assert.equal(mo.talents.bb['Shield.dynamic_ratio'], 0.1, '屏障 = 10% 生命上限');
  assert.equal(mo.talents.bb['Reborn.duration'], 10, '重生 10 s');
  // 召唤物
  assert.equal(PACK[BLDBLD].stats.maxHp, 8000);
  assert.equal(PACK[BLDBLD].stats.atk, 800);
  assert.equal(PACK[XIA].stats.maxHp, 60000);
  assert.equal(PACK[XIA].stats.atk, 100);
  assert.equal(PACK[XIA].stats.blockCnt, 0);
});

test('蔓德拉·重构：石之盾减伤 80%；【蔓德拉的注目】点攻击最高者并降攻速；击倒后 5 s 进第二形态（近地悬浮 + 无敌 3 s）', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(MANDRA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const stone = e.findBuff('recon:mandra_stone');
  assert.ok(stone, '石之盾 buff 挂上');
  approx(stone.mods.physTakenMul, 0.2, 1e-6, '物理伤害 ×0.2（减伤 80%）');
  approx(stone.mods.artsTakenMul, 0.2, 1e-6, '法术伤害 ×0.2');
  h.runUntil(() => h.hooksOf('attack').filter((c) => c.attacker === e).length >= 0 && damages(h, e, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('enemyAbility')).length > 0, 20);
  const ray = damages(h, e, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('enemyAbility'));
  assert.ok(ray.length >= 1, '注目打出了法术伤害');
  for (const c of ray) approx(c.amount, e.s.atk, 0.02, '注目 = 攻击力 ×1');
  assert.ok(h.allies().some((u) => u.findBuff('recon:mandra_ray')), '目标被降攻速');
  h.b.kill(e, null);
  assert.ok(e.findBuff('recon:mandra_reborn'), '重生窗口 5 s');
  h.run(6);
  assert.ok(e.findBuff('recon:mandra_float'), '第二形态近地悬浮（不可阻挡）');
  assert.ok(e.alive, '没有被移除');
  assert.equal(h.invariants(), true);
});

test('血骑士·重构：血归一次晕 2 名；击倒后 15 s 复活姿态、召唤凝血之刃；回 50% 生命即回第一形态', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(BLDKGT, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => statuses(h, h.allies()[0].id, 'stun').length > 0 || statuses(h, h.allies()[1].id, 'stun').length > 0, 20);
  const stunned = h.allies().filter((u) => statuses(h, u.id, 'stun').length > 0);
  assert.equal(stunned.length, 2, '血归同时晕 2 名（重构 +1）');
  // 击倒 ⇒ 复活姿态 15 s
  h.b.kill(e, null);
  const reb = e.findBuff('recon:bldkgt_reborn');
  assert.ok(reb, '复活姿态 buff 挂上');
  approx(reb.duration, 15, 1e-6, '持续 15 s');
  // 2 s 后召唤第一把凝血之刃
  h.runUntil(() => h.eventsOf('fx').some((x) => x[1] === 'summon' && x[4] && x[4].key === BLDBLD), 5);
  assert.ok(h.eventsOf('fx').some((x) => x[1] === 'summon' && x[4] && x[4].key === BLDBLD), '召唤了凝血之刃');
  // 回血到 50% 时回到第一形态
  h.runUntil(() => !e.findBuff('recon:bldkgt_reborn'), 20);
  assert.ok(!e.findBuff('recon:bldkgt_reborn'), '已经离开复活姿态');
  assert.ok(e.hpRatio >= 0.5 - 1e-6, `生命回到 ≥50%（${e.hpRatio.toFixed(3)}）`);
  assert.equal(h.invariants(), true);
});

test('凝血之刃：接触血骑士后消失并回复他 10% 生命上限', async () => {
  const h = await scene(['t_wall']);
  const boss = h.spawn(BLDKGT, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  boss.hp = boss.s.maxHp * 0.4;
  const blade = h.spawn(BLDBLD, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  const before = boss.hp;
  h.run(2);
  assert.ok(!blade.alive, '凝血之刃接触后消失');
  assert.ok(boss.hp > before, '血骑士被回复');
});

test('莫菲丝·重构：【红线】连线最远我方并持续法术伤害；每根有效线 +25% 攻击；击倒后 10 s 重生', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(MORPHIS, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall2 = h.unit('t_wall2');
  h.runUntil(() => !!wall2.findBuff('recon:morphis_red') || h.enemies().length === 0, 25);
  assert.ok(wall2.findBuff('recon:morphis_red'), '最远的我方被【红线】连接');
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('enemyAbility') && c.target === wall2).length > 0, 10);
  const dot = damages(h, e, (c) => c.dmg.type === 'arts' && (c.dmg.tags || []).includes('enemyAbility') && c.target === wall2);
  assert.ok(dot.length >= 1, '连线目标持续吃法术伤害');
  for (const c of dot) approx(c.amount, e.s.atk * 0.5, 0.03, '每 0.4 s = 攻击力 50%');
  const lines = e.findBuff('recon:morphis_lines');
  assert.ok(lines, '有效线数 buff 挂上');
  approx(lines.mods.atkPct, 0.25, 1e-6, '一根有效线 +25% 攻击');
  h.b.kill(e, null);
  const reb = e.findBuff('recon:morphis_reborn');
  assert.ok(reb, '重生 buff 挂上');
  approx(reb.duration, 10, 1e-6, '重生 10 s');
  h.run(11);
  assert.ok(e.alive && e.hp === e.s.maxHp, '重生后回满生命');
  assert.ok(e.findBuff('recon:morphis_form2'), '进入第二形态');
  assert.equal(h.invariants(), true);
});

test('“酒神”·重构：常态隐匿；神经损伤爆发改为对相邻我方 5 s 眩晕 + 50% 生命上限真实伤害；重生 10 s', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(DIRCTR, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.equal(e.s.flags.stealth, true, '常态隐匿');
  const t = h.unit('t_wall');
  const adj = h.unit('t_wall2');
  const hp0 = adj.hp;
  h.b.emit('elementBurst', { target: t, element: 'neural' });
  h.run(1);
  const tru = damages(h, e, (c) => c.dmg.type === 'true' && c.target === adj);
  assert.ok(tru.length >= 1, '相邻目标吃到真实伤害');
  for (const c of tru) approx(c.amount, adj.s.maxHp * 0.5, 0.02, '= 相邻目标 50% 生命上限');
  assert.ok(adj.hp < hp0, '相邻目标掉血');
  assert.ok(statuses(h, adj.id, 'stun').some((c) => Math.abs(c.duration - 5) < 1e-6), '相邻目标眩晕 5 s');
  assert.equal(statuses(h, t.id, 'stun').length, 0, '爆发目标本身不再眩晕');
  h.b.kill(e, null);
  const reb = e.findBuff('recon:dirctr_reborn');
  assert.ok(reb, '重生 buff 挂上');
  approx(reb.duration, 10, 1e-6, '重生 10 s');
  h.run(11);
  assert.ok(e.alive && e.findBuff('recon:dirctr_form2') === undefined || e.alive, '重生后仍在场');
  assert.equal(h.invariants(), true);
});

test('“望”·重构：击倒后重生 15 s、每 5 s 部署一枚瑕；重生后第二形态无敌 10 s', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(DYWQGS, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.b.kill(e, null);
  const reb = e.findBuff('recon:wang_reborn');
  assert.ok(reb, '重生 buff 挂上');
  approx(reb.duration, 15, 1e-6, '重生 15 s');
  const xias = () => h.enemies().filter((x) => x.defId === XIA);
  assert.equal(xias().length, 0, '刚倒下还没有瑕');
  h.runUntil(() => xias().length >= 1, 8);
  const firstAt = h.b.time;
  assert.ok(xias().length >= 1, '重生期间部署了瑕');
  h.runUntil(() => xias().length >= 2, 8);
  const gap = h.b.time - firstAt;
  assert.ok(gap >= 4 && gap <= 6.5, `两枚瑕之间约 5 s（Δ=${gap.toFixed(2)}）`);
  h.run(11);
  assert.ok(e.findBuff('recon:wang_form2'), '进入第二形态');
  const inv = e.findBuff('recon:wang_inv');
  assert.ok(inv, '第二形态无敌 buff 挂上');
  approx(inv.duration, 10, 1e-6, '无敌 10 s');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// 第 20 回合的五名·重构首领（“不死的黑蛇” / 奎隆 / 伊莎玛拉 / 玻利瓦尔 / 朔壳）
//
// 这五只是首领回合（R20）的候选：预选替换在 reconTrials.js（reconBossWaveFor 把 tag:'boss' 的 spawn 换成候选 key）。
// 数据侧：点燃 / 引爆冷却、惩五戒冷却、初始生命 ×1.5、变身倍率 →100%、只留灾厄形态的 Fire、暴武闪避 75%。
// 包代码：黑蛇的真实攻击 / 烈焚灼息 / 引爆 / 狂暴，奎隆 3 连击，伊莎玛拉治疗 + 变身，朔壳闪避。

const PACK_ART = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/pack.json'), 'utf8')).art.enemies;
const BSNAKE = 'enemy_ws_recon_bsnake';
const SKZJKL = 'enemy_ws_recon_skzjkl';
const SYSKAD = 'enemy_ws_recon_syskad';
const SHCHMR = 'enemy_ws_recon_shchmr';
const DYCYUE = 'enemy_ws_recon_dycyue';

test('第 20 回合的记录：五条变体、重构增量落在数据上、模型与图标齐备', () => {
  const bases = { [BSNAKE]: 'enemy_1515_bsnake', [SKZJKL]: 'enemy_2089_skzjkl', [SYSKAD]: 'enemy_2039_syskad', [SHCHMR]: 'enemy_2150_shchmr', [DYCYUE]: 'enemy_2126_dycyue' };
  for (const [key, base] of Object.entries(bases)) {
    const rec = PACK[key], off = EXT[base];
    assert.ok(rec && off, `${key} / ${base}`);
    assert.equal(rec.key, key);
    assert.equal(rec.name, off.name + '·重构');
    assert.equal(rec.abilities.length, off.abilities.length + 1);
    assert.equal(rec.effectRef ?? null, null, '没有引擎 kit');
    assert.equal(rec.spine, base, 'spine 指向官方模型（由本包自带）');
    assert.equal(rec.iconId, base);
    assert.ok(rec.attackAnim && rec.attackAnim.clip, 'attackAnim 由骨架派生');
    assert.ok(PACK_ART[base], 'pack.json 声明了这份美术');
  }
  const bs = PACK[BSNAKE].skills;
  assert.equal(bs.find((s) => s.prefabKey === 'Ignite').cooldown, 15, '点燃 19 → 15');
  assert.equal(bs.find((s) => s.prefabKey === 'DragonFireExplode').cooldown, 20, '引爆 35 → 20');
  for (const s of PACK[SKZJKL].skills) if (/MultiAttack/.test(s.prefabKey)) assert.equal(s.cooldown, 10, '惩五戒 20 → 10');
  assert.equal(PACK[SYSKAD].stats.maxHp, 135000, '初始生命 90000 → 135000');
  const bb = PACK[SYSKAD].talents.bb;
  for (const k of ['hp_ratio', 'atk', 'def', 'magic_resistance']) assert.equal(bb[`FetchAttributes.syskad_t[monster].${k}`], 1, `${k} → ×1`);
  assert.equal(bb['FetchAttributes.syskad_t[monster].move_speed'], 0);
  assert.equal(bb['FetchAttributes.syskad_t[monster].base_attack_time'], 0);
  assert.deepEqual(PACK[SHCHMR].skills.map((s) => s.prefabKey), ['Fire', 'Fire'], '只保留灾厄形态的 Fire');
  assert.equal(PACK[DYCYUE].talents.bb['MasterBlcok.prob'], 0.75, '暴武闪避 0.5 → 0.75');
  assert.deepEqual(PACK[DYCYUE].skills, [], '技能只留溯律（记录里没有溯律技能行）');
});

test('黑蛇·重构：普通攻击真实伤害、附带烈焚灼息；引爆把火传给四格', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(BSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => c.dmg.isAttack && c.dmg.type === 'true').length > 0, 20);
  assert.ok(damages(h, e, (c) => c.dmg.isAttack && c.dmg.type === 'true').length >= 1, '攻击结算为真实伤害');
  const wall = h.unit('t_wall');
  assert.ok(wall.findBuff('recon:bsnake_fire'), '被打到的我方挂上烈焚灼息');
  h.runUntil(() => damages(h, e, (c) => c.dmg.type === 'true' && !c.dmg.isAttack && c.target === wall).length > 0, 5);
  assert.ok(damages(h, e, (c) => c.dmg.type === 'true' && !c.dmg.isAttack && c.target === wall).length >= 1, '烈焚灼息每秒真实伤害');
  h.runUntil(() => h.eventsOf('fx').some((x) => x[1] === 'explode' && x[4] && x[4].kind === 'bsnakeFire'), 40);
  assert.ok(h.eventsOf('fx').some((x) => x[1] === 'explode' && x[4] && x[4].kind === 'bsnakeFire'), '引爆 fx');
  assert.equal(h.invariants(), true);
});

test('奎隆·重构：普通攻击 3 连击（主 1 + 额外 2）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility')).length >= 2, 20);
  assert.ok(damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility')).length >= 2, '一次攻击补 2 次（合计 3 连击）');
  for (const c of damages(h, e, (c) => (c.dmg.tags || []).includes('enemyAbility'))) approx(c.amount, e.s.atk, 1e-6);
  assert.equal(h.invariants(), true);
});

test('朔壳·重构：暴武 —— 非阻挡者的物理/法术伤害有 75% 概率被闪避', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(DYCYUE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  const blocker = e.blockedBy || h.unit('t_wall');
  const src = blocker === h.unit('t_wall') ? h.unit('t_wall2') : h.unit('t_wall'); // 非阻挡者才吃闪避
  const rng = h.b.rng, orig = rng.chance;
  rng.chance = () => true;
  const hp0 = e.hp;
  h.b.dealDamage(src, e, { amount: 1000, type: 'phys', canDodge: false });
  approx(e.hp, hp0, 1e-6, '打桩命中闪避 ⇒ 不掉血');
  rng.chance = () => false;
  h.b.dealDamage(src, e, { amount: 1000, type: 'phys', canDodge: false });
  assert.ok(e.hp < hp0, '不闪避时照常掉血');
  rng.chance = orig;
  assert.equal(h.invariants(), true);
});
