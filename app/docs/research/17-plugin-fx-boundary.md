# 17 · 特效/插件边界：上游 0.3.0 对照与本树实际能力

2026-10-23。整理两份外部评估（静态阅读，未跑代码）的可采信部分，并按**本工作树**（Forge 0.19.1 / 上游 0.3.1）
复核。结论先行：

> **「三层特效能力」口径可以直接用。** 第一份报告说「Forge 不能造特效」只对了一半：本树不能注册**新的渲染逻辑**，
> 但已经有 `pack.json.fx.manifest` —— 包可以把**官方战斗特效的 prefab/index/textures/mesh 闭包**随包分发，
> 客户端深度合并（包优先）。第二份是站侧/分发层的兼容评估，只作背景，不作为本树回归基线。

## 1. 三层口径（评审 mod 特效需求时先问这一句）

| 层 | 含义 | 需要什么 |
|---|---|---|
| ① 触发 | 用引擎已有的 fx（命中、弹道、施法光效、相位） | 效果记录 / 事件 / 包侧 JS |
| ② 换素材 | 把某个特效的美术换成自己的 | 素材覆盖位（`art` / `fx.manifest`） |
| ③ 造 | 新增渲染逻辑（新粒子、新 shader、新屏幕效果） | 渲染层的注册点（本树没有） |

## 2. 本树实际状态（权威，按代码复核）

| 层 | 本树能力 | 证据 |
|---|---|---|
| ① 触发 | `server.meta` 的 `effect` 注册键 + `@battle/mod.js` 的 `battle.fx(kind, …)`；`server.battle` 里可直接 `battle.fx` / `battle._ev(['cast', …])`；`effects.json` 内容表 | `shared/workshop.js`（`META_KEY_CLASSES`、`WORKSHOP_CONTENT_FILES`）、`workshop/*/battle/main.mjs` |
| ① 相位 | 包声明哪几个 `'phase'` 不放通用特效 | `pack.json.fx.silentPhases`（`docs/WORKSHOP.md` §1.19.1） |
| ② 素材 | `pack.json.art`（icon / spine）、`assets.skins`、`bondIcons` / `itemIcons` | `docs/WORKSHOP.md` §1.6–§1.15 |
| ② 官方特效闭包 | **`pack.json.fx.manifest`**：包自带一批官方战斗特效（`index.json` / `textures.json` / prefab / tex / mesh），随 `welcome.modFx` 下发，客户端与本机提取**深度合并、包优先** | `shared/workshop.js:1848-1874`、`public/js/render/vfx/library.js:54-59`、`docs/WORKSHOP.md` §1.19.2；实例 `workshop/ave-mujica/`、`workshop/enemy-ext/` |
| ③ 造 | **没有插件注册点**。`public/js/render/*` 是引擎内部；静态面只服务 `/sim/` | `server/http/static.js`；业主「mod 能不动主体就不动主体」原则 |

## 3. 对第一份报告的修正

| 报告说法 | 本树事实 |
|---|---|
| 「Forge 不能造特效，只能 fork 引擎」 | **不准确**：`fx.manifest` 是合法的「带官方特效资产」通道（ave-mujica、enemy-ext 都在用）。真正做不到的是**注册新的渲染逻辑**（新 shader / 新粒子代码）——这一条成立。 |
| 「Forge 侧 projectile / DSL `fx` 未核」 | 本树的对应面是：`effects` 内容表 + `server.meta` 的 `effect` 键 + `server.battle` 里直接 `battle.fx`。「上游插件 DSL 的 `fx` 动作」没有逐字等价物，包侧用 JS 写。 |
| 「Forge 无自定义特效渲染接口」 | 成立。若将来确实要「造」，应开**声明式、进包摘要、双端一致**的 fx 注册点（emitters / plans 的包声明），而不是让包 import `render/`。 |
| 报告里的 Forge 样本 `E:\destop\harness_1\…` | 不是本工作树；结论需按本树复核（本树有 `fx.manifest`、`fx.silentPhases`、`forms`）。 |

## 4. 第二份（无损边界）的可采信数字与建议

| 指标 | 数 |
|---|---|
| 投稿总数 / 其中真 Forge 包 | 80 / 52（另 28 是说明文档） |
| 转换后带内容 | 22 / 52 = 42% |
| `check --strict` 通过 | 17 / 52 = 33% |
| 真装真跑可用 | 11～14 / 52 = 21%～27% |
| **真正无损**（零丢弃 + 零猜测） | **1 / 52** |

建议：**并存沙箱档**（保留 Forge 全能力 module 档，另加沙箱档吸收运行时的预算 / 同意 / 子进程保护），
站侧另开「官方 mod」投稿选项，并用「0 丢弃 + 0 猜测 + `check` 通过 + 真跑 + 版本指纹」作为可核验证明。
已知缺口：`detmath` 等 kit 白名单交集只有 2 条（§W1）、界面挂载点 9 vs 4、`statsBase` 类记录模型、
盟约/驻守内容、`personal`/界面类插件的联机能力。**这些是站侧/架构决策，不是本树回归基线。**

## 5. 对我们的行动项

1. 评审任何 mod 的特效需求，先按三层问：**触发 / 换素材 / 造**——前两层本树都有正规通道。
2. 要「造」⇒ 新增受控的**声明式 fx 注册点**（形状进 `pack.json`、进包摘要、双端一致），不改 `public/js/render/` 内部。
3. 上游插件包的移植：现在不做；若要做，先补映射表（`projectile`、DSL `fx`、kit 白名单、9 vs 4 挂载点）。
4. `fx.manifest` 继续作为「包自带官方特效」的唯一合法通道，在本树包 README 里点名其授权与再分发责任。

## 6. 未验证 / 限制

- 两份外部报告都是**静态阅读**，未跑代码；Forge 样本也不是本工作树。
- 上游正式版（非 `-rc-lite`）是否多开特效接口未核。
- 本树 `fx.manifest` 的表现力边界（能合并哪些表、哪些 prefab 依赖 shader）以 `library.js` / `fx.py` 实现为准，
  本文件只按代码形状记录，未做逐 prefab 实测。
