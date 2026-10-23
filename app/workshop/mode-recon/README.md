# 模式扩展-重构模拟（mode-recon）

「重构模拟」的工坊包。模式本体不走本包 —— 大厅入口（仅本地客户端可见）、房间分队（1~5 队、每队至多 4 人；新加入的博士与 AI 会自动落到第一支未满的队伍，编队容量满了就不再放人）、预重构阶段（PRE_RECON，60s）与 20 回合结构由引擎在运行时合成（`shared/reconModes.js`，不落盘 `data/config.json`）。

本包带这几样东西：

1. 附加盟约【重构】（`bond_recon`）的占位记录 —— 预重构阶段的盟约倾向与后续的【重构协议·特训】都要引用这个 id，先落一条无战斗效果的记录把引用链闭合。
2. 【重构】的图标（`assets/bond/icon_recon.png`，`pack.json.bondIcons`）—— 盟约圆盘（预重构 / 盟约条 / 盟约详情）画的就是它。
3. **对局元载荷**（`server.meta` → `meta/main.mjs`）：预重构交上来的两项选择里属于**休整期**的两条 —— 盟约重构（`<修整期结束时>` 三类盟约各 +10 层）与装备重构（每回合前 3 次销毁装备时补一件不低于其阶级的随机装备）；外加装备负载的**倒计时**（装备阶级高于携带者 → 3 回合后 `ctx.destroyItem` 销毁）。
4. **战斗侧载荷**（`server.battle` → `battle/main.mjs`）：另外四条 —— 数据重构（我方基础攻/防/生命上限 +25%、法抗 +25）、数据负载、盟约负载（三类最高层盟约每层抬敌生命上限 0.1%）、装备负载的战斗部分（未携带装备伤害 -25%；高阶级装备效果 -50%）。
5. **十名·重构首领**（`enemies.json` + `battle/main.mjs`）—— 官方首领的变体（第 4 回合：碎骨·重构 / 庞贝·重构 / W·重构 / 泥岩·重构 / 萨卡兹百夫长·重构；第 8 回合：大亚当·重构 / 自在·重构 / 杰斯顿·威廉姆斯·重构 / 锏·重构；第 12 回合：“复仇者”·重构），详见下面各节。
6. **两条召唤物记录**（`enemy_ws_recon_bldbld` 凝血之刃 / `enemy_ws_recon_xia` 瑕）—— 记录与素材留在包内供普通版（`workshop/enemy-ext`）复用；宿主（血骑士 / “望”）的重构版已移除，本包代码不再召唤它们。
7. **官方战斗特效接线**（`battle/main.mjs` 的 `castSkill()`）—— W 的 C4 开火时发 `['cast', id, slot]`（引擎 `content/enemies/helpers.js` castSlot 的包侧版本，display only），客户端据此打开那个技能的**官方特效窗口**（skillfx）。特效文件本体**不在这里**：28 个基座的官方 fx 精确闭包由 `workshop/enemy-ext`（`pack.json.fx.manifest`）携带，与本机提取合并（包优先）。

选择本身留在服务端 `Match.reconChoices`（预重构阶段落的账）；元载荷用 `ctx.recon()` 读它，再物化成一条 `EffectRef` 交给战斗侧（`playerEffects`）。

## 五名·重构首领

第 4 回合的五个 key 是**官方首领的变体**：`enemies.json` 里那条记录**逐字照抄**官方记录（`data/enemies.json` 里对应的那一条），只动四处 ——

1. `key` = 新的 key（必须等于 JSON 的映射键）；
2. `name` = 官方名 + `·重构`；
3. `abilities` = 官方那几条**原样保留**，末尾**追加一条** `【重构】…`（业主给的原文）；
4. （W 除外）写上 `effectRef` = 官方基座的 key。

`spine` / `iconId` 沿用官方的值，所以真模型与真头像照画；其余字段（数值、天赋 bb、技能、`be` / `attrPower` 这些推导量）一个字节都不改 —— 手动改这些推导量会被 `validateEnemy` 报 `STALE_DERIVED`。

**为什么要写 `effectRef`（本包能零引擎改动做出「·重构」首领的唯一通道）**：引擎在敌人出生时用

```js
const kit = KITS[e.def.raw?.effectRef ?? e.defId];   // server/sim/content/enemies.js:176
```

取 kit，而 `e.def.raw` 就是**这条记录本身**（`server/sim/simdata.js:304` 的 `raw: e`）。于是只要记录带一个 `effectRef` 指向官方 key，它就**免费继承官方首领的整套 kit** —— 不需要在 `server/` 里加任何一行，也不改官方数据。本包的 `battle/main.mjs` 只负责把「·重构」那一条机制**叠加**上去。

| 新 key | `effectRef`（官方基座） | 【重构】机制 |
| --- | --- | --- |
| `enemy_ws_recon_skulsr` | `enemy_1500_skulsr`（碎骨） | 近战攻击（**被阻挡**的那一路）额外发射一枚榴弹：目标 + 其 3×3 格块内每个我方单位吃 ATK×26% 物理，并挂 5 s 防御力 −50% |
| `enemy_ws_recon_lslime` | `enemy_1050_lslime`（“庞贝”） | 每次攻击对**每一个**被打到的目标额外追加一次 100% 攻击力的灼燃（`burn` 元素损伤） |
| `enemy_ws_recon_cqbw` | **无**（见下） | C4 冷却时间减半；每次 C4 额外多选 1 名干员 —— C4 整个由本包实现 |
| `enemy_ws_recon_mdrock` | `enemy_1511_mdrock`（泥岩） | 生命值**首次**跌破 50% 时召唤 1 只泥岩巨像（`enemy_1092_mdgint`），每只只召唤一次 |
| `enemy_ws_recon_demonk` | `enemy_1501_demonk`（萨卡兹百夫长） | 可同时攻击的目标数 +1（官方 2 → 本包 3）；造成伤害时回复伤害 50% 的生命值 |

### W·重构 为什么没有 `effectRef`

官方 W 的 kit（`server/sim/content/enemies/leaders.js:126-138`）把 C4 的目标数**硬编码**成 `n = hpRatio < 0.5 ? 2 : 1` ——「不许改引擎」意味着那一行动不了。于是 W·重构 **不写 `effectRef`**、C4 整个由本包实现（官方 W 的 kit 里**只有** C4，所以没有别的东西会丢）。记录里把 C4 的 `cooldown` **减半**（20 → 10）、`initCooldown` 不动（9），本包把那个数读出来当自己的计时器。

### 已知的近似（别当成 bug）

- **W·重构 的索敌顺序**：引擎的 `targeting.js sortAllyTargets` 是「阻挡者 → 仇恨值（嘲讽 / 最晚部署）→ 最早出现」，本包用「**阻挡者优先 → 距离最近**」近似 —— 少了嘲讽与部署序两个键。
- **C4 的溅射范围**：引擎用 `areaAllies`（隐匿 / 无法选中 / 起飞 都排除），本包用 `alliesInRadius` + 排除飞行与无法选中，但**被锁定的那个目标一定吃到**（与引擎的 `targetAndArea` 同一条：锁定目标不因之后的选择规则被排除）。
- **碎骨·重构 只处理「被阻挡」的那一路**：官方 kit 已经在「未被阻挡」时发射榴弹（`splashAttack`），本包叠加的是「近战再多一发」。
- **引擎的 `applyStatus('defDown', { value })` 收的是正数减益量**（`server/sim/buffs.js:115`），而数据里的 `defdown.def` 是 −0.5，所以本包取反后再传 —— 与引擎 `leaders.js` 的 `dd` 一字不差。

## 第 8 回合的四名·重构首领

第 8 回合的四条候选与它们的机制，逐条写明**数据侧**（改记录）与**包代码侧**（`battle/main.mjs` 的叠加）：

| 候选（`shared/reconModes.js` 的 choice id） | 新 key | `effectRef` | 机制 · 数据侧 | 机制 · 包代码侧 |
| --- | --- | --- | --- | --- |
| 大亚当·重构 | `enemy_ws_recon_bigadam` | **无**（官方 `enemy_1001_bigbo` 是 STATS_ONLY，`_2` 无 kit） | `maxHp` ×2（30000→60000）、`atk` ×1.5（2700→4050），`be`/`attrPower` 随之重算（→ 83340） | 无 |
| 自在·重构 | `enemy_ws_recon_xi` | `enemy_1517_xi` | `ShieldBurst` / `ShieldBurstReborn` 的 `bb.duration`（破桎而出的**蓄力时间**）÷2（15→7.5）、`bb.dynamic`（屏障可吸收的伤害数值）×2（2500→5000 / 3000→6000） | 无 |
| 杰斯顿·威廉姆斯·重构 | `enemy_ws_recon_jakill` | `enemy_1516_jakill` | `ironsandstorm.bb.stun` 3→6、`armorpiercing.bb.def_penetrate` 0.6→1.0 | 无 |
| 锏·重构 | `enemy_ws_recon_blkswb` | `enemy_1525_blkswb` | 所有 `skills[].cooldown` ÷2（15/30/15/30 → 7.5/15/7.5/15） | 普通攻击每次 10% 概率冻结被打到的目标 |

「数据侧」的判断都落在**引擎自己的 kit 读哪些字段**上（每一条都在上面的表里点了行号/字段名）：大亚当 走 STATS_ONLY（没有 kit 可读）、自在 的 `kitXi` 直接读 `ShieldBurst` 的 `bb.duration`/`bb.dynamic`（`leaders.js:469-479`）、杰斯顿 的 `kitWarden` 读 `iron.bb.stun`（`leaders.js:441`）与 `pierce.bb.def_penetrate`（`leaders.js:419/428/433`）、锏 的 `kitMace` 的技能计时从记录的 `cooldown` 来（`helpers.js:98` 的 `cd: num(s.cooldown)`）。能这样表达的一律改记录，**引擎一行都不动**。

**随机性**：冻结是否触发走**战场的种子流** `battle.rng`（引擎 content 模块用的同一口流），所以服务端与浏览器同一局抽到同一批 —— 绝不用 `Math.random`。

**大亚当的 effectRef**：官方 `enemy_1001_bigbo_2`（大亚当）在引擎里**没有任何 kit**（`data/enemies.json` 里连它都没有；它的非赛季版 `enemy_1001_bigbo` 列在 `STATS_ONLY`），所以本包**不写 `effectRef`** —— 写了也只会指向一个查无 kit 的键。它按记录的数值出战。

### 第 8 回合的已知近似 / [ASSUMED]

- **[ASSUMED]** 冻结时长沿用引擎既有值：`server/sim/constants.js` 的 `COLD_FREEZE_DURATION` = **3 s**（业主只给了「10% 概率造成冻结」，没说时长）。
- **[ASSUMED]** 锏 的「攻击时 10% 概率冻结」是**每次攻击抽一次签**，命中多个目标时那一签同时作用于被打到的每个目标。

### 与首领表的接线

候选表由**引擎**提供（`shared/reconModes.js` 的 `RECON_TRIAL_BOSSES`：`{ 回合号 → 候选 choice[] }`，每条 `{ id, keys }`），预重构的 R04 / R08 / R12 格因此是真选择器。**R16 / R20 目前没有候选**（对应首领的重构版已移除、等重新制作）⇒ 这两个回合没有选择器，引擎按自己的种子流从官方首领里随机抽；首领回合的波次也照旧用抽到的那一只，不做替换。

## 第 12 回合的·重构首领

候选只剩“复仇者”·重构（`enemy_ws_recon_reid`，`RECON_TRIAL_BOSSES[12]` 一条单选）。

它在引擎的 KITS 里（`server/sim/content/enemies/leaders.js:213`），记录写 `effectRef: enemy_1539_reid` 免费继承官方 kit（半血加攻、冲锋、首次击倒重生）。本包只叠加重构增量：**每次攻击后攻击间隔 −5%，可叠加到 −90%**（`REID_BAT_STEP` / `REID_BAT_CAP`，与 `units.js:7` 的 ΣbatPct 下限同值）。

## 已移除的·重构首领（等重新制作）

下面十六只的重构版已整体移除：**梅菲斯特 / 浮士德 / 塔露拉 / 霜星“冬痕” / 爱国者 / 狂躁异质裂兽 / 蔓德拉 / 血骑士狄开俄波利斯 / 莫菲丝 / “酒神” / “望” / “不死的黑蛇” / 奎隆 / 伊莎玛拉 / 玻利瓦尔 / 朔壳**。

移除的东西：`enemies.json` 的记录、`battle/main.mjs` 的行为层、`pack.json.art.enemies` 的素材声明、`pack.json.forms` 的形态声明、`shared/reconModes.js` 的候选条目、对应的测试用例。`assets/spine/enemy/` 与 `assets/enemy/icon/` 下的模型与图标文件**保留在包里**（不再被声明），重新制作时可直接复用。

**保留的两条召唤物记录**：`enemy_ws_recon_bldbld`（凝血之刃）与 `enemy_ws_recon_xia`（瑕）连同素材留在 `enemies.json` 与 `pack.json.art.enemies` 里 —— 普通版（`workshop/enemy-ext`）复用同一份素材；它们的宿主（血骑士 / “望”）重构版已移除，所以本包代码暂时不召唤它们。

## 图标有两份拷贝（故意的）

`assets/bond/icon_recon.png` 与**引擎的** `public/icons/recon.png` 是同一张图。两条通道各自的要求决定了这件事：

- 盟约图标只能从**包内的 `assets/`** 取（`pack.json.bondIcons`，引擎的 `data/assets.json` 是生成物、不许手改），所以包这一份必须在；
- 大厅的「重构模拟」入口是**引擎 UI**（`screens/lobby.js`），而本模式**不依赖本包**（见 `shared/reconModes.js`）—— 包缺席时入口照样要画得出来，所以引擎那一份也必须在。

改图标时两张一起换。

## 已知口径（别当成 bug）

- **「装备负载」的『装备效果 -50%』只算属性那一半**：装备的属性贡献由引擎的 `itemStatMods`（`@battle/mod.js`）给出，战斗侧挂一条补偿 buff 把要减掉的那半个减回去。装备的**触发类**效果（hook / 骑手伤害 / 不死窗口一类）没法这样缩 —— 引擎没有「缩放某一件装备效果」的通道，那部分照旧全额生效。
- **同名负载取最高、不叠加**：联防的一张战场上两名博士选了同一条负载时，按**最强的**那一份生效。
- **倒计时从「被发现的那一刻」起算**：`onEquip` 与每回合开始各判一次，记的到期回合是 `当时回合 + 3`。

## 重构协议·特训（已落地）

每个特训回合（4 / 8 / 12 / 16 / 20，`shared/reconModes.js RECON_TRAINING_ROUNDS`）的**休整期**，重构对局的顶栏多一枚「特训」按钮（`ui/reconTrain.js`，`screens/game.js` 挂载）：弹窗里从**场上与待部署区**各点一名干员——前者教官、后者学员，交新 C2S `g.reconTrain { mentor, trainee }`（`shared/protocol.js` → `intents.js` → `PlayerState.reconTrain`，`player/prep.js`）。每名博士每个特训回合一条，重交覆盖同回合那条。
本回合交过之后按钮**仍可点开**（画成已完成）：弹窗预填当前那一对，可换人或交 `g.reconTrainCancel { trainee }`（`PlayerState.reconTrainCancel`）**取消本回合特训**——关系条目一撤，战斗输入就不再带 `reconTrainee`；学员 `meta.data.bondGrants` 只回收**这条关系实际加进去的**那几条（授予来源记在 `meta.data.bondGrantSrc['recon:<回合>']`），装备继承等其它来源原样保留。

- **继承口径（叠加式，2026-10-27 定稿）**：学员的战斗输入条目带 `reconTrainee = { chessId, loadout, diy?, ratio, skin? }`（`player/round.js battleInput`），sim 侧 `DataSource.getChess` 的 `traineeOf` 组成通道（`server/sim/simdata.js getTrainee`）据此组出一条 def。
  - **基础数值**：攻 / 防 / 生命上限 = **学员自己的 + 教官的 ×0.5**（`RECON_TRAINEE_STAT_RATIO`，固定不叠加）。
  - **属性 / 攻击范围**：再部署时间、部署费用、阻挡数、攻击间隔、攻击范围**全是学员自己的**，教官的一概不继承也不融合。
  - **天赋**：学员原有的照常结算，教官的天赋 installer **追加**到学员的 kit（`content/index.js applyTraineeMentor`）。
  - **特质**：`PlayerState.pieceGarrisonIds` 把学员自己的 `garrisonIds` 与教官的并起来——休整期的 `_garrisons` / `triggerGarrisons`、内容钩子的 `garrisonsOf`、战斗结果校验（`fields.js layerAllowanceOf`）与战斗侧 `raw.garrisonIds` 读的是同一份集合；自己的照常，教官的整备 / 作战能力也叠加。学员原有的照常，教官的 `install` 链在学员之后、`trait` 覆盖对象并入（学员自己的键优先）。
  - **技能**：学员释放自己的技能不变，教官选定技能的**效果**作为影子并进学员的 spec（`mergeShadowSpec`）——数值 mods 相加，但 `batPct` / `aspd`（攻击间隔）、`rangeExtend` / `targeting.rangeGrid`（攻击范围）、技能持续时间、弹药数、SP / 触发规则全是学员自己的。攻击侧四种组合统一成一条语义：**学员每一次攻击（弹药类技能 = 每发弹药）额外附带 1 次教官技能的攻击效果**。
    - (1) 非弹药 × 非弹药：每次攻击多 1 次应用（`attack.hits + 1`）；
    - (2) 非弹药 × 弹药：同上（教官的弹药上限不跟过来，每次攻击都触发）；
    - (3) 弹药 × 非弹药：每发弹药都触发那 1 次；
    - (4) 弹药 × 弹药：每发弹药都带双方效果，打完学员自己的弹药数。
  - **余 S3 火墙的口径**（2026-10-23）：官方写「**其他友方**穿过火墙造成法术伤害时」——余本人不触发。学员继承后，火墙由学员自己的技能生成、她本人就站在这面墙的列 / 行上（几何上永远「不跨过」），所以**学员自己的法术伤害按「穿过火墙」处理**，每一击都附带余的灼燃损伤；余本人（以及其它友方）仍按官方几何穿越判定。判据在火墙的 `install` 里看单位自己的 def 是否带 `traineeMentor`。
  - `content/index.js syncUnitLoadout` 见到 `reconTrainee` 不再按 loadout 重解析（组成件即终局）。
- **特效与音效也一起继承**（2026-10-23 补）：快照给学员带 `UnitInfo.reconMentor = { defId, spine, skillIndex, skin? }`（教官的身份、选定技能槽与**当前时装**），客户端两条链各自叠上教官那一层——`render/app/info.js renderInfo` 把它原样转写进 `view.info`（漏这一格 ⇒ skillfx 解析不到教官的 plan / mode，特效整段没有），之后：
  - **特效**（`render/vfx/skillfx.js` + `wiring.js`）：教官那一层只在**学员自己的技能生效期间**叠（普通攻击不带，`SkillFx.mentorOn`）；特殊技能另有**结束后窗口**——蕾缪安 S3 的礼炮在技能结束后的 10 s 内仍归属该技能（`POST_SKILL_MENTOR_S`，与 kit 的 `LEMUEN_SHELL_WINDOW` 同值），窗口内的攻击照叠教官效果，且每一发 `bombard` 落点都补播教官的命中特效（`SkillFx._mentorRelease`）。`mentorPlan` 把教官技能的 start / range / loop / end 叠进学员的施放；`mentorMode` 更进一步读**教官技能换了攻击模式**的那份 `mode`（新约能天使 S3 这类：施放 / 范围 / **命中**全在 mode 的 `attack` 里，技能本体只有 buff 行），`wiring._mentorAttackSet` 在学员每一次攻击时把那份 cast / range / hit 并进 `_attackSet`（MultiHit 组按组号并进同一发命中）。**教官技能自己那枚弹道的 `onHit` / `onStop` 也作为命中行并进来**——维什戴尔 S3 的爆炸就挂在那枚弹道上（`wisdel_skill_03_hit` / `_hit_02`），所以学员的每一发弹药命中时都会炸；这一发**直接把目标打死**（弹道到达前已倒下）时，官方不再往目标身上挂行，教官那几行按弹道停止点补播；弹道本身不借，学员打的是自己的枪（挂载点 / 拖尾 / 飞行都是学员的）。预载（`keysFor`）同时收教官 plan、mode 与弹道的键。
    - **教官当前时装的变体**：`reconMentorInfo.skin` 按同一个主人的 charId 解析出教官的模型 stem，教官来源的每条 key（plan 的 `key`/`slots`、mode 的 `effects`）先换成 `<key>_<该时装的 fx>`（装的数据里有才换），否则用默认那一枚——学员自己穿的那套不参与教官这一层。**火墙控制器**（`yu_skill3_range_01_source`）的 key 会被预改写成 `<key>_<fx>`（如 `_nian_12`）——`wiring.playOn` 用 `isYuWallSource` 同时认默认与带后缀的变体，否则穿时装的教官行会被当成普通特效而不搭墙（2026-10-23 修）。
  - **音效**（`audio.js`）：施放时叠教官技能的 `skills[教官槽]`；技能期间的挥击 / 命中再叠教官那份 `attacks[教官槽]` / `hits[教官槽]`（只有那份技能音存在时才补，不会把教官的普通攻击音带进来；弹药类技能每打一发都叠一次）。技能结束后的礼炮窗口内（`MENTOR_RELEASE_MS` = 10 s，与特效同一窗口），每一发 `bombard` 落点也补教官的命中音。教官穿了带专属战斗音效的时装时，这几处都先问那套时装的 `sfx`，再落回教官本体。
  - **详情卡**：继承的条目**并进学员自己的对应行**（同一区块，条目带金色「教官」标签）——影子技能接在学员技能下面；**教官的特质（金色「整备 / 作战能力」那一块，`garrisons.json`）接在学员自己的特质块下面**（不是下面那行职业分支「特性」描述）；教官的天赋接在学员天赋下面；三围算式（`学员 + 教官×50%`）跟在属性格下面。不再单开「教官教学」一类。教官天赋里名字与描述都空的隐藏模组天赋不画。
  - 回落：`reconMentor` 缺席、教官 plan 解析不出、或教官那份 mode / 音效文件不在数据里时，行为与从前逐字相同。
- **授予盟约**：学员棋子 `meta.data.bondGrants` 追加 `bond_recon`（引擎级授予通道，与源石辅助仪同一条）——盟约条因此亮起【重构】，阈值 [1] 一名学员即激活。
- **已知近似 / [ASSUMED]**：教官是另一位学员时不链式（捐出的是教官自己的选定技能）；学员自己不能是补位 / 自选槽，但**教官可以是补位干员或甄选干员**（按替补 / pick 的那份 def 继承：三围、技能、特效、音效全是那位干员的）；教官被售 ⇒ 该条静默失效；被合并 / 进阶的学员保留特训（按 uid 跟人）。
- 重构对局的整局标记：`m.public.recon` 现在全程存在（PRE_RECON 之外 `choices` 为 null）——特训按钮的读点；官方对局连这个键都不写。

## 后续轮次（本包承接）

- 【重构协议·特训】的后续打磨（如链式继承、特训对召唤物的影响）；

## 注意

- 入口与建房在服务端有本地闸：非本机（loopback / 私网）客户端建不了重构模拟房间。
- 本包声明了行为开关 `unequip: "allow"`（装备重构那句「干员的装备可进行拆卸」）—— 这是**包级**声明，装了它的房间在休整期都能拆卸装备。
- 元载荷只在**本模式**的房间闹事：`ctx.recon()` 为 null 时它一个动作都不做（非重构房间照旧）。
