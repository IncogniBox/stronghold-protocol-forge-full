# 故事集（Side Story）盟约前置包 — 前置接口与效果统计

本包 `workshop/side-story/` 是**「故事集」这一类盟约的公共层**：它自己**不含**任何干员、盟约、策略或素材，
只把这一类盟约的公共部分沉淀成若干**预设接口**。独立的故事集 mod 各自成包，通过本包的接口获得统一样式、内建效果、
本局禁用规则与简报分区，不必各写一遍。

> 一句话：**故事集包只写数据；凡是「要改客户端/服务端框架」的东西，都加到本包来。**

---

## 0. 端口（扩展点）投放规则

| 情形 | 做法 |
|---|---|
| 想做的东西，**客户端/引擎已经原生支持** | **跳过**，直接用它（见 §7 的端口清单），不要在本包重复造一个 |
| 想做的东西，需要**新增/改写客户端框架端口**（新的可改写组件、新的挂载槽、新的数据表读取面…） | 加到**本包**（`pack.json.client.panels[].wraps` / `data` / `messages`，或本包的服务端模块），故事集包不各自实现 |
| 需要**改写客户端框架本身**（引擎具名组件名单、槽位表、注入面） | 属于引擎改动，不在包能力范围内 |

判断依据是**能力边界**，不是偏好：包只能改写引擎**已具名**的组件、只能挂进引擎**已声明**的槽位、只能读
**已声明**的数据表。

---

## 1. 接口一：类型约定 `bondType: "SIDE_STORY"`

- **写法**：盟约记录（`bonds.json` 的条目）里写 `"bondType": "SIDE_STORY"`。
- **引擎态度**：`bondType` 在引擎里只是**数据标签**（服务端只用 `identifier` 给盟约排序；客户端只按 `isCore` 显示
  「核心盟约 / 附加盟约」）。它的闭枚举 `SEASON` / `REGULAR` 只约束**编辑器**（`shared/bondAuthoring.js` 的
  `BOND_TYPES`），**工坊管线不做枚举校验**，所以 `SIDE_STORY` 会被原样合并进客户端数据。
- **谁消费它**：只有本包 —— 客户端徽标（§2）、简报分区（§5）、盟约报告分区（§6）与服务端预设运行时（§3）、抽签策略（§4）都按这个值
  挑出「故事集盟约」。
- **效果**：写上它，即获得 §2 的外观 + §3 的预设效果 + §4 的本局禁用规则 + §5 的简报两栏 + §6 的盟约报告一栏（后三者**零额外声明**）。

### 1.1 禁用、分区与授权（终版约定）

故事集盟约是**普通附加盟约**（`isCore: false` + `weight > 0`）：引擎的「全身盟约都被禁 ⇒ 这名干员进本局禁用」
对它们一视同仁。本包在此之上用**三条引擎通用能力**实现故事集自己的规则：

| 引擎通用能力 | 在哪 | 干什么 |
|---|---|---|
| `matchBondPolicy(ctx)`（`server.battle` 模块的可选导出） | `server/match/pool.js drawDisabledBonds` | 包在**引擎抽签之前**接管一部分盟约：`claim`（引擎不再抽）/ `drawn`（本局禁用）/ `removed`（还要从棋子身上摘除） |
| 本局**摘除表** `m.public.removedBonds` | `server/match/bondsMeta.js pieceBonds` + 客户端 `removedBondSet` | 被摘除的盟约「不算作任何棋子的盟约」—— 不计入归属与激活、不进战斗输入；客户端的盟约芯片 / 商店卡也不画它 |
| 简报两个**可改写具名组件** `briefing.bonds` / `briefing.banned` | `public/js/ui/matchInfo.js` | 包可以在简报里把某一类盟约、某一类被禁干员单独分一栏 |

本包据此实现的规则（**独立故事集包零声明**）：

| 规则 | 落地方式 |
|---|---|
| 故事集盟约**不走**引擎的原版附加盟约抽选 | `matchBondPolicy` 把**所有**故事集盟约 `claim` 掉，引擎就不再随机抽它们 |
| **N ≥ 3 时禁 1 个，此后每多 2 个再多禁 1 个** | `N >= 3 ? floor((N-1)/2) : 0` 个，用本局种子随机挑（`drawn` + `removed`） |
| 被抽中的盟约的**专属干员**进「本局禁用干员」 | 被禁的盟约进了禁用集 D ⇒ 引擎**既有**规则自动禁掉「全身只有这一个盟约」的干员（零额外代码） |
| 其他成员**不被禁**，只是身上这个盟约本局**不作数** | 同一个盟约同时进**摘除表**：它对这些棋子等同于不存在（不计入归属/激活，芯片里也不显示） |
| 简报里**不再混进「附加盟约」行** | §5 的 `briefing.bonds` 分区把故事集盟约单独拎出来成栏 |
| 被禁的专属干员单独成栏 | §5 的 `briefing.banned` 分区在「本局禁用干员」下面补一栏 |

**「指定干员」= 数据里写定的两类干员（不是每局随机）**：

- **故事集包新增的干员** —— 在包自己的 `chess.json` 里加记录，`bonds` 数组里带这个盟约（**只带它** = 专属干员）。
- **官方已有、属于该故事的干员** —— 在 `pack.json.overrides` 里声明 `"chess:<id>"`，并在自己的 `chess.json` 里写该
  棋子的记录。⚠ **`bonds` 属于「整段替换」的键**（`shared/workshop.js` 的 `OVERRIDE_REPLACE_KEYS`）：必须写**完整
  数组**（官方原有盟约 + 故事集盟约），只写增量会把官方盟约整个抹掉；其余字段按字段递归合并，写多少留多少。

⚠ 这一条决定了「专属干员」的判定：**只带这一个盟约**的棋子，盟约一被禁就跟着进本局禁用；**还带别的盟约**的棋子
（通常是官方干员）不会 —— 引擎只在「所有盟约都被禁」时才禁人，而本包只禁一个盟约。

> 想「每局随机授予某些干员这个盟约」：服务端能授予 —— `ctx.setPieceData(piece, 'bondGrants', [bondId])`
> （`bondsMeta.pieceBonds` 与战斗侧 `unitBonds` 都认）—— 但客户端界面**不会显示**这些成员，要两端一致就得开引擎口子。

---

## 2. 接口二：客户端预设外观（改写 `game.bondStrip`）

- **实现**：`ui/badge.js` 声明 `wraps: [{ component: "game.bondStrip", mode: "wrap" }]`（**只改写、不挂载**的合法面板）。
  它把引擎的盟约条**原样**包一层查询容器（`display:contents`，不参与布局），渲染后读**合并后的 `bonds` 表**，
  给 `bondType === "SIDE_STORY"` 的圆盘打上 `mod-story` 类；样式在 `ui/badge.css`。
- **故事集包要做的事**：**没有** —— 零客户端代码即获得下列外观。

| 效果 | 载体 | 说明 |
|---|---|---|
| 金色圆环 | `.bslot.mod-story .bond__core` | 圆盘加金环 + 微光（`--amber` 同色族） |
| 金色名牌 | `.bslot.mod-story .bond__name` | 盟约名改用金色 |
| 「故事集」小签 | `.bslot.mod-story .bond__disc::after` | 圆盘顶沿的小金签，文字「故事集」 |
| 本局禁用态 | `.bslot.mod-story.is-off .bond__disc::after` | 灰底灰字，不抢眼 |
| 标记类名 | `mod-story` | 打在 `.bslot[data-bond]` 上，可被其它包/样式复用 |

- **已覆盖的场景**：自己与观战队友的盟约条都适用（同一组件）；盟约条随层数/在场成员重画时标记跟着走
  （每次渲染重跑一次标记）；本局禁用（灰盘）的故事集也有专属样式。
- **当前边界**：盟约**弹窗**（`BondPopup`）不在引擎可改写的具名组件名单里，所以「故事集」标签只落在盟约条的圆盘上。

---

## 3. 接口三：服务端预设效果（黑板键 → 效果表）

- **实现**：`battle/main.mjs` 是包的 `server.battle` 模块。每个战场建起来时引擎都会调用它的 `install(battle)`
  （在官方内容模块之后），它按 `bondType === "SIDE_STORY"` 挑出**已激活**的故事集盟约，给**盟约成员**
  （`bondMembers`）挂预设效果；层数变化时按新层数**重算**（`onLayers`）。
- **故事集包要做的事**：在盟约记录的黑板里**写键**即可（`buffs[]` 的 `env_gbuff_new.bb`，或记录顶层 `bb`）。

| 黑板键 | 每层增量键 | 效果 | 量纲 |
|---|---|---|---|
| `story_aspd` | `story_aspd_per_stack` | 攻击速度 | 绝对值加算 |
| `story_res` | `story_res_per_stack` | 法术抗性 | 绝对值加算 |
| `story_sp` | `story_sp_per_stack` | 每秒技力 | 绝对值加算 |
| `story_redeploy` | `story_redeploy_per_stack` | 再部署时间 | 比例（`-0.3` = 减少 30%） |

- **取值 = `base` + `per_stack` × 层数**；只写 base（不看层数）或只写 per_stack（base 按 0）都合法；两个都没写 = 该盟约没有预设效果。
- **生效时机**：战场建立时一次 + 该盟约层数变化时重算（官方盟约同款节奏）。
- **作用对象**：该盟约的**成员**（含变形同构体授予、调和 +1 等引擎已认定的成员）——与 `bondMembers` 一致。

### 与引擎自带「通用加成」的分工（重要，别写重）

攻击力 / 防御 / 生命上限的**按层数百分比**走引擎自带通路：盟约记录打开 `"genericBuffs": true` 并写
`base_atk` / `atk_per_stack` / `base_def` / `def_per_stack` / `base_max_hp` / `max_hp_per_stack`。
本包的预设**刻意不碰**这几个维度，只做攻速/法抗/技力/再部署 —— 两边键名不重叠，不会把同一份加成算两次。

### 为什么不占用 `registerBondInstaller` 槽位

`registerBondInstaller(bondId, fn)` 是**一个 bondId 一个 installer、先到先得**（重复注册被静默忽略）。
前置包若替别人的盟约注册，就会顶掉故事集包自己的注册，而**包之间的加载顺序不是契约**。
所以本包改在 `install(battle)` 里自己找、自己挂 —— **一个 installer 槽位都不碰**，
故事集包仍可自由地用它自己的 `registerBondInstaller` 加专属效果。

---

## 4. 接口四：本局禁用规则（`matchBondPolicy`，引擎通用钩子）

- **实现**：`battle/main.mjs` 另导出一个 `matchBondPolicy(ctx)`。引擎在**自己抽签之前**，把每个声明了
  `server.battle` 的包的这一钩子依次跑一遍（`server/match/pool.js drawDisabledBonds`），`ctx = { gd, rng, eligible }`，
  返回 `{ claim?, drawn?, removed? }`：
  - `claim` —— 这个包**接管**的盟约：引擎不再把它们丢进自己的核心/附加抽签池；
  - `drawn` —— 这个包判定**本局禁用**的盟约（并入 D，于是专属干员照既有规则被禁）；
  - `removed` —— 其中还要**从棋子身上摘除**的盟约（对其他成员等同于不存在）。
- **本包的规则**：`N >= 3 ? floor((N-1)/2) : 0` 个故事集盟约被禁（N = 本局参与抽签的故事集盟约数）。
- **故事集包要做的事**：**没有** —— 只要盟约写了 `bondType: "SIDE_STORY"`、`isCore: false`、`weight > 0` 就自动生效。
- **确定性**：同一批包 + 同一个种子 ⇒ 同一结果（随机数只来自引擎交给它的 `rng`）。

---

## 5. 接口五：简报的两个分区（`briefing.bonds` / `briefing.banned`）

- **实现**：`ui/briefing.js` 声明两条 wrap 链，改写引擎的两个具名组件（`public/js/ui/matchInfo.js`）：
  - `briefing.bonds`（`mode: "replace"`）—— 重画「核心盟约 / 附加盟约」两块，并把故事集盟约从附加盟约里**拿出来**，
    在它下面新开一栏 **故事集盟约 SIDE STORY BONDS**；
  - `briefing.banned`（`mode: "wrap"`）—— 引擎的「本局禁用干员」块照旧渲染，在其后补一栏
    **本局禁用故事集干员 BANNED SIDE STORY OPERATORS**（被禁用的故事集盟约的**专属干员**）。
- **生效范围**：「确认本局信息」简报与策略起草的「本局信息」弹窗（同一份 `MatchInfo`）。
- **被禁的故事集盟约**在简报里画成灰盘（「本局禁用」），与其它被禁盟约同一条视觉语言。
- **故事集包要做的事**：**没有** —— 零客户端代码即获得这两栏（无故事集盟约 / 无被禁专属干员时该栏不出现）。

---

## 6. 接口六：S.W.E.E.P.报告的「故事集盟约」一栏（改写 `sweep.bonds`）

- **实现**：`ui/sweep.js` 声明一条 wrap 链，改写引擎的具名组件 `sweep.bonds`（`public/js/screens/sweep.js`）。
  该组件是 S.W.E.E.P.报告 →「盟约报告」标签页右侧**那两块盟约分区本身**（核心盟约 / 附加盟约），
  props 只有 `{ bonds, sel, onSel }`：`bonds` 是引擎按 `identifier` 排好序的**合并后**盟约记录数组（含全部工坊包
  的盟约），`sel` 是当前选中的 bondId，`onSel(bondId)` 换选中。
- **做法**（`mode: "replace"`）：把附加盟约拆成 非故事集（原样一栏）/ 故事集（新栏），顺序为
  **核心盟约 → 附加盟约 → 故事集盟约**（与 §5 同一口径：故事集从附加盟约里**拿出来**，不重复显示）。
  拼装单元是引擎自己导出的 `Section`（分区外壳：图标 + `[ 名字 N ]` + 网格）与 `BondTile`（一张盟约圆盘 tile），
  所以外壳与圆盘的样式、结构与报告其余部分逐字同源。
- **故事集包要做的事**：**没有** —— 零客户端代码即获得这一栏（没有故事集盟约时该栏不出现）。
- **栏图标**：本包自带（`assets/icon_story.png`，走 `/workshop-assets/side-story/<路径>` 那条唯一的包素材路由），
  白底字形在引擎那口浅色图标框里由 `ui/badge.css` 的 `.mod-story-glyph` 转深色 —— 独立故事集包**不需要**自带图标。
- **读的数据**：面板声明 `data: ["bonds", "assets"]`（合并后的盟约表用来判 `bondType`，素材清单用来画每个圆盘的
  盟约图标）。⚠ 引擎那一帧的 props **不含**素材清单 —— props 是**每帧的只读深拷贝**，把整份清单塞进去等于每帧
  深拷一遍，所以本模块用 `ctx.data.get('assets')`（快照有 WeakMap 缓存）。
- **边界**：盟约**弹窗**（`BondPopup`）与报告的其余标签页仍不在可改写组件名单里（引擎能力边界，不是本包的取舍）。

---

## 7. 引擎已原生支持的端口（能直接用就别在包外造）

### 7.1 客户端 · 可改写的引擎具名组件（`wraps`）
`game.bondStrip`、`game.hud.topBar`、`game.shopCard`、`loadout.detail`、`briefing.bonds`、`briefing.banned`、
`lobby.modPicker`、`lobby.modManager`、`room.modManager`、`sweep.bonds`

- `mode: "wrap"` 包一层（内层结果作为 `orig`）；`mode: "replace"` 整段换掉（`orig` 为 `null`）。
- 改写拿到的 `ctx` = 面板注入面 + `component`（组件 id）+ `props`（该帧 props 的**只读深拷贝**）。
- `briefing.bonds` / `briefing.banned` 的 props 只有 `{ model }`（`matchInfoModel` 的结果）。⚠ 这份 props 是**深拷贝**：
  `model.perBond`（一张 `Map`）会退化成空对象，需要它时按 `visibleMembers ∩ banned` 自己重建（本包 `ui/briefing.js`
  的 `withPerBond` 就是同一口径）；`model.stateOf`（函数）不受影响。

### 7.2 客户端 · 面板挂载槽（`slot`）
`root.overlays`、`root.guide`、`screen.game.aside`、`screen.result.footer`、`screen.game.shopCard`、
`screen.game.bondStrip`、`screen.game.hud`、`screen.game.overlay`、`screen.loadout.detail`、`screen.loadout.card`
（其中 `screen.game.shopCard` 是**可重复**宿主：每张商店卡一个，通过 `ctx.hostKey` 分辨）

### 7.3 客户端 · 只读数据表（`client.panels[].data`）
用 `ctx.data.get('<表名>')` 读**合并后**（含全部工坊包）的表：`bonds` / `chess` / `assets` / …
未声明的表读到 `null` 并**点名**（`CLIENT_DATA_UNDECLARED`）。

### 7.4 客户端 · 包通道（`client.panels[].messages`）
`ctx.net.send(channel, data)` / `ctx.net.on(channel, fn)` —— 与同房间的同包客户端通信（服务端按通道转发）。
另有受限的 `ctx.session.setPref/getPref`（本格偏好）、`ctx.session.setPreload`（入口闸门）。

### 7.5 服务端 · 包声明的模块
`server.battle`（`install(battle)` 每战场一次 + 可选的 `matchBondPolicy(ctx)` 每局一次）、`server.meta`、
`server.room`、`server.modules`、`server.preDispatch`；行为层 `kits/<chessId>.js`；数据面 `content`
（bonds / chess / items / bands / garrisons / tokens / effects / stages / enemies / waves / …）；
美术/语音 `art` / `bondIcons` / `itemIcons` / `voices` / `voiceLangs`。
`server.meta` / `server.battle` 需 `"combat": true`。包侧 `@battle/mod.js` 是合法的引擎 import 入口。

### 7.6 数据面 · 本局盟约摘除表
`m.public.removedBonds`（没有包声明时**不存在这个键**）：本局被摘除的盟约 id 列表。客户端已有对应的
`gameLogic removedBondSet(pub)`（喂给盟约芯片 / 商店卡的过滤）。

### 7.7 包声明面 · 公告与鸣谢（`notices`）
`pack.json.notices` = `{ announcement: '<包内相对 .json>', credits: '<包内相对 .json>' }`（至少写一个）：装载期把这一条
**追加**进游戏内公告板（`/data/notices.json`）。引擎那一半从 `CHANGELOG.md` 生成，两边合成**一份**合并体，合并语义是
**追加**而不是覆盖（见 `docs/WORKSHOP.md` §1.13）。上限：8 条公告 / 每条 12 小节 × 40 项 / 每项 200 字 / 摘要 600 字。
声明的文件在装载期判「可读且是合法 JSON」，一份读不出来的公告会**拒整包**（`NOTICES_BAD_FILE`）；正文进包的身份哈希。
本包用它把**「故事集盟约」这一类型**写进公告（见 §9），独立故事集包可以照同一格写自己的公告。

---

## 8. 独立故事集包的最小清单

```jsonc
// workshop/<你的故事集>/pack.json
{
  "id": "<你的故事集>",
  "name": "…",
  "version": "1.0.0",
  "author": "…",
  "description": "…",
  "gameVersion": "0.2.6",
  "content": ["bonds", "chess", "…"],
  "overrides": ["chess:chess_xxx_a", "…"]
}
```

```jsonc
// bonds.json —— 一个故事集盟约
{
  "myStoryShip": {
    "bondId": "myStoryShip",
    "name": "…",
    "identifier": 90,                  // 决定盟约在数据里的排序
    "isCore": false,                   // 故事集一般是附加盟约（核心盟约会影响调和 +1）
    "bondType": "SIDE_STORY",          // ★ 唯一的类型约定（接口一）
    "activeCount": 3,
    "thresholds": [3, 6],
    "thresholdTemplate": "count_threshold_upward",
    "countMode": "BOARD",
    "activeType": "BATTLE",
    "weight": 10,                      // > 0：进本包的抽签（接口四）
    "desc": "…", "descRaw": "…",
    "bb": { "story_aspd": 15, "story_aspd_per_stack": 0.5 },   // ★ 预设效果（接口三）
    "bbStr": {},
    "buffs": [{ "key": "env_gbuff_new", "bb": { "story_aspd": 15, "story_aspd_per_stack": 0.5 }, "bbStr": {} }],
    "members": ["chess_xxx_a"], "visibleMembers": ["chess_xxx_a"]
  }
}
```

> 若还想加**攻击力/防御/生命上限按层数%**：在同一块黑板里加 `"genericBuffs": true` +
> `base_atk` / `atk_per_stack`（引擎自带通路，与 §3 的键并存不冲突）。

**指定干员（两类，都写进数据）**：
- **本包新增的干员** → 直接在包自己的 `chess.json` 里加记录，`bonds` 带这个盟约（只带它 = 专属干员）。
- **官方已有、属于该故事的干员** → `pack.json.overrides` 里声明 `"chess:<id>"`，`chess.json` 里写该棋子记录，
  其中 **`bonds` 必须写完整数组**（官方原有盟约 + 故事集盟约）—— `bonds` 是整段替换的键，只写增量会抹掉官方盟约。

**被禁用时的去留**（§1.1）：只带这一个盟约的干员跟着进「本局禁用干员 / 本局禁用故事集干员」；
同时还带别的盟约的干员仍可上场，只是身上这一个盟约本局不作数。

**视觉区分**：可以另外在 `pack.json.bondIcons` 里以 bondId 为键给每张故事集盟约指定专属图标（可选 —— 简报里
故事集本来就自成两栏）。

**需要专属效果**（护盾、发放装备/干员、特殊触发…）：在自己的包里声明 `server.battle`，用 `registerBondInstaller('<你的bondId>', fn)`
（`"combat": true`）。与前置包的预设**互不干扰**。

---

## 9. 本包文件与职责

| 文件 | 职责 |
|---|---|
| `pack.json` | 声明三个客户端面板（`game.bondStrip` 外观 + `briefing.bonds` / `briefing.banned` 两个简报分区 + `sweep.bonds` 的盟约报告分区）与服务端 `server.battle`；`combat: true` |
| `ui/badge.js` | 客户端预设：按 `bondType` 给盟约条圆盘打 `mod-story`（接口二） |
| `ui/badge.css` | 故事集外观（金环 / 金字 / 「故事集」小签）+ 盟约报告那一栏的图标（接口六） |
| `ui/briefing.js` | 简报两个分区：故事集盟约 / 本局禁用故事集干员（接口五） |
| `ui/sweep.js` | 盟约报告的「故事集盟约」一栏（接口六） |
| `assets/icon_story.png` | 该栏的图标（本包自带，客户端从 `/workshop-assets/side-story/<路径>` 取） |
| `notice/announcement.json` | 包公告：「故事集盟约」这一类型写进游戏内公告板（`pack.json.notices.announcement` 声明，§7.7） |
| `battle/main.mjs` | 服务端：本局禁用规则 `matchBondPolicy`（接口四）+ 预设效果运行时 `story_*` 键（接口三） |

## 10. 扩展本包的约定

- 新增**预设效果键**：在 `battle/main.mjs` 的 `PRESETS` 表加一行（`[mods 键, base 键, per_stack 键, 变换]`），
  并在本文件 §3 的表里补一行 —— 键名一律 `story_` 前缀，且**不得**与 `genericBuffs` 的维度重叠。
- 新增**禁用规则**：改 `battle/main.mjs` 的 `matchBondPolicy`（个数策略见 `storyBanCount`）。
- 新增**客户端外观 / 分区**：改 `ui/badge.js` / `ui/badge.css` / `ui/briefing.js` / `ui/sweep.js`；若需要引擎**新端口**（新组件/
  新槽/新数据面），按 §0 判定 —— 已原生支持就直接用，需要新端口则加进本包并更新 §7 清单。
- 新增 / 修改**包公告**：改 `notice/announcement.json`（`{ version, date, summary, sections: [{ name, items }] }`），
  `pack.json.notices.announcement` 已经指向它 —— 正文进身份哈希，所以换了正文就是换了包。