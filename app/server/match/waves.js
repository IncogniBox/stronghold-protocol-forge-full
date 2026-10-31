// server/match/waves.js — per-match enemy setup and per-round spawn generation: the OFFICIAL generator decoded from
// the client (`RandomEnemyGenerater`, research 08 §2; DESIGN §14 "Corrections from research 08/09"). No custom balance:
// counts, kinds, timing and stat scaling are the official ones.
//
// Per match (setupMatchWaves):
//   * stage: weighted (stages[id].weight) among mode.stages that are active with weight > 0 — official mode data:
//     标准 (FUNNY) / 入门 = 战场#01 only, 险境 = 8 stages, 绝境 / 终极 = 7 (no 战场#01), weight 50 each, so the match seed
//     picks uniformly (test/match/stagepick.test.js)
//   * factions: `specialEnemyNum` (3) distinct types among the involveRandom ones (FLY/TIMES/ELEMENT/DOT/INVISIBLE/
//     REFLECTION), uniform (shuffle, take 3)
//   * type schedule: each chosen type owns `count` (3) of the `maxLevelCnt` (15) round slots, SPECIAL fills the other 6;
//     the slots are shuffled — typeSlots[r-1] = the ONE type of round r (the briefing shows the 3 types, the order
//     stays hidden)
//   * picks: for every round 1..15, generated now (so the preview and every battle agree): half = r ≤ 7; a weighted
//     (entry.weight) special entry of the round's type and half whose SPECIAL key is not in the mode's
//     inactiveEnemyKeys (attached keys are never filtered); normal / elite = a random attached key
//   * boss: weighted mode.bossWeights; hidden boss: weighted mode.hiddenBossWeights (independent)
// Per round (buildNormalWave / buildBossWave; one composition shared by every player):
//   * every template SPAWN action whose key is a placeholder (N/E/S walk, NF/EF/SF fly) becomes the pick's
//     normal / elite / special key — or is SKIPPED (not spawned, not previewed) when the new key's movement class differs
//     from the placeholder's (ground rounds drop NF/EF/SF, FLY rounds drop N/E/S);
//     n' = clamp(roundHalfEven(f32(f32(n·P(tpl))/f(tpl)) / f32(P(new)/f(new))), 1, 5) per ACTION (P = enemies.json
//     attrPower, f = beFactor), unit i spawning at time + i·max(n·interval/n', 0.05·n·interval) (same window);
//     literal keys (R1 源石虫, leader escorts) and T/TF tokens are kept; 炎佑 (enemy_9012_acloon) is never an enemy
//   * leader / hidden rounds use the pick of their own slot (14, 15; solo 标准 9), so only E or EF escorts spawn
//   * stat scaling: mods = config.modes[m].enemyScale[r] (the PRTS table = the ENEMY effects 攻坚装备 / 补给线 / 急行军,
//     which hit every enemy but 炎佑 — no other multiplier), also for bounty enemies and leader parts; the leader takes
//     the ATK / speed multipliers but never HP (its HP is the shared server pool)
//   * every SpawnSpec = one action ({ time, enemyKey, routeIndex, count, interval, mods, actionIndex, preview }):
//     `mods.slot` (placeholder class) lets 联防 route leaks, `preview` = { gate, start, fly, elite, boss } feeds previewOf
// Bounties (bountySpawns / withBounties): each bounty unit joins the round template's first `lrsldr` (walker) / `yokai`
// (flyer) action (else action 0), inserted among that action's own units at floor((i+1)·len/(n+1)), and the whole list
// is spread over the action window (client `_InsertSpActionToNormal` + `_CalculateActionPredelay`, decoded).
// 联防 (buildUniteWave): walkers → the escaped template's `lrsldr` action, flyers → `yokai`, tokens → `gopro_2` /
// `lazerd` (else action 0); owner k starts 0.5·k s after the action, units step min(max(W/M, 0.05·W), 5 s) with M the
// largest owner group (client `_CalculateActionPredelayConsiderUid`, decoded).

import { createRng, deriveSeed } from '../sim/rng.js';
import { PLUGIN_ACTION_UNITS } from '../../shared/plugins/limits.js';
import { OFFICIAL_LAYOUT, layoutOf, bossAreaBattleRect } from '../../shared/layout.js';
// 「自缚不走路」的巨型首领（萨米的意志 / 阿利斯泰尔 / 昆图斯 / 胄 / 管）：引擎内容层声明的那一份（见 bossStandsStill）
import { SELF_BOUND } from '../sim/content/bosses.js';

const ACLOON = 'enemy_9012_acloon';
const DEFAULT_PLACEHOLDERS = Object.freeze({
  N: { cls: 'normal', fly: false }, E: { cls: 'elite', fly: false }, S: { cls: 'special', fly: false },
  NF: { cls: 'normal', fly: true }, EF: { cls: 'elite', fly: true }, SF: { cls: 'special', fly: true },
});
const MIN_ACTION_INTERVAL_RATIO = 0.05;
/** The most units one wave action fields (templateSpawns' count clamp; replacedCount and bountyPlan stay within it) — the
 * data-plugin check caps the replaced counts at the same number (shared/plugins/limits.js). */
const MAX_ACTION_UNITS = PLUGIN_ACTION_UNITS;
/** 联防 timing (client `_CalculateActionPredelayConsiderUid`): owner offset ACTION_INTERVAL_FOR_UID, unit step cap
 * MAX_ACTION_INTERVAL_FOR_UID. */
const UNITE_OWNER_STEP = 0.5;
const UNITE_MAX_UNIT_STEP = 5;

/** Weighted pick of [id, weight] pairs with the rng. */
export function weightedPick(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, Number(w) || 0);
  if (total <= 0) return pairs.length ? pairs[0][0] : null;
  let r = rng() * total;
  for (const [id, w] of pairs) { r -= Math.max(0, Number(w) || 0); if (r < 0) return id; }
  return pairs[pairs.length - 1][0];
}

/** C# Math.Round(double): banker's rounding (half to even). */
export function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.floor(x + 0.5);
}

const gen = (gd) => (gd.factions.generation && typeof gd.factions.generation === 'object' ? gd.factions.generation : {});
const intOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

/**
 * 模式级阵营排程（重构模拟的 `factionSetup`；官方模式没有这个键 ⇒ null，官方抽取逐字节不变）。
 * 形状见 `shared/reconModes.js` 的 `RECON_FACTION_SETUP`。
 */
const factionSetup = (gd) => (gd.mode && typeof gd.mode === 'object' && gd.mode.factionSetup && typeof gd.mode.factionSetup === 'object' ? gd.mode.factionSetup : null);

/** 这个随机类型在本局的合并数据里至少有一条可用的敌人记录（包缺席的 DIMO 不算可用）。 */
function typeUsable(gd, type) {
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const t = types[type];
  if (!t) return false;
  if (Array.isArray(t.pool) && t.pool.some((k) => typeof k === 'string' && gd.enemy(k))) return true;
  const entries = gd.factions.entries && typeof gd.factions.entries === 'object' ? gd.factions.entries : {};
  return Object.values(entries).some((e) => e && e.type === type && typeof e.key === 'string' && gd.enemy(e.key));
}

/** Official movement class of an enemy key (randomEnemyAttributeDict.isFlyEnemy, else its motion). */
export function isFlyKey(gd, key) {
  const e = gd.enemy(key);
  if (!e) return false;
  if (typeof e.isFlyEnemy === 'boolean') return e.isFlyEnemy;
  return !!(e.stats && e.stats.motion === 'FLY');
}

/** Official attribute power P(k) (float32), enemies.json `attrPower`; derived from the stats when absent. */
export function attrPower(gd, key) {
  const e = gd.enemy(key);
  if (!e) return 0;
  if (typeof e.attrPower === 'number' && Number.isFinite(e.attrPower)) return e.attrPower;
  const s = e.stats || {};
  const f = Math.fround;
  const bf = gen(gd).beFactors || {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let p = f(f(f(n(s.atk) * (bf.atk ?? 5)) + f(n(s.maxHp) * (bf.hp ?? 1))) + f(n(s.def) * (bf.def ?? 3)));
  p = f(p + f((bf.res ?? 3) * n(s.res)));
  return p;
}

const beFactor = (gd, key) => {
  const v = gd.enemy(key)?.beFactor;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
};

/**
 * Units a placeholder action of `n` template enemies becomes (client `_CalculateEnemyCountByBattleEffectiveness`):
 * clamp(roundHalfEven(f32(f32(f32(n·P(t))/f(t)) / f32(P(new)/f(new)))), min, max).
 */
export function replacedCount(gd, tplKey, n, newKey) {
  const g = gen(gd);
  // (bounded like a template action's own count — templateSpawns' 1–50: a data plugin's 4e7 would be one action's units,
  // and an array of them in bountyPlan; the official 1 / 5 are unchanged)
  const min = Math.max(1, Math.min(MAX_ACTION_UNITS, Number.isInteger(g.minReplacedEnemyCount) ? g.minReplacedEnemyCount : 1));
  const max = Math.max(1, Math.min(MAX_ACTION_UNITS, Number.isInteger(g.maxReplacedEnemyCount) ? g.maxReplacedEnemyCount : 5));
  const f = Math.fround;
  const origin = f(f(n * attrPower(gd, tplKey)) / beFactor(gd, tplKey));
  const unit = f(attrPower(gd, newKey) / beFactor(gd, newKey));
  if (!(unit > 0)) return min;
  const ratio = f(origin / unit);
  return Math.max(min, Math.min(max, roundHalfEven(ratio)));
}

/** Placeholder key → { slot, cls, fly } (factions.generation.placeholders, else built from templateSlots). */
function placeholderMap(gd) {
  const g = gen(gd);
  if (g.placeholders && typeof g.placeholders === 'object') return g.placeholders;
  const out = {};
  const ts = gd.factions.templateSlots && typeof gd.factions.templateSlots === 'object' ? gd.factions.templateSlots : {};
  for (const [slot, key] of Object.entries(ts)) if (DEFAULT_PLACEHOLDERS[slot]) out[key] = { slot, ...DEFAULT_PLACEHOLDERS[slot] };
  return out;
}

const firstHalfMax = (gd) => intOr(gen(gd).firstHalfMaxRound, Math.floor(intOr(gen(gd).maxLevelCnt, 15) / 2));

/** The special entry list (factions.json entries) sorted by key. */
function entryList(gd) {
  const e = gd.factions.entries && typeof gd.factions.entries === 'object' ? Object.values(gd.factions.entries) : [];
  return e.filter((x) => x && typeof x.key === 'string').sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The round pick of a type (client `_GenerateRandomEnemyData`): weighted entry of that type and half whose SPECIAL key
 * is allowed in the mode, plus a random attached normal / elite key (never filtered by the mode).
 * @returns {null | { round: number, type: string, key: string, normal: string|null, elite: string|null, fly: boolean, firstHalf: boolean }}
 */
export function pickRoundEntry(gd, rng, type, round) {
  const half = round <= firstHalfMax(gd);
  const ok = (e) => e.type === type && !!e.firstHalf === half && e.key !== ACLOON && !!gd.enemy(e.key) && !gd.inactiveEnemies.has(e.key);
  let cands = entryList(gd).filter(ok);
  if (!cands.length && type !== 'SPECIAL') return pickRoundEntry(gd, rng, 'SPECIAL', round);
  if (!cands.length) return null;
  const idx = weightedPick(rng, cands.map((e, i) => [i, e.weight ?? 1]));
  const e = cands[Number(idx) || 0];
  const pickKey = (list) => {
    const keys = (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x && x.key)).filter((k) => typeof k === 'string' && gd.enemy(k) && k !== ACLOON);
    return keys.length ? keys[Math.floor(rng() * keys.length)] : null;
  };
  return { round, type: e.type, key: e.key, normal: pickKey(e.N), elite: pickKey(e.E), fly: typeof e.fly === 'boolean' ? e.fly : isFlyKey(gd, e.key), firstHalf: half };
}

/**
 * Round type schedule: each chosen type × its slot count, filled with SPECIAL to the schedule length, shuffled.
 *
 * 官方：长度 = `generation.maxLevelCnt`（15）。重构模拟（`gd.mode.factionSetup`）把长度拉到 21，并把涤墨钉在固定回合
 * （`fixedRounds`）、另两个类型按 `typeCounts` 占位，其余填 `SPECIAL`。没有 `factionSetup` 时这段代码与从前逐字节
 * 相同（同一数组、同一次 `shuffle`）。
 */
export function makeTypeSchedule(gd, rng, factions) {
  const g = gen(gd);
  const fs = factionSetup(gd);
  const max = Math.min(256, Math.max(0, intOr(fs && fs.rounds, intOr(g.maxLevelCnt, 15)))); // loop-cap: schedule length [ASSUMED] DESIGN §34.5
  const fill = typeof g.fillType === 'string' ? g.fillType : (typeof g.alwaysIncludedType === 'string' ? g.alwaysIncludedType : 'SPECIAL');
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const fixed = fs && fs.fixedRounds && typeof fs.fixedRounds === 'object' ? fs.fixedRounds : null;
  const slots = new Array(max).fill(null);
  const pinned = {};
  if (fixed) {
    for (const [type, list] of Object.entries(fixed)) {
      if (!Array.isArray(list) || !factions.includes(type)) continue;
      for (const r of list) {
        if (Number.isInteger(r) && r >= 1 && r <= max && slots[r - 1] === null) { slots[r - 1] = type; pinned[type] = (pinned[type] || 0) + 1; }
      }
    }
  }
  const pinnedCount = Object.values(pinned).reduce((s, n) => s + n, 0);
  const rest = [];
  for (const t of factions) {
    const want = intOr(fs && fs.typeCounts && fs.typeCounts[t], intOr(types[t]?.count, 3));
    const n = Math.max(0, want - (pinned[t] || 0));
    for (let i = 0; i < n; i++) rest.push(t);
  }
  while (rest.length < max - pinnedCount) rest.push(fill); // official: type tokens + SPECIAL fill, exactly as before
  if (rest.length > max - pinnedCount) rest.length = max - pinnedCount; // loop-cap: schedule length
  rng.shuffle(rest);
  for (let i = 0, k = 0; i < max; i++) if (slots[i] === null) slots[i] = k < rest.length ? rest[k++] : fill;
  return slots;
}

function scheduleRng(rng) {
  const seed = typeof rng.state === 'function' ? deriveSeed(rng.state(), 'waves:schedule') : Math.floor(rng() * 4294967296);
  return createRng(seed);
}

/**
 * 重构模拟的涤墨两档池（`phase` = 'base' | 'reinforced'）：
 *   * `base` —— R1–R10，键名**不带** `_2`（操戈 / 挽弓 / 拔山 / 浪里玄条 / 霜劫 / 旺财 / “果腹” / 云中墨贼）；
 *   * `reinforced` —— R11 起，键名**以** `_2` 结尾（操戈·凌 / 挽弓·鸣 / 拔山·盖 / 挟潮·来 / 浪里玄条·锈 / 云中墨贼·蚀 /
 *     招财 / “饱食” / 飘香）。
 * 每档再按 `NORMAL` 地面 / `ELITE` 地面 / 飞行拆成三个池；源键必须在本局数据里真的有敌人记录（包缺席时为空）。
 * @returns {{ normal: string[], elite: string[], fly: string[] }}
 */
function dimoPools(gd, phase) {
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const source = types.DIMO && Array.isArray(types.DIMO.pool) ? types.DIMO.pool : [];
  const out = { normal: [], elite: [], fly: [] };
  for (const key of source.slice().sort()) {
    if (typeof key !== 'string' || !gd.enemy(key) || gd.inactiveEnemies.has(key)) continue;
    if ((phase === 'reinforced') !== key.endsWith('_2')) continue;
    if (isFlyKey(gd, key)) { out.fly.push(key); continue; }
    (gd.enemy(key).rank === 'NORMAL' ? out.normal : out.elite).push(key);
  }
  return out;
}

/**
 * 一个涤墨回合的 pick。**出怪不在这里**：6 个涤墨回合的模板（`workshop/mode-recon/waves.json` 的 `recon_rNN`）
 * 直接写涤墨键与数量（业主 2026-10-29 的固定表），所以 `key/normal/elite` 只给 `entriesView`（敌方情报）用，
 * 模板里没有占位符就不会被替换。
 */
function dimoPick(gd, r) {
  const pool = dimoPools(gd, r <= 10 ? 'base' : 'reinforced');
  const ground = [...pool.normal, ...pool.elite];
  if (!ground.length && !pool.fly.length) return null;
  const rep = ground[0] ?? pool.fly[0];
  return {
    round: r, type: 'DIMO', key: rep,
    normal: pool.normal[0] ?? rep, elite: pool.elite[0] ?? rep,
    fly: false, firstHalf: r <= firstHalfMax(gd),
  };
}

/**
 * @param {import('./gamedata.js').GameData} gd
 * @param {Function} rng
 * @returns {{ stageId: string|null, factions: string[], bossId: string|null, hiddenBossId: string|null, typeSlots: string[], picks: object[] }}
 *   `factions` also carries the schedule as a non-enumerable `schedule` property ({ typeSlots, picks }), so callers
 *   that keep only the factions array (Match: buildNormalWave(gd, rng, this.factions, r)) get the official rounds.
 */
export function setupMatchWaves(gd, rng) {
  // stage
  const stageIds = Array.isArray(gd.mode.stages) ? gd.mode.stages : [];
  const stagePairs = stageIds.map((id) => [id, gd.stage(id)]).filter(([, s]) => s && s.active !== false && Number(s.weight) > 0).map(([id, s]) => [id, s.weight]);
  let stageId = stagePairs.length ? weightedPick(rng, stagePairs) : null;
  if (!stageId) {
    const any = Object.keys(gd.raw.stages || {}).filter((id) => gd.stage(id) && gd.stage(id).active);
    stageId = any.length ? any.sort()[0] : null;
  }
  // factions
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const n = Number.isInteger(gen(gd).specialEnemyNum) ? gen(gd).specialEnemyNum : 3;
  const random = Object.values(types).filter((t) => t && t.involveRandom).map((t) => t.type).sort();
  // 模式级必选类型（重构模拟的 DIMO）：本局数据里真的可用，且「在随机池里、或标了 reconOnly（只出现在重构模拟）」才强制。
  // DIMO 的 involveRandom 是 false（reconOnly），所以它不在 random 里，官方模式也永远不会抽到它。
  const fs = factionSetup(gd);
  const forced = (Array.isArray(fs && fs.forceTypes) ? fs.forceTypes : []).filter((t) => typeUsable(gd, t) && (random.includes(t) || types[t]?.reconOnly === true));
  const shuffled = random.filter((t) => !forced.includes(t));
  rng.shuffle(shuffled);
  const chosen = [...forced, ...shuffled].slice(0, Math.min(n, random.length));
  const factions = chosen.slice().sort((a, b) => (types[a]?.sortId ?? 9) - (types[b]?.sortId ?? 9));
  // bosses
  const bw = gd.bossWeights(false);
  const bossId = bw.length ? weightedPick(rng, bw) : null;
  const hw = gd.bossWeights(true);
  const hiddenBossId = hw.length && gd.hiddenRound ? weightedPick(rng, hw) : null;
  // the round schedule and picks (own rng stream derived from the setup rng's state: the draws above and whatever
  // the caller draws next from `rng` are unchanged)
  const srng = scheduleRng(rng);
  const typeSlots = makeTypeSchedule(gd, srng, chosen);
  // 涤墨：只有重构模拟（带 factionSetup）才用 dimoPick；官方模式里 DIMO 是 reconOnly（involveRandom false），不进随机池。
  const reconDimo = !!factionSetup(gd);
  const picks = [null];
  for (let r = 1; r <= typeSlots.length; r++) {
    const p = reconDimo && typeSlots[r - 1] === 'DIMO' ? dimoPick(gd, r) : null;
    picks.push(p ?? pickRoundEntry(gd, srng, typeSlots[r - 1], r));
  }
  Object.defineProperty(factions, 'schedule', { value: Object.freeze({ typeSlots: typeSlots.slice(), picks }), enumerable: false });
  return { stageId, factions, bossId, hiddenBossId, typeSlots, picks };
}

/**
 * The pick of round r: from a setup object ({ picks }), a factions array carrying the hidden schedule, or — for a plain
 * factions array (tools, tests) — drawn now: the round's type from the schedule's marginal distribution (each faction
 * 3 of 15 slots, SPECIAL the rest), then its entry.
 */
export function roundPick(gd, rng, factionsOrSetup, round) {
  const src = factionsOrSetup;
  const picks = src && !Array.isArray(src) && Array.isArray(src.picks) ? src.picks : (src && src.schedule && Array.isArray(src.schedule.picks) ? src.schedule.picks : null);
  if (picks) return picks[round] ?? null;
  const factions = Array.isArray(src) ? src : (src && Array.isArray(src.factions) ? src.factions : []);
  const g = gen(gd);
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const max = intOr(g.maxLevelCnt, 15);
  const pairs = factions.map((t) => [t, intOr(types[t]?.count, 3)]);
  const used = pairs.reduce((s, [, w]) => s + w, 0);
  pairs.push([typeof g.fillType === 'string' ? g.fillType : 'SPECIAL', Math.max(1, max - used)]);
  return pickRoundEntry(gd, rng, weightedPick(rng, pairs), round);
}

/** Enemy scale mods for round r (bosses excluded by the caller). */
export function scaleFor(gd, r) {
  return gd.enemyScale(r);
}

/** The spawn mods of a round's scale for a non-leader enemy: HP / ATK / speed, plus `supplyHpMul` when the round has one. */
export function roundMods(scale) {
  const m = { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul };
  if (scale.supplyHpMul != null) m.supplyHpMul = scale.supplyHpMul;
  return m;
}

/** Slot class of an enemy that has no placeholder slot (literal template keys, bounty adds). */
export function classOf(gd, enemyKey) {
  const e = gd.enemy(enemyKey);
  const fly = isFlyKey(gd, enemyKey);
  const elite = !!(e && e.rank === 'ELITE');
  if (fly) return elite ? 'EF' : 'NF';
  return elite ? 'E' : 'N';
}

/** Preview pen upper zone anchor row ((18,7); the lower anchor is (15,7)) and the client's row offsets. */
const PEN_UPPER_ROW = 18;
const PREVIEW_ROW_OFFSET = 6;
const PREVIEW_ROW_OFFSET_LEADER = 13;

/**
 * 'upper' | 'lower' preview zone of a route start (client `AutoChessEnemyPreviewManager`, research 08 §4.2): target row =
 * start row + 6 (leader rounds: + 13); the zone is the Manhattan-nearest anchor among those with anchor row ≤ target
 * row — (18,7) upper, (15,7) lower — so only a target row ≥ 18 reaches the upper zone: normal fields row 12 (upper
 * gate (12,10); rows 9–11 lower), boss fields row 5 (rows 2–4 lower: the leaders at (3,x)/(4,x) and the (2,10) gate).
 * A target below row 15 has no zone (the client picks a random pen tile) and is reported 'lower'.
 * @param {number[]|null} start [row, col]
 * @param {boolean} [leader] leader / hidden round (default: a boss-field row, ≤ 8)
 */
export function gateOf(start, leader) {
  const r = Array.isArray(start) ? start[0] : null;
  if (!Number.isFinite(r)) return 'lower';
  const lead = typeof leader === 'boolean' ? leader : r <= 8;
  const target = r + (lead ? PREVIEW_ROW_OFFSET_LEADER : PREVIEW_ROW_OFFSET);
  // both anchors share col 7, so with target ≥ 18 the upper one is always the nearer; below it only (15,7) qualifies
  return target >= PEN_UPPER_ROW ? 'upper' : 'lower';
}

const isLeaderTemplate = (tpl) => !!tpl && (tpl.kind === 'boss' || tpl.kind === 'hidden');

export function previewInfo(gd, key, route, boss = false, leader = undefined) {
  const e = gd.enemy(key);
  const start = route && Array.isArray(route.start) ? route.start.slice(0, 2) : null;
  return { gate: gateOf(start, leader), start, fly: isFlyKey(gd, key), elite: !!(e && e.rank && e.rank !== 'NORMAL'), boss };
}

/**
 * The actions of a template with the round pick applied.
 * @returns {{ spawns: object[], actions: object[] }} actions[i] = { index, key, tplKey, slot, time, count, tplCount, window, routeIndex, valid,
 *   server } (`server` = client ShouldActionUpToServer: valid, not the leader, no random spawn group)
 */
function templateSpawns(gd, tpl, round, pick) {
  const scale = scaleFor(gd, round);
  const ph = placeholderMap(gd);
  const routes = Array.isArray(tpl.routes) ? tpl.routes : [];
  const leader = isLeaderTemplate(tpl);
  const spawns = [];
  const actions = [];
  const list = Array.isArray(tpl.spawns) ? tpl.spawns : [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
    const key0 = s.key ?? s.enemyKey;
    if (typeof key0 !== 'string' || key0 === ACLOON) continue;
    const tag = s.tag ?? null;
    const isBoss = tag === 'boss';
    const isPart = tag === 'part';
    const n = Math.max(1, Math.min(50, Number.isInteger(s.count) ? s.count : 1));
    const interval = Math.max(0, Number(s.interval) || 0);
    const time = Math.max(0, Number(s.time) || 0);
    const routeIndex = Number.isInteger(s.routeIndex) ? s.routeIndex : 0;
    const window = n * interval;
    let key = key0;
    let count = n;
    let step = interval;
    const p = !isBoss && !isPart ? ph[key0] : null;
    if (p && pick) {
      const newKey = p.cls === 'special' ? pick.key : p.cls === 'elite' ? pick.elite : pick.normal;
      if (typeof newKey === 'string' && gd.enemy(newKey)) {
        if (isFlyKey(gd, newKey) !== !!p.fly) {
          // the other movement class: not spawned, not sent, not previewed (isValid = false)
          actions.push({ index: i, key: null, tplKey: key0, slot: p.slot ?? s.slot ?? null, time, count: 0, tplCount: n, window, routeIndex, valid: false, server: false });
          continue;
        }
        count = replacedCount(gd, key0, n, newKey);
        step = Math.max(window / count, MIN_ACTION_INTERVAL_RATIO * window);
        key = newKey;
      }
    }
    if (!gd.enemy(key)) continue;
    const slot = s.slot || classOf(gd, key);
    const spec = {
      time,
      enemyKey: key,
      routeIndex,
      count,
      interval: count > 1 ? step : 0,
      // the round multipliers are ENEMY effects on every enemy but 炎佑 (aceffect_enemy_1–5 `enemy_attribute_mul`,
      // enemy_exclude = enemy_9012_acloon): leader parts take them all; the leader takes ATK / speed but not HP — its HP
      // is the server pool, "领袖单位于服务器的生命值加成不受上述加成影响" (PRTS 下半). `supplyHpMul` (roundMods) rides along for
      // the 器物 hit-count units, which 补给线 / 补给线II leave out (archetypes.js `times`; also a 频次 enemy's death spawn)
      mods: isBoss ? { atkMul: scale.atkMul, speedMul: scale.speedMul, slot } : { ...roundMods(scale), slot },
      actionIndex: i,
      preview: previewInfo(gd, key, routes[routeIndex], isBoss, leader),
    };
    if (tag) spec.tag = tag;
    if (s.unharmful || isPart) spec.countInTotal = false;
    spawns.push(spec);
    // client ShouldActionUpToServer: valid, not the leader, no randomSpawnGroupKey — only those units are in the list a
    // bounty is inserted into (the others spawn locally on their own timing)
    actions.push({ index: i, key, tplKey: key0, slot: s.slot ?? null, time, count, tplCount: n, window, routeIndex, valid: true, server: !isBoss && !s.group });
  }
  return { spawns, actions };
}

function entriesView(gd, pick) {
  if (!pick) return { ground: null, fly: null };
  const e = gd.factions.entries && gd.factions.entries[pick.key];
  const view = e ? { ...e, pick } : { key: pick.key, type: pick.type, firstHalf: pick.firstHalf, pick };
  return pick.fly ? { ground: null, fly: view } : { ground: view, fly: null };
}

/**
 * Shared composition of a normal round.
 * @param {string[]|object} factions setupMatchWaves().factions (carries the schedule), the setup object, or a plain
 *   factions array (the round's type is then drawn with `rng`)
 * @returns {{ templateId: string|null, spawns: object[], routes: object[], extraRoutes: object[], timeLimit: number,
 *   overrides: object, pick: object|null, entries: { ground: object|null, fly: object|null }, actions: object[] }}
 */
/**
 * The round template a STAGE declares for itself, when it declares one (`stage.rounds`).
 *
 * Why this exists: the engine picks the stage (setupMatchWaves, by weight from `mode.stages`) and the round's template
 * (`mode.rounds[r].template`) INDEPENDENTLY — the template never knows which map it will run on. An official template's
 * routes were authored for official geometry, so a workshop map that inherited one would send its enemies down paths its
 * terrain does not have. A stage may therefore carry its own per-round templates; the mode's remain the fallback, and an
 * official stage has no `rounds` field at all, so its behaviour is unchanged.
 *
 * Accepted shapes: `{ "3": "wave_id" }` (or an array indexed by round), and `{ "3": { template: "wave_id" } }`.
 * @returns {string|null} a template id that EXISTS, else null (so a typo falls back instead of breaking the round)
 */
function stageTemplateId(gd, stageId, round) {
  if (!stageId) return null;
  const stage = gd.stage(stageId);
  const rounds = stage && stage.rounds;
  if (!rounds) return null;
  const v = Array.isArray(rounds) ? rounds[round] : (typeof rounds === 'object' ? rounds[String(round)] : null);
  const id = typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.template === 'string' ? v.template : null);
  return typeof id === 'string' && gd.wave(id) ? id : null;
}

/**
 * The stage's own boss-round template for the leader this round DREW (`stage.bossRounds[round][bossId]`), else null.
 *
 * Only the drawn leader's own entry counts (the owner's report 「协防 boss 战不能正常刷新」). Until 0.7.1 a missing
 * entry fell back to the first string in the map, so a stage that lists fewer leaders than `mode.bossWeights` has
 * (hand-written or imported packs; the editor writes all of them) fought a DIFFERENT leader than the round drew: the
 * shared pool is built from the drawn bossId's bloodPoint (finalAssault.js), so the leader never matched its own HP
 * bar, and an entry pointing at a normal wave left the round with no leader at all — the pool could never drain and
 * the round could only end by LP loss / overtime. A missing entry now means "no stage override", i.e. the OFFICIAL
 * wave for the drawn leader (buildBossWave's `rc.bossTemplates`), which is what the author of a partial map expects.
 */
function stageBossTemplateId(gd, stageId, round, bossId) {
  if (!stageId) return null;
  const stage = gd.stage(stageId);
  const perRound = stage && stage.bossRounds && typeof stage.bossRounds === 'object' ? stage.bossRounds[String(round)] : null;
  if (!perRound || typeof perRound !== 'object') return null;
  const id = typeof perRound[bossId] === 'string' ? perRound[bossId] : null;
  return typeof id === 'string' && gd.wave(id) ? id : null;
}

/**
 * The leaders a stage's `bossRounds[round]` should list: every bossId the mode can draw for that round. Used by the
 * workshop validator to warn about a partial map (which now silently uses the official wave for the rest).
 * @returns {string[]} drawn-capable bossIds (empty when the round is not a leader round)
 */
export function stageBossIdsFor(gd, round) {
  if (!gd || !Number.isInteger(round)) return [];
  const hidden = gd.hiddenRound != null && round === gd.hiddenRound && round !== gd.bossRound;
  return Object.keys((hidden ? gd.mode.hiddenBossWeights : gd.mode.bossWeights) || {}).sort();
}

export function buildNormalWave(gd, rng, factions, round, stageId = null) {
  const rc = gd.roundCfg(round);
  let templateId = stageTemplateId(gd, stageId, round) ?? (rc && typeof rc.template === 'string' ? rc.template : null);
  // 重构模拟：包被停用 / 被删时，回合条目带着官方基底模板的 id，退回它而不是空场（官方回合没有这个键）。
  if (templateId && !gd.wave(templateId) && rc && typeof rc.templateFallback === 'string') templateId = rc.templateFallback;
  const tpl = templateId ? gd.wave(templateId) : null;
  const timeLimit = gd.combatTimeLimit(round);
  if (!tpl) return { templateId, spawns: [], routes: [], extraRoutes: [], timeLimit, overrides: {}, pick: null, entries: { ground: null, fly: null }, actions: [] };
  const pick = roundPick(gd, rng, factions, round);
  const { spawns: raw, actions } = templateSpawns(gd, tpl, round, pick);
  // 地图自己画的路线（业主 2026-10-26「敌人的行动路径按照我在地图上画的 8 条路线来」）：整张路线表换成地图的，
  // 每条出怪按移动方式换到这张表里（同组第 k 条，让作者画的多条变体轮着走）。左右半场的选择留给各自战场
  // （combat.js 按 side 再选一次）—— 这里只保证 routeIndex 不再指向模板的官方路线。
  const own = stageRoutesOf(gd, stageId);
  const routes = own ?? (Array.isArray(tpl.routes) ? tpl.routes : []);
  const mid = own ? layoutOf(gd.stage(stageId)).mirrorCol / 2 : OFFICIAL_MID_COL;
  const spawns = own
    ? raw.map((s, i) => routeSpawn(gd, routes, s, { mid, k: Number.isInteger(s.actionIndex) ? s.actionIndex : i }))
    : raw;
  return {
    templateId,
    spawns,
    routes,
    extraRoutes: Array.isArray(tpl.extraRoutes) ? tpl.extraRoutes : [],
    timeLimit,
    overrides: tpl.overrides && typeof tpl.overrides === 'object' ? tpl.overrides : {},
    pick,
    entries: entriesView(gd, pick),
    actions,
  };
}

/**
 * Boss / hidden round template for one boss field; escorts follow the pick of the round's own slot.
 *
 * `areaIndex`（第几块 boss 场地）：地图给这块场地画了路线时，**首领与部位**改走地图自己的路线（起点 = 首领中心、
 * 终点回起点），护送小怪仍走模板路线 —— 于是首领站/巡在自己的场地上，不会顺着官方那条路走错门。
 * @param {{ bossId: string, solo: boolean, areaIndex?: number }} opts solo → `_s` template (lone player or solo mode)
 */
export function buildBossWave(gd, rng, factions, round, { bossId, solo, areaIndex = 0 }, stageId = null) {
  const rc = gd.roundCfg(round);
  const map = rc && rc.bossTemplates && typeof rc.bossTemplates === 'object' ? rc.bossTemplates : {};
  let templateId = stageBossTemplateId(gd, stageId, round, bossId) || (typeof map[bossId] === 'string' ? map[bossId] : null);
  if (!templateId) {
    // Last resort for data that has no entry for the DRAWN leader at all (the official tables cover every drawable
    // bossId, so this only fires on a stage whose override names a wave that does not exist — see stageBossTemplateId,
    // which deliberately never borrows another leader's wave). Some leader beats none: the round still has enemies.
    const first = Object.values(map).find((v) => typeof v === 'string');
    templateId = first || null;
  }
  if (templateId && solo && !/_s$/.test(templateId) && gd.wave(`${templateId}_s`)) templateId = `${templateId}_s`;
  if (templateId && !solo && /_s$/.test(templateId) && gd.wave(templateId.replace(/_s$/, ''))) templateId = templateId.replace(/_s$/, '');
  const tpl = templateId ? gd.wave(templateId) : null;
  if (!tpl) return { templateId, spawns: [], routes: [], extraRoutes: [], timeLimit: Infinity, overrides: {}, pick: null, entries: { ground: null, fly: null }, actions: [] };
  const pick = roundPick(gd, rng, factions, round);
  const { spawns: raw, actions } = templateSpawns(gd, tpl, round, pick);
  // 首领与部位换到地图自己的 boss 路线（两条轮流）；护送小怪保持模板路线（它们要沿那条路走去防守点）
  const arena = stageBossRoutesOf(gd, stageId, areaIndex);
  const leaderTpl = isLeaderTemplate(tpl);
  // 地图给这块场地画了自己的路线时，模板里那几条**官方 19×21** 路线在 45×60 的图上落在场地外（sim 会把越界的
  // 坐标夹回战场边缘 ⇒ 护送小怪贴着边界蹭）。这里把模板路线**按比例缩放**进这块场地的战斗矩形 —— 护送小怪与悬赏
  // 敌人因此也沿地图上的路线走（业主 2026-10-29「战斗场地敌人行走路线没有跟着地图来」）。
  const arenaRect = arena.length ? bossAreaBattleRect(layoutOf(gd.stage(stageId)), areaIndex) : null;
  const routes = arenaRect && Array.isArray(tpl.routes)
    ? tpl.routes.map((r) => scaleRoute(r, OFFICIAL_LAYOUT.battle.boss, arenaRect))
    : (Array.isArray(tpl.routes) ? tpl.routes : []);
  const spawns = arena.length
    ? raw.map((s, i) => {
      if (s.tag === 'boss' || s.tag === 'part') {
        const route = arena[i % arena.length];
        return { ...s, route, preview: previewInfo(gd, s.enemyKey, route, s.tag === 'boss', leaderTpl) };
      }
      const route = routes[Number.isInteger(s.routeIndex) ? s.routeIndex : 0] ?? routes[0] ?? null;
      return route ? { ...s, preview: previewInfo(gd, s.enemyKey, route, false, leaderTpl) } : s;
    })
    : raw;
  return {
    templateId,
    spawns,
    routes,
    extraRoutes: Array.isArray(tpl.extraRoutes) ? tpl.extraRoutes : [],
    timeLimit: Infinity,
    overrides: tpl.overrides && typeof tpl.overrides === 'object' ? tpl.overrides : {},
    pick,
    entries: entriesView(gd, pick),
    actions,
  };
}

/**
 * Boss-field column that splits the left (L) and the right (R) player's half — the OFFICIAL layout's middle column,
 * where the two halves meet (the goals are at cols 2–3 / 17). A map carries its own: the middle column is
 * `layout.mirrorCol / 2` (shared/layout.js `bandMidOf`), so every boss-field caller passes it in.
 */
const OFFICIAL_MID_COL = OFFICIAL_LAYOUT.mirrorCol / 2;

/**
 * Route index of the first template route with the requested motion (fallback 0). `side` ('L' | 'R') prefers a route
 * that ends on that player's half of a boss field (pair templates route to both goals). `mid` is that field's middle
 * column (the map's own; OFFICIAL_MID_COL when omitted).
 */
export function routeByMotion(routes, fly, side = null, mid = OFFICIAL_MID_COL) {
  const ok = (r) => r && (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
  if (side === 'L' || side === 'R') {
    const j = routes.findIndex((r) => ok(r) && Array.isArray(r.end) && (side === 'R' ? r.end[1] > mid : r.end[1] < mid));
    if (j >= 0) return j;
  }
  const i = routes.findIndex(ok);
  return i >= 0 ? i : 0;
}

/**
 * 一条敌人路线属于哪个半场：按它的终点列落在 `mid` 的哪一侧。地图自己画的 8 条路线就是这样分成左右各 4 条的。
 * @param {Array<object>} routes @param {number} i
 */
export function routeSideOf(routes, i, mid = OFFICIAL_MID_COL) {
  const r = Array.isArray(routes) ? routes[i] : null;
  if (!r || !Array.isArray(r.end)) return null;
  return r.end[1] > mid ? 'R' : 'L';
}

/**
 * 能承载「这种移动方式、这个半场」的敌人的路线下标，按表里的顺序（地图画的同半场同移动方式的多条路线都在里面，
 * 调用方用 `k` 轮换使用它们）。半场一条都没有时退到「这种移动方式的全部路线」——目标不在两半上的图仍能出怪。
 * @param {Array<object>} routes @param {boolean} fly @param {'L'|'R'|null} side @param {number} mid
 * @returns {number[]}
 */
export function routeGroup(routes, fly, side = null, mid = OFFICIAL_MID_COL) {
  const all = Array.isArray(routes) ? routes : [];
  const motion = (r) => r && (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
  const half = (r) => !(side === 'L' || side === 'R')
    || (Array.isArray(r.end) && (side === 'R' ? r.end[1] > mid : r.end[1] < mid));
  let list = all.map((r, i) => i).filter((i) => motion(all[i]) && half(all[i]));
  if (!list.length) list = all.map((r, i) => i).filter((i) => motion(all[i]));
  return list;
}

/**
 * `routeGroup` 里第 `k` 条（取模轮换）的下标；一组都没有时退回 `routeByMotion`。
 */
export function routeIndexIn(routes, fly, side = null, mid = OFFICIAL_MID_COL, k = 0) {
  const g = routeGroup(routes, fly, side, mid);
  if (!g.length) return routeByMotion(routes, fly, side, mid);
  return g[((k % g.length) + g.length) % g.length];
}

/**
 * 把一条出怪放到**这张图的路线表**上：按它的移动方式与半场选一条（同组里的第 `k` 条，让作者画的几条变体轮着走），
 * 预览（等待区的起点 / 是否空中）跟着那条路线走；`ownerPlayerId` 给定时一并写上——漏怪按它的主人/半场扣 LP。
 *
 * 官方图没有自己的路线表，`routes` 仍是模板那 3 条、`side` 传不传都一样（半场没有路线就退回同移动方式的第一条），
 * 所以官方行为不变；真正改变行为的是「地图声明了 routes」的图（45×60 重构战场）。
 * @param {{}} gd @param {Array<object>} routes @param {object} spawn
 * @param {{ side?: 'L'|'R'|null, mid?: number, k?: number, ownerPlayerId?: string }} [o]
 */
export function routeSpawn(gd, routes, spawn, { side = null, mid = OFFICIAL_MID_COL, k = 0, ownerPlayerId } = {}) {
  const owned = ownerPlayerId ? { ownerPlayerId } : {};
  if (!spawn || !Array.isArray(routes) || !routes.length) return { ...spawn, ...owned };
  const fly = isFlyKey(gd, spawn.enemyKey);
  const routeIndex = routeIndexIn(routes, fly, side, mid, k);
  return {
    ...spawn,
    ...owned,
    routeIndex,
    preview: previewInfo(gd, spawn.enemyKey, routes[routeIndex], false, undefined),
  };
}

/**
 * 这张图的 boss 场地区域（含第 1 块 = `layout.battle.boss`）：`[{ i, rect }]`。
 * 业主 2026-10-29 给四块 boss 区域各画了两条路线，起点落在这些矩形里 —— 用矩形把它们和普通回合的路线区分开。
 */
function bossAreaRects(layout) {
  const l = layout || OFFICIAL_LAYOUT;
  const out = [{ i: 0, rect: bossAreaBattleRect(l, 0) }];
  const areas = Array.isArray(l.bossAreas) ? l.bossAreas : [];
  for (let i = 1; i < areas.length; i++) out.push({ i, rect: bossAreaBattleRect(l, i) });
  return out;
}

const startInside = (rect, p) => !!rect && Array.isArray(p)
  && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && p[0] >= rect.r0 && p[0] <= rect.r1 && p[1] >= rect.c0 && p[1] <= rect.c1;

/** 这条路线是不是某个 boss 区域的（起点落在该区域的战斗矩形里）。 */
function isBossArenaRoute(layout, route) {
  const p = route && route.start;
  return bossAreaRects(layout).some(({ rect }) => startInside(rect, p));
}

/** 这张图自己画的路线（**不含** boss 区域那几条：那些只给首领用，见 `stageBossRoutesOf`）。 */
export function stageRoutesOf(gd, stageId) {
  const stage = stageId ? gd.stage(stageId) : null;
  const all = stage && Array.isArray(stage.routes) && stage.routes.length ? stage.routes : null;
  if (!all) return null;
  const layout = layoutOf(stage);
  const keep = all.filter((r) => !isBossArenaRoute(layout, r));
  return keep.length ? keep : null;
}

/** 这张图给**这一块** boss 场地画的路线：`stage.routes` 里起点落在该区域战斗矩形内的那些（闭环，起点 = 首领站位）。 */
export function stageBossRoutesOf(gd, stageId, areaIndex = 0) {
  const stage = stageId ? gd.stage(stageId) : null;
  const all = stage && Array.isArray(stage.routes) ? stage.routes : [];
  if (!all.length) return [];
  const rect = bossAreaBattleRect(layoutOf(stage), areaIndex);
  return all.filter((r) => startInside(rect, r && r.start));
}

/**
 * 这只首领是不是「站定不动」的 —— 不沿巡逻线走、站在场地中心，两位玩家同时打它这一只（业主 2026-10-30）。
 * 三个来源：引擎内容层声明的自缚巨型首领（`SELF_BOUND`：萨米的意志 / 阿利斯泰尔 / 昆图斯 / 胄 ×2 / 管 ×2，
 * 它们的「自缚」天赋本来就永不移动）、工坊记录里写了 `stillBoss: true` 的（源阶方 / 洛伦茨 / 岁四部位 /
 * 伤心的大锁）、以及移速 0 的记录（终始）。
 * @param {any} gd @param {string} key 首领的 enemyKey
 */
export function bossStandsStill(gd, key) {
  if (typeof key !== 'string' || !key) return false;
  if (SELF_BOUND.includes(key)) return true;
  const e = gd && typeof gd.enemy === 'function' ? gd.enemy(key) : null;
  if (!e) return false;
  if (e.stillBoss === true) return true;
  const speed = e.stats && Number(e.stats.moveSpeed);
  return Number.isFinite(speed) ? speed <= 0 : false;
}

/**
 * 双人 boss 场地上的第二只**会移动**的首领（业主 2026-10-30，参考原版的卢西恩）：地图给这块场地画了两条巡逻线
 * ⇒ 每位玩家的半场各一只，各自沿自己那条线巡场。站定不动的首领（`bossStandsStill`）仍然只有一只。
 * 已有出怪（含部位）占用的路线优先，第二只拿没人用的那条；没有空线就不补（仍是原来的一只）。
 * @param {any} gd @param {object[]} spawns 一块场地的出怪表（引擎已经在 tag: 'boss' / 'part' 上写好 `route`）
 * @param {object[]} arena `stageBossRoutesOf` 给出的这块场地的巡逻线
 * @returns {object[]} 要追加的出怪（可能为空）
 */
export function mirrorMovingLeaders(gd, spawns, arena) {
  if (!Array.isArray(spawns) || !Array.isArray(arena) || arena.length < 2) return [];
  const used = new Set();
  for (const s of spawns) {
    const i = s && s.route ? arena.indexOf(s.route) : -1;
    if (i >= 0) used.add(i);
  }
  const out = [];
  for (const s of spawns) {
    if (!s || s.tag !== 'boss') continue;
    const key = s.enemyKey ?? s.key;
    if (bossStandsStill(gd, key)) continue;
    for (let i = 0; i < arena.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      const route = arena[i];
      // 两条巡逻线的起点是同一个站位（终点 = 起点），所以预览的坑位 / 起点不变，只有沿途的方向不同
      out.push({ ...s, route, preview: previewInfo(gd, key, route, true, undefined) });
    }
  }
  return out;
}

/**
 * 把模板里的一条路线**按比例**缩放进一块场地的矩形（`from` → `to`）：给自绘地图的 boss 场地的护送小怪用。
 * 模板路线是官方 19×21 板上画的，直接用在 45×60 图上会落在场地外；sim 的 `compileRoute` 会把越界坐标夹回边缘，
 * 敌人于是贴着边界蹭。缩放后起点 / 终点 / 检查点（含 steps 的 `p` / `pos`）都落在 `to` 里。
 * @param {any} route @param {{r0:number,r1:number,c0:number,c1:number}} from @param {{r0:number,r1:number,c0:number,c1:number}} to
 */
export function scaleRoute(route, from, to) {
  if (!route || typeof route !== 'object' || !from || !to) return route;
  const sr = (from.r1 - from.r0) || 1;
  const sc = (from.c1 - from.c0) || 1;
  const tr = to.r1 - to.r0;
  const tc = to.c1 - to.c0;
  const at = (v) => !Array.isArray(v) || typeof v[0] !== 'number' || typeof v[1] !== 'number' ? v
    : [Math.round(to.r0 + ((v[0] - from.r0) / sr) * tr), Math.round(to.c0 + ((v[1] - from.c0) / sc) * tc), ...v.slice(2)];
  const cp = (v) => {
    if (!Array.isArray(v)) return v && typeof v === 'object' ? { ...v, pos: at(v.pos ?? v.position) } : v;
    if (typeof v[0] === 'number') return at(v);
    // [type, r, c, t]（官方少数路线是这个形状）
    const p = at(v.slice(1, 3));
    return Array.isArray(p) && p.length === 2 ? [v[0], p[0], p[1], ...v.slice(3)] : v;
  };
  const out = { ...route };
  out.start = at(route.start);
  out.end = at(route.end);
  if (Array.isArray(route.checkpoints)) out.checkpoints = route.checkpoints.map(cp);
  if (Array.isArray(route.steps)) out.steps = route.steps.map((s) => (s && typeof s === 'object'
    ? { ...s, p: at(s.p), pos: at(s.pos) }
    : s));
  return out;
}


/**
 * 自绘地图上的联防出怪路线（业主 2026-10-27）：
 *   * 单人承接者（站在左半场）：所有漏怪只走**自己这一半的两条地面路线**，按 spawn 顺序轮换；飞行敌人也走地面路线。
 *   * 两位承接者：第一段走**右半场（率先迎敌那位）上方**的那条地面路线，到右半保护目标**不结算**；敌人保留当前状态
 *     （同一个单位）从**下方的敌方入口**（第二段的起点）重新入场，走**左半场下方**的那条地面路线，到左半保护目标
 *     才产生漏怪（LP 仍记在漏怪者头上）。
 * 「上 / 下」按路线**起点行**判（行 0 = 最底，起点行大 = 上方），不写死下标。
 * @returns {null | { routes: object[], pick: (k: number) => { routeIndex: number, route?: object } }}
 *   null = 这张图没有自己的路线表（官方图 / 该半场取不到路线）⇒ 调用方保持旧行为（模板自带路线）。
 */
export function uniteRoutePlan(gd, stageId, helperCount) {
  const routes = stageRoutesOf(gd, stageId);
  if (!routes || !routes.length) return null;
  const mid = layoutOf(gd.stage(stageId)).mirrorCol / 2;
  const rowOf = (r) => (Array.isArray(r && r.start) ? Number(r.start[0]) : NaN);
  // 半场的地面路线；该半场没有地面路线时退到该半场任意路线（仍按起点行判上下）
  const groundOf = (side) => {
    const g = routeGroup(routes, false, side, mid);
    const ids = g.length ? g : routeGroup(routes, true, side, mid);
    return ids.map((i) => ({ i, r: routes[i] })).filter((x) => Number.isFinite(rowOf(x.r)));
  };
  if (helperCount > 1) {
    const right = groundOf('R').sort((a, b) => rowOf(b.r) - rowOf(a.r));
    const left = groundOf('L').sort((a, b) => rowOf(a.r) - rowOf(b.r));
    const first = right[0];
    const second = left[0];
    if (!first || !second) return null;
    const route = reentryRouteOf(first.r, second.r);
    return { routes, pick: () => ({ routeIndex: first.i, route }) };
  }
  const own = groundOf('L');   // 单人承接者站左半场（unite.js 的 colOffset 0）
  if (!own.length) return null;
  return { routes, pick: (k) => ({ routeIndex: own[((k % own.length) + own.length) % own.length].i }) };
}

/**
 * 双人联防的一条两段路线：第一段（右上半场地面）→ 右目标 → 消失 → 从第二段的起点（下方敌方入口）出现 →
 * 第二段（左下地面）→ 结束（左目标，final leg 落地时才 leak）。敌人是同一个单位，HP / buff / mods 一路保留。
 */
function reentryRouteOf(first, second) {
  const steps = [];
  // checkpoints 在地图数据里可能是 [r,c] 数组或带类型的数组/对象；`steps` 只认对象形状，所以统一转一次
  const asStep = (cp) => {
    if (Array.isArray(cp)) {
      if (typeof cp[0] === 'number') return { t: 'MOVE', p: [cp[0], cp[1]], time: 0 };
      const [type, r, c, t] = cp;
      return { t: String(type ?? 'MOVE').toUpperCase(), p: [r, c], time: Number.isFinite(t) ? t : 0 };
    }
    if (cp && typeof cp === 'object') {
      const pos = cp.pos ?? cp.position ?? [cp.row, cp.col];
      return { t: String(cp.type ?? cp.t ?? 'MOVE').toUpperCase(), p: [pos[0], pos[1]], time: Number(cp.time ?? 0) || 0 };
    }
    return null;
  };
  for (const cp of (first && first.checkpoints) || []) { const s = asStep(cp); if (s) steps.push(s); }
  if (Array.isArray(first && first.end)) steps.push({ t: 'MOVE', p: first.end.slice(0, 2) });
  steps.push({ t: 'DISAPPEAR' });
  if (Array.isArray(second && second.start)) steps.push({ t: 'APPEAR', p: second.start.slice(0, 2) });
  for (const cp of (second && second.checkpoints) || []) { const s = asStep(cp); if (s) steps.push(s); }
  return {
    motion: 'WALK',
    start: Array.isArray(first.start) ? first.start.slice(0, 2) : null,
    end: Array.isArray(second.end) ? second.end.slice(0, 2) : null,
    steps,
  };
}

/**
 * The template action an added enemy joins (client `_GetSpEnemyActionData`): the first SPAWN action of the round's
 * ORIGINAL template whose key is the normal placeholder of the enemy's movement class (`templateEnemyNormal` /
 * `…NormalFly`; tokens `templateEnemyToken` / `…TokenFly`), else the first SPAWN action.
 */
function hostAction(gd, wave, { fly, token = false }) {
  const tpl = wave && wave.templateId ? gd.wave(wave.templateId) : null;
  const list = tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [];
  const ts = gd.factions.templateSlots || {};
  const want = token ? ts[fly ? 'TF' : 'T'] : ts[fly ? 'NF' : 'N'];
  let first = -1;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
    if (first < 0) first = i;
    if ((s.key ?? s.enemyKey) === want) return { index: i, s };
  }
  return first >= 0 ? { index: first, s: list[first] } : null;
}

/**
 * Bounty spawns for one player's battle (悬赏 / 战术特训 / 教鞭 / “神秘顾客”): kill bounties pay the killer (Battle
 * bounty), perfect bounties are paid by the match at settlement. No bounty-specific stat change (the solo 70 % is the
 * global base already in enemyScale). Client timing (`GenerateSelfBattleEnemyData` → `_GetSpEnemyActionData` →
 * `_InsertSpActionToNormal` → `_CalculateActionPredelay`, decoded): every bounty unit joins the ORIGINAL template's
 * first `lrsldr` (walker) / `yokai` (flyer) action (else action 0); the n bounty units of a host action are INSERTED
 * among its own n' units — unit i at index floor((i+1)·len/(n+1)), len = the list length so far — (the bounty list
 * alone when the host spawns nothing, e.g. a walker bounty in a FLY round), then the whole list is spread over the
 * action window: unit j at preDelay + j·max(W/total, 0.05·W). Returned here: the bounty specs only (a bounty's
 * consecutive units share a spec); the host action's own units are NOT re-timed — `withBounties` gives the exact
 * combined list. Bounties of several battles (`rounds` > 1: "接下来两场作战", and the multi-round cards, which last
 * choices.js MULTI_ROUND_BOUNTY_BATTLES) spawn in every battle of the player while they last — the Final Assault and the
 * Hidden Core included (`side`: the player's half of the boss field, see routeByMotion).
 * @param {Array<{ id: string, card: object }>} bounties
 */
export function bountySpawns(gd, round, wave, bounties, playerId, { solo = false, side = null, mid = OFFICIAL_MID_COL } = {}) { // eslint-disable-line no-unused-vars
  return bountyPlan(gd, round, wave, bounties, playerId, side, mid).specs;
}

/** Runs of consecutive equal markers: [{ v, start, len }]. */
function runsOf(list) {
  const out = [];
  for (let j = 0; j < list.length; j++) {
    const last = out[out.length - 1];
    if (last && last.v === list[j]) last.len++;
    else out.push({ v: list[j], start: j, len: 1 });
  }
  return out;
}

function bountyPlan(gd, round, wave, bounties, playerId, side, mid = OFFICIAL_MID_COL) {
  const scale = scaleFor(gd, round);
  const routes = (wave && wave.routes) || [];
  const acts = Array.isArray(wave && wave.actions) ? wave.actions : [];
  const leader = isLeaderTemplate(wave && wave.templateId ? gd.wave(wave.templateId) : null);
  const groups = new Map(); // host action index → { host, items: [{ b, c, fly, count }] }
  for (const b of bounties || []) {
    const c = b && b.card ? b.card : {};
    if (!gd.enemy(c.enemyKey)) continue;
    const fly = isFlyKey(gd, c.enemyKey);
    const host = hostAction(gd, wave, { fly });
    const key = host ? host.index : -1;
    if (!groups.has(key)) groups.set(key, { host, items: [] });
    groups.get(key).items.push({ b, c, fly, count: Math.max(1, Math.min(20, Number.isInteger(c.count) ? c.count : 1)) });
  }
  const specs = [];
  const retime = new Map(); // host action index → { time, step, ownRuns: [{ start, len }] }
  const OWN = 0;
  for (const { host, items } of groups.values()) {
    const hs = host ? host.s : null;
    const time = hs ? Math.max(0, Number(hs.time) || 0) : 4;
    const window = hs ? Math.max(1, Number.isInteger(hs.count) ? hs.count : 1) * Math.max(0, Number(hs.interval) || 0) : 0;
    const act = host ? acts.find((a) => a.index === host.index) : null;
    // the host's own units: only a server-sent action has any (a leader / random-group / invalid host spawns the
    // bounty list alone over its window — client _InsertSpActionToNormal finds no normal list for it)
    const own = act && act.valid && act.server !== false ? Math.min(MAX_ACTION_UNITS, act.count) : 0;
    const sp = [];
    for (const it of items) for (let k = 0; k < it.count; k++) sp.push(it);
    // _InsertSpActionToNormal: insert the bounty units among the action's own units (list.Insert(FloorToInt(...)))
    let list;
    if (own > 0) {
      list = new Array(own).fill(OWN);
      for (let i = 0; i < sp.length; i++) list.splice(Math.floor(((i + 1) * list.length) / (sp.length + 1)), 0, sp[i]);
    } else {
      list = sp.slice();
    }
    const step = window > 0 ? Math.max(window / list.length, MIN_ACTION_INTERVAL_RATIO * window) : 0;
    const runs = runsOf(list);
    if (host && own > 0) retime.set(host.index, { time, step, ownRuns: runs.filter((r) => r.v === OWN) });
    for (const run of runs) {
      if (run.v === OWN) continue;
      const { b, c, fly } = run.v;
      let routeIndex = hs && Number.isInteger(hs.routeIndex) ? hs.routeIndex : routeByMotion(routes, fly, side, mid);
      const r = routes[routeIndex];
      const motionOk = r && (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
      const sideOk = !(side === 'L' || side === 'R') || (r && Array.isArray(r.end) && (side === 'R' ? r.end[1] > mid : r.end[1] < mid));
      if (!motionOk || !sideOk) routeIndex = routeByMotion(routes, fly, side, mid);
      const spec = {
        time: time + run.start * step,
        enemyKey: c.enemyKey,
        routeIndex,
        count: run.len,
        interval: run.len > 1 ? step : 0,
        mods: { ...roundMods(scale), slot: classOf(gd, c.enemyKey), bountyId: b.id },
        tag: 'bounty',
        ownerPlayerId: playerId,
        preview: previewInfo(gd, c.enemyKey, routes[routeIndex], false, leader),
      };
      if (host) spec.actionIndex = host.index;
      if (c.payout !== 'perfect' && Number(c.coin) > 0) spec.bounty = { coins: Math.trunc(c.coin), ownerPlayerId: playerId };
      specs.push(spec);
    }
  }
  return { specs, retime };
}

/**
 * A player's full spawn list for the round, exactly like the client: the wave's specs (copied; the own units of an
 * action that bounties join are re-timed around the inserted bounty units — one spec per run of consecutive own units)
 * followed by the bounty specs. Use it instead of `[...wave.spawns, ...bountySpawns(…)]`, which keeps the host
 * action's own spacing.
 */
export function withBounties(gd, round, wave, bounties, playerId, { side = null, mid = OFFICIAL_MID_COL } = {}) {
  const { specs, retime } = bountyPlan(gd, round, wave, bounties, playerId, side, mid);
  const out = [];
  for (const s of wave.spawns || []) {
    const rt = s.tag !== 'bounty' && Number.isInteger(s.actionIndex) ? retime.get(s.actionIndex) : null;
    if (!rt) { out.push({ ...s, mods: s.mods ? { ...s.mods } : undefined }); continue; }
    for (const run of rt.ownRuns) {
      out.push({ ...s, mods: s.mods ? { ...s.mods } : undefined, time: rt.time + run.start * rt.step, count: run.len, interval: run.len > 1 ? rt.step : 0 });
    }
  }
  return out.concat(specs);
}

/**
 * nextEnemies preview (m.private.nextEnemies): one entry per spawn action (research 08 §4.2 input), in spawn order:
 * `{ enemyKey, count, gate: 'upper'|'lower', t, fly, elite, boss, source: 'wave'|'bounty', tag, start? }` — `tag` 'boss' /
 * 'bounty' / null kept for the drawer's grouping; Σ count = the enemies of the round (HUD). Boss parts are omitted.
 * The client places the models in the gate's pen zone (≤ 50 shown, elites and bosses always) — except a leader: its
 * entry carries its spawn tile `start` ([row, col] on the boss field) and the Final Assault / Hidden Core prep shows it
 * standing there (render/app.js, community report #12; display only).
 * @param {Array<object>} spawns
 * @param {{ r0?: number, r1?: number } | null} [rect] 这张图自己的战斗矩形（只有**地图自己画了路线**时才传）：当
 *   `start` 落在这块场地里时，按它在这块场地的**上半 / 下半**（纵向中线）分上下两批 —— 官方那条 `start + 6 / + 13`
 *   的偏移只适配 19×21 的等待区锚点，在大战场上会把两批全判成 upper（业主 2026-10-31「怪物等待区分错了」）。
 *   官方地图不传它，`gateOf` 的结果逐条不变。
 */
export function previewOf(spawns, rect = null) {
  const out = [];
  let seq = 0;
  const r0 = rect && Number.isFinite(rect.r0) ? rect.r0 : null;
  const r1 = rect && Number.isFinite(rect.r1) ? rect.r1 : null;
  const mid = r0 != null && r1 != null ? (r0 + r1) / 2 : null;
  for (const s of spawns || []) {
    if (!s || typeof s.enemyKey !== 'string' || s.tag === 'part') continue;
    const tag = s.tag === 'boss' ? 'boss' : s.tag === 'bounty' ? 'bounty' : null;
    const pv = s.preview && typeof s.preview === 'object' ? s.preview : {};
    const start = Array.isArray(pv.start) && pv.start.length >= 2 ? pv.start : null;
    const inRect = start && r0 != null && start[0] >= r0 && start[0] <= r1;
    out.push({
      enemyKey: s.enemyKey,
      count: Math.max(1, Math.trunc(Number(s.count) || 1)),
      gate: inRect && mid != null ? (start[0] >= mid ? 'upper' : 'lower') : pv.gate === 'upper' ? 'upper' : 'lower',
      t: Math.max(0, Number(s.time) || 0),
      fly: !!pv.fly,
      elite: !!pv.elite || tag === 'boss',
      boss: tag === 'boss',
      source: tag === 'bounty' ? 'bounty' : 'wave',
      tag,
      ...(tag === 'boss' && start && start.every(Number.isFinite) ? { start: [start[0], start[1]] } : {}),
      _seq: seq++,
    });
  }
  out.sort((a, b) => a.t - b.t || a._seq - b._seq);
  for (const e of out) delete e._seq;
  return out;
}

/**
 * 联防 spawns from the union of leaked enemies (research 08 §5; client `GenerateHelpBattleEnemyData` /
 * `_GetSpEnemyActionData` / `_CalculateActionPredelayConsiderUid`, decoded): every leak becomes a 1-unit action on the
 * route of the escaped template's host action — walkers the first `lrsldr` action, flyers `yokai`, tokens (enemies
 * only ever summoned — enemies.json tokenOnly, or `isToken` on the leak) `gopro_2` / `lazerd`, else action 0; elites
 * and specials are NOT routed through the E / S actions. Per host action the units are grouped by owner (source
 * player, first-leak order); with W = count·interval of the host action and M = the largest owner group,
 * step = min(max(W / M, 0.05·W), MAX_ACTION_INTERVAL_FOR_UID 5 s), and unit i of the k-th owner spawns at
 * preDelay + k·ACTION_INTERVAL_FOR_UID (0.5 s) + i·step.
 * 自绘地图（stage.routes，`opts.stageId`）：路线不取模板的，改由 `uniteRoutePlan` 决定 —— 单人只走承接者半场的
 * 两条地面路线；双人走一条两段路线（右上地面 → 右目标 → 左下入口重新入场 → 左下地面 → 左目标才漏怪）。
 * 时间（t0 / window / step / owner 偏移）与官方分支完全一致，只换路线。
 * @param {Array<{ enemyKey: string, mods: object|null, sourcePlayerId: string, bounty?: object|null, isToken?: boolean }>} leaked
 * @param {number} helperCount 1 | 2
 * @param {number} timeLimit
 * @param {{ stageId?: string|null }} [opts] `stageId`：这张图自己画了路线时，联防按 `uniteRoutePlan` 的规则走
 * @returns {{ templateId: string|null, spawns: object[], routes: object[] }}
 */
export function buildUniteWave(gd, leaked, helperCount, timeLimit, opts = {}) { // eslint-disable-line no-unused-vars
  const templates = gd.unite.templates;
  const templateId = templates[String(helperCount)] || templates[helperCount] || null;
  const tpl = templateId ? gd.wave(templateId) : null;
  // 自绘地图的联防路线（业主 2026-10-27；见 uniteRoutePlan）；官方图 plan = null ⇒ 下面逐语句与从前相同
  const plan = opts && opts.stageId ? uniteRoutePlan(gd, opts.stageId, helperCount) : null;
  const routes = plan ? plan.routes : (tpl && Array.isArray(tpl.routes) ? tpl.routes : []);
  const ts = gd.factions.templateSlots || {};
  const list = tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [];
  const isSpawn = (s) => s && !(s.action && String(s.action).toUpperCase() !== 'SPAWN');
  /** client `_GetSpEnemyActionData`: the first action whose key is the class placeholder, else action 0 */
  const hostIndex = (fly, token) => {
    const want = token ? ts[fly ? 'TF' : 'T'] : ts[fly ? 'NF' : 'N'];
    for (let i = 0; i < list.length; i++) if (isSpawn(list[i]) && (list[i].key ?? list[i].enemyKey) === want) return i;
    return list.length ? 0 : -1;
  };
  const groups = new Map(); // host action index → Map(owner → leaks), insertion order
  const flyOf = new Map();
  for (const l of leaked || []) {
    if (!l || !gd.enemy(l.enemyKey)) continue;
    const fly = isFlyKey(gd, l.enemyKey);
    const token = l.isToken === true || gd.enemy(l.enemyKey).tokenOnly === true;
    const idx = hostIndex(fly, token);
    if (!groups.has(idx)) { groups.set(idx, new Map()); flyOf.set(idx, fly); }
    const owners = groups.get(idx);
    const owner = l.sourcePlayerId ?? '';
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner).push(l);
  }
  const spawns = [];
  let seq = 0;   // 自绘地图：第几条出怪（单人按它轮换两条地面路线）
  for (const [idx, owners] of groups) {
    const a = idx >= 0 ? list[idx] : null;
    const t0 = a ? Math.max(0, Number(a.time) || 0) : 3;
    const window = a ? Math.max(1, Number.isInteger(a.count) ? a.count : 1) * Math.max(0, Number(a.interval) || 0) : 40;
    let most = 1;
    for (const units of owners.values()) most = Math.max(most, units.length);
    const step = Math.min(Math.max(window / most, MIN_ACTION_INTERVAL_RATIO * window), UNITE_MAX_UNIT_STEP);
    let routeIndex = a && Number.isInteger(a.routeIndex) ? a.routeIndex : routeByMotion(routes, flyOf.get(idx));
    if (routeIndex < 0 || routeIndex >= routes.length) routeIndex = 0;
    let k = 0;
    for (const units of owners.values()) {
      const start = t0 + k * UNITE_OWNER_STEP;
      units.forEach((l, i) => {
        // 自绘地图：每条出怪按计划换路线（双人还带一条两段路线：右上半场 → 右目标 → 左下入口 → 左下地面 → 左目标）
        const own = plan ? plan.pick(seq++) : null;
        const ri = own ? own.routeIndex : routeIndex;
        const spec = {
          time: start + i * step, enemyKey: l.enemyKey, routeIndex: ri, count: 1, interval: 0,
          mods: l.mods ? { ...l.mods } : { slot: classOf(gd, l.enemyKey) }, sourcePlayerId: l.sourcePlayerId,
          preview: previewInfo(gd, l.enemyKey, routes[ri]),
          ...(own && own.route ? { route: own.route } : {}),
        };
        if (idx >= 0) spec.actionIndex = idx;
        if (l.bounty && l.bounty.coins > 0) spec.bounty = { coins: l.bounty.coins, ownerPlayerId: l.bounty.ownerPlayerId ?? l.sourcePlayerId };
        if (l.tag === 'bounty') spec.tag = 'bounty';
        spawns.push(spec);
      });
      k++;
    }
  }
  spawns.sort((a, b) => a.time - b.time);
  return { templateId, spawns, routes };
}
