# 时装补充包（skin-supplement）— 内容与引擎扩展点清单

本包 `workshop/skin-supplement/` 是一份**纯外观补充包**：给**官方干员**补齐官方时装 —— 立绘 / 头像 /
对局模型一起给，共 **168 名干员 / 264 套**（1.1.0 起覆盖**对局名单**，1.2.0 起再覆盖**自选编队**那一屏，
1.3.0 起收录 2026 年「国家图书馆」联动 3 套，见 §1 与 §8）。
它**不新增任何棋子、盟约、装备或行为**（`content: []`）：装进一局里唯一的可见变化是「干员调配」详情卡右上角与
「自选编队」每一格的时装浮层里多出这些选项，选中即同时替换立绘、头像与对局模型。

- `gameVersion` 0.3.1，`content: []`，无 `server` / 无 `client` / 无 `kits`。
- 素材自带（每套 立绘 + 头像 + Front/Back 模型），`license` 声明为 `GPL-3.0-or-later`；
  《明日方舟》相关美术版权归鹰角网络，工坊素材的授权需自行确认。
- 切换界面由**前置包** `workshop/skin-picker`（客户端面板 `ui/skins.js`）提供，本包与它**零耦合**：
  引擎把 `pack.json.skins` 并进 `assets.skins`，skin-picker 只负责把那几套列出来、把选择发上线。

---

## 0. 概览

| 面 | 内容 |
|---|---|
| 数据面 `content` | `[]`（**不写任何数据文件**） |
| `overrides` | 无 |
| `skins` | **264** 套（**168** 名干员） |
| 素材 `assets/` | 14757 个文件 / 约 529 MB（1.4.0 起含 196 套时装的官方技能 / 攻击特效与 3 套的专属战斗音效；1.4.1 起 528 个模型条目带 `animations` / `events` / `hits` / `bounds` / `pma`） |
| 服务端 / 客户端代码 | 无 |
| 包公告 | 无 |
| 文件数 | 14759（`pack.json` + `README.md` + `assets/**` 14757） |

---

## 1. 这是哪些干员

范围 = **本机所有可选干员**，两个来源，一个不落：

**① 对局名单（`data/chess.json` 的棋子）里的官方干员**（1.1.0 起）—— 去掉两拨：

| 去掉 | 是谁 | 去哪了 |
|---|---|---|
| 各 mod **新增**的棋子 | 28 名（`ave-mujica` 5 / `columbia` 8 / `dossoles` 4 / `rimbilliton` 11） | 各包自己的 `skins`（本包**不重复**声明 —— 同一干员同一套 `id` 撞车会报 `SKIN_COLLISION`） |
| 各 mod **覆盖**的官方棋子 | 8 名（松果 / 星熊 / 诗怀雅 / 水月 / 断崖 / 寒芒克洛丝 / 莱恩哈特 / 溯光星源） | **本来就在本包里**（前 12 套，1.1.0 保留） |

**② 自选编队（`screens/diy.js` 那一屏）可选的干员**（1.2.0 起）—— 自选池的官方 6★ **62 位** + 两阶原型 **15 位**。
自选池的规矩是「**持有的 6★ 且不在合并后的棋子池里**」，所以这 62 位与 ① **完全不重叠**：本机唯一有时装的那 6 位
（黑 / 林 / 假日威龙陈 / 涤火杰西卡 / 霍尔海雅 / 莱伊）正是被 `rimbilliton` / `columbia` / `dossoles` 收成棋子的几位，
因此它们**不在**自选池里 —— 那几个包自己的 `skins` 声明了它们。补 ② 的动机见 `CHANGELOG.md` 0.18.7 末节：
自选编队每一格都挂着时装按钮（槽 `screen.diy.card`），而那一屏今天**一个带时装的干员都没有**，按钮就永远不会出现。

- 本包因此覆盖 **168 名**（① 115 + ② 53）。
- **官方至今没有时装、本包无从补的**：① 里的 **5 名**（凛御银灰、缇缇、凯瑟琳、雪猎、盟约·辅助干员）；② 里的 **9 位**
  新晋干员（赤刃明霄陈、怒潮凛冬、凯尔希·思衡托、望、贝洛内、维伊、可露希尔、机械师、克莱门莎）与 **15 位原型干员**
  （6 名预备干员 + 9 名开发者干员：郁金香 / Sharp / Mechanist / Stormeye / Pith / Touch / Raidian / Misery / 领主·Sharp）
  —— 它们只有默认服装（`#1` / `#2`）。
- **默认服装不算一套**（`#1` / `#2` 就是干员本体素材，官方清单里已有），所以本包只收 `skinId` 里带 `@` 的时装。

---

## 2. 时装清单（`pack.json.skins`，264 套）

`id` 是包内唯一键（`^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$`，即 ≤32 字符）；`name` = 官方 `displaySkin.skinName`；
`series` = 官方 `displaySkin.skinGroupName` 里 `/` 之前那一段。

- `id` 由 `<皮肤组>-<干员短名>` 生成（短名 = `charId` 去掉 `char_<数字>_` 前缀，如 `char_136_hsguma` → `hsguma`）。
- **同一位干员在同一个组里有两套时装**时（本包有 **9 处**：远行前的野餐/后来的故事、诗人的假日/星橼林、青玉砚/染尘烟、皇家近卫/风笛声声、都会送报员/八音蛋匠人、月宵/私人书房、百面郎中/妙手玄心、传承/山川的酿造、濯缨/方遒卷），后来那套的 `id` 追加官方序号（如 `epoque-agoat2` 与 `epoque57-agoat2`）—— 否则 `SKIN_DUPLICATE_ID` 会整包拒绝。

按系列分布（共 32 个系列）：

- **时代**：53 套（复现荣光、远行前的野餐、后来的故事、光耀之途、意志、博物、幽兰秘辛、诗人的假日、星橼林、花冕圆舞曲、幽静、闲适午后、主修领域、除魅、皇家近卫、风笛声声、都会送报员、八音蛋匠人、小憩初醒、读者、伪装、白沙、雪霁、月宵、私人书房、拥抱新生、灵巧侍者、失焦、拾翼、化花、远路、翻涌、礼遇、追悼、层流、注目深渊、甜美配方、清新布景、叙拉古的彼面、卡利斯卡群枪、远行的季节、舒心野趣、今昔须臾之梦、我即潮汐、正义缔造者、恍惚、杰作、识芳、传承、山川的酿造、栖息、记叙、寄自奥格尼斯科）
- **珊瑚海岸**：30 套（夏卉 FA075、悠然假日 HD26、探寻者 SK97、悠然假日 HD08、悠然假日 HD31、探寻者 SKm01、夏卉 FA011、沙滩护卫 GT.001、驭浪 WR04、悠然假日 HD01、夏卉 FA017、静谧午夜 DN06、夏卉 FA661、悠然假日 HD71、悠然假日 HD61、缤纷奇境 CW03、悠然假日 HD91、悠然假日 HDm74、夏卉 FA083、灿阳朝露 SD08、悠然假日 HDm25、日晒 SS.SP、静谧午夜 DN02、夏卉 FA018、夏卉 FA394、夏卉 FA161、夏卉 FA317、温差 RT.RX07、夏卉 FA333、沙滩护卫 GT003）
- **斗争血脉**：20 套（升华、生而为一、典雅噩兆、坚城、先驱、新枝、乌云、无题密令、质素访客、受验者、燃烧天穹下、天穹肇始、返航、残余、歧路幻影、锋潮、审判日、熔锻铸匠、变奏、锋锐）
- **音律联觉**：18 套（律动方格、曙光祝颂、不融冰、黑白冷峻、幻语乐痕、漫步于黄金之梦、漆黑热浪、黑曜石、超然序曲、灿海浮梦、蝶舞华章、繁花梦幻谈、暮星安魂曲、爆裂菲林、晶化信念、飞羽、空心王冠、辉煌的静谧）
- **0011制造**：17 套（廊下游、春竜、青玉砚、染尘烟、愿清晓、富贵荣华、花绸曲、待晴日、岁红霞、百面郎中、妙手玄心、乐逍遥、濯缨、方遒卷、何处栖、春日宴、少年游）
- **忒斯特收藏**：16 套（午夜邮差、众志归一、无序的谦卑、植物种志、铁律、无我唯识、至虔者荣光、轻盈一梦、相位面容、夏日餮宴、时遗、初晴、焦点、彼有、超新星、无息破局）
- **0011**：13 套（抚云间、狩标浪人、与荷、绣云鹤、步芳兰、照寰瀛、撷香霭、捉风、鉴浮生、一闪极意、无拘无束、幻火、行梦侧畔）
- **成就之星**：11 套（新手光环、遗迹游学者、下一个任务、冒险启程、小健将、永恒玩家、蔷薇之谜、绝对主角、血翼蔷薇、至高判决、乱数法则）
- **生命之地**：10 套（野地秘行、荒原行者、四边形、孤攀客、砾瓦、弃土花开、宝藏行家、遗石、北地引路人、字句中的雪原）
- **巫异盛宴**：10 套（盛宴、魔城回响、幻影轻悄、暗月的影子、异月灾裔、易爆蓝焰、挽歌、至圣誓言、手到牌来、命运主宰）
- **冰原信使**：9 套（闪焰之夜、约克的寒风、开斯特之霜、希望巡游、邀雪、霍恩洛厄的寒沙、喜夜侍者、糖果仙子、偶尔醉陶）
- **命途迭代**：7 套（红女爵、破翼者、寻翼之歌、苍茫怒号、夜之终局、趋光之暗、常世之幻）
- **错位巡礼**：6 套（星移、流辉、倾听、真我自扼、沉思之庭、万籁俱寂）
- **寒武纪**：6 套（寒冬信使、夜归人、霜息、暗流、模特之夜、耀目之蓝）
- **玛尔特**：5 套（无际之帆、下一顿午茶、硬派速度、迎风之轮、烈阳街景）
- **三丽鸥家族**：5 套（蒸汽寻踪者、雨霓行游客、绵绒小魔女、坊间凉茶铺、花房茶话会）
- **国家图书馆**：3 套（源远流长、夜行烛火、盛世之象）— 1.3.0 新增，见 §8
- **国家地理**：2 套（霜林醉、崖高梦远）
- **肯德基**：2 套（城市骑手、儿童派对）
- **雷神推进者**：2 套（超载、摧城）
- **罗德厨房**：2 套（甜品大奖、回味冰霜雪）
- **罗小黑战记**：2 套（春之颂、欢唱之前）
- **轻松小熊**：2 套（轻松旅途、常伴我身）
- **闪耀阶梯**：2 套（宣传策略、倾声歌唱）
- **小马宝莉**：2 套（善良坚强之心、率直诚实之人）
- **中国电影资料馆**：2 套（霹雳导演、全能演员）
- **i.t**：2 套（自由//失效、惬意）
- **缠梦古堡**：1 套（梦魇之梦）
- **雷神开拓者**：1 套（漆匠）
- **破格视界**：1 套（链锯陪护者）
- **啸风**：1 套（皇后一号）
- **WWF**：1 套（高原访客）

全表（按 `charId` 排序）：

| `id` | 名字 | 系列 | 干员 |
|---|---|---|---|
| `boc-kalts` | 残余 | 斗争血脉 | 凯尔希 `char_003_kalts` |
| `sale-kalts` | 时遗 | 忒斯特收藏 | 凯尔希 `char_003_kalts` |
| `nian-chen` | 岁红霞 | 0011制造 | 陈 `char_010_chen` |
| `sale-chen` | 初晴 | 忒斯特收藏 | 陈 `char_010_chen` |
| `as-huang` | 爆裂菲林 | 音律联觉 | 煌 `char_017_huang` |
| `witch-huang` | 易爆蓝焰 | 巫异盛宴 | 煌 `char_017_huang` |
| `boc-skadi2` | 升华 | 斗争血脉 | char_1012_skadi2 `char_1012_skadi2` |
| `iteration-skadi2` | 红女爵 | 命途迭代 | char_1012_skadi2 `char_1012_skadi2` |
| `epoque-nearl2` | 复现荣光 | 时代 | char_1014_nearl2 `char_1014_nearl2` |
| `epoque-agoat2` | 远行前的野餐 | 时代 | char_1016_agoat2 `char_1016_agoat2` |
| `epoque57-agoat2` | 后来的故事 | 时代 | char_1016_agoat2 `char_1016_agoat2` |
| `epoque-siege2` | 光耀之途 | 时代 | char_1019_siege2 `char_1019_siege2` |
| `epoque-texas` | 意志 | 时代 | char_102_texas `char_102_texas` |
| `winter-texas` | 寒冬信使 | 寒武纪 | char_102_texas `char_102_texas` |
| `epoque-reed2` | 博物 | 时代 | char_1020_reed2 `char_1020_reed2` |
| `snow-reed2` | 闪焰之夜 | 冰原信使 | char_1020_reed2 `char_1020_reed2` |
| `summer-reed2` | 夏卉 FA075 | 珊瑚海岸 | char_1020_reed2 `char_1020_reed2` |
| `game-kroos2` | 新手光环 | 成就之星 | char_1021_kroos2 `char_1021_kroos2` |
| `nian-kroos2` | 廊下游 | 0011制造 | char_1021_kroos2 `char_1021_kroos2` |
| `boc-ghost2` | 生而为一 | 斗争血脉 | char_1023_ghost2 `char_1023_ghost2` |
| `summer-gvial2` | 悠然假日 HD26 | 珊瑚海岸 | char_1026_gvial2 `char_1026_gvial2` |
| `epoque-texas2` | 幽兰秘辛 | 时代 | char_1028_texas2 `char_1028_texas2` |
| `iteration-texas2` | 破翼者 | 命途迭代 | char_1028_texas2 `char_1028_texas2` |
| `kfc-angel` | 城市骑手 | 肯德基 | char_103_angel `char_103_angel` |
| `sale-angel` | 午夜邮差 | 忒斯特收藏 | char_103_angel `char_103_angel` |
| `wild-angel` | 野地秘行 | 生命之地 | char_103_angel `char_103_angel` |
| `epoque-slent2` | 栖息 | 时代 | 淬羽赫默 `char_1031_slent2` |
| `sale-excu2` | 众志归一 | 忒斯特收藏 | char_1032_excu2 `char_1032_excu2` |
| `sanrio-excu2` | 蒸汽寻踪者 | 三丽鸥家族 | char_1032_excu2 `char_1032_excu2` |
| `ambienceSynesthesia-swire2` | 律动方格 | 音律联觉 | char_1033_swire2 `char_1033_swire2` |
| `nlc-swire2` | 盛世之象 | 国家图书馆 | 琳琅诗怀雅 `char_1033_swire2` |
| `game-wisdel` | 绝对主角 | 成就之星 | 维什戴尔 `char_1035_wisdel` |
| `sale-wisdel` | 超新星 | 忒斯特收藏 | 维什戴尔 `char_1035_wisdel` |
| `sale-whitw2` | 无序的谦卑 | 忒斯特收藏 | char_1038_whitw2 `char_1038_whitw2` |
| `marthe-thorn2` | 无际之帆 | 玛尔特 | char_1039_thorn2 `char_1039_thorn2` |
| `winter-blaze2` | 夜归人 | 寒武纪 | char_1040_blaze2 `char_1040_blaze2` |
| `nlc-blaze2` | 夜行烛火 | 国家图书馆 | 烛煌 `char_1040_blaze2` |
| `iteration-angel2` | 寻翼之歌 | 命途迭代 | char_1041_angel2 `char_1041_angel2` |
| `sightseer-phatm2` | 真我自扼 | 错位巡礼 | 酒神 `char_1042_phatm2` |
| `game-leizi2` | 血翼蔷薇 | 成就之星 | 司霆惊蛰 `char_1043_leizi2` |
| `whirlwind-hsgma2` | 一闪极意 | 0011 | 斩业星熊 `char_1044_hsgma2` |
| `ambienceSynesthesia-sbell2` | 曙光祝颂 | 音律联觉 | char_1046_sbell2 `char_1046_sbell2` |
| `nian-liskam` | 春竜 | 0011制造 | char_107_liskam `char_107_liskam` |
| `striker-liskam` | 超载 | 雷神推进者 | char_107_liskam `char_107_liskam` |
| `sweep-silent` | 漆匠 | 雷神开拓者 | char_108_silent `char_108_silent` |
| `winter-silent` | 霜息 | 寒武纪 | char_108_silent `char_108_silent` |
| `striker-siege` | 摧城 | 雷神推进者 | 推进之王 `char_112_siege` |
| `wild-siege` | 遗石 | 生命之地 | 推进之王 `char_112_siege` |
| `epoque-cqbw` | 恍惚 | 时代 | W `char_113_cqbw` |
| `epoque-shotst` | 诗人的假日 | 时代 | char_126_shotst `char_126_shotst` |
| `epoque28-shotst` | 星橼林 | 时代 | char_126_shotst `char_126_shotst` |
| `epoque-estell` | 花冕圆舞曲 | 时代 | char_127_estell `char_127_estell` |
| `epoque-plosis` | 幽静 | 时代 | char_128_plosis `char_128_plosis` |
| `yun-plosis` | 抚云间 | 0011 | char_128_plosis `char_128_plosis` |
| `kfc-ifrit` | 儿童派对 | 肯德基 | 伊芙利特 `char_134_ifrit` |
| `rilakkuma-ifrit` | 轻松旅途 | 轻松小熊 | 伊芙利特 `char_134_ifrit` |
| `summer-ifrit` | 日晒 SS.SP | 珊瑚海岸 | 伊芙利特 `char_134_ifrit` |
| `nian-hsguma` | 狩标浪人 | 0011 | char_136_hsguma `char_136_hsguma` |
| `summer-hsguma` | 探寻者 SK97 | 珊瑚海岸 | char_136_hsguma `char_136_hsguma` |
| `boc-whitew` | 典雅噩兆 | 斗争血脉 | char_140_whitew `char_140_whitew` |
| `winter-ghost` | 暗流 | 寒武纪 | char_143_ghost `char_143_ghost` |
| `summer-prove` | 悠然假日 HD08 | 珊瑚海岸 | char_145_prove `char_145_prove` |
| `wild-prove` | 荒原行者 | 生命之地 | char_145_prove `char_145_prove` |
| `summer-shining` | 静谧午夜 DN02 | 珊瑚海岸 | 闪灵 `char_147_shining` |
| `wild-snakek` | 四边形 | 生命之地 | char_150_snakek `char_150_snakek` |
| `yun-snakek` | 与荷 | 0011 | char_150_snakek `char_150_snakek` |
| `iteration-crosly` | 夜之终局 | 命途迭代 | 弑君者 `char_1502_crosly` |
| `summer-bldsk` | 悠然假日 HD31 | 珊瑚海岸 | char_171_bldsk `char_171_bldsk` |
| `witch-bldsk` | 盛宴 | 巫异盛宴 | char_171_bldsk `char_171_bldsk` |
| `ambienceSynesthesia-svrash` | 不融冰 | 音律联觉 | char_172_svrash `char_172_svrash` |
| `snow-svrash` | 约克的寒风 | 冰原信使 | char_172_svrash `char_172_svrash` |
| `summer-svrash` | 探寻者 SKm01 | 珊瑚海岸 | char_172_svrash `char_172_svrash` |
| `wild-slchan` | 孤攀客 | 生命之地 | char_173_slchan `char_173_slchan` |
| `wwf-slchan` | 高原访客 | WWF | char_173_slchan `char_173_slchan` |
| `snow-slbell` | 开斯特之霜 | 冰原信使 | char_174_slbell `char_174_slbell` |
| `sightseer-cgbird` | 流辉 | 错位巡礼 | 夜莺 `char_179_cgbird` |
| `witch-cgbird` | 挽歌 | 巫异盛宴 | 夜莺 `char_179_cgbird` |
| `sanrio-amgoat` | 绵绒小魔女 | 三丽鸥家族 | 艾雅法拉 `char_180_amgoat` |
| `summer-amgoat` | 夏卉 FA018 | 珊瑚海岸 | 艾雅法拉 `char_180_amgoat` |
| `daily-flower` | 植物种志 | 忒斯特收藏 | char_181_flower `char_181_flower` |
| `epoque-flower` | 闲适午后 | 时代 | char_181_flower `char_181_flower` |
| `epoque-skgoat` | 主修领域 | 时代 | char_183_skgoat `char_183_skgoat` |
| `boc-helage` | 歧路幻影 | 斗争血脉 | 赫拉格 `char_188_helage` |
| `summer-sunbr` | 夏卉 FA011 | 珊瑚海岸 | char_196_sunbr `char_196_sunbr` |
| `epoque-poca` | 杰作 | 时代 | 早露 `char_197_poca` |
| `rilakkuma-poca` | 常伴我身 | 轻松小熊 | 早露 `char_197_poca` |
| `summer-yak` | 沙滩护卫 GT.001 | 珊瑚海岸 | char_199_yak `char_199_yak` |
| `summer-typhon` | 温差 RT.RX07 | 珊瑚海岸 | 提丰 `char_2012_typhon` |
| `wild-typhon` | 北地引路人 | 生命之地 | 提丰 `char_2012_typhon` |
| `summer-cerber` | 夏卉 FA333 | 珊瑚海岸 | 刻俄柏 `char_2013_cerber` |
| `whirlwind-cerber` | 无拘无束 | 0011 | 刻俄柏 `char_2013_cerber` |
| `cfa-nian` | 霹雳导演 | 中国电影资料馆 | 年 `char_2014_nian` |
| `nian-nian` | 乐逍遥 | 0011制造 | 年 `char_2014_nian` |
| `nian-dusk` | 青玉砚 | 0011制造 | char_2015_dusk `char_2015_dusk` |
| `nian7-dusk` | 染尘烟 | 0011制造 | char_2015_dusk `char_2015_dusk` |
| `ambienceSynesthesia-demkni` | 黑白冷峻 | 音律联觉 | char_202_demkni `char_202_demkni` |
| `boc-demkni` | 坚城 | 斗争血脉 | char_202_demkni `char_202_demkni` |
| `test-demkni` | 铁律 | 忒斯特收藏 | char_202_demkni `char_202_demkni` |
| `ncg-ling` | 崖高梦远 | 国家地理 | 令 `char_2023_ling` |
| `nian-ling` | 濯缨 | 0011制造 | 令 `char_2023_ling` |
| `nian12-ling` | 方遒卷 | 0011制造 | 令 `char_2023_ling` |
| `cfa-chyue` | 全能演员 | 中国电影资料馆 | 重岳 `char_2024_chyue` |
| `nian-chyue` | 何处栖 | 0011制造 | 重岳 `char_2024_chyue` |
| `nian-shu` | 春日宴 | 0011制造 | 黍 `char_2025_shu` |
| `nlc-shu` | 源远流长 | 国家图书馆 | 黍 `char_2025_shu` |
| `nian-yu` | 愿清晓 | 0011制造 | char_2026_yu `char_2026_yu` |
| `boc-gnosis` | 先驱 | 斗争血脉 | char_206_gnosis `char_206_gnosis` |
| `ambienceSynesthesia-mostma` | 幻语乐痕 | 音律联觉 | char_213_mostma `char_213_mostma` |
| `epoque-mostma` | 除魅 | 时代 | char_213_mostma `char_213_mostma` |
| `epoque-bpipe` | 皇家近卫 | 时代 | char_222_bpipe `char_222_bpipe` |
| `epoque40-bpipe` | 风笛声声 | 时代 | char_222_bpipe `char_222_bpipe` |
| `race-bpipe` | 皇后一号 | 啸风 | char_222_bpipe `char_222_bpipe` |
| `nian-haak` | 百面郎中 | 0011制造 | 阿 `char_225_haak` |
| `nian5-haak` | 妙手玄心 | 0011制造 | 阿 `char_225_haak` |
| `winter-gravel` | 模特之夜 | 寒武纪 | char_237_gravel `char_237_gravel` |
| `sale-cello` | 无我唯识 | 忒斯特收藏 | char_245_cello `char_245_cello` |
| `kitchen-mgllan` | 回味冰霜雪 | 罗德厨房 | 麦哲伦 `char_248_mgllan` |
| `ambienceSynesthesia-mlyss` | 漫步于黄金之梦 | 音律联觉 | char_249_mlyss `char_249_mlyss` |
| `boc-mlyss` | 新枝 | 斗争血脉 | char_249_mlyss `char_249_mlyss` |
| `ghost-phatom` | 梦魇之梦 | 缠梦古堡 | 傀影 `char_250_phatom` |
| `sale-phatom` | 焦点 | 忒斯特收藏 | 傀影 `char_250_phatom` |
| `epoque-greyy` | 都会送报员 | 时代 | char_253_greyy `char_253_greyy` |
| `epoque8-greyy` | 八音蛋匠人 | 时代 | char_253_greyy `char_253_greyy` |
| `witch-vodfox` | 魔城回响 | 巫异盛宴 | char_254_vodfox `char_254_vodfox` |
| `yun-vodfox` | 绣云鹤 | 0011 | char_254_vodfox `char_254_vodfox` |
| `epoque-podego` | 小憩初醒 | 时代 | char_258_podego `char_258_podego` |
| `marthe-skadi` | 下一顿午茶 | 玛尔特 | char_263_skadi `char_263_skadi` |
| `summer-skadi` | 驭浪 WR04 | 珊瑚海岸 | char_263_skadi `char_263_skadi` |
| `boc-f12yin` | 乌云 | 斗争血脉 | char_264_f12yin `char_264_f12yin` |
| `epoque-f12yin` | 读者 | 时代 | char_264_f12yin `char_264_f12yin` |
| `marthe-f12yin` | 硬派速度 | 玛尔特 | char_264_f12yin `char_264_f12yin` |
| `boc-excu` | 无题密令 | 斗争血脉 | char_279_excu `char_279_excu` |
| `as-vigna` | 漆黑热浪 | 音律联觉 | char_290_vigna `char_290_vigna` |
| `summer-vigna` | 悠然假日 HD01 | 珊瑚海岸 | char_290_vigna `char_290_vigna` |
| `boc-aglina` | 质素访客 | 斗争血脉 | char_291_aglina `char_291_aglina` |
| `summer-aglina` | 夏卉 FA017 | 珊瑚海岸 | char_291_aglina `char_291_aglina` |
| `boc-thorns` | 锋潮 | 斗争血脉 | 棘刺 `char_293_thorns` |
| `it-thorns` | 惬意 | i.t | 棘刺 `char_293_thorns` |
| `boc-ayer` | 受验者 | 斗争血脉 | char_294_ayer `char_294_ayer` |
| `boc-phenxi` | 审判日 | 斗争血脉 | 菲亚梅塔 `char_300_phenxi` |
| `witch-phenxi` | 至圣誓言 | 巫异盛宴 | 菲亚梅塔 `char_300_phenxi` |
| `game-leizi` | 遗迹游学者 | 成就之星 | char_306_leizi `char_306_leizi` |
| `nian-swire` | 富贵荣华 | 0011制造 | char_308_swire `char_308_swire` |
| `ambienceSynesthesia-mudrok` | 黑曜石 | 音律联觉 | char_311_mudrok `char_311_mudrok` |
| `summer-mudrok` | 静谧午夜 DN06 | 珊瑚海岸 | char_311_mudrok `char_311_mudrok` |
| `wild-mudrok` | 砾瓦 | 生命之地 | char_311_mudrok `char_311_mudrok` |
| `sanrio-lmlee` | 坊间凉茶铺 | 三丽鸥家族 | 老鲤 `char_322_lmlee` |
| `whirlwind-lmlee` | 鉴浮生 | 0011 | 老鲤 `char_322_lmlee` |
| `witch-lmlee` | 手到牌来 | 巫异盛宴 | 老鲤 `char_322_lmlee` |
| `sale-archet` | 至虔者荣光 | 忒斯特收藏 | char_332_archet `char_332_archet` |
| `shining-archet` | 宣传策略 | 闪耀阶梯 | char_332_archet `char_332_archet` |
| `epoque-utage` | 伪装 | 时代 | char_337_utage `char_337_utage` |
| `summer-utage` | 夏卉 FA661 | 珊瑚海岸 | char_337_utage `char_337_utage` |
| `summer-sntlla` | 悠然假日 HD71 | 珊瑚海岸 | char_341_sntlla `char_341_sntlla` |
| `epoque-beewax` | 白沙 | 时代 | char_344_beewax `char_344_beewax` |
| `summer-beewax` | 悠然假日 HD61 | 珊瑚海岸 | char_344_beewax `char_344_beewax` |
| `ambienceSynesthesia-surtr` | 超然序曲 | 音律联觉 | char_350_surtr `char_350_surtr` |
| `it-surtr` | 自由//失效 | i.t | char_350_surtr `char_350_surtr` |
| `summer-surtr` | 缤纷奇境 CW03 | 珊瑚海岸 | char_350_surtr `char_350_surtr` |
| `epoque-lisa` | 雪霁 | 时代 | char_358_lisa `char_358_lisa` |
| `lxh-lisa` | 春之颂 | 罗小黑战记 | char_358_lisa `char_358_lisa` |
| `wild-lisa` | 弃土花开 | 生命之地 | char_358_lisa `char_358_lisa` |
| `sale-saga` | 彼有 | 忒斯特收藏 | 嵯峨 `char_362_saga` |
| `snow-lionhd` | 希望巡游 | 冰原信使 | char_373_lionhd `char_373_lionhd` |
| `wild-lionhd` | 宝藏行家 | 生命之地 | char_373_lionhd `char_373_lionhd` |
| `sanrio-gdglow` | 花房茶话会 | 三丽鸥家族 | 澄闪 `char_377_gdglow` |
| `snow-gdglow` | 喜夜侍者 | 冰原信使 | 澄闪 `char_377_gdglow` |
| `summer-gdglow` | 夏卉 FA394 | 珊瑚海岸 | 澄闪 `char_377_gdglow` |
| `marthe-bubble` | 迎风之轮 | 玛尔特 | char_381_bubble `char_381_bubble` |
| `epoque-mint` | 月宵 | 时代 | char_388_mint `char_388_mint` |
| `epoque30-mint` | 私人书房 | 时代 | char_388_mint `char_388_mint` |
| `epoque-rosmon` | 拥抱新生 | 时代 | char_391_rosmon `char_391_rosmon` |
| `sale-rosmon` | 轻盈一梦 | 忒斯特收藏 | char_391_rosmon `char_391_rosmon` |
| `sightseer-weedy` | 倾听 | 错位巡礼 | 温蒂 `char_400_weedy` |
| `snow-weedy` | 糖果仙子 | 冰原信使 | 温蒂 `char_400_weedy` |
| `ambienceSynesthesia-irene` | 飞羽 | 音律联觉 | 艾丽妮 `char_4009_irene` |
| `game-irene` | 至高判决 | 成就之星 | 艾丽妮 `char_4009_irene` |
| `winter-etlchi` | 耀目之蓝 | 寒武纪 | char_4010_etlchi `char_4010_etlchi` |
| `whirlwind-lessng` | 幻火 | 0011 | 止颂 `char_4011_lessng` |
| `epoque-kjera` | 灵巧侍者 | 时代 | char_4013_kjera `char_4013_kjera` |
| `witch-kazema` | 幻影轻悄 | 巫异盛宴 | char_4016_kazema `char_4016_kazema` |
| `epoque-vulpis` | 失焦 | 时代 | char_4026_vulpis `char_4026_vulpis` |
| `epoque-forcer` | 拾翼 | 时代 | char_4036_forcer `char_4036_forcer` |
| `epoque-horn` | 化花 | 时代 | char_4039_horn `char_4039_horn` |
| `lxh-rockr` | 欢唱之前 | 罗小黑战记 | char_4040_rockr `char_4040_rockr` |
| `ambienceSynesthesia-lumen` | 灿海浮梦 | 音律联觉 | char_4042_lumen `char_4042_lumen` |
| `sanrio-lumen` | 雨霓行游客 | 三丽鸥家族 | char_4042_lumen `char_4042_lumen` |
| `boc-ebnhlz` | 变奏 | 斗争血脉 | 黑键 `char_4046_ebnhlz` |
| `witch-doroth` | 命运主宰 | 巫异盛宴 | 多萝西 `char_4048_doroth` |
| `summer-akkord` | 悠然假日 HD91 | 珊瑚海岸 | char_4051_akkord `char_4051_akkord` |
| `summer-malist` | 悠然假日 HDm74 | 珊瑚海岸 | char_4054_malist `char_4054_malist` |
| `wild-bgsnow` | 字句中的雪原 | 生命之地 | 鸿雪 `char_4055_bgsnow` |
| `yun-bgsnow` | 行梦侧畔 | 0011 | 鸿雪 `char_4055_bgsnow` |
| `sightseer-pepe` | 星移 | 错位巡礼 | char_4058_pepe `char_4058_pepe` |
| `epoque-mlynar` | 远路 | 时代 | char_4064_mlynar `char_4064_mlynar` |
| `iteration-mlynar` | 苍茫怒号 | 命途迭代 | char_4064_mlynar `char_4064_mlynar` |
| `epoque-judge` | 记叙 | 时代 | 斥罪 `char_4065_judge` |
| `snow-judge` | 偶尔醉陶 | 冰原信使 | 斥罪 `char_4065_judge` |
| `ambienceSynesthesia-ironmn` | 空心王冠 | 音律联觉 | 白铁 `char_4072_ironmn` |
| `summer-ironmn` | 沙滩护卫 GT003 | 珊瑚海岸 | 白铁 `char_4072_ironmn` |
| `epoque-haini` | 翻涌 | 时代 | char_4079_haini `char_4079_haini` |
| `epoque-qiubai` | 礼遇 | 时代 | char_4082_qiubai `char_4082_qiubai` |
| `ncg-qiubai` | 霜林醉 | 国家地理 | char_4082_qiubai `char_4082_qiubai` |
| `ambienceSynesthesia-ines` | 蝶舞华章 | 音律联觉 | char_4087_ines `char_4087_ines` |
| `boc-ines` | 燃烧天穹下 | 斗争血脉 | char_4087_ines `char_4087_ines` |
| `sightseer-hodrer` | 沉思之庭 | 错位巡礼 | 赫德雷 `char_4088_hodrer` |
| `epoque-vvana` | 寄自奥格尼斯科 | 时代 | 薇薇安娜 `char_4098_vvana` |
| `summer-caper` | 夏卉 FA083 | 珊瑚海岸 | char_4100_caper `char_4100_caper` |
| `snow-harold` | 邀雪 | 冰原信使 | char_4114_harold `char_4114_harold` |
| `witch-blkkgt` | 暗月的影子 | 巫异盛宴 | char_4116_blkkgt `char_4116_blkkgt` |
| `nian-zuole` | 少年游 | 0011制造 | 左乐 `char_4121_zuole` |
| `sale-zuole` | 无息破局 | 忒斯特收藏 | 左乐 `char_4121_zuole` |
| `yun-grabds` | 步芳兰 | 0011 | char_4122_grabds `char_4122_grabds` |
| `iteration-ascln` | 趋光之暗 | 命途迭代 | 阿斯卡纶 `char_4132_ascln` |
| `ambienceSynesthesia-logos` | 辉煌的静谧 | 音律联觉 | 逻各斯 `char_4133_logos` |
| `epoque-cetsyr` | 追悼 | 时代 | char_4134_cetsyr `char_4134_cetsyr` |
| `epoque-udflow` | 层流 | 时代 | char_4137_udflow `char_4137_udflow` |
| `breaker-narant` | 链锯陪护者 | 破格视界 | 娜仁图亚 `char_4138_narant` |
| `littlePony-narant` | 率直诚实之人 | 小马宝莉 | 娜仁图亚 `char_4138_narant` |
| `game-papyrs` | 下一个任务 | 成就之星 | char_4139_papyrs `char_4139_papyrs` |
| `epoque-ulpia` | 注目深渊 | 时代 | char_4145_ulpia `char_4145_ulpia` |
| `ambienceSynesthesia-nymph` | 繁花梦幻谈 | 音律联觉 | char_4146_nymph `char_4146_nymph` |
| `epoque-nymph` | 甜美配方 | 时代 | char_4146_nymph `char_4146_nymph` |
| `nian-philae` | 花绸曲 | 0011制造 | char_4148_philae `char_4148_philae` |
| `sale-tinman` | 相位面容 | 忒斯特收藏 | char_4151_tinman `char_4151_tinman` |
| `boc-zumama` | 熔锻铸匠 | 斗争血脉 | 森蚺 `char_416_zumama` |
| `game-rosesa` | 冒险启程 | 成就之星 | char_4163_rosesa `char_4163_rosesa` |
| `boc-monstr` | 锋锐 | 斗争血脉 | Mon3tr `char_4179_monstr` |
| `epoque-tippi` | 清新布景 | 时代 | char_4191_tippi `char_4191_tippi` |
| `ambienceSynesthesia-lemuen` | 暮星安魂曲 | 音律联觉 | char_4193_lemuen `char_4193_lemuen` |
| `boc-rmixer` | 天穹肇始 | 斗争血脉 | char_4194_rmixer `char_4194_rmixer` |
| `game-radian` | 乱数法则 | 成就之星 | 电弧 `char_4195_radian` |
| `yun-reckpr` | 照寰瀛 | 0011 | char_4196_reckpr `char_4196_reckpr` |
| `game-flamtl` | 小健将 | 成就之星 | char_420_flamtl `char_420_flamtl` |
| `iteration-haruka` | 常世之幻 | 命途迭代 | 遥 `char_4202_haruka` |
| `sightseer-mantra` | 万籁俱寂 | 错位巡礼 | 真言 `char_4204_mantra` |
| `yun-branch` | 撷香霭 | 0011 | char_4207_branch `char_4207_branch` |
| `littlePony-blemsh` | 善良坚强之心 | 小马宝莉 | char_423_blemsh `char_423_blemsh` |
| `witch-blemsh` | 异月灾裔 | 巫异盛宴 | char_423_blemsh `char_423_blemsh` |
| `snow-billro` | 霍恩洛厄的寒沙 | 冰原信使 | char_426_billro `char_426_billro` |
| `summer-billro` | 灿阳朝露 SD08 | 珊瑚海岸 | char_426_billro `char_426_billro` |
| `epoque-vigil` | 叙拉古的彼面 | 时代 | char_427_vigil `char_427_vigil` |
| `whirlwind-fartth` | 捉风 | 0011 | char_430_fartth `char_430_fartth` |
| `epoque-ashlok` | 卡利斯卡群枪 | 时代 | char_431_ashlok `char_431_ashlok` |
| `game-mizuki` | 永恒玩家 | 成就之星 | char_437_mizuki `char_437_mizuki` |
| `sale-mizuki` | 夏日餮宴 | 忒斯特收藏 | char_437_mizuki `char_437_mizuki` |
| `epoque-pinecn` | 远行的季节 | 时代 | char_440_pinecn `char_440_pinecn` |
| `shining-pinecn` | 倾声歌唱 | 闪耀阶梯 | char_440_pinecn `char_440_pinecn` |
| `epoque-aroma` | 舒心野趣 | 时代 | char_446_aroma `char_446_aroma` |
| `ambienceSynesthesia-necras` | 晶化信念 | 音律联觉 | 死芒 `char_450_necras` |
| `summer-necras` | 夏卉 FA161 | 珊瑚海岸 | 死芒 `char_450_necras` |
| `nian-indigo` | 待晴日 | 0011制造 | char_469_indigo `char_469_indigo` |
| `epoque-pasngr` | 今昔须臾之梦 | 时代 | char_472_pasngr `char_472_pasngr` |
| `boc-glady` | 返航 | 斗争血脉 | char_474_glady `char_474_glady` |
| `epoque-glady` | 我即潮汐 | 时代 | char_474_glady `char_474_glady` |
| `epoque-sleach` | 识芳 | 时代 | 琴柳 `char_479_sleach` |
| `summer-sleach` | 夏卉 FA317 | 珊瑚海岸 | 琴柳 `char_479_sleach` |
| `epoque-pallas` | 传承 | 时代 | 帕拉斯 `char_485_pallas` |
| `epoque19-pallas` | 山川的酿造 | 时代 | 帕拉斯 `char_485_pallas` |
| `marthe-humus` | 烈阳街景 | 玛尔特 | char_491_humus `char_491_humus` |
| `game-vendla` | 蔷薇之谜 | 成就之星 | char_494_vendla `char_494_vendla` |
| `epoque-wildmn` | 正义缔造者 | 时代 | char_496_wildmn `char_496_wildmn` |
| `kitchen-inside` | 甜品大奖 | 罗德厨房 | char_498_inside `char_498_inside` |
| `summer-inside` | 悠然假日 HDm25 | 珊瑚海岸 | char_498_inside `char_498_inside` |
每套的 `art` 与 `art.chars` **同形**（同一个解析器），三件一起给：

```json
"art": {
  "avatar":   "skin/op/<charId>/<model>/avatar.png",
  "portrait": "skin/op/<charId>/<model>/portrait.png",
  "spine": {
    "front": { "skel": "…/front/<model>.skel", "atlas": "…/front/<model>.atlas",
               "textures": ["…/front/<model>.png"], "pma": false,
               "anims": { "idle": "Idle", "…": "…" },
               "animations": { "Attack": 1, "Idle": 4, "…": "…" },
               "events": ["OnAttack", "OnStart"],
               "hits": { "Attack": [0.3] },
               "bounds": { "x": 0, "y": 0, "width": 0, "height": 0 } },
    "back":  { "…": "…" }
  }
}
```

- `<model>` = `<charId>_<皮肤组>_<序号>`（如 `char_136_hsguma_nian_3`，就是官方 `portraitId`
  `char_136_hsguma#3` 把 `@` / `#` 换成 `_`）—— 上游立绘 / 头像 / 模型目录与文件名都用它。
- `anims`（动作角色表）由项目 Spine 管线（`tools/assets/skel.mjs` 的 `parseSkel` +
  `tools/assets/anim-roles.mjs` 的 `resolveRoles`）**对真实 `.skel` 实测生成**，不是手抄。
- `animations` / `events` / `hits` / `bounds` / `pma`（1.4.1 起）同样由 `parseSkel` 实测：
  少了它们，皮肤模型的攻击命中帧（`hits`，特效落点与挥击同步）、每段 clip 的时长（`animations`，
  攻击循环缩放 / 死亡时长）与包围盒（`bounds`）都会退回通用近似 —— 表现就是「动作节奏不对、命中特效不跟手」。
  引擎的 `shared/workshop.js` 早已放开这五个字段（`ART_SPINE_PASSTHROUGH`），包只要带上来即可。

---

## 3. 素材

| 面 | 来源 | 落盘 |
|---|---|---|
| 时装立绘（半身） | `yuanyan3060/ArknightsGameResource` → `portrait/<portraitId>.png` | `skin/op/<charId>/<model>/portrait.png` |
| 时装头像 | 同上 → `avatar/<portraitId>.png` | `skin/op/<charId>/<model>/avatar.png` |
| 时装模型 | `fexli/ArknightsResource` → `spine/<charId>/<model>/<Front·Back·Spine>/<model>.{skel,atlas,png}` | `skin/op/<charId>/<model>/{front,back}/…` |
| 时装元数据 | `Kengxxiao/ArknightsGameData` → `zh_CN/gamedata/excel/skin_table.json` | 只用于生成 `skins[]` 的 `id` / `name` / `series` |

- **尺寸基线**：立绘 **180×360**、头像 **180×180**（上游 `portrait/`、`avatar/` 直接就是这个尺寸，不需要裁）。
- **Spine 基线**：源码统一 **3.8.99**；`.atlas` 与 `.skel` 同目录同名（pixi-spine 靠换后缀找 atlas）；
  atlas 经 `tools/assets/atlas.mjs` 的 `normalizeAtlas` 归一化（上游缺 `size:` 行会让 pixi-spine 除以 0，
  已统一补上）；atlas 里的页面名与落盘贴图文件名逐字一致；`pma` 为假（atlas 不带 `pma: true`）。
- **两种上游模型目录**都要认：老时装是 `<model>/{Front,Back}/`，新时装只有 `<model>/Spine/`（5 套命中后者）。
  两种情形加一起，本包有 **6 套**的 `back` 指向 `front` 的同一批文件 —— 与「只有一侧时用那一侧顶上」的既有做法
  一致（其中 1 套是 Back 骨架读不了，见 §5）。
- 引擎经 `/workshop-assets/skin-supplement/<rel>` 提供这些素材；CDN 上则落在 `packs/skin-supplement/<rel>` 命名空间
  （见 `app/server/http/static.js`）。本包**复用了官方干员 id**，因此**必须**走 `packs/` 命名空间，
  不能落进 `/assets/…`（会撞上游同名键）。

---

## 4. 引擎侧的契约（声明完即生效，本包零接线）

| 环节 | 引擎位置 | 本包怎么用 |
|---|---|---|
| 声明归一化 | `shared/workshop.js` 的 `parseArtEntry` / `SKIN_FIELDS` | `skins[].art` 复用 `art.chars` 的字段白名单（`avatar` / `avatarE2` / `portrait` / `portraitE2` / `spine`） |
| 并进清单 | `shared/workshop.js` 的 `mergeWorkshopSkins` | `skins` → `assets.skins[<charId>] = [{ pack, id, name, series, art }]`，路径转成 `/workshop-assets/skin-supplement/<rel>`；`assets` 进「被触及文件」，随合并结果送达客户端 |
| 立绘 / 头像替换 | `public/js/ui/portraitChain.js` 的**步骤 0** | 读本机换装选择（`appearancePickFor`），命中就返回 `art.portrait` / `art.avatar`；调用方点名精锐（`_2` / `isGolden`）时不打扰它 |
| 对局模型替换 | `public/js/render/units.js` → `portraitChain.js` 的 `appearanceSpineFor` | 按 `ownerId` 取本人 / 同房座位的选择，拿 `art.spine.front`（`back` 优先，缺则回 `front`） |
| 选择与广播 | `room.appearance`（`shared/protocol.js`） | 由 skin-picker 写本机偏好并广播；引擎记 `ownAppearance` / `peerAppearance`，本包不参与 |
| 冲突 | `SKIN_COLLISION` | 同一干员同一 `id` 被两个包声明时按包 id 升序**第一个赢** —— 本包与各玩法包的 `id` 家族完全不重叠（`<组>-<干员短名>` vs `avemujica-…` / `dos-…` 等） |

> 本包**没有**改任何引擎文件：上面每一格都是既有通道，`pack.json.skins` 是它们唯一的入口。

---

## 5. 范围与不含的东西

- **不含**：任何棋子 / 盟约 / 装备 / 特质 / 策略 / 语音 / 召唤物；`content: []`，无 `server` / `client` / `kits`。
- **不含**：mod 新增干员的时装（那属于各自包，见 `ave-mujica` / `columbia` / `dossoles` / `rimbilliton` 的 `skins`）。
- **不含**：上面那 5 名尚无官方时装的干员；溯光星源（`char_1047_halo2`）也在其中。
- **已知取舍**：`char_103_angel@kfc#1` 的 **Back** 骨架是上游较新的格式（`parseSkel` 读不了，
  与引擎其余地方同一套 Spine 3.8 运行时），该套的 `back` 因此指向 `front` —— 模型仍出得来，只是背面用正面那一套。

---

## 6. 目录结构

```
workshop/skin-supplement/
├── pack.json                      # 包声明（content: [] / skins: 264 套 / license）
├── README.md
└── assets/skin/op/<charId>/<model>/
    ├── portrait.png               # 180×360
    ├── avatar.png                 # 180×180
    ├── front/<model>.{skel,atlas,png}
    └── back/<model>.{skel,atlas,png}    # 只有一侧的那几套里，back 指向 front 的同一批文件
```

共 **168** 个干员目录、**264** 个 `<model>` 子目录，2094 个文件（2026-10-19 复测：2094 个文件 / 约 326 MB）。

---

## 7. 复现 / 刷新

素材抓取走 `stronghold-add-skin` 技能的那套流程（`yuanyan` 立绘头像 + `fexli` 模型，atlas 归一化与动作角色表
复用 `tools/assets/*.mjs`）。本机实测的源可用性（2026-10-16）：

- **上游 GitHub raw 直连在本机不通**（每次请求都以 502 收尾），必须走镜像：立绘 / 头像走 **jsDelivr**
  （`https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>/<path>`，文件名里的 `#` 必须 `encodeURIComponent`），
  模型走 **`https://gh-proxy.com/`** —— fexli 那个仓库体积太大，**jsDelivr 拒发**（对它每个路径都回 404）。
  备用的同形镜像：**`https://ghfast.top/`** 与 **`https://ghproxy.net/`**（1.2.0 实测三源都能 200，可互为替补）。
- 镜像会**限流（403）**，所以每文件要重试；把「全部源都失败」与「真的 404」分开记，否则会把限流误判成缺素材
  （实测：一次探测里 `char_1012_skadi2` 的两套模型被判「缺」，换个时刻再取就是 200）。
- **模型目录形态**：`spine/<charId>/<model>/<Front|Back|Spine>/<model>.{skel,atlas,png}`。三件文件在**同一层**，
  拼 URL 时别把 `<model>` 再拼一遍（`…/Front/<model>/<model>.png` 是错的，`.skel` / `.atlas` 与贴图都要落在
  `…/Front/<model>.{skel,atlas,png}`）—— 这是 1.2.0 抓取时踩过的坑：贴图路径多了一层，表现是贴图全 404、
  而 `.skel` / `.atlas` 正常。

刷新后按既有纪律校验：

```powershell
cd <APP>            # app 目录
node tools/workshop-validate.mjs workshop     # 必须 0 error
node server/index.js                          # 重启（pack.json 的合并发生在启动期）
```

---

## 8. 1.3.0 新增：2026「国家图书馆」联动（3 套）

来源：PRTS [时装回廊](https://prts.wiki/w/%E6%97%B6%E8%A3%85%E5%9B%9E%E5%BB%8A)「按发布顺序」里**页面最上面那一组
`Y-7 18`** —— 该页按发布顺序**倒序**排列（`Y-7 18` → `Y-7 01` → `Y-6 35` → …），所以这一组就是最新一版；
它恰好是 **3 套**，全部为 2026 年**国家图书馆（NLC）合作款**（官方 `displaySkin.skinGroupId = 2026#nlc`、
`skinGroupName = 国家图书馆`、`displayTagId = 联动获得`、`getTime = 1792137600` ≈ 2026-10-15）。
它们也是上次刷新（1.2.0）之后才出的三套。

| `id` | 名字 | 干员 | `charId` | 官方 `skinId` / `portraitId` | `<model>` |
|---|---|---|---|---|---|
| `nlc-shu` | 源远流长 | 黍 | `char_2025_shu` | `char_2025_shu@nlc#1` / `char_2025_shu_nlc#1` | `char_2025_shu_nlc_1` |
| `nlc-blaze2` | 夜行烛火 | 烛煌 | `char_1040_blaze2` | `char_1040_blaze2@nlc#1` / `char_1040_blaze2_nlc#1` | `char_1040_blaze2_nlc_1` |
| `nlc-swire2` | 盛世之象 | 琳琅诗怀雅 | `char_1033_swire2` | `char_1033_swire2@nlc#1` / `char_1033_swire2_nlc#1` | `char_1033_swire2_nlc_1` |

- 立绘 / 头像 **180×360 / 180×180**（`yuanyan3060/ArknightsGameResource` → `portrait/`、`avatar/`，文件名里的 `#`
  已 `encodeURIComponent`）；模型走 `fexli/ArknightsResource` 的
  `spine/<charId>/<model>/{Front,Back}/<model>.{skel,atlas,png}`（与 §7 的目录形态一致）。
- 三套**都有 Back 侧**，不需要「`back` 指向 `front`」那套兜底。
- `atlas` 经 `normalizeAtlas` 归一化补了 `size:` 行（`pma: false`）；`anims` 由 `parseSkel` + `resolveRoles`
  从真 skel 实测（Front 15 / 16 / 11 条动画，Back 14 / 15 / 10 条），不是手抄。
- `charId` 与官方 `skin_table.json` 一致：`char_1040_blaze2`（烛煌）、`char_1033_swire2`（琳琅诗怀雅）在
  `data/chess.json` 里能对上（`chess_char_5_03` / `chess_char_3_04`）；`char_2025_shu`（黍）**不在** `chess.json`
  （属 §1 的 ② 自选编队池，与既有 `nian-shu` 用同一个 `charId`）。
- 追加方式：只往 `pack.json.skins[]` 末尾**追加 3 条**（`id` 家族 `nlc-…` 与本包/各玩法包都不重叠），
  既有的 261 套一字未动；`version` 1.2.0 → **1.3.0**。

---

## 9. 1.4.0 新增：时装自己的技能 / 攻击特效与战斗音效（196 套 + 3 套音效）

业主：「把游戏中除了 mod 新增的干员以外的其他所有干员的皮肤特效补上」「还有皮肤的技能和攻击特效」。

### 9.1 取证

官方客户端把一套时装的战斗特效放在**同一批** attle/prefabs/effects/<短名>.ab 里，命名 =
「默认特效 key + `_<时装 id 去掉 <charId>_ 前缀>`」，例如 `gdglow_skill_02_start_01_sanrio#1`。本包 264 套里
**196 套**有这种变体（共 3260 个 key，闭包后 3469 个 prefab）；剩下的 68 套官方没做变体，穿上去照旧播默认特效。

- 时装自己的**挂载点**（Muzzle / HitPoint / SpecialPoint…）在 `skinpack/<charId>.ab` 的
  `<charId>_<group>#<n>` prefab 里，与默认皮肤**不共用**（武器位置不同）。
- **专属战斗音效**只有 41 个文件（47.5 MB），按「基础文件名 + `_<后缀>`」命名；能对上本包干员既有音效键的
  只有 **3 套**：`sanrio-gdglow`（攻击 / 命中）、`sanrio-amgoat`（攻击 / S3）、`sanrio-excu2`（攻击 / S1–S3）。
  其余文件属于不在本包名单里的干员，不收（data/assets.json 里没有它们的键，收了也没有消费端）。

### 9.2 本包落了什么

- `assets/fx/prefabs` 3469 个（118.9 MB，走提取器自己的 `fx_file()`：`#` → `_` + CRC32 尾号）、
  `assets/fx/tex` 3942 张（含半尺寸，66.7 MB）、`assets/fx/mesh` 1334 个（11.3 MB）。
- `assets/fx/index.json`：**196 条 `skins[<模型 stem>]`**，每条带 `source`（`skinpack/<charId>.ab <时装 id>`）、
  `graphic`、`points`（该时装自己的挂载点）与 `fx`（特效 key 后缀）；`prefabs` 是这 3469 个的摘要。
- `assets/fx/manifest.json` + `pack.json.fx.manifest`：按 `docs/WORKSHOP.md` §1.19.2 的包自带特通道分发；
  与本机提取的那一份**深度合并、包优先**。
- `assets/audio/sfx/skins` 8 个 wav（`#` 换成 `_` 以保持 URL 合法），并在三套时装的
  `pack.json.skins[].sfx` 里声明 `attack` / `hit` / `skills` / `attacks`。

### 9.3 引擎那一环

- **视觉**：`render/vfx/wiring.js` 的 `skins[<stem>].fx` 变体解析（2026-10-18 颂乐人偶那批起）——本包把官方那
  196 套的 `fx` 后缀与挂载点补上；**1.4.1 起命中 / 目标类特效按「特效的主人」（施放者 / 攻击者）解析**（`playOn` 的
  `fxOwner`）：命中挂在被击中的敌人身上播，但 prefab 属于攻击者的时装 —— 从前按目标解析，皮肤自己的命中变体永远
  播不出来；链式弹跳（`_bounce`）、浮游单位（`funnelfx`）、天赋命中行与技能绑定投影（`_bound`）同样按主人解析。
  **多段控制器**（余 S3 的火墙 `yu_skill3_range_01_source` / root / 横竖 / 端头）也逐段换成这套时装的变体
  （`yuwall.js`）：从前 `playOn` 在认控制器之前就把 key 换成了 `_<fx>`，穿时装时火墙认不出来；而且**变体 source 的
  `refs` 与 `_effectEachGrid` 仍指基础 root**，基础 root 的 `refs` 只带基础段 —— 变体 root / 段一个都不会被预载。
  `YuWall` 因此在 `def(root)` 缺失时自己 `lib.preload` 解析后的 root（顺着它的 `refs` 把整套变体段装上），下一帧再搭。
- **动作**：模型条目的 `anims` / `animations` / `events` / `hits` / `bounds` / `pma` 全部来自 `parseSkel` 实测
  （1.4.1 起补上后五个）；缺 `hits` 时攻击命中帧退回通用近似，缺 `animations` 时循环 / 死亡时长与攻击节奏都按默认值
  —— 表现就是「动作和命中特效不跟手」。
- **音效**（2026-10-23，本次新增）：`SKIN_FIELDS` 多一格 `sfx`（与 `art.units` 的音效条目**同一个解析器**）、
  `mergeWorkshopSkins` 把它按 URL 转进 `assets.skins[charId][]`、`assets.js unitSfxUrl(…, skinId)` 先问这套
  时装的 `sfx`、缺哪一格落回干员本体；`audio.js unit()` 的 `_track` 记住 `UnitInfo.skin` 并随
  攻击 / 命中 / 技能三个事件传下去。
- 回落不变：没有这套时装、或这套没带 `sfx` / 没有 `fx` 条目时，行为与 1.3.0 逐字相同。
