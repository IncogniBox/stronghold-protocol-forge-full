// workshop/dossoles/kits/chess_ws_dos_holungday_a.js — 多索雷斯工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// 假日威龙陈（散射手，6★）：整体复用引擎自带的官方 op kit server/sim/content/kits/ops/op-chen2.js
// （技能 S1 高压冲击 / S2 “堇青之夜” / S3 “假日风暴”、天赋 节约风气 / 假日余韵、特性 散射手 与两套模组）。
// 约定（kits_alt_t5 skills-map）：默认技能放顶层 `skill`，`skills` 只装非默认技能。
import opChen2 from '@ops/op-chen2.js';

export default (bb, chess, def) => {
  const k = opChen2.char_1013_chen2(bb, chess);
  const sid = (def?.raw?.skills ?? []).find((s) => s.isDefault)?.skillId ?? null;
  if (sid && k.skills?.[sid]) { k.skill = k.skills[sid]; delete k.skills[sid]; }
  return k;
};
