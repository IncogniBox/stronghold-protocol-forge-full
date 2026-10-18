# 职业分支扩展（profession-expansion）

**前置 mod**：给「官方 8 职业之外的新职业 / 新分支」沉淀一套公共词汇，别的包只写数据就能引用它。
本包**不含任何干员、盟约、策略、素材**——它提供的是词汇表 + 译名 + 引擎侧的判据说明。

装法：放进 `workshop/` 即可；消费包用 `"dependencies": [{ "id": "profession-expansion" }]` 声明依赖
（缺失依赖会被装载期点名拒绝，见 `docs/WORKSHOP.md` 的 `dependencies` 一节）。

## 1. 引擎本来就能加「官方没有的职业 / 分支」（这是本包的地基）

引擎**对 `profession` 不做枚举校验**（与 `bondType` 同一条：字符串原样放行），而且一条记录的**攻击形态是记录
自己的**：

| 记录字段 | 作用 | 官方值示例（`data/chess.json` 的 `chess_char_1_01_a`） |
|---|---|---|
| `profession` | 基础职业 id | `"SNIPER"` |
| `professionName` | **职业显示名**（官方记录不写，走引擎那张 8 条闭表） | 本包新职业写 `"时术师"` |
| `subProfessionId` | 分支 id（决定行为预设） | `"fastshot"` |
| `subProfessionName` | 分支显示名 | `"速射手"` |
| `attackKind` / `dmgType` / `projectile` / `canHitFly` / `targetPriority` / `splashRadius` | 攻击形态（**盖过职业预设**） | `"ranged"` / `"phys"` / `"arrow"` / `true` / — |

三条来自引擎的判据（`server/sim/professions.js resolveProfile`）：

1. **形态**以记录为准：`attackKind` / `dmgType` / `projectile` / `canHitFly` / `targetPriority` 会**盖过**
   `PROFESSION_DEFAULTS` 与 `SUB` 两张表。所以「新职业」不需要引擎认识那个 id。
2. **未知职业**只影响**基础形态**（退回 `WARRIOR`：近战 / 物理）——你把上面那几个字段写全，就与官方同形。
3. **未知分支**（`subProfessionId` 不在引擎的 `SUB` 表里）**没有预设行为**，也不报错：特殊行为（减速、链、
   蓄能、光环……）由**消费包自己的** kit trait 或 `server.battle` 模块给。

## 2. 本包提供什么

| 文件 | 作用 |
|---|---|
| `professions.json` | **词汇表（契约）**：4 个新职业 × 各 2 个分支 + 一条挂在**官方【术师】**下的新分支（巡援术师）。每个都写明「形态照抄哪一条」「行为照抄哪一个官方分支」，巡援术师 还带上它自己的攻击范围（高台 / 地面各两张，见 §6）。引擎不读它 —— 它是给作者与工具看的 |
| `i18n/{en,ja,ko,zh-TW}.json` | 这 **13 个名字** + 巡援术师 那一段特性文本的译文。消费包记录里写**中文 msgid**（如 `professionName: "时术师"`），装上本包后英/日/韩/繁中客户端就显示出对应译文 |
| `assets/sub_patrol_support_icon.png` | 巡援术师 的**分支图标**（`art.profSub` → `assets.prof.sub`，客户端 `subProfIconUrl` 按记录自己取，见 §6） |
| `pack.json` | 只声明 `i18n` 与 `art.profSub`（没有 `content` / `server` / 客户端代码：本包不改变任何游戏数据） |

## 3. 消费包怎么写（这是「前置」的全部用法）

在自己的 `chess.json`（或 `units.json`）记录里：

```json
{
 "chess_mychar_1_a": {
  "chessId": "chess_mychar_1_a",
  "charId": "char_999_mychar",
  "profession": "CHRONOMANCER",
  "professionName": "时术师",
  "subProfessionId": "chrono_stasis",
  "subProfessionName": "滞时术师",
  "attackKind": "ranged", "dmgType": "arts", "projectile": "bolt", "canHitFly": true,
  "stats": { "blockCnt": 1 },
  "trait": "攻击造成法术伤害，命中后使目标减速（0.8 秒）",
  "…": "其余字段照抄官方一条同阶记录"
 }
}
```

- **形态**：抄 `professions.json` 里那个职业的 `base`（或你自己写）。
- **行为**：新分支的特殊行为写进消费包自己的 kit（`kit.trait`）或 `server.battle` 模块。
- **译名**：不用带——本包已经给了这 12 个名字的译文；写你自己的新名字时，要么自己带 `i18n`，要么只出中文。

## 4. 引擎侧的那一处改动（本包随带）

`public/js/ui/loadoutModel.js` 新增 `profName(profession, rec)`：**官方闭表 → 记录自带的 `professionName` → 裸 id**。
四个显示点（调配页详情卡 `screens/loadout.js`、自选编队卡片 `screens/diy.js`、持有列表 `screens/ownership.js`、
搜索关键词）都改走它，所以新职业在界面上**再也不会渲染成空白**——与「分支」同一条路子（`subProfessionName`
一直是记录自带的，官方闭表里根本没有分支名这回事）。

## 5. 已知边界（不假装支持）

- **职业**图标**没有**专属的：官方职业图标是 `data/assets.json` 的 `prof.icon[<key>]`（8 个固定 key），本包不往那儿写。
  新职业在部分界面会退化成**名字首字**（如「时」）——这是引擎既有的缺省表现，不是坏图。**分支**图标另说：巡援术师 的
  分支图标本包自带（`art.profSub` → `assets.prof.sub`，见 §6），新职业若想有自己的分支图标也照那条路走。
- **没有筛选项**：调配页那一排职业筛选按钮来自闭表 `PROF_ORDER`（官方 8 个）。新职业进不去那一排，
  但**搜索框能搜到**（搜索关键词已改走 `profName`）。
- **分支行为要代码**：见 §1 第 3 条。数据只给词汇与形态。
- **召唤物 / 替身那一块另有自己的一份闭表**：`public/js/ui/detailPanel.js` 的 `PROF_NAME`（9 条，含 `TOKEN` 召唤物）
  用于召唤物 / 替身的状态行，它对未知职业**同样退回裸 id**（不空白），但**不读 `professionName`** —— 那显示的是召唤物、
  不是干员。想让召唤物也显示新名字，就把名字写进那条 token 记录自己的显示字段（本包不代劳）。
- **本包的 4 个职业是起步集**：名字与分支是内容决定，业主可以随意改 `professions.json` + 4 个 i18n 文件。

## 6. 挂在官方【术师】下的新分支：巡援术师（Patrol-Support Caster）

**这是「给官方职业加一条分支」，不是新职业** —— 引擎对 `subProfessionId` 同样不做枚举校验（与 `profession` 同一条），
`subProfessionName` 一直是记录自带的。所以消费包的记录只要写 `subProfessionId: "patrol_support"` +
`subProfessionName: "巡援术师"`，界面就会照它显示。

| 项 | 值 |
|---|---|
| 职业 | 官方【术师】`CASTER`（`position: "RANGED"`） |
| 分支 id | `patrol_support` |
| 显示名 | 巡援术师（en `Patrol-Support Caster`，en / ja / ko / zh-TW 由本包 `i18n` 给） |
| 分支图标 | 本包自带（文件 `assets/sub_patrol_support_icon.png`；`pack.json.art.profSub: { "patrol_support": "sub_patrol_support_icon.png" }` —— 值必须是**相对 `assets/` 的路径**，写成 `assets/…` 会让路由去找 `assets/assets/…` 而 404） |
| 特性 | 攻击造成法术伤害，可以部署在地面，处于地面时会更改自身数值、攻击范围与技能效果。 |

### 「可以部署在地面」不需要任何引擎改动

`position: "RANGED"` **本来就含地面格**：`server/match/board.js` 的 `canPlace(map, pos, r, c)` 里
`'ranged'` / `'all'` 对**任何可部署格**都返回 `true`（只有 `'melee'` 才只认地面格、`'high'` 只认高台），
客户端 `public/js/ui/gameLogic/placement.js` 的 `deploySets` 是同一条语义（`ranged = melee ∪ rangedOnly`）。
所以「术师能站地面」是引擎既有的行为，`test/match/board.test.js` 就钉着它。

### 「处于地面」也是引擎既有的状态

部署那一刻 sim 就写好了 **`unit.ground`**（`server/sim/battle/deploy.js`：`u.ground = grid.isLow(tile) && !elevated`）——
高台 `false`、地面 `true`；`battle.grid.isLow(r, c)` 也能直接问。所以「按地面与否换点什么」不需要新造机制。

### 两张攻击范围（高台 / 地面）

本项目一条记录只有**一张** `rangeGrid`（普通 `_a` 与精英 `_b` 各一张），而本分支高台 / 地面是两张 —— 于是
**普通记录写 `elite0` 那张，精英记录写 `elite1` 那张**（精英1 与精英2 同形），地面那张由消费包自己按 `unit.ground` 换。

`★` 是干员自己那一格，`X` 是范围内的格；行向上是 `dRow` 减小、列向右是 `dCol` 增大 —— 与 `rangeGrid` 的 `[dRow, dCol]` 一致。

`ranges.elite0`（普通记录用）

```
高台                地面
. . X .             . X . .
. X X .             X ★ X X
X ★ X X             . X . .
. X X .
. . X .
```

`ranges.elite1`（精英记录用；精英1 与精英2 同形）

```
高台                地面
. . X . .           . X X . .
. X X X .           X ★ X X X
X ★ X X X           . X X . .
. X X X .
. . X . .
```

### 地面时换数值 / 范围 / 技能效果：骨架归消费包

本包只给词汇、译名、图标与范围；**行为归消费包**（与 §1 第 3 条同一条纪律）。骨架：

```js
// 消费包自己的 kits/<chessId>.js（或 server.battle 模块）的 install(battle, unit) 里
const GROUND_GRID = [[1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1]]; // ranges.elite1.ground
battle.on('deploy', (c) => {
  if (c.unit !== unit) return;
  if (!unit.ground) return;                            // 引擎部署时就写好了：地面 true / 高台 false
  unit.rangeGrid = GROUND_GRID;                        // 换攻击范围
  battle.refreshRange(unit);                           // 公开方法：内容改了 rangeGrid 之后重建范围（流形也这么改）
  battle.addBuff(unit, { mods: { atkPct: 0.2 } });     // 换数值
  // 技能效果：引擎按记录的 skills[] 读技能表，整套换技能要走 kit；多数情况用技能自己的
  // rangeGrid / 黑板，或 kit 的 attack / canAttack 钩子表达即可。
}, { owner: unit });
```
