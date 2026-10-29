// server/sim/content/index.js — installs all content into a Battle (DESIGN §7).
//
// installContent(battle, { mode }) — applies the per-battle loadout data view (simdata withUnitLoadouts; DESIGN §16),
//   then mode 'full' (default): hand-authored kits (kits/index.js: one file per kit in kits/ops/) with generic
//   fallback + every domain module's install(battle); 'generic': generic kits only, no domain modules;
//   'none': no kits (units never cast skills) and no modules. Every module install runs inside try/catch:
//   a faulty content module is logged and skipped, never crashing the battle.
// setupUnitKit(battle, unit, mode) — resolves a unit's Kit: kits[baseChessId]?.(bb, chess, def) ?? generic.
//   Battle opts.kits ({ [baseChessId]: kitFn }) take precedence (tests / sandboxes).
//   补位 stand-ins (isStandInDef: the def of simdata getStandIn — the chess's ids, another character's body): the kit is
//   kits[def.charId] (the stand-in's own, kits/ops/standin-<codename>.js), never the chess id's — that is the replaced
//   operator's kit; without one, the generic kit plus the talents it can apply exactly (generic.js genericTalents).
//   A stand-in has no default skill: its kit authors every skill it supports in `skills` (selectSkillSpec).
//   自选 pieces (isDiyDef: the def of simdata getDiy — a DIY slot's ids, the picked operator's body) take their kit the
//   same way: kits[def.charId] (an owned 6★'s kits/ops/op-<codename>.js, a prototype's standin-<codename>.js), else the
//   generic kit plus genericTalents; no default skill either (the pick chooses any of the three).
//   Operator loadouts (DESIGN §16): the def is resolved for the unit's selected skill / module (simdata getChess), so
//   the kit receives `chess.skill` = the SELECTED skill record and `bb` = its blackboard (talents / trait / module of
//   the selected module). Kit contract (backward compatible): `{ skill?, skills?: { [skillId]: SkillSpec }, talents,
//   trait, install? }` — the skill spec is `skills[selectedSkillId]` when the kit authors it, else `skill` only when
//   the selected skill is the chess's default one, else the GENERIC spec of the selected skill (its generic install,
//   e.g. counter damage, is chained after the kit's). Talents / trait / install of the kit always apply.
//   syncUnitLoadout (called first, before the battle starts): a unit whose def lacks the loadout of its own input entry
//   (id-only data lookups in a multi-player field; an entry without loadout fields = the default) is given its own
//   def; summon pieces follow their owner (an inline `def` of a token entry is kept). Summons spawned AFTER the start
//   are resolved by Battle (getToken(id, owner.defId, owner.def.loadout)), not here.
// registerAllMeta(registry) — calls each domain module's registerMeta(registry) (prep side, server boot).

import { genericKit, genericTalents } from './generic.js';
import { EXTENSIONS, installExtensions } from './extensions.js';
import { compileDsl } from './dsl/compile.js';
import { validateSkillSpec, matchesSchema, MODS_SCHEMA } from '../../../shared/plugins/skillSpec.js';
import { withUnitLoadouts, mentorLoadoutOf } from '../simdata.js';
import { isPotential } from '../../../shared/potential.js';
import { COLS } from '../constants.js';
import { bodyOnTile } from '../body.js';

// Content files are loaded with guarded dynamic imports: a module that fails to load (syntax error, throwing
// top-level code, missing file) is logged and replaced by an empty module instead of breaking the server.
async function safeImport(path) {
  try {
    return await import(path);
  } catch (e) {
    console.error(`[content] failed to load ${path}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    return {};
  }
}

const KIT_REGISTRY = await safeImport('./kits/index.js');
const DOMAIN_NAMES = ['tokens', 'devices', 'enemies', 'bosses', 'bonds', 'garrisons', 'items', 'bands', 'choices'];
const DOMAINS = await Promise.all(DOMAIN_NAMES.map((n) => safeImport(`./${n}.js`)));
const tokens = DOMAINS[0];

/**
 * Merged kit registry: baseChessId → (bb, chess, def) => Kit, then the 补位 stand-in kits: stand-in charId → builder
 * (kits/index.js; each kit file is loaded guarded too)
 */
export const KITS = KIT_REGISTRY.KITS ?? Object.freeze({});

/** Domain modules in install order: tokens, devices, enemies, bosses, bonds, garrisons, items, bands, choices. */
export const MODULES = Object.freeze(DOMAIN_NAMES.map((n, i) => [n, DOMAINS[i]]));

/**
 * Whether `def` is a 补位 stand-in: a chess fielded with another character's body (simdata getStandIn — `standInFor` =
 * the replaced operator's charId, `charId` = the stand-in's, which differ).
 */
export function isStandInDef(def) {
  return !!(def && def.standInFor && def.charId && def.charId !== def.standInFor);
}

/**
 * Whether `def` is a 自选 piece: a DIY slot fielded with a picked operator's body (simdata getDiy — `diyFor` = the slot's
 * base id, `charId` = the operator's).
 */
export function isDiyDef(def) {
  return !!(def && def.diyFor && def.charId);
}

/** A def whose body is another character than its chess id names (补位 stand-in, 自选 piece): its kit is keyed by charId. */
const isOtherBody = (def) => isStandInDef(def) || isDiyDef(def);

/**
 * `kitOf` 命中的那个**键**（`null` = 没命中）。**键顺序只有这一份**：`kitOf` 与「这个 kit 属于哪个包」的读者必须
 * 命中同一个键，两处各写一遍就是两处会漂的判断。`??` 的语义逐字保留：第一个**非 `null` / `undefined`** 的值胜出
 * （所以 `reg[undefined]` 这种病态命中与从前同答）。
 */
export function kitKeyOf(def, reg) {
  if (!def || !reg) return null;
  if (isOtherBody(def)) return Object.prototype.hasOwnProperty.call(reg, def.charId) ? def.charId : null;
  const bare = String(def.baseId ?? def.id ?? '').replace(/_[ab]$/, '');
  for (const k of [def.baseId, def.id, bare]) if (reg[k] != null) return k;
  return null;
}

/**
 * The kit builder of an operator def in `reg` ({ [key]: (bb, chess, def) => Kit }), or undefined. A stand-in's and a
 * 自选 piece's kit is keyed by its charId (`char_609_acguad`, `char_112_siege`) and by nothing else: the chess id it keeps
 * names the replaced operator's kit (a DIY slot has none). Any other def: baseId (`…_a`, data/SIM.md), the exact id, or
 * the suffix-less id of DESIGN §5.6's example.
 */
/** 注册表查询。**D18**：`kitKeyOf` 是「哪个键胜出」的**唯一一份**实现 —— 上游的 `registeredKit` 是同一逻辑的
 * 另一份写法，且语义有别：它用 `.find(Boolean)` 会连**假值**一起跳过，而我们逐字保留 `??` 语义（`reg[k] != null`）。
 * ⇒ 结构取上游的**调度**，查询仍走我们的 `kitKeyOf`。 */
function registeredKit(def, reg) {
  const k = kitKeyOf(def, reg);
  return k === null ? undefined : reg[k];
}

/** Official kit key or file stem; no path supplied by a plugin is ever imported. */
export function officialKit(ref) {
  if (Object.hasOwn(KITS, ref)) return KITS[ref];
  const file = Object.values(KIT_REGISTRY.KIT_FILES || {}).flat().concat(KIT_REGISTRY.STANDIN_KIT_FILES || [], KIT_REGISTRY.OPERATOR_KIT_FILES || [])
    .find(f => f.replace(/\.js$/, '') === ref);
  if (!file) return undefined;
  const stem = file.replace(/\.js$/, '');
  if (stem.startsWith('chess_')) return KITS[stem.split('-')[0] + '_a'];
  const code = stem.replace(/^(op|standin)-/, '');
  return Object.entries(KITS).find(([k]) => k.startsWith('char_') && k.endsWith('_' + code))?.[1];
}

/**
 * [ASSUMED] A one-skill DIY or stand-in uses that kit's default skill (DESIGN **§34.5**，上游原文 `§32.5`). Multi-skill
 * clones keep explicit `skills[id]` so selectSkillSpec does not treat the default spec as every selected skill.
 */
function bindDefaultSkill(k, chess, d) {
  if (k?.skill && isOtherBody(d) && chess?.skills?.length === 1 && d?.skill?.id && !k.skills?.[d.skill.id]) {
    return { ...k, skills: { ...(k.skills || {}), [d.skill.id]: k.skill } };
  }
  return k;
}

/** C2 order: extension → DSL → JSON SkillSpec → kitRef → official → generic. */
export function kitOf(def, reg = KITS) {
  if (!def) return undefined;
  // Explicit Battle opts.kits retain their existing precedence and lookup-only semantics.
  if (reg !== KITS) return registeredKit(def, reg);
  const ext = registeredKit(def, EXTENSIONS) ?? (def.charId?.startsWith('char_x_') ? EXTENSIONS[def.charId] : undefined);
  if (ext) return ext;
  const raw = def.raw || {};
  if (raw.dsl != null) return (bb, chess, d) => bindDefaultSkill(compileDsl(raw.dsl, { bb, chess, def: d }), chess, d);
  if (raw.skillSpec != null) return (bb, chess, d) => {
    const spec = chess.skill?.skillSpec ?? raw.skillSpec;
    const errors = validateSkillSpec(spec);
    const mods = chess.talentMods ?? {};
    if (errors.length || !matchesSchema(mods, MODS_SCHEMA)) throw Object.assign(new Error('Invalid JSON SkillSpec'), { code: 'PLUGIN_SKILL_SPEC' });
    return { skills: { [d.skill?.id]: spec }, talents: Object.keys(mods).length ? [{ install(b, u) {
      b.addBuff(u, { key: 'talent:plugin', mods, persist: true, allowDead: true });
    } }] : [] };
  };
  if (raw.kitRef != null) {
    const f = officialKit(raw.kitRef);
    if (!f) return undefined;
    return (bb, chess, d) => {
      return bindDefaultSkill(f(bb, chess, d), chess, d);
    };
  }
  return registeredKit(def, KITS);
}

/**
 * 包提供的 Kit → 它属于哪个包（DESIGN §28.52 的 kit 那一半：`kits/<id>.js` 的逐单位回调要归到那个包的账上）。
 *
 * 为什么用 `WeakMap` 而不是给 Kit 加一个字段：`Kit` 是**包自己返回的对象**，往上加字段就是改包的返回值（会漏进
 * `kitShape` 之类的比对，也可能落在包自己冻结的对象上）。为什么不在这里按 `def` 重算一次：那会成为第二份「哪个
 * kit 胜出」的实现（`kitKeyOf` 的键顺序 + mode 分支 + 命中后返回假值时的回退），两份写法迟早漂。这张表只按
 * **对象身份**记：写它的地方就是选中那个 kit 的那一行，读它的地方是 `_setupUnit`（包的回调真正注册的地方）。
 */
const KIT_PACK = new WeakMap();

/** 这个 Kit 由哪个包提供（`null` = 引擎自己的 / 官方内容 —— 于是它一行预算都不记）。 @param {any} kit */
export function kitPackOf(kit) { return (kit && KIT_PACK.get(kit)) || null; }

/** `Battle opts.kitOwners` / `tokenKitOwners` 里这个 kit id 的包（表缺席、或这个 id 不在表里 ⇒ `null`）。 */
function packOfKit(battle, key, id) {
  const map = battle && battle.opts ? battle.opts[key] : null;
  if (!map || typeof map.get !== 'function' || id == null) return null;
  const owner = map.get(id);
  return typeof owner === 'string' && owner ? owner : null;
}

/** The generic kit of an operator def; a stand-in's / 自选 piece's also carries the talents generic.js can apply exactly. */
function fallbackKit(bb, raw, def) {
  const k = genericKit(bb, raw, def);
  if (!isOtherBody(def)) return k;
  const talents = genericTalents(def);
  return talents.length ? { ...k, talents: [...(k.talents ?? []), ...talents] } : k;
}

/** 「…Mul」结尾的 buff mods 键（dmgDealtMul / dmgTakenMul / resMul）按乘算合并，其余按加算（units.js 的聚合口径）。 */
const isMulMod = (k) => /Mul$/.test(k);
/**
 * 影子技能**不并**的 mods（业主 2026-10-27 口径「教官技能中的攻击范围、攻击间隔、技能持续时间这些效果不会加上」）：
 * `batPct` / `aspd` 改的是攻击间隔，`rangeExtend` 改的是攻击范围——这三样永远是学员自己的。
 */
const SHADOW_EXCLUDED_MODS = new Set(['batPct', 'aspd', 'rangeExtend']);

/** 「单次释放类」教官技能：本体没有 attack / mods / targeting，效果全在一次 `onStart` 里生成（异客 S3 的雷暴这类）。 */
function isSingleCastSpec(spec) {
  return !!spec && typeof spec.onStart === 'function' && !spec.attack && !spec.mods && !spec.targeting;
}

/** 把教官 spec 的回调链在学员自己的后面（先学员后教官），缺哪个用哪个。 */
function chainFns(a, b) {
  if (typeof a === 'function' && typeof b === 'function') return (ctx) => { a(ctx); b(ctx); };
  return a ?? b;
}

/**
 * 影子技能合并（重构协议·特训，叠加式；业主 2026-10-27 定稿）：学员自己的 SkillSpec 为基，教官选定技能的
 * **效果**叠上去，四种「学员技能 × 教官技能」组合统一落到同一条语义 —— **学员造成的每一次伤害都同步 1 次教官
 * 技能的攻击效果**（业主 2026-10-29：多段攻击按段数触发，例如一次攻击 4 段伤害 ⇒ 4 次教官效果；弹药类技能 =
 * 每一发弹药各自的段数）。从前是「每一次攻击 +1 次」，多段攻击只叠一次：
 *   - mods：数值叠加（×Mul 键乘算、其余加算），但 `batPct` / `aspd`（攻击间隔）与 `rangeExtend`（攻击范围）**不并**
 *     —— 这三样永远是学员自己的（owner 2026-10-27）；`targeting.rangeGrid` / `noRangeExtend` 同样不并（如下）；
 *   - attack：**连击数 = 学员自己的段数 × (1 + 教官的段数)**（每段伤害后面各跟一整套教官攻击；教官 1 段时就是
 *     从前的 ×2，3 段（赤刃明霄陈 S3）时 ×4 —— 教官改掉的「每次普攻的攻击次数」一起继承）、倍率乘算、
 *     splash 取大、onHit 链式；学员自己没有 attack 行时，教官那一套直接作为它的攻击（段数照教官的）；
 *     `noAttack` 不带过来（影子不替学员停手）；dmgType / projectile 学员自己的优先；
 *   - targeting：**攻击范围永远是学员自己的** —— 影子的 rangeGrid / rangeExtend / noRangeExtend 一律不带，
 *     只把 maxTargets（纯「效果」维度，不吃范围；逻各斯 S3 的 `attack@max_target` 这类「攻击目标选择数量」）
 *     取大并入；
 *   - onStart / onEnd / onTick / onAttack 链式；counter 学员自己的优先，没有才用教官的；
 *   - kind / duration / ammo / SP / 触发规则 / 攻击间隔 全部是学员自己的 —— 教官的效果随学员这一次施放激活、
 *     随学员技能结束而结束（一次 cast，一份 duration）。
 */
function mergeShadowSpec(own, shadow) {
  if (!shadow) return own;
  const out = { ...own };
  const mods = { ...(own.mods ?? {}) };
  for (const [k, v] of Object.entries(shadow.mods ?? {})) {
    if (SHADOW_EXCLUDED_MODS.has(k)) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
    mods[k] = isMulMod(k) ? (mods[k] ?? 1) * v : (mods[k] ?? 0) + v;
  }
  if (Object.keys(mods).length) out.mods = mods;
  const flags = { ...(own.flags ?? {}), ...(shadow.flags ?? {}) };
  if (Object.keys(flags).length) out.flags = flags;
  const oa = own.attack, sa = shadow.attack;
  // 教官攻击的**次数**（赤刃明霄陈 S3 的 `_additionalTimes` 3、弹药类 kit 的 `times`）：学员每一段伤害后面跟的是
  // **一整套**教官攻击，段数即教官自己的段数；由 `hitsFn` 现算的（克洛丝2 2 / 4 段、缄默德 S1）按学员这次的攻击再算一次。
  const mHits = Math.max(1, Math.floor(Number(sa?.hits) || 1));
  if (sa && !oa) {
    // 学员自己的技能没有 attack 行：教官那一套就是它的攻击——段数 / maxTargets 等效果照教官的（不再压成 1 段）
    const atk = { ...sa };
    if (typeof sa.hitsFn !== 'function') atk.hits = mHits;
    delete atk.noAttack;
    if (Object.keys(atk).length) out.attack = atk;
  } else if (sa && oa) {
    // 每次伤害同步一次教官效果（业主 2026-10-29）：学员自己的每一段伤害后面都跟一整套教官攻击，段数 =
    // **学员自己的段数 × (1 + 教官的段数)**。教官 1 段（大多数技能）⇒ 学员 2 段 = 4 段（与从前一致）；
    // 教官 3 段（陈3 S3）⇒ 学员 2 段 = 8 段——教官改掉的「每次普攻的攻击次数」也一起继承。
    const atk = { ...oa };
    const ownHits = Math.max(1, Math.floor(Number(oa.hits) || 1));
    atk.hits = ownHits * (1 + mHits);
    if (typeof oa.hitsFn === 'function') {                  // 段数由 kit 现算的（如克洛丝 2 / 4 段）：同样按 (1 + 教官段数) 乘
      const ohf = oa.hitsFn;
      const mhf = typeof sa.hitsFn === 'function' ? sa.hitsFn : null;
      atk.hitsFn = (b, u, info) => {
        const o = Math.max(1, Math.floor(Number(ohf(b, u, info)) || 1));
        const m = mhf ? Math.max(1, Math.floor(Number(mhf(b, u, info)) || 1)) : mHits;
        return o * (1 + m);
      };
    } else if (typeof sa.hitsFn === 'function') {           // 只有教官现算段数：学员的固定段数 × (1 + 教官那一段数)
      const mhf = sa.hitsFn;
      atk.hitsFn = (b, u, info) => ownHits * (1 + Math.max(1, Math.floor(Number(mhf(b, u, info)) || 1)));
    }
    if (typeof sa.atkScale === 'number') atk.atkScale = (oa.atkScale ?? 1) * sa.atkScale;
    if (typeof sa.healScale === 'number') atk.healScale = (oa.healScale ?? 1) * sa.healScale;
    if (typeof sa.splashRadius === 'number') atk.splashRadius = Math.max(oa.splashRadius ?? 0, sa.splashRadius);
    if (typeof sa.splashScale === 'number') atk.splashScale = Math.max(oa.splashScale ?? 1, sa.splashScale);
    if (typeof sa.dmgMul === 'number') atk.dmgMul = (oa.dmgMul ?? 1) * sa.dmgMul;
    if (sa.dmgType && !oa.dmgType) atk.dmgType = sa.dmgType;
    if (typeof sa.onHit === 'function') atk.onHit = chainFns(oa.onHit, sa.onHit);
    // 攻击命中的「附带效果」也一起继承（业主 2026-10-29）：维什戴尔 S3 的爆炸（余震 / 好礼）挂在 `afterHit` 上，
    // 逐命中回调（附着残影这类）挂在 `onEachHit` 上 —— 从前只在 attack 的数值字段里取，这两样整段没继承。
    if (typeof sa.afterHit === 'function') atk.afterHit = chainFns(oa.afterHit, sa.afterHit);
    if (typeof sa.onEachHit === 'function') atk.onEachHit = chainFns(oa.onEachHit, sa.onEachHit);
    out.attack = atk;
  }
  // targeting：攻击范围永远是学员自己的（业主 2026-10-27）——影子的 rangeGrid / rangeExtend / noRangeExtend
  // 一律不带（否则 changesRange 会在学员技能期间把范围换成教官技能的）；只把 maxTargets 取大并入。
  if (shadow.targeting) {
    const tg = { ...(own.targeting ?? {}) };
    if (shadow.targeting.maxTargets != null) tg.maxTargets = Math.max(tg.maxTargets ?? 0, Math.floor(shadow.targeting.maxTargets));
    if (Object.keys(tg).length) out.targeting = tg;
  }
  // 单次释放类（异客 S3 的雷暴这类）：效果只在 `onStart` 里生成一次，学员继承后改成**每次攻击各触发 1 次**
  // （业主 2026-10-29：与弹药类相似），不再只在施放时触发；浮游单元的每次命中由 `installMentorApply` 走同一条。
  const singleCast = isSingleCastSpec(shadow);
  for (const name of ['onStart', 'onEnd', 'onTick', 'onAttack']) {
    if (singleCast && name === 'onStart') continue;
    const fn = chainFns(own[name], shadow[name]);
    if (fn) out[name] = fn;
  }
  if (singleCast) out.onAttack = chainFns(out.onAttack, (ctx) => runMentorOnce(ctx.battle, ctx.unit, shadow, (ctx.targets && ctx.targets[0]) || null));
  if (!own.counter && shadow.counter) out.counter = shadow.counter;
  return out;
}

/**
 * 教官的 def 与 kit（`def.traineeMentor` → battle.data.getChess(教官的 chessId, 教官选定 loadout)）。
 * 教官 def 查无 / 与 `own` 同一条 / kit 构造抛错 ⇒ null（调用方按原样返回，叠加这一层不生效）。
 * 解析顺序：`battle.opts.kits`（测试 / 沙盒注入，对教官同样生效）→ 内建注册表 KITS → generic 回退（黑板推导的
 * spec + 它能精确应用的数值天赋——影子技能不能只属于有 kit 的教官）。
 * @returns {{ mdef: object, mk: object }|null}
 */
function mentorKitOf(battle, tm, own) {
  if (!tm || !battle?.data || typeof battle.data.getChess !== 'function') return null;
  // 教官是甄选干员（自选槽位件）时按它的 pick 解析（getDiy——否则查到的是空槽位记录）；是补位时按补位 def
  // （替补干员的身体 / 技能 / 特质）；diy 与 loadout 都缺省 ＝教官自己的默认 def（getChess(id, null) 的既有语义）。
  // 与战斗层 `Battle._tokenDef`（特训学员的召唤物按教官解析）共用同一份映射：simdata `mentorLoadoutOf`。
  const mLo = mentorLoadoutOf(tm);
  let mdef;
  try { mdef = battle.data.getChess(tm.chessId, mLo ?? null); } catch { return null; }
  if (!mdef || mdef === own) return null;
  try {
    const injected = battle.opts && battle.opts.kits;
    const f = (injected && typeof kitOf(mdef, injected) === 'function' ? kitOf(mdef, injected) : null)
      ?? (typeof kitOf(mdef, KITS) === 'function' ? kitOf(mdef, KITS) : null);
    const mbb = mdef.skill?.bb ?? {};
    const mraw = mdef.raw ?? mdef;
    const mk = f ? selectSkillSpec(f(mbb, mraw, mdef), mbb, mraw, mdef) : fallbackKit(mbb, mraw, mdef);
    return mk ? { mdef, mk } : null;
  } catch (e) {
    battle._handlerError?.(`traineeMentor:${tm.chessId}`, null, e);
    return null;
  }
}

/**
 * 教官 installer（talents）与特质 install 链在学员自己的之后 —— 两处（本体 / 召唤物）共用的那一段。
 * `mentorSkillId`（本体才有）：教官 kit 的 `install` 常按 `unit.skill.id` 分支（赤刃明霄陈 S3 的剑气 tick
 * 只在 `skchr_chen3_3` 上注册）—— 学员自己的技能 id 不同，直接跑会把教官技能**整段行为**漏掉（业主 2026-10-29：
 * 学员继承的技能效果不完整、没有技能描述里的那道剑气）。这里在跑教官 `install` 的**那一瞬**把 `unit.skill.id`
 * 临时换成教官选定的技能 id，装完立即还原：钩子注册上去，运行期仍读学员自己的技能（active / activations）。
 */
function chainMentorInstallers(kit, mk, { trait = false, mentorSkillId = null } = {}) {
  const out = { ...kit };
  const mt = (mk.talents ?? []).filter((x) => x && typeof x.install === 'function');
  if (mt.length) out.talents = [...(kit.talents ?? []), ...mt];
  if (trait && mk.trait && typeof mk.trait === 'object') out.trait = { ...mk.trait, ...(kit.trait ?? {}) };
  const ownI = typeof kit.install === 'function' ? kit.install : null;
  const rawI = typeof mk.install === 'function' ? mk.install : null;
  const mI = rawI ? (b, u) => {
    const sk = u && u.skill;
    if (!sk || !mentorSkillId || sk.id === mentorSkillId) { rawI(b, u); return; }
    const was = sk.id;
    try { sk.id = mentorSkillId; rawI(b, u); } finally { sk.id = was; }
  } : null;
  if (ownI && mI) out.install = (b, u) => { ownI(b, u); mI(b, u); };
  else if (mI) out.install = mI;
  return out;
}

/**
 * 「每一次伤害同步一次教官攻击」的漏点（业主 2026-10-29）：学员 kit **自己直接结算**的伤害（浮游单元的每一次命中、
 * 技能 DoT 的 tick 这类不经过 `resolveHit` 的实例）吃不到影子 `attack.hits` 的翻倍 —— 这里给它们补一次 `apply`
 * 的应用（攻击型教官：一整套「ATK × 教官攻击倍率」的伤害 + 教官的 `afterHit` / `onEachHit` / `onHit`；单次释放型
 * 教官：那一次技能效果本身，见 `mentorSingleCastApply`）。
 * 学员自己那一次攻击的伤害（`isAttack` / `isSplash` / 带 `attackId` 三者任一）已被影子段数与溅射覆盖，跳过；
 * 杀死的递归由 `unit.mem.mentorApplying` 与 `isSplash` 挡住（教官的余震都是溅射实例）。
 */
function installMentorApply(battle, unit, apply, onceType = false) {
  if (typeof apply !== 'function') return;
  const mine = (d) => Array.isArray(d.tags) && d.tags.includes('mentorApply');
  battle.on('damaged', (ctx) => {
    const d = ctx && ctx.dmg;
    if (!d || ctx.source !== unit || !unit.alive || ctx.target?.side !== 'enemy') return;
    if (!unit.skill || !unit.skill.active || unit.mem.mentorApplying) return;
    if (d.sourceless || d.isSplash || d.attackId || mine(d)) return;
    // 自建实体的「每一发」也要触发（业主 2026-10-29：丰川祥子的赞乐音符是包侧自建实体，`isAttack` 但没有 attackId）——
    // 引擎那一次攻击结算的实例一定带 attackId（`++b.attackSeq`），已经被段数 / 溅射覆盖；带 `isSkill` 的 isAttack
    // 是教官自己技能里的结算（异客的雷暴劈雷这类），跳过以免自己触发自己。
    if (d.isAttack && d.isSkill) return;
    // 单次释放类教官只认「攻击性质」的实例（业主 2026-10-29：学员继承后**只在攻击时触发**，不是每秒）——
    // 技能 DoT 之类的 `isSkill` 伤害（荒芜拉普兰德 S3 每秒的范围伤害）不再触发它。
    if (onceType && d.isSkill) return;
    unit.mem.mentorApplying = true;
    try {
      const safe = (fn, what) => (typeof battle._safe === 'function' ? battle._safe(fn, what, unit) : fn());
      safe(() => apply(battle, unit, ctx.target), 'mentor.apply');
    } finally {
      unit.mem.mentorApplying = false;
    }
  }, { owner: unit });
}

/** 攻击型教官的一次应用（`installMentorApply` 的 apply）：`hits` 段 ATK × 教官攻击倍率 + 教官的命中附带效果。 */
function mentorAttackApply(sa) {
  return (battle, unit, t) => {
    const type = typeof sa.dmgType === 'string' && sa.dmgType !== 'heal' && sa.dmgType !== 'none' ? sa.dmgType : 'phys';
    const scale = Number(sa.atkScale ?? 1);
    const mHits = Math.max(1, Math.floor(Number(sa.hits) || 1));
    let dealt = 0;
    for (let i = 0; i < mHits && t.alive && scale > 0; i++) { // loop-cap: 教官的段数（kit 的 hits）
      dealt += battle.dealDamage(unit, t, { amount: unit.s.atk * scale, type, isSkill: true, tags: [...(sa.tags || []), 'mentorApply'] });
    }
    const hc = { dealt, x: t.x, y: t.y, isSkill: true };
    if (typeof sa.onEachHit === 'function') {
      const fn = sa.onEachHit;
      fn({ battle, unit, skill: unit.skill, bb: unit.skill.bb, target: t, dealt, kind: 'main', isSplash: false, isChain: false, main: t, attackId: 0, isSkill: true });
    }
    if (typeof sa.afterHit === 'function') sa.afterHit(battle, unit, t, hc);
    if (typeof sa.onHit === 'function') sa.onHit({ battle, unit, skill: unit.skill, bb: unit.skill.bb, target: t, dealt, x: t.x, y: t.y });
  };
}

/** 单次释放类教官在学员身上的**内置冷却**（秒，业主 2026-10-29）：同一次攻击的多段、音符连发、攻击与伤害同帧
 *  这些情形只算一次。 */
const MENTOR_ONCE_CD = 0.2;

/**
 * 「单次释放类」教官技能的一次应用（业主 2026-10-29）：技能本体没有 attack / mods / targeting，效果全在一次
 * `onStart` 里生成（异客 S3 辉煌裂片的雷暴区域就是这一种）—— 学员每次攻击 / 浮游单元每次命中各触发 1 次
 * （0.2 s 内置 CD）。
 * 触发时可以带一个 `target`（浮游单元在全场打到的敌人）：那一刻把 unit 的攻击范围临时换成**目标所在的那一格**，
 * 教官技能里的「在攻击范围内挑一个敌人」就落在这个目标上 —— 否则范围外的命中（荒芜拉普兰德 S3 的浮游单元）会因为
 * 学员自己范围内没有敌人而整个不触发（业主 2026-10-29）。
 */
function runMentorOnce(battle, unit, mspec, target) {
  const skill = unit && unit.skill;
  if (!skill || !mspec || typeof mspec.onStart !== 'function') return;
  const now = battle.time;
  if (Number.isFinite(unit.mem.mentorOnceAt) && now - unit.mem.mentorOnceAt < MENTOR_ONCE_CD - 1e-9) return;
  unit.mem.mentorOnceAt = now;
  const tile = target && target.alive ? Math.round(target.y) * COLS + Math.round(target.x) : null;
  const saveKeys = unit.rangeKeys, saveSet = unit.rangeKeySet;
  if (tile != null) {
    const set = new Set([tile]);
    unit.rangeKeys = [tile];
    unit.rangeKeySet = set;
  }
  try {
    mspec.onStart({ battle, unit, skill, bb: skill.bb, target: target || null });
  } finally {
    if (tile != null) { unit.rangeKeys = saveKeys; unit.rangeKeySet = saveSet; }
  }
}

/** `installMentorApply` 的 apply：单次释放类教官的一次应用（`runMentorOnce`，含 0.2 s CD）。 */
function mentorSingleCastApply(mspec) {
  return (battle, unit, target) => runMentorOnce(battle, unit, mspec, target);
}

/**
 * 教官技能声明的召唤物（data `overrideTokenKey`）：望 S1/S2/S3 的棋子、令 S1/S2/S3 的墨魂这类「会部署召唤物」的技能。
 * 技能记录没声明 ⇒ null（夕 S3 这类 token 来自天赋、且 kit 自己就按每次攻击召唤，不套这一层以免叠出两枚）。
 */
function mentorSummonTokenId(mdef) {
  const raw = mdef?.raw ?? mdef ?? null;
  for (const s of [raw?.skill, mdef?.skill]) {
    if (!s || typeof s !== 'object') continue;
    const id = s.overrideTokenKey ?? s.tokenKey;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/** 召唤物落点的一格分类（与望 S3 / content/tokens.js 同一条顺序）：0 不可部署地面 / 1 可部署地面 / 2 高台；null 不能放。 */
function summonTileClass(battle, r, c) {
  if (!battle.grid.inRect(r, c)) return null;
  const t = battle.grid.tile(r, c);
  if (!t) return null;
  if (t.build === 'NONE') return t.height === 'LOW' && t.pass === 'ALL' ? 0 : null;
  if (t.height === 'LOW' && (t.build === 'ALL' || t.build === 'MELEE')) return 1;
  if (t.build === 'RANGED' || t.build === 'ALL') return 2;
  return null;
}

/**
 * 特训学员的召唤物落点（业主 2026-10-29）：**攻击目标所在格**优先；那一格不能用时，以它为中心向外按技能自己的顺序
 * 就近挑（有敌人的格 > 不可部署地面 > 可部署地面 > 高台）。没有目标（消耗弹药触发）时以学员所在格为中心找。
 * 只避开自家单位 / 倒地干员 / 障碍 / 预留格（敌人所在格可以：夕 S3 的召唤就落在被攻击的敌人脚下）。
 * @returns {[number, number]|null}
 */
function traineeSummonTile(battle, unit, target) {
  const tr = target ? Math.round(target.y) : unit.tileR;
  const tc = target ? Math.round(target.x) : unit.tileC;
  const ok = (r, c) => battle.grid.inRect(r, c) && summonTileClass(battle, r, c) != null
    && !battle.unitAt(r, c) && !battle.downOn(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c);
  if (ok(tr, tc)) return [tr, tc];
  const cands = [];
  for (let rad = 1; rad <= 3; rad++) {   // loop-cap: 最多向外 3 格
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const r = tr + dr, c = tc + dc;
        if (!ok(r, c)) continue;
        cands.push({
          r, c, cls: summonTileClass(battle, r, c), d: rad, k: r * COLS + c,
          foe: battle.enemies.some((e) => e.alive && !e.hidden && bodyOnTile(e, r, c)) ? 0 : 1,
        });
      }
    }
  }
  cands.sort((a, b) => a.foe - b.foe || a.cls - b.cls || a.d - b.d || a.k - b.k);
  return cands.length ? [cands[0].r, cands[0].c] : null;
}

/**
 * 特训学员的「召唤物」层（业主 2026-10-29）：教官技能声明了召唤物（`overrideTokenKey`）时，学员在**自己的技能期间**
 * 每次攻击 / 每次消耗弹药都在目标格（不可用时按技能顺序就近）部署一枚，技能结束（含弹药打空）时它们同步退场。
 * 这条层不读教官技能的弹药与库存，也不受它的部署数量限制（per-owner `deployLimit` 只约束内建 tokens 的 kit）；
 * 更不占对局的可部署干员数量上限（battle 的 spawnToken 本来就不碰 match 的 deployCount）。
 * 同一次攻击若同时消耗弹药（弹药技能），`attack` 与 `ammoUsed` 在同一 `battle.time` —— 只算一枚。
 * `onSummon(battle, unit, token)`：教官 kit 的 `tokenSummon` 钩子（有就调）—— 让这枚 summon 也吃那个技能自己的
 * 效果（望 S3：登记成她的一片棋子，照 tick 扫描触发伤害与特效）。
 */
function installTraineeSummons(battle, unit, tokenId, onSummon = null) {
  if (!tokenId) return;
  const spawned = () => (Array.isArray(unit.mem.traineeSummons) ? unit.mem.traineeSummons : (unit.mem.traineeSummons = []));
  const clear = () => {
    for (const t of spawned()) if (t && t.alive) battle.retreat(t, { reason: 'expired', permanent: true });
    unit.mem.traineeSummons = [];
  };
  const on = () => !!(unit.alive && unit.skill && unit.skill.active);
  let at = -Infinity;
  const deploy = (target) => {
    if (!on()) return;
    // 教官 kit 自己就在**目标格**召唤了这一枚（夕 S3 的「每次攻击召唤 / 刷新一只」这类）⇒ 这一发不重复叠：
    // 只认不是这一层放下的同 id token（本层放下的会占住目标格，落点会自动让到旁边，照旧是「每次攻击各一枚」）
    const mine = spawned();
    const tr = target ? Math.round(target.y) : unit.tileR;
    const tc = target ? Math.round(target.x) : unit.tileC;
    const foreign = battle.allyUnits.some((t) => t && t.alive && t.kind === 'token' && t.defId === tokenId
      && t.ownerUnit === unit && t.tileR === tr && t.tileC === tc && !mine.includes(t));
    if (foreign) return;
    const tile = traineeSummonTile(battle, unit, target);
    if (!tile) return;
    const t = battle.spawnToken(unit, tokenId, tile[0], tile[1], { anySource: true });
    if (!t) return;
    mine.push(t);
    if (typeof onSummon === 'function') {
      try { onSummon(battle, unit, t); } catch (e) { battle._handlerError?.('traineeSummon', t, e); }
    }
  };
  battle.on('attack', (c) => {
    if (c.attacker !== unit || !on()) return;
    if (battle.time <= at + 1e-9) return;
    at = battle.time;
    deploy((c.targets || []).find((x) => x && x.side === 'enemy') || null);
  }, { owner: unit });
  battle.on('ammoUsed', (c) => {
    if (c.unit !== unit || !on()) return;
    if (battle.time <= at + 1e-9) return;
    at = battle.time;
    deploy(null);
  }, { owner: unit });
  battle.on('skillEnd', (c) => { if (c.unit === unit) clear(); }, { owner: unit });
  battle.on('death', (c) => { if (c.unit === unit) clear(); }, { owner: unit });
}

/**
 * 特训学员的 kit 后处理（重构协议·特训，叠加式）：学员自己的 kit 为基（自己的技能 / 特质 / 天赋 / install 照常），
 * 教官那份 kit（`def.traineeMentor` → mentorKitOf）的
 *   - 选定技能 spec —— 作为「影子技能」并进学员自己的 spec（mergeShadowSpec；学员没有 spec 时不造：影子只随
 *     学员自己的施放激活）；
 *   - talents installers —— 追加到 kit.talents（教官的天赋独立结算）；
 *   - install —— 链在学员 kit.install 之后（教官特质的逐单位行为）；
 *   - trait —— profile 覆盖对象并入（学员自己的键优先）。
 * 教官 def 查无 / kit 构造抛错 ⇒ 按原样返回（战斗叠加这一层不生效，学员的 def 级组成照旧）。
 */
function applyTraineeMentor(battle, kit, def) {
  const found = mentorKitOf(battle, def?.traineeMentor, def);
  if (!found) return kit;
  const { mdef, mk } = found;
  const out = chainMentorInstallers(kit, mk, { trait: true, mentorSkillId: mdef.skill?.id ?? mk.skill?.id ?? null });
  if (kit.skill && mk.skill) {
    out.skill = mergeShadowSpec(kit.skill, mk.skill);
    // 教官那一次「技能效果」对学员 kit 自己结算的伤害（浮游单元命中这类）也要各触发 1 次（installMentorApply）：
    // 攻击型教官 = 一整套攻击；单次释放型教官（异客 S3 的雷暴这类）= 那一次 onStart 的效果本身。
    const apply = isSingleCastSpec(mk.skill) ? mentorSingleCastApply(mk.skill)
      : mk.skill.attack ? mentorAttackApply(mk.skill.attack) : null;
    if (apply) {
      const prev = out.install;
      const once = isSingleCastSpec(mk.skill);
      out.install = (b, u) => { if (prev) prev(b, u); installMentorApply(b, u, apply, once); };
    }
  }
  // 教官的技能会部署召唤物（data `overrideTokenKey`：望 S3 的棋子 / 令 S3 的墨魂这类）：学员在技能期间每次攻击 /
  // 每次消耗弹药各部署一枚，技能结束（含弹药打空）时一起退场；无视教官技能的弹药与部署数量限制、不占可部署上限。
  const summonId = mentorSummonTokenId(mdef);
  if (summonId && out.skill) {
    const prev = out.install;
    const onSummon = typeof mk.tokenSummon === 'function' ? mk.tokenSummon : null;
    out.install = (b, u) => { if (prev) prev(b, u); installTraineeSummons(b, u, summonId, onSummon); };
  }
  return out;
}

/**
 * 特训学员的**召唤物**（业主 2026-10-29）：学员召唤的 token 也吃教官的天赋 / 特质 installer —— 只对「主人是
 * 特训学员」的 token 生效；token 自己的 kit（技能 / 特性）保持原样，教官的**影子技能不并**（召唤物没有学员
 * 那一次施放，影子只随学员自己的技能激活）。教官查无 / 构造失败 ⇒ 原样返回。
 * @param {import('../Battle.js').Battle} battle @param {object} unit the token @param {object} kit its own kit
 */
export function attachMentorToSummon(battle, unit, kit) {
  const tm = unit && unit.kind === 'token' && unit.ownerUnit ? unit.ownerUnit.def?.traineeMentor : null;
  if (!tm) return kit;
  const found = mentorKitOf(battle, tm, unit.def);
  if (!found) return kit;
  return chainMentorInstallers(kit, found.mk);
}

/** Resolve the Kit of an ally unit. Never throws (falls back to the generic kit). */
export function setupUnitKit(battle, unit, mode = 'full') {
  try { syncUnitLoadout(battle, unit); } catch (e) { battle._handlerError?.('loadout', unit, e); }
  if (mode === 'none') return {};
  const def = unit.def || {};
  const raw = def.raw ?? def;
  const bb = def.skill?.bb ?? {};
  if (unit.kind === 'token') {
    // 工坊的召唤物行为层（docs/WORKSHOP.md §4.7）：与干员那一半同一条纪律 —— 一张按对局注入的表，**先查它、再查
    // 内置注册表**。token 的键就是 token 记录的 id（`def.id`，normalizeToken 逐字写下），所以这一行的键规则与
    // 下面 `tokens.kits[def.id]` 完全一致；`Object.hasOwnProperty` 让它不顺着原型链、也不吃 `baseId` 之类的回退。
    // 没有包声明 summon kit 时 `opts.tokenKits` 根本不存在（`spec.js` 只在有值时传这个键），这一行是 no-op，
    // token 的解析与从前逐字节相同。两个键空间是分开的：`opts.kits` 永远不会被当成 token kit，反之亦然。
    const injectedTok = battle.opts && battle.opts.tokenKits;
    const packTok = mode === 'full' || injectedTok
      ? (injectedTok && Object.prototype.hasOwnProperty.call(injectedTok, def.id) ? injectedTok[def.id] : undefined)
      : undefined;
    const tk = packTok ?? (mode === 'full' ? (tokens.kits?.[def.id] ?? tokens.default?.[def.id]) : null);
    if (typeof tk === 'function') {
      // 这个 kit 是包给的 ⇒ 记下它的包（`_setupUnit` 应用它时把它的逐单位回调记到那本账上）。内建那一半命中时
      // 归属是 null（引擎自己的内容），与从前逐字节相同。
      const owner = packTok ? packOfKit(battle, 'tokenKitOwners', def.id) : null;
      try { const k = tk(bb, raw, def); if (k) { if (owner) KIT_PACK.set(k, owner); return k; } } catch (e) { battle._handlerError(`tokenKit:${def.id}`, unit, e); }
    }
    return def.skill ? genericKit(bb, raw, def) : {};
  }
  if (unit.kind !== 'op') return {};
  const injected = battle.opts && battle.opts.kits;
  let k = null;
  if (mode === 'full' || injected) {
    const f = kitOf(def, injected) ?? (mode === 'full' ? kitOf(def, KITS) : undefined);
    if (typeof f === 'function') {
      // 归属：**包给的那一份**才有 owner（键顺序与 `kitOf` 是同一份 `kitKeyOf`，命中的是同一个键）；`f` 来自内建
      // 注册表时它是 null。记在返回的那个对象上（`selectSkillSpec` 可能返回一个新对象），`_setupUnit` 读它。
      const key = injected ? kitKeyOf(def, injected) : null;
      const owner = key === null ? null : packOfKit(battle, 'kitOwners', key);
      try {
        const kk = f(bb, raw, def);
        if (kk) { const out = selectSkillSpec(kk, bb, raw, def); if (owner) KIT_PACK.set(out, owner); k = out; }
      } catch (e) {
        const dslCode = typeof e?.code === 'string' && /^PLUGIN_DSL_[A-Z0-9_]+$/.test(e.code);
        // A record that carries DSL, or a throw whose code is a DSL problem, is a corrupt content set.
        // Do not substitute the generic kit or an empty kit (DESIGN **§34.7**，上游原文 `§32.7`). Any other throw still
        // falls back. Matched as a pattern, not a quoted PLUGIN_* name: the error catalogue scans those strings.
        if (dslCode || raw.dsl != null) {
          if (e && typeof e === 'object') {
            e.contentFault = true;
            if (typeof e.code === 'string' && !String(e.message || '').includes(e.code)) e.message = `${e.code} ${e.message || ''}`.trim();
          }
          battle.contentFault = {
            layer: 'setupUnitKit',
            code: typeof e?.code === 'string' ? e.code : 'PLUGIN_DSL_SHAPE',
            message: String(e?.message || e),
          };
          throw e;
        }
        battle._handlerError(`kit:${isOtherBody(def) ? def.charId : def.baseId}`, unit, e);
      }
    }
  }
  if (!k) k = fallbackKit(bb, raw, def);
  // 特训学员（重构模拟，叠加式）：教官的影子技能 / 特质 / 天赋并进学员自己的 kit —— 只在 'full' 模式（'generic' /
  // 'none' 本来就没有逐干员内容）。
  return mode === 'full' && def.traineeMentor ? applyTraineeMentor(battle, k, def) : k;
}

/** A unit's own PlayerBattleInput entry (operators: kind ≠ 'token'; tokens: kind 'token'), or null. */
function inputEntry(unit) {
  const list = unit && unit.player && unit.player.input && Array.isArray(unit.player.input.units) ? unit.player.input.units : null;
  if (!list || unit.uid == null) return null;
  const tok = unit.kind === 'token';
  return list.find((v) => v && v.uid === unit.uid && (v.kind === 'token') === tok) ?? null;
}

/**
 * The loadout `{ skillIndex, moduleId }` a unit's PlayerBattleInput entry gives; an entry without loadout fields means
 * the DEFAULT loadout (`{}`), never "whatever the data view maps this chess id to" (another player's choice in a
 * multi-player field). `standIn: true` rides along (补位: the stand-in def whatever the skill / module fields say), as
 * do `diy` (自选: the pick of a DIY slot's piece) and `potential` (0.2.2: 1–6, never a stand-in's). Null when the unit
 * has no input entry.
 */
function inputLoadout(unit) {
  const x = inputEntry(unit);
  if (!x) return null;
  const extra = {
    ...(x.standIn === true ? { standIn: true } : null),
    ...(x.diy && typeof x.diy === 'object' ? { diy: x.diy } : null),
    ...(x.standIn !== true && isPotential(x.potential) ? { potential: x.potential } : null),
    // 特训学员（重构模拟）：def 由 getChess 的 traineeOf 组成通道决定，syncUnitLoadout 不再按 loadout 重解析。
    ...(x.reconTrainee && typeof x.reconTrainee === 'object' ? { reconTrainee: x.reconTrainee } : null),
  };
  if (x.skillIndex == null && x.moduleId == null) return extra;
  return { skillIndex: x.skillIndex ?? null, moduleId: x.moduleId ?? null, ...extra };
}

/** Put a def on a not-yet-deployed ally (the fields Battle._makeAlly takes from the def). */
function swapDef(unit, def) {
  const st = def.stats;
  unit.def = def;
  unit.defId = def.id;
  unit.name = def.name;
  unit.rangeGrid = def.rangeGrid;
  Object.assign(unit.base, {
    maxHp: st.maxHp, atk: st.atk, def: st.def, res: st.res, aspd: st.aspd, bat: st.bat, blockCnt: st.blockCnt,
    spRecovery: st.spRecovery, tauntLevel: st.tauntLevel, massLevel: st.massLevel, hpRecoveryPerSec: st.hpRecoveryPerSec,
    cost: st.cost, respawnTime: st.respawnTime,
  });
  unit.markDirty?.();
  unit.hp = unit.s ? unit.s.maxHp : st.maxHp;
}

/**
 * Loadout exactness (DESIGN §16) before the battle starts: an operator whose def does not carry the loadout of its own
 * PlayerBattleInput entry (the per-battle data view resolves id-only lookups per chess id — two players of one field
 * may give the same chess different loadouts) gets the def of its own loadout — an entry without loadout fields means
 * the default — and a summon piece follows its owner's (unless its entry carries an inline `def`). A no-op when the def
 * already matches (Battle passing the unit's loadout to getChess / getToken).
 */
export function syncUnitLoadout(battle, unit) {
  if (!battle || battle.started || !unit || unit.deployed || !unit.def || !battle.data) return;
  if (unit.kind === 'op') {
    const lo = inputLoadout(unit);
    // 特训学员（重构模拟，叠加式）：def 已经是 getChess 的 traineeOf 组成件（学员自己的技能 / 模组 / 属性 = 学员 + 教官 ×0.5 +
    // 教官的盟约 + traineeMentor 影子技能指针），按 loadout 重解析只会把它换回普通 def —— 输入条目带
    // reconTrainee 时这条 def 就是终局。
    if (lo && lo.reconTrainee) return;
    if (!lo || typeof battle.data.getChess !== 'function') return;
    // an entry without loadout fields only needs a look when the def carries a non-default loadout
    if (!Object.keys(lo).length && !(unit.def.loadout && unit.def.loadout.isDefault === false)) return;
    const want = battle.data.getChess(unit.def.id, lo);
    if (want && want !== unit.def && want.id === unit.def.id) swapDef(unit, want);
  } else if (unit.kind === 'token' && unit.ownerUnit && unit.ownerUnit.kind === 'op' && typeof battle.data.getToken === 'function') {
    // an explicit inline def of the input entry (Battle `_tokenDef(id, owner, inp.def)`) is never replaced
    if (inputEntry(unit)?.def) return;
    const owner = unit.ownerUnit;
    syncUnitLoadout(battle, owner);
    if (!owner.def || !owner.def.loadout) return;
    const want = battle.data.getToken(unit.def.id, owner.def.id, owner.def.loadout);
    if (want && want !== unit.def && want.id === unit.def.id) swapDef(unit, want);
  }
}

/** Id of the selected skill of an operator def (null without a skill). */
const selectedSkillId = (def) => def?.skill?.id ?? def?.raw?.skill?.skillId ?? null;

/**
 * True when the def's selected skill is the chess's default skill (no loadout info ⇒ default). Never for a stand-in:
 * the skill it fields is the one its chess names (S2 on one chess, S3 on another), so its kit authors each in `skills`;
 * nor for a 自选 piece (the pick chooses any of its skills).
 */
const skillIsDefault = (def) => !isOtherBody(def) && (!def?.loadout || def.loadout.skillIsDefault !== false);

/**
 * The kit with the skill spec of the SELECTED skill (see header): `kit.skills[id]` → `kit.skill` (default skill only;
 * never for a stand-in) → the generic spec. Returns the kit itself when nothing changes; `kit.skillSource` tells which
 * one was used ('skills' | 'kit' | 'generic').
 * @param {object} kit hand-authored kit
 */
export function selectSkillSpec(kit, bb, raw, def) {
  const id = selectedSkillId(def);
  const map = kit && kit.skills && typeof kit.skills === 'object' ? kit.skills : null;
  if (id && map && Object.prototype.hasOwnProperty.call(map, id)) return { ...kit, skill: map[id] ?? null, skillSource: 'skills' };
  if (skillIsDefault(def)) return kit;
  const g = genericKit(bb, raw, def);
  const own = typeof kit.install === 'function' ? kit.install : null;
  const gen = typeof g.install === 'function' ? g.install : null;
  const out = { ...kit, skill: g.skill ?? null, skillSource: 'generic' };
  if (own && gen) out.install = (battle, unit) => { own(battle, unit); gen(battle, unit); };
  else if (gen) out.install = gen;
  return out;
}

/**
 * Whether the kit of `def` has a hand-authored spec for its selected skill (tools/kit-coverage.mjs, tests): `skills`
 * entry, or the kit's `skill` for the default skill when the kit is not the generic fallback. Never throws.
 * @returns {'skills'|'kit'|'generic'|'none'} where the spec comes from ('none' = no kit function at all)
 */
export function skillSpecSource(def, kits = KITS) {
  const f = kitOf(def, kits);
  if (typeof f !== 'function') return 'none';
  let k = null;
  try { k = f(def.skill?.bb ?? {}, def.raw ?? def, def); } catch { return 'generic'; }
  if (!k || k.generic) return 'generic';
  const id = selectedSkillId(def);
  if (id && k.skills && Object.prototype.hasOwnProperty.call(k.skills, id)) return 'skills';
  return skillIsDefault(def) && k.skill !== undefined ? 'kit' : 'generic';
}

/**
 * Install kits for every ally unit and (mode 'full') every domain module. First, a Battle constructed without the spec
 * path (server-run fields, bot rehearsals, tests) gets the same per-battle loadout data view createBattleFromSpec uses
 * (simdata withUnitLoadouts over its players' inputs), so summons spawned during the battle (`getToken(id, owner)`)
 * and every other id-only lookup resolve the owner's selected skill / module there too (DESIGN §16).
 */
export function installContent(battle, { mode = 'full', extra = null, installers = null } = {}) {
  try {
    const view = withUnitLoadouts(battle.data, (battle.players || []).map((p) => p && p.input));
    if (view && view !== battle.data) battle.data = view;
  } catch (e) { battle._handlerError?.('loadoutView', null, e); }
  for (const u of battle.allyUnits) {
    if (u.kit) continue;
    try { battle._setupUnit(u); } catch (e) {
      if (e?.contentFault || battle.contentFault) {
        battle._handlerError('content:dsl', u, e);
        throw e;
      }
      battle._handlerError('setupUnit', u, e);
    }
  }
  if (mode === 'full') {
    installExtensions(battle);
    for (const [name, mod] of MODULES) {
      if (typeof mod.install !== 'function') continue;
      try { mod.install(battle); } catch (e) { battle._handlerError(`content:${name}`, null, e); }
    }
  }
  // 包声明的**战斗逻辑**（`pack.json.server.battle`, DESIGN §28.17）：每个包单独一层 try/catch，报错点名是哪个包。
  // 一个包抛异常只记一条内容错误，绝不让整个战场起不来 —— 与 kits 逐单位隔离同一条口径。**没有包声明时这里是空的**，
  // 所以干净安装与从前逐字节相同（golden 语料不动）。
  //
  // 调用预算（`pack.json.callBudget`, DESIGN §28.52）：声明过的包在这里**开账**，而且它的 `install` 在
  // `_withPackScope` 里跑 —— 这一趟挂上的 hook / 计时器 / buff 因此都带上 `pack` 标记，这一局就按那本账计。
  // 没声明 `callBudget` 的 installer 上面那个键根本不存在 ⇒ 两个动作都不做，module 档一行都不多跑。
  for (const m of installers || []) {
    if (!m || typeof m.install !== 'function') continue;
    const packId = m.id || '?';
    if (Number.isInteger(m.callBudget)) battle._declarePackBudget(packId, m.callBudget);
    try { battle._withPackScope(packId, () => m.install(battle)); } catch (e) { battle._handlerError(`content:pack:${packId}`, null, e); }
  }
  // kit 那一半的账（DESIGN §28.52）：上面那个循环只给**声明了 `server.battle`** 的包开账，而一个包的另一半战斗行为
  // 住在 `kits/<id>.js` —— 只带 `kits/` 的包过去根本建不了账，它的逐单位回调（每 tick 一次、每次又挂一批计时器）
  // 正是这一格要挡的那类回调。装载器（`server/workshop.js loadWorkshopKits`）已经把「包 id → 生效 max」算好一次
  // （`effectivePackCallBudget` 是唯一一份「包 → 生效 max」），这里只开账。同一个包两处都开时写的是同一个数字，
  // 而 `_declarePackBudget` 是幂等的；没有那张表时这一行一个字节都不多跑（干净安装 / 没包声明预算）。
  const kitBudgets = battle.opts && battle.opts.kitBudgets;
  if (kitBudgets && typeof kitBudgets.forEach === 'function') {
    kitBudgets.forEach((max, packId) => { battle._declarePackBudget(packId, max); });
  }
  for (const m of extra || []) {
    try { (typeof m === 'function' ? m : m.install)?.(battle); } catch (e) { battle._handlerError('content:extra', null, e); }
  }
}

/** Prep-side registration of every domain module (server boot). */
export function registerAllMeta(registry) {
  for (const [name, mod] of MODULES) {
    if (typeof mod.registerMeta !== 'function') continue;
    try { mod.registerMeta(registry); } catch (e) { console.error(`[content] ${name}.registerMeta failed:`, e); }
  }
}
