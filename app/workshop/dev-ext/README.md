# 开发者功能扩展（dev-ext）— 内容与引擎扩展点清单

本包 `workshop/dev-ext/` 是**专门用来测试各种数据与环境**的开发工具包：它提供大厅「全量模拟」入口要打的那张
**试验场关卡**（`dev_full_sim`，每回合的出怪表是**空的**，怪物由局内开发者面板现场添加），并挂一个**左下角可收起的
只读诊断浮层**。局内那张**开发者面板**（改策略 / 敌人 / 玩家 / 干员 / 场景）与大厅那处入口在**核心**，不在本包里 ——
它们的**具体位置逐条列在下面 §1 与 §2**。

- `gameVersion` 0.3.1。**内容包 + 客户端面板 + 一条服务端战斗逻辑**：`content: ["stages","waves"]`、
  `server.battle.module`（`battle/main.mjs`）、`client.panels` 1 个（`root.overlays`）。
- **不携带任何素材**；不改动任何对局结果 —— 它只**声明**那两处入口要用的关卡，并把面板改过的**干员数值**挂成
  **该干员自己的属性 buff**（§1.4）。

---

## 0. 概览

| 面 | 内容 |
|---|---|
| 数据面 `content` | `stages`（`stages.json`，1 张：`dev_full_sim`）、`waves`（`waves.json`，1 张：`dev_ext_empty`） |
| 服务端模块 | 1 条：`server.battle.module` → `battle/main.mjs`（`install(battle)`，把面板改的干员数值挂成 buff） |
| 客户端面板 | 1 个：`dev` → 挂载槽 `root.overlays`（`ui/devPanel.js` + `ui/devPanel.css`，左下角可收起） |
| 组件改写 | 无 |
| 只读数据表 | `chess` |
| 包通道 | 无 |
| 素材 | 无（`art` / `skins` / `bondIcons` / `itemIcons` 都没有） |
| 文件数 | 7（`pack.json`、`stages.json`、`waves.json`、`battle/main.mjs`、`ui/devPanel.js`、`ui/devPanel.css`、`stage-specs/dev_full_sim.json`） |

---

## 1. 这个包往引擎里加了什么

### 1.1 试验场关卡 `stages.json`（id `dev_full_sim`）

`weight: 0` + `active: false` ⇒ **正常抽图永远不会**选中它。只有「全量模拟」的 `room.create.stage` 覆盖
（`app/server/match/Match.js` 的 `stageOverride = this.devStage || forcedStage`，与编辑器 `SP_STAGE` 同一条路）
或 `dev` 局才打这张图，因此**普通对局与从前逐字相同**。

| 字段 | 值 |
|---|---|
| `modes` | `["mode_single_normal"]` |
| `size` | `[19, 21]`（标准档） |
| `rows` / `tiles` | `tiles` 定义 **16 种**：`r` 路 / `f` 地面 / `p` 可部署地面 / `#` 高台 / `X` 边界 / `a` 高台 / `b` 围栏 / `S` 起点 / `E` 终点 / `I`·`O` 传送点 / `m` 沼泽 / `g` 烟幕 / `d` 深水 / `i` 感染 / `-`；`devices: []` |
| `deployTiles` | 三套分区（`normal` / `bossLeft` / `bossRight`），各含 `melee` / `rangedOnly` / `changedByDevices` |
| `groundPaths` / `groundPathsWithDevices` | **各 10 条**门到门路线（由服务端 `deriveStage(spec,{paths:true})` 现场推导） |
| `rounds` | **1–15 全部** → `dev_ext_empty`（空波次表，见 §1.2） |
| `options` | `{ characterLimit: 8, moveMultiplier: 0.5, groundHighGround: true }` |

**地图的源文件**是 `stage-specs/dev_full_sim.json`（地图设计器 `/stage.html` 的可再编辑格式）。
⚠️ **编辑器保存只写 spec、不派生寻路**（`groundPaths`）：改完图要么在编辑器里保存后再由引擎派生，要么跑
`deriveStage(spec, { paths: true })` 重新生成 `stages.json`，否则出怪不会沿路走。

### 1.2 空波次表 `waves.json`（id `dev_ext_empty`）

`spawns: []` / `totalCount: 0` —— **每回合的内置出怪已全部删除**，方便现场添加。其余档位照常：
`kind: "normal"`、`maxPlayTime: 45`、`dp { init: 10, perSec: 1, max: 99 }`、`characterLimit: 8`、
`bgm: "bat_kazimierz2_2"`。

`routes` 是操纵者在设计器里**画的两条路线**（面板现场添加的敌人按它们、按顺序轮流行走 ——
`routeIndex` 由 `.../intents.js` 按 `devExtraEnemies.length % routes.length` 轮转）：

| # | 起点 | 终点 | 形状 |
|---|---|---|---|
| 0 | `(9,10)` | `(9,1)` | 16 段 checkpoints，在 `col 9 ↔ 12` 之间锯齿来回 |
| 1 | `(12,10)` | `(9,1)` | 16 段 checkpoints，同上反向 |

### 1.3 只读诊断浮层 `ui/devPanel.js` / `ui/devPanel.css`

挂在 `root.overlays`，**左下角**，标题栏右侧一个「收起 / 展开」按钮（状态记在面板偏好 `ctx.session`，刷新也记得住）。
全部走引擎已给的注入面 —— **没有任何 store / match / Battle 句柄**：

| 读数 | 来源 |
|---|---|
| 本包 id | `ctx.pack` |
| 服务器版本 | `ctx.net.welcome()` |
| 本房间跑的模组 | `ctx.me.room.mods` |
| `chess` 表条数 | `ctx.data.get('chess')`（本包声明 `data: ["chess"]`） |
| 本场逐人伤害累计 | `ctx.battle.damage()` |

每秒重画一次；拿不到读数时画「—」，**不抛、不编造**。

### 1.4 服务端战斗逻辑 `battle/main.mjs`

只做一件事：把**开发者面板改过的干员数值**挂到那名干员身上（面板改的数值由核心 `g.dev {action:'grantChess', overrides}`
写在棋子的 `meta.data.devExt`，随战斗输入进 `u.pieceData.devExt`）。

- `install(battle)` 在 `battleStart` 遍历 `battle.allyUnits`，对每个带 `pieceData.devExt` 的干员
  `addBuff({ key: 'devext:<uid>', persist: true, allowDead: true, refresh: 'replace', mods, tags: ['dev'] })`；
  **没有覆盖**的干员一律 `removeBuff` ⇒ 与从前逐字相同。
- `devMods(ov)`：`atk` / `def` / `hp` 走 `S.directMods`（比例），`aspd` / `resFlat` / `batPct` / `blockCnt` 追加（点数 / 比例）。
- 改了生命上限时把当前血量补到新上限（`u.hp = u.s.maxHp`）—— 否则血条上看不出变化。

---

## 2. 引擎侧需要的支持（核心里的具体位置）

本包**不新增任何引擎端口**，但这些入口/面板是**核心**（非包）实现的 —— 下表就是它们逐条的落点：

### 2.1 大厅入口与「全量模拟」流程（客户端）

| 位置 | 内容 |
|---|---|
| `app/public/js/screens/lobby.js` 的 `MODE_CARDS` | 第 4 张模式卡：`{ id: 'full', name: N_('全量模拟'), en: 'FULL SIMULATION', icon: 'rook' }` |
| 同上 `FULL_SIM_STAGE` | `'dev_full_sim'` —— 建房时强制打的那张图（= §1.1 的 id） |
| 同上 `ProtocolSelect` | `card.id === 'full'` 时右侧**整段换成**一张 `<button class="pcard pcard--full is-on">`（没有难度列表） |
| 同上 `createFullSim()` | `room.create { mode:'solo', dev:true, stage: FULL_SIM_STAGE }` → **立刻** `room.start`（跳过房间界面） |
| 同上 大厅入口 | `<${HubEntry} name=${t('全量模拟')} en="FULL SIMULATION" icon="rook" tone="green" />`，**排在「独立模拟」左边**，且**被 `devAllowed` 包住**（§3） |
| 同上 `onCreate` | `simulation === 'full' ? createFullSim : create` |
| 同上 `devAllowed` / `devAllowedOf()` | 模块作用域订阅 `net.on('welcome', …)`，读 `welcome.devAllowed`；`pickMode()` 里对 `'full'` 兜底 |
| `app/public/css/screens/lobby.css` | 大厅入口的绿色档；`.pcard--full` / `.pcard--full.is-on` |
| `app/public/i18n/{en,ja,ko,zh-TW}.json` | 词条 `全量模拟` |

### 2.2 局内开发者面板（客户端）

| 位置 | 内容 |
|---|---|
| `app/public/js/screens/game.js` | 对局屏挂载 `DevPanel` |
| `app/public/js/ui/devPanel.js` | 面板本体：收起态是左侧竖排把手，展开后 **五个分区** —— 策略相关 / 敌人相关 / 玩家相关 / 干员相关 / 场景相关 |
| 同上 `dev(action, fields)` | 所有读写都走核心指令 `net.send('g.dev', …)` |
| 同上 `SectionBand` / `SectionEnemy` / `SectionOp` + `SearchBox` / `matches()` | **搜索栏**（三页共用，按名字 / 键 / chessId / charId 过滤，忽略大小写；无匹配画一句提示） |
| 同上 `SectionPlayer` | 资金 / 生命值 / 调度中心阶级 / 干员槽位 / 装备槽位 / 盟约层数 / 装备获取 |
| 同上 `SectionScene` | 换地图（立刻生效）、下一回合普通 / 首领对战、**替换首领场景正中的首领**并可自定义数值 |
| `app/public/css/screens/game-panels.css` | `.devpanel__*`（含 `.devpanel__search` / `.devpanel__search-input`）、`.devpanel__detail`（修改页固定在本页**右边**） |
| `app/public/js/ui/hud.js` | 顶栏绿色模式牌 `.gtop__mode-dev`（`pub.dev` 为真时替代难度牌）—— 左上是**全量模拟**而不是终极模拟 |
| `app/public/i18n/en.json` | 本次新增词条 `搜索` / `没有匹配的项`（面板其余文案见各语言包） |

### 2.3 协议

| 位置 | 内容 |
|---|---|
| `app/shared/protocol.js` 的 `room.create` | 两个**可选**字段：`dev`（布尔）与 `stage`（关卡 id，`[A-Za-z0-9_.-]{1,64}`）；两者都在 `$optional` 里 |
| 同上 `g.dev` | 形状判据（`action` 可选 = 旧形状 `{ funds }`） |
| 同上 `DEV_ACTIONS` | 动作**闭枚举**：`funds` / `lp` / `shopLevel` / `shopSlots` / `layers` / `band` / `item` / `grantChess` / `spawnEnemy` / `enemyOverride` / `stage` / `roundKind` / `boss` |

### 2.4 服务端

| 位置 | 内容 |
|---|---|
| `app/server/net.js` | `session.local = conn.ip === '?' || isLocalIp(conn.ip)`（每次 `hello` 重算，见 §3）；`welcome` 组装时把 **session** 交给 `welcomeInfo(session)` |
| `app/server/lobby.js` 的 `create()` | 开发者模式只收 `mode:'solo'`，且 **`session.local === true`**；`stage` 必须是本服务器已加载的图（否则 `BAD_TARGET`）；写进 `room.dev` / `room.devStage` |
| 同上 `startMatch()` | 把 `dev` / `devStage` 传进 `Match` 的 opts |
| 同上 `welcomeInfo(session)` | 只在本地端会话上带 `devAllowed: true`（§3） |
| `app/server/match/Match.js` | `dev` / `devStage` / `devExtraEnemies` / `devEnemyOverrides` / `devShopSlots` / `devBossOverrides` / `devRoundKind` / `devBossRound` 八个字段（注释在构造函数上方） |
| `app/server/match/match/platform.js` | `start()` 里 `if (this.dev) this.skipToBattle()` —— 跳过 INFO_CHECK / BAND_DRAFT 两屏 |
| `app/server/match/match/phases.js` | `skipToBattle()`；`startRound()` 消费 `devRoundKind` 并记 `devBossRound`；`devWaveRound(r)`（`rounds` 的键只到 15，更后面的回合**沿用最后一个有绑定的回合**）；每回合起始清空 `devExtraEnemies` / `devEnemyOverrides`（所以添加的敌人**只在添加的那个回合**出现） |
| `app/server/match/match/intents.js` | `devEdit(ps, msg)` —— `g.dev` 的 action 化实现；`spawnEnemy` 的 `routeIndex` 按已添加条数轮转；`boss` 的 `overrides` 就地改活池 |
| `app/server/match/match/views.js` | `...(this.dev ? { dev: true })`；`devNextKind`（dev 局**恒出现**，未武装为 `null`）；`lastRound: this.dev ? 999 : …`（**回合数无限**）；`bossRound: devBossRound ?? gd.bossRound`；`devEnemies`（预览区） |
| `app/server/match/match/prep.js` | `endPrep()`：本回合是 `gd.bossRound` **或** `devBossRound` ⇒ FINAL_ASSAULT |
| `app/server/match/match/bossRounds.js` | `_devBossOverride()` / `_bossPoolHp()` / `_bossEnemyOverrides()`（键 = `boss.enemyKey`）；`_finishFinal` 的 dev 分支 ⇒ `devNextRoundAfterBoss()`（**击败首领不结束对局**，进下一回合） |
| `app/server/match/match/combat.js` | 回合的 `spawns` / `enemyOverrides` 并进面板追加物 |
| `app/server/match/gamedata.js` | `shopSlots()` 支持 per-match 覆盖（`devShopSlots`，面板改的调度中心槽位） |
| `app/test/match/dev-funds.test.js` | 11 条测试钉住：形状 / 门禁 / 每个 action / `routeIndex` 轮转 / 换图与 `roundKind` 真跑首领链 / 首领数值覆盖 / `lastRound 999` 与 `devWaveRound` / 首领战结束不结算 |

> 相关：工坊包 **data-board** 的「全量测试统计」页只在 `m.public.dev === true` 的对局出现（即本包开的
> 「全量模拟」局），它的读数口径见 `workshop/data-board/README.md`。

---

## 3. 「仅本地端生效」——三道闸

「全量模拟」入口、局内开发者面板、以及本包那块浮层**只在本地端（回环 / 私网）生效**。上传到公网服务器后，
从外部连进来的浏览器看到的东西与这些功能不存在时**逐字节相同**，而且**没有任何指令能把它叫出来**：

1. **服务端点名拒绝**（真正的闸）：`app/server/lobby.js` 的 `create()` ——
   `if (dev === true && session.local !== true) return fail(ERR.BAD_MSG, 'developer mode is only available from a local (loopback / private network) client')`。
   删掉这一段就会退回「谁都能开一局全量模拟」。
2. **握手如实说明**：`app/server/lobby.js` 的 `welcomeInfo(session)` 只在 `session.local === true` 时带上
   `devAllowed: true` —— 非本地端**这个键根本不出现**。
3. **客户端据此不画**：`app/public/js/screens/lobby.js` 的 `devAllowed`（大厅入口 + `pickMode` 兜底）；
   本包 `ui/devPanel.js` 的 `mount()` 开头拿不到 `ctx.net.welcome().devAllowed` 就**整块不画**（连把手也不画）。

判据本身是 `app/server/net.js` 的 `isLocalIp`（回环 / `10.` / `172.16–31.` / `192.168.` / `169.254.` / `100.64–127.` /
IPv6 ULA 与 link-local），与 `?traffic=1` 那处**同一口径**。**已知边界**：反向代理（`TRUST_PROXY`）判错会失效 ——
`app/server/http/routes.js` 里对同一条边界有明文说明。

---

## 4. 文件清单

| 文件 | 职责 |
|---|---|
| `pack.json` | 声明 `content: ["stages","waves"]`、`combat: true`、`server.battle.module`、`client.panels[0]`（槽 `root.overlays`、读 `chess`） |
| `stages.json` | 试验场关卡 `dev_full_sim`（§1.1）：`weight: 0`、分区、10 条 `groundPaths`、1–15 全绑 `dev_ext_empty` |
| `waves.json` | 空波次表 `dev_ext_empty`（§1.2）：`spawns: []` + 两条画好的 `routes` |
| `battle/main.mjs` | 服务端战斗逻辑（§1.4）：把 `pieceData.devExt` 挂成该干员的属性 buff |
| `ui/devPanel.js` / `ui/devPanel.css` | 只读诊断浮层（§1.3）与其样式 |
| `stage-specs/dev_full_sim.json` | 地图设计器（`/stage.html`）的**源文件**，可再编辑 |

---

## 5. 用法

1. 服务端启动时加载本包（`startServer()` 默认读仓库的 `workshop/`；换目录用 `--workshop <dir>` / `SP_WORKSHOP`）。
   **改包之后必须重启游戏服务器**（`mods` 摘要要跟着变，见 `AGENT.md` §4）。
2. 大厅底部「模拟方式」那一排的 **全量模拟**（**仅本地端可见**）→ 选择界面右侧**没有难度列表**，只有一张绿色
   「全量模拟」卡片 → **开始模拟** 直接进本试验场的战斗，**跳过「确认本局信息」与「选择策略」两屏**。
3. 局内在左侧把手展开**开发者面板**：改策略 / 玩家数据 / 加干员 / 加敌人 / 换场景与首领；添加的敌人按 §1.2 的
   两条路线走，且**只在添加的那个回合**出现。
4. 改地图：在 `/stage.html` 里编辑并保存（只写 spec），再按 §1 末的提醒**重新派生** `stages.json`。

---

## 6. 边界与约定

- **[ASSUMED] 试验场的分区/地形是按地图设计器格式画的**，`deployTiles` / `groundPaths` 由服务端 `deriveStage`
  现场推导（不是手写坐标）；改图请回到设计器，不要手改 `stages.json` 里的派生字段。
- **面板加的敌人只在添加的那一个回合**（`startRound` 起始清空 `devExtraEnemies` / `devEnemyOverrides`）——
  这是刻意的：预览区与战斗用的是**同一份列表**。
- **首领血量口径是共享血量池**：面板填的「最大生命值」进 `devBossOverrides`，成为**池的上限**（领袖单位的生命上限
  在战斗中被池同步覆盖）；`atk` / `def` / `res` 并进这一场的 `enemyOverrides`（键 = `boss.enemyKey`）。
- **干员的特质 / 天赋 bb 目前没有 per-instance 改写通道** —— 面板能改的是**属性类**数值（`battle/main.mjs` 的
  `devMods` 那几键）。
