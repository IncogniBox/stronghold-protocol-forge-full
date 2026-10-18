# 多索雷斯（dossoles）— 内容与引擎扩展点清单

本包 `workshop/dossoles/` 是「多索雷斯假日」的故事集 mod：**1 条故事集盟约【多索雷斯】 + 4 名干员（含精锐化） +
6 件「知名商品标志物」装备 + 8 套官方时装**，另外把 3 名官方干员（星熊 / 诗怀雅 / 水月）拉进这条盟约。

- `gameVersion` 0.2.6，`combat: true`（有战斗侧与休整期侧逻辑）。
- 盟约类型 `bondType: "SIDE_STORY"`，由**前置包 `workshop/side-story`** 提供的故事集公共层接管本局抽签、
  简报分区与盟约条外观 —— 本包是零声明的受益方（详见 §7）。
- 素材自带（头像 / 立绘 / 战斗 Spine / 技能图标 / 装备图标 / 盟约圆盘 / 时装），`license` 声明为
  `GPL-3.0-or-later`；《明日方舟》相关美术版权归鹰角网络，工坊素材的授权需自行确认。

---

## 0. 概览

| 面 | 内容 |
|---|---|
| 数据面 `content` | `bonds` 1 条 · `chess` **14** 条（新增 8 + 覆盖 6） · `garrisons` **10** 条 · `items` **12** 条（6 件 × 普通/进阶） |
| `overrides` | 6 条（3 名官方干员 × `_a` / `_b`） |
| 素材 | `art.chars` 2 名 · `art.skills` 4 张 · `bondIcons` 1 · `itemIcons` 6 · `skins` **8** 套 |
| 服务端 | `server.battle`（`battle/main.mjs`）· `server.meta`（`meta/main.mjs`，8 条注册键） |
| 客户端面板 | 无（零客户端代码） |
| 包公告 | `notice/announcement.json`（`pack.json.notices.announcement`）—— 把【多索雷斯】写进游戏内公告板，见 §7 |
| 行为层 `kits/` | 2 个文件（陈 / 林，各复用一份官方 ops kit） |
| 文件数 | 105（其中 `assets/**` 95） |

---

## 1. 盟约：`dossolesShip`「多索雷斯」

| 字段 | 值 |
|---|---|
| `bondId` / `name` | `dossolesShip` / 多索雷斯 |
| `bondType` | `SIDE_STORY`（故事集；由前置包 `workshop/side-story` 接管抽签与简报分区） |
| `isCore` | `false`（附加盟约） |
| `identifier` / `bondOrder` | 41 / 2（决定数据里的排序） |
| 人数阈值 `thresholds` | **2 / 2**（两档同为在场 2 名不同成员；`countMode: BOARD`，只在场的不同成员计数） |
| `activeType` / `weight` | `BATTLE` / 10 |
| `effectId` | `bondeffect_dossoles` |
| 层数轴 | 引擎通用叠层（与其它盟约同源，本包不额外造）；`bb` 的 12 个键全部参与计算 |

**两档效果**（设计取自多索雷斯假日活动的「水蚀」机制）：

- **第 1 档（在场 2 名不同【多索雷斯】干员）**
  - ①【多索雷斯】干员的攻击范围视为**特殊水地形**（= 所有在场成员攻击范围格子的并集）；
    处于其中的【多索雷斯】干员攻击附带相当于**攻击力 ×（10% + 0.1% × 层数）**的**侵蚀损伤**；
  - ②敌人处于特殊水地形中时，**移动与攻击速度降低 10% + 0.5% × 层数**。
- **第 2 档（同为在场 2 名）**
  - ③敌人受到**侵蚀损伤爆发**时，**防御力额外降低 50 + 2 × 层数**点（与引擎自带的那份降防并存，按爆发次数叠加）；
  - ④敌人处于**损伤爆发期间**时，每 **0.5 秒**受到一次**元素伤害** = 场上攻击力最高的【多索雷斯】干员 ×（50% + 1% × 层数）。

> 成员名单：`members` / `visibleMembers` 里是这条盟约的**全部 7 位**成员（`_a` 基础 id：星熊 / 诗怀雅 / 水月 +
> 假日威龙陈 / 林 / 羽毛笔 / 龙舌兰），所以局内盟约详情的「成员 n/7」会逐个列出他们。

### 1.1 覆盖的官方盟约名册

本包另外写了一条 **`yanShip`（炎）的最小覆盖记录**（只有 `bondId` + `members` + `visibleMembers`），把本包的
**林**（`chess_ws_dos_lin_a`）并进【炎】的成员名册 —— 否则林在【多索雷斯】里显示、在【炎】里却不显示。

- 引擎对 `members` / `visibleMembers` 走**求并集**合并（`shared/workshop.js` 的 `OVERRIDE_UNION_LISTS`）：`base` 在前、原序不变，
  `patch` 里 `base` 没有的追加到末尾。所以这里**只写自己那几位**即可，官方名单一条不丢，上游给官方盟约加人也不会让这份名单过期。
- 但**一条盟约只认一个包**（`PACK_ID_COLLISION`，DESIGN §28.3：id 字典序小的包保留，另一个被点名拒绝），
  所以一条官方盟约的 mod 干员要由这条盟约的**唯一主人**一起列进名册（本包是【炎】的主人；【迅捷】等见各包 README）。

---

## 2. 干员（`chess.json`，14 条）

**记录形状（2026-10-18 修）**：记录上的 `skill`（选中技能那一份）**不写 `isDefault`** —— 默认档只由 `skills[]` 里那一条
`isDefault: true` 标记（官方记录如此，引擎 `shared/plugins/records.js:113` 也会把它从 `skill` 上删掉）。写了它会被校验器
判 `PLUGIN_RECORD_SKILLS`。本次清掉了 4 条记录上多余的这一个键：`chess_ws_dos_holungday_a/_b`、`chess_ws_dos_lin_a/_b`。

### 2.1 本包新增（4 名 × 普通 / 精锐 = 8 条）

| id | 名字 | 阶级 | 盟约 | 特质（普通 → 精锐） |
|---|---|---|---|---|
| `chess_ws_dos_holungday_a` / `_b` | 假日威龙陈 | 6 | 多索雷斯 + 精准 | 自身攻击范围扩大至**全场**的特殊水地形；`<战斗中>`每消耗 **4** 发弹药，使已激活的【多索雷斯】【精准】层数 **+2** / **+4** |
| `chess_ws_dos_lin_a` / `_b` | 林 | 5 | 炎 + 多索雷斯 + 灵巧 | `<战斗中>`攻击范围内有干员受到攻击时，其已激活盟约的层数 **+1** / **+2**（同一名干员最多 **6** / **12** 次）；若本场没有触发过 `<战斗中>`特质，则 `<进入休整期时>`使自身已激活层数 **+6** / **+12** |
| `chess_ws_dos_crow_a` / `_b` | 羽毛笔 | 3 | 多索雷斯 + 不屈 | `<战斗中>`击倒敌人时，使已激活的【多索雷斯】【不屈】层数 **+1** / **+2** |
| `chess_ws_dos_takila_a` / `_b` | 龙舌兰 | 2 | 多索雷斯 + 迅捷 | `<进入休整期时>`获得 **1** / **2** 件阶级不超过调度中心的随机「知名商品标志物」 |

- 四位都带 `charId`（`char_1013_chen2` / `char_4080_lin` / `char_421_crow` / `char_486_takila`）与
  各自的 `garrisonIds`（见 §4）。
- 数值口径：**精英 2 对应等级的基础值 + 满潜修正，不含信赖**（普通 = E2 Lv1，精锐 = E2 Lv60）；
  精锐的 `stats` = `statsBase` + 默认模组的 `attr`。技能：普通取 4 级、精锐取 7 级；**每位 2~3 个技能**
  （羽毛笔 / 龙舌兰各 2 个，陈 / 林各 3 个），技能图标见 §6。
- 模组：精锐侧 `modules[]` 带默认模组（羽毛笔「水蓝色黎明」REA-X、龙舌兰「双重身份」LIB-X、
  陈「沙滩战斗套装」RPR-X + 「假期的最后一天」RPR-Y、林「七窍玲珑」PLX-X + 「情与义」PLX-Y）。

### 2.2 覆盖官方干员（`overrides`，3 名 × `_a` / `_b` = 6 条）

| 官方 id | 名字 | `charId` | 追加的盟约 |
|---|---|---|---|
| `chess_char_4_17_a` / `_b` | 星熊 | `char_136_hsguma` | `dossolesShip`（原有 `yanShip` 保留） |
| `chess_char_3_03_a` / `_b` | 诗怀雅 | `char_308_swire` | `dossolesShip`（原有 `yanShip` + `visiShip` 保留） |
| `chess_char_4_09_a` / `_b` | 水月 | `char_437_mizuki` | `dossolesShip`（原有 `egirShip` + `soloShip` 保留） |

> `chess.json` 里这几条只写 `chessId` + **完整**的 `bonds` 数组 —— `bonds` 属于「整段替换」的键
> （`shared/workshop.js` 的 `OVERRIDE_REPLACE_KEYS`），只写增量会把官方盟约整个抹掉。

---

## 3. 装备（`items.json`，12 条 = 6 件 × 普通 / 进阶）

六件都 `hideInShop: true`（**只能从龙舌兰的特质中获得**）、`itemType: "EQUIP"`、`mergeable` 普通为真
（可合成进阶）；`trapId` / `iconId` 用本包命名空间 `trap_ws_dos_*`（避免与官方 / 其它包撞车）。

| id 家族键 | 名字 | 阶 | `kind` | 普通 → 进阶 | 实现在哪 |
|---|---|---|---|---|---|
| `chess_item_ws_dos_tourbadge` | 多索雷斯游客章 | 1 | `consume_on_equip` | 装备时销毁，获得 **1 / 2** 资金，并使携带者所属盟约层数 **+2 / +4**（无需激活盟约） | `meta/main.mjs` 的 `item:chess_item_ws_dos_tourbadge` —— 与官方「盟约之币」+「随身身份牌」两个内置处理器逐字同规，自己再注册一次以免依赖装配顺序 |
| `chess_item_ws_dos_chico` | 奇科龙舌兰 | 2 | `consume_on_equip` | 装备时销毁，获得 **1 / 2** 名随机 **2 阶**干员 | `item:` → `ctx.rollChess({ tier: 2 })`（池里该阶级没有干员时回退到 ≤ 2 阶） |
| `chess_item_ws_dos_chico_premium` | 奇科精品龙舌兰 | 3 | `consume_on_equip` | 装备时销毁，之后**每回合开始时**使已激活的**核心盟约**层数 **+2 / +4** | `item:` 用 `ctx.addEffect` 挂一条**持久效果** `effect:mod_dos_premium`（装备本身已销毁，效果留在玩家身上） |
| `chess_item_ws_dos_anton` | 安东龙舌兰 | 4 | `consume_on_equip` | 装备时销毁，获得 **1 / 2** 名阶级不超过调度中心的随机【多索雷斯】盟约干员 | `item:` → `ctx.rollChess({ bond: 'dossolesShip', maxTier: ctx.shopLevel() })` |
| `chess_item_ws_dos_coating` | 沙兹专业镀膜装置 | 5 | `passive` | 携带者获得特质「`<休整期结束时>`自身已激活盟约层数 **+5 / +10**」 | `item:` 的 `onPrepEnd` 直接实现（与官方「涤火杰西卡」同一条通道、同一口径）；记录里的 `giveBondId: 'dossolesShip'` 走**变形同构体**配对 —— 装备与变形同构体同时装备时携带者视为【多索雷斯】成员 |
| `chess_item_ws_dos_jade` | 翡翠庭院至臻 | 6 | `passive` | 获得等于【多索雷斯】盟约层数 **× 3 / × 5** 的**基础攻击力** | `battle/main.mjs` 的 `registerItemBehaviour('mod_dos_jade')`，按层数重算 `atkFlat`（基础攻击力必须用 `atkFlat`，不是百分比 `atkPct`） |

---

## 4. 干员特质（`garrisons.json`，10 条）

| `effectKey` | 挂在谁 | `eventType` | 效果 |
|---|---|---|---|
| `garrison_dos_holungday_a` / `_b` | 假日威龙陈 | `IN_BATTLE` | `<战斗中>`每消耗 4 发弹药 → 已激活【多索雷斯】【精准】层数 **+2 / +4** |
| `garrison_dos_lin_a` / `_b` | 林 | `IN_BATTLE` | `<战斗中>`攻击范围内有干员受到攻击 → 其已激活盟约层数 **+1 / +2**（同一名干员上限 **6 / 12** 次） |
| `garrison_dos_lin_prep_a` / `_b` | 林 | `SERVER_PREP_START` | 兜底：本场没触发过战斗侧特质 → `<进入休整期时>`自身已激活层数 **+6 / +12**（读 `dosLinFired` 标记） |
| `garrison_dos_crow_a` / `_b` | 羽毛笔 | `IN_BATTLE` | `<战斗中>`击倒敌人 → 已激活【多索雷斯】【不屈】层数 **+1 / +2** |
| `garrison_dos_takila_a` / `_b` | 龙舌兰 | `SERVER_PREP_START` | `<进入休整期时>`获得 **1 / 2** 件阶级不超过调度中心的随机知名商品标志物 |

- `IN_BATTLE` 的五条由 `battle/main.mjs` 走 `registerGarrisonInstaller(effectKey, …)` 落地
  （`<战斗中>`的特质在战场里生效，还要处理「同一名干员的上限次数」与「本场是否触发过」的标记）。
- 两条 `SERVER_PREP_START` 由 `meta/main.mjs` 走 `registry.garrison(effectKey, …)` 落地。

---

## 5. 服务端逻辑

### 5.1 `server.battle` — `battle/main.mjs`

- 导出 `install(battle)`（空实现，只为满足模块契约）+ 模块顶层注册两件东西：
  - `registerBondInstaller('dossolesShip', …)`：§1 的四条盟约效果（特殊水地形的并集每 0.25 s 重算一次；
    攻击带侵蚀损伤；水地形减速；爆发额外降防；爆发期间的元素伤害脉冲）。
  - `registerItemBehaviour('mod_dos_jade', …)`：翡翠庭院至臻的基础攻击力加成（按【多索雷斯】层数重算）。

### 5.2 `server.meta` — `meta/main.mjs`（`pack.json.server.meta.registers` 的 8 条键）

| 注册键 | 做什么 |
|---|---|
| `item:chess_item_ws_dos_tourbadge` | 多索雷斯游客章：装备时 +资金、携带者**所有**盟约层数 +2 / +4（`requireActive: false`） |
| `item:chess_item_ws_dos_chico` | 奇科龙舌兰：装备时发放 1 / 2 名随机 2 阶干员 |
| `item:chess_item_ws_dos_chico_premium` | 奇科精品龙舌兰：装备时挂上持久效果 `effect:mod_dos_premium` |
| `item:chess_item_ws_dos_anton` | 安东龙舌兰：装备时发放 1 / 2 名阶级 ≤ 调度中心的随机【多索雷斯】干员 |
| `item:chess_item_ws_dos_coating` | 沙兹专业镀膜装置：`<休整期结束时>`携带者每条已激活盟约 +5 / +10 |
| `effect:mod_dos_premium` | 奇科精品龙舌兰留下的持久效果：每回合开始给**每一条已激活的核心盟约** +2 / +4 |
| `garrison:DOS_LIN_PREP_FALLBACK` | 林：本场没触发过战斗侧特质 → `<进入休整期时>`自身已激活层数 +6 / +12 |
| `garrison:DOS_TAKILA_GIFT_ITEM` | 龙舌兰：`<进入休整期时>`发放 1 / 2 件阶级 ≤ 调度中心的随机知名商品标志物 |

> 一个容易踩的坑：`registry.item(key)` 的 `key` 必须是**去掉 `_a` / `_b` 的家族键**（`itemKeyOf`），
> 与 `g.equip` 内部查表用的键一致；写整条 id 会在装配时抛 `META_UNDECLARED_KEY`。

### 5.3 用到的引擎通用能力

- 服务端注册面：`registerBondInstaller` / `registerItemBehaviour` / `registerGarrisonInstaller`；
  meta 的 `registry.item` / `registry.effect` / `registry.garrison`。
- meta 侧上下文：`ctx.rollChess` / `ctx.grantChess` / `ctx.grantItem` / `ctx.addFunds` / `ctx.addLayers` /
  `ctx.addEffect` / `ctx.shopLevel` / `ctx.pieceBonds` / `ctx.bonds` / `ctx.bondActive` / `ctx.mark` / `ctx.rng`。
- 战斗侧上下文：`gainLayers` / `bondLayers` / `reached` / `battle.setExtraRange` / `battle.on('damaged')` /
  `battle.on('elementBurst')` / `battle.every` / `battle.addBuff` / `battle.removeBuff` / `battle.dealDamage` /
  `battle.enemies`（全部来自包侧合法的 `@battle/mod.js` 入口与 battle 句柄）。

---

## 6. 素材

| 声明 | 内容 |
|---|---|
| `art.chars` | `char_421_crow`（羽毛笔）、`char_486_takila`（龙舌兰）—— 头像 `avatar` / `avatarE2`、立绘 `portrait` / `portraitE2`、战斗 Spine `front` / `back`。陈与林的默认素材**本来就在官方 `data/assets.json`**，本包**不重复声明**，直接引用。 |
| `art.skills` | `skchr_crow_1` / `_2`、`skchr_takila_1` / `_2`（**扁平表**，每条技能的 `iconId` = `skillId`）。陈 / 林的技能图标官方已有，不重复声明。 |
| `bondIcons` | `dossolesShip` → `bond/icon_dossolesShip.png`（**110×101**，纯白图标 + 透明底，与官方 / 其它盟约图标同量级；取自 2048×2048 官方多索雷斯标志高清源图，裁到图标本体后等比缩小：拱形 + 交叉船锚 + DOSSOLES 字标 + 下划线） |
| `itemIcons` | 6 件装备各一张 180×180（`trap_ws_dos_tourbadge` / `_chico` / `_chico_premium` / `_anton` / `_coating` / `_jade`） |
| `skins` | 8 套（见下表） |

**时装（`skins`，8 套）**

| `id` | 名字 | 系列 | 干员 |
|---|---|---|---|
| `dos-chen2-summer20` | 悠然假日 HD79 | 珊瑚海岸 | 假日威龙陈 |
| `dos-chen2-boc6` | 万重山 | 斗争血脉 | 假日威龙陈 |
| `dos-lin-nian10` | 列瑶台 | 0011制造 | 林 |
| `dos-lin-summer19` | 夏卉 FA137 | 珊瑚海岸 | 林 |
| `dos-lin-pony1` | 求知的魔法 | 小马宝莉 | 林 |
| `dos-crow-summer9` | 夏卉 FA210 | 珊瑚海岸 | 羽毛笔 |
| `dos-takila-ambience2` | 开牌制胜 | 音律联觉 | 龙舌兰 |
| `dos-takila-shining2` | 巅峰现场 | 闪耀阶梯 | 龙舌兰 |

**落盘目录**

```
assets/bond/icon_dossolesShip.png
assets/char/{avatar,portrait}/char_{421_crow,486_takila}*.png
assets/item/trap_ws_dos_*.png                 (6)
assets/skill/skchr_{crow,takila}_*.png        (4)
assets/spine/op/<charId>/{front,back}/<charId>.{skel,atlas,png}
assets/skin/op/<stem>/{front,back}/<stem>.{skel,atlas,png}
assets/skin/op/<stem>/{avatar,portrait}.png
```

> `stem` = `skin_table.json` 里 skinId 把 `@` 与 `#` 都换成 `_`（如 `char_421_crow@summer#9` →
> `char_421_crow_summer_9`）。**一名干员有多套时装时必须按 `stem` 分目录**，不要互相覆盖。
> ⚠ 引擎的 `tools/workshop-validate.mjs` **不检查 `skins`**：`.skel` 版本（须 3.8.x）、`.atlas` 与 `.skel`
> 同目录同名、atlas 页 png 在位、atlas 的 `size:` 行、`pma`、`anims` 里的动画名是否存在 —— 这些都得自己验。

---

## 7. 引擎侧需要的支持

- **前置包 `workshop/side-story`**（本包唯一的包间依赖）：
  本包只在自己的盟约记录里写 `"bondType": "SIDE_STORY"`，即从故事集公共层获得
  —— 本局抽签接管（`matchBondPolicy`，故事集盟约不走引擎原版附加盟约抽选，且有「N 个故事集盟约就禁若干」的规则）、
  简报的两个分区（**故事集盟约 SIDE STORY BONDS** / **本局禁用故事集干员**）、以及盟约条上的「故事集」金标外观。
  本包**零客户端代码**。
- **引擎源文件改动（2 处，仅此 2 处）**：
  - `app/shared/kitImports.js` 的 ops 白名单加了 `@ops/op-chen2.js` 与 `@ops/op-lin.js` 两行；
  - `app/test/kitImports.test.js` 的 `KIT_IMPORT_EXPORTS` 补了这两份 kit 的导出名。
  这是为了让 `kits/` 能复用两份官方 ops kit（陈 / 林本体与假日威龙陈 / 林的动作、弹药、技能一致）。
- **包公告走引擎原生声明面**：`pack.json.notices.announcement` 指向包内的 `notice/announcement.json`，
  装载期由 `server/notices.js` 的 `workshopNotices` 把这一条**追加**进 `/data/notices.json`（合并语义是**追加**，
  引擎那一半从 `CHANGELOG.md` 生成，两边互不覆盖；上限 8 条公告 / 每条 12 小节 × 40 项 / 每项 200 字 / 摘要 600 字）。
  引擎侧零改动。`notice/announcement.json` 在装载期要「可读且是合法 JSON」，否则**拒整包**（`NOTICES_BAD_FILE`）。
- **本包不新增任何引擎端口**：客户端用的都是引擎**已具名**的组件与**已声明**的槽位（本包一个都没用），
  服务端用的都是引擎已声明的通用钩子（§5.3）。

---

## 8. 文件清单

| 文件 | 职责 |
|---|---|
| `pack.json` | 身份声明；`content: ["bonds","chess","garrisons","items"]`、6 条 `overrides`、`art`（chars + skills）、`bondIcons`、`itemIcons`、`skins`、`server.battle` / `server.meta`（8 条 `registers`）；`combat: true`、`stripDiyOverlaps: true` |
| `bonds.json` | 盟约 `dossolesShip`（故事集，阈值 2 / 2，成员名单已填 7 位） |
| `chess.json` | 新增 4 名干员（8 条）+ 覆盖 3 名官方干员（6 条） |
| `garrisons.json` | 10 条干员特质 |
| `items.json` | 6 件装备（12 条） |
| `meta/main.mjs` | 休整期侧：5 条装备处理器 + 1 条持久效果 + 2 条干员特质 |
| `battle/main.mjs` | 战斗侧：盟约 installer（4 条效果）+ 翡翠庭院至臻的装备行为 + 5 条 `IN_BATTLE` 特质 |
| `kits/chess_ws_dos_holungday_a.js` | 假日威龙陈的行为层（复用 `@ops/op-chen2.js`） |
| `kits/chess_ws_dos_lin_a.js` | 林的行为层（复用 `@ops/op-lin.js`） |
| `assets/**` | 95 个素材文件（`bond` 1 / `char` 8 / `item` 6 / `skill` 4 / `spine` 12 / `skin` 64） |
| `notice/announcement.json` | 包公告（【多索雷斯】的说明，进游戏内公告板；`pack.json.notices.announcement` 声明） |