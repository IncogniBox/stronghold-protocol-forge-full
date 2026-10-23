# 新增敌人扩展（enemy-ext）

把游戏本体（`data/enemies.json`，249 个敌人）里没有的敌人补进来。`enemies.json` 的记录逐字段照抄官方
enemy_database + enemy_handbook_table（数值、法抗、天赋黑板、技能、图鉴能力文本一律照抄，不另编数值）。

## 内容与引擎扩展点清单

### 1. 敌人数据（`enemies.json`，70 条）

61 个官方首领（塔露拉 / 霜星，"冬痕" / 爱国者 / 特雷西斯，黑冠尊主 / 岁 系列 / AMa-10 系列 / 熔戈者，护王余火 …）
+ 4 个重构模拟基座对应的官方单位（莫菲丝 `enemy_1569_ldevil` / 凝血之刃 `enemy_1186_bldbld` / 瑕 `enemy_2101_dyspll`
/ 大亚当 `enemy_1001_bigbo_2` —— 后三者与莫菲丝同款，数值照 PRTS 官方页）
+ 5 个有官方模型的召唤物（托生莲座 `enemy_2090_skzjbc` / 身形 `enemy_2128_dysuib` / 怨骸 `enemy_2129_dylong` /
敛傲 `enemy_2130_dyswrd` / 空值体 `enemy_2133_shdopl`，数值照 enemy_database，`notCountInTotal` + `lpr: 0` 不占波次也不扣生命）。
模型不在本安装 assets.json 里的首领
由 `art.enemies` 声明包自带的 Spine（见下）。

### 2. 官方战斗特效（`pack.json.fx.manifest` → `assets/fx/`）

**52 个单位**的官方 fx 精确闭包（28 个重构模拟首领基座 + 第 2 批的 11 只 BOSS 与 13 个召唤物/关联单位）：
719 个 prefab + 1105 张贴图 + 258 个 mesh（约 37.6 MB，webp + 半尺寸）。与本机提取（`data/local-fx.json`）
合并、包优先 —— 没有本机提取的玩家也完整。
`assets/fx/` 下的官方素材 (c) Hypergryph / Yostar，仅限已持有游戏本体的玩家本地使用（见 pack.json license）。

### 3. 首领行为层（`pack.json.server.battle` → `battle/main.mjs`）

19 个引擎 KITS 覆盖不到的首领的**普通版本**行为（官方口径；数值只读记录 `skills[].bb` / `talents.bb`，
没有数据处按图鉴给 [ASSUMED] 并在代码点名）：

| 首领 | 行为 |
| --- | --- |
| 梅菲斯特 | 治疗光环（自然回复 ×2）+ 每 bat 治疗最缺血敌方单位 |
| 浮士德 | 登场无敌 150 s + 不可阻挡；致命一击（下一击补 atk×1）；**召唤弩炮（15/30）**——无敌装置，每 5 s 向前射一支 500 物理的弩箭（HP100/Lv5 攻 [ASSUMED]） |
| 塔露拉 | 日冕（ATK×1 法术 AOE）+ 烈焚灼息（递增真伤 DoT）；半血加防加抗（官方数据） |
| 霜星 | 普攻寒冷；冰环 半径2 / 重生 3.3（冻结目标加倍）；**冻结（IceShield）**半径2 随机击倒 2 格（重生 3 格）；**召唤寒潮[重生]** 召源石冰晶（HP100，寒潮 0/15 使周围 2 格寒冷 10 s）；重生 ⇒ 第二形态 |
| 爱国者 | 行军 4 连击；全场攻防强化 aura；投枪；生命献祭 ⇒ 毁灭姿态（`pack.json.forms` 声明 rage 形态 clip 集 Idle_2/Attack_2/Move_2，进姿态发 form fx 切动作） |
| 狂躁异质裂兽 | 登场狂怒（受伤 ×0.5，第二阶段 ×0.4）；普攻二连击；落石（打受伤最多者 ×3 并眩晕 10 s）；≤20% ⇒ 第二阶段 |
| 蔓德拉 | 石之盾（物理/法术 ×0.4）；注目 5/15 **引导 6 s**，每秒 100% 攻击法术 + 攻速 -70%；**石柱 SummonDupilr 15/15**（5 s 自动坍塌，四格 100% 法术 + 1 s 眩晕）；击倒 ⇒ 5 s ⇒ 第二形态（悬浮 + 无敌 + 石之盾脉冲 + 注目 CD 重置 10 s） |
| 血骑士 | 减伤 0.75 / 二形态 0.5；血归（眩晕 + DoT，官方 1 名）；召唤凝血之刃；复活姿态 ⇒ 第二形态（**SummonBldbld2 5/12**）；凝血之刃接触回血 10% |
| "酒神" | 常态隐匿；**【未曾领悟】**物理/法术伤害降低至 30%；普攻附 30%/40% 神经损伤；【戏剧化】延迟 2 s，周围 4 格/8 格 30%/70% 法术 + 40% 神经损伤；重生 20 s ⇒ 第二形态 + 10 s 无敌（半径 +3） |
| "望" | **初始形态**无敌+自缚 40 s；【落】25/25 + 每次部署，落瑕；重生 30 s（期间部署瑕）⇒ 最终形态（无敌 60 s，攻速 +100，3 目标）；瑕激活（1.6 半径）：回血 2%/s、每枚 -20% 受伤（4/10 层）、单体 100% 法术 + 1 s 眩晕 |
| 莫菲丝 | 红线（最远者 10 s DoT + 每线 +25% 攻击）；屏障；重生 ⇒ 第二形态 |
| 凝血之刃 / 瑕 | 召唤物行为（接触回血 / 激活瑕单体攻击） |
| "不死的黑蛇" | 攻击真伤 + 烈焚灼息（50→230/s）；点燃 2 名；引爆（目标 100% 法术 → 灭火 → 四格 100% 法术并重新挂火）；**狂暴循环**：首次死亡 5 s 重生回满 → HP/ATK +50% →【不息恶火】每 2 s 一列火球 ×10 → 28 s 回第一形态 + 15 s 无敌；第二次死亡 5 s → 再放【不息恶火】→ 28 s 退场；狂暴期召唤能量聚合体（HP6000，25 s 自爆四方向 1000 法术 + 烈焚灼息） |
| 奎隆 | **入定**（无敌+自缚，95 s）⇒ **自在**（普攻触发怒目，75/50/25% 强制承三身）⇒ 首次死亡 7.33 s 重生 ⇒ **无忧觉**；尼卢火 25 s/35 s/10 s（存在时奎隆受伤 ×0.8^n，50 s 或回满退场：攻击最高干员 ATK-50% + 3500 法术）；【清火执】触发怒目；【惩五戒】5 连击每击触发怒目；承三身召托生莲座（任一退场即结束） |
| 伊莎玛拉 | 初始形态普攻治疗 3 名；HP<50% 狂暴 ATK+50%；120 SP 变身（HP×0.5 ATK×0.625 DEF×0.3 RES×0.5 移速×0.8 攻击间隔×0.5，3 目标真伤半径 4）；变身形态死亡 5 s 回 2% ⇒ 初始形态 |
| 玻利瓦尔 | 普攻降防（DefReduce.def −100）；火球（未熄之地：生成四格 120% 法术，25 s 内每秒 15% 法术）；击倒 ⇒【灾厄之口】20 s（最高生命者周围 8 格 0.4 真伤 + 其余 0.15 法术）⇒ 形态成长（HP+50%/ATK+20%，再 HP+100%/ATK+30%）；三形态周期起飞 |
| 朔壳 | 暴武闪避（50%，非阻挡者）；**醉生 5/36**（待部署区 +1 张宿傲，上限 8，每张 ATK+30%）；**溯律 10/30**（半径 13 选 宿傲数+1 名我方，各召敛傲定向寻路）；**描躯 20/54**（召身形，在场时朔壳不可被攻击）；被击倒召 2 枚敛傲 [ASSUMED 波次表不在包内] |

技能动作与特效：cast 时发 `['cast', id, slot]` + `['skill', id, 1/0]`（与引擎 helpers.js castSlot 同口径；敌人的
快照不亮 SKILL，动作由 skill 事件驱动），`anims.skills` 的 slot→clip 映射按官方特效名的 `skill_NN` 序号校准。
**动作 ↔ 特效的命中帧对齐（0.2.5）**：技能伤害与那一次 `['atk', …]` 都落在官方 `hits` 帧，并由它触发 fx 计划里的
`hit` 行；不再额外发通用 `explode`（否则会叠两层）。已对齐：塔露拉 日冕 2.567 s / 烈焚灼息 1.0 s；爱国者 投枪 1.7 s；
黑蛇 点燃 1.167 s / 引爆 1.033 s；裂兽 落石 2.2 s；奎隆 惩五戒 0.767/1.3/2/2.367/3.967 s；玻利瓦尔 灾厄之口每跳。
被阻挡时的 Attack_2 走 `render/vfx/wiring.js` 的 `combat` 分支（敌人被阻挡即选 `combat`，与 sim 把这次 atk 标成
arts/phys 无关），因此播的是 `enemy_talula_attack_02_start/hit`。其余带 `hit` 行的官方技能同样按此口径接（审计见
本轮提交说明）。

**技能窗口（0.2.6 → 0.2.8）**：`castSkill` 的 `['skill',1/0]` 改为**引用计数** —— 塔露拉半血后烈焚灼息（7s → 2s 窗口）与
日冕（15s → 3.667s 窗口）会重叠，旧写法先结束的窗口会把还开着的那个关掉，客户端随即回普通攻击（被阻挡 ⇒
Attack_2）顶掉 Skill_2。另施法时写通用时间戳 `e.skillBusyUntil = time + clipDur`：引擎 `server/sim/ai.js`
的 `enemyAttack` 开头会读它，窗口内**根本不进入挥击流程、也不发 `['atk']`**（tick 顺序：`updateEnemy` 在包的
tick 之前跑，只压 `atkCd`/清 `swing` 挡不住同 tick 已起手的那一下）。窗口结束时自然过期，不改其它状态。
**0.2.9**：敌人的技能命中 `atk` 只叠技能自己的 `hit` 行（`skillfx.attackFx` 对 `isEnemy && ownHit` 强制 `replace`，
不再回落到 mode 的 `combat`/`attack`——被阻挡塔露拉的 Attack_2 start/hit 特效就是从这里漏出的）；`spine.js` 对敌人
（`clipPerAttack`）在技能窗口内不重拉技能 clip，Skill_2 不会被命中帧的 `atk` 从第 0 帧重播。

召唤物/装置用 `SUMMON_DEFS` 内联记录（HP/ATK/DEF/RES 照 PRTS 装置页），不进 `enemies.json`、不占波次；`battle.fx('summon'|'explode'|'beam')`
出到达/爆发/射线。

**召唤物模型**（`assets/spine/enemy/<id>/` + `assets/enemy/icon/<id>.png`，`art.enemies` 声明）：
托生莲座 `enemy_2090_skzjbc` / 身形 `enemy_2128_dysuib` / 怨骸 `enemy_2129_dylong` / 敛傲 `enemy_2130_dyswrd` /
空值体 `enemy_2133_shdopl` —— 从本体 `refs/arts/enm_art_*.ab` 的 `Assets/Torappu/Arts/Enemies/Spines/**/<id>_SkeletonData.asset`
导出（`tools/local-extract/extract.py` 的 `export_enemy_spines(ids=…)`，Spine 3.8、atlas 已补 `size:`/`pma:true`）。
「空」`enemy_2132_dyfake` 本体没有模型（官方是隐形占位），弩炮 / 源石冰晶 / 石柱 / 能量聚合体 / 尼卢火是地图装置
（只有 3D 预制体与贴图，没有可用的 Spine），这些在战斗里走头像/占位回退。

**仍未建模的官方子系统**（代码里 [ASSUMED] 点名）：奎隆的波次召唤 / 蔓德拉的破碎支柱与封印的地面 /
“酒神”的摄影机 / “望”的失气与征形态 / 黑蛇对带火单位的 50% 减伤（引擎没有按来源减伤的通道）。

### 3b. 第 2 批首领（2026-10-23，11 只）

数据（10 只原本就在 `enemies.json`，`enemy_2018_csdoll` 伤心的大锁是这次从 `enemy_database` + 图鉴补的）、
模型（`refs/arts/enm_art_*.ab` 提取）、图标（社区转储）、`pack.json.art.enemies` 声明都已齐备；行为层加在本包
`battle/main.mjs` 末尾：

| 首领 | 行为（数值读记录） |
| --- | --- |
| 伤心的大锁 `enemy_2018_csdoll` | 同时攻击 2 个目标；自愈 0.25% 生命/秒；每受 20 次伤害对全场我方 ATK×1.5 法术；60 s 首盾（之后 45 s）开 20 s，屏障期间停止攻击、全场敌人移速 +2、召一只“报幕助手”；召唤序列 24/48/72 s 第一类、110/130/150/170 s 第二类、180 s 起每 16 s 第三类；【Doom】480 s 只发预警 fx |
| “阿米娅”，炉芯终曲 `enemy_2092_skzamy` | 物理/法术伤害 ×0.5；首次半血挂 10 s 无敌；普攻对目标 3×3 追加 ATK×2.5 法术；每 15 s 召唤 fx |
| AMa-10 `enemy_1590_muama` | 不可移动；防火墙固定减伤 90%；同一目标连续攻击逐次 +100 攻击（最多 4 层）；直线信息洪流 3 格首个命中 120 真伤 + 眩晕；每 60 s【刷新】换空位 |
| AMa-10异构体 `enemy_1591_mutwin` | 同上；另一只异构体在场时生命归零 ⇒ 假死（4% 生命起、每秒回 4%），回满复活 |
| “终始” `enemy_1593_musnake` | 减伤 90%；每次生命跌破 20%/40%/60%/80% 回 20% 生命 + 2 s 无敌；每 25 s 随机一名我方 300 真伤 + 眩晕 10 s；998 s【中断】只发 fx |
| 岁 `enemy_1582_suisho` | 每 10 s 抬起（无敌 + 不可选中 + 不动）后对最北我方 ATK×1.8 法术 + ATK×0.45 灼燃，并挂 25 s 持续灼烧（每 0.5 s 法术 + 灼燃） |
| 岁·左爪/右爪 `enemy_1583_suizzh` / `enemy_1584_suiyzh` | 抬起 10 s 后对最东/最西我方 3×3 格块 ATK×2.2 物理 |
| 岁·尾 `enemy_1585_suiwei` | 抬起 10 s 后对最南我方 3×3 格块连续 3 次 ATK×1.1 物理 |
| 洛伦茨，扰动之谬 `enemy_2147_shophm` | 每 30 s 冰盾 3 层；向<源阶方>逐帧靠近，抵达后全场每 0.5 s 200 真伤（3 s）并解除源阶方无敌；被击倒同理解除 |
| 源阶方 `enemy_2148_shorbb` | 初始无敌；减伤 30%；觉醒后每 30 s 召唤源阶粒素、每 8 s（半血 4 s）【失链裂变】全场 ATK×1 法术 |

**第 2 批的召唤物（本包真实记录 + 模型 + 图标）**：
- `enemy_2094_skzamb`「仅剩的创意」（阿米娅，15 s 一只，无攻击）；
- 阿米娅的召唤链（图鉴「触碰昔日道标则释放其中的敌人」）：
  `enemy_2095_skzamf` / `enemy_2096_skzamj` 昔日道标（HP20000，数据自带 `summon.enemy_key = enemy_2065_skzjs`）
  → 创造触碰后原地释放 `enemy_2065_skzjs` 恐卡兹（HP15000，模型 + 图标）→ 恐卡兹出生对周围 3×3 造成 ATK×0.5 法术
  并生成 `enemy_2086_skzdwx` 年代印痕（HP20000，每秒对范围内我方 100 凋亡损伤；`2087_skzdwy` x-2 / `2088_skzdwz` x-4
  是同款不同范围，记录一并补齐）。道标与印痕没有官方 Spine/图标，走客户端占位回退；
- `enemy_10172_sheart`「未熄」（岁·尾击败友方后生成；岁首【十方怼怒】会引爆它，对周围造成法术）；
- `enemy_2149_shorsm`「源阶粒素」（源阶方，常态 1 只 / 半血 3 只；死亡后对 3×3 格块造成 ATK×2 法术）；
- 伤心的大锁的召唤池（PRTS「ISW-DF 别无所求 · 敌人召唤序列」）：
  `enemy_1099_nbkght_2` 无名精锐骑士 / `enemy_1060_emouse_2` 灰尾香主 / `enemy_2011_csppt` 剧场组装体
  （三条记录 + 模型 + 图标），第三类还会用 `data/enemies.json` 已有的 `enemy_1172_dugago_2` 愤怒的守墓石像；
- `enemy_ext_csdoll_aide`「报幕助手」（PRTS TN-3 敌方召唤物页：HP10000 / ATK100 / DEF700 / RES60 / 阻挡 0，
  负嘲讽「不容易受到我方单位的攻击」；光环 = 周围我方攻击力 −30%（最终乘算）+ 每 0.5 s 攻击力 50% 无类型真伤）。

**这 6 只召唤物的素材**（2026-10-23 补齐）：
- 「报幕助手」官方是**装置**而非敌人，模型取自 PRTS 的 `trap_054_dancdol` 骨骼
  （`torappu.prts.wiki/assets/char_spine/trap_054_dancdol/defaultskin/spine/`，Spine 3.8.99）：文件名与 atlas
  的页名改成 `enemy_ext_csdoll_aide.*`、atlas 补 `pma: true`；图标由同一张骨架页的头部裁切。
- 「昔日道标」`enemy_2095_skzamf` / `enemy_2096_skzamj` 与「年代印痕」`enemy_2086_skzdwx` / `_y` / `_z`
  官方**没有可用的 Spine**（客户端 `battle/enm_pfb_20.ab` 里的 prefab 只有 Steering / 动画控制器，没有渲染器；
  PRTS 页也是「该敌人不具有图鉴 / NO IMAGE」）。这两类改用**同系列官方贴图生成的静态 Spine**：道标取
  `special_object_skzamy_01` 的黑红方碑，印痕取 `special_object_skzamy_07` 的年代纹样；骨架是手写的
  Spine 3.8 JSON（单区域 + `Idle`），`pma: false`，`bounds` 按贴图实际尺寸写。

**岁 四部位共享生命**（图鉴「四个部位共享生命值」）：实现在 `installSuiLink` —— 部位受伤先补回自己的血条，
再用 `battle.loseHp(岁, 等量, { sourceless: true, noHitLimit: true })` 转入共享池（与引擎 `content/bosses.js`
的部件传递同一写法）；主体受伤 / 每 tick 把池值同步给四个部位（血条显示同一条血）；主体倒下 ⇒ 部位一起退场，
部位被一击打空 ⇒ 共享池扣到 0。

**阿米娅 ↔ 「仅剩的创意」共享生命**（`installSkzamyLink`，**[ASSUMED]**）：PRTS 的「阿米娅，炉芯终曲」与
「终曲合声」页面都**没有**这一条（她的官方机制是减伤 50% / 半血无敌 / 技力与【存续先兆】/ 重生），本条按业主
要求补、按「创意是她生命的延伸」实现 —— 与岁四部位同一套写法：创意受伤等量转入阿米娅的共享池、血条按最大生命
比例同步；阿米娅倒下 ⇒ 所有创意一起退场。

**第 2 批的未实现 / [ASSUMED]（代码注释同一条）**：
- 伤心的大锁的三类召唤池按 ISW-DF 的**首批组合**取（[ASSUMED]；官方每轮组合随关卡变化，TN-3 的池子是剧场组装体），
  【Doom】扣 30 目标生命（战斗内没有扣 LP 的通道）只发预警 fx；
- 阿米娅的第二形态 /【存续先兆】/【永恒存续】整场脚本；
- AMa-10 的防火墙**逐格**判定读作固定 90% 减伤；【刷新】的「指定地块」没有关卡脚本可读 ⇒ 随机空位；
- 岁四部位由「岁」统一编排（现在各自独立计时）、镇岁柱削弱、【柱折维绝】追加出怪；
- 洛伦茨的【象限封锁】（地形）与扣 30 目标生命；源阶方的<源阶方模块>（无敌人记录）、左右两侧额外减伤、
  `Revive` 复活通道。

**素材来源（第 2 批）**：11 只的 Spine 从本机客户端 `StreamingAssets/AB/Windows/refs/arts/enm_art_*.ab` 提取
（`tools/local-extract/extract.py` 的 `export_enemy_spines(ids=[…])`，Spine 3.8、atlas 已补 `size:` / `pma: true`）；
图标取自 `yuanyan3060/ArknightsGameResource` 的 `enemy/<id>.png`（158×158，与官方敌人的图标同口径）。

### 3c. 第二轮补强（2026-10-23，针对「已实现但仍有缺口」的 boss）

- **莫菲丝【感官的剥离】**：丝线连向场上其他敌人，替她分担受到的伤害（`EnemyLineT.damage_share` 0.65，
  第二形态 `EnemyLineAdvanceT.damage_share` 0.7）；分担按当前场上其他敌人均摊，`battle.loseHp(…, { sourceless: true, noHitLimit: true })`。
- **“望”的形态动作**：开场补 `StartBattle`、进入最终形态补 `SwitchFinalMode` 的 `castSkill`（官方动作与特效；机制本已手写）。
- **“望”的第二形态整场脚本**（PRTS「第二形态」四条）：
  ① 进入第二形态连续部署多枚“瑕”（[ASSUMED] 3 枚）；②【征】全图攻击、最多同时 3 名目标（`base.rangeRadius` 99）；
  ③ 场上“瑕”≥4 枚时，每 5 s 在瑕旁的空地块生成一名敌人（[ASSUMED]，对应「被瑕围住的地块不断生成敌人」）；
  ④ 场上最后一枚“瑕”被击退时，“望”同时退场（最终形态被击倒也不再重生）。
- **阿米娅【吸收】**：`AbsorbSkzamb.range_radius` 0.5 内的「仅剩的创意」被吸收（[ASSUMED] 回 2% 生命上限 + heal fx）。
- **伤心的大锁**：召唤池的 `summon.csdoll_summon[n].duration`（90 / 180 s）现在真正限时（到点退场）；
  `aoetrigger.warning_stack_cnt`（10 层）补了预警 fx，仍满 20 层才爆发。

仍受引擎通道限制、本轮未做（同前）：望/阿米娅的第二形态整场脚本（`DeepBreathS1–S4`）、源阶方的
`Revive/Branch/Suiside/Return`（<源阶方模块>没有敌人记录）、岁的统一编排与【柱折维绝】、洛伦茨的【象限封锁】
（地形）与扣目标生命、大锁 Doom 扣 30 目标生命。

### 4. 引擎侧改动

`tools/local-extract/fx.py` 的 `game_data()` 并入工坊包 `workshop/*/enemies.json`（fx 提取的 used 集合覆盖工坊敌人）。
