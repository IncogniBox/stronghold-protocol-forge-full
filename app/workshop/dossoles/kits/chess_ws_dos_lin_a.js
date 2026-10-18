// workshop/dossoles/kits/chess_ws_dos_lin_a.js — 多索雷斯工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 林（阵法术师，6★）：整体复用引擎自带的官方 op kit server/sim/content/kits/ops/op-lin.js
// （技能 S1 玲珑 / S2 荫庇 / S3 流光乍裂、天赋 计出万全 / 韬光、特性 阵法术师 与两套模组）。
// 约定（kits_alt_t5 skills-map）：默认技能放顶层 `skill`，`skills` 只装非默认技能。
import opLin from '@ops/op-lin.js';

export default (bb, chess, def) => {
  const k = opLin.char_4080_lin(bb, chess);
  const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
  if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
  return k;
};
