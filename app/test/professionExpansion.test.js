// test/professionExpansion.test.js — 「职业分支扩展」前置 mod 的三条契约（`workshop/profession-expansion/`）。
//
// 这份测试钉住的是**失败方向全是静默**的三件事：
//
//   1. **显示**：`profName(profession, rec)` 的回退序 —— 官方闭表 →（记录自带的 `professionName` 的译名）→ 裸 id。
//      官方那张闭表（`PROF_NAME`，8 条）不认识新职业，于是记录必须自带名字；**最后退回裸 id 而不是空串**，因为
//      空串在界面上会凭空少一截且看不出哪里错。
//   2. **引擎**：官方 8 职业之外的新职业 / 新分支**本来就能加**（`server/sim/professions.js` 的
//      `PROFESSION_DEFAULTS` 与 `SUB` 都不是枚举校验）—— 未知职业退回 `WARRIOR` 基础形态、记录自己的
//      `attackKind` / `dmgType` / … 盖过预设；未知分支**没有预设行为、也不报错**（行为归消费包）。
//   3. **包本身**：`loadWorkshop` 收得下这个只有 `i18n` 的包；`professions.json` 里的**每一个名字**在 4 个语种里
//      都有译文，且没有多余的键（有一处漏译就是「英文客户端上冒出中文」，静默）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { profName, PROF_NAME } from '../public/js/ui/loadoutModel.js';
import { resolveProfile, PROFESSION_DEFAULTS, KNOWN_SUBPROFESSIONS } from '../server/sim/professions.js';
import { loadWorkshop } from '../server/workshop.js';
import { loadData } from '../server/data.js';
import { canPlace } from '../server/match/board.js';
import { subProfIconUrl } from '../public/js/ui/assetUrls.js';
import { t } from '../shared/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK_DIR = join(ROOT, 'workshop', 'profession-expansion');
const DATA_DIR = join(ROOT, 'data');
const WORKSHOP_DIR = join(ROOT, 'workshop');
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const readPack = (rel) => JSON.parse(fs.readFileSync(join(PACK_DIR, ...rel.split('/')), 'utf8'));
const PACK_JSON = readPack('pack.json');
const VOCAB = readPack('professions.json');

/** 挂在**官方【术师】**下的那条新分支（巡援术师）—— 与「新职业」分开一块写。 */
const OFFICIAL = VOCAB.officialBranches;
/** 13 个中文名字（4 个新职业 + 各 2 个分支 + 官方术师下的巡援术师）：译文键就是它们。 */
const NAMES = [...VOCAB.professions.flatMap((p) => [p.name, ...p.branches.map((b) => b.name)]), ...OFFICIAL.map((b) => b.name)];
/** 词汇表里出现过的整段文本（分支特性）：本包也给它译文（客户端按 msgid 查得到就翻）。 */
const TEXTS = OFFICIAL.map((b) => b.trait);
/** 译文文件里应当**正好**有的键：名字 + 整段文本 —— 多一个少一个都是漂移。 */
const I18N_KEYS = [...NAMES, ...TEXTS];
/** 全部新 id（职业 + 分支）—— 它们必须在引擎两张表**之外**，否则「新」就名不副实。 */
const NEW_PROFESSION_IDS = VOCAB.professions.map((p) => p.id);
const NEW_BRANCH_IDS = VOCAB.professions.flatMap((p) => p.branches.map((b) => b.id));

describe('profName: 官方闭表 → 记录自带的名字 → 裸 id', () => {
  test('官方职业照旧走闭表（任何语种都由 t() 决定）', () => {
    assert.equal(profName('SNIPER'), t(PROF_NAME.SNIPER));
    assert.equal(profName('CASTER'), t(PROF_NAME.CASTER));
  });

  test('新职业用记录自带的 professionName 渲染（不是空白）', () => {
    for (const p of VOCAB.professions) {
      const rec = { profession: p.id, professionName: p.name };
      assert.equal(profName(p.id, rec), t(p.name), `${p.id} 应显示 ${p.name} 的译名`);
      assert.notEqual(profName(p.id, rec), '', `${p.id} 不许渲染成空白`);
    }
  });

  test('没有记录 / 记录没带名字时退回裸 id（也绝不空白）', () => {
    assert.equal(profName('CHRONOMANCER'), 'CHRONOMANCER');
    assert.equal(profName('CHRONOMANCER', {}), 'CHRONOMANCER');
    assert.equal(profName('CHRONOMANCER', null), 'CHRONOMANCER');
  });

  test('官方闭表优先于记录自带的同名字段', () => {
    assert.equal(profName('SNIPER', { professionName: '某个别的名字' }), t(PROF_NAME.SNIPER));
    assert.equal(profName('sniper', { professionName: 'x' }), t(PROF_NAME.SNIPER), 'id 大小写不敏感');
  });

  test('没有职业的棋子（profession 缺失 / 空串）→ 空串', () => {
    assert.equal(profName(''), '');
    assert.equal(profName(null), '');
    assert.equal(profName(undefined), '');
  });
});

describe('引擎本来就能加官方没有的职业 / 分支（本包的地基）', () => {
  test('这 4 个新职业 id 不在 PROFESSION_DEFAULTS 里（所以「新」是真的）', () => {
    for (const id of NEW_PROFESSION_IDS) {
      assert.equal(Object.hasOwn(PROFESSION_DEFAULTS, id), false, `${id} 不该在官方职业表里`);
    }
  });

  test('这 8 个新分支 id 不在引擎的 SUB 表里（行为因此归消费包）', () => {
    for (const id of NEW_BRANCH_IDS) {
      assert.equal(KNOWN_SUBPROFESSIONS.includes(id), false, `${id} 不该在官方分支表里`);
    }
  });

  test('未知职业 + 没有形态字段 ⇒ 退回 WARRIOR 基础形态（近战 / 物理），不报错', () => {
    const p = resolveProfile({ profession: 'CHRONOMANCER' });
    assert.equal(p.attack, 'melee');
    assert.equal(p.dmgType, 'phys');
  });

  test('记录自己的形态字段盖过职业预设（新职业与官方同形的唯一条件）', () => {
    // 时术师：远程 / 法术 / 可对空（照 professions.json 的 base 写）
    const chrono = resolveProfile({ profession: 'CHRONOMANCER', attackKind: 'ranged', dmgType: 'arts', projectile: 'bolt', canHitFly: true });
    assert.equal(chrono.attack, 'ranged');
    assert.equal(chrono.dmgType, 'arts');
    assert.equal(chrono.projectile, 'bolt');
    assert.equal(chrono.canHitFly, true);
    // 追踪者：远程 / 物理 / 优先低防
    const tracker = resolveProfile({ profession: 'TRACKER', attackKind: 'ranged', dmgType: 'phys', projectile: 'arrow', canHitFly: true, targetPriority: 'lowDef' });
    assert.equal(tracker.attack, 'ranged');
    assert.equal(tracker.priority, 'lowDef');
    // 协奏者：不普通攻击（attackKind 'none' 折成 noAttackUnlessSkill）
    const conductor = resolveProfile({ profession: 'CONDUCTOR', attackKind: 'none', dmgType: 'heal' });
    assert.equal(conductor.noAttackUnlessSkill, true, 'attackKind none ⇒ 只在技能期间攻击');
  });

  test('未知分支是**惰性**的：不给任何预设行为，也不报错', () => {
    // 官方【凝滞师】slow 分支会带 onHitStatus；同名的新分支 id（滞时术师）在 SUB 表外 ⇒ 什么都不加
    const official = resolveProfile({ profession: 'SUPPORT', subProf: 'slower' });
    assert.ok(official.onHitStatus, '官方 slower 分支确实带命中减速');
    for (const id of NEW_BRANCH_IDS) {
      const p = resolveProfile({ profession: 'CASTER', subProf: id });
      assert.equal(p.onHitStatus, undefined, `${id}: 引擎不该凭空给它行为`);
      assert.equal(p.sub, id, '但 profile 记下是哪个分支（供消费包判断）');
    }
  });
});

describe('包本身：前置包，4 语种 13 个名字 + 特性文本一个不缺', () => {
  test('professions.json 是词汇表，不是引擎读的数据文件（不在 pack.json 的 content 里）', () => {
    assert.equal(Object.hasOwn(PACK_JSON, 'content'), false, '本包不改变任何游戏数据');
    assert.equal(Object.hasOwn(PACK_JSON, 'client'), false, '本包没有客户端代码');
    assert.equal(Object.hasOwn(PACK_JSON, 'server'), false, '本包没有服务端代码');
    assert.deepEqual(Object.keys(PACK_JSON.i18n).sort(), [...LANGS].sort(), '只声明这 4 个语种的译文');
    assert.equal(NAMES.length, 13, '4 职业 + 8 分支 + 官方术师下的巡援术师');
  });

  test('每个名字在 4 个语种里都有非空译文，且没有多余的键（漏一个就是英文界面冒中文）', () => {
    for (const lang of LANGS) {
      const dict = readPack(PACK_JSON.i18n[lang]);
      for (const key of I18N_KEYS) {
        assert.equal(typeof dict[key], 'string', `${lang}: "${key}" 缺译文`);
        assert.ok(dict[key].trim(), `${lang}: "${key}" 的译文是空的`);
      }
      assert.deepEqual(Object.keys(dict).sort(), [...I18N_KEYS].sort(), `${lang}: 键集必须正好是这 ${I18N_KEYS.length} 条（13 个名字 + 特性文本）`);
    }
  });

  test('真装载器收得下它：没有任何错误，译文文件进身份哈希', () => {
    const loaded = loadWorkshop(join(ROOT, 'workshop'), { log: quiet });
    const pack = loaded.packs.find((p) => p.id === 'profession-expansion');
    assert.ok(pack, `装载器没读到这个包：${JSON.stringify(loaded.errors)}`);
    for (const lang of LANGS) {
      assert.ok(pack.manifest.some((m) => m.path === PACK_JSON.i18n[lang]), `${lang} 的译文文件应进清单`);
    }
  });
});

describe('巡援术师：官方【术师】下的新分支（图标 / 两张范围 / 一条既有的地面部署语义）', () => {
  test('词汇表里就这一条，职业 / id / 名字 / 特性写全', () => {
    assert.equal(OFFICIAL.length, 1);
    const b = OFFICIAL[0];
    assert.equal(b.profession, 'CASTER', '挂在官方术师下');
    assert.equal(b.id, 'patrol_support');
    assert.equal(b.name, '巡援术师');
    assert.equal(b.nameEn, 'Patrol-Support Caster');
    assert.ok(b.trait.startsWith('攻击造成法术伤害'), b.trait);
    assert.ok(b.trait.includes('可以部署在地面'), '特性必须写明能站地面');
    assert.ok(b.trait.includes('范围'), '特性必须写明会改攻击范围');
  });

  test('分支图标：art.profSub 的键就是 subProfessionId，文件真的在包里、能解析出 URL', () => {
    const art = PACK_JSON.art && PACK_JSON.art.profSub ? PACK_JSON.art.profSub : {};
    assert.deepEqual(Object.keys(art), ['patrol_support'], '按 subProfessionId 索引（与 assets.prof.sub 那 69 条同一套键）');
    const rel = art.patrol_support;
    // 值是**包内相对 assets/ 的路径**（与 art.chars / bondIcons 同一条规矩：dossoles 的 'char/avatar/…' 就是这么写的）。
    // 写成 'assets/…' 会让路由去找 <pack>/assets/assets/… ⇒ 404，界面上只剩 fallback（这个坑真踩过一次）。
    assert.ok(!rel.startsWith('assets/'), `包内路径相对 assets/，不该再带 assets/ 前缀：${rel}`);
    const abs = join(PACK_DIR, 'assets', ...rel.split('/'));
    assert.ok(fs.existsSync(abs), `图标文件不在包里：assets/${rel}`);
    assert.ok(fs.statSync(abs).size > 0, '图标是空文件');
    // 客户端那两处写法都落在同一个键上：只写 subProfessionId，或写 assets.subProfIcon = 'sub_<id>_icon'
    const key = Object.keys(art)[0];
    const m = { prof: { sub: { [key]: `/workshop-assets/profession-expansion/${rel}` } } };
    assert.match(subProfIconUrl(m, { subProfessionId: 'patrol_support' }), /sub_patrol_support_icon\.png$/);
    assert.match(subProfIconUrl(m, { assets: { subProfIcon: 'sub_patrol_support_icon' } }), /sub_patrol_support_icon\.png$/);
    // 真装载一趟：本包的 art.profSub 确实并进了 assets.prof.sub，且 URL 正好是那条唯一路由
    const merged = loadData(DATA_DIR, { log: quiet, workshopDir: WORKSHOP_DIR });
    assert.equal(merged.assets.prof.sub.patrol_support, `/workshop-assets/profession-expansion/${rel}`);
  });

  test('两张范围就是图里那两张（逐格钉死，改错一格就红）', () => {
    const b = OFFICIAL[0];
    assert.deepEqual(b.ranges.elite0.high, [[2, 1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-1, 1], [-2, 1]]);
    assert.deepEqual(b.ranges.elite0.ground, [[1, 0], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0]]);
    assert.deepEqual(b.ranges.elite1.high, [[2, 1], [1, 0], [1, 1], [1, 2], [0, -1], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1], [-1, 2], [-2, 1]]);
    assert.deepEqual(b.ranges.elite1.ground, [[1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1]]);
    // 全部是合法的 [dRow, dCol] 整数对
    for (const form of ['elite0', 'elite1']) {
      for (const side of ['high', 'ground']) {
        assert.ok(b.ranges[form][side].length > 0);
        for (const g of b.ranges[form][side]) assert.ok(Array.isArray(g) && g.length === 2 && g.every(Number.isInteger), `${form}.${side} ${JSON.stringify(g)}`);
      }
    }
    // 精英是把普通那张**撑大**（不是换一套）
    const has = (grid, p) => grid.some((q) => q[0] === p[0] && q[1] === p[1]);
    for (const side of ['high', 'ground']) {
      for (const p of b.ranges.elite0[side]) assert.ok(has(b.ranges.elite1[side], p), `${side}: ${JSON.stringify(p)} 不在精英那张里`);
      assert.ok(b.ranges.elite1[side].length > b.ranges.elite0[side].length, `${side}: 精英那张必须更大`);
    }
    // 高台与地面**不是同一张** —— 否则「两张范围」这条分支就不成立
    for (const form of ['elite0', 'elite1']) assert.notDeepEqual(b.ranges[form].high, b.ranges[form].ground);
  });

  test('「可以部署在地面」是引擎既有的语义（钉住它，别让以后改回去）', () => {
    // 一个最简可部署面：'9,3' 是地面格、'10,4' 是高台格（与 test/match/board.test.js 的同一组语义）
    const map = new Map([['9,3', 'melee'], ['10,4', 'ranged']]);
    assert.equal(canPlace(map, 'ranged', 9, 3), true, "position 'RANGED'（术师）本来就站得上地面格");
    assert.equal(canPlace(map, 'ranged', 10, 4), true, '高台当然也站得上');
    assert.equal(canPlace(map, 'melee', 10, 4), false, "'melee' 只认地面格（对照）");
    assert.equal(canPlace(map, 'melee', 9, 3), true, "'melee' 在地面格上（对照）");
  });
});
