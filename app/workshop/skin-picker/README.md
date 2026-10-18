# 时装切换（skin-picker）— 内容与引擎扩展点清单

本包 `workshop/skin-picker/` 是**换装界面**：在**两处**各提供一个「时装 · <当前时装名>」按钮，下拉列出该干员的
全部工坊时装并与「默认」切换 —— 干员调配的详情卡右上角，以及**自选编队**每一格已填的干员卡的**干员名字旁边**
（1.1.0 起）。干员**一套时装都没有**时这个按钮整块隐藏（没有可换的东西，不是「按钮没挂上」）。

- `gameVersion` 0.2.6。**纯客户端包**：没有 `content`、没有服务端模块、**不携带任何素材**。
- 它提供的时装备选项，就是**其它工坊包用 `pack.json.skins` 声明的时装**（引擎把它们合并进 `assets.skins`）。

---

## 0. 概览

| 面 | 内容 |
|---|---|
| 数据面 `content` | 无 |
| 服务端模块 | 无 |
| 客户端面板 | 2 个：`wardrobe` → 槽 `screen.loadout.card`（干员调配 的详情卡，单个宿主）；`wardrobe-diy` → 槽 `screen.diy.card`（自选编队 每一格已填的干员卡，**可重复宿主**：四格各挂一份）。**同一份模块与样式表**（`ui/skins.js` + `ui/skins.css`） |
| 组件改写 | 无 |
| 只读数据表 | `assets`、`chess` |
| 引擎消息 | `room.appearance`（面板**唯一**被允许主动发的消息类型） |
| 本机偏好 | `ctx.session.setPref('pick:<charId>', …)` / `getPref` |
| 素材 | 无 |
| 文件数 | 3（`pack.json` + `ui/skins.js` + `ui/skins.css`） |

---

## 1. 这个包往引擎里加了什么

- **换装按钮 + 时装下拉，挂两处**：引擎槽 `screen.loadout.card`（干员调配 的详情卡右上角，CSS 里绝对定位）与
  `screen.diy.card`（**`0.18.7` 新增的槽位，也是第二个可重复宿主** —— 宿主在自选编队每一格已填的卡的**名字行**
  （`.diy-slot__idrow`）里，跟着静态流走；一屏四格就是四份面板）。
  两处**同一份模块**。模块不把 `ctx.hostKey` 当身份（那个值是 `mount` 那一刻固定的，而宿主元素被框架**复用**），
  而是每次用宿主的**当前**属性重新解析出 `charId`（配一个 `MutationObserver`）；宿主在、属性却是空的 ⇒
  这个槽位此刻没有目标，面板随之隐藏。
- **两个宿主的键不是同一种东西**（`charIdOf` 两种都认）：干员调配给的是**棋子 id**（要查 `chess[chessId].charId`）；
  自选编队那一格装的就是**干员本人**（6★ 池外 / 原型），宿主键**直接是 `charId`**，没有棋子记录可查。
- **时装备选项的来源**：读 `assets.skins[charId]`（= 各包 `pack.json.skins` 声明并合并进来的那份），
  一条可选条件是该套时装在 `avatar` / `portrait` / `spine` 里至少有一项可用。
- **换装结果的落地**：
  1. 写进**本机偏好**（`ctx.session.setPref('pick:<charId>', …)`）；
  2. 广播给同房间：`ctx.session.send('room.appearance', { picks: { [charId]: { skinId } | null } })` ——
     这是 `public/js/ui/extensions.js` 的 `PANEL_SEND_TYPES` 里**唯一**允许面板主动发的引擎消息。
     协议本身没有「清除」的表达，所以面板要发就发**完整**的 picks 表（收了该干员再发）。
- **它不碰渲染**：头像 / 立绘 / 战斗 Spine 换成哪一套，由**引擎**自己解析 ——
  `public/js/ui/portraitChain.js` 用 `assets.skins[charId]` 里那一条的图作答，并按 `room.state` 的座位选择
  分别记住「我的」与「别人的」外观（`main.js` 的 `onAppearanceChanged` 负责触发重画）。
  **引擎侧不认识「皮肤」这个概念**，只认「某干员 + 某个 skinId」这份选择。

---

## 2. 引擎侧需要的支持

本包**不新增任何引擎端口**，用的全是引擎已声明的能力：

| 用到的能力 | 说明 |
|---|---|
| 面板挂载槽 `screen.loadout.card` / `screen.diy.card` | 两个**组件渲染**的宿主槽：前者在 `screens/loadout.js` 的 `.lo-dhead`（单个宿主），后者是**`0.18.7` 新加的槽位**、在 `screens/diy.js` 的 `.diy-slot__idrow`（**可重复宿主**，引擎的 `MOD_PANEL_REPEATABLE` / `CLIENT_PANEL_REPEATABLE` 里都有它） |
| 只读数据表 `ctx.data.get('assets')` / `('chess')` | 读 `assets.skins`（时装备选）与 `chess`（干员 → `charId`） |
| `ctx.session.setPref` / `getPref` | 本机偏好（本模块用前缀 `pick:`），是面板被允许的唯一 store 写面 |
| `ctx.session.send('room.appearance', …)` | 面板唯一被允许主动发的引擎消息（`PANEL_SEND_TYPES`）；引擎收到后记进本机与同房座位的外观状态 |
| 引擎的立绘解析链 | `public/js/ui/portraitChain.js` 按 `assets.skins` 作答 + 按座位分「我的 / 别人的」 —— 换装的重画由引擎驱动（`main.js` 的 `onAppearanceChanged`） |

> 引擎另有**外观提供者**通道（面板模块导出 `appearance(ctx)`，一个进程只允许一个，
> 第二个会被拒并报 `CLIENT_APPEARANCE_TAKEN`），本包**没有**用它 —— 引擎自己能按 `assets.skins` 解析，
> 所以本包只负责「发选择」。

---

## 3. 文件清单

| 文件 | 职责 |
|---|---|
| `pack.json` | 声明两个客户端面板（`wardrobe` 槽 `screen.loadout.card`、`wardrobe-diy` 槽 `screen.diy.card`；各自读 `assets` / `chess`）；无素材、无服务端模块 |
| `ui/skins.js` | 换装按钮 + 时装下拉：解析当前干员（棋子 id 或 `charId` 两种键都认，身份每次现读宿主的 `data-mod-slot-key`）、列 `assets.skins`、写偏好、发 `room.appearance`；该干员没有时装时整块隐藏 |
| `ui/skins.css` | 换装界面样式（两处宿主的定位与 `pointer-events: auto` 各一条规则） |