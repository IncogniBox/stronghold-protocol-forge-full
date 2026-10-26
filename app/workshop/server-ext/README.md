# 服务器功能扩展（server-ext）

给大厅、房间与对局补四块**社区界面**：大厅左栏底部的一块公共频道、房间「房内聊天」标题旁的一枚邀约按钮、
对局左下角一块可折叠的半透明「房内聊天」框，以及**右下角的账号芯片与账号面板**。同时自带一套**账号服务**
（§7）：注册 / 登录 / 服务端分配四位编号 / 头像待审 / 名称审核 / 云配置 —— 服务端那一半是本包的
`server.modules`（`write: true` 落盘 + 自带的 WebSocket lane `/mod-ws/server-ext/accounts`），
**不新增任何引擎协议类型**。
**没有 `content`、不携带任何素材与数据表**（这一版只多了一个服务端模块与五块界面）。

- `gameVersion` 0.3.1。文件：`pack.json` + `ui/chat.js` + `ui/chat.css` + `ui/roomInvite.js` + `ui/battleChat.js` + `ui/battleChat.css` + `ui/panel.js`（含账号客户端）+ `ui/acct.css` + `ui/roster.js` + `ui/roster.css` + `server/accounts.mjs` + `server/wsMini.mjs`。

---

## 1. 六块界面（六个面板 / 六个槽位；`entry` 与 `profile` 共用同一个模块）

| 面板 id | 槽位 | 位置 | 文件 |
|---|---|---|---|
| `hub-chat` | `screen.lobby.aside` | 大厅**左栏底部**（`screens/lobby.js` 的 `<aside class="hub-side">` 里那一格） | `ui/chat.js` + `ui/chat.css` |
| `room-invite` | `screen.room.chat` | 房间「房内聊天」`Panel` 标题行（`screens/chat.js` 的 `actions` 里那一格） | `ui/roomInvite.js` |
| `battle-chat` | `screen.game.overlay` | 对局屏**左下角**、引擎「交流」按钮的**上方**（`screens/game.js` 根部那块 `.mod-host`） | `ui/battleChat.js` + `ui/battleChat.css` |
| `entry` | `screen.title.entry` | **起名页那张卡片里**（「开始」按钮**下面**，`screens/title.js` 渲染的宿主）：内联的「登录 / 注册」，注册完直接以账号名进大厅。想做游客的人照旧填代号按「开始」——那条路一个字没动 | `ui/panel.js`（同一个模块的另一半） + `ui/acct.css` |
| `profile` | `screen.stats.profile` | **统计页（右上角个人入口）正文开头**的一个段落：`screens/stats.js` 把它渲染在 `<main class="st-body">` 的**最前面**（**不是** `Dr. 名字` 那一栏里 —— 那一栏在「还没有记录」时整块不渲染，挂那儿会让新玩家彻底看不到账号区；真机自测撞到过）。三段：未登录时「登录 / 注册」、已登录时账号视图（身份卡/上传头像/改名/改口令/云配置/退出）、外加一个**独立的「管理后台」视图**（管理口令是另一把钥匙，不是「登录之后才有」）。**不再是右下角的浮动芯片/弹窗**（业主裁令 2026-10：并入个人信息页） | `ui/panel.js` + `ui/acct.css` |
| `roster` | `screen.room.aside` | 房间旁栏一块**成员名单**：每位**在座**成员一行「头像 + `昵称#编号`」（靠**票据绑定**换出来的账号身份），没绑定的成员显示引擎给的显示名 + 「未绑定」；空座位不进名单（把 20 张空座位也画出来会让这块旁栏涨到列表上限，把房间座位区挤矮） | `ui/roster.js` + `ui/roster.css` |

**`hub-chat`** 有两个页签：

- **大厅交流** —— 大厅里所有人互相可见的公共消息：滚动列表（发送者 + 文本）+ 输入框 / 发送按钮 + 一排表情
  （😀 😂 👍 ❤️ 🎉 😭，点一下插进草稿）。历史有界（最近 200 条）。
- **同盟邀约** —— 别人发来的房间邀约，一行「房间名 + 密钥」；**密钥是个可点的芯片**，点它即入房（见下）。列表有界（50 条）。

面板根类名是 `community-chat`：**引擎约定**，`public/css/screens/lobby.css` 有
`.hub-dialog-open .community-chat { visibility: hidden }`（大厅弹窗打开时让位），所以这个名字不是随手取的。

**`battle-chat`** 与上面两块**不同**：它不建自己的通道，直接用**引擎的房间聊天**（`screens/chat.js` 那份对话）。

- **收**：订阅引擎 S2C 的 `chat.msg`（实时）与 `chat.history`（重连补发，整体替换），渲染成「发送者 + 文本」的
  有界列表（最近 200 条）。快捷短语（`chat.msg.quick`）本包**不引服务端的短语词表**，照原样把 id 拼出来。
- **发**：输入框 + 发送按钮走 `ctx.session.send('room.chat', { text })` —— 与玩家自己在「房内聊天」面板里点「发送」
  是**同一条** C2S。`room.chat` 是本包依赖的引擎面**唯一一处新增**：它被加进 `PANEL_SEND_TYPES`（`public/js/ui/
  extensions.js`），属于**用户动作**那一类，不改这一局的任何数值。
- **能不能说照实说**：是不是旁观者、房间 `chatMode` 允不允许打字，都从 `store.get()` 现读；旁观 / `chatMode !== 'open'`
  时没有输入框，只有一行说明（`观战中无法发言` / `该房间只允许快捷短语` / `该房间已关闭聊天` / `不在房间内`）。
- **折叠是模块级**（只活这一次页面会话）：折叠态是一枚小芯片（尺寸照引擎 `ui/combatMetrics.js` 那块统计面板的开关
  idiom），展开态是一块 `opacity: .8` 的半透明面板，都钉在「交流」按钮上方。

## 2. 两格通道（都是**大厅通道**）

> `battle-chat` **不在这张表里** —— 它一个包通道都不用（只用引擎类型），所以它的 `pack.json` 条目里没有
> `messages` / `scope` 这两格。下面两格只属于 `hub-chat` 与 `room-invite`。

| 通道 | 谁发 | 谁收 | 载荷 |
|---|---|---|---|
| `lobby` | `hub-chat` 的输入框 / 发送按钮 | 大厅里的所有连接 | `{ text }` |
| `invite` | `room-invite` 的按钮 | 大厅里的所有连接（`hub-chat` 的「同盟邀约」页签） | `{ name, code }` |

两格都在 `pack.json` 里对**各自的面板**写了 `scope: "lobby"`：

```jsonc
{ "id": "hub-chat",    "slot": "screen.lobby.aside", "scope": "lobby", "messages": ["lobby", "invite"] }
{ "id": "room-invite", "slot": "screen.room.chat",  "scope": "lobby", "messages": ["invite"] }
```

`scope` 是面板的**作用域**（docs/WORKSHOP.md §1.9.6）：不在那里声明，包通道就只在房间内广播（默认 `'room'`）；
声明成 `'lobby'` 之后，服务器（`server/lobby.js` 的 `packLobbyChannels` / `packMsg`）才允许把它广播给**大厅里**
（不在房间）的会话。两格通道由**同一批面板清单**推出（`packChannels` / `packLobbyChannels` 是同一份数据的两个
读者），所以「前端说得出什么、服务端收什么都不用对第二张表」。

## 3. 入房：密钥芯片那一按

点一枚密钥芯片会走引擎既有的入房链路（与大厅「密钥加入」**同一套**判据，`screens/lobby.js` 的 `joinWithConsent`）：

1. `net.request('room.join', roomMods.buildJoinPayload(code))` —— 先按**没同意**发一次：载荷里带服务器摘要 `mods`
   （装了包的服务器缺它会直接拒），但不带 `consent`；
2. 服务端回 `MOD_CONSENT_REQUIRED` 时，用 `roomMods.consentRetryPayload(err, code)`（= 同一份载荷 + `consent: true`）
   重发一次；
3. 其余失败原样 `toastError(String(err))`。

所以「重发什么」只有 `roomMods` 一处写着（大厅那三处入口共用它），本包只是照它做。

## 4. 房间名从哪来（推导，不是引擎字段）

服务端**没有**「房间名」这一格：`room.state` 只有 `code` / `mode` / `seats` / `hostId`。一个房间唯一稳定可读的
身份是**房主那一席的显示名**（`seats` 里 `playerId === hostId` 那一条的 `name`），所以 `ui/roomInvite.js` 现算：

```
name = `${房主名} 的同盟` + (模式 === 'solo' ? ' · 独立模拟' : ' · 同盟模拟')
```

这是**这里现读 store（`store.get().room`）推出来的**，别处不该再算一遍。

## 5. 依赖的引擎面

| 引擎面 | 用途 |
|---|---|
| `client.panels[].slot: screen.lobby.aside` / `screen.room.chat` / `screen.game.overlay` | 三个宿主的地址（容器由组件自己渲染 `[data-mod-slot]`；`.mod-host` 是 `display: contents`，面板默认 `pointer-events: none`，所以本包样式里打开 `pointer-events: auto`） |
| `GET /mods/panels.json`（**引擎表面**，握手前的声明） | 与 `welcome.modPanels` **同构**的那份清单（外加 `modTheme`）；引擎在开机时 `fetch` 它并 `apply`，所以**还没握手**的起名页上就能长出包界面。没有包声明时这个端点 404 |
| `client.panels[].slot: screen.title.entry`（**引擎表面**，起名页那一格） | 内联注册 / 登录的宿主：`screens/title.js` 在「开始」按钮下面渲染 `[data-mod-slot="screen.title.entry"]`。**没有这一格的引擎**上，这个面板会被客户端点名拒掉（`CLIENT_BAD_PANEL_SLOT`），所以本包 README 里写了它对引擎版本的要求 |
| 槽位宿主「**刚刚出现**」也要被发现 | 统计页由它**自己的 store**驱动（`stats.js` 的 `statsStore`），开那一页**不会**碰主 store ⇒ 光靠主 store 变化那一次 `flush` 是发现不了新宿主的。引擎为此加了一条**只认槽位宿主**的 DOM 观察（新增/移除的元素自己或子树里含 `[data-mod-slot]` 才触发，防抖到一帧） |
| `client.panels[].scope: "lobby"` + `messages` | 包通道的大厅作用域（`server/lobby.js` 的 `packLobbyChannels` / `packMsg`）—— 只 `hub-chat` / `room-invite` 用 |
| `ctx.net.on(channel, fn)` / `ctx.net.send(channel, data)` | 两格包通道的收 / 发（`public/js/ui/extensions.js`） |
| `ctx.net.on('chat.msg' / 'chat.history' / 'room.state', fn)` | `battle-chat` 订阅**引擎**房内聊天（S2C 原样透传，不必声明 `messages`） |
| `ctx.session.send('room.chat', { text })` | `battle-chat` 发言（引擎消息那条路；`room.chat` 在闭枚举 `PANEL_SEND_TYPES` 里） |
| `public/js/net.js`（`import { net } from '/js/net.js'`） | 入房请求 `room.join`（`net.request`），与 `ctx.net` 的「包通道」不是同一条路 |
| `public/js/roomMods.js` | `buildJoinPayload` / `consentRetryPayload` —— 入房的「重发什么」唯一真相 |
| `public/js/store.js` | 房内那枚按钮与 `battle-chat` 都现读 `room.state`（旁观 / `chatMode`） |
| `public/js/ui/toasts.js` | `toastError` |
| `public/css/screens/lobby.css` 的 `.hub-dialog-open .community-chat` | 大厅弹窗打开时让位（面板根类名必须叫 `community-chat`） |
| `public/css/screens/game.css` 的 `.gm__corner` / `.gm__gear` | `battle-chat` 照「交流」那排按钮（`.gm__corner`：left/bottom .24rem、高 .56rem）把折叠芯片钉在它**上方**，芯片尺寸照 `.gm__gear` |
| `ctx.session.setName(name)`（**引擎表面**） | 账号面板登录之后把游戏名落成账号名。引擎的 `net.setName` 不对包开放，所以这是唯一入口；宿主没装这一格时面板显式说明「未装」而不是静默失效 |
| `ctx.session.setAvatar(src)`（**引擎表面**，2.4.4 起用） | 账号面板把**已审核**的那枚头像交给引擎（§28.58.3）：大厅右上角那枚个人芯片（`ui/accounts.js` 的 `AccountMeChip` → `AvatarFrame.src`）、**凡是画「你自己」的人像**（`ui/gameComponents.js` 的 `PlayerAvatar` 在 `self` 为真时自己读 store —— 局内自己那一行 / 策略轮选 / 结算页 / 机变选择）与房间席位卡上自己那一席（`screens/room.js` 的 `SeatCard`）都照它画。**先探测再使用**；宿主没装这一格时**静默跳过**（头像只是外观，不该为它弹说明）。值只收 `data:image/…;base64,…` 或根相对路径，`null` 是清除；**引擎还会把它落盘**（`sp.pref.meAvatar`），所以同一标签页刷新后不必再等面板推一次 |
| `ctx.cloud.read()` / `ctx.cloud.apply(patch)`（**引擎表面**） | 云配置那七类（`settings` / `loadout` / `ownership` / `diy` / `conflict` / `appearance` / `lang`）。面板**没有 store 句柄**，所以「读本机偏好 / 把它写回本机」只能由引擎给的这一格来做（`apply` 落盘后会重载页面 —— 偏好是引擎开机时读的） |
| `welcome.bindTicket`（**引擎签发的票据**） | 把「本机游戏的 `playerId`」可信地交给包：客户端 `ctx.net.welcome().bindTicket` 原样转发给本包 lane 的 `bind`。票据 120 秒、一票一用、**密钥永不外泄**（包只拿得到验证函数） |
| `host.tickets.verify(ticket, { consume })`（**引擎表面**，`server.modules` 的 `uses` 里声明 `"tickets"`） | 包**验票**的唯一入口。包不能签票、也不持有密钥 —— 「同一份包字节 ⇒ 同一份行为」那条不变量因此成立 |
| `ctx.net.on('room.state', fn)`（引擎 S2C，原样透传） | 名单的**座位表来源**（`room.state.seats[].playerId`）—— 与 `battle-chat` 订阅引擎房内聊天同一条路，不必声明 `messages` |

## 6. 一句话边界

面板能画错。两格包通道的载荷是**不透明**数据（引擎不看、不改、不落库），接收端一律按**不可信**读；
`battle-chat` 读的是**引擎**的房间聊天（`chat.msg`），文本同样经 Preact 的**文本节点**渲染，从不 `innerHTML`。
`room.chat` 只让面板说**一句话**（与玩家自己点「发送」同一条），它改不了这一局的任何数值。

账号系统这边三条**明写的做不到**（都是平台的形状决定的，不是偷懒）：

1. **不驱动游戏握手，但已经能可信地拿到 `playerId`**。本包仍是**旁路服务**（与参考文档里香港 2 那台中央账号服务
   站在同一层），`hello` 那条路一个字没动；`registration.md` §3 的 `/accounts/bind` 靠的是**引擎签发的票据**，
   本仓那一半已经补上：引擎把一张 120 秒、一票一用的票据放进 `welcome.bindTicket`，包用
   `host.tickets.verify`（`pack.json` 的 `server.modules[].uses` 里声明 `"tickets"`）验它并把 `playerId` 绑到账号上。
   ⇒ **「按座位号查人」这条读路成立**（`lookup`，房间旁栏那块名单就是它）。**头像**那条读路 2.4.4 起也接到了引擎
   自己的界面上：**本机自己**那枚**已审核**头像由面板经 `ctx.session.setAvatar` 交给引擎，大厅右上角那枚个人芯片
   与局内左上角自己那一行都照它画（§7.7）。**仍然做不到**的是「在**引擎自己的**座位表 / 结算页 / 排名页里画
   **别人**的头像与编号」—— 那几处**没有**可改写的组件或槽位（`MOD_COMPONENT_IDS` / `CLIENT_PANEL_SLOTS` 里都没有
   座位这一类挂点），本包只能在**自己渲染的界面**里画（房间旁栏那块名单就是它）。
   **「战绩归属账号」也还没做**：引擎的战绩按 `playerId` 记，账号服务现在知道映射，但把两边接起来要动引擎的战绩面
   （另开一刀）。
2. **起名界面那个入口：做得到了**，而且**第一次打开页面就有**。两半都是引擎那一侧补的：
   `screen.title.entry`（起名卡片里「开始」按钮下面那一格，`shared/workshop.js` 的 `CLIENT_PANEL_SLOTS` 加一格，
   **加一格不抬 `MOD_API_VERSION`**）+ **握手前就把包声明交给页面**（`GET /mods/panels.json`，`main.js` 开机即取并
   `apply`，`welcome` 那次照旧再 `apply` 一次 ⇒ 同一条清单，幂等）。
   这一条以前是**做不到**的：面板只随 `welcome` 装载，而全新访客在按下「开始」之前根本不握手。
3. **头像是 data URL 存在账号库里**（`avatars` 就是账号记录里的一个字段），不是独立文件目录 + 静态路由：
   `host.route` 只有 GET/HEAD 且**收不到任何参数**，做不出「按文件名取头像」那种端点。单张上限 48 KiB
   （客户端先裁成 128×128 PNG，见 `ui/panel.js` 的 `cropAvatar`）。

---

## 7. 账号服务（`server.modules` + 一条自带 lane）

### 7.1 通道与信封

一条 WebSocket：`/mod-ws/server-ext/accounts`（路径由 `pack.json.server.modules[].lane.path` 声明，宿主按声明开、
握手由本包自己完成 —— `server/wsMini.mjs`）。**同源性检查在升级那一刻**：带 `Origin` 时它的**主机名**必须等于目标
主机名（跨站页面拿着浏览器里的本地存储来打这条通道，正是要挡的东西）。目标主机名优先取 `X-Forwarded-Host` 的
**第一段**，没有它才退回 `Host` —— 反代转发时会把 `Host` 改写成回环地址（`127.0.0.1:3001`），只认 `Host` 会让本
通道在反代后面永远 403（本机 `:3000` 直连时 `Origin` 与 `Host` 相同，所以本地测试撞不到；2.4.2 修的就是这条）。
比的是 `URL#hostname`（不带端口）而不是 `URL#host`：威胁是「跨**站**」，端口差异不构成风险。
这条放宽**不降低安全性**：浏览器**无法**给 `new WebSocket()` 的握手加自定义请求头，跨站页面**伪造不了**
`X-Forwarded-Host`，只有反代（可信的同机一跳）能设它。

```
请求  { id: <number>, op: '<名字>', token?: '<会话>', ...字段 }
成功  { id, ok: true, ...载荷 }       失败  { id, ok: false, error: { code, message } }
```

`op` 一览（`server/accounts.mjs` 的 `dispatch`）：

| op | 字段 | 说明 |
|---|---|---|
| `register` | `nickname` / `qq` / `password` | 昵称 1～12 字、不含 `#`；QQ 5～12 位、首位非 0；口令 6～64 字；同 QQ 不能重复注册；**服务端分配四位编号**；回 `{ account, token }` |
| `login` | `login` / `password` | `login` 是 QQ、`昵称#编号`，或**昵称本身**；`#` 的三种写法（ASCII `#` / 全角 `＃` / 小号 `﹟`）都认，全角数字也收（`normalizeLogin`：NFKC + 去零宽 + 收空白）。失败**不区分**「账号不存在」与「口令不对」（区分就是账号枚举），但报错里写明**可填的登录名形状**；失败限流按「IP 每 10 分钟 10 次 / 账号每 10 分钟 6 次」 |
| `me` / `logout` | — | 认人 / 撤销本会话 |
| `name` | `name` | 改名（每账号每小时 6 次）；命中词表或已被停用 ⇒ 拒绝本次请求 |
| `password` | `current` / `next` | 改密；**其他设备的会话一并撤销** |
| `avatar` | `data`（PNG/JPEG/WebP 的 data URL） | 写进**待审核**；审核通过前对别人不公开（每账号每小时 6 次） |
| `prefsGet` / `prefsPut` | `patch` | 云配置；类别闭集**逐字等于引擎那一格**（`public/js/ui/cloudPrefs.js` 的 `CLOUD_PREF_KEYS`）：`settings` / `loadout` / `ownership` / `diy` / `conflict` / `appearance`（参考文档里的 `skins`）/ `lang`；**只合并请求里出现的类别**；上限 128 KiB、递归深度 8、拒危险键（每分钟 60 次） |
| `bind` | `ticket`（`welcome.bindTicket` 里那一串） | 用**引擎签发的票据**把本机 game 的 `playerId` 绑到这个账号上（6 小时有效、每账号最多 6 个当前绑定）；票无效/过期/复用 ⇒ `BAD_TICKET`，服务器没装票据面 ⇒ `TICKETS_UNAVAILABLE` |
| `lookup` | `ids`（**game playerId** 列表，≤64） | 批量读绑定玩家的展示面（`昵称#编号` + **已审核**的头像）。**游客也能读**（参考文档 §3 同一条），所以按客户端地址限流（1/s、突发 20） |
| `admin` | `action` = `names` / `scan` / `review` / `rules` / `avatars` / `avatar-review` + `adminToken` | 管理后台（**每个动作都要口令**）：名称审核按状态取列表、采集重判、人工 allow/ban/unban、编辑词表；**头像审核**取名单（`status` = `pending` / `rejected` / `banned` / `all`，**只有这一条会带图**）、人工 `approve` / `reject` / `ban` / `unban`。账号面板「管理后台」视图里两块都有界面 |

### 7.2 落盘

`<状态目录>/mod/server-ext/`（`SP_STATE_DIR` 缺省是 `<仓库>/var`）：

* `accounts.json` —— 账号（`salt`/`hash` 十六进制、四位编号、QQ、头像、审核标记）、会话（**只存 token 的
  SHA256**）、**身份绑定**（`playerId` → 账号 id，6 小时过期，过期的那条在下一次 `lookup` 时顺手清掉）、
  审核词表与人工裁决、云配置分区。**永不明文口令、也永不回显**；坏库**抛**（fail closed），绝不「当空的用」。
* `admin.json` —— 管理口令。**首次启动随机生成并写进启动日志**（`[server-ext/accounts] admin token generated: …`）——
  运营方自己保存这一串（要轮换就删掉这个文件重启，或直接改它）。
* **管理账号**：`accounts.json` 里某一行的 `admin: true` 也是一把钥匙 —— 该账号登录后，管理后台不再要求
  输入口令（服务端把这次请求的会话 token 认作管理凭证，只在 `adminGuard` 里放行）。加/撤这个标记都要
  **停服改库再启动**；它只影响管理接口，不改账号的其它字段。对外的 `lookup` 不带这个标记。

口令：每账号 16 字节随机盐 + scrypt（`N=2^15, r=8, p=1, maxmem=64MiB`），比对 `timingSafeEqual`。

### 7.3 限流

注册每 IP 每小时 **20** 次（参考文档 §4 写 5，那是面向公网多服的口径；自建单服上运营方与玩家常共用一条出口地址，
本机测试更是全落回环 —— 所以放宽，并把数字写进报错信息里。**计数在内存里，重启即清零**）；
登录失败每 IP 每 10 分钟 10 次、每账号每 10 分钟 6 次；改名/上传每账号每小时 6 次；
云配置每账号每分钟 60 次；单连接每 20 条/秒（突发 60）。单帧上限 256 KiB，超了 1009 关连接。

### 7.4 忘掉口令怎么办

**没有「用管理口令改玩家口令」这条路**（参考文档 §5 的写法：那会让「必须提供旧口令」这道唯一持有证明变成装饰）。
维护方式是**直接改账号库**（停服再改）：要么**删掉那一行**（该名字回到可注册状态），要么用一台能跑 `node` 的机器
按同样的 scrypt 参数重算一对 `salt`/`hash` 写回去（`N=2^15, r=8, p=1`，16 字节盐、32 字节键，十六进制）。
**改文件前先备份**；升级部署也必须保留 `accounts.json` 与 `admin.json`。

### 7.5 自己验一次

```powershell
# ⚠ 必须用这个入口：默认的 `node server/index.js`（以及 scripts/launch.mjs）**不会**把包声明的 lane 挂上，
#   因为它要的那份活表只有 modServer.js 会交（docs/DEPLOY-SERVER.md「换入口：node server/modServer.js」）。
cd app
node server/modServer.js
# 启动日志里应该有三行（前两行是宿主的，后两行是本包的）：
#   [ws] lanes: /mod-ws/server-ext/accounts (server-ext/accounts)
#   [mod-lane] 1 pack lane(s): /mod-ws/server-ext/accounts
#   [mod server-ext/accounts] admin token generated: <一串>  （首次启动才有）
#   [mod server-ext/accounts] lane /mod-ws/server-ext/accounts ready; 0 account(s) in ...\var\mod\server-ext
# /healthz 里能看到 modHealth.server-ext 的 accounts / pendingAvatars / sessions
curl -s localhost:3000/healthz
```

（`server/index.js` 那一入口下，`server.modules` 的 `boot` / `shutdown` / `healthz` 照常生效，**只有 lane 不生效**
—— 这一点是启动入口的差别，不是本包的开关。）

### 7.6 「记住我」与会话保持

- 登录 / 注册成功之后，**会话 token 落在本机**（`sp.pref.panel.server-ext.token`），服务端也把它持久在账号库里
  ⇒ **下次打开页面直接以这个账号进大厅，一个字都不用输**（起名页那一格自己完成这件事：认到 token 有效就
  `ctx.session.setName(账号名)`，随后路由自然进大厅）。
  **「新开页面」与「同页内退回」是两件事**：上面这条自动进入**只在「新开 / 刷新页面」时**发生；玩家在大厅按左上角
  「返回」退回起名屏时（**同一次页面会话**，`ui/panel.js` 那个模块级 `enteredFromHere` 已经为真）**不会**再被自动
  送进 —— 停在起名屏，改由账号栏里的「以 昵称#编号 进入」点一下再进（否则退回起名屏会被立刻弹回大厅，就是回环）。
- 本机另外只记**登录名**（`sp.pref.panel.server-ext.lastLogin`，形如 `昵称#编号`），用于「token 失效 / 主动退出」
  之后把输入框回填 —— 省得连名字都重打一遍。
- **本地绝不存口令**。理由写在 `ui/panel.js` 的 `LAST_LOGIN_KEY` 注释里：这台服务器公开可达，浏览器里放明文口令
  ＝「拿到这台机器（或吃到一次 XSS）就拿到账号」；而「下次不用再输」这件事**本来就不需要口令** ——
  会话 token 已经够了。
- 会话**没有过期时间**，只有三种情况会让你重新输一次：**主动退出登录** · **改口令**（会撤销其他设备的会话）·
  **账号库被删/换**（服务端 fail closed，绝不「当空的用」）。

### 7.7 头像跟上账号（大厅右上角那枚芯片 + 局内左上角自己那一行）

**要解决的问题**：头像一直是**本包自己**界面里画得出来的（账号面板的身份卡、房间旁栏的名单），而引擎自己那两个
「我是谁」的位置画的还是**引擎的兜底** —— 大厅右上角那枚个人芯片是首字，局内左上角自己那一行是策略图标。于是
「头像审核通过之后，界面上的自己还是那个兜底」。

**怎么接的**（引擎那一半是 2.4.4 起可用的加法式表面，见引擎设计稿 §28.58.3）：

- 面板在**每次拿到账号**（登录 / 注册 / 自动认人「记住我」 / 打开账号视图时认人 / 上传头像 / 退出登录）之后，
  调一次 `ctx.session.setAvatar(approvedAvatar(account))`：`ui/panel.js` 的 `pushAvatar` 就是这一行，
  两个组件各挂一个 `useEffect(() => pushAvatar(ctx, account), [ctx, account])`。
- **只推已审核的那一枚**：`account.avatar` 有值、且 `pending` / `rejected` 都不为真才算数（这两个标记在
  `me` / 登录 / 注册的应答里都带着，见 §7.1 的 `avatar` 一行）。审核通过之前、未登录、已退出 ⇒ 推 `null`，
  两处退回引擎原本的画法（策略图标 / 首字）。
- 引擎那三处读点都只是「**有就压过原来那个源**」：`ui/accounts.js` 的 `AccountMeChip` 把 `player.avatar`（`player`
  就是 store 的 `me`）交给 `AvatarFrame` 的 `src`；`ui/gameComponents.js` 的 `PlayerAvatar` **自己**在 `self` 为真时
  读 `store.me.avatar`（局内自己那一行 / 策略轮选 / 结算页 / 机变选择都走这一个组件）；`screens/room.js` 的
  `SeatCard` 在 `isMe` 为真时读同一格。**队友那几行照旧用策略图标 / 首字** —— 引擎这一页拿不到别人的账号头像，
  也不该编一个出来（要画别人的头像，得先把「按座位号查人」那条读路接到引擎的座位表上，见 §6 第 1 条）。

**边界**：这一格写进去的**只有 `me.avatar` 一个 store 键**，面板拿不到 store 句柄；值的形状是窄的
（`data:image/…;base64,…` 或根相对路径，长度 ≤ 128 KiB，**不收**绝对外域 URL —— 页面 CSP 的 `img-src` 本来也不
放行它）；没有包写这一格时页面与从前**逐字节相同**。**引擎另外把它落盘**（`sp.pref.meAvatar`），开机读回来 ——
这一条不是装饰：同一标签页**刷新**时 `entered` 已经为真，路由**直接进大厅、起名屏（推这一格的起名页那一块面板）
根本不会渲染**，那一刻没有任何面板能再推一次。**「审核通过」这一下的可见时机**：面板在下一次拿到账号时推一次
（打开账号视图认人、或刷新 / 重开页面时起名页那一块自动认人；主动退出登录也会推一次 `null`），所以**玩家自己**
在管理台通过审核之后，回到大厅 / 开局前会看到新头像已经换上（同一次页面会话里改完立刻生效的是账号面板里的那张
大图，引擎那几处要等下一次账号读到 —— 这是「面板只在拿到账号时才推」的形状决定的，不是漏了哪一步）。
