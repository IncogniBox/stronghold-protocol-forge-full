# AGENT.md — 让别的 agent / AI 实时监测本项目

本文件面向**外部 agent、AI 助手与其他开发者**：讲清楚这个仓库里有哪些**可被程序读取的实时状态入口**、
改完代码后跑什么验证、以及怎么在【卫戍协议 Forge】这套工程里形成「观测 → 改动 → 复验」的闭环。

> 分工：**本文件**讲「怎么监测 / 怎么验」；仓库内的硬规则与代码地图见
> [`app/AGENTS.md`](app/AGENTS.md)（`docs/ARCHITECTURE.md`、`docs/DESIGN.md`、`docs/SYNC-POINTS.md` 都在那里索引）。
> 两者冲突时，**以 `app/AGENTS.md` 与 `docs/` 为准**。所有命令的**工作目录都是 `app/`**。

---

## 0. 一分钟速览

```bash
# 1) 服务在不在、跑的是什么内容（最便宜的实时读数，无鉴权、无副作用）
curl http://127.0.0.1:3000/healthz

# 2) 工坊包目录（每个已装包的版本 / 哈希 / 文件清单）
curl http://127.0.0.1:3000/mods/catalog.json

# 3) 改了代码之后：先定向、再全量
cd app
npx eslint <改过的文件>
npm run typecheck
node --test test/<area>/<file>.test.js
node --test --test-concurrency=8 --import ./test/official-data.mjs

# 4) 重启游戏服，再核对 1) 的 mods 摘要（它变了 = 新内容真的被加载了）
```

---

## 1. 实时监测入口（HTTP，只读）

游戏服默认监听 `http://127.0.0.1:3000`（端口可用 `PORT` / `HOST` 覆盖；启动脚本会打印本机 / 局域网地址）。

| 端点 | 内容 | 用途 |
| --- | --- | --- |
| `GET /healthz` | JSON 状态 | **第一读数**。见下表 |
| `GET /healthz?traffic=1` | 加了流量计数与内容哈希索引状态 | **只对回环 / 内网客户端**生效（`isLocalIp`，`app/server/http/routes.js`）；公网访问拿到的是不带 `traffic` 的那一份 |
| `GET /mods/catalog.json` | 已装工坊包的目录 | 每个包的 `id` / 版本 / 哈希 / 文件清单 —— 判断「这个包在不在、是不是我刚改的那版」 |
| `GET /api/rooms` | 公开房间数 | **一个整数，不是列表**（业主裁令：只报数，不枚举） |
| `GET /data.js` | 游戏数据快照 | 与客户端 `data.js` 同一份（作品的静态面） |

`/healthz` 的字段（`app/server/http/routes.js` 的 `healthReport`）：

```jsonc
{
  "ok": true,
  "version": 2,                 // 协议版本（PROTOCOL_VERSION）
  "app": "0.18.4",              // 发行版本（APP_VERSION）
  "uptimeSec": 902,             // 进程已运行秒数 —— 重启后它会归零，是「我改的代码真的起来了」的判据
  "build": "e5568df784b7",      // 当前正在服务的构建标签（客户端 buildGuard 靠它自动刷新）
  "sockets": 0, "sessions": 0,  // 连接 / 会话数
  "rooms": 0, "matches": 0,     // 房间 / 正在跑的对局
  "humans": 0, "bots": 0, "spectators": 0,
  "queued": 0, "queuedWaiting": 0, "queueSize": 4, "queueFormed": 0,   // 野排匹配队列
  "mods": "c745c299…",          // **装载内容的摘要**（装了工坊包时才有）
  "modPacks": 9                 // 装载的包数（装了工坊包时才有）
}
```

**监测要点**

* `mods` / `modPacks`：工坊包集合的**唯一身份**（`shared/modIdentity.js modSetOf`）。改包内容、加包、删包之后它一定变；
  `/healthz` 的 `mods`、`welcome.mods` 与每一份 BattleSpec 引用的是**同一串** —— 所以拿它当「服务端到底在跑什么」的锚点。
* `uptimeSec`：**重启核对**用它。改完服务端代码（`server/`）必须重启 3000 才会生效。
* 内容变了但 `mods` 没变 ⇒ 加载器没读到你的改动（缓存 / 文件没落盘 / 包清单没改）。

工坊编辑器（**只绑本机**，可写文件、无鉴权，不要暴露到公网）：

| 端点 | 内容 |
| --- | --- |
| `http://127.0.0.1:3311/api/state` | 编辑器的状态快照（包 / 表 / 数据） |
| `http://127.0.0.1:3311/stage.html` | **地图设计器**（2D 摆放 + 尺寸档 + 分区 + 路线 + 3D 预览） |
| `http://127.0.0.1:3311/pack.html` 等 | 包 / 波次 / 干员 / 敌人 / 盟约 / 装备 / 语音 各页 |

启动方式：`node tools/workshop-editor.mjs --open`（默认 `127.0.0.1:3311`；`--port 3400` 可换）。
注意：**编辑器保存地图只写 spec，不会派生寻路**（`groundPaths`）；同步进游戏包时要重新派生
（`deriveStage(spec, { paths: true })`），否则出怪不会走路。

---

## 2. 运行时观测点（浏览器侧）

| 观测点 | 位置 | 出现条件 |
| --- | --- | --- |
| **局内开发者面板** | `app/public/js/ui/devPanel.js` | 只在**「全量模拟」对局**（`m.public.dev === true`）出现：左侧把手 → 策略 / 敌人 / 玩家 / 干员 / 场景 五个分区 |
| **「全量测试统计」** | 工坊包 `app/workshop/data-board/ui/board.js` | 同上（`m.public.dev === true`）：盟约加成总和与来源、本回合预计伤害与 DPS、各增益的提升与占比 |
| **只读诊断浮层** | 工坊包 `app/workshop/dev-ext/ui/devPanel.js` | 同上；用 `ctx.net.welcome()` / `ctx.me.room` / `ctx.data.get('chess')` / `ctx.battle.damage()` 每帧读数 |
| **诊断报告** | `app/public/js/diag.js` | 记录未捕获错误 / 失败的请求 / 战斗内容报错，可导出纯文本报告（含可选 BattleSpec，可被 `tools/simrun.mjs` 重放） |
| **游戏全局句柄** | `globalThis.__SP__ = { store, net, data, version }`（`app/public/js/main.js`） | 浏览器控制台 / Puppeteer / Playwright 可直接读 `store`（`room` / `match.public` / `connection` 等） |

> **仅本地端生效（重要）**：上面第一处的**入口**与三块**面板**只在「服务端对端地址是回环 / 私网」的会话上出现。
> 判据是 `server/net.js` 的 `isLocalIp`（与 `?traffic=1` / `isLocalIp(clientAddress(...))` 同一处口径）：
> 服务端把结论写进 `session.local`，只在本地端会话上回 `welcome.devAllowed: true`，并在
> `server/lobby.js` 的 `create` 里**拒绝**非本地端的 `room.create { dev: true }`。
> 也就是说：**上传到公网服务器后，从外部连进来的浏览器看不到这些 UI，也没有任何指令能把它叫出来**
>（反向代理会失效这一点在 `routes.js` 里已注明，与本项目其它本地端口径同一处已知边界）。

---

## 3. 改完代码之后跑什么（离线校验）

**工作目录 `app/`。** 先跑**与被改动处最相关的那一个测试文件**，再跑全量。

```bash
npx eslint <改过的文件>                       # 目标文件：必须 0 error
npm run lint                                  # 全仓 eslint
npm run typecheck                             # tsc --noEmit --checkJs（jsconfig.json）
node --test test/<area>/<file>.test.js        # 定向：如 test/match/dev-funds.test.js
node --test --test-concurrency=8 --import ./test/official-data.mjs   # 全量（需要官方数据）
npm run golden                                # 黄金结果：重构不得移动 test/golden/*.json
npm run check:imports                         # 导入边界（sim 不得引 Node API 等）
node tools/i18n.mjs check --all --strict      # i18n：msgid ↔ public/i18n/*.json
npm run workshop:validate                     # 工坊包校验
node --test test/docs-consistency.test.js test/docs-paths.test.js    # 文档一致性 / 路径
npm run ci                                    # 上面这些的 CI 版（tools/ci.mjs）
```

**全量测试的当前基线**（2026-10-15）：`8821 tests / 8799 pass / 0 fail / 22 skipped`。数字只作对照，
判据是 **`fail` 必须为 0**；`skipped` 一般是需要素材 / Chrome 的套件（`SP_E2E=1`、`SP_REAL_E2E=1`、
`RENDER_E2E=1`、`SIM_E2E=1`，见 `app/AGENTS.md`）。

> ⚠️ **别用裸 `node --test` / `npm test` 跑全量**：那条命令**不带** `--import ./test/official-data.mjs`，
> 于是 `startServer()` 会照默认加载仓库自己的 `app/workshop/`（9 个包），每一次 `room.create` 都被模组握手拦住
> （`checkModSet`），`roomSeatCap` / `lobby` / 实时套件会**假红**。定向跑单个文件时也要带上那个 `--import`
> （除非你测的就是模组）。详见 `app/test/official-data.mjs` 的头注释。

**无头跑一局 / 跑一场**（平衡与回归用）：

```bash
node tools/matchrun.mjs --mode solo --difficulty FUNNY --seed 3     # 整局：逐回合 LP / 商店 / 部署 / 漏怪 / 首领
node tools/matchrun.mjs --mode coop --players 4 --seeds 20 --check   # 20 个种子 + 引擎不变量与规则审计（违规即 exit 1）
node tools/simrun.mjs --mode mode_multi_normal --round 5 --lineup "隐现@10,4" --ascii 5
node tools/perfbench.mjs / node tools/botbench.mjs                   # 性能 / bot 基准
```

---

## 4. 启动、重启与日志（让 agent 自己完成「改 → 起 → 验」）

```bash
# 游戏服（默认 3000）
node server/index.js                 # 前台
node --watch server/index.js         # 开发时自动重启（npm run dev）

# 工坊编辑器（默认 127.0.0.1:3311）
node tools/workshop-editor.mjs --open
```

Windows 上要给 agent 一个**分离进程**（不随 shell 退出而死），可用：

```powershell
Start-Process node -ArgumentList 'server/index.js' -WorkingDirectory 'd:\Ark\Stronghold-Protocol-Forge-0.18.3-0.2.6-win-x64\app' -WindowStyle Hidden
```

**重启后的核对清单**（照抄即可）：

1. `GET /healthz` → `uptimeSec` 变小（说明真的重启了）、`mods` 摘要是**这次改完之后的**值；
2. `GET /mods/catalog.json` → 目标包的 `version` / 哈希是**这次改完之后的**值；
3. 只有服务端文件（`app/server/**`、`app/shared/**`）改动才需要重启；纯客户端文件（`app/public/**`、
   工坊包的 `ui/**`）刷新页面即可（`/healthz` 的 `build` 标签会让旧页面自动重载）。

日志：前台运行直接看 stdout；分离进程看它的输出文件（`Start-Process` 的重定向 / 本工具后台任务的
`output.log`）。`/healthz` 里没有日志面 —— 报错走 stdout 与客户端 `diag.js`。

---

## 5. 代码地图（AI 的最短路径）

* 入口索引：[`app/AGENTS.md`](app/AGENTS.md) → `docs/ARCHITECTURE.md`（代码地图）→ `docs/DESIGN.md`（规则索引）
  → **`docs/SYNC-POINTS.md`（动任何协议 / 包字段之前先读：它列出必须一起改的地方，以及漏改时会「静默失败」的分支）**。
* 服务端：`app/server/index.js`（启动）、`app/server/net.js`（握手 / 会话 / 限流 / **本地端判定**）、
  `app/server/lobby.js`（房间与房间级钩子）、`app/server/match/{Match.js,match/*}`（对局状态机）、
  `app/server/sim/**`（确定性战斗，Node 与浏览器共用）。
* 客户端：`app/public/js/main.js`（装配）、`screens/`、`ui/`、`store.js`、`battle/runner.js`（浏览器本地跑战斗）。
* 工坊包：`app/workshop/<pack>/{pack.json,stages.json,waves.json,chess.json,kits/,battle/main.mjs,ui/,README.md}`。
  **只读边界**：包只能通过官方槽、组件改写（`wraps`）、自己的消息通道、声明过的只读数据表与站点模块
  import 取数 —— 不许改对局结果、不许进线路。
* 本 Forge 发行版自加：`g.dev` 开发者通道（动作闭枚举 `shared/protocol.js DEV_ACTIONS`）、
  大厅「全量模拟」入口（`screens/lobby.js`）、局内开发者面板（`ui/devPanel.js`）、
  `dev-ext` 与 `data-board` 两个工坊包。

---

## 6. 已知会「静默失败」的坑（本次工作踩过的）

1. **i18n 扫描**：`app/test/i18n.test.js` 会扫 `public/js` / `shared` / `server` 里**每一个** `t('…')` 的 msgid，
   要求它出现在 `app/public/i18n/en.json` —— 加文案**必须**同时加词条，否则全量测试红。英文值里不许留中文；
   msgid 里的 `{占位符}` 在译文里必须保留。
2. **注释行号被钉住**：`app/test/promptCitations.test.js` 引用具体行号（如 `runner.js:NNN`）。
   在那些文件里**增删注释行**会把引用挪位、测试变红 —— 改动前先看这个测试。
3. **增量帧**：`m.public` 是差分推送，**新加的顶层键必须首帧就存在**（否则每次都被差集拒绝、整帧重发）。
4. **加载顺序**：`server/net.js` 的 `welcome` 在 `onHello` **之前**发给客户端；只关心「握手那一刻的答案」的
   客户端读数（如大厅的 `serverSeatMaxOf()` / `devAllowedOf()`）必须在**模块作用域**订阅 `net.on('welcome', …)`
   （屏幕被挂载时握手已经过去了）。
5. **本地端 = 回环 / 私网**：`isLocalIp` 认 `127/10/172.16-31/192.168/169.254/100.64-127/0` 与 IPv6 ULA /
   link-local；**反向代理（`TRUST_PROXY`）判错会失效**，`routes.js` 里有明文边界说明。
6. **数据表不许手改**：`app/data/*.json` 由 `tools/build-data.mjs` 生成；工坊包的游戏数据也不许手改底层数据表，
   要走 `pack.json` 的 `content` / 覆盖声明。
7. **黄金结果**：重构不得移动 `app/test/golden/*.json`，有意为之的玩法改动要在同一次提交里
   `npm run golden:update` 并说明移动了哪些场景。

---

## 7. 推荐的「agent 实时监测」循环

一个可复用的闭环（每一步都有机器可读的判据，不靠人眼）：

```
读 /healthz            → uptimeSec / mods / modPacks 记下基线
   ↓
改代码（先读 docs/SYNC-POINTS.md 与要动的那份 docs/）
   ↓
npx eslint <文件> + npm run typecheck + 定向 node --test <文件>
   ↓
全量 node --test --test-concurrency=8 --import ./test/official-data.mjs   （要求 0 fail）
   ↓
只有 server/shared 改动 → 重启 3000 → 再读 /healthz（uptimeSec↓、mods 是新的）
   ↓
需要看运行时时：开一局「全量模拟」（仅本地端）→ 局内开发者面板改数据 / data-board 看统计 /
   dev-ext 浮层读数 / 浏览器 __SP__.store 直接读；报错走 diag.js 导出报告
   ↓
把「基线 → 现值」的差异写回报告（mods 摘要、包版本、测试统计行都照抄原文，别转述）
```

---

## 8. 上游硬规则速查（完整版在 [`app/AGENTS.md`](app/AGENTS.md)）

* **官方优先**：规则来自官方数据表与 PRTS；没有来源的细节按最简实现并标 `[ASSUMED]`。
* **确定性**：`server/sim/**` 是 Node / 浏览器共用的纯 ESM —— 不许用 Node API、`Math.random`、时钟、
  引擎近似的 Math（用 `sim/detmath.js`）。
* **不许改线**：协议形状改动必须同步 `shared/protocol.js`、`docs/SYNC-POINTS.md` 与相应测试。
* **工坊包只读边界**：面板 / 行为层不得改对局结果、不得进线路（见 `docs/WORKSHOP.md`）。
* **非商业**：无广告、无支付、无其它商业化。
