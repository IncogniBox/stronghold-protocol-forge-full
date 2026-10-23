# 15 · AUE 机制规范对照索引（Arknights-Universal-Engine）

> 参考资料的**索引**，不是内容拷贝：AUE 把官方机制写成带编号、带出处的规范条款，正是本项目做数据还原
> （mode-recon / enemy-ext）与行为层时最缺的「有出处」体系。要用某条机制的原文时，按下面的固定版本链接去看。

## 0. 是什么、怎么用

- **来源**：<https://github.com/ArknightsDevs/Arknights-Universal-Engine>（明日方舟通用引擎，非官方同人项目）
- **本索引钉住的版本**：commit `cd765220c7d058e50c94cad949db3f8de7150156`（2026-10-22，v0.1.3）。条款编号一经发布不再改动、不复用，所以指向 commit 的链接可以长期引用。
- **许可口径**：AUE 代码是 GPL-3.0-or-later，本项目同（`app/package.json`）——引用其条款文字、
  按条款核对实现都没有许可障碍；**照抄实现代码**则必须保留版权与许可声明。素材与数据不在其代码许可内（NOTICE.md）。
- **条款格式**（`docs/spec/README.md`）：`### <领域>-<序号> <标题>`，正文末尾写 `- 来源：`——
  要么是数据表字段（`数据：<表>.<字段>`），要么是**带 oldid 的 PRTS 固定版本链接**（页面改了也能找回原文），
  要么是 `推断 INF-xxxx`。测试名里写上它验证的条款号。
- **登记表**（`docs/registry/`）：
  - `inferences.json`——350 条「推断」：官方出处没找到、先按推断实现的规则，注明依据与状态（待查证/已证实/已推翻）；
  - `known-differences.json`——37 条「已知差异」：AUE 与 Stronghold Protocol 结果不同的地方，**每条写明双方做法与原因**。
    这份清单对本项目最有价值——见 §3。

## 1. 规范文件总目录（37 份，全部链接钉在 `cd76522`）

前缀 <https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/> 下：

| 文件 | 内容（条款范围） |
|---|---|
| [numbers.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/numbers.md) | 数值-1~7：十进制小数按写下理解、hypot、整数次幂、sin/cos/atan2、四舍六入五成双、不模拟官方定点误差 |
| [time.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/time.md) | 时间-1~2：30 帧率、秒换算成帧 |
| [battle.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/battle.md) | 帧-1 一帧内顺序、随机-1~2、同步-1~2（状态哈希、快照） |
| [attributes.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/attributes.md) | 属性-1~6：属性公式、修饰器叠加、数值范围、最大生命变化、攻击间隔、生命回复 |
| [field.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/field.md) | 地图-1~4、部署-1~10、撤退-1、费用-1（可部署格、再部署惩罚、各类天赋时机） |
| [body.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/body.md) | 体积-1~5：点/巨型单位所在格、距离、范围按碰撞体 |
| [direction.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/direction.md) | 方向-1~4 |
| [enemies.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/enemies.md) | 出怪-1、移动-1、目标-1（到达目标点）、敌人攻击-1（敌人的普通攻击） |
| [foes.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/foes.md) | **敌能-1~44**：敌人能力逐条规范（钩子、延时爆炸、直击弹道、死亡爆炸、首次攻击、低血强化、直击、掷弹、强击、隐匿、引导、载客、禁锢、**重生**、冲锋、装甲、召唤敌人、畸变生物、全息、战术命令、周围溅射、多目标冰原、**重生造物与补给**、凋亡与死亡之眼、吞噬、哨兵待命、折射、守墓石像、支援光环、攻击回复、静态刚体、普攻附带元素损伤、岁兽残响、受创奔跑、魂灵圣杯、失衡持续伤害、烹泉茶器、断刃范围隐匿） |
| [waves.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/waves.md) | 波次-1~9：结构与动作、时间、结束、隐藏组、随机组、预部署、预置干员、剧情；结束-1 战斗结束 |
| [level.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/level.md) | 关卡-1~8：敌人数据级别与覆写、难度与符文、镜头、关卡自带卡、装置数据 |
| [runes.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/runes.md) | 符文-1~6：座位符文（职业掩码、属性与部署、在场效果、回技力、携带物卡） |
| [devices.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/devices.md) | 装置-1~6 |
| [combat.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/combat.md) | 攻击-1~5：干员攻击、**攻击动作与前摇**、投射物、几率强化、立即攻击 |
| [damage.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/damage.md) | 伤害-1~12：物理/最低/法术/真实/**元素**/基础伤害、结算顺序、伤判效果、抵挡与按来源、扣除生命、生命流失、治疗 |
| [attributes.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/attributes.md)（属性） | 见上 |
| [status.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/status.md) | 状态-1~11：Buff、同名叠加、持续与衰减、周期触发、异常目录、寒冷冻结、免疫、麻痹、阻回静默、恐惧移动、诱导 |
| [targeting.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/targeting.md) | 索敌-1~6：攻击范围格、可选性、干员/敌人目标顺序、嘲讽等级、路径距离 |
| [blocking.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/blocking.md) | 阻挡-1~4：何时被阻挡、阻挡数、解除、**被阻挡的敌人** |
| [paths.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/paths.md) | 寻路-1~3（流场、平滑）、路线-1~6（路线指令、巡逻、消失、被内容移动、绕行） |
| [displacement.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/displacement.md) | 位移-1~5：受力等级、推力、**失衡**、拉力、静态刚体 |
| [skills.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/skills.md) | 技能-1~14：种类、技力、发动、运行与结束、通用效果、行为接口、主动关闭、技能期间范围、说明里的修饰器、费用技能、鼓舞、史尔特尔黄昏、炼金单元、反击/屏障/自晕 |
| [elements.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/elements.md) | 元素-1~5：元素值、元素损伤、爆发与冷却、各元素爆发、当前损伤元素 |
| [operators.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/operators.md) | 干员-1~34：练度、技能等级、特性、天赋（时机分类）、模组、范围表、技力、光环、坚忍、受击与致命、抵挡减伤 |
| [traits.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/traits.md) | 职业-1~35：全部 72 个分支特性逐条、攻击方式（子弹/储能/浮游/回旋）、替身、模组追加 |
| [summons.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/summons.md) | 召唤-1~11：数据、练度、上限、召唤物卡、召唤者离场、内容召唤、异常效果、存在时长、战术点 |
| [spine.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/spine.md) | 骨骼-1~17：Spine 3.8 二进制读取、**战斗用的时间（动画时长与攻击时刻）**、世界变换、曲线、图集、IK/变换/路径约束、裁剪 |
| [render.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/render.md) | 渲染-1~25：单位位置/朝向/深度、大小几何、**动画的选择**、血条、特效数据与播放、**特效与事件**、出入口/部署/死亡特效、傀儡师替身动画 |
| [audio.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/audio.md) | 音频-1~6 |
| [ui.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/ui.md) | 界面-1~40（界面引擎与战斗界面） |
| [hooks.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/hooks.md) | 钩子-1~4：总线、定时器、引擎事件（部署/阵亡/击杀、伤害链、攻击、技能、状态） |
| [mods.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/mods.md) | mod-1~13：清单、版本范围、加载顺序、补丁、结构检查、冲突警告、内容来源、严格解析、**主机的列表与客户端的核对**、外观、命令行、Schema |
| [compat.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/compat.md) | 兼容-1~6：**Stronghold 兼容层**——网格尺寸、映射表与 kit 载入、kit 输入、战斗里的 kit、技能说明、对局里的 kit |
| [constants.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/constants.md) | 常量-1~6：最低伤害比例、我方/敌方碰撞半径、阻挡半径、攻速上下限、移动倍率 |
| [lockstep.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/lockstep.md) | 同步-3~14（帧同步协议，与本项目快照协议无关，备查） |
| [coop.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/coop.md) | 合作-1~9（促融共竞玩法规则，备查） |
| [fortress.md](https://github.com/ArknightsDevs/Arknights-Universal-Engine/blob/cd765220c7d058e50c94cad949db3f8de7150156/docs/spec/fortress.md) | 守御-1~6（堡垒守御模式，备查） |

## 2. 与本项目工作面的对照（哪份条款核对我们的哪块）

| 我们的工作面 | 相关文件 | 代表条款 / 用途 |
|---|---|---|
| **数据还原**（`mode-recon/enemies.json`、`enemy-ext/enemies.json` 官方原值） | level.md、enemies.md、waves.md、runes.md | 关卡-1（敌人数据级别与覆写）、出怪-1、波次-1~2——核对出怪与数值口径 |
| **19 个首领普通版行为层**（`enemy-ext/battle/main.mjs`、`mode-recon/battle/main.mjs` 的 castSkill / SKILL_CLIP_DUR / attackAnim） | foes.md、combat.md、enemies.md | 敌能-18（重生）、敌能-2（钩子）、敌人攻击-1、**攻击-2（攻击动作与前摇）**——技能时长、施法站定、前摇口径的官方依据 |
| **元素损伤**（`dealDamage {type:'element'}` 通道） | elements.md、damage.md | 元素-1~5、伤害-5、伤害-10（生命流失）——损伤值、爆发、凋亡爆发效果 |
| **被阻挡攻击动作**（`anims.attackBlocked` / UF.BLOCKED） | blocking.md | 阻挡-1~4——何时算被阻挡、被阻挡敌人的攻击行为 |
| **forms 形态通道**（9 boss 的 rage/reborn/form2/3） | foes.md、spine.md | 敌能-18/28（重生、重生造物）、骨骼-6（战斗用时间）——形态切换时机与 clip 语义 |
| **渲染/动作口径**（`render/spine.js` windUp/attack/clipPerAttack/wholeLate） | render.md、spine.md、combat.md | 渲染-3（动画的选择）、渲染-11（特效与事件）、骨骼-6、攻击-2——动画选择与打击帧的官方口径。**注意攻击-2 的官方模型**：冷却到 0 即开始攻击动画、伤害落在 OnAttack 帧、间隔比动画短才按比例加速（W = H×I÷D）——即官方是「动画时钟在前、伤害对齐动画」；我们是「伤害 tick 在前、动画压缩追」（前瞻 lead≈0.08s）。长 clip 压缩前摇永远赶不到打击帧，`wholeLate` 整播（打击帧略晚）就是这一模型在视图侧的近似 |
| **伤害/数值公式** | damage.md、numbers.md、attributes.md、constants.md | 伤害-1~7（物理/法术/最低伤害、结算顺序）、数值-6（四舍六入五成双）、常量-1（最低伤害 5%） |
| **索敌** | targeting.md | 索敌-3/5（双方目标顺序）、索敌-4（嘲讽等级）、索敌-6（路径距离） |
| **位移/失衡**（本项目未实现，留待） | displacement.md、direction.md | 位移-1~5——受力等级、推拉、失衡滑行 |
| **召唤物类技能**（浮士德弩炮/霜星冰晶/蔓德拉石柱/黑蛇聚合体等，留待） | summons.md、foes.md、traits.md | 召唤-1~11、敌能-22/28（召唤敌人、重生造物与补给）、职业-14（召唤物阻挡的敌人） |
| **模组体系对照**（workshop 包 / roomMods / 对齐检查） | mods.md、hooks.md | mod-3（加载顺序）、mod-10（**主机的列表与客户端的核对**——与我们的 `welcome.mods` 摘要 + 客户端对齐是同一个问题域）、钩子-1~4（对照我们的 server.battle 钩子） |
| **Stronghold 兼容层**（AUE 跑我们的干员脚本） | compat.md | 兼容-1~6——**看它如何消费我们的 kit**，反过来校对我们脚本接口的隐含约定 |

## 3. 「已知差异」清单里与本项目直接相关的条目

AUE 在 `docs/registry/known-differences.json` 里逐条记录了它与 Stronghold Protocol 结果不同之处（37 条，含双方做法与原因）。
与本项目当前工作直接相关的摘录（完整 37 条去看原文件）：

| id | 条款 | 差异要点 |
|---|---|---|
| DIF-0013 | 敌人攻击-1 | PRTS「状态机」没写同一帧内 MOVE→COMBAT/ATTACK 的先后；**敌人前摇依赖动画数据**（ADR 0014）——即我们 `attackAnim {clip,dur,hit}` 的口径 |
| DIF-0030 | 攻击-2 | ADR 0014：所有单位**按动画出伤害**，冷却到 0 即开始攻击动画；官方写锁定人数的攻击「抬手时选目标、前摇结束造成伤害」 |
| DIF-0031 | 攻击-2 | PRTS 没写敌人攻击时停顿多久；AUE 只在已知前摇期间停下——与我们「施法/攻击站定」的取舍相同 |
| DIF-0016 | 寻路-2 | 平滑是 Stronghold 根据试玩反馈加的，**不是官方规则**；AUE 只实现官方寻路 |
| DIF-0024 | 元素-4 | necrosis 没有官方对应（SP 自注「no official counterpart」），官方第 5 种是 ANGER 狂躁损伤 |
| DIF-0004 | 伤害-1 | 双穿透叠加时公式不同；单穿透时逐位相同 |
| DIF-0018 | 技能-2 | 技力「最小单位为 1 点」；自动回复来自技力冷却槽，就绪判定为剩余冷却 < 10⁻⁵ 秒 |
| DIF-0035 | 攻击-3 | 弹道**脱手时缓存攻击力**（维伊备注），一般规则仍是推断（INF） |

其余（伤判事件优先级 DIF-0007、同名 Buff 排队 DIF-0008、索敌 0.1 比对精度 DIF-0005、麻痹流失 DIF-0021/22、寒冷冻结 DIF-0011 等）在修对应机制时再查。

## 4. 引用格式约定

在本项目的代码注释 / 文档里引用时建议写成：

```
（依据 AUE 敌能-18，PRTS「XX」oldid=xxxx：<要点>）
```

- 条款号指向本索引 §1 的 commit 链接；PRTS oldid 以 AUE 条款正文里标注的为准（先看原文再转引，别只抄这里）。
- AUE 标了 `推断 INF-xxxx` 的条款，转引时要带上「AUE 推断」字样——它自己还没找到官方出处，我们不应当作已证实。
- 发现我们与 AUE 结论不同的地方，建议在对应工作面留一条注释（条款号 + 双方做法 + 谁的依据硬），
  格式对齐它的 `known-differences.json`——这份对拍习惯值得抄。
