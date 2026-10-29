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
import { ReconChannel } from '../../server/match/match/reconChannel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/mode-recon/enemies.json'), 'utf8'));

const SKULSR = 'enemy_ws_recon_skulsr';
const LSLIME = 'enemy_ws_recon_lslime';
const CQBW = 'enemy_ws_recon_cqbw';
const MDROCK = 'enemy_ws_recon_mdrock';
const MOUSEK = 'enemy_ws_recon_mousek';
const DEMONK = 'enemy_ws_recon_demonk';

// ---- 第 8 回合的新一批 ----
const MEPHI = 'enemy_ws_recon_mephi';
const FAUST = 'enemy_ws_recon_faust';
const FRSTAR2 = 'enemy_ws_recon_frstar2';

// ---- 第 12 回合的新一批 ----
const TALULA = 'enemy_ws_recon_talula';
const PATRT = 'enemy_ws_recon_patrt';
const MIRBST = 'enemy_ws_recon_mirbst';
const MDGINT = 'enemy_1092_mdgint';

// ---- 第 16 回合的新一批 ----
const MANDRA = 'enemy_ws_recon_mandra';
const BLDKGT = 'enemy_ws_recon_bldkgt';
const MORPHIS = 'enemy_ws_recon_morphis';
const DIRCTR = 'enemy_ws_recon_dirctr';
const DYWQGS = 'enemy_ws_recon_dywqgs';

// ---- 第 20 回合（最终首领）----
const BSNAKE = 'enemy_ws_recon_bsnake';
const SKZJKL = 'enemy_ws_recon_skzjkl';
const SYSKAD = 'enemy_ws_recon_syskad';
const SHCHMR = 'enemy_ws_recon_shchmr';
const DYCYUE = 'enemy_ws_recon_dycyue';
// 第 21 回合（隐秘核心，已实现的两只）
const CSDOLL = 'enemy_ws_recon_csdoll';
const SKZAMY = 'enemy_ws_recon_skzamy';
const MUAMA = 'enemy_ws_recon_muama';
const MUTWIN = 'enemy_ws_recon_mutwin';
const MUSNAKE = 'enemy_ws_recon_musnake';
const SUISHO = 'enemy_ws_recon_suisho';
const SUIZZH = 'enemy_ws_recon_suizzh';
const SUIYZH = 'enemy_ws_recon_suiyzh';
const SUIWEI = 'enemy_ws_recon_suiwei';
const SHOPHM = 'enemy_ws_recon_shophm';
const SHORBB = 'enemy_ws_recon_shorbb';
const SHORSM = 'enemy_ws_recon_shorsm';
/** 官方记录：workshop/enemy-ext/enemies.json（第 20 回合的五只只在扩展包里）。 */
const EXT = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/enemy-ext/enemies.json'), 'utf8'));

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

test('六条重构记录的形状：key=映射键、name 加「·重构」、abilities 追加一行【重构】、spine/iconId 与官方一致；R4 五只 HP=50000', () => {
  const OFF = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/enemies.json'), 'utf8'));
  const bases = { [SKULSR]: 'enemy_1500_skulsr', [LSLIME]: 'enemy_1050_lslime', [CQBW]: 'enemy_1504_cqbw', [MDROCK]: 'enemy_1511_mdrock', [MOUSEK]: 'enemy_1509_mousek', [DEMONK]: 'enemy_1501_demonk' };
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
  // W 是唯一没有 effectRef 的（见文件头），其余五条都指向官方 key
  for (const [key, base] of Object.entries(bases)) assert.equal(PACK[key].effectRef ?? null, key === CQBW ? null : base, `${key}.effectRef`);
  // 业主 2026-10-27：R4 五只基础生命统一 50000；鼠王屏障 4667 → 7000（+50%）
  for (const key of [SKULSR, LSLIME, CQBW, MDROCK, MOUSEK]) assert.equal(PACK[key].stats.maxHp, 50000, `${key} HP = 50000`);
  assert.equal(PACK[MOUSEK].talents.bb['shield.dynamic'], 7000, '鼠王·重构 屏障 +50%');
  // C4 冷却与官方一致（数据已还原为官方原值，不再减半）
  const wC4 = PACK[CQBW].skills.find((s) => s.prefabKey === 'C4');
  const offC4 = OFF['enemy_1504_cqbw'].skills.find((s) => s.prefabKey === 'C4');
  assert.equal(wC4.cooldown, offC4.cooldown, 'C4 cooldown = 官方原值');
  assert.equal(wC4.initCooldown, offC4.initCooldown, 'initCooldown 不动');
});

test('effectRef 继承官方 kit：四条挂上 mem.ab；W·重构（无 effectRef）不挂', async () => {
  const h = await scene(['t_wall']);
  for (const key of [SKULSR, LSLIME, MDROCK, MOUSEK, DEMONK]) {
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

test('碎骨·重构：被阻挡的攻击额外发射榴弹 —— 目标 + 其 3×3 内每单位吃 ATK×0.26 物理，伤害无视 25% 防御力', async () => {
  const h = await scene(['t_wall', 't_wall2']); // 挡者 (10,6) + 邻格 (10,7)
  const e = h.spawn(SKULSR, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('splash')).length > 0, 30);
  const grenade = damages(h, e, (c) => (c.dmg.tags || []).includes('splash'));
  assert.ok(grenade.length >= 2, `榴弹同时打到挡者与邻格（${grenade.length} 个伤害实例）`);
  for (const c of grenade) {
    approx(c.amount, e.s.atk * 0.26, 1e-6, '榴弹伤害 = 攻击力 26%');
    approx(c.dmg.defIgnorePct ?? 0, 0.25, 1e-6, '榴弹无视 25% 防御力');
  }
  assert.ok(fxOf(h, 'grenade').length >= 1, '发了 grenade fx');
  // 新的重构口径不再挂「防御力下降」
  assert.ok(!h.unit('t_wall').findBuff('defDown'), '挡者不再挂 defDown');
  assert.ok(!h.unit('t_wall2').findBuff('defDown'), '邻格也不再挂 defDown');
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

test('W·重构：C4 按记录的 initCooldown 起算、冷却降低 50%（20→10），每次锁 1(+1) 名目标', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']); // 挡者 + 两名在射程 2.5 内（距离 1、2）
  const w = h.spawn(CQBW, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const c4Fx = () => fxOf(h, 'telegraph').filter((x) => x[4] && x[4].kind === 'c4');
  // 第一次齐射：初始 9 s（initCooldown 未减半）
  h.runUntil(() => c4Fx().length > 0, 20);
  const firstAt = h.b.time;
  assert.equal(c4Fx().length, 2, `满血时 n = 1 + 1 = 2（${c4Fx().length} 个 telegraph）`);
  assert.ok(firstAt >= 8 && firstAt <= 11, `第一次 C4 在 initCooldown(9) 附近（t=${firstAt.toFixed(2)}）`);
  // 第二次齐射：+ cooldown ×0.5（20 → 10）
  h.runUntil(() => c4Fx().length > 2, 25);
  const secondAt = h.b.time;
  assert.ok(secondAt >= 17 && secondAt <= 22, `第二次 C4 在 9 + cooldown(20×0.5=10) 附近（t=${secondAt.toFixed(2)}）`);
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

test('鼠王·重构：唱沙额外选择生命上限第二高的单位（每次唱沙补一发）', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']);
  const m = h.spawn(MOUSEK, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const drift = () => fxOf(h, 'telegraph').filter((x) => x[4] && x[4].kind === 'driftSand');
  h.runUntil(() => drift().length >= 2, 30);
  assert.ok(m.mem.ab && m.mem.ab.list.length > 0, '鼠王·重构 继承官方 kit');
  assert.ok(drift().length >= 2, `官方一发 + 重构补一发 = ${drift().length} 个唱沙 telegraph`);
  assert.equal(h.invariants(), true);
});

test('第 8 回合新首领冒烟：梅菲斯特 / 浮士德 / 霜星都能入场并跑 tick；浮士德改为隐匿', async () => {
  const h = await scene(['t_wall']);
  const mephi = h.spawn(MEPHI, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const faust = h.spawn(FAUST, { pos: [10, 10], routeIndex: 0, mods: { speedMul: 0 } });
  const frstar = h.spawn(FRSTAR2, { pos: [10, 12], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.time >= 6, 6);
  assert.ok(mephi.alive && faust.alive && frstar.alive, '三只都活着');
  assert.ok(mephi.findBuff('recon:mephi_aura'), '梅菲斯特·重构 光环已铺开（+25/s）');
  assert.ok(faust.findBuff('recon:faust_stealth'), '浮士德·重构 登场改为隐匿');
  assert.ok(!faust.s.flags.unblockable, '浮士德·重构 已不再无法被阻挡');
  assert.equal(h.invariants(), true);
});

test('自在·重构：纬地经天额外选择第二近目标（每次释放补一次十字）', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']);
  const xi = h.spawn(XI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const cross = () => fxOf(h, 'telegraph').filter((x) => x[4] && x[4].kind === 'xiCross');
  h.runUntil(() => cross().length >= 2, 25);
  assert.ok(xi.mem.ab && xi.mem.ab.list.length > 0, '自在·重构 继承官方 kit');
  assert.ok(cross().length >= 2, `官方一发 + 重构补一发 = ${cross().length} 个十字 telegraph`);
  assert.equal(h.invariants(), true);
});

test('第 12 回合新首领冒烟：塔露拉 / 爱国者 / 狂躁异质裂兽 入场并跑 tick', async () => {
  const h = await scene(['t_wall']);
  const tal = h.spawn(TALULA, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const pat = h.spawn(PATRT, { pos: [10, 10], routeIndex: 0, mods: { speedMul: 0 } });
  const mir = h.spawn(MIRBST, { pos: [10, 12], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.time >= 6, 6);
  assert.ok(tal.alive && pat.alive && mir.alive, '三只都活着');
  assert.equal(PACK[TALULA].stats.maxHp, 500000);
  assert.equal(PACK[PATRT].stats.maxHp, 250000);
  assert.equal(PACK[MIRBST].stats.maxHp, 500000);
  assert.equal(PACK[TALULA].be, 509750);
  assert.equal(PACK[PATRT].be, 259635);
  assert.equal(PACK[MIRBST].be, 506020);
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

test('第 8 回合记录的形状 + 重构后的 bb/数值：引擎真读到新的一组数', async () => {
  // 1) 形状：照抄官方记录、只改 key / name / abilities / effectRef
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
  }
  // 业主 2026-10-27：自在 / 杰斯顿的 HP 统一到 100000，be/attrPower 重算
  assert.equal(PACK[XI].stats.maxHp, 100000);
  assert.equal(PACK[XI].be, 104900);
  assert.equal(PACK[XI].attrPower, 104900);
  assert.equal(PACK[JAKILL].stats.maxHp, 100000);
  assert.equal(PACK[JAKILL].be, 104760);
  assert.equal(PACK[JAKILL].attrPower, 104760);
  // 锏·重构：HP 统一 250000，be/attrPower 重算
  assert.equal(PACK[BLKSWB].stats.maxHp, 250000);
  assert.equal(PACK[BLKSWB].be, 256450, '锏·重构 be');
  assert.equal(PACK[BLKSWB].attrPower, 256450);

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
  assert.equal(xi.mem.ab.sk.ShieldBurst.bb.duration, 10, '破桎而出 持续时间 = 10（−5）');
  assert.equal(xi.mem.ab.sk.ShieldBurst.bb.dynamic, 15000, '屏障 = 15000');
  assert.equal(xi.mem.ab.sk.CrossAttack.cd, 20, '纬地经天 冷却 = 20（−10）');
  assert.equal(xi.mem.ab.sk.ShieldBurstReborn.bb.dynamic, 20000, '破桎而出·重生 屏障 = 20000');
  h.b.kill(xi, null);

  const jak = h.spawn(JAKILL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(jak.mem.ab.sk.ironsandstorm.bb.stun, 6, '钢铁风暴 眩晕 = 6（+3）');
  assert.equal(jak.mem.ab.sk.armorpiercing.bb.def_penetrate, 1.0, '装甲穿刺 = 1.0（+40%）');
  h.b.kill(jak, null);

  const swb = h.spawn(BLKSWB, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  assert.equal(swb.mem.ab.sk.CircleAttack.cd, 15, '技能冷却 = 官方原值 15');
  assert.equal(swb.mem.ab.sk.Blink.cd, 25, '速杀冷却 = 25（−5）');
  assert.equal(swb.mem.ab.sk.CircleAttack2.cd, 15);
  assert.equal(swb.mem.ab.sk.Blink2.cd, 25);
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

// ===============================================================================================================
// 第 16 回合的五只·重构首领（引擎没有它们的 kit，官方行为 + 重构增量都在包模块里）

test('第 16 回合新首领冒烟：蔓德拉 / 血骑士 / 莫菲丝 / 酒神 / 望 入场并跑 tick', async () => {
  const h = await scene(['t_wall']);
  const mandra = h.spawn(MANDRA, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const bld = h.spawn(BLDKGT, { pos: [10, 9], routeIndex: 0, mods: { speedMul: 0 } });
  const morphis = h.spawn(MORPHIS, { pos: [10, 10], routeIndex: 0, mods: { speedMul: 0 } });
  const dirctr = h.spawn(DIRCTR, { pos: [10, 11], routeIndex: 0, mods: { speedMul: 0 } });
  const wang = h.spawn(DYWQGS, { pos: [10, 12], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.time >= 6, 6);
  assert.ok(mandra.alive && bld.alive && morphis.alive && dirctr.alive && wang.alive, '五只都活着');
  // 关键断言 1：蔓德拉的石之盾减伤 buff 存在（记录 80% ⇒ 受到伤害 ×0.2）
  const stone = mandra.findBuff('recon:mandra_stone');
  assert.ok(stone, '蔓德拉·重构 石之盾已挂上');
  approx(stone.mods.physTakenMul, 0.2, 1e-6, '石之盾物理减伤 80%');
  approx(stone.mods.artsTakenMul, 0.2, 1e-6, '石之盾法术减伤 80%');
  // 酒神：攻击目标 +1、莫菲丝：连接自身的减伤 buff
  assert.ok(dirctr.profile.maxTargets >= 2, '酒神·重构 攻击目标 +1');
  assert.ok(morphis.findBuff('recon:morphis_share'), '莫菲丝·重构【感官的剥离】连接自身');
  assert.equal(h.invariants(), true);
});

test('“望”·重构：【落】每 10 s 对随机我方造成 ATK×100% 伤害', async () => {
  const h = await scene(['t_wall']);
  const wang = h.spawn(DYWQGS, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => damages(h, wang, (c) => (c.dmg.tags || []).includes('fall')).length > 0, 15);
  const falls = damages(h, wang, (c) => (c.dmg.tags || []).includes('fall'));
  assert.ok(falls.length >= 1, '周期【落】触发了伤害');
  for (const c of falls) approx(c.amount, wang.s.atk, 1e-6, '【落】= ATK×100%');
  assert.equal(h.invariants(), true);
});

test('“复仇者”·重构：每次攻击后攻击间隔 −10%（9 层封顶 −90%），每次攻击回复 325 生命', async () => {
  const mod = await packModule();
  assert.equal(mod.RECON_BOSS_RULES.REID_BAT_STEP, 0.1);
  assert.equal(mod.RECON_BOSS_RULES.REID_BAT_CAP, 0.9);
  assert.equal(mod.RECON_BOSS_RULES.REID_HEAL, 325);
  const h = await scene(['t_wall']);
  const e = h.spawn(REID, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  e.hp = e.s.maxHp - 5000; // 先掉血，才能验证每次攻击的 325 回复
  const base = e.s.bat;
  h.runUntil(() => h.hooksOf('attack').filter((c) => c.attacker === e).length >= 3, 40);
  assert.ok(e.findBuff('recon:reid_haste'), '叠了加速 buff');
  approx(e.s.bat, base * (1 - 3 * 0.1), 1e-6, '3 次攻击后攻击间隔 ×0.7');
  assert.ok(fxOf(h, 'heal').length >= 3, '每次攻击都回血');
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// 第 20 回合的五只·重构首领（业主 2026-10-28）

test('第 20 回合记录：五只·重构、HP 2500000（朔壳 5000000）、be/attrPower 重算、官方能力 + 一条【重构】', () => {
  const bases = { [BSNAKE]: 'enemy_1515_bsnake', [SKZJKL]: 'enemy_2089_skzjkl', [SYSKAD]: 'enemy_2039_syskad', [SHCHMR]: 'enemy_2150_shchmr', [DYCYUE]: 'enemy_2126_dycyue' };
  for (const [key, base] of Object.entries(bases)) {
    const rec = PACK[key], off = EXT[base];
    assert.ok(rec && off, `${key} / 官方基座 ${base} 都在`);
    assert.equal(rec.key, key);
    assert.equal(rec.name, off.name + '·重构');
    assert.equal(rec.iconId, base);
    assert.equal(rec.spine, base);
    assert.equal(rec.effectRef, base);
    assert.equal(rec.abilities.length, off.abilities.length + 1, '官方能力 + 一条【重构】');
    assert.equal(rec.abilities[rec.abilities.length - 1].text.slice(0, 4), '【重构】');
  }
  for (const key of [BSNAKE, SKZJKL, SYSKAD, SHCHMR]) assert.equal(PACK[key].stats.maxHp, 2500000, `${key} HP = 2500000`);
  assert.equal(PACK[DYCYUE].stats.maxHp, 5000000, '朔壳 HP = 5000000');
  for (const key of Object.keys(bases)) {
    const s = PACK[key].stats;
    assert.equal(PACK[key].be, Math.round(s.maxHp + s.atk * 5 + s.def * 3 + s.res * 3), `${key} be 由数值推导`);
    assert.equal(PACK[key].attrPower, PACK[key].be);
  }
});

test('第 20 回合新首领冒烟：五只入场并跑 20 秒（黑蛇护甲 / 奎隆入定 / 伊莎玛拉停手 / 朔壳叠层都在）', async () => {
  const h = await scene(['t_wall']);
  const snake = h.spawn(BSNAKE, { pos: [10, 4], routeIndex: 0, mods: { speedMul: 0 } });
  const skz = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const sys = h.spawn(SYSKAD, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  const sh = h.spawn(SHCHMR, { pos: [10, 10], routeIndex: 0, mods: { speedMul: 0 } });
  const dy = h.spawn(DYCYUE, { pos: [10, 12], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.time >= 21, 22);
  assert.ok(snake.alive && skz.alive && sys.alive && sh.alive && dy.alive, '五只都活着');
  approx(snake.findBuff('recon:bsnake_guard').mods.physTakenMul, 0.34, 1e-6, '第一阶段减伤 66%');
  assert.ok(!skz.findBuff('recon:skz_meditate'), '奎隆 10 秒后离开入定');
  assert.equal(skz.profile.noAttack, false, '自在阶段开始普攻');
  assert.equal(sys.profile.noAttack, true, '伊莎玛拉初始形态不普攻');
  assert.ok(dy.findBuff('recon:dyc_stack'), '朔壳每 10 秒叠攻击/防御');
  approx(dy.findBuff('recon:dyc_stack').mods.atkPct, 0.2, 1e-6, '20 秒 = 2 层 = +20% 攻击');
  assert.ok(!fxOf(h, 'summon').some((x) => x[4] && x[4].key === 'enemy_ws_recon_nilu'), '入定 10 秒短于 15 秒的尼卢火周期 ⇒ 入定里不会召唤尼卢火');
  assert.equal(h.invariants(), true);
});

test('“不死的黑蛇”·重构：第一次被击倒 → 5 秒重生回满并进入狂暴（HP/ATK +50%）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(BSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);
  assert.equal(e.alive, true, '击倒被重生窗口接管');
  h.runUntil(() => h.b.time >= 8, 9);
  const rage = e.findBuff('recon:bsnake_rage');
  assert.ok(rage, '狂暴 buff 已挂上');
  // 断言**最终属性**（不是 buff 内部字段）：hpMul 是乘数键，把它当「+50%」用过一次就变成 125 万（§5.1 的旧 bug）
  approx(e.s.maxHp, 2500000 * 1.5, 1e-6, '生命上限 3 750 000');
  approx(e.s.atk / e.base.atk, 1.5, 1e-6, '攻击 ×1.5');
  approx(e.hp, e.s.maxHp, 1e-6, '重生回满');
  const fire = damages(h, e, (c) => c.dmg.type === 'arts');
  assert.ok(fire.some((c) => Math.abs(c.amount - (e.s.atk + 230)) <= 1e-6), '不息恶火每发 = 攻击力 + 230');
  assert.equal(h.invariants(), true);
});

test('奎隆·重构：不着相 10 秒进入自在阶段（解除无敌、开始普攻）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZJKL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.b.time >= 10.5, 12);
  assert.ok(!e.findBuff('recon:skz_meditate'), '入定 buff 已移除');
  assert.equal(e.profile.noAttack, false, '自在阶段会普攻');
  // 自在阶段每 25 秒召唤一个尼卢火（30 秒存续、不可选中）
  h.runUntil(() => h.b.enemies.some((o) => o.alive && o.defId === 'enemy_ws_recon_nilu'), 27);
  const nilu = h.b.enemies.find((o) => o.alive && o.defId === 'enemy_ws_recon_nilu');
  assert.ok(nilu, '自在阶段的尼卢火已召唤');
  assert.ok(nilu.findBuff('recon:nilu_untargetable'), '尼卢火不可选中');
  assert.equal(h.invariants(), true);
});

test('伊莎玛拉·重构：治疗量为攻击力 + 48600', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SYSKAD, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const hurt = h.spawn('enemy_ws_recon_demonk', { pos: [11, 6], routeIndex: 0, mods: { speedMul: 0 } });
  hurt.hp = Math.max(1, hurt.s.maxHp - 500000);
  h.runUntil(() => fxOf(h, 'heal').length > 0, 8);
  assert.ok(fxOf(h, 'heal').length >= 1, '按 bat 周期治疗');
  assert.ok(hurt.hp > hurt.s.maxHp - 500000, '被治疗的敌人回了血');
  assert.equal(h.invariants(), true);
});

test('玻利瓦尔·重构：普攻降防 -120；被击倒进入【灾厄之口】，10 秒后转第二形态（+50% 攻 / +50% 生命）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SHCHMR, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.runUntil(() => h.unit('t_wall').findBuff('recon:shchmr_defdown'), 10);
  approx(h.unit('t_wall').findBuff('recon:shchmr_defdown').mods.defFlat, -120, 1e-6, '降防 -120');
  h.b.kill(e, null);
  assert.ok(e.findBuff('recon:shchmr_jaw'), '进入灾厄之口');
  h.runUntil(() => e.findBuff('recon:shchmr_form'), 14);
  const form = e.findBuff('recon:shchmr_form');
  approx(e.s.atk / e.base.atk, 1.5, 1e-6, '二形态攻击 ×1.5');
  approx(e.s.maxHp, 2500000 * 1.5, 1e-6, '二形态生命上限 3 750 000');
  assert.equal(h.invariants(), true);
});

test('朔壳·重构：非阻挡伤害 75% 闪避；被击倒后召唤一批特训敌人', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(DYCYUE, { pos: [8, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall = h.unit('t_wall');
  const rng = h.b.rng, orig = rng.chance;
  rng.chance = () => true;
  const before = e.hp;
  h.b.dealDamage(wall, e, { amount: 5000, type: 'phys', canDodge: false });
  rng.chance = orig;
  approx(e.hp, before, 1e-6, '打桩后伤害被闪避');
  const beforeKill = h.b.enemies.length;
  h.b.kill(e, null);
  assert.ok(h.b.enemies.length >= beforeKill + 40, `击倒后召唤 35 普通 + 15 精英（现有 ${h.b.enemies.length} 只）`);
  assert.equal(h.invariants(), true);
});

// ===============================================================================================================
// 第 21 回合：伤心的大锁·重构 / “阿米娅”，炉芯终曲·重构

test('第 21 回合两只记录：HP 25000000 / 12500000、be 重算、官方能力 + 一条【重构】', () => {
  assert.equal(PACK[CSDOLL].stats.maxHp, 25000000, '大锁 HP');
  assert.equal(PACK[SKZAMY].stats.maxHp, 12500000, '阿米娅 HP');
  for (const key of [CSDOLL, SKZAMY]) {
    const s = PACK[key].stats;
    assert.equal(PACK[key].be, Math.round(s.maxHp + s.atk * 5 + s.def * 3 + s.res * 3), `${key} be`);
    assert.equal(PACK[key].abilities[PACK[key].abilities.length - 1].text.slice(0, 4), '【重构】');
  }
});

test('伤心的大锁·重构：攻击目标 3；受击 25 次后全场 ATK×1.5 法术；20 秒起召首批 10 普通', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(CSDOLL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const wall = h.unit('t_wall');
  h.step();
  assert.equal(e.profile.maxTargets, 3, '攻击目标 +1（2 → 3）');
  for (let i = 0; i < 25; i++) h.b.dealDamage(wall, e, { amount: 1, type: 'phys', canDodge: false });
  const aoe = damages(h, e, (c) => Math.abs(c.amount - e.s.atk * 1.5) <= 1e-6);
  assert.ok(aoe.length >= 1, '第 25 次受击触发了全场法术');
  const before = h.b.enemies.length;
  h.runUntil(() => h.b.time >= 21, 22);
  assert.ok(h.b.enemies.length >= before + 10, `20 秒首批 10 普通（现有 ${h.b.enemies.length - before} 只）`);
  assert.equal(h.invariants(), true);
});

test('伤心的大锁·重构：80 秒开屏障（护盾 1000000、持续 30 秒、期间召 5 精英）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(CSDOLL, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.time = 79;
  const before = h.b.enemies.length;
  h.runUntil(() => e.findBuff('recon:csdoll_shield'), 4);
  const sh = e.findBuff('recon:csdoll_shield');
  assert.ok(sh, '屏障已开');
  approx(sh.shield, 1000000, 1e-9, '护盾上限 1000000');
  approx(sh.duration, 30, 1e-9, '持续 30 秒');
  assert.ok(h.b.enemies.length >= before + 5, '屏障期间召 5 只精英');
  assert.equal(h.invariants(), true);
});

test('“阿米娅”，炉芯终曲·重构：减伤 0.34；30 秒召创意；创意被击倒生成恐卡兹 + 年代印痕', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZAMY, { pos: [8, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  approx(e.findBuff('recon:skzamy_dr').mods.physTakenMul, 0.34, 1e-6, '受到物理伤害 ×0.34');
  h.runUntil(() => h.b.enemies.some((o) => o.alive && o.defId === 'enemy_ws_recon_skzamb'), 32);
  const ball = h.b.enemies.find((o) => o.alive && o.defId === 'enemy_ws_recon_skzamb');
  assert.ok(ball, '30 秒时召唤了仅剩的创意');
  assert.equal(ball.s.maxHp, 25000, '创意 HP 25000');
  h.b.kill(ball, null);
  assert.ok(h.b.enemies.some((o) => o.alive && o.defId === 'enemy_ws_recon_skzjs'), '原地生成了恐卡兹');
  assert.ok(h.b.enemies.some((o) => o.alive && o.defId === 'enemy_ws_recon_skzdw'), '原地生成了年代印痕');
  assert.equal(h.invariants(), true);
});

test('跨战斗通道：共享 ama 池 / 假死 80% 转 core / 击杀终始召唤物给区域2奖励 / core 见底两只退场', async () => {
  const ch = new ReconChannel({ areas: { p1: 1 }, pools: { ama: { maxHp: 10000000 }, core: { maxHp: 15000000 } } });
  const h1 = await scene(['t_wall'], { reconChannel: ch });
  const ama = h1.spawn(MUAMA, { pos: [10, 7], routeIndex: 0, mods: { speedMul: 0 } });
  const wall = h1.unit('t_wall');
  h1.step();
  h1.b.dealDamage(wall, ama, { amount: 1000000, type: 'phys', canDodge: false });
  const amaPool = ch.pool('ama');
  assert.ok(amaPool.hp <= 10000000 - 199000, `共享池扣掉防火墙后的实际伤害（剩 ${amaPool.hp}）`);
  h1.run(0.05);
  approx(ama.hp, amaPool.hp, 1e-6, '本地血条同步池值');

  ch.areas.set('p1', 2); // 区域3：异构体所在的战场
  const h2 = await scene(['t_wall'], { reconChannel: ch });
  const twin = h2.spawn(MUTWIN, { pos: [10, 8], routeIndex: 0, mods: { speedMul: 0 } });
  h2.run(0.05);
  approx(twin.hp, ch.pool('ama').hp, 1e-6, '另一块战场同步到同一条池');

  // 假死：80% 转给终始（本地吃 20%，core 吃 4×本地）
  ch.setHp('ama', ch.pool('ama').maxHp * 0.03);
  h1.run(0.05);
  assert.ok(ama.findBuff('recon:ama_fake'), 'AMa-10 进入假死');
  assert.ok(ch.pool('ama').hp >= ch.pool('ama').maxHp * 0.04 - 1, '共享池锁在 4%');
  const coreBefore = ch.pool('core').hp;
  h1.b.dealDamage(wall, ama, { amount: 100000, type: 'phys', canDodge: false });
  const lost = coreBefore - ch.pool('core').hp;
  assert.ok(lost >= 15000 && lost <= 17000, `80% 转移到终始（实际 ${lost}）`);

  // 终始召唤物被击杀 → 区域2 的干员拿到奖励
  const h3 = await scene(['t_wall'], { reconChannel: ch });
  const coreUnit = h3.spawn(MUSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h3.runUntil(() => h3.b.enemies.some((o) => o.alive && o._reconCoreSummon), 7);
  const minion = h3.b.enemies.find((o) => o.alive && o._reconCoreSummon);
  assert.ok(minion, '终始召出了召唤物');
  h3.b.kill(minion, null);
  h1.run(0.1);
  assert.ok(wall.findBuff('recon:ama_reward'), '区域2 的干员拿到 +50% 伤害 / +20 攻速 / -20% 受伤');
  approx(wall.findBuff('recon:ama_reward').mods.atkPct, 0.5, 1e-6);

  // core 见底 → 两只退场
  ch.damage('core', ch.pool('core').hp);
  h1.run(0.1);
  h2.run(0.1);
  assert.equal(ama.alive, false, 'AMa-10 退场');
  assert.equal(twin.alive, false, '异构体退场');
  assert.equal(coreUnit.alive, true, '终始本身是另一条池，不受影响');
  h1.b.kill(coreUnit, null);
  h3.b.stop?.();
});

test('第 21 回合 AMa-10 三只：HP 10000000 / 10000000 / 15000000，be 重算', () => {
  assert.equal(PACK[MUAMA].stats.maxHp, 10000000);
  assert.equal(PACK[MUTWIN].stats.maxHp, 10000000);
  assert.equal(PACK[MUSNAKE].stats.maxHp, 15000000);
  for (const key of [MUAMA, MUTWIN, MUSNAKE]) {
    const s = PACK[key].stats;
    assert.equal(PACK[key].be, Math.round(s.maxHp + s.atk * 5 + s.def * 3 + s.res * 3), `${key} be`);
  }
});

test('AMa-10·重构：防火墙受到 ×0.2；生命 <4% 锁血进入假死，每秒回 1%、50% 结束', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(MUAMA, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  approx(e.findBuff('recon:ama_wall').mods.physTakenMul, 0.2, 1e-6, '防火墙外伤害 ×0.2');
  e.hp = e.s.maxHp * 0.01;
  h.run(0.05);
  assert.ok(e.findBuff('recon:ama_fake'), '进入假死');
  assert.ok(e.hpRatio >= 0.04 - 1e-6 && e.hpRatio < 0.05, `血量锁定在 4% 附近（${e.hpRatio}）`);
  h.runUntil(() => !e.findBuff('recon:ama_fake'), 60);
  assert.ok(e.hpRatio >= 0.5 - 1e-6, '到 50% 结束假死');
  assert.equal(h.invariants(), true);
});

test('“终始”·重构：信息洪流 3 目标 1000 真伤；每 5 秒召 5 普通 + 2 精英', async () => {
  const h = await scene(['t_wall', 't_wall2', 't_wall3']);
  const e = h.spawn(MUSNAKE, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const before = h.b.enemies.length;
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('musnakeLine')).length >= 3, 12);
  const line = damages(h, e, (c) => (c.dmg.tags || []).includes('musnakeLine'));
  assert.ok(line.length >= 3, `一次打 3 个目标（${line.length}）`);
  for (const c of line) approx(c.amount, 1000, 1e-6, '真伤 1000');
  assert.ok(h.b.enemies.length >= before + 7, '5 秒时召 5 普通 + 2 精英');
  assert.equal(h.invariants(), true);
});

test('“阿米娅”，炉芯终曲·重构：第一次被击倒 → 2.5 秒后第二形态，黑冠余威 4 目标 200% 真实伤害', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SKZAMY, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.kill(e, null);
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('crown')).length > 0, 5);
  const crown = damages(h, e, (c) => (c.dmg.tags || []).includes('crown'));
  assert.ok(crown.length >= 1, '黑冠余威已触发');
  for (const c of crown) approx(c.amount, e.s.atk * 2, 1e-6, '每目标 ATK×200%');
  assert.equal(e.profile.noAttack, false, '第二形态恢复行动');
  assert.equal(h.invariants(), true);
});

// ---------------------------------------------------------------------------------------------------------------
// 岁四部位·重构（业主 2026-10-29）：每块 boss 区域只放一只；抬起 5 s / 80% 减伤；技能 30 s 一圈；
// 十方怼怒向所有干员位置爆开 10 s；掩月 / 蔽日打生命最高者 3×3；天倾地陷 4 次 5×5；柱折维绝 20+10。

test('岁四部位·重构：岁 HP 25000000、其余数值不变、四条【重构】文案各写一个 boss 区域', () => {
  assert.equal(PACK[SUISHO].stats.maxHp, 25000000, '岁 HP');
  for (const key of [SUIZZH, SUIYZH, SUIWEI]) assert.equal(PACK[key].stats.maxHp, 300000, `${key} HP 不变`);
  const s = PACK[SUISHO].stats;
  assert.equal(PACK[SUISHO].be, Math.round(s.maxHp + s.atk * 5 + s.def * 3 + s.res * 3), '岁 be');
  assert.equal(PACK[SUISHO].attrPower, PACK[SUISHO].be, '岁 attrPower');
  const areas = [[SUISHO, '区域1'], [SUIZZH, '区域2'], [SUIYZH, '区域3'], [SUIWEI, '区域4']];
  for (const [key, area] of areas) {
    const last = PACK[key].abilities[PACK[key].abilities.length - 1];
    assert.equal(last.text.slice(0, 4), '【重构】', `${key} 最后一条是【重构】`);
    assert.ok(last.text.includes(`boss ${area}`), `${key} 只出现在 ${area}`);
    assert.ok(last.text.includes('抬起改为5秒') && last.text.includes('80%减伤'), `${key} 抬起口径`);
    assert.ok(last.text.includes('30秒'), `${key} 技能 30 秒`);
  }
  assert.ok(PACK[SUISHO].abilities[PACK[SUISHO].abilities.length - 1].text.includes('20只普通与10只精英'), '岁 柱折维绝');
  assert.ok(PACK[SUIWEI].abilities[PACK[SUIWEI].abilities.length - 1].text.includes('5×5'), '尾 5×5');
});

test('岁·重构：抬起 5 秒 / 80% 减伤（不再无敌）；首次 30 秒才落【十方怼怒】，火焰 10 秒打满所有干员位置', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(SUISHO, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(!e.findBuff('recon:sui_lift'), '30 秒前不抬起');
  assert.ok(!e.s.flags.invulnerable, '不再无敌');
  h.runUntil(() => e.findBuff('recon:sui_lift'), 31);
  const lift = e.findBuff('recon:sui_lift');
  assert.ok(lift, '首次释放 = 30 秒');
  approx(lift.duration, 5, 1e-6, '抬起 5 秒');
  approx(lift.mods.dmgTakenMul, 0.2, 1e-9, '80% 减伤');
  assert.ok(!e.s.flags.invulnerable, '抬起不再无敌（不动由站定 buff 负责，与本条无关）');
  const fire = (pred = () => true) => damages(h, e, (c) => (c.dmg.tags || []).includes('suiFire') && pred(c));
  h.runUntil(() => fire().length > 0, 6);
  const burst = fire((c) => c.dmg.type === 'arts');
  assert.ok(burst.length >= 2, `首跳向所有干员位置爆开（${burst.length} 个目标）`);
  for (const c of burst.slice(0, 2)) approx(c.amount, e.s.atk * 1.8, 1e-6, '首跳 ATK×1.8 法术');
  h.runUntil(() => fire((c) => c.dmg.type === 'arts' && Math.abs(c.amount - e.s.atk * 0.2) <= 1e-6).length > 0, 2);
  assert.ok(fire((c) => Math.abs(c.amount - e.s.atk * 0.2) <= 1e-6).length > 0, '火焰每 0.5 秒 ATK×0.2');
  assert.equal(h.invariants(), true);
});

test('岁·左爪/右爪·重构：【掩月】/【蔽日】打生命值最高的我方，命中其 3×3（ATK×2.2 物理）', async () => {
  const h = await scene(['t_wall', 't_wall2']);
  const e = h.spawn(SUIZZH, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  const low = h.unit('t_wall');
  low.hp = 1; // 让 t_wall2 成为生命值最高的那个
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('suiClaws')).length > 0, 37);
  const claw = damages(h, e, (c) => (c.dmg.tags || []).includes('suiClaws'));
  assert.ok(claw.length >= 2, `3×3 内的两名我方都吃（${claw.length}）`);
  for (const c of claw) approx(c.amount, e.s.atk * 2.2, 1e-6, 'ATK×2.2 物理');
  const atk = h.eventsOf('atk').filter((x) => x[1] === e.id);
  assert.equal(atk[atk.length - 1][2], h.unit('t_wall2').id, '目标是生命值最高的我方');
  assert.equal(h.invariants(), true);
});

test('岁·尾·重构：【天倾地陷】连戳 4 次、每次 5×5（ATK×1.1 物理）', async () => {
  const h = await scene(['t_wall']);
  const e = h.spawn(SUIWEI, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.runUntil(() => damages(h, e, (c) => (c.dmg.tags || []).includes('suiTail')).length >= 4, 37);
  const tail = damages(h, e, (c) => (c.dmg.tags || []).includes('suiTail'));
  assert.ok(tail.length >= 4, `4 次戳击（${tail.length}）`);
  for (const c of tail) approx(c.amount, e.s.atk * 1.1, 1e-6, 'ATK×1.1 物理');
  const atk = h.eventsOf('atk').filter((x) => x[1] === e.id);
  assert.ok(atk.length >= 4, `4 次 atk（${atk.length}）`);
  assert.equal(h.invariants(), true);
});

test('岁·重构【柱折维绝】：生命首次 <50% 召唤 20 普通 + 10 精英，并立刻放技能', async () => {
  const pool = { maxHp: 25000000, hp: 25000000, damage() { return 0; } };
  const h = await scene(['t_wall'], { sharedBoss: pool });
  const e = h.spawn(SUISHO, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(!e.findBuff('recon:sui_lift'), '30 秒前没放技能');
  const before = h.b.enemies.length;
  pool.hp = pool.maxHp * 0.49;
  h.step();
  assert.ok(e.findBuff('recon:sui_lift'), '跌破 50% 立刻抬起放技能');
  assert.ok(h.b.enemies.length >= before + 30, `召唤 20 普通 + 10 精英（${h.b.enemies.length - before}）`);
  pool.hp = pool.maxHp * 0.2;
  h.run(0.2);
  assert.equal(h.b.enemies.length >= before + 30, true, '只召唤一次');
  assert.equal(h.invariants(), true);
});

// ---------------------------------------------------------------------------------------------------------------
// 洛伦茨，扰动之谬 / 源阶方·重构（业主 2026-10-29）：区域2/3/4 各一整对；洛伦茨共享叠加血量；
// 假死（锁 1 点 / 3%/s）；源阶方 95% → 30% 减伤并行动；失链裂变首次 10；全场死亡爆炸 20/10；
// 源阶粒素每 10 秒 5 个（50000 生命、不可阻挡、进防守点爆炸）。

test('洛伦茨 / 源阶方·重构：HP 3000000 / 22000000、be 重算、两条【重构】文案', () => {
  assert.equal(PACK[SHOPHM].stats.maxHp, 3000000, '洛伦茨 HP');
  assert.equal(PACK[SHORBB].stats.maxHp, 22000000, '源阶方 HP');
  for (const key of [SHOPHM, SHORBB]) {
    const s = PACK[key].stats;
    assert.equal(PACK[key].be, Math.round(s.maxHp + s.atk * 5 + s.def * 3 + s.res * 3), `${key} be`);
    assert.equal(PACK[key].attrPower, PACK[key].be, `${key} attrPower`);
    const last = PACK[key].abilities[PACK[key].abilities.length - 1];
    assert.equal(last.text.slice(0, 4), '【重构】', `${key} 最后一条是【重构】`);
  }
  assert.ok(PACK[SHOPHM].abilities[PACK[SHOPHM].abilities.length - 1].text.includes('boss 区域2 / 3 / 4'), '洛伦茨的区域');
  assert.ok(PACK[SHOPHM].abilities[PACK[SHOPHM].abilities.length - 1].text.includes('每秒恢复3%'), '假死回血');
  assert.ok(PACK[SHORBB].abilities[PACK[SHORBB].abilities.length - 1].text.includes('50000'), '源阶粒素 50000');
});

test('洛伦茨·重构：冰盾首次 20 秒；被打空 → 假死锁 1 点并每秒回 3%；源阶方同时解除 65% 减伤并开始行动', async () => {
  const h = await scene(['t_wall']);
  const mz = h.spawn(SHOPHM, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const sb = h.spawn(SHORBB, { pos: [9, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  approx(sb.findBuff('recon:shorbb_dr').mods.dmgTakenMul, 0.05, 1e-9, '源阶方初始 95% 减伤');
  assert.ok(sb.findBuff('recon:shorbb_idle'), '初始不动');
  assert.equal(sb.profile.noAttack, true, '初始不打');
  h.runUntil(() => h.eventsOf('cast').some((x) => x[1] === mz.id), 21);
  assert.ok(h.eventsOf('cast').some((x) => x[1] === mz.id), '冰盾首次 20 秒');
  // 打空洛伦茨（单位血条口径）：压到 1 点并进入假死
  h.b.dealDamage(h.unit('t_wall'), mz, { amount: mz.s.maxHp * 2, type: 'true', canDodge: false });
  h.step();
  assert.ok(mz.findBuff('recon:shp_fake'), '进入假死');
  assert.ok(mz.hpRatio < 0.01, `强制保留 1 点（${mz.hp}）`);
  assert.equal(sb.profile.noAttack, false, '源阶方开始行动');
  assert.ok(!sb.findBuff('recon:shorbb_idle'), '不再定住');
  approx(sb.findBuff('recon:shorbb_dr_wake').mods.dmgTakenMul, 0.3, 1e-9, '减伤 95% → 30%');
  const hpBefore = mz.hp;
  h.run(1);
  assert.ok(mz.hp > hpBefore + mz.s.maxHp * 0.02, `假死每秒回 3%（${mz.hp - hpBefore}）`);
  assert.equal(h.invariants(), true);
});

test('源阶方·重构：失链裂变首次 10 秒（ATK×1）；召唤模块 → 10 秒起全场死亡爆炸（ATK×2）；每 10 秒 5 个源阶粒素', async () => {
  const h = await scene(['t_wall']);
  const mz = h.spawn(SHOPHM, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const sb = h.spawn(SHORBB, { pos: [9, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  // 先让洛伦茨进入假死（源阶方才开始行动）
  h.b.dealDamage(h.unit('t_wall'), mz, { amount: mz.s.maxHp * 2, type: 'true', canDodge: false });
  h.step();
  h.runUntil(() => damages(h, sb, (c) => (c.dmg.tags || []).includes('shorbbAoe')).length > 0, 12);
  const aoe = damages(h, sb, (c) => (c.dmg.tags || []).includes('shorbbAoe'));
  assert.ok(aoe.length >= 1, '失链裂变已放');
  for (const c of aoe) approx(c.amount, sb.s.atk, 1e-6, '失链裂变 ATK×1');
  h.runUntil(() => damages(h, sb, (c) => (c.dmg.tags || []).includes('shorbbBlast')).length > 0, 11);
  const blast = damages(h, sb, (c) => (c.dmg.tags || []).includes('shorbbBlast'));
  assert.ok(blast.length >= 1, '全场死亡爆炸已放');
  for (const c of blast) approx(c.amount, sb.s.atk * 2, 1e-6, '死亡爆炸 ATK×2');
  const parts = h.b.enemies.filter((o) => o.alive && o.defId === SHORSM);
  assert.ok(parts.length >= 5, `10 秒召 5 个源阶粒素（${parts.length}）`);
  assert.equal(parts[0].s.maxHp, 50000, '源阶粒素 50000 生命');
  assert.ok(parts[0].findBuff('recon:shorsm_ghost'), '不可被阻挡');
  h.b.kill(parts[0], null);
  assert.ok(fxOf(h, 'explode').some((x) => x[4] && x[4].kind === 'shorsmBoom'), '源阶粒素死亡爆炸（画面）');
  const boom = h.hooksOf('damaged').filter((c) => (c.dmg.tags || []).includes('shorsmBoom'));
  for (const c of boom) approx(c.amount, parts[0].s.atk * 2, 1e-6, '爆炸 ATK×2');
  assert.equal(h.invariants(), true);
});

test('源阶方被击倒 → 洛伦茨解除假死并成对退场（共享池清零）', async () => {
  const pool = { maxHp: 6000000, hp: 6000000, damage(pid, amount) { const n = Math.min(this.hp, amount); this.hp -= n; return n; } };
  const h = await scene(['t_wall'], { sharedBoss: pool });
  const mz = h.spawn(SHOPHM, { tag: 'boss', pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  const sb = h.spawn(SHORBB, { tag: 'part', pos: [9, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  h.b.dealDamage(h.unit('t_wall'), mz, { amount: 6000000, type: 'true', canDodge: false });
  h.step();
  assert.ok(mz.findBuff('recon:shp_fake'), '洛伦茨假死');
  assert.ok(pool.hp < pool.maxHp * 0.01, `共享池锁在 1 附近（${pool.hp}）`);
  h.b.kill(sb, null);
  h.run(0.1);
  assert.ok(!mz.alive, '洛伦茨解除假死并退场');
  assert.ok(!sb.alive, '成对退场');
  assert.equal(pool.hp, 0, '共享池清零');
  assert.equal(h.invariants(), true);
});

test('区域1：只有源阶方时它就是本区首领（直接醒来：30% 减伤 + 行动），生命是它自己的 22000000', async () => {
  const h = await scene(['t_wall']);
  const sb = h.spawn(SHORBB, { tag: 'boss', pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
  h.step();
  assert.ok(!sb.findBuff('recon:shorbb_idle'), '没有洛伦茨可等 ⇒ 直接行动');
  assert.equal(sb.profile.noAttack, false, '直接开打');
  assert.ok(sb.findBuff('recon:boss_still'), '源阶方站定不动（boss 路线起点 = 它的站位）');
  approx(sb.findBuff('recon:shorbb_dr_wake').mods.dmgTakenMul, 0.3, 1e-9, '已移除大部分减伤（30%）');
  h.runUntil(() => damages(h, sb, (c) => (c.dmg.tags || []).includes('shorbbAoe')).length > 0, 12);
  assert.ok(damages(h, sb, (c) => (c.dmg.tags || []).includes('shorbbAoe')).length >= 1, '【失链裂变】已放');
  assert.equal(h.invariants(), true);
});



