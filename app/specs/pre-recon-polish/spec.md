# SPEC — 预重构屏：过时文案校正 + 六条规则核对 + 交互打磨

日期：2026-10-26
范围：`d:\Ark\Stronghold-Protocol-Forge-0.19.1-0.3.0-win-x64\app`
模式：重构模拟（`mode_recon_*`）· `PHASE.PRE_RECON`

## 1. 目标

1. 修掉预重构屏与它样式表里**已经过时**的文案 / 注释（「占位」「后续版本生效」「第一轮骨架」）。
2. 把「重构协助 / 熔芯负载」六条选项的**数值与口径**逐条与实现核对，缺的测试补上。
3. 预重构界面与反馈打磨：已选态、效果预览、提交确认、倒计时末段提示、队友选择可见性。

## 2. 核查结论（已读源码，无需再探索）

### 2.1 过时文案（4 处注释 + 2 处屏上文案）

| 位置 | 现文案 | 处理 |
|---|---|---|
| `public/js/screens/preRecon.js` 第 1 行 | 「…，第一轮骨架」 | 改为「机制轮」 |
| 同文件 18–19 行 | 「**选项表同样占位**…机制轮按 id 生效」 | 改为「六条的机制已落在工坊包 meta / battle，按 id 生效」 |
| 同文件 42 行 | 「本轮的界面只负责把它们念出来」 | 改为「机制在 `workshop/mode-recon` 的两处按 id 生效」 |
| 同文件 102 行 | 「占位选项的一组」 | 改为「单选卡的一组」 |
| 同文件 277 行（**屏上文案**） | 「选项已成表，效果的实例化将在后续版本生效。」 | 改为「重构协助（全局增益）与熔芯负载（全局减益）各选一项，提交后本局生效。」 |
| `public/css/screens/pre-recon.css` 第 2 行 | 「第一轮骨架」 | 改为「机制轮」 |

### 2.2 六条规则核对表

文案在 `preRecon.js` 的 `ASSIST_OPTS` / `LOAD_OPTS`（业主给定，**逐字不改**）；实现分两处：
休整期侧 `workshop/mode-recon/meta/main.mjs`，战场侧 `workshop/mode-recon/battle/main.mjs`。

| id | 文案数值 | 实现 | 结论 |
|---|---|---|---|
| `recon_assist_bond` | 修整期结束时，三类里已激活层数最高的盟约各 +10 层 | `meta` `bondAssist`（`BOND_ASSIST_LAYERS = 10`，`requireActive`，`onPrepEnd`） | 一致（真引擎 + 假 ctx 两条测试已覆盖） |
| `recon_assist_equip` | 每回合前 3 次销毁装备，补 1 件 ≥ 该阶级的随机装备；干员装备可拆卸 | `meta` `destroyAssist`（`ASSIST_DESTROYS_PER_ROUND = 3`，`rollItem({ minTier })`）；拆卸 = `pack.json` 的 `behaviour: unequip: "allow"` | 一致；**已知口径**：`unequip` 是**包级**开关，无法按人/按选项开启 —— 装了本包的重构房间都能拆卸（README 已有记） |
| `recon_assist_data` | 我方场上干员基础攻/防/生命上限 +25%、法术抗性 +25 点 | `battle` `applyAlly`（`directMods({atk,def,hp: .25}, {resFlat: 25})`，`passiveBuff` 同键替换） | 一致（`recon-battle.test.js` 数值断言 100→125 / 50→62.5 / 1000→1250 / res 0→25） |
| `recon_load_bond` | 三类里最高层已激活盟约**每层**使敌人生命上限 +0.1% | `battle` `enemyModsOf` = `(core+addon+story) × 0.001`（`topLayersByKind` 同 meta 口径） | 一致；**缺测试**：「三类求和」与「未激活不计」→ 本次补 |
| `recon_load_equip` | 未携带装备伤害 −25%；装备阶级高于携带者时该装备效果 −50%、3 回合后自动销毁（源石辅助仪 / 变形同构体免自动销毁） | `battle` `BARE_DAMAGE_MUL = 0.75` + `halfNegated(itemStatMods)`；`meta` `syncLoadDoom` 记 `round + 3` 后 `destroyItem`；豁免 `chess_item_6_13_e` / `chess_item_6_09_e` | 一致（−50% 只算属性半边，触发类不缩 —— README「已知口径」已写） |
| `recon_load_data` | 敌方基础攻/防/生命上限 +25%、法术抗性 +25 点 | `battle` `enemyModsOf`（`atkPct/defPct/hpPct .25`、`resFlat 25`） | 一致（已测） |

### 2.3 界面现状

- 已有：三块内容、单选高亮、右侧摘要、已提交列表、阶段倒计时。
- 缺：①选中项没有 ✓ 记号（只靠描边）；②右侧摘要只念名字、不念效果；③提交一步直发、无确认；④最后 10 秒无任何提示（超时未交按「不指定」进入，屏上没有说）；⑤队友的已交选择**数据已在** `pub.recon.choices` 里，界面却只显示「已提交」。

## 3. 决策

- **D1 文案**：按 §2.1 逐条替换；六个选项 id 与文案正文**一个字符不动**。
- **D2 已选态**：`OptGroup` 的选中卡与 `TrialPick` 的选中瓦片右上角加一枚 `Icon name="check"`；盟约瓦片的已选态沿用 `BondDisc` 的实心环，不另加。
- **D3 效果预览**：右侧摘要的「重构协助 / 熔芯负载」一行 = 名称 + 该选项的完整描述（小字、暗色）。摘要抽成 `summaryRows()` + `Summary` 组件，右侧、提交确认弹窗、队友详情弹窗三处共用同一份念法。
- **D4 提交确认**：点主按钮先开 `Modal`（`tone="ice"`）：标题「确认重构走向」，正文 = 摘要 + 「提交后阶段结束前仍可改选重交；时间耗尽时未提交按不指定进入」；没有任何选择时多一行提示。按钮：「返回修改」/「确认提交」。确认后才 `act('g.reconChoice', …)`，成功后关弹窗。
- **D5 倒计时末段**：`remain <= 10` 时状态行换成醒目色（`--amber`）+ `hourglass` 图标 + 「即将结束：{s} 秒（未提交按不指定进入）」。
- **D6 队友选择可见性**：左侧每名已提交博士的名字下加一行**快捷摘要按钮**（`协助 X · 负载 Y`，都没选 = 「不另选」），点开 `Modal` 看这名博士的完整摘要（含两条效果描述）。未提交的座位不画这一行。数据只取 `pub.recon.choices`（`PRE_RECON` 外为 `null`，按钮自然消失）。
- **D7 不动的东西**：服务端 `phases.js` / `reconChoices` 存储、`shared/protocol.js` 形状、`shared/reconModes.js` 模式合成、地图与相机、包内 `meta` / `battle` 代码（本包无改动 ⇒ **不抬 `pack.json` 版本**）。

## 4. 改动清单

### 4.1 `public/js/screens/preRecon.js`

1. 头部注释（1–2、18–19 行）、`ASSIST_OPTS` 注释（40–43）、`OptGroup` 注释（102）、第 277 行屏上文案 → §2.1。
2. import 增加 `Modal`（同一行 `../ui/components.js`）。
3. 新增模块级函数 / 组件：
   ```js
   /** 选择 → [{ k, v, desc? }]：右侧摘要、提交确认、队友详情共用的同一份念法。 */
   function summaryRows(c, gd, storyVisible) { … normalizeChoice + ASSIST_OPTS/LOAD_OPTS 查表 … }
   function Summary({ rows }) { … <dl class="prc-sum"> … }
   /** 队列表那一行：`协助 数据重构 · 负载 装备负载`，都没选 → 不另选。 */
   function briefOf(c) { … }
   ```
4. `OptGroup`：选中卡内 `prc-opt__name` 前加 `<${Icon} name="check" class="prc-opt__tick" />`。
5. `TrialPick`：选中瓦片内加 `<span class="prc-trial-pick__tick"><${Icon} name="check" /></span>`。
6. `PreReconScreen` 新增状态：`const [confirm, setConfirm] = useState(false)`、`const [viewing, setViewing] = useState(null)`；
   `submit()` 拆成 `openConfirm()`（按钮用）与 `doSubmit()`（弹窗里的确认，成功后 `setConfirm(false)`）。
7. 左侧玩家行：已提交者在状态行下渲染快捷摘要 `<button class="prc-p__picks" onClick={() => setViewing(p.playerId)}>${briefOf(c)}</button>`。
8. 右侧摘要改用 `<${Summary} rows=${summaryRows({ major, minor, story, bosses, assist, load }, gd, storyPool.length > 0)} />`。
9. 倒计时状态行按 D5 换成两档文案。
10. 屏尾（`ExitModal` 之后）新增两个 `Modal`：
    - 提交确认（D4）；
    - 队友详情（`open = viewing != null && choices[viewing] !== undefined`，标题用玩家名，正文 `Summary`）。

### 4.2 `public/css/screens/pre-recon.css`

- 头部注释「第一轮骨架」→「机制轮」。
- `.prc-p__picks`：无边框按钮，冰蓝小字，单行省略 + hover 下划线。
- `.prc-opt__tick`（`Icon` 内联，`.15rem` 见方，冰蓝）与 `.prc-trial-pick__tick`（绝对定位右上角）。
- `.prc-sum__desc`：`display:block`，`calc(.12 * var(--t))`，`var(--text-lo)`，`white-space:pre-line`（文案里有换行就照着画）。
- `.prc__status--urgent`：`color: var(--amber)`。
- `.prc-confirm__note` / `.prc-confirm__warn`：正文间距与警示色。
- 媒体查询不变（1100px 以下单列已有）。

### 4.3 测试

1. `test/match/recon-battle.test.js`：扩「盟约负载」那条 —— 同局再挂 `swiftShip`（附加，50 层，active）+ 一条未激活的高层盟约，断言 `hpPct` = `(100 + 50) × 0.001`，未激活者不计数。
2. 新增 `test/match/recon-copy.test.js`（小文件）：读 `public/js/screens/preRecon.js` 源码，取出两张表的六个 id，断言六者在 `workshop/mode-recon/meta/main.mjs` + `battle/main.mjs` 的源码里都出现过（「id 即接口」的契约护栏，防两侧改名漂移）。
3. 不放宽任何既有测试。

## 5. 验证

- V1 `node --check public/js/screens/preRecon.js` 与新增测试文件。
- V2 `node --test test/match/recon-battle.test.js test/match/recon-mechanics.test.js test/match/recon-bosses.test.js test/match/recon-train.test.js test/match/recon-trials.test.js test/match/recon-copy.test.js` 全绿。
- V3 真浏览器（本机起服，重构房间进 `PRE_RECON`）：
  - 勾选后卡片 / 瓦片出现 ✓；
  - 右侧「重构协助 / 熔芯负载」带描述；
  - 点主按钮出确认弹窗，确认后才提交（服务器 `reconChoices` 有记录），可改选重交；
  - 倒计时 ≤10 s 显示「即将结束…」；
  - 队友已提交后左侧出现「协助 … · 负载 …」，点开能看到完整摘要。
- V4 `node tools/workshop-validate.mjs workshop` 的 34 条既有 STALE_DERIVED（敌人 be/attrPower）视为**已存在的失败**，本轮不处理；除此之外不得新增告警。

## 6. 风险 / 边界

- `summaryRows` 依赖 `gd.bond` / `gd.enemy`；数据未就绪时名字回退 id，不抛。
- 队友详情只在 `PRE_RECON` 有数据（`pub.recon.choices` 之外为 `null`），`open` 条件已按此写。
- 侧栏宽度 2.2–2.8rem，快捷摘要单行省略，完整内容在弹窗里。
- 新增中文句子走 `t()`（缺翻译回退中文，en / ja / ko 不阻塞）。

## 7. 需要批准

请审阅本 spec 与 `tasks.md`。批准后按 T1→T8 执行，V1–V3 自证后回报；V4 只记录既有失败。
