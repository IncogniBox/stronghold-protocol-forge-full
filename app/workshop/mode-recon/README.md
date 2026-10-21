# 模式扩展-重构模拟（mode-recon）

「重构模拟」的工坊包。模式本体不走本包 —— 大厅入口（仅本地客户端可见）、房间分队（1~5 队、每队至多 4 人；新加入的博士与 AI 会自动落到第一支未满的队伍，编队容量满了就不再放人）、预重构阶段（PRE_RECON，60s）与 20 回合结构由引擎在运行时合成（`shared/reconModes.js`，不落盘 `data/config.json`）。

本包带五样东西：

1. 附加盟约【重构】（`bond_recon`）的占位记录 —— 预重构阶段的盟约倾向与后续的【重构协议·特训】都要引用这个 id，先落一条无战斗效果的记录把引用链闭合。
2. 【重构】的图标（`assets/bond/icon_recon.png`，`pack.json.bondIcons`）—— 盟约圆盘（预重构 / 盟约条 / 盟约详情）画的就是它。
3. **对局元载荷**（`server.meta` → `meta/main.mjs`）：预重构交上来的两项选择里属于**休整期**的两条 —— 盟约重构（`<修整期结束时>` 三类盟约各 +10 层）与装备重构（每回合前 3 次销毁装备时补一件不低于其阶级的随机装备）；外加装备负载的**倒计时**（装备阶级高于携带者 → 3 回合后 `ctx.destroyItem` 销毁）。
4. **战斗侧载荷**（`server.battle` → `battle/main.mjs`）：另外四条 —— 数据重构（我方基础攻/防/生命上限 +25%、法抗 +25）、数据负载、盟约负载（三类最高层盟约每层抬敌生命上限 0.1%）、装备负载的战斗部分（未携带装备伤害 -25%；高阶级装备效果 -50%）。
5. **十一名·重构首领**（`enemies.json` + `battle/main.mjs`）—— 官方首领的变体（第 4 回合：碎骨·重构 / 庞贝·重构 / W·重构 / 泥岩·重构 / 萨卡兹百夫长·重构；第 8 回合：大亚当·重构 / 自在·重构 / 梅菲斯特·重构 / 浮士德·重构 / 杰斯顿·威廉姆斯·重构 / 锏·重构），详见下面两节（第 4 回合的「五名·重构首领」与第 8 回合的「六名·重构首领」）。
6. **梅菲斯特 / 浮士德 的官方 kit 与美术**（`pack.json.art.enemies` + `battle/main.mjs`）—— 这两只的官方首领（`enemy_1507_mephi` / `enemy_1508_faust`）在引擎里**没有 kit**、`data/assets.json` 里也**没有**它们的图标与模型，于是本包自带这两样（取自社区对官方客户端的转储）并按官方数据补齐它们的行为（治疗光环 / 治疗三名 / 登场无敌与不可阻挡 / 致命一击），见「梅菲斯特 / 浮士德 的官方 kit 与美术」一节。

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

## 第 8 回合的六名·重构首领

第 8 回合的五条候选（第 3 条**一次刷两只**）与它们的机制，逐条写明**数据侧**（改记录）与**包代码侧**（`battle/main.mjs` 的叠加）：

| 候选（`shared/reconModes.js` 的 choice id） | 新 key | `effectRef` | 机制 · 数据侧 | 机制 · 包代码侧 |
| --- | --- | --- | --- | --- |
| 大亚当·重构 | `enemy_ws_recon_bigadam` | **无**（官方 `enemy_1001_bigbo` 是 STATS_ONLY，`_2` 无 kit） | `maxHp` ×2（30000→60000）、`atk` ×1.5（2700→4050），`be`/`attrPower` 随之重算（→ 83340） | 无 |
| 自在·重构 | `enemy_ws_recon_xi` | `enemy_1517_xi` | `ShieldBurst` / `ShieldBurstReborn` 的 `bb.duration`（破桎而出的**蓄力时间**）÷2（15→7.5）、`bb.dynamic`（屏障可吸收的伤害数值）×2（2500→5000 / 3000→6000） | 无 |
| 梅菲斯特·重构 + 浮士德·重构（**一次选择两只**） | `enemy_ws_recon_mephi` / `enemy_ws_recon_faust` | `enemy_1507_mephi` / `enemy_1508_faust`（**引擎没有这两只的 kit** ⇒ 官方那套行为由本包按官方数据补上，见下节） | 浮士德：`CriticalHit` 的 `cooldown` ÷2（17→8.5） | 梅菲斯特：每 10 s 召唤 3 只随机宿主；浮士德被击倒后召唤 10 只。浮士德：命中时额外一次 50% 攻击力的 3×3 物理伤害；梅菲斯特被击倒后攻击间隔 ×0.5 |
| 杰斯顿·威廉姆斯·重构 | `enemy_ws_recon_jakill` | `enemy_1516_jakill` | `ironsandstorm.bb.stun` 3→6、`armorpiercing.bb.def_penetrate` 0.6→1.0 | 无 |
| 锏·重构 | `enemy_ws_recon_blkswb` | `enemy_1525_blkswb` | 所有 `skills[].cooldown` ÷2（15/30/15/30 → 7.5/15/7.5/15） | 普通攻击每次 10% 概率冻结被打到的目标 |

「数据侧」的判断都落在**引擎自己的 kit 读哪些字段**上（每一条都在上面的表里点了行号/字段名）：大亚当 走 STATS_ONLY（没有 kit 可读）、自在 的 `kitXi` 直接读 `ShieldBurst` 的 `bb.duration`/`bb.dynamic`（`leaders.js:469-479`）、杰斯顿 的 `kitWarden` 读 `iron.bb.stun`（`leaders.js:441`）与 `pierce.bb.def_penetrate`（`leaders.js:419/428/433`）、锏 的 `kitMace` 的技能计时从记录的 `cooldown` 来（`helpers.js:98` 的 `cd: num(s.cooldown)`）。能这样表达的一律改记录，**引擎一行都不动**。

**宿主池**（梅菲斯特 的召唤对象）是 `data/enemies.json` 里名字含「宿主」的三只：`enemy_1043_zomsbr`（宿主士兵）、`enemy_1061_zomshd`（宿主重装士兵）、`enemy_1062_rager_2`（狂暴宿主组长）—— 数据是判据，本包只是读它。

**随机性**：召唤哪几只宿主、冻结是否触发，都走**战场的种子流** `battle.rng`（引擎 content 模块用的同一口流），所以服务端与浏览器同一局抽到同一批 —— 绝不用 `Math.random`。

**大亚当的 effectRef**：官方 `enemy_1001_bigbo_2`（大亚当）在引擎里**没有任何 kit**（`data/enemies.json` 里连它都没有；它的非赛季版 `enemy_1001_bigbo` 列在 `STATS_ONLY`），所以本包**不写 `effectRef`** —— 写了也只会指向一个查无 kit 的键。它按记录的数值出战。

**梅菲斯特 / 浮士德 的 effectRef**：按第 4 回合的 recipe 写上了（指向官方 key），但**挂不上东西** —— 引擎的 `KITS` 里没有 `enemy_1507_mephi` / `enemy_1508_faust`（它们是 `enemy-ext` 包补进来的首领，本引擎没有实现它们的 kit）。所以这两只的**官方行为**（治疗光环 / 治疗三名 / 登场无敌与不可阻挡 / 致命一击）由本包代码按官方数据补上（见下节），而 `effectRef` 只是照 recipe 留着的一格。

### 第 8 回合的已知近似 / [ASSUMED]

- **[ASSUMED]** 冻结时长沿用引擎既有值：`server/sim/constants.js` 的 `COLD_FREEZE_DURATION` = **3 s**（业主只给了「10% 概率造成冻结」，没说时长）。
- **[ASSUMED]** 浮士德 的「3×3 范围伤害」用**被打中的目标的 3×3 格块**（Chebyshev ≤ 1，与第 4 回合碎骨榴弹的 `alliesInBox` 同一口径），被锁定的目标一定吃到。
- **[ASSUMED]** 梅菲斯特 的「每 10 秒」是**每只梅菲斯特·重构 自己的一条倒计时**（战场便签记），到点即召唤、不因晕眩/沉默停下（周期召唤按被动计时读）。
- **[ASSUMED]** 锏 的「攻击时 10% 概率冻结」是**每次攻击抽一次签**，命中多个目标时那一签同时作用于被打到的每个目标。
- **[ASSUMED]** 梅菲斯特 的「自然生命回复速度加倍」读作**把该单位自己的自然回复速度再加一份**（宿主士兵 80→160、宿主重装士兵 200→400；本来为 0 的仍是 0）。数据里这条天赋的那一格是 `talents.bb['healaura.hp_recovery_per_sec'] = 1`，官方没有别的 bb 能给出这条效果；图鉴文本「加倍」是判据。
- **[ASSUMED]** 梅菲斯特 的治疗目标是**最缺血的至多 3 名敌方单位**（按 `hpRatio` 升序；他自己也是候选）—— 「同时治疗3名」来自图鉴文本，官方数据里没有选目标的 bb。
- **[ASSUMED]** 浮士德 的致命一击是「到点后的**下一次普通攻击**合计 2× 攻击力」（普通攻击已给 1×，包代码再补 `atk × (atk_scale − 1)`），而不是另起一个独立的伤害事件。

### 与首领表的接线

第 4 / 8 / 12 / 16 回合的候选表由**引擎**提供（`shared/reconModes.js` 的 `RECON_TRIAL_BOSSES`：`{ 回合号 → 候选 choice[] }`，每条 `{ id, keys }`），预重构的 R04 / R08 / R12 / R16 格因此都是真选择器（四个试炼回合现在都有候选；引擎的种子流抽只在「这一回合没有候选」时才会用到）。R08 第 3 项（梅菲斯特 + 浮士德）是**一条 choice 含两个 key**，选中后每只各出一条追加出怪 —— 一次选择，两只怪。

## 第 12 回合的五名·重构首领

候选：塔露拉·重构 / 霜星，“冬痕”·重构 / 爱国者·重构 / “复仇者”·重构 / 狂躁异质裂兽·重构（`RECON_TRIAL_BOSSES[12]`，五条单选）。

这五只里**只有“复仇者”在引擎的 KITS 里**（`server/sim/content/enemies/leaders.js:213`，记录写 `effectRef: enemy_1539_reid` 免费继承），其余四只在引擎里从来没有 kit —— 官方行为由本包按 `workshop/enemy-ext/enemies.json` 的记录补上（数值一律读记录）。

**数据侧**（`enemies.json` 的五条记录）：攻半径 2.5→3.0 与日冕 40/15→20/7.5（塔露拉）；普通攻击寒冷 5→10 与冰环寒冷 10→15（霜星）；`reborn.duration` 60→15、`immo_trigger[rage].interval` 0.8→0.4、投枪冷却 20→10（爱国者）。`be` / `attrPower` 一个字节不动。

**包代码侧**（`battle/main.mjs`）：塔露拉的灼燃 50% 与「被阻挡时攻击转真实」、霜星的冰环 / 冰盾 / 重生、爱国者的 4 连击 / 生命献祭 / 毁灭姿态、复仇者的攻击间隔 −5%（上限 −90%）、裂兽的狂怒 / 二阶段 / 落石。

### 第 12 回合的已知近似 / [ASSUMED]

- **[ASSUMED]** 塔露拉「被阻挡时造成真实伤害」借引擎 kit 的 `mem.ab.atkType` 通道（本包给这条记录补一个空 kit 壳，`list: []`），`beforeAttack` 时按是否被阻挡切换成 `true`；不新增伤害事件。
- **[ASSUMED]** 霜星「冰环」按业主措辞施加**寒冷**（记录只有 `bb.freeze`），引擎的 cold-on-cold 会配成冻结 —— 所以第二次冰环起吃「对被冻结目标伤害加倍」。「冻结 / 冻结［重生］封印部署地面」在本模式没有地形系统，**没有可移除的东西**（空操作）。
- **[ASSUMED]** 霜星的冰盾按「层数挡下一次法术伤害」实现（`max_cnt` = 2 / 重生后 3，35 s 补满）；被挡下的那一次伤害整体取消（`hit` 钩子的 `dmg.cancel`，与引擎 `hitShield` 同理）。
- **[ASSUMED]** 爱国者的「4 连击」= 普通攻击结算后补 3 次同额物理（引擎的 `attack` 钩子在伤害之后，ai.js:1026）；「大幅强化敌军攻防」= 给所有敌方单位续短命 buff（攻击 +20%、防御 +200 点，与梅菲斯特光环同一条做法）。
- **[ASSUMED]** 爱国者毁灭姿态的「防御 +100%、法抗 +50%」用 `defPct: 1` + `resFlat: base.res × 0.5`（重构增量）；远程攻击通过 `profile.melee = false` + `base.rangeRadius = 2` 打开（ai.js:933）；投枪只点**高台干员**（`def.position === 'RANGED'`），取最远的一名。
- **[ASSUMED]** 狂躁异质裂兽的「攻击无视敌我」在本模式没有友方敌人可打，只做**同时攻击周围至多 3 名我方**；「逃跑」整段按重构要求删掉（狂怒结束 ⇒ 直接第二阶段），所以 `RunToNearestHole` 一行都不实现；第二阶段的 60 s 狂怒结束后回到常态（没有第三形态）。
- **[ASSUMED]** 裂兽「使目标受到来自自身的伤害大幅提升」（`IncreasedDamage.damage_scale` 2 / 20 s）用目标身上的 `dmgTakenMul: 2` 近似 —— 引擎没有「按来源限定」的易伤通道。

## 第 16 回合的五名·重构首领

候选：蔓德拉·重构 / 血骑士狄开俄波利斯·重构 / 莫菲丝·重构 / “酒神”·重构 / “望”·重构（`RECON_TRIAL_BOSSES[16]`，五条单选）。

数据来源：前两只与「酒神」「望」照抄 `workshop/enemy-ext/enemies.json`；**莫菲丝在已装数据里没有记录**，本包按 PRTS `/w/莫菲丝?action=raw` 补了一条（60000/680/580/35 · 0.7 速 · 2.8 攻隔 · 射程 2.5 · 免疫晕眩/沉默/沉睡/冻结）。业主原文写作「莫菲斯」，Wiki 的正式名是「莫菲丝」，记录用后者。

**数据侧**（\`enemies.json\`）：石之盾减伤 0.6→0.8（蔓德拉）；`CheckTrigger.hp_ratio` 1→0.5（血骑士）；`Reborn.duration` 20→10（酒神）；`Reborn.duration` 30→15、`Reborn.invincible_duration` 60→10、`RebornSpawn.interval` 30→5（望）。莫菲丝的 `EnemyLineT.atk`=0.25、`Shield.dynamic_ratio`=0.1、`Reborn.duration`=10 也写在她的记录里。

**召唤物**：凝血之刃与瑕按 PRTS 补成两条普通敌人（`enemy_ws_recon_bldbld` / `enemy_ws_recon_xia`，模型与图标由本包自带（来源见「素材来源」））。

### 第 16 回合的已知近似 / [ASSUMED]

- **[ASSUMED]** 莫菲丝没有引擎 kit：本包实现【红线】（最远我方、每 0.4 s 攻击力 50%/60% 法术伤害、10 s）、每根有效【线】+25% 攻击、【梦境的演变】（8 s 骑乘、屏障 = 10% 生命上限）、重生 10 s。**【蓝线】需要「其他敌人」分担伤害，试炼场通常只有她自己 ⇒ 按 0 根处理**（减伤/均摊不生效）。
- **[ASSUMED]** “望”的瑕：每秒对周围 4 格我方造成 100% 攻击力法术伤害；处在望周围时改为单体攻击 + 1 s 眩晕。棋子地形、「失气」、周围每名我方 +50% 受伤、最后一枚瑕被击退时望退场都不实现。
- **[ASSUMED]** 血骑士的复活姿态：15 s 内每秒回 10% 生命上限，回血到 50% 立即回第一形态，否则到点进第二形态；凝血之刃以 2 格/秒径直扑向血骑士（它没有自己的路径），接触后回 10% 生命上限并消失。
- **[ASSUMED]** 蔓德拉的【石之盾】受破碎支柱伤害后失效不实现（本模式没有破碎支柱）；「注目使所在地块损毁」同样没有地形可损毁。
- **[ASSUMED]** 酒神的神经损伤改写只取「目标相邻一圈」（Chebyshev ≤ 1），不再眩晕爆发目标本身；摄影区域相关减伤【未曾领悟】不实现。

## 第 20 回合的五名·重构首领

候选：“不死的黑蛇”·重构 / 奎隆，摩诃萨埵权化·重构 / 伊莎玛拉，腐化之心·重构 / 玻利瓦尔，症结之核·重构 / 朔壳·重构（`RECON_TRIAL_BOSSES[20]`，五条单选）。第 20 回合是**首领回合**：预选不追加普通出怪，而是把首领波次里 `tag: 'boss'` 的那条 spawn 换成候选的 key（`reconTrials.js` 的 `reconBossSpawnKeyFor` / `reconBossWaveFor`，phases._planBossWaves 与 bossRounds.startFinalAssault 两处都过一遍）。

**数据侧**（`enemies.json`）：点燃 19→15、引爆 35→20（黑蛇）；惩五戒（MultiAttack）冷却 20→10（奎隆）；初始生命 90000→135000、`FetchAttributes.syskad_t[monster].*` 全部改成 ×1（伊莎玛拉，be/attrPower 随之重算）；只保留灾厄形态的 `Fire`（玻利瓦尔）；暴武闪避 0.5→0.75、技能记录清空（朔壳，溯律在记录里本来就是天赋能力）。

**包代码侧**：黑蛇的真实伤害攻击 / 烈焚灼息 / 引爆 / 击倒后的全场火与狂暴；奎隆 3 连击；伊莎玛拉的 3 人治疗与 30 s 变身；朔壳的非阻挡者伤害 75% 闪避。

### 第 20 回合的已知近似 / [ASSUMED]

- **[ASSUMED]** 奎隆「仅保留无忧觉阶段」在没有 kit 的引擎里无阶段可删 —— 记录直接按最终形态跑，普通攻击 3 连击由本包补。
- **[ASSUMED]** 玻利瓦尔「灾厄之口」的打断条件（技能期间累计受到 25% 生命上限伤害）需要那套技能本身；引擎没有 kit ⇒ **未实现**（只保留灾厄形态的 `Fire` 数据）。
- **[ASSUMED]** 朔壳的【溯律 / 宿傲 / 敛傲】需要待部署区卡牌与召唤物，本模式没有那套对象 ⇒ 未实现，只做暴武闪避。
- **[ASSUMED]** 伊莎玛拉的「变身」由 30 s 计时近似（官方靠“伊莎玛拉之泪”充能）；变身只改真实伤害与 3 目标。
- **[ASSUMED]** 黑蛇的「击中带烈焚灼息的我方造成伤害降低」未建模（没有按来源的减伤通道）。

## 梅菲斯特 / 浮士德 的官方 kit 与美术（本包补全）

引擎的 `KITS` 里**没有** `enemy_1507_mephi` / `enemy_1508_faust`（它们是 `enemy-ext` 包按官方 `enemy_database` 补进来的首领，本引擎从没实现过它们的 kit）—— 所以这两只此前只有「·重构」增量，没有官方行为、也没有外观。本包把这一半补上。

**一、官方行为**（`battle/main.mjs`，数值一律读记录，只有一处例外）：

| 行为 | 数据来源 | 实现 |
| --- | --- | --- |
| 治疗光环：全场敌方单位的自然生命回复速度加倍 | 天赋 `talents.bb['healaura.hp_recovery_per_sec'] = 1` + 图鉴文本 | 给每个自然回复 > 0 的敌方单位续一条 `hpRegen` = **它自己的** `base.hpRecoveryPerSec` 的短命 buff（时长 1 s、每 tick 续一次 —— 引擎的 hpRegen 光环都是这条做法），于是 ×2；梅菲斯特 倒下后 1 s 内自行消退 |
| 普通攻击 = 治疗：同时治疗 3 名敌方单位 | 图鉴文本（「3」是唯一没有 bb 的数）/ 记录的 `bat` = 6 s / `atk` = 500 | 按 `bat` 自己计时（记录是 `applyWay: NONE`，引擎不给他派攻击），治疗**最缺血的至多 3 名**，每人 `atk` 点，走引擎的 heal 管线 |
| 登场无敌 + 无法被阻挡 | 天赋 `talents.bb['invincible.duration']` = 150 s + 图鉴文本 | 一枚 `flags: { invulnerable: true }` 的 150 s buff（`damage.js:338` 的短路）+ 一条常驻的 `flags: { unblockable: true }`（`blocking.js:29` 读的就是这个旗标） |
| 致命一击（特殊弩箭使攻击力加倍） | 技能 `CriticalHit`：`initCooldown` 17 s / `cooldown` 8.5 s（·重构 已减半）/ `bb.atk_scale` 2 | 每只自己一条倒计时；到点后**下一次普通攻击**额外补 `atk × (atk_scale − 1)` 点物理（合计 2×），并发一个 `crit` fx |

**没有实现的一条**：图鉴「每隔一段时间会召唤战场中隐藏的弩炮台」= 技能 `SummonBallis`（`bbStr.branch_id: 'faust_ballis'`）。**本安装的数据里没有弩炮台** —— 它是 5-10 关卡的**分支装置**，不是敌人（`data/*.json` 与官方 `enemy_database` / `enemy_handbook_table` 里都查无 `ballis`，只有名字带「弩炮」的两名深池士兵）。记录照旧带着那条技能（忠实的数据），但场上不会出现弩炮台。

**二、美术与动作**（`pack.json.art.enemies` + `enemies.json` 的 `attackAnim`）：两条记录的 `spine` / `iconId` 沿用官方 key（`enemy_1507_mephi` / `enemy_1508_faust`，与其余九只同一套 recipe，也是测试钉住的形状），而 `data/assets.json` 里**没有**这两个 key —— 于是本包自带它们的图标与 Spine 模型，落在 `assets/` 下：

- `assets/enemy/icon/enemy_1507_mephi.png`、`assets/enemy/icon/enemy_1508_faust.png`；
- `assets/spine/enemy/enemy_1507_mephi/`、`assets/spine/enemy/enemy_1508_faust/`（`.skel` / `.atlas` / 页面 `.png`）。

落点与九只·重构首领一致：`assets.enemies["enemy_1507_mephi"]` 既服务本包的 `enemy_ws_recon_mephi`（客户端按记录的 `spine` / `iconId` 取模型与头像），也服务 `enemy-ext` 包那条同名的官方记录。`attackAnim`（`{ clip, dur, hit }`）**由这份骨架派生**：`clip` = `anims.attack.loop`、`dur` = 该 clip 的时长、`hit` = 它的第一个命中帧（与 `tools/build-data.mjs` 的 `enemyAttackAnim` 同一条规则）—— 记录里的「动作」与包自带的美术因此永远是同一份真相（测试钉住）。

### 素材来源

图标与 Spine 模型取自社区对**官方客户端**的转储（本仓不生产游戏素材；`public/assets/` 是 git-ignored 的素材管线产物）：

- 图标：`yuanyan3060/ArknightsGameResource`（上述每个模型对应的 `enemy/<key>.png`，含 `enemy_1507_mephi` / `enemy_1508_faust` / `enemy_1186_bldbld` / `enemy_2101_dyspll` / `enemy_1001_bigbo_2` / `enemy_1503_talula` / `enemy_1506_patrt` / `enemy_1510_frstar2` / `enemy_1523_mandra` / `enemy_1524_bldkgt` / `enemy_1568_dirctr` / `enemy_1571_mirbst` / `enemy_1569_ldevil` / `enemy_2120_dywqgs` / `enemy_1515_bsnake` / `enemy_2089_skzjkl` / `enemy_2039_syskad` / `enemy_2150_shchmr` / `enemy_2126_dycyue`）；
- Spine：`isHarryh/Ark-Models`（`models_enemies/1507_mephi/`、`1508_faust/`、`1186_bldbld/`、`2101_dyspll/`、`1001_bigbo_2/`、`1503_talula/`、`1506_patrt/`、`1510_frstar2/`、`1523_mandra/`、`1524_bldkgt/`、`1568_dirctr/`、`1571_mirbst/`、`1569_ldevil/`、`2120_dywqgs/`、`1515_bsnake/`、`2089_skzjkl/`、`2039_syskad/`、`2150_shchmr/`、`2126_dycyue/` 的 `.skel` / `.atlas` / `.png`；其中 **1571_mirbst 上游只有 Spine 3.8 JSON**，所以它按 `.json` 存放 —— 引擎的 `validSpine` 与 `tools/workshop-validate.mjs` 都接受 `.skel` / `.json` 两种骨架。

下载后按引擎的两条既有规则处理过（`tools/assets/atlas.mjs` / `skel.mjs` / `anim-roles.mjs`，与素材管线同一套）：图集补 `size: W,H` 与 `pma: true`，用 `resolveRoles` 解出 `anims` / `animations` / `events` / `hits` / `bounds`。这几件素材的著作权属官方（Hypergryph），本包自身的代码与文案才是 CC0-1.0。

## 图标有两份拷贝（故意的）

`assets/bond/icon_recon.png` 与**引擎的** `public/icons/recon.png` 是同一张图。两条通道各自的要求决定了这件事：

- 盟约图标只能从**包内的 `assets/`** 取（`pack.json.bondIcons`，引擎的 `data/assets.json` 是生成物、不许手改），所以包这一份必须在；
- 大厅的「重构模拟」入口是**引擎 UI**（`screens/lobby.js`），而本模式**不依赖本包**（见 `shared/reconModes.js`）—— 包缺席时入口照样要画得出来，所以引擎那一份也必须在。

改图标时两张一起换。

## 已知口径（别当成 bug）

- **「装备负载」的『装备效果 -50%』只算属性那一半**：装备的属性贡献由引擎的 `itemStatMods`（`@battle/mod.js`）给出，战斗侧挂一条补偿 buff 把要减掉的那半个减回去。装备的**触发类**效果（hook / 骑手伤害 / 不死窗口一类）没法这样缩 —— 引擎没有「缩放某一件装备效果」的通道，那部分照旧全额生效。
- **同名负载取最高、不叠加**：联防的一张战场上两名博士选了同一条负载时，按**最强的**那一份生效。
- **倒计时从「被发现的那一刻」起算**：`onEquip` 与每回合开始各判一次，记的到期回合是 `当时回合 + 3`。

## 后续轮次（本包承接）

- 把·重构首领接进**剩下的**试炼回合（12 / 16 与第 20 回合的**首领选择**）：引擎侧的候选表今天只点了第 4 与第 8 回合（`shared/reconModes.js` 的 `RECON_TRIAL_BOSSES`），12 / 16 仍是引擎自己从种子流抽；
- 【重构协议·特训】：学员继承教官技能效果 / 特质 / 天赋 +10% 攻 / 防 / 血，并授予本盟约；
- 盟约与敌人在本模式的数值调整。

## 注意

- 入口与建房在服务端有本地闸：非本机（loopback / 私网）客户端建不了重构模拟房间。
- 本包声明了行为开关 `unequip: "allow"`（装备重构那句「干员的装备可进行拆卸」）—— 这是**包级**声明，装了它的房间在休整期都能拆卸装备。
- 元载荷只在**本模式**的房间闹事：`ctx.recon()` 为 null 时它一个动作都不做（非重构房间照旧）。
