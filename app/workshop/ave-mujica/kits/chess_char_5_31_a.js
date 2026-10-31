// workshop/ave-mujica/kits/chess_char_5_31_a.js — 祐天寺若麦/Amoris（颂乐人偶 mod）
// 撼地者 (WARRIOR hammer): 近战, 物伤, 溅射 1.0 / 50%（professions.js hammer）。
// S1 如焰般热烈 (duration): 攻击变为三连击（首击溅射）；段 1 = atk×first_scale（普通 138% / 精锐 147%），
//   段 2–3 = atk×sub_scale（20%）。
// S2 如麦般生长 (duration): 攻击范围扩大，攻击变为八连击；**段 1 与段 5** = atk×main_scale（普通 107% / 精锐 115%）、其余 6 段
//   = atk×sub_scale（10%）；每段在攻击范围内**随机**选目标（数据原文「随机攻击范围内的目标」）。
// T1 双利手: 「进行持续攻击」由本包盟约安装器（battle/main.mjs 的 installAveMujica，与祥子同款）实现；
//   攻击时 prob 概率使敌人获得 fragile 脆弱，持续 fragile_dur 秒。
// T2 毋畏爱意 / 模组成员增伤: Fever 系统与成员判定由本包盟约安装器（battle/main.mjs 的 installAveMujica）负责，本 kit 不重复。
// 模组 HAM-X「年轻的麦子」: 溅射范围内有 ≥3 个敌人时，使当次攻击力提升至 atk_scale（近似：主目标伤害 ×atk_scale）。
import { num, skillBbOf, talentBb, traitBb, isMainHit, cheb } from '@kit/tier1.js';

// 技能 id 用**官方 id**（与包内 fx 索引 `assets/fx/index.json` 的 `skchr_amoris_*` 一致），见 6_30 的说明。
const S1 = 'skchr_amoris_1';
const S2 = 'skchr_amoris_2';

export default (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  // 每段倍率（**逐段取自该技能自己的黑板**；缺 `first_scale` / `main_scale` / `sub_scale` 的键一律回落到
  // 旧的单一 `atk_scale` ⇒ 数据没写这几个键的技能行为与改动前逐字一致）：
  //   S1：段 1 = first_scale，段 2–3 = sub_scale（记录普通 1.38 / 精锐 1.47，sub_scale 0.2；合计 ≈ 1.78×atk）
  //   S2：段 1 与段 5 = main_scale，其余 6 段 = sub_scale（记录普通 1.07 / 精锐 1.15，sub_scale 0.1；合计 ≈ 2.74×atk）
  const atk1 = num(b1.atk_scale, 1.38), atk2 = num(b2.atk_scale, 1.07);
  const s1Hits = Math.max(1, Math.floor(num(b1.hits, 3)));
  const s2Hits = Math.max(1, Math.floor(num(b2.hits, 8)));
  const s1Scales = Array.from({ length: s1Hits }, (_, i) => num(i === 0 ? b1.first_scale : b1.sub_scale, atk1));
  const s2Scales = Array.from({ length: s2Hits }, (_, i) => num(i === 0 || i === 4 ? b2.main_scale : b2.sub_scale, atk2));
  /**
   * 一套「N 段」的攻击档（业主 2026-10-18：S2 八段 / S1 三段），**每段各自的倍率**由 `scales[i]` 给出
   * （`scales[0]` = 引擎那一下 = 第 1 段；`scales[i]` = `onHit` 补的第 i+1 段）。
   *
   * ⚠️ 为什么不是直接 `hits: N`：引擎连击循环写的是 `for (h < hits && target.alive)`（`server/sim/ai.js`
   * resolveHit）—— 目标在**第 1 段**就被打死时整条连击立刻中断，玩家看到的就是「只有第一段」。那是引擎对
   * **所有**干员的既有语义（不能只给若麦翻掉，否则黄金语料不再逐字节一致）。
   *
   * 包侧做法：引擎那一下只算 **第 1 段**（`hits: 1`，它一定会发生、不受后续循环影响，倍率走 `scales[0]`），
   * 其余 `N − 1` 段在 `attack.onHit` 里补完 —— **一段一次 `dealDamage`**，每段**重新**在攻击范围内随机取一个
   * **存活**敌人（数据原文「随机攻击范围内的目标」）。因此：一套动作必定完整打满 N 段；目标阵亡 / 目标转移都
   * **不会**重置或提前结束这一套（无可选目标的那一段空过，段数照旧走完）。
   * 每段伤害与引擎同一式：`atk × 该段倍率 × 单位的 atkScaleMul`。
   */
  const combo = (hits, scales, extra = {}) => ({
    hits: 1,
    atkScale: scales[0],
    dmgType: 'phys',
    ...extra,
    onHit({ battle, unit }) {
      for (let h = 1; h < hits; h += 1) {
        const list = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
        const live = list ? list.filter((e) => e && e.alive) : [];
        if (!live.length) break; // 这一段没有可选目标 ⇒ 空过，不重置段数
        const e = live[Math.min(live.length - 1, Math.floor(battle.rng() * live.length))];
        battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul * num(scales[h], scales[0]),
          type: 'phys', isAttack: true, isSkill: true, tags: ['skill', 'amoris'] });
      }
    },
  });
  const s1 = {
    kind: 'duration',
    duration: num(b1.duration, 15),
    // 三连击：首击（引擎那一下）带溅射、段 1 = first_scale（缺则回落 atk_scale，即改动前的单一倍率行为）；
    // 其余两段 = sub_scale（同样回落）
    attack: combo(s1Hits, s1Scales, { splashRadius: num(b1.splash_radius, 1.1) }),
  };
  const s2 = {
    kind: 'duration',
    duration: num(b2.duration, 24),
    targeting: { rangeExtend: Math.max(1, Math.floor(num(b2.rangeExtend, 1))) },
    // 八连击：1（引擎）+ 7（onHit）；段 1 与段 5 = main_scale，其余 = sub_scale（缺键一律回落 atk_scale）
    attack: combo(s2Hits, s2Scales),
  };
  const t1 = talentBb(chess, 0);
  const talents = [
    { install(battle, unit) { // T1 双利手: 攻击时概率使敌人获得 8% 脆弱，持续 2 秒
      const p = num(t1.prob, 0.1), v = num(t1.fragile, 0.08), d = num(t1.fragile_dur, 2);
      if (!(p > 0 && v > 0 && d > 0)) return;
      battle.on('hit', (ctx) => {
        const tg = ctx.target;
        if (ctx.source !== unit || !tg || tg.side !== 'enemy' || !tg.alive) return;
        if (!(p >= 1 || battle.rng() < p)) return;
        battle.applyStatus(tg, 'fragile', { duration: d, value: v, source: unit });
      }, { owner: unit });
    } },
    { install(battle, unit) { // 模组 HAM-X: 溅射范围内 ≥3 个敌人时，当次攻击力提升至 115%
      const r = num(traitBb(chess).atk_scale, 1);
      if (!(r > 1)) return;
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !isMainHit(ctx.dmg)) return;
        const tg = ctx.target;
        if (!tg || tg.side !== 'enemy' || !ctx.dmg) return;
        let n = 0;
        for (const e of battle.enemies) if (e.alive && cheb(tg, e) <= 1) n++;
        if (n >= 3) ctx.dmg.amount *= r;
      }, { owner: unit });
    } },
  ];
  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2 },
    talents,
  };
};