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

// ---- 第 8 回合的四只 ----
const BIGADAM = 'enemy_ws_recon_bigadam';
const XI = 'enemy_ws_recon_xi';
const JAKILL = 'enemy_ws_recon_jakill';
const BLKSWB = 'enemy_ws_recon_blkswb';
/** 官方记录：data/enemies.json（自在 / 杰斯顿 / 锏）。 */
const OFFICIAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/enemies.json'), 'utf8'));

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
  // C4 冷却与官方一致（数据已还原为官方原值，不再减半）
  const wC4 = PACK[CQBW].skills.find((s) => s.prefabKey === 'C4');
  const offC4 = OFF['enemy_1504_cqbw'].skills.find((s) => s.prefabKey === 'C4');
  assert.equal(wC4.cooldown, offC4.cooldown, 'C4 cooldown = 官方原值');
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
// 3. W·重构：本包自有的 C4（额外 1 名目标）

test('W·重构：C4 按记录的 initCooldown 起算、cooldown 重置，每次锁 1(+1) 名目标', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']); // 挡者 + 两名在射程 2.5 内（距离 1、2）
  const w = h.spawn(CQBW, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const c4Fx = () => fxOf(h, 'telegraph').filter((x) => x[4] && x[4].kind === 'c4');
  // 第一次齐射：初始 9 s（initCooldown 未减半）
  h.runUntil(() => c4Fx().length > 0, 20);
  const firstAt = h.b.time;
  assert.equal(c4Fx().length, 2, `满血时 n = 1 + 1 = 2（${c4Fx().length} 个 telegraph）`);
  assert.ok(firstAt >= 8 && firstAt <= 11, `第一次 C4 在 initCooldown(9) 附近（t=${firstAt.toFixed(2)}）`);
  // 第二次齐射：+ cooldown（官方原值 = 20）
  h.runUntil(() => c4Fx().length > 2, 25);
  const secondAt = h.b.time;
  assert.ok(secondAt >= 27 && secondAt <= 32, `第二次 C4 在 9 + cooldown(20) 附近（t=${secondAt.toFixed(2)}）`);
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

test('第 8 回合四条记录的形状 + 数据还原为官方原值：be/attrPower 由记录推导且引擎真读到那几组 bb', async () => {
  // 1) 形状：照抄官方记录、只改 key / name / abilities / effectRef（大亚当除外，见下）
  const bases = { [XI]: 'enemy_1517_xi', [JAKILL]: 'enemy_1516_jakill', [BLKSWB]: 'enemy_1525_blkswb' };
  for (const [key, base] of Object.entries(bases)) {
    const rec = PACK[key], off = OFFICIAL[base];
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
  assert.equal(ba.stats.maxHp, 30000, '生命上限 = 官方原值 30000');
  assert.equal(ba.stats.atk, 2700, '攻击力 = 官方原值 2700');
  assert.equal(ba.stats.def, 1000, '防御力不动');
  assert.equal(ba.effectRef ?? null, null, '官方 enemy_1001_bigbo_2 没有引擎 kit ⇒ 不写 effectRef');
  assert.equal(ba.spine, 'enemy_1001_bigbo_2', 'spine 沿用官方 prefab');
  assert.equal(ba.abilities.length, 1, '官方能力为空 + 一条【重构】');
  assert.equal(ba.be, 46590, 'be 由官方原值推导');
  assert.equal(ba.attrPower, 46590, 'attrPower 由官方原值推导');

  // 3) 引擎真的读那几组 bb / 冷却（`mem.ab.sk` 就是引擎自己的解析结果 —— helpers.js:98 `cd: num(s.cooldown)`）
  const h = await scene(['t_wall']);
  const xi = h.spawn(XI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.ok(xi.mem.ab && xi.mem.ab.sk, '自在·重构 继承到官方 kit（mem.ab 非空）');
  assert.equal(xi.mem.ab.sk.ShieldBurst.bb.duration, 15, '破桎而出 蓄力时间 = 官方原值 15');
  assert.equal(xi.mem.ab.sk.ShieldBurst.bb.dynamic, 2500, '屏障可吸收伤害 = 官方原值 2500');
  assert.equal(xi.mem.ab.sk.ShieldBurstReborn.bb.duration, 15);
  assert.equal(xi.mem.ab.sk.ShieldBurstReborn.bb.dynamic, 3000);
  h.b.kill(xi, null);

  const jak = h.spawn(JAKILL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(jak.mem.ab.sk.ironsandstorm.bb.stun, 3, '钢铁风暴 眩晕 = 官方原值 3');
  assert.equal(jak.mem.ab.sk.armorpiercing.bb.def_penetrate, 0.6, '装甲穿刺 = 官方原值 0.6');
  h.b.kill(jak, null);

  const swb = h.spawn(BLKSWB, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(swb.mem.ab.sk.CircleAttack.cd, 15, '技能冷却 = 官方原值 15');
  assert.equal(swb.mem.ab.sk.Blink.cd, 30, '（官方 30）');
  assert.equal(swb.mem.ab.sk.CircleAttack2.cd, 15);
  assert.equal(swb.mem.ab.sk.Blink2.cd, 30);
  h.b.kill(swb, null);

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
// 第 12 回合的·重构首领（`enemies.json` 的“复仇者”记录）
//
// 其余四只（塔露拉 / 霜星“冬痕” / 爱国者 / 狂躁异质裂兽）的重构版已整体移除、等重新制作；
// 它们的数据侧改动（攻半径 / 日冕冷却 / 寒冷时长 / 生命献祭 / 献祭间隔 / 投枪冷却）也随记录一并移除。

const REID = 'enemy_ws_recon_reid';

test('第 12 回合的记录：“复仇者”·重构 免费继承官方 kit', () => {
  assert.equal(PACK[REID].key, REID);
  assert.equal(PACK[REID].name, '“复仇者”·重构');
  assert.equal(PACK[REID].effectRef, 'enemy_1539_reid');
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
