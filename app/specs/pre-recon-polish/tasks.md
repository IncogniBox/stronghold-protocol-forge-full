# TASKS — 预重构屏：文案校正 + 六条规则核对 + 交互打磨

对应 spec：`specs/pre-recon-polish/spec.md`

## 实施

- [x] T1 `public/js/screens/preRecon.js`：头部注释（1–2 / 18–19）、`ASSIST_OPTS` 注释、`OptGroup` 注释、第 277 行屏上文案 → spec §2.1。
- [x] T2 `public/css/screens/pre-recon.css`：头部注释改「机制轮」；补 `.prc-p__picks` / `.prc-opt__tick` / `.prc-trial-pick__tick` / `.prc-sum__desc` / `.prc__status--urgent` / `.prc-confirm__note`。
- [x] T3 `preRecon.js`：新增 `summaryRows()` / `Summary` / `briefOf()`；右侧摘要换 `Summary`；`OptGroup` 与 `TrialPick` 已选 ✓。
- [x] T4 `preRecon.js`：提交确认 `Modal`（`confirm` 状态 + `doSubmit()` 成功后关闭；无选择时补警示行）。
- [x] T5 `preRecon.js`：倒计时 `remain <= 10` 的醒目提示（`--amber` + hourglass + 「未提交按不指定进入」）。
- [x] T6 `preRecon.js`：左侧队友行的快捷摘要按钮 + 队友详情 `Modal`（`viewing` 状态）。
- [x] T7 `test/match/recon-battle.test.js`：盟约负载补「三类求和 / 未激活不计」断言。
- [x] T8 新增 `test/match/recon-copy.test.js`：屏上六个选项 id 必须都出现在包内 `meta` / `battle` 源码（契约护栏）。
- [x] T9 `workshop/mode-recon/README.md`：无需改正文（unequip 包级口径已记）；`pack.json` 不动、**不抬版本**。

## 验证

- [x] V1 `node --check public/js/screens/preRecon.js`、`node --check test/match/recon-copy.test.js`。
- [x] V2 `node --test test/match/recon-battle.test.js test/match/recon-mechanics.test.js test/match/recon-bosses.test.js test/match/recon-train.test.js test/match/recon-trials.test.js test/match/recon-copy.test.js` 全绿（66 + 1）。
- [x] V3 真浏览器（本机起服，重构房间进 PRE_RECON）：已选 ✓、效果预览、确认弹窗（含「返回修改」）、提交后阶段立即结束（服务端收下选择）、AI 队友的快捷摘要 + 详情弹窗 —— 全部按真实点击断言通过。证据：`d:\Ark\cam-shots\pre-recon-ui.png`、`pre-recon-teammate.png`。
  - **未验到的子项**：≤10 s 末段提示。单人房（1 名真人，含只带 AI 的房）的 PRE_RECON **本来就没有倒计时**（`Match.soloUntimed`：只剩一名真人时非战斗阶段一律不计时），所以该分支在本机单人房间里不可达；多人局才会出现。
- [x] V4 `node tools/workshop-validate.mjs workshop`：34 条 ERROR 全部是既有 STALE_DERIVED（敌人 be/attrPower），无新增。

## 说明

- 六个选项 id 与文案正文逐字不动（业主给定）；本包代码不改，故不抬 `pack.json` 版本。
- 服务端 / 协议 / 模式合成 / 地图相机一律不动。
