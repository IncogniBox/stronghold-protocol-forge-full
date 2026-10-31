# 更新记录

**这一份 = 索引 + 最近 8 节；更早的按大版本分卷在 [`docs/changelog/`](docs/changelog/)。**

切点**由公告定，不由体积定**：`server/notices.js` 的 `engineAnnouncements` 从**本文件**生成游戏内公告 ——
它认「`## <版本> — <日期>`」的节、取**前 8 条**能展示的，所以**顶层留的节数就是公告的条数**。实测（当前解析器）：
留 1 节 → 1 条公告、留 7 节 → 7 条、**留 8 节 → 8 条**（上限就是 8）；**再往下切就静默少发公告**，
所以顶层至少要有 8 节。`0.16.0` 那一节是已发布事实，**原样留在原位、一字不改**。

---

**账号、好友、成就、名片背景、联邦目录与匹配人数全部启用：账号沿用 `server-ext` 已有的 `accounts.json`，引擎 UI 通过它的 `/mod-ws/server-ext/accounts` 读取资料，不迁移、不改写现有账号。**

`APP_VERSION`（`0.19.1`）与 `PROTOCOL_VERSION`（`2`）未动；新增 C2S `room.card` 与 `room.state.seats[].card` 都是**可缺省**的加性字段，老页面不认时不发、不读，既有帧逐字节不变。服务端改动需**重启**生效（无对局时）。

### 模组管理器：全部停用只关面板上的模组 / 六格移出清单（2026-10-31）

- **「全部停用」只关清单里显示出来的模组**：`workshop/mod-manager/ui/manager.js` 的 `LOCKED` 增补六格 ——
  `dimo-enemies`（特训敌人·涤墨）/ `enemy-ext`（新增敌人扩展）/ `mode-recon`（模式扩展-重构模拟）/
  `profession-expansion`（职业分支扩展）/ `server-ext`（服务器功能扩展）/ `side-story`（故事集）。
  它们不再占大厅与房间清单的一行，并始终写进「本房点名的清单」，所以右上「全部停用」只关掉清单里能看见的那些，
  没有开关、没显示的模组保持启用。包版本 1.3.1。
- 回归：`node tools/workshop-validate.mjs` 0 error（17 个包，365 条既有 warning）。

### 干员模组等级按阶级归位（2026-10-31）

- **原版模式**（官方阶级表，`docs/DATA.md` §2.2）：1–5 阶普通无模组 / 精锐 **1 级**；6 阶普通无模组 / 精锐 **3 级**。
  `workshop/ave-mujica/chess.json` 的 4 条精锐（三角初华 / 若叶睦 / 八幡海铃 / 丰川祥子）、`workshop/dossoles/chess.json`
  的 4 条、`workshop/rimbilliton/chess.json` 的 1 条原来把 `status.equipLevel` 写成 0（面板显示「模组等级 0」，与烘进
  数值的 1 级模组不一致）；现在按上表补齐，`stats` / `trait` / `talents` / `modules[]` 用本机 `character_table` /
  `battle_equip_table` 在同一 status 上重算（6 阶精锐从 1 级模组升到 3 级）。颂乐人偶的模组 id 在包里写作
  `uniequip_002_doloris/timoris/oblivionis`，与客户端 `dolris/tmoris/oblvns` 不同名，重算按名字匹配到真实模组。
- **重构模拟**（业主 2026-10-31 的阶级表，`workshop/mode-recon/README.md`）：1–3 阶普通无 / 精锐 1 级；4–5 阶
  普通 1 级 / 精锐 2 级；6–7 阶普通 1 级 / 精锐 3 级。`workshop/mode-recon/chess.json` 的 36 条记录按表归位：
  4 阶起的普通记录带上默认模组 1 级（`module.active: true`，不列 `modules[]`），精锐的模组从 1/2/3 级统一到该阶级的
  2 或 3 级并同步重算数值；克莱门莎、归溟幽灵鲨在本机客户端没有模组数据，只写等级（`module.id: null`），数值不动。
- 包版本：`ave-mujica` 1.8.29、`dossoles` 1.2.1、`rimbilliton` 1.3.1、`mode-recon` 0.19.34。
- 回归：`workshop-validate` 0 error；`test/workshopOperators.test.js`、`test/chessModules.test.js`、
  `test/content/avemujica_amoris.test.js`、`test/match/recon-chess.test.js`、`test/match/tier7.test.js` 全通过；
  `golden matches` 的 10 条快速场景不变（金色战报只用核心 `data/chess.json`）。

### 重构模拟：借用干员技能图标 / 涤墨限定 / 难度名（2026-10-31）

- **8 名借用干员的技能图标**：官方素材清单只为 `assets07` 与 `data/backups.json` 里的干员生成 `skills`，
  workshop 借用干员没有 ⇒ 干员详情 / 调配面板的技能行是空图标。`tools/local-extract/operators.py` 新增
  `export_skill_icons`（`spritepack/skill_icons_*.ab` 按 `skill_icon_<iconId>` 找 Sprite；颂乐人偶的 `skchr_am_*`
  还有去掉 `am_` 的候选名），`extract.py --skill-icons` 把 32 个图标导出到 `public/assets/local/skill/` 并写进
  `data/local-assets.json` 的 `skills` / `skillsById`（`groups.skill` 32 条，清单 1890 条 / 115 组）。
  `server/plugins/artReferences.js` 的 `mergeLocalChars` 把本地 `skills` / `skillsById` 并进下发的
  `/data/assets.json`（官方条目优先，插件素材校验读同一份视图），`skillIconUrl` / `skillRecordIconUrl` 的两级查找
  （`skills[iconId]` → `skillsById[skillId]`）因此都能命中。
- **涤墨只出现在重构模拟**：`data/factions.json` 的 `types.DIMO` 改为 `involveRandom: false` + `reconOnly: true`，
  `generation.typeSlots` 删掉 `DIMO` —— 官方模式的随机类型池回到 6 个官方类型，涤墨不会再抽到；
  `server/match/waves.js` 的 `factionSetup.forceTypes` 过滤改为「本局可用 &&（在随机池里 || 标了 `reconOnly`）」，
  重构对局仍每局必选涤墨（`fixedRounds` 的 6 个回合不变）。
- **重构模拟的难度名**：`shared/constants.js` 新增 `RECON_DIFFICULTY_NAME` / `isReconMode` / `difficultyLabel`；
  lobby（创建 / 匹配 / 最近同盟）、room（邀请、简报、难度按钮、搜索标签）、hud、matchChrome、result、settle 的
  难度标签都按房间模式取名 —— `roomMode='recon'`（或 `mode_recon_*`）的 `ABYSS` 显示「重构模拟·终极」，
  官方「终极模拟」一字不改；`public/i18n/{en,zh-TW,ja,ko}.json` 各补一条词条。
- 回归：`test/match/waves.test.js`、`test/recon-wave-templates.test.js`、`test/render/plugin-official-art.test.js`
  （新增本地 `skills` 合并用例）、`test/i18n.test.js` 全通过；`workshop-validate` 0 error。
  `node tools/i18n.mjs check --all --strict` 仍报 ja / ko / zh-TW 既有的 123 条未翻译（与本轮无关）；
  `test/data.test.js` 仍是 HEAD 上的 `entries 85 ≠ 67`（`typeSlots` 的断言已通过）。

### 重构模拟：借用干员素材补全 / 时装扩展包 1.4.4（2026-10-31）

- **8 名借用干员的立绘 / 头像 / 模型**：讯使 `char_198_blackd`、深海色 `char_110_deepcl`、空构 `char_4015_spuria`、
  安哲拉 `char_218_cuttle`、极光 `char_422_aurora`、狮蝎 `char_215_mantic`、白金 `char_204_platnm`、海沫
  `char_4066_highmo` 在官方素材清单里没有 charId ⇒ 干员卡只剩单字占位。用 `tools/local-extract/operators.py` 从本机
  客户端（`D:\Hypergryph\…\StreamingAssets\AB\Windows`）导出 80 个文件（头像 / 头像 E2 / 立绘 / 立绘 E2 + 正面 / 背面
  战斗模型），写进 `public/assets/local/**` 与 `data/local-assets.json` 的 `chars`（`mergeLocalChars` 合并，官方
  `data/assets.json` 不动）；清单 1858 条 / 114 组 / `chars` 8 个。
- **特效**：`tools/local-extract/fx.py` 的 `game_data` 现在也合并 `workshop/*/chess.json`（此前只读官方
  `data/chess.json`，包内新增干员永远不在 `--fx-set used` 的闭包里）；`export_fx` 新增 `--fx-units` 定向抓取
  （`extract.py --only fx --fx-units <charId,…>`）。本次先定向导出这 8 名干员的攻击 / 技能特效（8 units / 15 skills /
  186 prefab / 608 条目），再按 `--fx-set used` 全量重跑恢复本机特效集：**637 units / 685 projectiles / 640 skills /
  5890 prefab / 3950 texture / 1488 mesh，11330 条目，约 245.8 MB**（`data/local-fx.json` + `public/assets/local/fx`）。
- **时装**：这 8 名干员的 **11 套官方时装**并进 `workshop/skin-supplement`（1.4.4）—— 新航线 / 寒武纪（讯使）、
  无言狂响 / 音律联觉（讯使）、无形悼挽 / 面纱之下（狮蝎）、极昼捕手（极光）、灿阳朝露 SD05（白金）、搁浅 /
  及山海（海沫）、绘声绘影（深海色）、暗矢（安哲拉）、慵怠哼唱（空构）；每套含立绘 / 头像 / 正面与背面模型，
  包内 **176 名 / 275 套**。
- 回归：`test/workshopSkins.test.js` 18 通过、`workshop-validate` 0 error；`test/assets.test.js` /
  `test/static-local-art.test.js` / `test/local-extract-operators.test.js` 全通过（88 项）。
  `test/local-extract-fx.test.js` 仅剩一条**本机数据**断言：`enemy_1582_suisho` / `enemy_1593_musnake` 的挂点
  不在「脚下 0 点」范围内（客户端 prefab 自己把 Graphic 摆在 −2.2），与本轮 8 名干员无关。

### 重构模拟：已知问题修复（2026-10-31）

- **颂乐人偶·无忧梦呓**（`workshop/ave-mujica/meta/main.mjs`）：按描述改为**等于**当前调度中心等级 ——
  `ctx.rollChess({ maxTier })` → `ctx.rollChess({ tier })`（此前会随机给到低于等级的干员）；包版本 1.8.28。
- **休整期看得到同场地队友**：`m.private` 新增 `normalMate`（`server/match/match/views.js normalMateView` /
  `server/match/player/views.js`），把配对队友的整备区棋子按它那一半带下来（右半镜像、朝向翻转）；
  `public/js/render/app.js setPrep` 把它画成只读棋子，`public/js/ui/gameLogic/camera.js` 在配对两人都存活时
  **整条普通带一起取景**（不再推近到只剩自己那半）。
- **时装在观战里显示为默认模型**：`public/js/render/units.js` 的三处 `spineEntry` 调用（`_modelEntry`、Back 的
  待命帧判断、倒下时长）都把 `info.skin` 递给清单，Spine 模型与头像现在读同一份 `room.skins` 选择。
- **右半场玩家的怪物等待区**：`public/js/render/app.js setPenList` 固定按**自己那一半**排布（`side: at`，
  不再受当前相机种类影响），`enterBattle` 的 prep 分支带上 `meta.side`。
- **等待区的上下两批**：`server/match/waves.js previewOf(spawns, rect)` 在地图自己画了路线时按**这块场地自己的
  纵向中线**重判（普通带 rows 34–38 ⇒ 中线 36），my_map 起点 35 = lower / 37 = upper。
- **炎佑与狼之主落在自己半场**：`server/sim/content/tokens.js` 新增 `halfColSpan`，`airTile` 与
  `spawnWolfLord` 的满场回退都只取召唤者自己那半边的列（双人 boss 场地不再把召唤物丢到对面）。
- **浮士德·重构的隐匿**：`workshop/mode-recon/battle/main.mjs installFaust` 在梅菲斯特阵亡时同时
  `removeBuff(recon:faust_stealth)`，隐匿立刻结束（+攻速照旧保留）；包版本 0.19.33。
- **设置项**：`public/js/ui/settings.js` 暴露「部署时收起商店」（`prepDeployFold`），可关闭拖拽选干员时
  拉近视角 / 收起调度中心；i18n 词条沿用既有条目。
- 回归：`test/content/avemujica_amoris.test.js`（等级等于）、`test/match/recon-routes.test.js`
  （上下两批 + `normalMate`）、`test/match/recon-bonds.test.js`（炎佑 / 狼之主两侧各落半场）、
  `test/match/recon-bosses.test.js`（浮士德隐匿）、`test/ui/gameLogic.test.js`（配对取景）、
  `test/skins.test.js`（模型读 `info.skin`）、`test/ui/issue602-deploy-fold.test.js`（设置行）均通过；
  `workshop-validate` 0 error。

### 重构模拟：阿戈尔·新增干员（2026-10-31）

- **新增四名干员**（`workshop/mode-recon/chess.json` + `garrisons.json`，只在重构对局生效）：
  * **克莱门莎**（7 阶，阿戈尔）：每次攻击额外附带「自身生命上限 1% × 【阿戈尔】层数」的元素伤害（精锐 2%），
    并使敌人的侵蚀损伤冷却减少 25%（精锐 50%）—— 包侧 `RECON_CLEMNT_AEGIR`：`hit` 里追加一笔 `type: 'elemental'`、
    元素 `erosion` 的伤害，并把敌人 `erosionBurst` 的剩余时间按比例缩短。
  * **海沫**（4 阶，阿戈尔 / 灵巧）：`<战斗开始时>` 使身后一格（精锐两格）干员获得身前一格干员的特质 ——
    `RECON_HIGHMO_COPY` 只复制 `IN_BATTLE` 特质，经 `battle.rbAddGarrison`（与莱伊「复制身前干员的战斗中类效果」同一通道）。
  * **深海色**（1 阶，阿戈尔 / 独行）：`<售出时>` 获得 1 件随机 2 阶装备（精锐 2 件）；触手
    `token_10001_deepcl_tentac` 随包提供 —— `meta/main.mjs` 的 `DEEPCL_SELL`（`ctx.rollItem({ tier: 2 })` + `ctx.grantItem`）。
  * **安哲拉**（2 阶，阿戈尔 / 精准）：`<进入休整期时>` 携带的装备 ≥2（精锐 ≥1）时，随机取 2 件（精锐 1 件）
    **阶级最低**的装备，按 70% / 20% / 10% 替换为阿戈尔重刃 / 突变细胞 / 海沟实验体 —— `CUTTLE_SWAP`：
    `ctx.destroyItem` → `ctx.grantItem` → `ctx.equipDirect` 装回同一名干员。
- 新干员的记录由本机缓存按既定练度推导（克莱门莎 `char_4231_clemnt`、海沫 `char_4066_highmo`、深海色 `char_110_deepcl`、
  安哲拉 `char_218_cuttle`）；克莱门莎借官方自选 kit（`kitRef`），其余三名走 generic kit；检索名沿用
  `recon_chess_ws_recon_<name>_a/b`，官方模式读不到。
- 回归：新增 `test/content/recon-aegir.test.js` 3 条（元素伤害与侵蚀冷却 / 精锐数值 / 海沫特质复制）；
  `test/match/recon-chess.test.js` 补 3 条（真实数据、深海色售出 1 / 2 件 2 阶装备、安哲拉最低阶替换与精锐只换 1 件）；
  `workshop-validate` 0 error。

### 重构模拟：炎·新增与重构干员（2026-10-30）

- **引擎级 `recon_` 棋子别名**（只在重构对局生效）：`shared/reconModes.js` 新增 `reconChessAlias` / `reconData` ——
  `recon_<id>` 的棋子记录在 `mode_recon_*` 的 `Match` / `Battle` 里覆盖到正式 id（`chessId` / `baseId` / `goldenId` /
  `upgradeChessId` 的 `recon_` 前缀一并去掉）；正式 id 原本不存在 ⇒ 就是一名新增干员。官方数据与 `data/*.json`
  一个字节不动，官方模式读不到这些记录（`GameData.visibleChess` 排除 `recon_*`，客户端 `public/js/data.js` 的
  `setChessAlias` 与 `screens/game.js` 的 useEffect 同一份口径）。
- **新增两名干员**（数值按官方原始表按既定练度推导，`workshop/mode-recon/chess.json`）：左乐（6 阶，炎 / 迅捷，
  `<进入休整期时>` 获得 1 件天师古鼎；精锐再加 1 件炎国短刀 —— 复用 `SERVER_GAIN_EQUIP`，该处理器现已支持逗号分隔的
  多件装备）、赤刃明霄陈（7 阶，炎，`<战斗中>` 攻击附带「已激活【炎】层数 × 敌方当前生命值」的固定真实伤害；
  普通 0.001% / 精锐 0.002%，包侧 `battle/main.mjs` 用 `registerGarrisonInstaller` 挂 `hit` 追加一笔 `type: 'true'`
  的伤害，带 `garrison` 标签防递归）。
- **五名重构**（只在重构对局覆盖官方记录）：录武官 → 4 阶（炎 4 / 奇迹 2，精锐 8 / 4）、星熊 → 3 阶（自身盟约
  +6 / 精锐 +12）、诗怀雅 → 2 阶（其余不变）、烛煌 → 4 阶（炎 / 维多利亚 +4 / 精锐 +8）、仇白 → 5 阶（伤害提升
  0.5% / 精锐 1%）。
- ⚠️ **覆盖是整条记录**：重构版会盖掉其它工坊包对同一棋子的改动（例如多索雷斯给星熊 / 诗怀雅加的盟约）。
- **干员调配右下角的「重构模拟干员」开关**（业主 2026-10-30）：开关关闭时 `recon_*` 记录从名单里隐藏（干员持有
  同理）；打开后 5 名重构干员的卡片与详情换成重构记录（阶级 / 特质 / 数值），并补上 2 名新增干员；技能 / 模组 /
  潜能 / 练度照常修改（`public/js/ui/loadoutModel.js` 的 `rosterWithRecon`）。条目以 `recon_<id>` 保存，重构对局里
  `PlayerState.setLoadout` 按 `Match.reconLoadoutAlias` 落到正式棋子 id（官方模式不做别名）。开关状态存在本浏览器
  （`loadout.recon`）。
- 回归：新增 `test/match/recon-chess.test.js` 5 条（别名函数、`reconData` 缓存、真实数据、`Match` 两种模式、
  左乐休整期给装备）与 `test/content/recon-chen3.test.js` 2 条（真 sim 上的追加真实伤害 / 未激活 0 层不追加）；
  `test/match/tier7.test.js` 的 7 阶比例断言改成「这一格出了 7 阶」（池里有多枚 7 阶时按记录分摊，不再钉死某一条）；
  `workshop-validate` 0 error。

### 重构模拟：萨尔贡·新增与重构干员（2026-10-30）

- **新增三名干员**（`workshop/mode-recon/chess.json`，记录取自官方表：娜仁图亚 `chess_char_6_05`、森蚺
  `chess_char_4_05`、狮蝎 `chess_char_1_12` —— 这三格在本机官方数据里是别人，所以照左乐的先例用
  `recon_chess_ws_recon_<name>_a/b`，不占用其它 id）：
  * **娜仁图亚**（6 阶，萨尔贡 / 精准 / 远见）：`【萨尔贡】干员技能开启后，携带装备的效果共享至相邻四格
    （精锐周围八格）【萨尔贡】干员（持续60秒）` —— 包侧 `RECON_NARANT_SHARE`：`skillStart` 时把**开启技能的那名
    萨尔贡干员自己携带的装备**借给相邻的萨尔贡干员，走引擎的 `lendItemEffects`（同一件重复借只刷新计时器）。
  * **森蚺**（7 阶，萨尔贡 / 坚守）：`<战斗中>【萨尔贡】干员每开启1次技能，使已激活的【萨尔贡】【坚守】层数+6`，
    本场开启次数 ≥20 时 `<进入休整期时>` 获得 1 件黄沙罗盘（精锐 2 件）—— 战斗侧 `RECON_ZUMAMA_LAYERS`，休整期
    由包 `meta/main.mjs` 的 `sargonPrepRewards`。
  * **狮蝎**（3 阶，萨尔贡 / 独行）：`<战斗开始时>使自身与相邻四格（精锐周围8格）的干员获得隐匿（持续999秒，
    受到敌人攻击后解除）`；`<进入休整期时>`按上回合战斗结束时持有隐匿的干员数获得最多 2 件（精锐 4 件）盟约之币 ——
    战斗侧 `RECON_MANTIC_STEALTH`，休整期同一处 `sargonPrepRewards`。
- **战斗 → 休整期的两个标记**（引擎既有的通用通道）：战斗侧 `setBattleMark(battle, pid, 'reconSargonCasts' |
  'reconStealthHolders', n)`，休整期 `ctx.mark(key)` 读 —— 每场战斗结束整体替换，所以「上一场没写」就是 0。
- **三名重构**（只在重构对局覆盖官方记录）：**佩佩 → 5 阶**、**莎草 → 1 阶且购买资金 2**、**至简 → 2 阶**，其余不变。
- **SDK**：`@battle/mod.js` 补导出 `lendItemEffects`（引擎里本来就为「萨尔贡 × 娜仁图亚」而写，包侧此前拿不到）。
- 回归：新增 `test/content/recon-sargon.test.js` 5 条（装备共享与 60 s 收回 / 森蚺 +6 层与计数标记 / 森蚺不在场不加层 /
  隐匿与受击解除及持有数标记 / 休整期发黄沙罗盘与盟约之币）；`test/match/recon-chess.test.js` 补 2 条（真实数据、
  休整期发奖，含装备自动合并为进阶）；`workshop-validate` 0 error。

### 重构模拟：维多利亚·新增与重构干员（2026-10-30）

- **新增三名干员**（`workshop/mode-recon/chess.json`）：澄闪 `recon_chess_ws_recon_gdglow`（5 阶，维多利亚 / 灵巧 /
  奥术，记录取自官方表 `chess_char_6_08`；本机官方数据这一格是焰影苇草，所以用新 id）、死芒
  `recon_chess_ws_recon_necras`（7 阶，维多利亚 / 迅捷 / 独行，取自 `chess_char_6_10`）、傀影
  `recon_chess_ws_recon_phatom`（4 阶，维多利亚 / 突袭）—— 傀影在两版 chess 数据里都没有记录，由
  `data/backups.json` 的两份形态（`2/1/4/0` normal / `2/60/7/1` elite，含精英的 `statsBase` / `traitBase` /
  `talentsBase` / `modules` / `potDown`）组合成完整记录。
- **技能本体借官方自选 kit**（`kitRef` = 官方 charId，`content/index.js kitOf`）：三名干员在重构对局里的正式 id
  （`chess_ws_recon_*`）不是官方棋子，按 `baseId` 找 kit 会落到 generic；记录上的 `kitRef`
  （`char_377_gdglow` / `char_450_necras` / `char_250_phatom`）让浮游单元、召唤物、部署型被动原样照搬。
- **特质**（`garrisons.json` + 包侧 `battle/main.mjs`，全部 `IN_BATTLE`）：
  * **澄闪** `RECON_GDGLOW_DRONES`：`已激活的【维多利亚】每 200 层（精锐 100），技能开启时浮游单元 +1` —— 官方 kit
    的 `onStart` 先建好 `unit.mem.gdDrones`（`skills.js` 先 `onStart`、再 `emit('skillStart')`），这里按实时层数往后
    追加同形的单元（`{ i, lock, cd, rampId, ramp }`）。
  * **死芒** `RECON_NECRAS_FIELD`：`自身与召唤物造成的伤害提升【维多利亚】层数×0.5%（精锐×1%）`（`hit` 里按实时
    层数乘 `dmg.mul`，`source === 死芒` 或 `source.ownerUnit === 死芒`）；`普通攻击与技能攻击范围扩大为场上
    【维多利亚】干员攻击范围的总和`（`setExtraRange` 合并**绝对格键**，技能的 `targeting.rangeGrid` 也叠加；每
    0.5 秒与部署 / 阵亡时重算）。
  * **傀影** `RECON_PHATOM_DEPLOY`：`<部署时>自身已激活的盟约 +4 层（精锐 +8，最多 5 次）`（`gainLayers` +
    `requireActive`，层加给它自己 `unitBonds` 里已激活的盟约）；`本回合部署次数 ≥3` 时进入休整期获得 1 件（精锐
    2 件）带随机效果的维式重锤 —— 战斗侧 `setBattleMark('reconPhantomDeploys', 本场非移动部署次数)`，休整期由
    `meta/main.mjs` 的 `victoriaPrepRewards` 从 `pool_equip_vict`（战栗 / 坚固 / 加速 / 灼燃）当场抽。
- **召唤物记录随包提供**（`workshop/mode-recon/tokens.json`，官方 `data/tokens.json` 里没有这两条）：
  悲叹的仆役 `token_10043_necras_skeltn`、镜中虚影 `token_10007_phatom_twin`，从 `data/backups.json` 抄入并**补上
  重构棋子 id 的形态变体键**（`chess_ws_recon_*` 的 `_a` / `_b`，对应普通 / 精英形态），官方 `char_*@<状态>` 键保留。
- **风笛 → 3 阶**（只在重构对局覆盖官方记录），其余不变（价格 3、`garrison_50_a/b`、技能与模组逐字照抄）。
- 回归：新增 `test/content/recon-victoria.test.js` 5 条（浮游单元 +1 与精锐 / 未激活 / 不到阈值；伤害与召唤物同享
  层数倍率；范围并集含 / 不含非维多利亚；部署加层与 5 次上限及标记；休整期发维式重锤）；`test/match/recon-chess.test.js`
  补 1 条真实数据与 `Match` 断言（含两条 summon 记录与形态变体）；`workshop-validate` 0 error。

### 重构模拟：谢拉格·新增与重构干员（2026-10-30）

- **新增两名干员**（`workshop/mode-recon/chess.json`）：极光 `recon_chess_ws_recon_aurora`（3 阶，谢拉格 / 不屈，
  记录取自 `chess_char_3_02`）、讯使 `recon_chess_ws_recon_courier`（1 阶，谢拉格，取自 `chess_char_1_02`）。
  两枚在本机官方数据里是别人，所以照左乐的先例用新 id；技能走引擎的 generic kit（`kits/ops` 里没有
  `char_422_aurora` / `char_198_blackd`）。
- **特质**（`garrisons.json` + 包侧 `battle/main.mjs`）：
  * **极光** `RECON_AURORA_TRAIT`（`IN_BATTLE`）：`【谢拉格】盟约激活后，每秒获得 1 / 2 技力`（`battle.every(1)` 给
    自身 `skill.gainSp`，未激活不涨）；`每对敌人造成 3 次寒冷，使已激活的【谢拉格】【不屈】层数 +2 / +4`（
    `beforeStatus` 数这名玩家对敌人施加的寒冷，满 3 次 `gainLayers` + `requireActive`）。另补 generic kit 认不出的
    一处：S2 的 `atk_scale`（250% / 300%）只应在**目标已冻结**时生效，未冻结时在 `hit` 里把这一笔倍率退回。
  * **讯使** `RECON_COURIER_PREP`（`SERVER_PREP_START`）：`<进入休整期时>获得 1 / 2 件简易通讯机（需要激活
    【谢拉格】盟约）` —— `meta/main.mjs` 的 `kjeragPrepRewards` 在 `onRoundStart` 读场上持有该特质的棋子、按
    `bb.count` 发 `chess_item_2_06_e`。S2 的两处补数（开启 +3 部署费用、之后每 1.87 秒 +1 共 8 次、持续期防御 +40%）
    generic kit 认不出 `blackd_s_2[period].*`，挂在包自己的 `install(battle)`（`installCourierSkills`，按去前缀后的
    正式 id 认人 —— 这条特质不进 `IN_BATTLE` 表，所以不能走 `registerGarrisonInstaller`）。
  * **雪猎 → 2 阶**（`recon_chess_char_3_11_a/b` 覆盖官方记录），特质沿用官方 `SERVER_ADD_BOND_CHESS_ALL`，
    `bb.count` 改为 3 / 6（普通 / 精锐获得的所属盟约层数）。
  * **圣聆初雪 → 7 阶**（`recon_chess_char_6_02_a/b` 覆盖官方记录），保留原本的 `garrison_05_a/b`，**另加**一条
    `RECON_SBELL2_PIERCE`（`IN_BATTLE`）：`攻击处于寒冷、冻结的敌人时，使自身下次攻击造成的伤害无视敌人 1 / 2 点
    法术抗性（可叠加 25 层）` —— 在 `damaged` 里叠 `resIgnoreFlat` 层（这一击不受益，下一击起生效；加法 mod 按层数
    放大，正好等于「无视 N 点」）。
- 回归：新增 `test/content/recon-kjerag.test.js` 6 条（极光 SP 与寒冷加层、极光 S2 冻结倍率、圣聆初雪法抗穿透、
  讯使 S2 与休整期通讯机）；`test/match/recon-chess.test.js` 补谢拉格数据断言；`workshop-validate` 0 error。

### 重构模拟：拉特兰·新增与重构干员（2026-10-30）

- **新增两名干员**（`workshop/mode-recon/chess.json`，记录由本机缓存的官方角色表按 6 阶 / 2 阶练度推导，
  不是从旧赛季记录抄的）：菲亚梅塔 `recon_chess_ws_recon_phenxi`（6 阶，拉特兰 / 独行，`kitRef` =
  `char_300_phenxi` 借官方自选 kit）、空构 `recon_chess_ws_recon_spuria`（2 阶，拉特兰 / 远见，官方没有她的 kit，
  技能走引擎 generic kit）。
- **特质**（`garrisons.json` + 包侧 `battle/main.mjs` / `meta/main.mjs`）：
  * **菲亚梅塔** `<获得时>获得 1 / 2 件铳骑之威` —— 纯数据（`SERVER_GAIN` + `SERVER_GAIN_EQUIP`，与「迅捷作战粮」
    同一格）；`<战斗中>【拉特兰】干员消耗弹药 ≥200（精锐 100）发 ⇒ 进入休整期获得 1 件拉特兰桥夹` —— 战斗侧
    `RECON_PHENXI_AMMO` 数本场 `ammoUsed`（多名【拉特兰】干员的弹药都算）并按玩家写标记 `reconLateranoAmmo`，
    休整期由 `meta/main.mjs` 的 `lateranoPrepRewards` 对照 `bb.ammo` 发件。
  * **空构** `<休整期结束时>使身后一名【拉特兰】干员已激活的盟约层数 +2 / +4` —— `SERVER_PREP_FIN` 记录
    `RECON_KONGGOU_LAYERS`，`meta/main.mjs` 的 `konggouPrepEnd`（`onPrepEnd`）沿棋子朝向取身后一格，目标必须是
    【拉特兰】成员，只加**它**的已激活盟约（不加空构自己）。
  * **蕾缪安 → 7 阶**（`recon_chess_char_6_01_a/b` 覆盖官方记录，保留 `garrison_24_a/b`），**另加**
    `RECON_LEMUEN_FIELD`：技能开启期间射程内敌人速度 -90%（每 0.2 秒补一层 0.3 秒的 `moveMul`，离开射程到期），
    自身受到的伤害按【拉特兰】层数 ×2% / ×4% 降低（`hit` 里按实时层数改 `dmg.mul`）。
  * **塑心 → 5 阶**（`recon_chess_char_6_09_a/b` 覆盖官方记录，其余字段照抄）。
- 回归：新增 `test/content/recon-laterano.test.js` 3 条（弹药计数与休整期桥夹、空构身后加层、蕾缪安减速与减伤）；
  `test/match/recon-chess.test.js` 补拉特兰数据断言与 `Match` 断言；`workshop-validate` 0 error。

### 重构模拟：卡西米尔·新增与重构干员（2026-10-30）

- **新增两名干员**（`workshop/mode-recon/chess.json`，记录由本机缓存的官方角色表按 5 阶 / 3 阶练度推导）：
  薇薇安娜 `recon_chess_ws_recon_vvana`（5 阶，卡西米尔 / 灵巧，`kitRef` = `char_4098_vvana` 借官方自选 kit）、
  白金 `recon_chess_ws_recon_platnm`（3 阶，卡西米尔 / 精准 / 独行，官方没有她的 kit，技能走 generic kit）。
- **特质**（`garrisons.json` + 包侧 `battle/main.mjs` / `meta/main.mjs`）：
  * **薇薇安娜** `<进入休整期时>获得 1 / 2 件骑士储蓄罐` —— 纯数据（`SERVER_PREP_START` + `SERVER_GAIN_EQUIP`）；
    `骑士储蓄罐被装备销毁时，极小概率（3.25%，精锐 7.99%）不获得资金，而是获得 1 件天马之盔或天马之枪` ——
    引擎的 `dispatchItem` 先跑装备自己的处理器，`global:` 钩子拦不到官方的资金结算，所以包在 `registerMeta`
    里**覆盖**同一 key 的 `item:chess_item_3_12_e`：场上有（重构对局里的）薇薇安娜且 `rng.chance(bb.prob)` 命中 ⇒
    改发天马之盔 / 之枪（`ctx.grantItem`，二者各半）；否则逐字复刻官方的 1~6 / 2~12 资金。
  * **白金** `RECON_PLATNM_ASPD`（`IN_BATTLE`）：`未攻击时每 0.5 秒攻速 +5（最多 20 层），到顶后在场每 5 秒
    自身已激活盟约 +1；攻击后的 10 秒内逐渐降回 0` —— 一个按干员 id 区分的 buff 每 0.5 秒 `refresh: 'replace'`
    重写 `aspd` 加法值；最后一次攻击距今 ≤ 10 秒只降不涨（窗口结束后仍未攻击才重新累积），到顶后的盟约 +1 走
    `gainLayers` + `requireActive`，只加这名干员自己的盟约。
  * **玛恩纳 → 7 阶**（`recon_chess_char_5_19_a/b` 覆盖官方记录，保留 `garrison_115_a/b`），**另加**
    `RECON_MLYNAR_FIELD`：`【卡西米尔】干员每攻击 3 次，使全场敌人在 2 秒受到 5 次 799（精锐 1124）点固定伤害` ——
    `attack` 钩子按玩家计【卡西米尔】成员的攻击次数，满 3 次用 `battle.after` 排 5 发 `sourceless` 真伤
    （不吃增伤、不吃减伤，走 `type: 'true'`）。
  * **流星 → 2 阶**（`recon_chess_char_3_17_a/b`，去掉独行盟约，`garrison_137_a` / `garrison_01_a` 与其余字段照抄）。
  * **远牙 → 3 阶**（`recon_chess_char_4_20_a/b`）：外层 `ADD_BOND` 授予改写数值的 `recon_garrison_fartth_gift_a/b`
    （沿用官方 `act2autochess_gar_event_onstart` 的 `bond_add_count` / `max_add_count_per_battle` 口径），
    `获得层数 3 / 6、每场上限 18 / 36`，不改共享的官方 `garrison_108`。
  * **灰毫 → 1 阶、购买资金 2**（`recon_chess_char_2_18_a/b`）：特质沿用官方 `SERVER_ADD_BOND_ACTIVATED_MOST_LAYER`，
    `bb.count` 改为 2 / 4。
- 回归：新增 `test/content/recon-kazimierz.test.js` 3 条（白金的叠层 / 到顶加层 / 攻击后 10 秒归零并重新累积、
  玛恩纳的 3 次触发与精锐 1124、薇薇安娜的储蓄罐概率改写与「没有她仍是官方资金」）；`test/match/recon-chess.test.js`
  补卡西米尔数据断言与 `Match` / 官方模式断言；`workshop-validate` 0 error。

### 重构模拟：叙拉古·新增与重构干员（2026-10-31）

- **新增两名干员**（`workshop/mode-recon/chess.json`，记录由本机缓存的官方角色表按 7 阶 / 5 阶练度推导，
  `kitRef` 借官方自选 kit）：贝洛内 `recon_chess_ws_recon_demetr`（7 阶，叙拉古 / 突袭）、斥罪
  `recon_chess_ws_recon_judge`（5 阶，叙拉古 / 不屈）。贝洛内 S3 的召唤物「牵绊」（`token_10065_demetr_dmtpos`）
  随包提供（`tokens.json`，补上重构棋子 id 的形态变体）。
- **特质**（`garrisons.json` + 包侧 `battle/main.mjs` / `meta/main.mjs`）：
  * **贝洛内** `<部署时>【叙拉古】【突袭】层数 +10（精锐 +20，最多 4 次）` —— 纯数据（`act2autochess_gar_event_onstart`，
    每场上限 40 / 80 层）；`<进入休整期时>若伺夜在场且携带叙拉古正装，获得 1 / 2 件叙拉古正装` ——
    `meta/main.mjs` 的 `siracusaPrepRewards`（两条互惠的条件都在**发放任何装备之前**判定，先发的那件触发的
    装备合并不会吃掉另一条要看的「携带」）。
  * **斥罪** `RECON_ZEIZ_GUARD`：`处于隐匿的【叙拉古】干员受到的攻击由自身承担，每次承担攻击使【叙拉古】【不屈】
    层数 +4 / +8（最多 6 次）` —— 战斗侧在 `hit` 钩子（priority −20，等其它修正算完）取消这一击，再以同一份数值
    打给斥罪（按她自己的防御 / 法抗结算）；每承担一次 `gainLayers`（`cap` = 4/8 × 6，`capKey` 按干员区分）。
    另一名斥罪身上的伤害不再转走（`zeizTransfer` 标签 + 目标自带同一条特质即跳过）。
  * **阿罗玛 → 3 阶**：刷新加层不变（+2 / +4），每回合上限 6 / 12 → **4 / 8**。
  * **忍冬 → 2 阶**：`<获得时>` 自身盟约层数 6 / 12 → **4 / 8**。
  * **安洁莉娜 → 4 阶**：每刷 4 / 8 → **3 / 6**，每回合上限 12 / 24 → **9 / 18**。
  * **伺夜阶级不变**，保留原本三条特质，**另加** `<进入休整期时>若贝洛内在场且携带叙拉古正装，获得 1 / 2 件
    家族徽章`（同一个 `siracusaPrepRewards`）。
  * 三条数值改写都做成包内副本（`recon_garrison_aroma / vulpis / aglina`），官方 `garrison_122 / 71 / 147` 不动。
- 回归：新增 `test/content/recon-siracusa.test.js` 2 条（斥罪的承担 / 6 次上限 / 精锐 +8、不隐匿与不承担）；
  `test/match/recon-chess.test.js` 补叙拉古数据断言、`Match` / 官方模式断言与「贝洛内 / 伺夜互惠」（含装备合并、
  只满足一侧、对方不在场不发）；`workshop-validate` 0 error。

### 名片干员（room.card）

- 新 C2S `room.card { charId }`：`''` 清空，其余必须是 `isCharId`；白名单是**本房内容**的干员（`operatorCharIds`），未知 id 返回 `BAD_MSG`。
- 会话上持久，`humanSeat()` 带进座位，`room.state` 只在非空且非 bot 时输出 `card`；比赛中也接受，**不改 ready**。
- 前端无需改动：`screens/room.js` 早已按 `C2S['room.card']` 自动开启同步，`ui/seatArt.js` 读 `seats[].card`。

### 账号 / 好友 / 成就 / 名片背景（复用 `server-ext`）

- `public/js/ui/accounts.js` 从兼容垫片改为真实模块：连 `server-ext` 的 lane，按座位 `playerId` 调 `lookup`，顶栏显示昵称 + `#编号` + 头像；令牌沿用同一份 `sp.pref.panel.server-ext.token`，**不改写** `var/mod/server-ext/accounts.json` 的既有记录。
- `server-ext`（`workshop/server-ext/server/accounts.mjs`，包版本 `2.5.0`）新增 lane 操作：`profile` / `namecard` / `friendList` / `friendAdd` / `friendRemove` / `achievements`；`lookup` 与 `me` 的公开资料多一个 `namecard`。账号库只新增 `friends` 与 `namecard` 两个可选字段，旧库装载时自动补齐。
- `public/js/ui/friends.js`：大厅「好友」入口 + 房间「邀请好友」；好友关系双向写入账号库，在线状态取账号是否还有活着的登录会话；邀请 = 复制当前同盟的房间链接。
- `public/js/ui/achievements.js`：成就面板读账号侧的 `achievements`（注册、头像过审、名片、绑定、好友、账号满 30 天），**不伪造对局战绩**。
- `public/js/ui/namecards.js`：席位卡背后一层官方「个人名片」美术 —— PRTS 个人名片一览的 **34 个主题**（`nc00`…`nc33`，`shared/namecards.js` 是目录，美术在 `public/assets/ui/namecard/<id>.png`，取每个主题的无界面文字 `预览1+`，缺失时回落 `预览1`；原图不换色）。账号没设过时按编号给一张；换名片放在「统计数据 → 名片背景」页签（`总览` 旁边），设置里不再重复。
- 大厅右上角的个人芯片也带上这张名片背景（`.me-chip.has-nc` + `.nc-layer`），换完立刻刷新，不用重进房间。
- 好友 / 成就面板的失败文案区分「未登录」与「服务器还没重启到含账号接口的版本」；账号服务本身仍由 `server-ext` 的 lane 提供。
- 大厅左栏按参考页重做：**成就统计**卡（橙色沙丘横幅、等级徽章、账号卡与 6 张成就卡）、**好友**卡（在线人数、全部/在线分栏）、**大厅聊天**（`LOBBY CHAT / 大厅聊天`、大厅频道 / 招募频道、时间戳与系统行）。
- 成就统计卡与面板的图标改为**奖杯图标**：等级取统计页同一份本机记录里的「获得奖杯」总数（`trophy_level1…5`），奖杯数变化时图标与 `LV` 一起变。

### 时装动作修正 / 特训敌人图标

- 审计 `workshop/skin-supplement` 的 **264 套时装**（逐套对照基础干员的 `anims` / `animations` / `hits` / `events`）：没有引用不存在的 clip，`hits` 与基础一致的 3 套（斯卡蒂两套、锡兰联动皮）保持原样。
- 修正 **4 处技能槽映射**：宴的两套时装（时代「伪装」/ 珊瑚海岸「夏卉 FA661」）的 **S2**、炎熔联动皮的 **S1 / S3** 在基础干员里是「普攻动作」（`via: 'attack'`），皮肤却被映射到唯一的 `Skill_*` 技能片段 —— 技能期间会放成技能起手/循环动作。现在前后两套骨架都对齐基础干员的映射。
- 野鬃时装（时代「正义缔造者」）的主技能槽（技能索引未知时的默认）对齐基础干员（S2），普攻映射、打击帧与时长本来就与基础完全一致。
- 包版本 `1.4.1 → 1.4.2`；`workshop:validate` 0 error。
- 特训敌人「涤墨」的类型图标换成用户提供的图（`public/assets/ui/enemyTypeIcon/dimo_icon.png`，旧图已留 `.bak-`）。

### 时装特效补全（`workshop/skin-supplement` 1.4.2 → 1.4.3）

- 264 套时装逐套对照客户端：按官方 `skinId` 的 `@` 后缀在干员自己的特效 bundle 里收全部 `_<fx>` 变体（不再只看
  「默认 key + 后缀」，那正是 1.4.0 漏提的原因 —— `plosis_attack_start_01` 与默认 `plosis_attack_01_start` 不同名，
  `radian_*` 与默认 `raidian_*` 不同名，`birth` / `buff` / `token` 行在默认皮里没有同名 key）。
- 补 **126 套 / 354 个 key**：prefab 3469 → **3824**、贴图 key 3942 → **4128**、网格 1334 → **1386**；
  `index.json` 的 `skins` 196 → **197**（新增能天使「音律联觉」，挂载点从 `skinpack` 实测）。`game-radian`、
  `yun-plosis` 两套原先有 `fx` 条目却零 prefab，这次一并落地。
- 复查后每套的客户端变体都在包内（0 缺）；召唤物自己的变体（30 套 / 297 key）仍不收 —— 本包不含召唤物模型。
- `workshop:validate` 0 error。

### 重构协议·特训后续打磨（2026-10-29）

- **频率**：教官技能的影子从「每次攻击 +1 次应用」改成「**每一次伤害**同步 1 次」——多段攻击按段数
  （`attack.hits = 学员自己的段数 × (1 + 教官的段数)`：教官 1 段时就是原来的 ×2，赤刃明霄陈 S3 的 3 段时 ×4；`hitsFn`
  现算段数的 kit 按同一式；一次攻击 4 段伤害 ⇒ 4 次教官效果）。学员自己的技能没有 attack 行时，教官那一套直接
  作为它的攻击（段数照教官的，不再压成 1 段）。**教官改变的攻击目标选择数量**（`targeting.maxTargets`，逻各斯 S3 的
  `attack@max_target` 这类）同样取大并入。
- **攻击命中的附带效果也继承**（业主 2026-10-29）：`mergeShadowSpec` 现在链式接上教官的 `attack.afterHit` /
  `attack.onEachHit` / `attack.onHit` —— 维什戴尔 S3 的爆炸（余震 / 好礼）此前整段没继承。学员 kit **自己直接结算**的伤害
  （浮游单元的每一次命中、技能 DoT 的 tick 这类不走 `resolveHit` 的实例）由 `installMentorApply` 补一次教官的攻击应用
  （一整套教官攻击：`hits` 段「ATK × 教官攻击倍率」的伤害 + 教官的 `afterHit` / `onEachHit` / `onHit`）；学员自己那次攻击的伤害已由段数 / 溅射覆盖，
  按 `isAttack` / `isSplash` / `attackId` 跳过，教官余震的溅射实例也不会再触发（无递归）。
- **单次释放类教官技能改成「每次攻击 1 次」**（业主 2026-10-29）：本体没有 attack / mods / targeting、效果全在一次
  `onStart` 里生成的技能（异客 S3 辉煌裂片的雷暴这类）继承后不再只在施放时触发一次 —— `mergeShadowSpec` 把它的
  `onStart` 挂到学员的 `onAttack`（每次攻击各 1 次，与弹药类相似），浮游单元每次命中由 `installMentorApply` 走同一份。
- **链式继承**：教官自己也是学员时，`reconTrainee.chain` 带它的教官那条 ⇒ 三围逐层 ×0.5
  （A + B×0.5 + C×0.25），只有三围沿链；盟约 / 特质 / 天赋 / 影子技能仍取直接教官自己的。详情卡同步。
- **召唤物**：学员召唤的 token 也吃教官的天赋 / 特质 installer（token 自己的技能 / 特性照常，影子技能不并）。
- **技能行为的完整继承 + 特效恢复**（业主 2026-10-29 第二次校正）：教官 kit 的 `install` 里按 `unit.skill.id` 注册的
  钩子（赤刃明霄陈 S3 的剑气 tick 只在 `skchr_chen3_3` 上）现在也会装到学员身上 —— 跑教官 `install` 的一瞬临时换 id、
  装完还原（运行期仍读学员自己的 `skill.active / activations`），学员因此**真的获得技能描述里的那道游走剑气**；
  同时恢复教官 start / range / loop / end 行的完整叠加（不再跳过任何一行，红龙变身也在）。
- **详情卡「教官」区块回归**（业主 2026-10-29）：上一轮链式改造把教官 uid 直接当棋子视图传进去 ⇒ 整块静默消失；现已按 uid 取棋子视图再解析记录。
- **甄选干员（自选槽位）的特训显示**（业主 2026-10-29）：特训弹窗里槽位件按 pick 组出的干员记录显示名字 / 头像（不再只剩「甄选干员」+ 警告图标）；甄选干员当**学员**时，详情卡也照常显示教官区块（此前 DIY 分支先 return，把特训叠加整段盖掉）。
- **教官时装变体的预载补全**（业主 2026-10-29）：教官换攻击模式那份 mode 的施放 / 命中行此前没按时装变体预载（播放时可能退回默认那枚）；现在 `keysFor` 对 mode 行与弹道 onHit / onStop 都按 `skins[stem].fx` 预载变体。
- **浮游单元的命中叠教官命中行**（业主 2026-10-29）：附着的未释放无人机与本体同属一次攻击，`FxWiring.damage` → `_landed` 已按这一发的第几次伤害播合并后的命中组（学员 + 教官），不再重复补播；没有攻击记录的**远程单元**（`funnelfx._remoteHit`）与**释放的分散单元**（`_pulse`，荒芜拉普兰德 S3）各自调 `SkillFx.mentorFunnelHit`，把教官 plan 的命中组与 mode 命中行 / 弹道 onHit·onStop 补播到目标上。
- **自增益教官的 plan 不再被误判为空**（业主 2026-10-29）：逻各斯 S3 这类「只改普攻、特效全在攻击命中行」的技能，`skillfx.of` 从前只认 start / range / loop / end 行，`mentorPlan` 整份丢掉（学员本体与浮游单元都拿不到普攻命中特效）；现在 plan 任意一行的 prefab 已装就算，攻击命中行照常继承。
- **简报页的首领卡改成·重构首领**（业主 2026-10-29）：重构模拟的「确认本局信息」左上角此前画的是 `pub.bossId` 那只
  **官方首领**（原版首领不进重构模拟）；现在公开视图带 `pub.recon.bossKey`（= 第 20 回合实际出战的·重构首领，
  `reconBossSpawnKeyFor(bossRound)`，与出怪替换同一个 key），客户端 `screens/briefing.js` 按它取 `enemies.json` 的
  名称 / 图鉴 / `iconId`。官方对局没有这个键，仍按 `pub.bossId` 的 boss 表画，行为不变。
- **预重构屏也有「查看禁用盟约与干员」**（业主 2026-10-29）：策略选择屏左侧那个入口现在在预重构屏的左侧状态列
  （「全员提交后进入队伍总览」下面）也有一个 —— 同一条 `ui/matchInfo.js` 的 `MatchInfo` / `MatchInfoDialog`，模型与简报
  同一份；弹窗底部状态行显示自己的提交状态与「全员提交后进入队伍总览（n/m）」。
- **「特训」按钮挪到调度中心工具行**（业主 2026-10-29）：从休整期顶栏挪到调度中心「剩余可放置角色」那一行的
  **冻结 / 刷新左侧**（`ui/shopBar.js` 的 `train` 槽），同一套 `toolbtn` 外观、**荧光青**（`--mint-400` + 外发光）；
  图标换成业主给的 `public/icons/recon-train.png`（白色线稿按蒙版取 `currentColor`，与大厅重构入口同一画法）。
  本回合已交过时按钮填充成实心青（点开仍可换人 / 取消）。新增 i18n `特训`（en/ja/ko/zh-TW）。工具行在重构对局里
  改用三列（`shopbar__tools.is-train`），特训 / 冻结 / 刷新排在**同一排**（不再让刷新折到第二行）。
- **单次释放类教官的范围 / 特效 / 自建实体的每一发**（业主 2026-10-29）：
  - `mentorSingleCastApply` 触发时把学员的攻击范围**临时换成命中目标所在的那一格**再跑教官的 `onStart` ——
    荒芜拉普兰德 S3 这类**全场**浮游单元在学员范围外命中也照常触发（此前范围外整段不触发）。
  - 客户端：教官是单次释放类（计划里没有攻击行 / 常驻行，只有 range·start 行）时，施放那一下**不再**播官方行，
    改由 `SkillFx.mentorOnceAt` 在**每一次攻击 / 浮游单元每一次命中**的目标处播（`wiring.attack` 与 `mentorFunnelHit` 调），
    不再只有引擎过程化的雷暴。
  - `installMentorApply` 不再一律跳过 `isAttack`：引擎那一次攻击的实例一定带 `attackId`（已被段数覆盖），
    包侧自建实体的「每一发」（丰川祥子的赞乐音符：`isAttack`、无 `attackId`）现在也各触发一次教官效果；
    `isAttack && isSkill` 仍跳过（教官自己技能里的结算，防自我触发）。
  - **只在攻击时触发 + 0.2 s 内置 CD**（业主 2026-10-29 追加）：单次释放类不再被技能 DoT 的 `isSkill` tick 触发
    （此前荒芜拉普兰德 S3 每秒的范围伤害会让它每秒都触发）；`runMentorOnce` 统一计时，攻击路径与伤害路径共用，
    同一次攻击的多段 / 音符连发 / 同帧多笔只在 0.2 s 内算一次（客户端 `mentorOnceAt` 同一窗口同样去重）。
- **重构模拟基础部署上限 9 + 人事部文档改为 +1**（业主 2026-10-29）：重构对局的 `PlayerState.deployCapBonus` 初始为 1
  （官方 8 → 重构 9，官方对局不变）；`equip_destory_deployment_cnt_change`（人事部文档）从「上限变为 9」改成**相对 +1**
  （`ctx.addDeployCap(1)`；官方 8 → 9 与从前同一结果，重构 9 → 10，多件可叠加）。
- **涤墨·挟潮·来：操戈出在自身格**（业主 2026-10-29）：每 10 秒召唤的 2 只操戈从「周围 2 格内的空格」改为**自身所处格**
  （`workshop/dimo-enemies/battle/main.mjs installXiechao`）。`workshop-validate` 0 error。
- **重构协助 / 熔芯负载没选就随机补 1 个**（业主 2026-10-29）：预重构的两项选择缺席时不再等于「没有效果」——
  `Match.fillReconChoices`（`server/match/match/phases.js`）在「队伍总览」亮起时（`enterReconSummary`，超时也走这条）
  给每个座位**各补一个**：已交合法 id 的保留，缺的（含不在六个合法值里的）用 `shared/reconModes.js` 新导出的
  `RECON_ASSIST_IDS` / `RECON_LOAD_IDS` 抽一个。随机数走**独占**流 `deriveSeed(seed, 'recon-seat:<playerId>:<assist|load>')`
  —— 同一 seed + 同一座位恒得同一个（重放一致），不碰别人的流；`finishPreRecon` 再兜一次（幂等）。补选后的值随公开视图
  `pub.recon.choices` 下发，局内「策略效果」两行与装备拆卸开关看到的就是实际生效的那份。官方对局 `reconChoices` 恒 null，
  一个字节不动。
- **熔芯负载改为「排除」**（业主 2026-10-30）：预重构屏的熔芯负载仍是三选一，但**选中的那一项被排除**、另外两项
  **同时生效**（重构协助不变，仍是单选一项生效）。战斗侧 `workshop/mode-recon/battle/main.mjs` 的 `loadActive`
  按「交的不是它」判定（没交 / 未知 id ⇒ 三条都不生效，与从前的「不指定」同一口径），元数据侧装备负载的 3 回合倒计时
  （`meta/main.mjs` `syncLoadDoom`）同一条判据。屏上组头加「选中的一项排除」小注、缩小卡片的标记改 ✕，右侧摘要 /
  队友速览 / 总览 / 局内「策略效果」都改成念**排除的是谁 + 哪两条生效**（`reconProtocolRows` 由一行变两行）。
  回归：`test/match/recon-battle.test.js` / `recon-mechanics.test.js` / `recon-copy.test.js` 全部按新口径重写，30 pass。
- **重构模拟调度中心开到 7 级**（业主 2026-10-30）：`shared/reconModes.js` 合成的 `mode_recon_abyss` 把
  `maxShopLevel` 从 6 提到 **7**，升价补第 6 档 **14**（前五档仍是官方的 5 / 8 / 11 / 12 / 13），第 7 级的
  `shopSlots` 是 **6 张干员卡 + 2 件装备**（6 级仍是 5 + 1）。升级开出的新格子仍是空的，下一次刷新 / 回合开始才补卡。
  官方 `mode_multi_*` 一个字节不动（`maxShopLevel` 仍 6）。回归：`test/recon-curve.test.js` 新增一条
  （7 级 / 升价 / 槽位 / 官方不动）。
- **干员新增 7 阶（红字，只有 7 级调度中心抽得到）**（业主 2026-10-30）：阶级合法范围 1–6 → **1–7**，7 阶没有官方精灵，
  阶级 chip 回落到 CSS 八边形 + **红色数字 `VII`**（`--tier-7: #ff3b30`；战场 canvas 贴图的 sprite sheet 同步从 7 列
  扩到 8 列）。抽卡只在**商店 7 级**时生效：每一格先按 `gd.tier7Share`（缺省 **5%**）摇一次，命中就抽一枚 7 阶；
  **池里没有 7 阶记录时不摇这枚骰子** ⇒ 官方 / 现有对局的 rng 消耗与结果逐字节不变（官方 `maxShopLevel` 仍 6，
  `maxTier` 也夹到 6）。库存 `poolCopies[7] = 4`、阶级价 `chessPrice[7] = 5`；7 阶记录（含 normal/golden 成对）
  由业主后续补，引擎规则已就位。**练度口径（Wiki）**：普通 = 满潜 / 精二 **70 级** / 满信赖 / **7 级技能** /
  **1 级模组**，精锐 = 满潜 / 精二 **90 级** / 满信赖 / **专精 3（skillLevel 10）** / **3 级模组** —— 落在
  `shared/chessAuthoring.js` 新导出的 `TIER7`（作者层默认 status、插件导入器的第 7 阶经济表都用这一份；满潜是运行时
  输入，满信赖已在 Wiki 数值里）。作者层 / 插件记录 / Forge 导入器的 tier 门同步放宽到 **1–7**。回归：新增
  `test/match/tier7.test.js` 4 条（含练度口径）。
- **脱手类教官技能的 kit fx 不再退回引擎默认特效**（业主 2026-10-29）：`FX_BINDINGS` / `FX_COVER` 按**技能 id** 登记，
  异客 S3 的雷暴 / 落雷、蕾缪安 S3 的锁定 / 礼炮这些**脱手类**技能的 fx 全由 kit 发出 —— 学员自己的技能 id 查不到它们，
  于是画的是引擎过程化特效（教官本体是对的）。现在 `SkillFx.of` 记下教官技能的 index 侧 id（`U.mentorSkillId`）：
  `simFx` 的绑定 / cover、`bindsReached`、`_lasts` / `_planDrawn` 先问学员自己的技能、再问教官的影子技能，绑定的特效 key
  按**教官的**时装取变体；`keysFor` 也预载教官技能绑定的键。回归：`test/render/vfx-skillfx.test.js` 38 → **40**。
- **会部署召唤物的教官技能：学员每次攻击 / 每次弹药各部署一枚**（业主 2026-10-29）：技能记录声明了召唤物
  （data `overrideTokenKey` —— 望 S1/S2/S3 的棋子 `token_10064_wang_stone1`、令的三只墨魂、夕 S3 的小自在）时，
  `content/index.js installTraineeSummons` 让学员在**自己的技能期间**每次攻击（落点 = 被攻击目标所在格，不可用时按
  技能顺序就近）与每次消耗弹药（以学员所在格为中心）各部署一枚；技能结束（含弹药打空）时一起退场。无视教官技能的
  弹药 / 部署数量限制，也不占可部署干员数量上限。同一发攻击同时消耗弹药只算一枚；教官 kit 自己就在目标格召唤同一枚
  （夕 S3 的召唤 / 刷新）时不重复叠。**召唤物吃技能自己的效果**（业主 2026-10-29 追加）：教官 kit 可以导出
  `tokenSummon(battle, unit, token)` 钩子，学员部署出的每一枚召唤物都会调它 —— 望的 kit 把棋子登记成她的一片棋子
  （`mem.wangNode`，立即激活、不可选中、不普攻），于是照常按**学员选的这个技能**（S1 停顿 + DoT / S2 连线 + 减速 /
  S3 范围伤害）触发并播 `explode` 特效，攻击力借用学员自己的。回归：`test/match/recon-train.test.js` 39 → **44**。
- **学员施放技能时教官的音效真的响了**（业主 2026-10-29「学员继承教官的技能缺少了教官的音效」）：
  - 客户端：教官那一层与学员自己的技能音用了**同一把节流键**（`unit()` 的 `${unitId}:skill`），后一声必然落在
    160 ms 的单位冷却里被丢掉 —— 叠上去的教官发动音永远是静的。现在教官用 `${id}:mentor` 自己的键
    （`public/js/audio.js` 的 `['skill', id, 1]` 分支），两套发动音同时响。
  - 数据：`data/assets.json` 的 `sfx.units[id].skills` 里原本缺着教官技能的发动音。望唯一一条发动音 bank 就在 S3
    （`battle.ON_SKILL_START.skchr_wang_3`），而清单只在「两个槽以上」时才写 `skills`，整条被丢掉；予愿 S3 的 bank
    带子键（`…skchr_aglna2_3.move_like_projectile.skill_start`），按 skillId 精确查表查不到，槽位落回通用
    `b_char_atkboost`。`tools/assets/audio.mjs` 新增 `skillBanksOf`（先精确 id、再按 `<skillId>.` 前缀收子键 bank），
    `plan.mjs` 用它取每个技能槽的发动音，并允许「只有非默认槽有 bank」也写 `skills`。
  - 重跑 `node tools/fetch-assets.mjs --add-only --asset-source=mirror --voice-langs=cn,en,kr --optional-voice`：
    补齐 9 个之前没计划的官方 mp3（`p_skill_stwctp_s` 望 S3、`p_skill_arstrnstf_s` 予愿 S3 等），重生成清单
    （18 个干员新增 / 补全 `skills` 槽位音）。`ui.enemyTypeIcon/dimo_icon` 是用户提供的图、没有可下载的源，现在也由
    plan 记着，重建不会再把它掉出清单（`--prune` 也不会当孤儿删）。
  - 回归：`test/assets.test.js` 新增 3 条（子键 bank / 唯一非默认槽 / 清单里望与予愿 S3 的发动音），
    `test/ui/audio.test.js` 特训新增 1 条（学员与教官各一声发动音）。
- **望的棋子按对应技能生效、跟子有模型**（业主 2026-10-29）：
  - **棋子技能取错**：望的棋子（`token_10064_wang_stone1`）的 token 记录按主人的技能槽分三条（`sktok_wang_1/2/3`
    = 取势 / 连星 / 天下劫），客户端却只认 `skillIndex` —— token 只有一条技能记录（index 恒 0），于是**永远取到默认
    那条（取势）**。现在 sim 把解析后的那条随快照下发（`UnitInfo.tokenSkill`，`render/app/info.js renderInfo` 转写），
    `render/vfx/skills.js resolveSkill` 按它取官方 plan（`token_wang_skill_01/02/03_hit` 三套特效各归各位）。
  - **特训学员的棋子整段取势**：学员部署的棋子曾按**学员自己**的 loadout 查 token 变体（variants 里没有学员的键 ⇒
    `getToken` 退回第一条变体 = 默认形态 + 取势），继承望的哪个技能都一样。`Battle._tokenDef` 现在对
    `def.traineeMentor` 的召唤物按**教官 def** 解析（技能槽 / 形态 / 模组），映射与 content 层共用
    `simdata.mentorLoadoutOf`。
  - **跟子没有模型**：天赋（铸子）/ 天下劫在相邻格放下的跟子此前只是 `mem.wang.followers` 里的数据（只有 `summon`
    粒子），客户端无处画。`spawnToken` 新增 `noTile`（不写 `_occ`：部署 / 寻路 / `unitAt` 都当这格是空的，与官方
    「跟子不占格」一致），每枚跟子随之生成一枚不可选中、不普攻的装饰棋子 token → 快照里出现、画出棋子模型，
    用掉 / 被部署挤掉 / 望离场时与跟子一起退场。
  - 回归：`test/content/op_wang.test.js` 新增 3 条（跟子 = `noTile` 装饰 token + 用它那条 token 技能、学员 ← 望的
    棋子按教官技能槽、`UnitInfo.tokenSkill`）；`test/render/vfx-index2.test.js` +1（`tokenSkill` 优先于记录里那一条）、
    `test/render/hud-readouts.test.js` +1（`renderInfo` 转写）；`r40a-wang-dp` / `recon-train` / `we2-placement` 全绿。
- **重构战场的整备区恢复 16 + 8**（业主 2026-10-29）：地图被编辑器重新导出时把 `layout.bench` 整段丢了，整备区退回官方
  10 / 5。已把 10 个场名的声明补回 `stage-specs/my_map.json` 与导出的 `stages.json`（普通左右两半 + 4 块 boss 场地 × 2 座），
  `test/recon-bench.test.js` 8/8 重新变绿。
- 回归：`test/match/recon-train.test.js` 25 → **36**（链式 / battleInput 的 chain / 召唤物 / 剑气完整继承 / 驭械术师浮游单元 /
  攻击次数与目标数继承 / kit 直伤叠教官攻击与 afterHit / 单次释放类教官每次攻击 1 次），`test/match/recon-trials.test.js` **13** 条，全套绿。

### 重构模拟：视角 / 首领音乐 / 整备区装备 / R20-R21 首领与路线（2026-10-29）

- **战场取景拉远 20%**：45×60 重构战场的休整期与普通带战斗共用同一套取景，此前整体推近 1.5（业主 2026-10-26「和休整期
  一样拉近 50%」）；业主 2026-10-29「有些太近了」⇒ 改为 **1.2**（`ui/gameLogic/camera.js` 的 `framed` 与 `screens/game.js`
  的 `mapZoom` 同步）。官方 19×21 的图仍不推近。回归：`test/ui/battle-camera-zoom.test.js` 6 条、`gameLogic` 的取景条。
- **首领战斗曲接管其他音乐**（`workshop/mode-recon/ui/music.js` + `public/js/audio.js` 新增 `bossMusicOn` /
  `setBossMusic` / `subscribeBossMusic`）：首领曲一响，战斗自定曲（`ui/battleMusic.js`）暂停让路；**多索雷斯盟约**与
  **颂乐人偶 Fever** 两条例外不被覆盖，但音量压到 **50%**（`workshop/dossoles/ui/music.js` 的 `targetVolume`、
  `workshop/ave-mujica/ui/fever.js` 的 `duck`）。首领离场 / 战斗结束交还，其他曲目照常回来。
  回归：`test/match/recon-music.test.js` 9 条（新增 3 条接管判据）。
- **临时整备区也能把装备配给干员**：`canPlace` 新增 `temp` 分支（装备落在临时整备区那排的干员身上 = `g.equip`，
  别的一律拒绝）；`render/drag.js` 的 `isLegal` / `resolveDrop` / 拖动合法性不再把 `temp` 整段拒收，`screens/game.js` 的
  合法格高亮也扫这一排。回归：`test/ui/gameLogic.test.js` +2 断言、`test/render/drag.test.js` 2 条改按新口径。
- **R20 / R21 的首领真的换成·重构首领**：`reconBossWaveFor` 以前只改 `spawn.key`，而出生读的是 `s.enemyKey ?? s.key`
  （`sim/simdata.js`）⇒ 场上出的始终是模板里那只官方首领（且官方 19×21 的出生点落在 45×60 地图的场地外，看起来「没有
  boss」）。现在 `key` / `enemyKey` / `preview` 一起换；**隐秘核心**那条路径此前整段跳过替换，现与最终攻势一样调用它
  （多 key 组的按区域分场也随之生效）。官方隐秘首领自带的部件（斩胄之剑 / 破胄之锤）不再跟进来。
  回归：`test/match/recon-trials.test.js` 13 → **15**。
- **闭环巡逻线不再「走一圈就消失」**：自绘地图给 boss 场地画的是起点 = 终点的闭环；sim 以前走到终点就 `leak`（首领离场、
  场上什么都没有）。`sim/battle/spawns.js` 给这种路线打 `loop`，`sim/ai.js` 的 `advanceRoute` 在最后一腿走完后回到第一腿
  继续巡逻，不算漏怪。回归：`test/match/recon-routes.test.js` +1。
- **boss 场的护送小怪也走地图**：模板路线是官方 19×21 板上画的，直接用在 45×60 图里会落到场地外（sim 的 `compileRoute`
  把越界坐标夹回边缘 ⇒ 小怪贴着边界蹭）。`waves.js buildBossWave` 现在把模板路线按比例缩进**这块场地的战斗矩形**
  （首领 / 部位仍走该区域的闭环巡逻线），`wave.routes` 同步换成缩放后的表（悬赏敌人一并落进场内）。
  回归：`test/match/recon-routes.test.js` +1。
- **boss 区域整备区用自己那一座的格子**：第 2… 块 boss 场地的整备区是按座位声明的（`bossA{n}:0` / `:1`，两位棋手在场地的
  上下两半），但 `prepCamera` 只带出 `area` 没带 `seat` ⇒ 客户端 `boardGeoNow` / `bossPrepField` 恒按 0 号座取整备格，
  1 号座的博士看到 / 用的是**另一位**的整备格（业主 2026-10-29「不是更改之后的部署区」）。镜头现在把 `seat` 一起带出去
  （`prepCamKey` 也带上它）。回归：`test/ui/gameLogic.test.js` +1。

### 重构模拟：【重构】盟约的激活效果（2026-10-30）

- 业主 2026-10-30（`重构盟约新增相关.txt`）：「根据在场的【重构】干员的数量触发效果 —— 2 人：【重构】盟约干员触发
  特质时额外触发 1 次（每回合 1 次）；4 人：【重构】盟约干员的生命上限与基础攻击力 +50%」。阈值随之从 [1] 改成
  **[2, 4]**（`activeCount: 2`）——只有 1 名学员时盟约条亮起但不生效。
- 数据：`workshop/mode-recon/bonds.json` 的 `bond_recon` 记录写 `bb.recon_trait_extra: 1` / `bb.recon_stat_pct: 0.5`，
  `desc` / `descRaw` / `effectDesc` / `effectDescRaw` 两档同步。
- **休整期**：`EffectDispatcher.reconTraitExtra`（`server/match/effectsMeta.js`）并进 `_garrisons` /
  `triggerGarrisons` 的 `repeat` —— 对**任何**特质钩子都多跑一遍（投资人只在获得时翻倍，这里不限）。预算挂在棋子
  自己的回合计数器（`PlayerState.pieceRoundCount` 的 `recon.trait.extra`），换回合 / 新棋子自动从 0 起算。
- **战斗内**：`server/sim/content/garrisons/battle.js` 的 `fireGain` 在本次层数真的加上之后，为这名【重构】干员再跑
  一次 `fireGainRaw`（`battle._reconTraitExtra` 按单位记，「每回合」在战斗里就是每场）。
- **4 人档**：包 `battle/main.mjs` 的 `installReconBondStats`（`install` 里、与预重构的两条选择无关）按 tier ≥ 2 给
  `S.bondMembers` 挂 `bond:recon:stat`（`S.directMods({ atk, hp })`，与技能 / 装备的 +X% 相加），干员逐波部署所以认
  `deploy` 事件；召唤物不吃（与 `bonds/dataDriven.js` 通用盟约同口径）。
- 回归：`test/match/recon-bonds.test.js` +3（数据面 / 2 人档战斗内 / 2 人档休整期），
  `test/match/recon-battle.test.js` +1（4 人档 ×1.5、2 人档不加、没装包不加）。

### 重构模拟：会移动的 boss 在双人场地里每位玩家各一只（2026-10-30）

- 业主 2026-10-30：「重构模拟 boss 区域里会移动的 boss 应该有两只（参考原版卢西恩），每位玩家的场地各一只，我每个 boss
  区域画的地图路线也是两条；不移动的 boss（例如萨米的意志）还是 1 只，两位玩家同时对抗」。
- 实现：`server/match/match/bossRounds.js` 建战场时，双人场地调 `waves.js mirrorMovingLeaders` —— 把 `tag: 'boss'`
  的那条出怪复制一份到这块场地的另一条巡逻线上（两条线起点都是首领站位中心、终点回起点）；已有出怪（部位）占用的
  路线优先，没有空线就不补。**站定首领不复制**：判定在 `waves.js bossStandsStill` —— 引擎自缚巨型首领
  （`SELF_BOUND`：萨米的意志 / 阿利斯泰尔 / 昆图斯 / 胄 ×2 / 管 ×2）、记录里写 `stillBoss: true` 的
  （源阶方 / 洛伦茨 / 岁四部位 / 伤心的大锁）、移速 0 的（终始）。
- **血量仍是一条整队共享池**：两只同步显示同一根血条，全队伤害一起扣同一条池，池空两只同时退场。单人场地、
  只有一条巡逻线、以及非重构图（没有自绘 boss 路线）都保持原来的一只。
- 包侧 `installStillBosses` 改为读记录的 `stillBoss: true`（不再手写名单）；**伤心的大锁**加入站定名单（此前它按
  0.1 移速慢慢爬巡逻线）。`test/match/recon-routes.test.js` +3（判定 / 复制 / sim 共用池）、
  `test/match/recon-boss-fullmatch.test.js` 按新口径（会移动的 R20 首领每块场地两只，R21 大锁与岁 / 洛伦茨 / 终始仍一只）。

### 重构模拟：隐秘核心候选分档 / 装备上限 / 盟约层数上限（2026-10-29）

- **隐秘核心（R21）候选按房间人数分档**（`shared/reconModes.js RECON_TRIAL_BOSSES[21]`）：**≤5 人**只有伤心的大锁·重构 /
  “阿米娅”，炉芯终曲·重构两条；**6–7 人**加洛伦茨组（`minPlayers 4 → 6`）与“终始”那组（AMa-10 / 异构体 / 终始，6 人起）；
  **≥8 人**才加岁四部位（新增 `minPlayers: 8`）。回归：`test/match/recon-trials.test.js` 新增「按人数分档」一条。
- **每名干员的装备格 +1**（业主 2026-10-29）：重构对局的基础容量 2 → **3**，与装备自身 `params.slot_cap`、维多利亚
  6 名成员的 +1 叠加。服务端 `server/match/gamedata.js equipCapacity`（`isRecon` 时 +1）、客户端
  `ui/gameLogic/placement.js` 的 `equipReplaces`（`ctx.reconMode`）与 `ui/detailPanel.js`（`equipModeBonus`）三处同源。
- **盟约叠加层数上限 999 → 2000**（业主 2026-10-29，只服务重构模拟）：`shared/constants.js` 新增
  `RECON_BOND_LAYER_CAP = 2000` 与 `bondLayerCap(modeId)`，`layerGainRoom(before, n, cap)` 接受模式上限。所有写入点按
  **本局模式**取值：`PlayerState.addLayers` / `bondsView`、SETTLE 合并、`Battle.addLayers`、`unite.helperStats`、
  `fields.validateClientResult`、`invariants`、开发面板 `test`、客户端 `ui/watchBonds.js` 的实时层数。官方对局仍 999，
  一个字节不变。
- **维多利亚·重构的「6 名成员装备 +1」不生效**（业主 2026-10-29）：服务端判定一直是对的，问题在客户端 ——
  `placementContext` 没有接收 `reconMode`（`ctx.reconMode` 恒 undefined），`equipReplaces` 的 +1 分支永远走不到，第 3 件
  仍弹替换对话框。现在 `placementContext` 收纳 `reconMode` 并放进 ctx。回归：`test/ui/gameLogic.test.js` 新增一条
  （重构 3 格 / 维多利亚 4 格 / 官方 2 格），`test/match/equipCapacity.test.js` +2 条（重构基础 3 格、层数 2000）。

### 重构模拟对公网开放（2026-10-29）

- 「重构模拟」本来是**本地实验模式**：`room.create { mode:'recon' }` 只收回环 / 私网会话（`session.local`），大厅入口也只在
  `welcome.devAllowed` 为真的会话上画。业主要在云服务器上开放这个模式、收玩家反馈，新增环境变量 **`SP_RECON_PUBLIC`**：
  设成 `1` / `true` / `yes` / `on` 之后任何会话都能开重构房，`welcome` 多一格 `reconAllowed: true`，客户端
  `screens/lobby.js` 据此画出「重构模拟」入口（`pickMode` 的兜底同一条）。
- **不设 / 写错 ⇒ 关闭**（`LOBBY_DEFAULTS.reconPublic = reconPublicFrom(process.env)`，与 `SP_MAX_SEATS` 同一套纯函数解析）：
  `welcome` 的字段集合一个字都不多，公网握手与从前逐字节相同。「全量模拟」（`room.create.dev`）**不受这一格影响**，
  仍只认本地端。
- 回归：新增 `test/lobby-recon-public.test.js`（4 条：解析器、公网会话没开时被点名拒绝且 `welcome` 无该键、开了之后能建房
  而同会话的 `dev` 仍被拒、本地端照旧）。

### 召唤物的图标让位给官方特效

- **官方特效画出的召唤物不再叠引擎图标**（业主 2026-10-29）：予愿安洁莉娜 S3 起飞留在原地的「一会儿见！」
  （`token_10071_aglna2_agairp`）没有模型 / 头像，客户端提取的特效段（该 token 的 passive loop `token_aglna2_agairp_01`）
  就是它的样子 —— 现在单位视图的兜底图标（召唤物 battle-card 菱形）在官方那一层已装好时不画（`render/units.js`
  `_ensurePicture` ← `ctx.officialLook`，`render/app.js` 按 fx index 判定，只对 `kind: 'token'`）；设置「官方特效」关掉 /
  2D 板 / 该 token 一个 key 都没装时图标照旧回来。回归：`test/render/unitview.test.js` 47 → **48**。

### 战斗音乐切换（对局左下角）

- 对局 HUD 左下角多一个 `♫` 按钮（与设置 / 说明同一排），打开「战斗音乐」面板：从服务器曲目库（官方 BGM + 工坊包）选一首，替换 `prep` / `combat` / `boss` / `unite` 的默认 BGM。
- 走与大厅音乐同一套接管方式（`audio.battleMusicOverride`）：自定曲目由一个 loop 的 `<audio>` 播放，接到 `audio.bgmGain`，**音量与静音沿用游戏设置**；选曲存本浏览器（`sp.pref.battleMusic`），下一局自动沿用，「跟随本局默认音乐」立刻还回引擎 BGM。
- 进入结算 / 大厅时自动停下（与默认音乐一致）；大厅音乐仍有自己的播放器，互不干扰。

### 管理账号（不要口令进后台）

- 账号库某一行标 `admin: true` 即成为管理账号：该账号登录后，统计页 → 账号面板 →「管理后台」不再要求输入管理口令，取列表 / 审核 / 词表都能直接用。
- 服务端 `adminGuard` 现在认两种凭证：`admin.json` 的那串口令，或管理账号这次请求的会话 token；`lookup` 等对外接口不带 `admin` 标记，不会泄露谁是管理员。
- 本服已把 `不知名信箱#1003` 设为管理账号（加性字段，其它账号不受影响）。

### 成就统计面板（官方版式）

- 点开后的面板按官方「卫戍成就」页重排：账号条（头像 / LV / `昵称#编号` / 已获奖杯 / 获赞数）与称号六边形并排，下面依次是「独立模拟 / 同盟模拟」数字表（总模拟数 · 成功卫戍 · 绝境突破）、「卫戍成就」单局纪录（消耗资金 / 晋级次数 / 击败数）、「盟约纪录」「策略纪录」，最后是本服账号成就与页脚说明。
- 六边形、灰色分区条与单局纪录卡直接复用统计页的官方版式（`statistics/titleMask`、`headingBar`、`recordFunds / recordPromotions / recordDefeats`），数字取本机统计 `aggregateStats`。
- 大厅「成就统计」卡横幅中间换成卫戍成就图标（`statistics/headingIcon`：奖杯 + 星 + 括号相框）；左上、左下仍按奖杯数分档。
- 新增文案补齐英文（已获奖杯 / 获赞数 / 账号 / 盟约纪录 / 策略纪录等）。

### 奖杯接入账号库（跨设备累计）

- `server-ext`（包版本 `2.6.0`）的账号库多两样：`trophies`（累计奖杯总数）与 `trophyIds`（已记账的对局 id，去重账本，最多 4000 条）；旧库装载时按 0 / 空账本补齐，无需迁移。
- 新增 lane 操作 `trophies`（读总数）与 `trophySync { records: [{ id, trophies }] }`（上报本机记录）：按对局 id 去重后累加，全是已记过的 id 时不写盘；同一局在两台设备各上报一次只算一次。
- `public/js/ui/achievements.js` 登录后先上报本机「同盟模拟」里自己拿到的奖杯，再读账号库总数；没登录或服务器还没有这两个接口时回落到本机统计。大厅成就卡、等级徽章和成就面板的 `获得奖杯` 都改用这个数，换设备也不再归零。
- 真机验证：本机 11 奖杯 → 账号库 `trophies: 11`、`tbadge--2` / `LV2`；同一记录重复上报仍为 11；无本机记录的第二台设备同样显示 11 / `LV2`。

### 联邦目录与匹配人数

- `public/js/federation.js` 的 `enabled` 改为 `true`：大厅走 `room.list` 目录（单节点，`currentNode()` 为 `local`），房间邀请链接附带 `&node=local`。
- `server/matchmaking.js` 新增 `counts()`（在等且在线的按难度计数）；`roomDirectory()` 的 `room.listed` 多一个 `matchmaking` 字段。
- 大厅每 10 秒的 `room.list` 轮询现在同时写入 `store.lobbyStats` 与 `store.presence.matchmaking` —— 在此之前**没有任何地方写这两个键**，在线人数恒为 1、缺人同盟恒为空、匹配人数永不显示。
- `lobbySimulationPreference()` 在服务器没有 `room.setRandom` 时不允许返回 `firepower`，旧偏好不会把玩家留在看不见的模式里。

### 无限火力

- 仍按能力隐藏（本服没有 `room.setRandom` 与服务端随机玩法骨架）；本次未实现。

### 测试

- 新增 `test/lobby-card.test.js`（协议形状、进房带卡、队友可见、变更广播、未知 id、清空、ready 不变、无服务端错误日志）。
- `server-ext` 的好友 / 名片 / 成就方法用临时脚本做过内存断言（脚本已删除）。

---

**大厅与房间的 ♫ 音乐弹窗新增「Fever 音乐」：颂乐人偶盟约触发 Fever 时可以自己调音量、从本服务器可播放的音乐里选曲，并裁出一段时间替换默认的 KillKiss 两首。**
上游游戏本体仍是 **0.3.1**；`APP_VERSION`（`0.19.1`）**未动**（本节因此也还没有版本号与 tag —— 发版时在最上面加一行
`## <版本> — <日期>` 即可，本段第一句就是那一条公告的摘要）。`PROTOCOL_VERSION`（`2`）与 `MOD_API_VERSION`（`1`）
一个都没抬：`room.state` 只是多了一个**可缺省**的 `feverMusic`（老页面不认这个键、照旧忽略），既有帧的形状一个字节没改；
新增的 C2S `room.feverMusic` 也只由这一版的客户端发。**不需要 `golden:update`**（没有改游戏规则、没有动 `server/sim/`）。

### Fever 音乐：音量、选曲与片段

- 大厅与房间顶栏的 ♫ 弹窗新增「Fever 音乐」段：音量**只作用于本浏览器**（`sp.pref.feverMusic`），改完立即生效并保留。
- 曲目来自本服务器的音乐库：官方 `public/assets/audio/bgm` 与已装工坊包的 `assets/bgm`（按包分组），默认仍是包内 KillKiss 伴奏 / 人声。
- 片段用「开始（秒）/ 结束（秒）」裁（0.5–600 秒），面板显示曲目总时长并可**试听 / 停止试听**；形状不合法时明确提示且不保存。
- 房间内由**房主、开局前**设置并同步全房（`room.state.feverMusic`），开局后不可改；不在房间时改的是本浏览器自己的默认。
- 触发 Fever 时优先播放房间选的曲目与片段；素材未就绪 / 曲目找不到时**回落包内两首**，续播点与 1 秒淡入淡出照旧。

### 服务器：`GET /api/music`

- 新端点只读、无需会话：扫描官方 BGM 与各工坊包 `assets/bgm`，返回 `{ id, kind, pack?, name, url, bytes }`。
- id 折成协议允许的字符并截断到 64；只列**两条路由都认**的扩展名（`.mp3` / `.ogg` / `.wav` / `.m4a`），结果缓存 15 秒。
- 工坊素材路由不宣告 `Accept-Ranges`，工坊曲目在客户端**整段抓成 Blob URL** 再交给 `<audio>`；官方曲目走原 URL（支持 Range）。

### 协议与大厅

- 新增 C2S `room.feverMusic { track?, start?, end? }`：`track` 是音乐库 id（`null` = 默认两首），片段 0.5–600 秒。
- 有 `$check` 时协议层不逐字段跑，所以整条形状（id 字符集 + 秒数范围）写在同一个判据里。
- 服务端只认**房主 + 开局前**，其余返回既有 `NOT_HOST` / `ROOM_STARTED`；不认识的 id 由客户端回落默认，服务端不替客户端取 URL。

### 客户端

- 新模块 `public/js/ui/feverMusic.js`：本地偏好、房间优先的解析、音乐库拉取、工坊曲目的可 seek URL。
- `workshop/ave-mujica/ui/fever.js` 的 `driveMusic` 改为读「当前生效的 Fever 音乐」（房间曲目/片段 + 本机音量），音量乘进淡入淡出与续播。

### 新工坊包：IncogniBox 的音乐扩展包

- 新包 `incognibox-music`（`workshop/incognibox-music`，名称「IncogniBox的音乐扩展包」）：34 首 mp3 放在 `assets/bgm/`，随包分发、随服务器启动装载。
- 它们经 `GET /api/music` 以「工坊包 · IncogniBox的音乐扩展包」分组进入 Fever 音乐曲目列表，同样可选曲、裁剪片段与试听。
- id 由「包前缀 + 文件名」折成协议合法字符；折过字符或截过长的文件名再挂 6 位摘要，保证同一首歌的 id 不随别的曲目增删而变。
- 包自带一条公告（`notice/announcement.json`）与 `assets/LICENSE.txt`；`workshop:validate` 0 error，34 首均实测 `HEAD 200`。

### 大厅音乐：服务器曲目与轮播

- 大厅音乐弹窗新增「服务器音乐」（只列工坊包 bgm，官方 BGM 不进这张表）：选曲即加入**轮播列表**并立即播放。
- 轮播列表可点行切歌、✕ 移出，模式切「列表循环 / 随机播放」；列表、模式与当前曲目随浏览器保存，刷新后恢复。
- 修复服务器曲目「状态显示在播、实际无声」：`replace` 只认 `next.url`（URL 实际在 `next.track.url`）⇒ 元素没有 src；换源 / 解锁 / 开播也改在同一用户手势内完成。
- CSP 显式放行 `media-src 'self' blob:`：上传的大厅音乐与「工坊曲目整段 Blob」不再被 `default-src 'self'` 拦截。
- Fever 音乐：房间没设过时用本浏览器在大厅选的那一份；房主进房后自动把它推成房间设置。Fever 曲目下拉改黑底。

### 多索雷斯：水地形、假日威龙陈与战斗音乐

- 特殊水地形覆盖改为常驻底色（新 `overlay` 原型）：同一 `key` 原地刷新 ⇒ **不闪、不叠加**，颜色由电光蓝 `0x8fe0ff` 暗到 `0x3f7f9f`（alpha 0.1）。
- 水地形并集改用 `baseRangeKeys`：不再把假日威龙陈的 `extraRange`（水地形本身）并回去，旧的格子不会永远留在原地（远离所有人的水块）。
- 假日威龙陈 S2/S3 的攻击特效固定在**她自己脚下的地块**（以她为圆心、半径 2；上一版按攻击范围格子铺会落到敌人那边）。
- 技能特效挂载：prefab 声明了 `FollowMountPoint`、但当前 skin 上**没有那个点**时，改用 prefab 自己的 `ParticleEffect` 出生点（不再落到「脚上方」的兜底）——假日威龙陈 S3 的水花因此回到炮口（`chen2_skill_03_buff_02`：SPECIAL_3 不存在，MP_SPECIAL_2 存在）。
- 多索雷斯包新增 `assets/bgm/dossoles_holiday.mp3` 与对局音乐面板 `ui/music.js`：**场上 4 名【多索雷斯】成员**时把对局 BGM 换成「多索雷斯假日」，人数掉下去还原。

### 3D 棋盘：官方场景战场去掉屏幕雾层

- 屏幕雾层（`board3d/scene.js` `_buildFogOverlay` / `_updateFogRect`）**整个删掉**：它在棋盘投影矩形外铺一层雾色（先是随方向加深的渐晕，后改成 50% 均匀薄纱），无论怎么调都会把场地外的远景压暗成「阴影」。现在官方远景建模按自身光照直接呈现，`render()` 里的雾矩形重算一并移除。
- 对局屏 CSS 暗角（`.gm__vignette`）的上下两条线性渐变压暗带从 78% / 60% 降到 30%（径向暗角保留）。
- 取消「场地聚光」压暗：`board3d/materials.js` 的焦点系数 `uFocusDim` 由 0.72 改为 1。此前相机取景矩形外的所有受光面（含官方远景建模、穹顶钢架）都被乘掉 28%，看起来像落在阴影里；现在场地内外同一套光照。压暗管线保留，系数调回 0.72 即可恢复原来的聚光效果。
- 岛缘渐隐（`board3d/scene.js` 新的 `_buildFade`）**对官方场景战场也生效**：原来 `atlas.fade` 在带 `bgScene` 的图上被跳过，现在无论有没有官方远景都建这一层。位置固定在远景建模（`z = B.z − 2`）与棋盘之间（`z = B.z + 0.05`，renderOrder 5，深度测试仍被棋盘挡住中心），飘雪层 renderOrder 8 更高，继续画在它上面。
- 岛缘渐隐的四边形改为**铺满整幅背景**（与背景阴影板同尺寸，`bgScale` 已按地图窗口放大），蒙版按固定世界尺寸采样（新增 `uCenter` / `uHalf`，取岛长度的 1.5 倍），所以扩大覆盖范围不会把白心缩没：岛周围仍是一大片透明区，往外渐深，方格之外整幅背景被同一层雾盖住，取景边缘再收一圈避免硬直角。
- 修正岛缘渐隐取错了通道：`TX_SkyMirror_Fade_D` 的不透明度在 **alpha 通道**（中心 A=0 全透明 → 边缘 A≈0.95），RGB 只是固定的暗紫色。旧着色器拿 RGB 亮度当遮罩，而中心的 RGB 是 0（黑），算出来恰好是「最不透明」——所以整片背影像一块黑边、白心消失。现在直接用 `texture2D(map, uv).a`。
- 岛外再加一层**灰白霭**（`mat.fadeVeil`，同一张蒙版、同一块四边形、`z + 0.02`、renderOrder 6），颜色 `0xb8c0c8`、不透明度 0.35：远景从纯黑雾变成发灰发白的雾霭。深度测试仍让棋盘挡住它，飘雪 renderOrder 8 仍在其上。

### 新内容：战术特训敌人「涤墨」

- 新增工坊包 `workshop/dimo-enemies`：17 条敌人记录（`enemies.json`，数值取自 PRTS 明日方舟 Wiki 的「危机合约·涤墨作战 / 大炎·墨染书阁」敌人页）+ 18 张头像（`assets/enemy/icon/`）+ **18 套 Spine 模型**（`assets/spine/enemy/`，来自 PRTS 页面里 `SPINEDATA` 指向的 `torappu.prts.wiki/assets/enemy_spine/<官方key>/`，即人形单位同源的官方 3D 骨骼），全部按 `pack.json.art` 声明。
- 官方内部 key 与动画名从 Wiki 页面源码里取：操戈 `enemy_10164_tjgxb`、挽弓 `10165_tjggb`、拔山 `10166_tjgdlb`、挟潮·来 `10167_tjgsfj_2`、浪里玄条 `10168_tjgly`、云中墨贼 `10169_tjgtsz`、霜劫 `10170_wangz`、旺财 `10058_cjfrog`、果腹 `10052_cjshld`、鼎沸 `10054_cjhot`、飘香 `10054_cjhot_2`。模型文件按官方基名落盘，**记录键也已从临时自造键 `enemy_88xx_dimo_*` 全部改成官方内部键**（`factions` 的 pool/entries、`pack.json.art`、素材目录一起改）。
- 动画名不是统一的 Idle/Attack：挟潮·来是 `Black_*`、浪里玄条是 `F_*`、云中墨贼是 `B_*`（A/B 两套形态，取 B）、旺财/招财是 `*_a`、操戈是 `Die_A`；没有 Attack 的（挟潮·来、浪里玄条、飘香）用 `attack: { loop: <idle>, via: 'idle' }` 兜底（与官方 `enemy_10054_cjhot` 同一条）。
- 新增特训类型 `DIMO`「特训敌人·涤墨」（`data/factions.json` 的 `types`/`entries`，`sortId`/`typeIdentifier` 8，`involveRandom: true`、`count: 3`、`pool` 18 个键）。**类型不能由工坊包新增**：`shared/workshop.js` 的 content 合并按「记录 id」并表，`factions.json` 不是 id 表，包里的 `factions.json` 会被静默忽略——所以这一格落在核心数据里，敌人本体仍在包里。
- 类型图标 `dimo_icon`：`public/assets/ui/enemyTypeIcon/dimo_icon.png` + `data/assets.json` 的 `ui["enemyTypeIcon/dimo_icon"]`（用户提供的「特训敌人·涤墨」图）。
- 数值口径：只做基础数值（生命/攻击/防御/法抗/移速/攻速/重量/阻挡/射程/地面或飞行），字格、拓印、窃字等机制尚未实现（`server/sim/content/enemies.js` 不登记这些键 ⇒ 无 kit，按数据白板作战）。`attrPower` 显式写成地面 6620 / 飞行 3000，使官方「同盟险境 R3 每块 6–10 个」的平衡测试继续成立。
- 鼎沸沿用官方已有记录 `enemy_10054_cjhot`（官方自带模型），其余 17 个是本包新增。
- **机制层**（`workshop/dimo-enemies/battle/main.mjs`，`pack.json.server.battle` 通道，不碰引擎 KITS）：操戈/凌=死亡时给八格内涤墨友军叠【操戈增益】（攻 +10/20%、防 +25/50%、抗 +25/50，共享 2 层上限）；挽弓/鸣=索敌按防御最低、普攻三连击；拔山/盖=八格内友军受伤 ×0.75/×0.5 光环；挟潮·来=优先高台、每 10 秒召唤 2 只操戈；浪里玄条/锈=常态隐匿 + 25%/50% 闪避；云中墨贼/蚀=靠近干员一次性偷 25%/50% 攻防；霜劫=死亡时按八格内友军数量（≤3）造成 250% 攻击力范围爆炸；旺财/招财=有币（200% 远程物理、额外选 1 名干员）↔ 无币（仅近战、100%），30/20 秒回币；果腹/饱食=嘲讽；鼎沸/飘香=不普攻，范围内每秒 100% 法伤 + 40% 灼燃。
- 鼎沸/飘香的数据记录 `stats.dmgType` 改为 `none`（引擎据此跳过普通攻击），伤害由包内光环结算。

### 测试

- 新增 `test/feverMusic.test.js`：偏好清洗、房间优先、音乐库扫描、`/api/music`、房主 / 非房主 / 坏片段的真服务器断言。
- `public/i18n/{en,ja,ko,zh-TW}.json` 各补 20 条词条；`test/i18n.test.js` 全绿。

---

**对局屏多了一块可折叠的半透明房内聊天框（工坊包 `server-ext`），为此引擎把 `room.chat` 加进面板能主动发的闭枚举。**
上游游戏本体仍是 **0.3.0**；`APP_VERSION`（`0.19.1`）**未动**（本节因此也还没有版本号与 tag —— 发版时在最上面加一行
`## <版本> — <日期>` 即可，本段第一句就是那一条公告的摘要）。这里**全是加法**：`PROTOCOL_VERSION`（`2`）与
`MOD_API_VERSION`（`1`）一个都没抬 —— 没有新增线上类型、没有任何推送帧形状改变（`room.chat` 本来就是引擎的 C2S，
只是从本刀起**面板也发得出去**）。**不需要 `golden:update`**（没有改游戏规则、没有动 `server/sim/`）。

### 对外显示的版本改用打包的上游那一版

- 启动横幅（`server/http/boot.js printBanner`）与 `GET /healthz` 的 `app`（`server/http/routes.js healthReport`）从本 fork 的发行号（`APP_VERSION` `0.19.1`）改为**上游游戏那一半** `UPSTREAM_VERSION`（`0.3.0`），与标题屏右下角一致（业主裁令 2026-10-18）；`server/plugins/identity.js` 的内容摘要仍用 `APP_VERSION`，一个字节没动。

### 面板发送白名单多一条 `room.chat`

- `PANEL_SEND_TYPES`（`public/js/ui/extensions.js`）从 `room.appearance` / `room.mods` 两条变成三条，加入 `room.chat`。
  它属于**用户动作**那一类：面板发的是**同一条** C2S（与玩家自己在「房内聊天」点了「发送」逐字相同），改的是**别人
  读到的话**、不是这一局的任何数值；能不能说仍由服务端按 `chatMode` / 旁观者身份裁决。
- 客户端在 `ctx.session.send` 里仍先过一遍 `shared/protocol.js` 的 C2S 形状（坏形状**不发**并点名
  `CLIENT_SEND_BAD_SHAPE`）；白名单之外的消息照旧 `CLIENT_SEND_NOT_ALLOWED` —— 「面板能改对局状态的那一天，就是这一层
  失效的那一天」这条边界一字未动。

### `server-ext` 的对局屏聊天面板（`battle-chat`）

- 包 `server-ext` 升到 `1.1.0`，`client.panels` 从两个面板加到三个：新面板 `battle-chat` 挂
  `screen.game.overlay`，在对局屏**左下角、引擎「交流」按钮的上方**画一块可折叠的半透明房内聊天框。
- 它**不建自己的通道**（不声明 `messages` / `scope`），直接订阅引擎 S2C 的 `chat.msg` / `chat.history` 并
  `ctx.session.send('room.chat', { text })` —— 与「房内聊天」说的是**同一段**对话；旁观 / `chatMode` 不是 `'open'`
  时照实把输入禁掉（`store.get().room` 现读）。
- 折叠 / 展开的选择是**模块级、只活这一次页面会话**（不落 store、不落 localStorage）。

### 测试

- `test/modClientPanels.test.js` 的「面板发送白名单」一组扩到三条：`room.mods` / `room.appearance` / `room.chat`
  都发得出去，坏形状与 `room.create` 一条都不发并各自点名；`test/operatorConflict.test.js` 的闭枚举正则同步。
- 口径见 `docs/WORKSHOP.md` §1.9.3（`session.send` 那一格与「为什么只有三条」）、`docs/MOD-SURFACE.md`（「产品功能」那一条）。

---

**包通道多了大厅作用域，工作坊面板多了「大厅左栏」与「房内聊天标题旁」两个挂载点。** 上游游戏本体仍是 **0.2.5**；
`APP_VERSION` **未动**（本节因此还没有版本号与 tag —— 发版时在最上面加一行 `## <版本> — <日期>` 即可，本段第一句就是
那一条公告的摘要）。三个特性**全是加法**：不声明新字段 / 新槽位的包与旧行为**逐字节相同**。
`UPSTREAM_VERSION`（`'0.2.6'`）与 `PROTOCOL_VERSION`（`2`）、`MOD_API_VERSION`（`1`）**一个都没抬** ——
没有新增线上类型、没有改任何推送帧的形状（`pack.msg` 帧一个字节没动，只是它的**广播范围**多了一档）。
**不需要 `golden:update`**。

### 包通道的大厅作用域：`client.panels[].scope`

- 面板可多写一格 `"scope"`，取 `"room"`（缺省）或 `"lobby"`。写 `"lobby"` 的面板，它 `messages` 里声明的通道成为
  **大厅作用域** —— `pack.msg` 广播给**不在任何房间**的每一个已连接会话，**发送者自己在不在房间都一样**
  （房间里的「同盟邀约」因此能送到大厅里还没进房的博士）。**新拒绝码 `CLIENT_BAD_PANEL_SCOPE`**：只有这两个值，
  写别的整包被拒（与坏通道名同一形态）。
- 不写 / 写 `"room"` ⇒ 与从前**逐字节相同**：不在房间里发照旧回 `NOT_IN_ROOM`，房间作用域只送本房成员与旁观者。
- 服务端由**同一批面板清单**推出「包 → 大厅通道集合」（`packLobbyChannels`），没有第二份真相；归一化只在 `"lobby"` 时
  写下这个键，老包的摘要逐字节不变。

### 两个新的组件渲染挂载点：`screen.lobby.aside` 与 `screen.room.chat`

- `client.panels[].slot` 的闭枚举多了两格：**`screen.lobby.aside`**（大厅左栏底部、底部模式按钮之上那块空处，
  `screens/lobby.js` 的 `<aside class="hub-side">`）与 **`screen.room.chat`**（房内聊天面板的标题行旁，
  `screens/chat.js` 的 `Panel`）。计数因此是 **十四个挂载点 = 四个浮层 + 十个组件宿主**。
- 两格都是「插进**已存在**的组件」那一半：容器由组件自己渲染 `[data-mod-slot]`，**不是**引擎按需创建的浮层
  （`MOD_PANEL_CREATED` 仍然是四个）；两侧表（`shared/workshop.js` 与 `public/js/ui/extensions.js`）同改并由测试逐字钉住。

### 测试

- `test/packLobbyScope.test.js` 新增：大厅会话发大厅通道 ⇒ 其它大厅会话收到 · **房间里**发大厅通道 ⇒ 大厅会话仍收到 ·
  没声明大厅作用域的通道在大厅发 ⇒ `NOT_IN_ROOM` · 房间作用域的通道在房里发 ⇒ 只送本房。
- 口径见 `docs/WORKSHOP.md` §1.9.3（十四个宿主）与 §1.9.6（`scope`）、`docs/MOD-SURFACE.md`（`client.panels.scope`）。

---

**房间里的模组集合可以改了，solo 房也能声明它，工作坊面板多了第 10 个挂载点。** 上游游戏本体仍是 **0.2.5**；
`APP_VERSION` **未动**（本节因此**还没有**版本号与 tag —— 发版时在最上面加一行 `## <版本> — <日期>` 即可，本段
第一句就是那一条公告的摘要）。`UPSTREAM_VERSION`（`'0.2.6'`）与 `PROTOCOL_VERSION`（`2`）、`MOD_API_VERSION`（`1`）
**一个都没抬**：只新增了一条 C2S 消息与一个面板挂载点，**推送帧的形状一个字没变**（`room.state.mods` 这个键从 W-A
起就在，仍然「不声明就没有」）—— 按 `shared/constants.js` 那条口径（只有推送帧形状变了、旧页面会读错才抬），
新增一条客户端消息不在其中。**不需要 `golden:update`**（没有改游戏规则、没有动 `server/sim/`）。

### 房间内改模组集合（`room.mods`，房主）

- 新增 C2S **`room.mods { modIds }`**：房主把这一房声明的集合换成另一个（`[]` = 改回「不声明」，即这一局按服务器
  加载的全部模组跑）。此前只有建房那一次能选 —— 点错了、或者开好房才发现要跑哪几个包，唯一的办法是解散重开，
  而重开要把已经坐进来的博士全赶出去。形状与 `room.create.modIds` 逐字同形，但**必填**：缺了它，「声明空集合」与
  「消息坏了」就分不开了。
- **三道守卫，全部点名拒绝**：`NOT_HOST`（只有房主）；对局已开 ⇒ **新错误码 `MOD_SET_LOCKED`**；**任一真人座位
  已就绪** ⇒ 同一个码（那个人的客户端是按旧集合对齐完才点的准备就绪）。**AI 座位不算**：`addBot` 建出来的座位天生
  `ready: true`，而 AI 从不对齐任何字节 —— 照字面收进这条判据，房主一加 AI 队友就再也改不了集合。
- **为什么新造码而不复用 `NOT_READY`**：`NOT_READY` 说的是「还有玩家没准备好，所以开不了局」，这一格说的是
  「集合已经锁住了，改不了」—— 两句话在界面上正好相反，复用会让玩家读到一个与事实相反的理由。四个语言包都补了
  它的文案。
- **双检**：进 handler 先判一次，**真正应用之前再判一次**（借 Ave-Mujica 的设计：另一个会话可能刚刚让某个座位
  就绪、或者开了局）。今天这个 handler 是同步的，但守卫与改动之间的距离是它唯一的脆弱点。
- 改完**立刻物化**新摘要的数据面（`roomAssets.forRoom`）并广播 `room.state`；**所有真人（房主除外）退回未就绪**。
- **加入者怎么重新对齐**：客户端按新的 `mods.digest` 重跑 `planAlignment`，而且**摘要一变就先锁住准备就绪** ——
  核对出结论之前，上一份摘要的 `ok: true` **不是关于这一份集合的结论**（那一瞬间放行就是「拿旧结论点下去」）。
- UI：房间屏房主这一侧多一个「更改本房间模组」（`public/js/screens/room.js`），可选列表就是 `welcome.mods.packs`；
  入口给不给由纯函数 `canEditRoomMods` 判（与服务端守卫**同一份读法**，有真跑的判据）。

### solo 房也能声明集合，而且房主缺件时开不了局

- 建房屏的模组选择器此前**只在 co-op 出现**，而服务端从不按模式分支（`resolveRoomModSet` 建房时无条件跑），
  W-B 又让声明的集合**真的决定这一局跑什么** —— 所以 solo 房声明它是有效的，从前只是**客户端没给入口**。
  两个建房屏的守卫收成一处 `hasRoomModPicker`（一份判据，两个渲染点共用）；干净安装逐字节不变。
- solo 房主现在**也**走对齐硬门：本机缺件（或还在核对）时**「开始模拟」被挡住**，补齐即可开。理由是 solo 房没有
  第二个人的「准备就绪」能替他挡，而缺件开局之后没有任何人能拦。**非 solo 的口径一个字不改**（co-op 房主的开始
  照旧不看自己本机的对齐 —— 那是 W-D 定的开局政策，改它等于换一条开局政策）。判据本体收成 `isAlignBlocked`，
  两个门读同一份。

### 工作坊面板：第 10 个挂载点 `screen.room.aside`

- `client.panels[].slot` 的闭枚举多了 **`screen.room.aside`**（房间屏的旁栏），两侧表（`shared/workshop.js` 与
  `public/js/ui/extensions.js`）同改并由测试逐字钉住。它属于「插进**已存在**的组件」那一半：容器由房间屏自己渲染
  `[data-mod-slot]`，**不是**引擎按需创建的浮层（`MOD_PANEL_CREATED` 仍然是四个）。计数因此是
  **十个挂载点 = 四个浮层 + 六个组件宿主**。
- `PANEL_SEND_TYPES` 多了 **`room.mods`**：面板（房主侧的那种）也能发这一条。**`room.create` 依旧不在表里** ——
  面板能改对局状态的那一天，就是这一层失效的那一天。

### 测试

- `test/roomModSet.test.js` 新增 9 条：房主改集合成功（`room.state.mods` 广播、**新摘要与 `modSetOf` 一致**、
  其它真人被退回未就绪）· 非房主 `NOT_HOST` · 不在房间 `NOT_IN_ROOM` · 已开局 `MOD_SET_LOCKED`（并逐字断言
  **不是** `NOT_READY`）· 有人就绪 `MOD_SET_LOCKED`、他取消就绪后又能改 · AI 座位不锁集合 · 未知包名
  `MOD_UNKNOWN` · 同一份集合幂等（不广播）· 协议形状与 `MOD_SET_LOCKED` 的四个语言包。
- `test/client-static.test.js`：solo 建房屏拿得到选择器 · `canEditRoomMods` 六种输入 · `hostStartAlignBlocked`
  的 solo / 非 solo 两面。
- `test/modClientHosts.test.js` 与 `test/modClientPanels.test.js`：第 10 槽两侧同表、由组件渲染、**不**按需创建、
  不是可重复宿主；面板发 `room.mods` 被接受、发 `room.create` 仍被拒。
- 详细口径见 `docs/META.md` §1.9c、`docs/WORKSHOP.md` §1.9.3（槽位表与注入面）、`docs/design/network.md` §8.1。

---

> **维护规矩**：每发一版，新节写在**最上面**；顶层掉出公告窗口的那些节，**可以**移进对应的分卷
> （守卫 `test/docs-paths.test.js` 只要求「顶层仍能发满 8 条」，所以不急 —— 但顶层会一版一版变长）。
> 动顶层或分卷前先读 `test/docs-paths.test.js` 里那条守卫：**每一节只能出现在一处**。

| 卷 | 版本（新 → 旧） | 日期 | 文件 |
|---|---|---|---|
| **顶层** | 0.19.1-0.3.1 · 0.19.1 · 0.19.0 · 0.18.7 · 0.18.6 · 0.18.5 · 0.18.4 · 0.18.3-0.2.6 · 0.18.3-0.2.5 · 0.18.2-0.2.5 · 0.18.1-0.2.5 · 0.18.0-0.2.5 · 0.17.0-0.2.4 · 0.16.0-0.2.4 | 2026-10-12 – 2026-10-17 | 本文 |
| 0.15 | 0.15.3-0.2.4 · 0.15.2-0.2.4 · 0.15.1-0.2.4 · 0.15.0-0.2.4 | 2026-10-11 – 2026-10-12 | [docs/changelog/0.15.md](docs/changelog/0.15.md) |
| 0.14 | 0.14.0-0.2.4 · 0.14.0 | 2026-10-10 – 2026-10-11 | [docs/changelog/0.14.md](docs/changelog/0.14.md) |
| 0.13 | 0.13.1 · 0.13.0 | 2026-10-10 | [docs/changelog/0.13.md](docs/changelog/0.13.md) |
| 0.12 | 0.12.1 · 0.12.0 | 2026-10-10 | [docs/changelog/0.12.md](docs/changelog/0.12.md) |
| 0.11 | 0.11.1 · 0.11.0 | 2026-10-10 | [docs/changelog/0.11.md](docs/changelog/0.11.md) |
| 0.10 | 0.10.0 | 2026-10-09 | [docs/changelog/0.10.md](docs/changelog/0.10.md) |
| 0.9 | 0.9.4 · 0.9.3 · 0.9.2 · 0.9.1 · 0.9.0 | 2026-10-08 – 2026-10-09 | [docs/changelog/0.9.md](docs/changelog/0.9.md) |
| 0.8 | 0.8.2 · 0.8.1 · 0.8.0 | 2026-10-08 | [docs/changelog/0.8.md](docs/changelog/0.8.md) |
| 0.7 | 0.7.3 · 0.7.2 · 0.7.1 · 0.7.0 | 2026-10-08 | [docs/changelog/0.7.md](docs/changelog/0.7.md) |
| 0.6 | 0.6.4 · 0.6.3 · 0.6.2 · 0.6.1 · 0.6.0 | 2026-10-07 | [docs/changelog/0.6.md](docs/changelog/0.6.md) |
| 0.5 | 0.5.0 | 2026-10-07 | [docs/changelog/0.5.md](docs/changelog/0.5.md) |
| 0.4 | 0.4.2 · 0.4.1 · 0.4.0 | 2026-10-07 | [docs/changelog/0.4.md](docs/changelog/0.4.md) |
| 0.3 | 0.3.1 · 0.3.0 | 2026-10-06 – 2026-10-07 | [docs/changelog/0.3.md](docs/changelog/0.3.md) |
| 0.2 | 0.2.2 · 0.2.1 · 0.2.0 | 2026-10-06 – 2026-10-09 | [docs/changelog/0.2.md](docs/changelog/0.2.md) |
| 0.1 | 0.1.3 · 0.1.2 · 0.1.1 · 0.1.0 | 2026-10-02 – 2026-10-04 | [docs/changelog/0.1.md](docs/changelog/0.1.md) |

> 分卷文件**只存在于源码仓库**：玩家包里只带这一份顶层文件（`tools/package.mjs` 的 `PLAYER_DOCS` 不含
> `docs/changelog/`），所以上面那些链接在**解压出来的整合包里**是断的 —— 那 13 卷是**开发史**，玩家不需要；
> 要看就回源码仓库。

---

## 0.19.1-0.3.1 — 2026-10-19

**整包跟到上游 0.3.1。** `UPSTREAM_VERSION` 由 `'0.3.0'` 抬到 `'0.3.1'`；`APP_VERSION` **不动**
（`0.19.1`）—— 这一版只跟随上游，按 `shared/constants.js` 那条口径：只跟随上游的版本保持 `APP_VERSION`、
移动 `UPSTREAM_VERSION`。发行 tag 是 `v0.19.1-0.3.1`。`PLUGIN_API` 抬到 `{ current: 2, min: 1 }`
（旧包仍按 `min` 装得上）；`PROTOCOL_VERSION`（`2`）与 `MOD_API_VERSION`（`1`）**一个都没动** ——
推送帧的形状没变，`golden` 一个场景都没移动。

上游 0.3.0 → 0.3.1 是 **215 个提交 / 537 个文件**。下面按「玩家能看见什么」分组。

### 皮肤（docs/SKINS.md）

- 渲染层补上整块**皮肤呈现**：`skinOf` / `applyInfo` / `setMe` / `setSkins` / `refreshSkins`，以及
  boss 搭档的只读准备视图（`syncReadOnlyPrepUnits`）—— 皮肤是视图模型的一部分，换了就丢掉重建，
  正在跑的战斗不重启播放
- 设置里多了一行**「显示其他玩家的皮肤」**：关掉时**别的座位**的棋子画成干员自己的模型；
  没有主人的单位（装置、敌人）本来也没皮肤可丢。刻意的不对称：你画什么是你的选择，别人画什么是他们的
- 四个同步引擎里的第四个：`room.skins { skins }`（`ui/loadoutSync.js` 的 `installSkinsSync`）。
  与另外三个不同，它**任何相位都收** —— 外观是纯客户端的事

### 音效与素材

- 攻击 / 受击音效改成**按池引用**（上游 #680）：单位条目只记 `pools: { attack: … }`，
  音高 / 延迟 / 音量**只存一份**在 `audio.sfx.pools`（941 个池、484 个单位）
- 官方表的**大小上限与形状校验**接上（`tools/assets/cache.mjs` 的 `maxBytes` / `validate`）：
  坏表不再被当成「已经下过」永远复用；原子写换成唯一临时名 + `finally` 清理
- `data/local-assets.json` 与 `public/assets/local` 换成**上游 0.3.1 完整包**那一批（1697 条）

### 测试房间

- `welcome` 带 `testMode`；聊天、席位上限、host 迁移、观战、限流、审计在测试房间里都有独立口径
- 观战座的 `g.test` 先交给 `applyTestCommand` 再拒 —— 它要写审计并占限流格子，
  在入口直接拒会让它既不进日志也不占格子

### 战斗与装备

- **流形战斗**：attack 循环换成 combat clip，技能循环也换成它（我先前把这段当成死代码删过，已恢复）
- 装备拆卸（`unequip: "allow"`）：两条开关来源（房间规则优先，其次模块层 `behaviour`），
  「不是已装备」与「找不到」分开报；临时整备区仍是 **5 格窗口**（两处都满就 `HAND_FULL`）
- 装备位策略统一到**一个对局入口**（`matchSlotPolicy`）：`plus` 档下变形同构体不占格、
  每名干员最多一件、顶替只挑真占格的那一件
- 详情面板的 `EQUIP n/2` 与盟约链按这一页的形态档位算；「卸下」按钮只看调用方给没给 `onUnquip`

### 插件

- `PLUGIN_API` 到 **2**；工作室多两条控制台路由（`/studio/api/console/options` 与 `/console/build`），
  表面表与 `docs/PLUGIN-API.md` 跟着重生成
- `runner.js` 转出 `loadBrowserSim`（工作室控制台自己拿浏览器侧的战斗模拟器）
- 工坊：一个目录如果自己声明了 `plugin.json`，它是**插件示例**、不是坏包（静默跳过）
- 补回 `items.js` 的 `unequipAllowed`（`shared/modSurface.js` 里那一条是**工坊包声明依赖的公开面**）

### 其它

- `tools/assets/plan.mjs` 取上游 0.3.1，**并把我们 fork 的 `voiceLang` / `voiceLangs` 合回去** ——
  上游把它换成了 `VOICE_OPTIONAL_TREES`（`voiceEn` / `voiceKr` / `voiceNative`），两套并存：
  我们这套按「干员各选一套」用，上游那套按「整棵树换一套」用。默认配音仍是 `jp`（0.9.0 业主决定）
- 头像解析链的**精确键提前到后缀之前**（跟上游 `chessPortraitUrl` / `chessAvatarUrl`）
- 调配同步：休整期提交**带显式默认值**（「把某一格改回默认」必须把默认值发出去，
  只从 `entries` 里删掉那一格服务端会保留原来那份）
- 派生模组 trait 时补 `modeOnly` / `rangeExpand`（GitHub #700 的中文读数）
- `Match` 里那次多余的、无参数的 `GameData` 构造删掉（它把带 mod 层选项的那一次整个覆盖了）

### 验证

```
node --test（串行）  11178 项 · 0 失败（18 项按环境跳过：真实浏览器 / 真实网络）
npm run ci           setup / test / smoke / lint / imports / typecheck 全部 ok
npm run golden       全部场景 match（0 移动）
i18n                 2416 msgids × 4 语言 · 100 %
```

### 已知限制

- 联网的 `fetch-assets` 需要 `node --use-env-proxy` + `HTTPS_PROXY`（Node 的 `fetch` 不读系统代理）
- 本地素材提取（`tools/local-extract`）需要 Python + `UnityPy` 与本机客户端；没有客户端时
  从完整包复制 `public/assets/local` 与 `data/local-assets.json` 即可
- 8 个 `test/mod*.test.mjs` 改用 `.test.js`：仓库已声明 `type: module`，而 `npm test` 的 glob 只收 `.test.js`
  —— 它们此前**从未被执行过**

## 0.19.1 — 2026-10-17

**补完上游 0.3.0 合入时没落的一半：两个设置区块、一处既有函数的缺失赋值，外加一批测试与文档的对齐。**
`APP_VERSION` 由 `0.19.0` 抬到 `0.19.1`（`CACHE_NAME` 认这个数，旧缓存因此自然换名）。
`UPSTREAM_VERSION` 仍是 `'0.3.0'`，`PROTOCOL_VERSION`（`2`）与 `MOD_API_VERSION`（`1`）**一个都没动** ——
本版不改推送帧的形状，**不需要 `golden:update`**。发行 tag 将是 `v0.19.1-0.3.0`。

> ⚠️ **本版的修复都不在 `0.19.0` 的发行包里**（那一版对应 tag `v0.19.0-0.3.0` / `37e16197`）：
> `0.19.1` 对应新 tag —— **包与 tag 一一对应**，拿到旧包的人需要重新下载。

### 补落：`0.3.0` 合入时只落了一半的三处

这三处在合入时留在了 `*.rej` 里，**症状各不相同**，第三处最隐蔽。

- **设置「秘术师能量」**（`mysticEnergy`）：渲染侧当时已齐（`render/app.js` 的默认 `false` 与 live `setSettings`、
  `render/units.js` 的读取），而**设置侧四样全缺**（`DEFAULT_SETTINGS` 的键、`sanitizeSettings` 的归一、
  对话框的开关、四语文案）⇒ 设置页里根本看不到这一格。本版补齐四样，逐条与本仓既有的「弹药数量」同形。
- **设置「外观插件」区块**（`CosmeticSection`）：整个区块没搬进来，而 `plugins-client:437` 要它。
  ⚠️ 这**不是依赖缺失** —— 该函数用到的 14 个符号本仓 14 个都在（3 个已 import、11 个只是没 import）；
  本体照上游逐字补入，并按上游次序挂在「快捷键」与「诊断」之间。
- ⭐ **`lastBgmKey` 的两处赋值**：`refreshBgm()` 与 `main.js` 的订阅、注释**都在**，
  **只有 `lastBgmKey` 的初始化与赋值缺了** ⇒ 那个条件恒假 ⇒ **清单在音乐下面变了也从不重切曲目**。
  ⚠️ 症状是「房间套到达后音乐不换」，很容易被当成「设计如此」而不是 bug。本版补上那两行。

### i18n

- 上述两处共补 **6 个 msgid × 4 语种**（阶段1 两键、阶段2 四键），逐字取上游成品。
  `node tools/i18n.mjs check --all --strict` → 四语 **2101/2101 = 100 %**，`0 missing / 0 errors`。
  ⚠️ 新增的 6 键里，「本服务器安装了 {n} 个插件」**代码里没有 `t()` 调用**（只有 4 处注释提到它，
  上游亦然）⇒ i18n 工具按「代码实际引用的 msgid」计数，**不计**这一条 ⇒ 总数是 **2101** 而不是 2102。

### 测试与文档对齐（不改运行行为）

- `runner.js` 的 `SIM_DATA_FILES` 改成从 `simLoader.js` **re-export**，去掉重复定义（两份内容逐字节相同、
  且没有任何外部代码从 `runner.js` 导入它）。
- `raid-body-window`：解码 `bodyKeys()` 改用引擎的 `COLS`（`GEO.CANVAS_COLS` = 33）；
  原先硬编码 21（那是 `flatStage` 的场景宽度）⇒ 同一个 15 格矩形被解成三段互不连通的格。
- `studio/trial`：不再断言 Node 的 `child.killed` —— Windows 上 `taskkill /T /F` 已经杀干净，
  那个内部标志恒为 `false`；改成验「进程真的没了（`process.kill(pid, 0)` → ESRCH）」+「额度回到 0」。
- `plugins/ui`：只对**真正的意图键**断言（`isIntentType` 自己分类，不硬编码名单），
  并反向断言「C2S 里确实还有非对局消息」。
- `plugins-audio`：mock 照**真实服务器**行为造（`/media/…` 404 带 `Content-Type: text/html`）；
  语音回落那条改用「失败被报告 + 不播放」，并把「插件语音素材坏了就听不到」这个缺口记档（见下）。
  另补落 `lastBgmKey`（见上）。
- `packServerSurface`：把「包可见白名单」（4 个 `SP_*`）与「引擎私有」（`SP_CSP` / `SP_MATCH_HOST` /
  `SP_PLUGIN_SCRIPTS`）拆成两份归类，并断言引擎读到的等于两者之并、且互不相交。
- `modI18n` / `modPluginPackDelivery`：插件包补丁与我们的重叠由 4 条变 6 条（`数值` / `正在读取…` 是
  `b13d80b6` 之后引擎自带的）⇒ 新增 74 − 6 = **68**；`en` 的冲突表多一条 `数值`。
- `.gitignore`：补 5 条**锚定**条目（`/node_modules` `/public/vendor` `/public/assets` `/public/fonts` `/.cache`），
  让「worktree 用符号链接共享这些目录」的形态也被忽略。
- `formNames.js`：用生成器重跑（补上 `enemy_9011_acrefr`）。
- 相机：`issue602` 用 **prep 带**（`r0 = GEO.HAND_ROW`）而不是普通带；`bigmap-client` 记录
  **D29 之后 prep 与 pen 共用同一条带**（上游 0.3.0 同形），并加反向断言防回退。
- 文档：`promptCitations` 抓到的 **30 处行号漂移 + 4 处成员引用不符** 全部对齐到真正含该成员的那一行。
- `raid-body-window`：解码 `bodyKeys()` 改用引擎导出的 `COLS`（`server/sim/constants.js` 的 `GEO.CANVAS_COLS`）——
  原先硬编码 21（那是场景宽度）⇒ 同一个 15 格矩形被解成三段互不连通的格，断言本身是错的。
- `plugins/ui`：`C2S` 是一张**共享**消息表（除对局意图外还有查战绩 `records.mine`、资源与包间消息），
  所以只对 `isIntentType` 认出的**真正的意图键**断言，并反向断言「C2S 里确实还有非对局消息」——
  分类而不是抄一份名单，C2S 增长时不会漂。
- `deploy-replay`：`screens/game.js` 那条接线 effect 的依赖表**本仓库比上游多一个 `myId`**（effect 体内确实读它）
  ⇒ 源码锚点跟着本仓库的依赖表走，`roundStartReplay` 在它之后等其余判据一字不动。
- `plugins/errors`：扫「代码里出现过的 `PLUGIN_*` 字符串」时**先剥掉注释** —— 文档注释里为了**提到**某个名字而写成的
  `PLUGIN_APP_VERSION`（`shared/constants.js`）是版本常量、不是错误码，本就不该进错误目录；剥注释比维护一份
  「例外名单」稳。
- `unequip`：`allow` 档那个「手牌与临时都满 ⇒ 原子拒绝（`HAND_FULL`）」的分支**0.3.0 起不可达** ——
  临时整备区成了**无界队列**（五个显示格只是窗口，超出的排队保留），所以这条用例改钉新语义：
  手牌满且五个显示格满 ⇒ 追加进队列尾部，装备不丢、手牌一位不动。
- `workshopKits`：断言落到**真正构造战斗的那一处**（`e.host.start(e.spec, { … logger, kits, tokenKits … })`），
  不再钉 `createBattleFromSpec(...)` 的实参形状 —— 0.3.0 把那一步交给宿主了，两张 kit 表仍必须挂在同一个落点。
- `packNotices`：挤掉「引擎最旧那条」的判据从**版本串**改成**条目身份**（版本 + 摘要）—— 本仓库 `CHANGELOG.md` 里
  有两个解析后同为 `0.18.3` 的真实发布节（`0.18.3-0.2.6` / `0.18.3-0.2.5`），只比版本串会把「留在窗口里的孪生节」
  误读成「最旧那条没被挤掉」。
- `studio/trial`：不再断言 Node 的 `child.killed`（Windows 上 `taskkill /T /F` 已经杀干净，那个内部标志恒为 `false`），
  改成验「进程真的没了（`process.kill(pid, 0)` → `ESRCH`）」+「额度回到 0」，两个平台同义。
- 夹具的平台差异（语义不动）：新增 `test/helpers/links.js` —— 造目录链接遇 `EPERM`（Windows 无开发者模式）时退回
  **junction**（`isSymbolicLink()` 同判）⇒「链接不被跟随」那批断言一字不改；**文件**链接无等价替代物
  （junction 只能指目录）⇒ 两条用例带原因 `skip`，Linux 照跑。
- 本地跑法：脚本沙箱的探针上限本就由 `SP_SCRIPT_PROBE_MS` 覆盖（500–60000，给慢/忙的机器），本机跑全量 CI 时设
  `20000`；`script-review` 那条「默认 5000」的断言相应改成只在未设该变量时才断言，CI 语义不变。

### ⚠️ `cs` 会随 `APP_VERSION` 变（知情项）

- `server/plugins/identity.js` 的 `computeVanillaContent` 把 `app` 放进 `contentHashOf({ app, sim, data, … })`，
  而 `shared/plugins/identity.js` 的 `contentHashInput` 明确含 `app: String(app)`。
  ⇒ **换版即换内容集身份 `cs`**，与 `CACHE_NAME` 同一思路，属设计而非缺陷；换版后首次会全部重算。
- ⚠️ **诚实局限**：这一点只核到 identity 那条链
  （`server/plugins/identity.js:121` → `shared/plugins/identity.js:96`），
  **未做全仓验证「抬版本是否影响持久化数据」**。

### 引擎新增：技能槽 `hold`（技能持续期间保持姿态）（2026-10-18）

- `public/js/render/spine.js` 的 `case 'attack'` 收尾：技能槽可声明 **`hold: true`** ⇒ 该技能**持续期间**每次攻击
  播完回它自己的 `idle`（有的话）或 **`loop`**，而 `end` 只在技能结束时播（`setSkill(false)`）。起因：业主报告
  「八幡海铃的 2 技能持续期间用的是 end」，而 `end` 是**每次攻击**后插播的。
- **只加不改**：不声明 `hold` 的槽**逐字不变** —— 官方「宴 S1 分神」每次施法后仍播 `Skill_End`
  （`test/render/feedback3-skill-idle.test.js` 把这条钉成 "unchanged"）。
- 生效处与实测记在包内 `workshop/ave-mujica/README.md` §7.17（初华 / 海铃的 S2 共 **8** 处：前向 / 后向 × 本体 / 时装）；
  `docs/ASSETS.md` 的技能片段一节同步记了这个字段。

### 已知问题（未在本版处理）

- **插件语音素材坏了 ⇒ 该槽没有声音**：`voice` 的 `fallback` 语义是「所选配音语言缺这句 ⇒ 用默认配音同名的文件」
  （上游 0.3.0 的 `voiceLine` 逐字同义），**不覆盖「插件素材坏了」**；`bgm` / `sfx` 走 `mediaUrl` 回落、
  `voice` 不走，**上游亦然**。要不要补「插件坏了回落到安装版」作为一个独立特性，待定
  （副作用：回落会掩盖插件作者的错误 ⇒ 需「能播 + 仍有 `onFailed` 报告」）。
- **打包白名单不含作者资源**（`plugin-package` ×3 / `update-package` / `plugins/registry:296`）：
  改的是发行包内容，需单独拍板。
- **82 个 `*.rej` 里 30 个对应补丁仍未落**（实测：已落 12 · 部分落 37 · **未落 30** · 无可判行 3；
  基准 `18389f88`。本版之后 `lastBgmKey` / `officialFx` / `.gitignore` 等已落，当前工作区是 29 ⇒
  以「未落」计数落在 29–30 之间，随每笔补落递减）。
  且**已发布的 `0.19.0` 包里带着 62 个**：那是 `scripts/make-windows-bundle.mjs:78` 的
  `SKIP_TRACKED = ['test/']` —— 打包**复制全部 git 跟踪文件、只略过 `test/`**，
  所以 82 个里 `test/` 之外的 **62** 个跟着进了包。
  ⚠️ **不是 npm 白名单**（`isPlayerFile` 只判 38 个）—— 两个口径不同，别混。
- ⚠️ **一条时序型 flaky**：`test/ui/plugins-content.test.js:372`
  「a content set still loading when the b.start comes (a reconnect): the authority once it is there」
  —— 失败形态是 `TypeError: Cannot read properties of undefined (reading 'authoritative')`（`:380`）；
  实测单独重跑 3 次 **1 红 2 绿**，且 `run6`（本版之前）就已记录 ⇒ **非本版引入**，待单独修。
  ⚠️ 本版**没有**动它（单独改它属「为变绿而动测试」，不在本轮范围）—— **记档，不是忽略**。
- ⚠️ **三条脚本探针用例在 Windows + Node 24 恒红**（`script-review:112`、`studio/review:123`×2）：判据要子进程往包外写
  标记文件，而它按**权限模型**起（`scriptProbe.js:8` 要 `process.permission`）⇒ 前提不成立、非产品问题；诊断见
  `.trae/documents/forge-0191-ci-收尾计划.md`。**记档，不是忽略**。
- ⚠️ **`test/forgeOperator.test.js:188` 是时序型 flaky**：POST **本机**编辑器 `/api/support/toggle` 偶发 `ECONNRESET`
  （不是外网）。它验的「开启助战后该干员进服务端卡池」没有别的用例覆盖 ⇒ 待加去抖/重试，而不是登记了事。
  **记档，不是忽略**。

---

## 0.19.0 — 2026-10-16

**上游游戏本体从 0.2.6 抬到 0.3.0：插件系统与官方战斗特效两套能力整份进来，节号随之与上游永久分叉。**
`APP_VERSION` 由 `0.18.6` 抬到 `0.19.0`（`CACHE_NAME` 认这个数，旧缓存因此自然换名）。
`UPSTREAM_VERSION` 由 `'0.2.6'` 抬到 `'0.3.0'`（`docs/history/0.3.0.md` 随之落地，见下）。
`PROTOCOL_VERSION`（`2`）与 `MOD_API_VERSION`（`1`）**一个都没动** —— 本版是**新增能力与吸收下游改动**，
没有改推送帧的形状，**不需要 `golden:update`**。发行 tag 将是 `v0.19.0-0.3.0`。

### 上游 0.3.0 全份合入（`0bfe3727`）

- 上游这一版是 **909 个文件 / +119621 −9324 行**（以 `git diff` 为准）。上游更新包 `UPDATE.json` 只记一部分，
  一律以 diff 为准（与 0.18.3-0.2.6 那一节同口径）。
- **两套新能力落进本仓**：**插件系统**（上游 `§32` = 我们 **§34**）与**官方战斗特效**（上游 `§33` = 我们 **§35**）。
  前者是「一个自带入口的功能包」，后者是官方特效文件的提取格式；两份章节分别在
  [docs/history/0.3.0.md](docs/history/0.3.0.md) 与 [docs/design/vfx-format.md](docs/design/vfx-format.md)，
  索引在 [docs/DESIGN.md](docs/DESIGN.md) 的章节表。

### 节号与上游永久分叉：我们比上游大 2

- ⚠️ **我们自己的章节号是全局的，且从插入的 `§28` / `§29` 起就比上游大 2** ——
  上游 `§N` 是**我们**的 `§(N+2)`。所以上游 `§32`（插件系统）在这里是 **§34**、
  上游 `§33`（官方特效）在这里是 **§35**。**引用一律用我们的号**。
- 本版把散在代码、测试与文档里的 `§32` / `§33` 引用**逐条改号成 `§34` / `§35`**
  （带 `§` 前缀的 **310 条**账 + 裸号 **123 条**），并**新增「标题号唯一性」守卫**：
  [test/docs-paths.test.js](test/docs-paths.test.js) 断言每个 `N` / `N.M` / `N.M.K` 标题号**只有一个家**
  —— 改号最怕的是两个号撞进同一篇，这条判据就是为了让它当场红，而不是等读者发现。

### 吸收下游 fork 的四格声明面

下游分支先做了、本版吸收进来的四条（每条都有设计稿与判据）：

- **`pack.json.matchKinds`**（**§28.54**）—— 第二种对局的**声明面**，不是分派表：管理器不认玩法名，
  `host.matchKinds()` 只交出冻结的只读数据，判定住在包自己的 `matchClass` 包装器里。
- **`pack.json.client.screens[]`**（**§28.55**）—— 包可以自带整屏界面（`{ id, route, module, order?, styles?, data?, messages? }`）。
- **`server.modules[].lane`**（**§28.56**）—— 服务端模块多一种挂载点，`SERVER_MODULE_USES` 因此 **6 → 7**。
- **`server.room.hold`**（**§28.57**）—— 房间侧的新声明面。

### mod 层契约面扩大（都是实测数）

- **kit 白名单 20 → 22 条**：新开 `@sim/body.js` 与 `@sim/professions.js`；
  官方 ops kit 的 **8 条一条不少**（`@ops/` 是命名空间，准入始终按文件）。
- **`PACK_FIELDS` 37 → 38**：`pack.json` 的顶层键闭集多一格。
- **`SERVER_MODULE_USES` 6 → 7**：尾巴就是上面那条 `lane`。

### i18n：四语各补 540 条（`b13d80b6`）

- 合入漏掉的译文一次补齐：`en` / `ja` / `ko` / `zh-TW` **各 +540 条**（`b13d80b6`：4 个文件 `+2164 −4`）。
- 现在四语种各自 **2096 条 msgid，翻译 100 %**：`node tools/i18n.mjs check --all --strict` **exit 0**
  （`2096/2096`，`0 missing / 0 errors`）。
- ⭐ **并修回合入过程中从界面条目里删掉的两条**：`[撤退选中干员]` 与 `[出售选中干员]` —— 缺了它们，
  界面上会直接露原文；两条已在四个语言包里补齐。

### 合入的丢失账：新增行零丢失，被删条目曾丢 2 条、已还原

- **对新增行零丢失**：上游这一版带进来的每一行都在。
- ⚠️ **对被删条目曾丢 2 条**：合入过程中有两条既有条目被上游的删除带走了，**已还原** ——
  就是上面 i18n 那一节的那两条。**不写「零丢失」**：账要按这两个方向分开记。

### 兼容性：合入前后对照实测，未发现兼容性回归

口径是**合入前后的对照**（同一批包，改前跑一遍、改后跑一遍，比结果）：

- **线上真包闸门**（[`.github/pack-compat.mjs`](.github/pack-compat.mjs)）：我方包 `--mine-only`（34 条）⇒ `{"VALID":34}`、**exit 0**；
  全量 functional（60 条）⇒ `{"VALID":58,"NO_PACK_JSON":1,"ZIP_REFUSED":1}`、**exit 0**。
- **本机 mod 库 before/after**（**91 条共同 id**）：`class` 变化 **0** · `errors`/`warnings` 变化 **0** ·
  `firstErrorCode` 变化 **0** · `sha256` 变化 **0**。
- **官方素材派生**（`GAME_ASSET` 6 条）：**全部 `pack-clean`**，前后一字未变。

⇒ 结论按实测写：**未发现兼容性回归**（不是「零回归」——那是对未测面的断言）。

### 工具与文档

- [`.github/pack-compat.mjs`](.github/pack-compat.mjs)：把 `flagged` 的包**一起测**（此前漏测）、
  id 规则**改用引擎的 `PACK_ID_RE`**（别再在工具里抄一份）、并给 3 处 `spawnSync` 补 `windowsHide: true`
  —— 最后这条修的是**工具自身的弹窗根因**。
- [tools/package-server.mjs](tools/package-server.mjs)：**服务器轻量发行**（只有游戏运行时与 Mod API，
  不带本机素材、不带随包内容）。
- 三份新文档：[docs/DEPLOY-SERVER.md](docs/DEPLOY-SERVER.md)（怎么跑服务器发行）、
  [docs/UPSTREAM-PR-LEDGER.md](docs/UPSTREAM-PR-LEDGER.md)（我们发给上游的、以及回来的）、
  [docs/ENGINE-COMPAT-STARDUST-AUDIT.md](docs/ENGINE-COMPAT-STARDUST-AUDIT.md)（Forge / Stardust 兼容审计）。

### 判据与已知的既存红灯

- 版本与文档闸门（本版直接相关）：`node --test --test-concurrency=4 test/version.test.js
  test/docs-consistency.test.js test/promptBaseline.test.js test/docs-paths.test.js` ⇒
  **47 tests · 47 pass · 0 fail**（exit 0）。**golden 六族零差异**（`node tools/golden.mjs --jobs 4` ⇒
  `roster 49 · bonds 46 · fields 22 · matches 21 · standins 10 · diy 140`，**288 个场景全部 match**，exit 0）。
- 全量：`node --test --test-concurrency=4` ⇒ **10273 tests · 10181 pass · 74 fail · 18 skipped**。
- ⚠️ **那 74 条不是本版引入的**：把本版的改动整份移开、在**同一个 HEAD（`f7936199`）**上重跑，
  得到**逐条同名**的 **89 个失败用例**（同名集合完全一致，只有耗时不同）—— 也就是说这些红灯在
  0.3.0 合入时就已存在，本版既没加重也没修掉它们。**这里如实记下来，不粉饰**。
- 同类既存红灯还有 CI 的 `typecheck`：`tools/ci.mjs --only …` 的 `setup` / `smoke` / `lint` / `imports`
  四步 **ok**，`typecheck` 报 **6 个既存 TS 错**（`shared/formProjection.js` 4 个、`shared/morph.js` 2 个），
  移开本版改动后**逐条相同** ⇒ 同样是既存问题，与本版无关。
## 0.18.7 — 2026-10-15

**战斗画面不再按显示器的速度空转：新增设置「帧率」（默认 60 帧），并修掉 0.2.6 之后 impostor 测量期整群退出图集、
快节奏攻击每次重启 + 交叉淡入这两处回退。**（依据一份针对本仓库写的《性能优化》提案 §1 / §2；§3「特效解释器」
不适用 —— 本仓库的战斗特效是程序化的，没有那个模块，提案自己也说没有就跳过。）
`APP_VERSION` 由 `0.18.6` 抬到 `0.18.7`（`CACHE_NAME` 认这个数，旧缓存因此自然换名）。`UPSTREAM_VERSION` 仍是
`'0.2.6'`（`docs/history/` 不动，它与上游那一半一起动）；`PROTOCOL_VERSION`（`2`）与 `MOD_API_VERSION`（`1`）
**一个都没动** —— 本版新加的那条 C2S `room.conflict`（见下）**不抬 `PROTOCOL_VERSION`**（先例写在 `shared/protocol.js`
里：新 C2S 类型不是协议版本变更，不提版本的两端只是不认识这一条、其余消息照旧）；没有新包字段、没有改游戏规则，
**不需要 `golden:update`**。发行 tag 将是 `v0.18.7-0.2.6`。

### 设置「帧率」：30 / 60 / 120 / 跟随屏幕，默认 60（提案 §1）

- **问题**：战斗画面此前挂在 PixiJS 的 ticker 上、跟着 `requestAnimationFrame` 无上限 —— 显示器多快就画多快，
  120 Hz 上每秒 120 个画面；而战斗逻辑本身就是固定 1/30 s 一步、两帧之间不插值，高于 60 的画面没有信息量，
  只是发热与耗电。`adaptLoad` 的慢 / 快阈值还是硬编码的 `19.5 / 17.6 ms`，与帧率**耦合**（锁 30 帧时一帧本来
  就是 33 ms，固定阈值会把每一帧都判成慢、负载等级自己往上走）。
- 新增 **`render/framePacer.js`**（纯逻辑，无 PIXI / DOM）：显示器比目标快且**不是整数倍**时（60 帧 on 144 Hz）
  按「每张画面离理想时刻不超过半个显示帧」挑帧（画面间隔 2 或 3 个显示帧，均值等于目标）；**整数倍**时
  （60 帧 on 120 Hz、30 帧 on 60 Hz）直接用显示器自己的时钟（59.94 Hz 就给 59.94 张，不丢帧）；显示器不比目标
  快时每个回调都出画。首帧、卡顿与切标签一律**立刻出画并重起节奏，绝不「追赶」**。显示器的周期取最近若干次
  回调间隔的中位数（少于 5 个样本时每个回调都出画），不是显示周期的间隔（回调被记两次、停顿）一律不进中位数。
- **`render/app.js` 的 ticker 不再自走**（`autoStart: false` + `stop()`）：由本视图自己的 `requestAnimationFrame`
  决定「这一帧是不是画面帧」，只在这一刻 `app.ticker.update(ts)` 推进一次（我们的 `frame`、两个探针与 PIXI 的
  渲染都在这一次里）。**帧时间取 rAF 的时间戳**，`dt / frameMs / fps` 从此是同一个时钟（此前是回调里的
  `performance.now()`）。
- `adaptLoad` 的两个阈值**随锁定平移**（`shift = max(0, I − 1000/60)`，I = 1000/帧率）：30 帧时是 `36.2 / 34.3 ms`；
  60 帧、120 帧与「跟随屏幕」的阈值一字未变。
- 设置项在「画面质量」下面一格（`ui/settings.js`，写法照 `QUALITY` 那个单选组）；**纯触屏设备不列 120**
  （面板本来就 ≤ 60 Hz），除非它已经是当前值。存的是 `settings.frameRate`（`ui/gameLogic/settings.js`
  `FRAME_RATES = [30, 60, 120, 0]`，`0` = 跟随屏幕），默认 **60**（官方客户端的默认）。
- **「跟随屏幕」= 这一格出现之前的现状**（每一个 rAF 回调都出画），一键回退；`render/app.js setSettings` 里
  `frameRate` 一变就 `pacer.setTarget()`，而战斗中点开设置能立刻生效是既有的
  `ui/fieldHost.js settingsStore.subscribe → view.setSettings` 那条线（`setSettings` 此前没有调用方）。
- 不受影响：模拟的 runner 仍按墙钟推进，锁定不改变战斗节奏；服务端与对局结果一个字节都没动。

### impostor：测量期不再整群退出图集（提案 §2，修 0.2.6 的回退）

- **问题**：0.2.6 的 #542 让 impostor 槽位按「这个单位**所有**动作的包围框」定尺寸，但骨架的动作要在模型载入
  之后**分帧**测量，而测量完成前 `_impBox()` 返回 `null` ⇒ 该单位**退出图集、逐个直接绘制**。一波敌人同时出现
  时这个「测量中」的状态持续数秒，整群单位正好在最拥挤的那几秒都不走图集（提案实测：压力场景约 95 → 45 帧）。
- **测量期改用临时包围框**（`render/units.js _impBox` 的新字段 `_provBox`：就是 pre-#542 那条规则 —— 按**当前
  姿势**的 `getLocalBounds()` 加 margin，`_legacyBox`），单位因此**留在图集里**；实测框（覆盖它能播的每一个
  动作）一到就替换它，`_renderImpostor` 按尺寸变化重分配槽位（既有逻辑，不需要新的回调）。`over` 只有实测框
  才有（临时框一律为空集）。
- `stepClipBounds` 的每帧预算 **2.5 → 1 ms**（`render/spine.js CLIP_BOUNDS_BUDGET_MS`）：一小片更不容易让同时
  载入的一波模型在某帧尖峰（测量期反正都在图集里）。**这是与上游 0.2.6 的有意分歧** —— `docs/history/0.2.6.md`
  §33.6 那一节是上游 0.2.6 的移植记录，**原样不动**（它描述的 2.5 ms 是上游那一版的常数）。

### 快节奏攻击：一条循环，不再每次攻击重启 + 交叉淡入（提案 §2）

- **问题**：攻击间隔比攻击动作还短时，每次攻击都重启攻击动作并交叉淡入，使每个骨骼姿势的开销增加约 50% ——
  拥挤场面里这是一大块。
- 现在**攻击间隔 ≤ 动作时长 × 1.1**（两次攻击之间没有站立休息的余地，`render/spine.js` 的 `FAST_RHYTHM`）时，
  攻击动作以 `clamp(时长 / 间隔, 0.35, 4)` 的速度（就是 `windUpPlan` 已算出的 `plan.ts`）**循环**播放；下一次前瞻
  （`windUp`）只**续住这条循环的尾巴**（`attackUntil`）并返回已认领，**不重启、不交叉淡入**。它每圈正好命中一次，
  节奏对得上；`attackUntil` 仍按「本次攻击的恢复末尾」收尾 ⇒ **#506 的「最后一次攻击后不再挥动」语义一字未动**。
- **特意不动** `attack()` 的「事件迟到（没有前瞻）」那条路径：那里仍是一发一次。真实战斗里渲染层走的是
  `windUp`（`render/app.js windUpAttacks`），优化照样生效，而既有测试钉住的 #58 / #246 / #506 语义全部保持。
- 用的都是项目 Spine 管线**实测**的真实 clip 时长（`SpineActor.dur()` 与 `entry.hits`），不照抄别的包。

### 3D 棋盘：官方场景亮一档（`SCENE_GAIN` 1.4）

- 装了官方场景的战场此前按**官方本色**打光（0.2.6 / #549 把 `SCENE_LIGHT` 的 `direct` / `indirect` 从 0.2.5 的
  0.8 / 0.4 抬回 1）。实测（1600×900）这批场景的中位 sRGB 只有 **82–100**、≥192 的像素不到 **2 %**，业主反馈
  「地图场景的亮度有些低」，所以把两个受光项与「无光照图页网格」的 `ambient` **同乘 `SCENE_GAIN`（1.4）**
  （`render/board3d/materials.js`）。同乘一个因子只动**曝光**、不动官方对比度；`range`（光照图 1.0 对应的线性光）
  一个字没动 —— 提取出的场景**一个字节都不用重出**。
- 复测同一台机、同一相机（`dev/render-demo.html` + headless Chrome）：`act1autochess_m01` 中位 **100 → 116**、
  全幅均值 **100.6 → 113.8**、≥192 像素 **1.41 % → 1.65 %**；较暗的 `act2autochess_m01` 中位 **82 → 95**、
  均值 **84.3 → 97.2**、≥192 像素 **1.49 % → 2.67 %** —— 没有一块被吹白。
- 测试照旧按 `SCENE_LIGHT` 的字段读（不写死数值），`board3d-scene` 的 `uLmScale` / `uLightColor` / `uAmbient`
  三条判据一字未改即通过。

### 测试与文档

- 新增 **`test/render/frame-pacer.test.js`**（11 条，合成时间戳）：120 / 144 / 100 / 240 Hz 上的 60 帧节奏、
  60 Hz 上的 30 帧、显示器比目标慢、首帧 / 卡顿 / 切标签后重起且不追赶、样本不足 5 个时逐帧、被记两次的回调与
  停顿不进中位数、`setTarget` 双向切换。
- `test/render/impostor-bounds.test.js` 与 `impostor-bounds-models.test.js` 按新行为改写（测量期**有**临时框、
  单位留在图集；等的是**实测**框而不是「框非空」）；`test/render/browser.test.js` 的 `setSettings` 用例补
  `frameRate` 的合法 / 非法值；`test/ui/gameLogic.test.js` 的 `sanitizeSettings` 补 `frameRate` 的默认、白名单
  与「手改 localStorage 落回默认」。
- 新增 **`test/ui/gameLogicBarrel.test.js`**：`ui/gameLogic.js` 这个桶文件的两侧都钉住 —— 它列的每个名字必须
  真在对应模块里导出，且**任何** import 它的文件只能点它真的导出的名字。ES 模块里缺一个具名导出是**链接期**
  错误：整张脚本图失败、首屏永远停在「游戏脚本加载失败」，而 `node --check`、eslint 与渲染 E2E 都照绿（它们
  都不链接完整的 UI 图）—— 本次「帧率」的 `FRAME_RATES` 就是这样漏过一次。
- 语言包四个（en / zh-TW / ja / ko）各补 6 个词条：`帧率` / `30 帧` / `60 帧` / `120 帧` / `跟随屏幕` /
  `限制每秒画面数，降低高刷屏上的发热与耗电。「跟随屏幕」不限制。`。
- 代码注释即成文文档：`public/js/render/framePacer.js`（算法与三种显示器情形的来由）、
  `public/js/render/app.js`（ticker 不自走、单一时钟、阈值平移）、`public/js/render/spine.js`（`FAST_RHYTHM`）、
  `public/js/render/units.js`（`_impBox` 的临时框）、`public/js/ui/gameLogic/settings.js`（`frameRate` 一格）。

### 素材：11 个战场的官方场景落进本地素材（本机没有客户端也提得出来）

- **本仓库的本地素材第一次真的含各战场官方场景**：`public/assets/local/scene/**` = **92 个文件 / 61 MB**
  （每个战场 `scene/<stageId>/{scene.json,scene.bin,lm*.webp}`，共用贴图 `scene/tex/**` 14.9 MB），
  `data/local-assets.json` 由 **1601 项升到 1658 项**（新增 `scene/<stageId>` × 11 与 `scene/tex` 共 **12 组 / 57 条**）。
  `node tools/doctor.mjs` 报「本地客户端美术（可选） 1658 项，3D 棋盘可用，**已提取各战场官方场景**」；两个战场
  （`act1autochess_m01` 沙地、`act2autochess_m01` 湖园/地铁）在**真实浏览器**里逐个复核：`board3d.on` 为真、
  `board3d.error` 为空、页面上是官方沙地 / 城市地形，**不是程序生成的金属地块**。
- **没有《明日方舟》客户端时的做法（本版实测）**：场景包只在赛季内随客户端分发，但材质 / 贴图 / 着色器取自主题包，
  所以可以**自建一个合成 AB 根** —— 按**客户端相对路径**把 11 个主题包（`arts/maps/**`，含 `map_autochesssand`
  与 `arts/maps/effect.ab`）与 20 个着色器包（`shaders/*.ab` + `[uc]shaders.ab`）下到
  `.cache/official-scenes/ab-<赛季版本>/`，用 `fetch_scenes.py` 把 33 个场景包放进**同一个根**
  （本版共 64 个 bundle / 82.6 MB，逐包按该版本 `hot_update_list.json` 的 md5 校验），
  再 `extract.py --only scene --game <该根>`：**退出码 0、11/11 个场景、57 条清单**。
  每个场景都有一条 `mesh #10210: File unity default resources not found` 的告警（引擎内置图元，跳过，不影响画面）。
  `docs/DEPLOY.md` §6 里「没有客户端就提不出场景、场景给完整包增加的体积**仍未实测**」那句已按上面的实测改写。
- **线上部署（不在本仓库）**：侧车 `cdn-serve.mjs` 的 CDN 基址与缓存令牌跟着 CDN 的 `/cdn/v1/api.json`
  由 `weishucdn.jiangjiangze.icu` + `v0.2.4-12de1b73` 换成 **`speedcdn.jiangjiangze.icu` + `v0.2.6-b83ceb81`**
  （`SP_CDN_BASE` / `SP_CDN_TOKEN`）。**侧车的改写规则一个字没动**：CDN 上本来就有全套 92 个
  `assets/local/scene/**` 键（与本机逐个核对 `index.json` 的 sha256：63 个同哈希；其余是 Windows 客户端 BC7 与
  Android ASTC 的**编码差异**，尺寸与光照图 / `scene.bin` 一致），所以线上客户端拿到的场景字节来自 CDN，
  本仓库这一份是给完整包与本地跑用的。

### 新增第十个面板槽位 `screen.diy.card`：换装按钮同时出现在「自选编队」

- **问题**：前置包 `workshop/skin-picker` 的时装按钮只挂在 `screen.loadout.card`（干员调配 的详情卡）。而玩家
  的**自选编队**那一屏（`screens/diy.js`，每格一个干员）本来就有「潜能 / 练度」与「此干员语音」两行设置 ——
  时装没有（业主报「在自选编队界面选择角色后没有选项」）。
- **引擎侧只加了一格，不动原有行为**：`shared/workshop.js` 的 `CLIENT_PANEL_SLOTS` 与
  `public/js/ui/extensions.js` 的 `MOD_PANEL_SLOTS` 各追加 `'screen.diy.card'`（**并进既有那一行**，两份名单
  的行数不变 —— `shared/workshop.js` 的行号被 `docs/prompts` 的引用钉着；今天 11 个槽位）；`public/js/screens/diy.js`
  在已填那格卡**干员名字 / 职业那一行**（`.diy-slot__idrow`；`public/css/screens/loadout.css` 给这一行加了
  `display: flex` 的行内布局）里渲染 `[data-mod-slot="screen.diy.card"]` 宿主，`data-mod-slot-key` = 该干员的
  **`charId`**（自选编队那一格装的是干员本人，没有棋子记录可查）。
- **它同时是第二个「可重复宿主」**：`CLIENT_PANEL_REPEATABLE` / `MOD_PANEL_REPEATABLE` 里都加了
  `'screen.diy.card'` —— 自选编队一屏是**四格**，漏登记的话注册点**只挂进第一格**（`test/modClientHosts.test.js`
  的「不可重复的组件宿主：容器出现两个也只挂一次」钉的就是这条；可重复宿主还必须带 `data-mod-slot-key`）。
  引擎按需创建的那四个浮层**不动**（`MOD_PANEL_CREATED` 仍是 4）。
- **包侧**（`workshop/skin-picker` 1.0.0 → 1.1.0）：同一条声明的第二份 `wardrobe-diy`，复用同一份模块与样式表；
  `ui/skins.js` 的 `charIdOf` 两种宿主键都认（棋子 id → `chess[…].charId`；`char_…` → 就是它自己），
  `ui/skins.css` 多一条 `.diy-slot .mod-host > .mod-panel`（留在名字那一行的静态流里、`flex: none` 免得被名字
  挤扁，`position: relative` 让浮层锚到面板自己、并显式打开 `pointer-events` —— 引擎对组件内的宿主默认是关的）。
- **「看不到按钮」的两种真原因都记在这里**：① 该干员**一套时装都没有**（`assets.skins[charId]` 为空）时面板
  **整块隐藏**（没有可换的东西，不是「没挂上」）—— 只在自选编队里可用的 6★（如 `菲亚梅塔` = `char_300_phenxi`）
  今天**没有任何包为它声明时装**，属于这一类；② 上面那条「不可重复宿主」—— 自选编队四格里只有第一格挂得上。
- **文档同步**：`docs/WORKSHOP.md` §1.9.3 的槽位表（可重复那一列）与「后七个」计数、§1.9.7，
  `docs/SYNC-POINTS.md` 的同步点 ①（槽位 11 个、可重复宿主 2 个）与宿主举例，`docs/MOD-SURFACE.md` 的锚点描述，
  `workshop/skin-picker/README.md`。
- **判据**：`test/modClientHosts.test.js`（两份名单逐字相同 + 源级扫描「每个组件渲染的宿主都真的有人渲染」）、
  `modPanelWraps` / `modClientPanels` / `modSurface` 全绿；`ui/diy-ui` / `diy.e2e` / `portraitChain` 71 条全绿；
  `node tools/workshop-validate.mjs workshop` **0 error**。

### 时装补充包的覆盖扩到「自选编队」那一屏（`workshop/skin-supplement` 1.1.0 → 1.2.0）

- **为什么**：上一节那个槽位上的时装按钮只在「该干员**有**工坊时装」时才出现，而**自选编队可选的 77 位干员里一套
  本包时装都没有** —— 玩家看到的仍然是「没有按钮」。根因是范围的缝：本包 1.1.0 只覆盖**对局棋子池**里的官方干员；
  自选池的规矩是「持有的 6★ 且**不在**棋子池里」，两边不重叠 —— 本机唯一有时装的那 6 位（黑 / 林 / 假日威龙陈 /
  涤火杰西卡 / 霍尔海雅 / 莱伊）恰好是被 `rimbilliton` / `columbia` / `dossoles` 收成棋子的几位，因此都不在自选池。
- **补了什么**：`workshop/skin-supplement` 补上自选池官方 6★ 的官方时装（**87 套 / 53 位**；包 174 → **261 套**、
  115 → **168 位**；素材 1374 → 2070 个文件、约 197.5 → 320.6 MB），覆盖范围从「对局名单」扩到「对局名单 + 自选编队」
  两个来源（`workshop/skin-supplement/README.md` §1）。
- **没补的**：**官方至今没有时装**的 24 位 —— 自选池里 9 位新晋干员与 15 位原型干员（6 名预备干员 + 9 名开发者干员）
  只有默认服装；本包无从补，那一屏的按钮对它们仍然不出现（这是「没有可换的东西」，不是「没挂上」）。
- **判据**：`node tools/workshop-validate.mjs workshop` **0 error**（261 套、`id` 全唯一）；重启服务器后
  `/data/assets.json` 的 `assets.skins` 里有这些新条目、路径是 `/workshop-assets/skin-supplement/…`；自选编队那一屏
  每一格都出按钮、浮层里列出新时装（真实浏览器核对：`菲亚梅塔` 的 审判日 / 至圣誓言 两套）。

### 起服时核对「大型资源」并自动补齐（地图与场景那类大文件）

- **问题**：`MANIFEST.json` 只管**代码**（`server/update.js` 的 `isSetupArt` 明确把 `public/assets/` 排除在外），
  另有 `data/assets.json` / `data/local-assets.json` 两张表只录「引擎会去查表的那部分素材」—— 3D 棋盘**直接读盘**的
  那批文件（`local/scene/**` 的 35 个光照图、`local/map/**` 的 13 个 tiles/materials/贴图）**任何清单都不管**：一份少了
  它们的安装会静退回程序生成的金属地块，**而没有任何一处报错**。
- **新增清单**：`data/large-assets.json`（`tools/large-assets.mjs --snapshot` 从当前安装生成 —— `assets/local/**` 全量
  之外顺带收「大型资源」：其余 ≥ 1 MiB 的文件；本机这份是 **1751 项 / 192.7 MB**）。判据是它自己的 size + sha256，
  所以它覆盖到了上面那 48 个没人管的文件。
- **起服之后的动作**：`server/http/boot.js` 在打完 banner 之后**后台**跑一遍 `--repair --json`（**不挡监听、不挡玩家**，
  素材缺失也绝不会让服务器起不来）：缺的 / 比清单短的从 `SP_CDN_BASE`（默认本项目的 `speedcdn.jiangjiangze.icu`，
  它按引擎的 `/assets/...` 形状发字节、支持 Range）取回。进度打控制台（`[大资源] 下载 4.5 / 4.5 MB（100%）· 1.4 MB/s
  · 3/3 项`），同一份状态挂 `GET /assets-status.json`（no-store），**客户端标题屏**也显示这一行（`ui/largeAssets.js`）。
- **两条纪律**（都写进 `docs/ASSETS.md`）：**只补不含糊** —— 只动「缺」与「比清单短」的；尺寸更大或同尺寸哈希不符
  只**报告**，绝不覆盖（清单陈旧或 CDN 是另一平台编码时，不能拿它们换掉盘上那份好的）；**哈希按需算** —— 先比 size，
  同 size + 同 mtime 走 `.cache/large-assets-state.json` 免哈希，完整安装一次核对约 **0.1 s**。
- **判据**：新增 `test/largeAssets.test.js` **7 条**（临时目录 + 注入 `fetch`，**绝不碰真实安装里的素材**）全绿；
  `node tools/workshop-validate.mjs workshop` 仍 0 error。真跑一遍：**挪走三个真文件**（79 B + 1.9 MB + 2.7 MB，
  先备份）→ 起服 → 控制台 `缺失 3 · 待补 4.5 MB` → `下载 … 100%` → `已补齐`，`/assets-status.json` 为
  `phase=ok、repaired=3`，三个文件 sha256 与清单**逐字节一致**。关掉这件事：`SP_LARGE_ASSETS=off`。

### 标题屏加了「资源」：看得见盘上有什么，也能按需重下（地图与场景那批大文件）

- **入口**：右上角那一排（统计 / 公告 / 语言）里多一个 **资源** 按钮（`screens/title.js` + `ui/largeAssets.js` 的
  `ResourceButton`）。点开是一张按目录分组的清单：`local/scene` 92 项 / 61.0 MB、`audio/bgm` 12 项 / 22.4 MB …（本机
  12 组 / **1751 项 / 192.7 MB**），每一项带尺寸与状态（完整 / 缺失 / 截断 / 偏大 / 哈希不符），每一组、每一个文件
  都能**重新下载**，顶上还有一个「全部重新下载」。
- **两条只读路由**（都 `no-store`）：`GET /assets-list.json`（清单快照）与
  `GET /assets-redownload.json?target=all|local/scene|assets/…`（**一个带副作用的 GET**，刻意的：这个引擎的 HTTP 面
  **只开 GET/HEAD**，别的都回 405 —— 玩法走 WebSocket、包面走 `/workshop-panels/*`，为一个运维动作新开 POST 通道
  得不偿失。作为交换，这个动作被收窄成：目标只在**清单里**匹配（不接受调用方给的任意路径），而且**单飞** —— 有活
  在跑时第二次请求只读回同一份状态，不会叠出第二个下载进程）。
- **重下是强制的**（`--force`，绕过 `Downloader.existingSize`）：即便盘上那份是好的也重取一遍（对冲坏、对发布
  新素材都有用）；落盘仍是「临时文件 + 原子改名」，所以**重下失败不会毁掉盘上那份好的**。进度走的是起服检查那
  同一个 `/assets-status.json` —— 面板里那一行与标题屏顶端那条进度条同源、同时出现。
- **判据**：`test/largeAssets.test.js` 扩到 **13 条**（新增：`groupOf`/`groupsOf`/`listPayload` 的分组与全表、
  `normalizeTarget`/`forceRows`/`needRows` 的目标匹配），全绿；真浏览器跑通一遍：点「资源」→ 面板列出 12 组 /
  1751 项 / 192.7 MB → 展开 `local/scene` → 点 `audio/bgm` 那一组的「重新下载」→ 面板出现「正在下载大型资源…」、
  标题屏同时出现进度条 → 收工后显示「上次重新下载：12 项，失败 0」，控制台零报错。
- **两处自查出来的坑**（都记在这里，免得下次再踩）：① 面板给的是**组名**（`local/scene`），清单里是带 `assets/`
  前缀的路径 —— 拿组名去 `startsWith` 会一条都匹配不到，表现是「重下了 0 项」**且没有任何报错**（现在
  `normalizeTarget` 统一归一化，并有回归用例钉住）；② 状态轮询是「见到不再跑就停手」的（空闲时零请求），所以
  **自己发起一次重下之后必须让轮询重新武装**（面板与标题屏共用 `title.js` 里一个 `nonce` 计数器），否则那次重下
  在界面上永远不会出现。

### 新增前置包 `workshop/profession-expansion`：官方 8 职业之外的新职业 / 分支

- **本来就能加，只是界面认不出名字**：引擎对 `profession` / `subProfessionId` **不做枚举校验**（与 `bondType` 同一条 ——
  字符串原样放行），而一条记录的**攻击形态是记录自己的**：`attackKind` / `dmgType` / `projectile` / `canHitFly` /
  `targetPriority` 会**盖过** `PROFESSION_DEFAULTS` 与 `SUB` 两张表（`server/sim/professions.js` 的 `resolveProfile`）。
  未知职业只影响**基础形态**（退回 `WARRIOR`：近战 / 物理，不报错），未知分支**没有预设行为、也不报错**。所以「新职业 /
  新分支」缺的只有一样：**显示名** —— 官方那张 8 条闭表（`public/js/ui/loadoutModel.js` 的 `PROF_NAME`）不认识新 id。
- **引擎侧唯一的改动**：`public/js/ui/loadoutModel.js` 新增 **`profName(profession, rec)`**，回退序是
  **官方闭表 → 这条记录自带的 `professionName`（走 `t()`，译名由包自己的 `pack.json.i18n` 给）→ 裸 id**。
  四处显示点改走它：调配页详情卡与搜索关键词（`screens/loadout.js`）、自选编队的职业行（`screens/diy.js`）、
  持有列表的正副两行（`screens/ownership.js`）。**最后退回裸 id 而不是空串** —— 空串在界面上会凭空少一截且看不出
  哪里错，而裸 id 至少指得出是哪一个职业。这与「分支」是同一条路子：`subProfessionName` **一直是记录自带的**，
  官方闭表里根本没有分支名这回事。
- **新包本身**：`workshop/profession-expansion/` 是**前置包**，只有 `i18n`（零 `content` / 零客户端代码 / 零素材，
  所以它不改变任何游戏数据）。`professions.json` 是**给作者与工具看的词汇表**（引擎不读它 —— 不在 `pack.json` 的
  `content` 里）：4 个新职业（时术师 / 守望者 / 追踪者 / 协奏者）× 各 2 个分支，每个都写明「形态照抄哪一条」「行为照抄
  哪一个官方分支」；这 12 个中文名字的 en / ja / ko / zh-TW 译文由本包 `i18n` 提供，**消费包只写中文 msgid 就够**。
  消费包用 `"dependencies": [{ "id": "profession-expansion" }]` 声明依赖（缺失依赖会被装载期点名拒绝）。
- **判据**：`node tools/workshop-validate.mjs workshop` **0 error**（`profession-expansion … OK`）；新增
  `test/professionExpansion.test.js` **13 条**全绿 —— `profName` 的回退序（含「官方闭表优先于记录自带的同名字段」与
  「无记录 → 裸 id，绝不空白」）；4 个新职业 id 确实在 `PROFESSION_DEFAULTS` 之外、8 个分支 id 在 `SUB` 之外；未知职业
  退回 WARRIOR / 记录字段盖过预设 / 未知分支惰性无行为；真装载器收得下它、4 个语种 12 个名字一个不缺且**没有多余的键**。
- **已知边界**（`workshop/profession-expansion/README.md` §5，不假装支持）：**没有专属职业图标** —— 官方职业图标是
  `data/assets.json` 的 `prof.icon[<key>]`（8 个固定 key），本包不往那儿写，新职业在部分界面退化成**名字首字**；
  **进不去调配页那一排职业筛选**（闭表 `PROF_ORDER`），但搜索框能搜到（关键词已改走 `profName`）；**分支的特殊行为要
  代码**（减速 / 链 / 蓄能 / 光环……）走消费包自己的 kit trait 或 `server.battle` 模块。本包的 4 个职业是**起步集** ——
  名字与分支属于内容决定，业主可随意改 `professions.json` + 4 个 i18n 文件。

### 官方【术师】下加了一条新分支：巡援术师（`profession-expansion` 1.0.0 → 1.1.0）

- **加了什么**：`patrol_support` / 巡援术师（Patrol-Support Caster），挂在官方【术师】`CASTER` 下 —— 分支 id、显示名、
  特性文本、**分支图标**（本包自带 `assets/sub_patrol_support_icon.png`，`art.profSub` → `assets.prof.sub`）与它的
  **两张攻击范围**（高台 / 地面，普通与精英各一张），全部落在 `workshop/profession-expansion/`。
- **「可以部署在地面」不需要任何引擎改动**（起初误判成要用一条新的 `rangedOnLowGround` 机制）：`position: "RANGED"`
  **本来就含地面格** —— `server/match/board.js` 的 `canPlace` 里 `'ranged'` / `'all'` 对**任何**可部署格都返回 true，
  客户端 `ui/gameLogic/placement.js` 的 `deploySets` 是同一条语义（`ranged = melee ∪ rangedOnly`），
  `test/match/board.test.js` 一直钉着它。术师站地面因此是**既有行为**，不是新机制。
- **「处于地面」也是既有的**：部署那一刻 sim 就写好了 `unit.ground`（`server/sim/battle/deploy.js`：
  `u.ground = grid.isLow(tile) && !elevated`），`battle.grid.isLow(r, c)` 也能直接问。所以「按地面与否换数值 / 范围 /
  技能效果」是**消费包的 kit**（`unit.rangeGrid = <地面网格>` + `battle.refreshRange(unit)` + `addBuff mods`）——
  本包只给词汇、译名、图标与范围，骨架写在 `workshop/profession-expansion/README.md` §6。
- **一条记录只有一个 `rangeGrid`**：普通 `_a` 与精英 `_b` 各一张，所以四张图收成「普通 = 精英0 那张、精英 = 精英1 那张
  （精英1 与精英2 同形）」，高台 / 地面两张由消费包按 `unit.ground` 换。
- **判据**：`node tools/workshop-validate.mjs workshop` **0 error**（该包现在报 `1 art entry`）；
  `test/professionExpansion.test.js` 扩到 **17 条**全绿 —— 含「两张范围逐格钉死」「精英那张必须真包住普通那张」
  「`art.profSub` 的键 = `subProfessionId`、文件在包里、客户端 `subProfIconUrl` 的两种写法都解析出它」
  「真装载后 `assets.prof.sub.patrol_support` 确实有条目」「`canPlace` 对 'ranged' 在地面格上返回 true（把这条既有语义
  钉住，别让以后改回去）」。
- **一处口径**：业主给的图文件名写的是「巡卫术师」，正文写的是「巡援术师（Patrol-Support Caster）」—— 本包按**正文**
  用了巡援术师（英文 Patrol-Support 与「巡援」对得上）。要改成「巡卫术师」只需改 `professions.json` 一处 + 4 个 i18n。

### 新前置包「干员冲突兼容」：同一个 id 被两个包各加一份时，玩家自己挑用哪一份

- **问题**（业主 2026-10-16）：合并层按包 id 字典序只留赢家、**输家整个丢掉**（`shared/workshop.js` 的
  `PACK_ID_COLLISION`，DESIGN §28.3）—— 一份合并结果是对的（客户端与服务端都只看得见一份），但玩家从此
  **不知道还有另一份**：A 包加了一个阿米娅、B 包也加了一个，界面上永远只有字典序小的那个包的，且没有任何一处
  会告诉他。**合并规则一字未改**（赢家仍是赢家，那条 `PACK_ID_COLLISION` 一条不少）。
- **引擎四条轨道**（新增前置包 `workshop/operator-conflict/`，它自己只声明一条 `notices` + 一份 README）：
  1. **留下输家**（`applyWorkshop`）：`data.workshopConflicts = { [file]: { [id]: { winner, packs: [{ pack, record }…] } } }`
     —— `packs[0]` 恒是赢家（「今天实际生效的那一份」）；覆盖官方 id 的那种情况下输家的候选是**官方 + 它那条补丁的
     合成体**（不是一条缺一半字段的补丁）。**没有冲突就不设这个键** —— 一份普通的合并结果与 0.18.7 逐字节相同。
  2. **新 C2S `room.conflict { picks }`**（`{ [chessId]: packId }`，结构上限 64 条）：判据**宽松**
     （`checkConflictPicks`，与 `checkNotOwned` / `checkDiyPicks` 同一条）—— 挑了一个这局数据里没有的冲突、或一个没
     贡献过这条记录的包，**逐项丢掉**，绝不整条 `BAD_MSG`（一个过期的选择不该把玩家别的选择一起废掉）。
  3. **存在会话与座位上**（`server/lobby.js` 的 `conflict()`）：与 `room.loadout` / `room.ownership` / `room.diy` 同轨，
     一局取开局那一刻的那一份；对局中改只存给下一局（`ROOM_STARTED`）。`'room.conflict'` 进 `HEAVY_TYPES`。
  4. **按玩家换记录**（新增 `server/match/player/conflict.js`）：`conflictGameData` 是又一层 `Object.create(gd)` 视图，
     `view.chess(id)` 返回**这个玩家**挑的那份记录、其余查询落到比赛那一份 —— 同一个干员在不同玩家的棋盘上可以是
     不同的一份。`rebuildPlayerView` 是**唯一**的组装点（DIY 先叠、冲突后叠，后叠的赢），所以两条设置各自改动都
     不会把对方的视图冲掉。
- **只读路由 `GET /workshop-conflicts.json`**（`server/http/routes.js`）：它只回答「有什么可挑」，**选择本身走
  WebSocket**；没有冲突时 body 是 `null`（不是 `{}` —— 「这台服务器上根本没有冲突」与「有列表但是空的」不是同一件
  事）。这条路由读的**必须是本服务器自己那一份数据**（`server/index.js` 里的 `data`，与 lobby / match 同一份）：
  写成 `getData()`（进程单例）在缺省工坊根下恰好也对，但一个自定义 `workshopDir`（测试 / `SP_WORKSHOP` 试玩子进程）
  下会把**另一个工坊根**的答案报出去。
- **客户端**：新增 `public/js/ui/conflictModel.js`（纯逻辑：候选 / 赢家 / 最小化写回）+ `ui/loadoutSync.js` 的第四条
  同步（`installConflictSync`，与另外三条同一个 `installPrefSync`；每浏览器的选择存在 `sp.pref.conflict`）+
  `screens/loadout.js` 干员详情里的那一排「数据来源」按钮（赢家在最前、带「默认」小签，点赢家即取消）+
  `css/screens/loadout.css` 的 `.lo-cf`。同一干员的**高台与精锐是两条记录**，各撞了各自就各有一排。
- **界面为什么在引擎侧、不在包里**：`public/js/ui/extensions.js` 的 `PANEL_SEND_TYPES` 是一张**闭合的显示型**白名单
  （今天只有 `room.appearance`），而「这个干员用哪一份记录」**是**对局状态 —— 由引擎画、走引擎自己的 C2S 通道。
  于是本包与 `side-story` 同一形态：只声明 + 说明（`test/operatorConflict.test.js` 有一条源码级断言钉住那面边界）。
- **判据**：`node tools/workshop-validate.mjs workshop` **0 error**（新包报 OK）；新增 `test/operatorConflict.test.js`
  **21 条**全绿（合并层留输家 / 三条形状与语义判据 / 按玩家换记录 / 只读路由的 200 · `null` · 404 · 405 /
  客户端纯逻辑 / 接线）；新增 `test/ui/conflict.e2e.test.js`（opt-in，真服务器 + 无头 Chrome：两个包各覆盖同一条
  官方 id）—— 干员详情里那排按钮真的画出来、点一下真的写进 `sp.pref.conflict`、真的被服务端收下（`synced`，而不是
  `error` / `locked`），点回「默认」即清除。`docs/WORKSHOP.md` §1.7 的表里记了它。

## 0.18.6 — 2026-10-14

**工坊包第一次可以「复用引擎自带的官方 ops kit」：`@ops/` 按文件开了 4 条白名单。**
`APP_VERSION` 由 `0.18.5` 抬到 `0.18.6`（`CACHE_NAME` 认这个数，旧缓存因此自然换名）。
`UPSTREAM_VERSION` 仍是 `'0.2.6'`（`docs/history/` 不动，它与上游那一半一起动）；`PROTOCOL_VERSION`（`2`）
与 `MOD_API_VERSION`（`1`）**一个都没动** —— 没有新协议消息、没有新包字段、没有改游戏规则，**不需要
`golden:update`**。发行 tag 将是 `v0.18.6-0.2.6`。

### 为什么开这 4 条

工坊包 `rimbilliton`（雷姆必拓）的 4 张棋子卡就是 4 名官方干员换皮，作者的 kit 是极薄的委派：
`import opShwaz from '@ops/op-shwaz.js'` 之后调 `opShwaz.char_340_shwaz(bb, chess)`。而 `@ops/` 此前
**不在任何白名单里**（`shared/kitImports.js` 的两个前缀只有 `@kit/` 与 `@sim/`），装载器与校验器同源地
（同一份 `kitImportIssues`）把这 4 个 kit 逐个拒掉 —— 校验器报的是 **error**（`errors = 4`），
包本身还能装，但那 4 名干员的战斗行为缺失。

- 当时唯一「不改引擎」的出路是内联，实测那条路的传递闭包是 **18 个文件 / 513 KB**：`sim/content/tokens.js`
  （召唤物注册表，107 KB）、`sim/ai.js`（索敌，58 KB）、`sim/simdata.js`、`sim/professions.js` 与
  `shared/i18n.js`（浏览器 i18n 运行时，25 KB）。
- 那不是「搬几个 helper」，是把**引擎子系统在包内冻结一份** —— 引擎日后更新它们时包仍跑旧副本，
  而且**没有任何东西会报**。

### 改了什么：4 行，不是一个前缀

- `shared/kitImports.js` 的 `KIT_IMPORT_FILES` 加四行：`@ops/op-shwaz.js` · `@ops/op-ray.js` ·
  `@ops/op-aglna2.js` · `@ops/op-thumpy.js` → `server/sim/content/kits/ops/op-*.js`。
- `KIT_IMPORT_PREFIXES` 里加了 `@ops/`，因为浏览器那张 import map 是**按前缀**生成的（`kitImportMap()`，
  `public/index.html` 同步加了 `"@ops/": "/sim/content/kits/ops/"`），而且错误文案必须能说「模块名未开放
  （前缀合法）」而不是「未知前缀」—— 否则作者看到的是「这个命名空间不存在」，真相却是「它在，只是这个文件没开」。
- **准入判据始终是那张表**：`@ops/op-siege.js`、`@ops/op-chen.js` 这类**同前缀、未列名**的文件今天仍然被拒
  —— 这正是「按文件开」与「开前缀」的分界线。
- 这 4 条**两端都不需要改写文件**，也不用把它复制进包：服务端把它窄重写成 `file:` URL 之后 import，该文件
  **自己的**相对 import（`../shared/tier1.js`、`../../../body.js`、`../../tokens.js` …）由 Node 按它的
  **真实路径**原样解析；浏览器按 import map 取 `/sim/content/kits/ops/op-shwaz.js`，它自己的 `../../../body.js`
  原样解析成 `/sim/body.js`（`/sim/` 与磁盘 `server/sim/` 同构，`server/http/static.js`）。所以
  `rewriteKitImports` 一个字都没动。

### 判据：先红后绿

- 加这四行**之前**跑 `node --test --test-name-pattern='按文件开放官方 ops kit' test/kitImports.test.js`
  得到 **4 个 failure**（失败信息就是 `@ops/op-shwaz.js 必须在 KIT_IMPORT_FILES 里…` 与 `未知前缀 "@ops/"`）。
- 加完之后 `test/kitImports.test.js` **41 pass / 0 fail**。新增的 5 条判据里，除了「表里逐条指向真实文件」
  「`@ops/` 下未列名的仍被拒且理由是『前缀合法』」「`kitImportMap()` 与 `index.html` 同源」之外，还有两条：
  **加载器口径与校验器同源**（真的让 `loadWorkshopKits` 加载一个 `import "@ops/op-shwaz.js"` 的夹具 kit，
  断言零 error），以及把**包真正调用的那个 `default` 成员**（`default.char_340_shwaz` / `char_4117_ray` /
  `char_1015_aglna2` / `char_4235_thumpy`）钉成函数 —— 这 4 个文件的具名导出很少（两个是空的），原有的
  具名导出下限对它们等于空转，所以下限必须记在 `default` 的成员上。
- 全量：`node --test --test-concurrency=2` → **8867 tests · 8862 pass · 0 fail · 5 skipped**（exit 0）。

文档：`docs/design/mod-layer.md` 新增 **§28.12.2**、`docs/WORKSHOP.md` §4.5.1 加这 4 行，
以及模组仓 `SKILL.md` / `AGENTS.md` 的白名单一节（11 → 15 条，写明 `@ops/` 是命名空间不是放行）。

### 口径数据通道（§28.51）：包可以带上自己那套口径数值

包此前只有两条路：`content` **新增记录**、`overrides` **替换官方记录**。作者要让「同一名干员在满练度下的
口径数值」也随包走时，没有通道 —— 本版加第 15 张数据表 `variants`。

- `pack.json` 写 `content:["variants"]`，包内放 `variants.json`。它是**三层闭枚举**
  `{ <轴>: { <数据文件>: { <记录 id>: <字段级补丁> } } }`：轴必须在 `pack.json.variants` 里声明过
  （`VARIANTS_UNDECLARED_AXIS`），文件必须是加载器认识的数据表（`VARIANTS_UNKNOWN_FILE`，且不许补
  `variants` 自己），补丁只能改目标记录**已有**的键（`VARIANTS_UNKNOWN_KEY`，与 `overrides` 同一套闭合世界）。
- **覆盖、不追加**：补丁只落在**已有记录**上，id 不存在时报 `VARIANTS_TARGET_MISSING` 而不是被创建 ——
  口径表**不能发明记录**。新增记录仍然只有 `content`，替换官方记录仍然只有 `overrides`。
- **只在装载期生效**：补丁在 `applyWorkshop` 里合进数据，**不接管运行时练度开关** —— 房间里点不点满练度、
  走哪条轴，仍由原有的运行时开关与 `pack.json.variants` 声明决定，本通道没有改它。
- 判据：`test/workshopVariantsData.test.js` **16 pass / 0 fail**（红 15 → 绿 16）。
- 全量：`node --test --test-concurrency=2` → **8867 tests · 8862 pass · 0 fail · 5 skipped**（exit 0）。
- 真包：对真实工坊包跑 `node tools/workshop-validate.mjs` → **0 error / 84 warning · VALID**；
  **32 条记录 / 4019 个值 / 与官方口径不一致 0**。
- 文档：`docs/design/mod-layer.md` §28.51、`docs/WORKSHOP.md` §1.20.1、`docs/MOD-SURFACE.md` 14 → 15 张表、
  `docs/prompts/README.md` +14 行；校验器与编辑器同步认这一层（`CHECK_KINDS` 与 `checkKindLabel` 加 `variants`）。

## 0.18.5 — 2026-10-14

**修掉「升级后图标 / 立绘 / 3D 场景大片空白、只能强刷」那一场：根作用域 Service Worker 一次注册变成永久劫持。**
`APP_VERSION` 由 `0.18.4` 抬到 `0.18.5` —— 抬它**就是**修复的一半：`CACHE_NAME` 认这个数，旧缓存因此自然换名。
`UPSTREAM_VERSION` 仍是 `'0.2.6'`（`docs/history/` 不动，它与上游那一半一起动）；`PROTOCOL_VERSION`（`2`）与
`MOD_API_VERSION`（`1`）**一个都没动** —— 没有新协议消息、没有新包接口面、没有改游戏规则，**不需要
`golden:update`**。发行 tag 将是 `v0.18.5-0.2.6`。

### 现象与根因（实测坐实，不是推断）

干净 profile 实测：6 条探针（盟约图、立绘、`local/scene/scene.json`、`scene.bin`、`.obj`、一个**不存在**的文件）
5×200 + 1×404，S.W.E.E.P. 屏 `<img>` **35**；手工注册 `/resource-sw.js` 之后同 6 条**全 412**（连不存在的那个也是
412）、`<img>` **0**。根因是三件事叠在一起：

- SW 只从「本地导入并逐文件校验过的字节」回答，命不中一律 **412 且绝不回源**
  （`public/js/resources/service.js`），而它管的正是 `/assets`、`/fonts`、`/media` 三棵树；
- 缓存名是**固定串** `sp-workshop-resources-v1-all`（不含版本），`activate` 只有 `skipWaiting` +
  `clients.claim`，全仓 `public/js/**` 没有任何 `caches.delete`/`unregister`；
- 服务器只在包声明 `assets` 时才发 `welcome.modAssets`，页面只在那一刻注册 —— 于是「删掉包 / 换回不声明资源包的
  发行包」之后，页面不再注册，**老 SW 却还控制着页面**。

结果就是「一次注册 = 永久劫持」，只有强刷 / 清站点数据能解除（与业主口径完全吻合）。未带 `~hash` 的 `/assets/**`
吃一天长缓存，是同一场里浏览器那一半的推手。

### 三道闸

1. **缓存名带版本 + 激活清旧**：`CACHE_NAME = sp-workshop-resources-v1-<APP_VERSION>-all`；`activate` 删掉本引擎
   家族里**不是当前名字**的缓存（`common.js staleCacheNames`：别人的缓存与当前那个都不动 —— 当前那个装着玩家本地
   导入的几百 MB，删了他没有任何办法拿回来）。
2. **自愈阀**：服务器这次**没有**声明 `welcome.modAssets` 而本页被一个 SW 控制着 ⇒ 页面主动注销本引擎那条注册
   并删掉它的缓存（`public/js/resources/release.js`，落点在 `main.js` 的注册点旁边）。它是**动态** import：从没装
   过 SW 的干净环境不多取一个字节，「不声明 assets ⇒ 无新请求」仍是结构性的。
3. **未带 `~hash` 的 `/assets/**` 不再吃一天长缓存**：`server/http/files.js LONG_CACHE_DIRS` 去掉 `assets`
   （改 `no-cache` + 原内容 ETag，`fonts`/`vendor` 不动；带指纹的三条路 —— 内容哈希 URL、Spine 模型组、`?v=` ——
   仍然 `immutable`）。

另修一处复现中揪出来的残留：`service.js` 在缓存**根本不存在**时不再 `caches.open()` 建一个空缓存。被注销却仍控制
着页面的那一个 SW 每答一次 412 就会把它建回来，于是「注销成功、`caches.keys()` 却永远非空、看着像装过资源包」。

### 界面：按第三方 UI 包 20261014 换新（与上面那条修复同一版发出）

`ui-package-20261014.zip`（`MANIFEST.basedOn = 0.2.6`，34 条目）按它自己的 `AGENTS.md` 装上。**口径：包版作底，我们的增量追加在末尾。**

- **整份替换 5 个**：`screens/{lobby.js,lobby.css,room.js,loadout.js,loadout.css}` —— 替换**前**先把我们相对 `ui-hub-package-20261013` 的本地改动逐条移植进包版（不是替换后再补）。**包版那两个我们服务器没有的闸门**（`match.queue`、`room.setMaxSeats`）因此自动隐藏，能力由我们自己的入口提供。
- **新增 8 个**：`ui/{lobbyMusic,screenFit,seatArt,trophies}.js`、`compat/ui/{achievements,friends,namecards}.js`（垫片**只在目标没有同名模块时装**；目标已有的 7 个一律不覆盖）、`test/ui/sweep.test.js`。
- **三个 patch feature 照 `tools/patches.mjs` 的规则手工落**（该工具本身**不执行**，`install.mjs` 同样不执行）：`settings.js` 两处锚点（异形屏适配段）· `devices.css` 末尾追加 `patches/devices-screenfit.css` · `fieldHost.js` 6 处必需锚点（唯一可选锚点不在 ⇒ 按 optional 语义跳过）· `audio.js` 的 `playBgm` 两处 BGM 钩子；`roundNumber` 在无 `gtop` 顶栏的部署上记 `n/a`。
- **CSS 方向**：包版 `lobby.css`（1013→1014 涨 38,958 B）是底，我们那 50 行增量追加到**它的末尾**（`AGENTS.md:70`）。另外把包版新的 `font-size` 全部接上四档文字大小（150 处 `max(<n>rem, <m>px)` / 裸 `<n>rem` → `calc(<n> * var(--t))`，与引擎头同一形状），并按 `test/client-static.test.js` 的契约补 9 处 `color-mix()` 前置回退与 `-webkit-backdrop-filter` 孪生。
- **移植回我们独有的七项**：座席上限滑杆（`room.setSeatCap`）· 快速匹配（`room.queue`/`room.dequeue`）· 房间模组回显 · 助战 · 聊天 · 添加/移除 AI 队友（`room.addBot`/`room.removeBot`）· i18n 包装（新增 50 条 msgid，四个语言包 100%）。
- **协议一字未动**：没有新消息，`PROTOCOL_VERSION`（`2`）与 `MOD_API_VERSION`（`1`）都不动 ⇒ 同样**不需要 `golden:update`**。
- **一处判据收窄（只收窄，不放松）**：`test/ui/text-scale.test.js` 原断言「`--t` 只在 `theme.css` 里定义」。包版在 `screens/lobby.css` 的 `.ach__box`（成就统计面板）**子树内**钉了 `--t: 1rem`（包作者的注释：文字大小放大后徽标与模式表会重叠）⇒ 改为**只禁止 `:root`/`html`/`body` 级定义**。守的行为不变：全局文字根仍只由 `theme.css` 的四档决定。红→绿两次输出：改前红（`public/css/screens/lobby.css: --t is defined in theme.css only`），改后 10/10 绿。

### 判据

- **本版界面换新的判据**：`test/ui/**` `tests 846 / pass 842 / fail 0 / skipped 4`。**逐项真点**（headless Edge + CDP，对着主树）：座席滑杆拖到 8 ⇒ 建房 ⇒ WS `room.state` 里 `"seatCap":8` + 房内 **8 张席位卡**；快速匹配 ⇒ 等待面板出现（`1/4`）⇒ 取消 ⇒ 面板消失，WS 依次 `room.queued waiting` / `cancelled`；添加 AI 队友 ⇒ `room.state` 中出现 `{"name":"AI·华法琳","isBot":true}` 的席位 ⇒ 移除后该席位回到 `null`；助战 / 聊天（真发一条 ⇒ `chat.msg` 回显）/ S.W.E.E.P. 三页签 / 干员调配 112 张卡各自打开确有其物。**四视口**（1280/1536/1600/1920）console 错误 **0**、未捕获异常 **0**、HTTP ≥ 400 **0**；`.hub-stage` 三栏、座席滑杆 458/550/573/688 px，与改前**逐像素相同**。**房间模组回显本机看不到**：那台服务器没有声明任何工坊包（`welcome.mods.packs` 为空），`RoomModsPanel` 按设计不渲染 —— 行为由 `roomModIndependence` / `roomModSet` / `modAlign` 三条判据钉住。
- 新判据 **6 条**（`test/modAssets.test.js:977` 的 describe 5 条 + `test/asset-index.test.js:285` 1 条），并就地翻转
  3 处同族断言（`test/asset-index.test.js:276`、`:315`、`test/lobby.test.js:277`）。**带牙证明**：对着 `HEAD` 的旧
  源逐条核对 ⇒ **6/6 红**；改后 ⇒ **6/6 绿**。改前真跑（`node --test test/modAssets.test.js test/asset-index.test.js
  test/lobby.test.js`）`tests 88 / pass 83 / fail 5`，改后 `tests 143 / suites 27 / pass 143 / fail 0`。
- `node --test --test-concurrency=2`（全量，**本版最终**，含界面换新新增的 17 条判据）：`tests 8841 / suites 917 /
  pass 8835 / fail 1 / cancelled 0 / skipped 5`。那一条失败是 `test/package.test.js`「真实跟踪树」：新文件
  （`public/js/resources/release.js`，以及本版界面换新的 7 个 UI 模块与 `test/ui/sweep.test.js`）当时**未被
  跟踪**（`plan()` 读 `git ls-files`），提交后自绿（`isPlayerFile()` 实测为 `true`，`resolveSpecifier()` 也对得上）。
  与 0.18.4 记的冻结树 8816/8811 的差额里，**+6 是本次新判据**（`git show HEAD:` 逐文件计数：modAssets 53→58、
  asset-index 13→14、lobby 72→72），另 +2 来自 0.18.4 之后、本次改动之外的提交，未逐条归因。
- **真实浏览器复现**（headless Edge + CDP，直接对着主树，不是包版）：干净 **200×5+404 / img 35** → 注册 SW 后
  reload **412×6 / img 0**（与改前基线逐字相同）→ 自愈阀在同一页的欢迎那一刻落地（`regs:[] caches:[]`，2 ms 内
  查到）→ 再 reload **200×5+404 / img 35**、`navigator.serviceWorker.controller` 变 **null**、`caches.keys()` 里
  `sp-workshop-resources-*` 消失。另测「新版本 SW 首次 activate 时缓存里摆着旧名」：`sp-workshop-resources-v1-0.18.4-all`
  与历史旧名 `sp-workshop-resources-v1-all` 两条被删，`unrelated-cache` 原样保留。

### 玩家侧应急（README 顶部同时留了一行）

升级后若图标 / 立绘 / 3D 场景空白：先按 `Ctrl+Shift+R` 强制刷新；仍然不行 ⇒ 地址栏站点设置里「清除此站点数据」
后重开页面。**已发布的 0.18.4 仍带这个 bug**，其 Release 正文另加了一条醒目提示。

## 0.18.4 — 2026-10-13

**把第三方界面包 `ui-hub-package-20261013` 按它自己的 `AGENTS.md` 完整装进引擎（业主裁定「走 C、不绕远路」），并把
我们相对上游 v0.2.6 的**全部本地改动**逐条移植进包版 —— 一件都没丢。** 这一版**只动前端界面层**：`APP_VERSION` 由
`0.18.3` 抬到 `0.18.4`；`UPSTREAM_VERSION` 仍是 `'0.2.6'`（`docs/history/` 不动，因为它与上游那一半一起动）；
`PROTOCOL_VERSION`（`2`）与 `MOD_API_VERSION`（`1`）**一个都没动** —— 没有新协议消息、没有新包接口面、没有改游戏
规则，**不需要 `golden:update`**。发行 tag 将是 `v0.18.4-0.2.6`。

### 装了什么：5 个整份替换 + 5 个新增 + 7 个兼容垫片

- `public/js/screens/{lobby,room,loadout}.js` 与 `public/css/screens/{lobby,loadout}.css` 五个文件**整份换成包版**。
  装前逐份核过包完整性：`MANIFEST.json` 的 10 个 payload 条目 sha256 **十份十对**，`compat/` 7 份、
  `compat-snippets/` 1 份、`test/` 1 份、`tools/` 2 份齐备。
- 五个新模块已是逐字节的包版：`public/js/ui/{hubBackdrop,matchFlow,protocolScene,transitions}.js` 与
  `public/js/screens/sweep.js`；`hubBackdrop.js` 保留我们自己的 i18n 接线（主题名走 `N_()`、文案走 `t()`）。
- **7 个兼容垫片**按包的 §4.1 只在目标**缺同名模块**时装：`public/js/federation.js`、
  `public/js/ui/{accounts,matchmaking,ownerName,skinPicker,skins}.js`、`shared/randomMode.js`。
- §4.2 `public/js/screens/title.js` 的 `Emblem` 补 `export`（包版大厅中央徽标复用它，函数体与调用点未动）。
- §4.3 `public/js/ui/loadoutModel.js` 追加 `compat-snippets/mergeSkins.js`（导入调配时合并皮肤选择）。

### 方向拨正：包版 CSS 是「底」，我们的是「追加」

上一版把包版 `lobby.css` 整段追加在**引擎规则之后**，于是包版的 `.lobby-body{grid-template-columns:minmax(0,1fr)}`
反过来压掉引擎的两栏（`lobby.css:359` 压 `:5`），`.section-label` 三个同 class 的高度变成 243/115/25，座席滑杆只剩
217.9px。本版按 `AGENTS.md:70` 拨正：`lobby.css` = **包版整份**（含本仓库要求的字号形状 `calc(<x> * var(--t))` 换算与
`color-mix` / `backdrop-filter` 的新旧双写回退）+ 我们自己的增量（`.seat-cap*` / `.quickmatch-*`）**追加在包版末尾**；
`loadout.css` 直接用包版（它在 `test/ui/text-scale.test.js` 的 `NOT_SCALED_FILES` 豁免里，而
`test/ui/loadout-stats.test.js` 要求那一组字号是 `max(<rem>, <px>px)`）。

### 零丢失：我们独有的东西逐条移植进包版

- **座位上限滑杆**（业主裁决 B5）：`SeatCapPicker` 进包版的 `ProtocolSelect`（选择模拟协议）创建区、
  `SeatCapSetter` 进包版的 ⚙「同盟设置」浮层；协议**仍是我们自己的 `room.setSeatCap`**（带 `code`、房主专属），
  `shared/protocol.js` 一字未动；`serverSeatMaxOf` / `seatCapRange` / `seatCapPayload` 原样导出，
  「同盟卡按本服务器上限重算 `{n}`」也一并移植（包版只画 desc，本版把被包版闲置的 points 一并画出来用 `pointParams`）。
- **快速匹配**：包版那一条走 `match.queue`（本服务器没有 ⇒ 按包自己的规则自动隐藏），我们的
  `room.queue` / `room.dequeue` / `room.queued` 版本（`QuickMatchPanel`）接回同一条创建路径，按 `HAS('room.queue')` 开。
- **本房模组**：`ModPicker` / `roomMods.buildCreatePayload` / `buildJoinPayload` / `RoomModsPanel` /
  `mods/align.js` 对齐闸（模组没就绪就不给「准备就绪」按钮）全部移植。
- **助战 / 聊天**：`SupportButton` 进大厅顶栏与房间顶栏（`test/ui/support.test.js` 钉的三处入口）；`ChatPanel` 回房间。
- **S.W.E.E.P.报告 / 大厅背景 / 难度示意图 / 转场**：包版自己就有（`SweepPlate`、`HubRadar`、`.proto-stage`、`tr-*`）。
- **外观链路**：`loadout.js` 的取图仍走 `ui/portraitChain.js`（包版比上游多两处取图点，一并接上）。
- **`prepLoadout` 客户端半**：`loadout.js` 的两处相位判据仍读 `currentLoadoutLockPhases()`，不回写死 `PHASE.INFO_CHECK`。
- **`screens/lobby.js` 的导出面**：`DEFAULT_DIFFICULTY` / `parsePlaytestParam` 继续从它转发导出 —— 包版这两个符号是
  0 处，漏了这一步 `screens/playtestLink.js` 会直接白屏（`main.js` 静态 import 它）。

### 业主需要知情的两件产品级变化

- **包版房间不再提供「添加 AI 队友」入口**：空席位现在是「邀请」与「搜寻中」，AI 补位那条路换成精确搜寻 /
  matchmaking（包版连 `fillBots: false`）。服务端的 `room.addBot` 仍在，缺的只是界面入口。我们**没有**擅自把旧按钮
  加回去（那会改包版的房间设计），报业主裁定。
- **可选件 `optional/room-card` 未装**：它**不是**我们说的「房间模组回显」（那是 `roomMods.js` / `RoomModsPanel`），
  而是**名片干员同步**（`room.card`，让队友看到彼此选的立绘）。装它要改 `shared/protocol.js` + `server/lobby.js` 并**重启**，
  与「本次不动协议」「发版由业主走流程」两条冲突，故按包 §0「由主人择时」留待裁定。

### 判据

- `node --test --test-concurrency=2`（全量一次，冻结树上）：`tests 8816 / suites 916 / pass 8811 / fail 0 / cancelled 0 / skipped 5`，用时 **739 s**。并发降到 2 之后原先那三条负载抖动（`test/lobby.test.js:575` websocket、`:593` 限流、`test/packMatchMsg.test.js:247`）**一条都不再红** ⇒ 判为全量并发下的负载抖动，不是回归；每条单独跑也全绿（`test/lobby.test.js` 73/73、`test/packMatchMsg.test.js` 47/47）。**装前基线核不到**（`_up` 里的基线发行包不带 `test/`，无法在装前树跑同一套判据）。
- `test/roomSeatCap.test.js` 三处断言按新 DOM / 被取代的文案重钉（`.seats--dense` → 包版 `.rs--big`；
  `.room-bar__opts` → ⚙ 浮层里的 `RoomOptions`；同盟卡那条被包版改写的 msgid），行为断言一条未放松。
- `node tools/i18n.mjs check --all --strict`：四包 1435/1435（新增 101 条逐条翻译、占位符逐个保留）。
- `npx eslint`：改动文件 0 error（8 个 warning 全部继承自包版自己的文件）。
- `npm run check:imports` exit 0；`npm run typecheck` 仍有 6 条既有报错（`shared/formProjection.js` / `shared/morph.js`，
  这两个文件本次一个字节未动，属装包前既有状态）。

## 0.18.3-0.2.6 — 2026-10-13

**上游底座从 0.2.5 抬到 0.2.6，并按我们自己的分批节奏把这一版整份吃完。** 上游这一版是 **93 个文件 / +5750 −254 行
/ 58 个提交**（以 `git diff v0.2.5 v0.2.6` 为准；上游更新包 `UPDATE.json` 只记 67 个文件，一律以 diff 为准）。
本仓库自己的版本仍是 **0.18.3**，发行 tag 是 **`v0.18.3-0.2.6`**；`shared/constants.js` 的 `UPSTREAM_VERSION`
由 `'0.2.5'` 抬到 `'0.2.6'`，而 `APP_VERSION`（`0.18.3`）、`PROTOCOL_VERSION`（`2`）与
`MOD_API_VERSION`（`1`）**一个都没动** —— 这一版没有改协议形状，也没有改包的接口面。

### 我们怎么吃的：四批，各自有判据

上游那一版同时动了资源、服务器、客户端渲染与文档，我们的树在这些方向上各有自己的改动，所以没有整份照搬，按四条
互不重叠的线进场，每条线都真跑判据（不是「文件在、行为是旧的」）：

- **① 美术资源批** —— 上游缺的 **114 个本地客户端文件**落进 `public/assets/local/**`，与完整资源包**逐文件同哈希**
  （1725 个文件），`data/local-assets.json` 同步更新、各战场官方场景可提取。
- **② 服务器流量层** —— 取上游新增的 `shared/assetPaths.js` 与
  `server/http/{assetIndex,assetViews,traffic}.js` 及四个测试；`index / routes / static / websocket / config /
  files / media` **留我们的骨架、接上游的能力**（流量计数、素材内容哈希、brotli、permessage-deflate 自 1 KB 起、
  `/healthz?traffic=1`）。判据：`test/{asset-index,asset-paths,traffic,ws-compression}` 全绿 + 既有全量 `fail 0`。
- **③ 客户端渲染与设置层** —— 本版正文里 §33.5–§33.11 那几件事。`render/{spine,impostor,materials}.js`、
  `render/app/tune.js`、`screens/bandDraft.js`、`ui/guide.js`、`ui/fieldHost.js`、`ui/gameLogic/phases.js`、
  `server/sim/**/op-wisdel.js`、`tools/local-extract/extract.py` 与上游**逐字节相同**，直接取；
  `render/units.js`、`board3d/{scene,layout}.js`、`ui/settings.js`、`ui/gameLogic/settings.js` 与上游 v0.2.5
  **本来就不一样**（我们有自己的 `formsFor` 形态增量通道、大地图背景缩放、逐干员配音与工坊两个开关），所以做
  **三方合并**而不是覆盖。**接线层也必须一起走**：`test/render` 的两条判据只认 0.2.6 的 `render/app.js`，而
  「落地音」需要 `audio.js deployCue`、回合开始重播需要 `screens/game.js` 接 `roundStartReplay`、
  `ui/gameLogic.js` 要转发 `deployOrder` —— 这几件在上游那一版里同属一条改动，漏一件判据就红。
  判据：`test/render` **661 条 / 0 红**、`test/ui` **843 条 / 0 红**、**六族 golden 一次没动**（roster 49 /
  bonds 46 / fields 22 / matches 20 / standins 10 / diy 140 全部 match，**没有跑 `golden:update`**）、
  全量 **8803 条 / fail 0**、`check-imports` exit 0、mod 闸门 `check-packs.mjs --engine …` exit 0。
- **④ 文档与版本次**（就是这一节所在的那一批）—— `UPSTREAM_VERSION` 抬号、本文件、`README.md`、
  `docs/DESIGN.md` 的章节表与版本段落、`docs/history/0.2.6.md`（**§33**）、`docs/prompts/*` 的基线声明，
  以及上游那几份参考文档里与本版事实有关的部分。

### 我们保留了什么、为什么

- **形态增量通道（`shared/packForms.js formsFor`）**：`render/units.js` 里三处查 `FORMS` 的地方走
  `formsFor(FORMS, spine)` 而不是直接索引 —— 这是 **§28.29** 的包层能力（包声明 `assets.modForms`，第一方优先
  合并），上游 0.2.6 把 `units.js` 整份重写了，所以这里做的是「以上游为底、把我方那三处重新贴回」。
- **工坊与大厅那一层**：`ui/{transitions,hubBackdrop,matchFlow,protocolScene}.js`、`screens/sweep.js`、
  `public/css/**`、`shared/{workshop,modSurface,enabled}.js`、`server/{lobby,modModules}.js` 本版**一个字没改**。
  0.2.6 换了客户端渲染底层，所以这一层专门做了 **「UI-B × 0.2.6 联跑」**复验：大厅 / 房间 / 编队三页
  pageerror **0**、console error **0**，五件独有功能（座位上限滑杆、快速匹配、助战入口、房间模组回显、聊天）
  逐项实测在位可用，四个导出仍在，三视口预算（1440×900 / 1366×768 / 1280×720）**全 GREEN**。
- **i18n 走管线，不照抄文件**：我们的语言包比上游多 **122 个键**，直接拿上游的 json 会把这些键整片删掉。上游本版
  新增的两条（「弹药数量」与它的说明）按 `tools/i18n.mjs` 的规矩补进四个语言包；`en` 100 % / 0 errors，
  `ja` / `ko` / `zh-TW` 各 58 条缺译是 0.2.5 起就有的既有欠账，与本版无关。
- **协议与包接口面不动**：`PROTOCOL_VERSION` 仍是 2、`MOD_API_VERSION` 仍是 1 —— 上游这一版没有改推送帧的形状，
  也没有改包能写的接口，所以按「形状变了才抬号」的规矩不抬。

### 上游这一版带来了什么

规则面只有一条（魂灵之影只落在场上的部署格，#557 / PR #558），其余全是流量、渲染与界面：静音时不下载背景音乐、
1 KB 以上的 WebSocket 消息压缩、素材地址带内容哈希长期缓存、brotli、教程图 WebP、`/healthz?traffic=1` 与诊断里的
下载量行、官方场景光照改回官方值（#549）、显示官方场景时补画装置板（#569）、最后一个未选策略的玩家不再看到可点的
「跳过」（PR #546）、每回合开始按部署顺序重播入场动画与落地音（PR #416）、设置新增「弹药数量」（PR #552，默认关）、
单位多时缓存画面裁切与残影的修正（#542）。逐条的依据、实测数字与 `[ASSUMED]` 标记写在
[docs/history/0.2.6.md](docs/history/0.2.6.md)（**§33**；上游自己那一章是它的 §31，我们的章节号是全局且已用到 §32）。

### 3D 棋盘：官方场景在本版真渲染过

第 ① 批落的官方场景本版第一次进浏览器验：`node tools/doctor.mjs` 报「本地客户端美术（可选） 1658 项，3D 棋盘
可用，**已提取各战场官方场景**」，11 个战场逐个在 headless Edge 里真渲染，**pageerror 0 / console error 0 /
HTTP≥400 0**，画面落 `_up/up026c-shots/board3d_*.png`。

### 门槛（本版实测）

`test/render` 661 条 / 660 过 / **0 失败** / 1 跳过（`RENDER_E2E=1` 门控）· `test/ui` 843 条 / 839 过 /
**0 失败** / 4 跳过 · 全量 `node --test --test-concurrency=4` **8803 条 / 8798 过 / 0 失败 / 5 跳过**（531.0 s）·
`npm run golden` exit 0（六族 **49 / 46 / 22 / 20 / 10 / 140** 全部 match，六份语料逐字节未动）·
`node tools/check-imports.mjs` exit 0（`server/sim/nodeData.js` 的 3 处 `sim-node` 是既有基线）·
mod 闸门 `tools/check-packs.mjs --engine …` exit 0（`packs/` 10 个 + `demo/` 3 个全部装上）。
牙证明（本批新加的一条判据）：把 `shared/constants.js` 的 `UPSTREAM_VERSION` 改回 `'0.2.5'` ⇒
`test/docs-paths.test.js` 当场红（`'0.2.5' !== '0.2.6'`：「UPSTREAM_VERSION 是 0.2.5，而 docs/history 里最新的是 0.2.6」）；
把 `README.md` 的「本仓库当前的底座」改回 0.2.5 ⇒ `test/promptBaseline.test.js` 红，点名 `README.md:638`
（并会给全 `:427 / :680 / :735` 与 `docs/prompts/README.md:7`、`docs/prompts/kit.md:22` 那几处）；
把 `lobby.js` 里 `seatCapRange` 的接线去掉 ⇒ `test/roomSeatCap.test.js` 红（`max: 4` 对 `max: 20`）。

---

## 0.18.3-0.2.5 — 2026-10-13

**把「创意工坊说明」真正放进四个包，并把界面里那三个真缺口补上。** 上游游戏本体仍是 **0.2.5**，发行 tag 是
`v0.18.3-0.2.5`。

### 四个包里第一次带上了「怎么做包」

业主的原话是「发布四个包，并且包含创意工坊说明」。此前四个包里**一个字都没教人做包**（包内有 238 KB 的
`docs/WORKSHOP.md`，那是**规则**，不是**入门**；而且界面里没有任何一句话指向它）。本版把入门层随包发出：

- 新增 **`docs/START-HERE.md`**（四步做一个包：复制模板 → 改三处 → 导出 → 上传；每一步都写清「输入 / 敲什么 /
  成功看到什么 / 最常见失败原因」）、**`docs/errors.md`**（错误码白话表）、
  **`docs/task-01-换个立绘.md`** 与 **`docs/task-02-加个干员.md`**。
- 新增 **`docs/my-first-pack/`**：一个**真跑过**的模板包（`pack.json` + `assets/portrait.png`，
  共 438 字节），它是 `START-HERE.md` 第 1 步要复制的那个起点。
- `tools/package.mjs` 的名单相应扩了：`PLAYER_WORKSHOP_DOCS`（上面四份）、`PLAYER_DOC_DIRS`（`docs/examples/`）、
  `PLAYER_WORKSHOP_REFS`（`WORKSHOP.md` / `STANDARD-PACK.md` / `MOD-SURFACE.md` / `EDITOR.md` —— 入门层指向它们，
  包内断链等于把读者引到 404）、以及 `workshop/README.md`。
- 包内入口两处：包根 `README-开箱即用.md`（`scripts/make-windows-bundle.mjs` 的 `bundleReadme()`）加了一节
  **「做自己的工坊包」**（三条路 + 六份文档的对照表），并打开 `workshop/` 就能看到的那一份
  `workshop/README.md` 首行加了指路。
- **同步纪律写进了文件头**：`docs/START-HERE.md` 与 Mods 仓的 `BEGINNER.md` 同源，**改一边要改另一边**。

### 界面：A1–A5 + B1（业主说过「界面没优化过就一起优化」）

- **A1** 包管理页的「说明」面板以前**一句都没提过文档**（而服务端早就把 `/docs/**.md` 只读地挂出来了）——
  现在给《五分钟上手》《错误码白话表》《换个立绘》《加个干员》《包格式全解》五个入口。
- **A2** 九个页面顶栏共用加一个 **`帮助（五分钟上手）`** 链接 —— 这是界面里第一次出现说明书入口。
- **A3** 导出按钮改成 **`导出投稿件 <包id>.zip`**，并补一句「**这个 zip 的形状就是站点要的**：`pack.json`
  直接躺在最外层，不要手工重压」。这一句消灭的是「我要不要再套一层文件夹」那个死结：仓库里讲装包（要顶层目录）
  与讲投稿（要扁平）是两份不同的文件，界面上一句话都没说过。
- **A4** `覆盖同名包（--force）` 改成 **`覆盖机器上同名的包（危险：会先删掉 workshop/<包id>/ 里已有的那一份）`**
  —— 命令行词直接上界面，作者看不出它删东西。
- **A5 新增 `editor/ui/errHints.zh.js`**：十条最常撞的错误码（`EMPTY_PACK` / `PACK_ID_COLLISION` /
  `ASSETS_NEED_LICENSE` / `PACK_ID_MISMATCH` / `PACK_UNKNOWN_FIELD` / `BAD_API_TYPE` / `ART_NEEDS_ASSETS` /
  `TRAIT_GRANT_BAD_SHAPE` / `TRAIT_GRANT_EMPTY` / `TRAIT_GRANT_UNKNOWN_BOND`）逐条给「一句人话 + 一条修法」，
  在 `pack.js`（加载器拒绝）与 `app.js`（逐记录校验）两条渲染路径上接线。**查不到就回落显示 `[CODE] 原文`，
  绝不静默** —— 引擎里有一百多条码，没进表的那些不能让作者看到一片空白（有测试钉住这条回落）。
- **A6** 「以模板新建」的副标题补上它**不是**「改官方那位」：要换官方干员的立绘 / 数值，走
  「包管理 → 覆盖官方记录」——堵住最高频的一次误操作。
- **B1 界面里第一次能按到「真引擎校验」**：包管理页新增 **`校验这个包`** 按钮与结果面板
  （装了没装 / 必须修的几条 / 只需留意的几条，每条都给码、人话、修法、引擎原文）。
- **一处订正**：Mods 仓 `README.md` 那句「在游戏的工坊界面能看到它」**与代码不符**（`public/js/screens/`
  的 24 个屏里没有工坊屏）—— 改成实况：看启动日志 `[workshop] applied <n> pack(s)` 与游戏内容变没变。

### 校验器：判据搬到 `shared/`，CLI 与界面从此是同一个函数

B1 要的是「按一下给我结论」，而那条结论必须与 `node tools/workshop-validate.mjs` **一致**。判据原先整个住在
`tools/workshop-validate.mjs` 里，而那是**维护者工具**（不在 `tools/package.mjs` 的 `PLAYER_TOOLS` 里、不随玩家包
发出）—— 编辑器服务端 import 它会当场崩。

- 判据本体搬进 **`shared/workshopValidate.mjs`**（随包发出、编辑器与游戏共用的一层）；CLI 变成薄包装
  （解析参数 → 调同一个函数 → 打文本），**规则一条都不在它里面了**。
- 新增只读端点 **`GET /api/packs/<包id>/validate`**：调同一个 `validateWorkshop`，把报告剪成「这一个包」的，
  逐条给界面渲染。**只读**：`loadWorkshop` / `loadData` 都只读文件，没有写盘分支；只认 GET；包 id 走
  `PACK_ID_RE` 挡住路径穿越。测试里核过「GET 之后磁盘上一个字节都没变」。
- **报告形状一字未改**（`--json` 的逐包 `issues`、`itemIcons` / `art` / `support` 计数、`engine`、各分层数组），
  所以原有判据一条都没动，只是**加**了一层 `checks[]`（按层打平，带 `pack` 归属）给界面用。
  收尾还加了一条**计数自检**：入账条数必须等于报告里真实存在的条数 —— 同一件事被数两遍会当场抛错，
  而不是安静地给一个翻倍的总数。

### 测试

- 新增 `test/errHints.test.js`（18 条）：十条码逐条、英文界面也有人话、**未知码必须回落原文**、
  只读端点的读 / 权限 / 路径穿越 / 与 CLI 同一结论。带牙证明：去掉端点接线 ⇒ 3 条红；让白话表永远查不到 ⇒
  2 条红；让渲染恒返回空串 ⇒ 2 条红。
- `test/workshopValidateRoutes.test.js` 那条源码级断言（「判据只此一处，不养第二份保留名单」）跟到判据**现在
  所在**的文件（`shared/workshopValidate.mjs`）—— 它钉的是那条纪律，不是某个文件名。
- `test/package.test.js` 的清单期望跟着新名单走（只改数字与路径，判据一条没弱化）。

## 0.18.2-0.2.5 — 2026-10-13

**补丁版：把从来没跑过的两套浏览器 E2E 真跑一遍，并修掉渲染套件挡住它们的那处基座缺陷。**上游游戏本体仍是
**0.2.5**，发行 tag 是 `v0.18.2-0.2.5`。

### 渲染套件的 GPU 基座（本版唯一的代码改动）

- **`test/render/{board3d,fieldview,recovery}.browser.test.js` 原先硬编码 `--use-angle=metal`** —— 那是 macOS 的
  ANGLE 后端。在 Windows 上这个名字不是一个后端，ANGLE 于是回落到 **Microsoft Basic Render Driver**（WARP，纯
  软件）；而产品自己的 `webgl2Available()`（`public/js/render/board3d/load.js`）要的是带
  `failIfMajorPerformanceCaveat` 的上下文，软件设备给不出来 ⇒ `enable3d()` 根本不会被调用 ⇒ 3D 棋盘
  `on: false` 而 `error` 为空。**38 条 board3d 判据**就是这么红的，报错原文只有一句 `3D board on ()`。
- **改法只是让基座能在本平台跑起来**：这三处启动参数改用仓库里早就有的 `gpuArgs()`（`tools/perfbench.mjs`；
  `battle-perf.browser.test.js` 一直用它，`test/perfbench.test.js` 也一直钉它）—— Windows → `d3d11`、
  macOS → `metal`、Linux 不指定。**断言一个字没动。**
- **新增基座自检**：`test/helpers/gpu.mjs` 的 `assertRealtimeGpu()` 在三套的 `before()` 里先建一个
  `failIfMajorPerformanceCaveat` 上下文并读出 `UNMASKED_RENDERER_WEBGL`；拿不到、或后端是 WARP / SwiftShader /
  llvmpipe 这类软件设备，就**当场响亮失败并点名后端**，不再留一句空 error 让人猜。`test/render/gpu-harness.test.js`
  用假 Browser 钉住这两条（5 条纯单测，不需要 GPU）。
- 实测（本机 Edge = Chromium 内核，`Edg/156.0.4314.15`）：改前同一页 `board3d.on=false, error=null, fps 59.8`；
  改后 **`on=true, calls=9, fps=200`、0 pageerror**，自检打印的后端是 `NVIDIA GeForce RTX 5070 Ti (D3D11)`。

### 两套浏览器 E2E 首次开跑，与逐条归因

- **`RENDER_E2E=1`（29 个文件）**：修基座前 **150 条 / 102 过 / 47 红**；修后 **141 过 / 8 红**（用时 613 s → 540 s）。
- **`SP_E2E=1`（48 个 `test/ui/*.e2e`）**：**231 条 / 202 过 / 28 红**（这一套不经 `gpuArgs()`，基座改动与它无关）。
- **`SIM_E2E=1`**：`test/sim/*.browser.test.js` 3 个文件全绿（`morph-bonds` 单跑 3/3）。
- **不为「全绿」背书**：这两套此前从未在任何机器上跑过（`581ed1cb` 的 commit message 就写着「两条 RENDER_E2E
  门控文件已搬但本环境未开 RENDER_E2E，未真跑」），所以它们**没有基线**。逐条归因的办法是**把同一批测试文件拿到
  上游 `v0.2.5` 的树上、同一台机器、同一套基座下再跑一遍**（上游 tag `v0.2.5` = `cf7a940`）：
  - **渲染侧落下的 8 条全部是「本就如此」**：`forms`（crawling 的 `*_02` 剪辑集）、`feedback1-forms`（`the change
    clip`、`重生: 'Die'`）、`feedback5-prisoners`（`enemy_1116_liprr warning` 的橙色集）、`held-pose`（`held final
    frame is pixel-identical to continual updates`）在上游 `v0.2.5` 上**报的是同一句断言**；`fieldview` 的两条
    4× 降频 50 fps 判据在上游同样红（`boss (3d): 49.5 fps`），本机复跑时它自己在 40.5 / 42.2 / 49.9 fps 之间来回
    翻（同一条判据这一轮过、下一轮又过 2d 那条）—— 是卡在 50 fps 门线上的**阈值抖动**，不是本仓库引入的性能回退。
  - 这五个渲染文件里，`forms` / `held-pose` / `feedback1-forms` / `feedback5-prisoners` 与上游 `v0.2.5`
    **逐字节相同**，`fieldview` 只多 0.18.1 加的那 6 行。
  - **UI 侧（SP_E2E）**：同样这 10 个文件在上游 `v0.2.5` 的树上也红 **21 条**（我们 28 条）。我们多出来的集中在
    `loadout.e2e.test.js`（10 条）：它们的 `problems` 里只有 `requestfailed: …/audio/voice/{cn,en,kr}/…  net::ERR_ABORTED`
    —— 本仓库 **0.7.1 起**的**多语言配音**（`audio.voiceLangs` + 逐干员配音，`public/js/audio.js` 的
    `voiceLinesFor` / `voiceLangOf`；该文件在 `581ed1cb^` 上就已经有这套模型，比 0.2.5 的合并早得多）会按候选配音
    取音频，浏览器把没播的那几条标成 `ERR_ABORTED`，而上游后来加的这条「页面没有任何 console / 页面 / 请求错误」
    判据只认空数组（本仓库自己的 `kitimports.e2e.test.js` 反而显式过滤 `ERR_ABORTED`，可见项目一向把它当良性）。
    这条是**两位作者的设计差异 + 从未跑过的判据**，不是本版引入的行为变化。
  - `devices.e2e.test.js`（8 条）是视口 / 触屏版式的 `deepEqual` 与两条导航 `TimeoutError`：该文件本仓库比上游多
    11 行、少 5 行（本仓库自己扩的设备矩阵），上游那次同跑也红 2 条；`text-scale` 那条只在 48 文件同跑时出现、单独
    跑 10 文件时不复现（超时类）。`community-controls` 反而是**上游红 13 条、我们红 1 条**。
  - **结论：75 条红全部有归因，没有一条能归到「本版引入的回退」** —— 本版没有改产品行为。
- 静态检查（首次逐项对基线）：`npx eslint .` → **0 errors / 218 warnings**（与基线一致）；`npx tsc --noEmit --checkJs
  -p jsconfig.json` → **6 errors**（`shared/formProjection.js` 4 条 + `shared/morph.js` 2 条，与基线逐条一致）；
  `node tools/check-imports.mjs` → **3 处**违规（`server/sim/nodeData.js` 的 `node:fs` / `node:path` / `node:url`，
  与基线一致）。

### 官方战场：两条实测事实

- **没有本机《明日方舟》客户端就提不出场景**（实测）：`node tools/setup.mjs --scenes` 退出码 0 并报「没有本机
  客户端，不能提取战场场景（贴图仍取自客户端）」；`python tools/local-extract/fetch_scenes.py` 退出码 0、
  **33/33 个包**、落盘 33 个文件 / **29,714,076 字节**；`tools/local-extract/extract.py --only scene` 退出码 2
  （`No Arknights install found`），把 `--game` 指到下载目录也只能退出码 1、**落盘 0 个文件**（日志逐条
  `dependency …arts/maps/… missing`、`mesh #10210: File cab-… not found`）—— 场景的材质与网格取自客户端。
  没有客户端时游戏照常运行，3D 棋盘用**程序化金属地块**优雅退化。
- **完整包会自动带上打包机上已提取的本地资产**（实测）：`scripts/make-windows-bundle.mjs` 里 `app/` 的**代码**
  清单来自 `git ls-files`，但 `public/{assets,fonts,vendor}` 走 `copyDir` **整目录复制**，另有一步显式收
  `data/local-assets.json`。已发布的 `v0.18.1-0.2.5` 完整包里 `app/public/assets/local/**` 实测 **1611 个文件 /
  70.3 MB**、`app/data/local-assets.json` 在位（两者都在 `.gitignore` 里）。所以**谁有客户端谁提取，他打出的完整包
  就自带官方战场**（含 `public/assets/local/scene/`）。打包脚本**未因此改动**；场景本身给完整包增加的体积仍未实测
  （本机提不出，0 个文件）。

## 0.18.1-0.2.5 — 2026-10-13

**`v0.18.0-0.2.5` 的补丁版：把那一版的资产里**没有**的三笔补齐** —— ① 池权重数据（洛洛八件加权池 + 焰尾
10/10/3）与落到上游 0.2.5 的 `test/match/pool.test.js`，外加六族 golden 里按新数据重算的 6 个 matches 场景；
② 三笔欠账（打包脚本的「工作区必须干净」守卫 · `docs/WORKSHOP.md` 的历史双编号收掉并补一条无重号守卫 ·
`docs/img/*.svg` 的陈旧与矛盾数字）；③ 两个仓库的 README 与 mods 仓库的 `SKILL.md` / `AGENTS.md` / `UPLOAD.md`
按实况更新。上游游戏本体仍是 **0.2.5**，发行 tag 是 `v0.18.1-0.2.5`。**

### 池权重数据补齐（上游 0.2.5 的 PR #497）

- **`tools/build-data.mjs` 与上游 0.2.5 逐字节一致**：`pool_equip_rockr` 由「4 件均匀」改为路标月报 #2 实测的
  8 件加权（维式重锤 10 / 战栗维式重锤 2 / 坚固维式重锤 2 / 加速维式重锤 2 / 灼燃维式重锤 2 / 有限加速器 1 /
  护盾无人机 4 / 激光发射器 4），`pool_char_pinus` 由 `45/45/10` 改为 `10/10/3`，共 4 行。
- **`data/choices.json`** 由 `node tools/build-data.mjs --offline` 重跑生成（未手改产物）：16 个池里**只有这 2 个变**。
- **`test/match/pool.test.js` 落上游 0.2.5 的版本**：单跑 **11 条真绿**（不是跳过），逐个字段真跑加权与去重路径。
- **六族 golden 里只有 `matches` 变、恰好 6 个场景移动**（`coop2-NORMAL-1-coverage-standins` · `coop2-NORMAL-3` ·
  `coop2-NORMAL-8-serverrun` · `coop3-ABYSS-5` · `coop4-ABYSS-7` · `coop4-FUNNY-6`）：**没有用 `golden:update`** ——
  在仓库外按 `goldenDocument` / `stringifyGolden` 生成六份、校验定义集与移动集合后才拷回；场景 id、`about` / `fast`
  逐字不变，UNEXPECTED 0 / PENDING 0。其余五族**逐字节未动**。

### 三笔欠账

- **打包脚本加「工作区必须干净」守卫**：`scripts/make-windows-bundle.mjs` 与 `scripts/make-update-package.mjs` 共用
  同一份实现 —— 清单来自 `git ls-files`、内容来自磁盘，工作区脏就会打出与 tag 对不上的包，所以有未提交改动就
  直接拒绝；`--allow-dirty` 是显式放行并打印风险。配套 `test/windows-bundle.test.js` 两条判据（纯函数 + 真跑一次脚本），
  `docs/DEPLOY.md` 与 `docs/WINDOWS.md` 两处说明同步。
- **`docs/WORKSHOP.md` 的历史双编号收掉**：目标引擎（`target`）那一节由 **§1.23** 改号为 **§1.26**（§1.23 归「逐格加开关」，
  CHANGELOG 与 `docs/design/mod-layer.md` 两处引文指的正是它），§1.24 里指 `FOREIGN` 的那处编号跟着改；顺带把
  两处闭集数字按实测改准（顶层键 34 → **35**，与 `PACK_FIELDS` 实测一致）。新增守卫断言「`docs/WORKSHOP.md` 无重号
  编号标题」—— 判据钉在**号**上而不是整行标题上，因为重号的两节标题文字必然不同（按整行判一条都抓不到）。
- **`docs/img/*.svg` 的 5 处陈旧 / 矛盾修正**：`cap-01-layers.svg` 的「上游 0.2.4」改为 0.2.5、「behaviour（表空）」
  改成实况的 4 格、补 `target` 与依赖 / 互斥（原来图与 README 正文直接矛盾）、「mod 仓库（25 条）」改为**条数以
  `mods/index.json` 为准**（实测 30 条）；`cap-02-pack-lifecycle.svg` 的「顶层键 32」改为**实测 35**；
  `cap-03-submission-pipeline.svg` 的「今天 3 个包」改为**实测 8**（`packs/` 目录）。三份 SVG 均过 XML 语法校验。

### 两份 README 与 mods 仓库

- **引擎仓库 `README.md`**：「Forge 现在能干什么」补四行已合入的面（特质授予盟约 §28.49 / 宿主 lane §28.44·45 /
  `target` §28.46 / 依赖与互斥 §28.48）与登记册一行（§28.47，注明编辑器未接）；「还不能做什么」把编辑器未接登记册、
  `server.modules[].channels` 不存在、没有热重载三条写明白；能力图与能力总表按实况对齐；英文节同步。
- **mods 仓库 `README.md` / `SKILL.md` / `AGENTS.md` / `UPLOAD.md`**：`trait.grantsBonds` 由「在途 / 未合入」改为
  **已可用**（§19.7，三个读取点都调同一份判据），并留下「上一版写在这里的 `trait.grantsBonds` 已经落地」的对照。

### 门槛（发布前全绿）

`node --test --test-concurrency=4` **8642 条 / 8636 通过 / 0 失败 / 6 跳过**（263.5 s，两轮一致；跳过全是 Chromium / 素材门控）·
`npm run golden` exit 0（六份语料 **49 / 46 / 22 / 20 / 10 / 140** 全部 match，只有 `matches` 的 6 个场景按上面的新数据
重算）· mod 闸门 `tools/check-packs.mjs --engine …` exit 0（`packs/` 8 个 + `demo/` 3 个全部装上）。

---
## 0.18.0-0.2.5 — 2026-10-13

**本版吃上游 0.2.5：规则面（浮游族的本体一击、受击格四舍六入五成双）、界面面（官方伤害数字默认关、盟约叠层音效）、
工具面（打包脚本、`/dev/sim-check`、场景提取）三条线一并并入；上游游戏本体升到 **0.2.5**，发行 tag 是
`v0.18.0-0.2.5`。**

### 规则（按官方，上游 0.2.5）

- **受击格改用官方四舍六入五成双**（PRTS 作战机制，PR #520）：`body.js` / `targeting.js` / `battle/queries.js` 的
  取整全走 `detmath.roundHalfEven`；被挡在场地边缘的敌人被 `FIELD_EDGE_INSET` 按在边线内侧那一格，不会因为边号是
  奇数而落到场外（`battle/spawns.js`）。
- **驭械术师的浮游改成本体一击 + 未释放浮游的附加伤害**（PR #537）：`funnelMul` 与本体倍率分离，附加实例带
  `addition, funnel` 标签并共享 `attackId`，一次天赋掷骰；`funnelBodyHits: 0` 是「只要浮游不要本体」；再部署与
  换目标立刻重置斜坡，自由移动保留（PR #536）；洛洛 S2 在目标离开攻击范围后继续锁定（PR #535）。
- **只改普攻的技能保留干员自己那一击**；要塞职业自身格也满足基础开技条件。
- **联防阿戈尔开场不再二次结算吞噬**：HP/SP 恢复推迟到全部开场效果之后，保留精确比例与小数生命。
- 自在重生后的无敌期不再被普攻或需要可选目标的自动技能锁定（#510）；谢拉格不融冰、催泪瓦斯改「造成伤害时」判定，
  含持续伤害（#489）。
- 首领配对改为**每局随机**、准备期至开战固定，隐藏首领沿用同局分组。

### 对局与经济（上游 0.2.5）

- 固定赠品不再被共享库存阻断（#488/#491/#495）；已展示的干员商店牌与奖励牌不再因随后库存耗尽而领取失败（#498）。
- 调度中心 4 级的五阶晋升奖励可以出现五阶自选（#515），自选来源是 `diyStockEntries`（本作把上游那一处与我方
  100 座变体的主池分派点 `mainPool()` 合成在一条语句上）。
- Touch 外勤医疗按本局团队权益保留：持有者淘汰或退出后不再使下一场医疗消失。
- AI 选开局策略与构筑重心时软性让开仍在场队友已经选择的阵营（#514）。

### 界面（上游 0.2.5）

- 设置新增「官方伤害数字」（默认关闭，#412）：只按 PRTS 红字规则显示红色整数，以及本该出红字却被闪避的 MISS；
  判定在 `server/sim/damage.js`，客户端只画。
- 补齐回合开始、机变、休整期和战斗中的盟约叠层提示音（#482）：`m.layer` 由服务端在**真实备战相位**发出，
  重连与结算回填不补播，同类最多一路。
- 标题画面页脚新增「项目仓库」链接；敌血条头顶高度、AI 托管遮罩、攻击后模型多挥一次（#506）等修正。

### 有意与官方不同的调整

- **萨卡兹枯朽战士 / 组长**：上游 0.2.5 把「沉默时死亡不留污染秽蚀」的理由改述成维护者的实机回忆，并写明它与
  PRTS / 游戏内文字「不可沉默」相反。**本作不采纳该改述，也不采纳它的断言** —— 理由仍是 0.2.0 起的客户端模板读法
  （battle prefab 的 `projectile_on_killed` 先查 `CheckAbnormalFlag SILENCED`），行为是**这两个键可被沉默、沉默状态
  下死亡不留污染秽蚀**（GitHub #470 拒）。钉子：`test/content/enemies_bosses.test.js` 的具名判据
  `#470 拒: …可被沉默…`，记录见 `server/sim/content/enemies/archetypes.js` 与 [history/0.2.5.md](docs/history/0.2.5.md) §32.32。
- 本作 `APP_VERSION` 保持 **`0.18.0`**（拒上游把 `APP_VERSION` 改成 `'0.2.5'`；本仓库的发行号自己的那一半），
  `UPSTREAM_VERSION` 由 `'0.2.4'` 抬到 `'0.2.5'`。

### 门槛（发布前全绿）

`node --test` **8638 条 / 8632 通过 / 0 失败 / 6 跳过**（三条支线整合后的实测；跳过全是 Chromium / 素材门控：批2 带进来的
`test/ui/bond-audio.e2e.test.js` 就是 `5 跳过` → `6 跳过` 的那一条） · `npm run golden` exit 0（六份语料 **49 / 46 / 22 / 20 / 10 / 140**
全部 match；本版重算 66 个场景，与上游两 tag 的差集逐条一致，见 §32.34）· `--twice`（第二遍倒序）identical ·
`GOLDEN_FULL=1` 9/9。

## 0.17.0-0.2.4 — 2026-10-12

**这一版把「给模组用的那些面」收成一套：`behaviour` 四格全部落地，宿主两条路径表、`pack.json.target`、mod 登记册、
跨包依赖裁决与 `trait.grantsBonds` 一并并入。** 上游游戏本体仍是 **0.2.4**，所以发行 tag 是
**`v0.17.0-0.2.4`**；`PROTOCOL_VERSION` 仍是 **2**、`MOD_API_VERSION` 仍是 **1**、`UPSTREAM_VERSION` 仍是
**`0.2.4`**。默认游戏行为**逐字节不变** ⇒ **不需要 `golden:update`**。

### `behaviour` 四格：开关表从空表变成四格（第 8 刀）

上一版（0.16.0）交的是**通道 + 守卫**本身，那一版**一个开关都没有**；这一版把四格补齐，并顺手把两处语义收进
同一份判据。

* **`shopBias`**（投稿 `b293e061b38f`）——商店装备槽**偏向已激活盟约的装备**。
* **`prepLoadout`**（投稿 `8b4e5da55c58`）——**休整期也能改技能与模组**（客户端那半也在这一版补上）。
* **`morphPairing`**（投稿 `19ea65909cf6`）——变形同构体的**配对规则**：三处读取点收成**一份判据**（原来是三处
  各写一遍，改一处漏两处）。第 7 段槽位语义在这一格落地：变形同构体**不占位**、**每名干员一件**、**第三件顶掉
  真占格的那两件**。
* **`unequip`**（投稿 `79de9ff03518`）——**装备拆卸**，也是本层第一条「开关 + 新意图」：加一个 `behaviour`
  开关会连带加一条 C2S 意图，同步点不止一处，`DESIGN §28.43.2` 把「加意图清单」写成显式全表。
* **两条门禁**把「文档说 `BEHAVIOUR_SWITCHES` 今天是一张空表」这句话与代码钉在一起 —— 那一句是**按时间叙述**，
  这一版之后它就该红，红在文档上而不是让人猜。

### 宿主 lane：两条路径表的移植（DESIGN §28.44 / §28.45）

- **§28.44 升级路径表**（PR #4）：宿主用**数据**注册 WebSocket 升级路径，同一条端口上跑第二套协议。
- **§28.45 请求路径表**（PR #5）：宿主用**数据**注册命名空间子树与方法（含 `POST`），模组自己的页面与自己的
  写入口不再靠改引擎。
- 两处「Numbering」段原先引用了本树**不存在**的 `§28.43.4`，验收补缺时一并修掉（引用指错行不会有人踩空，
  但会让人以为那一节不存在）。

### `pack.json.target`：一份清单两个宿主读得懂（DESIGN §28.46）

**`foreign` 三面接线**（移植 PR #3 收尾）：`target` 声明的是「这份包写给哪个宿主」，缺省 `forge`，`stardust`
是声明型 —— 三面（装载、登记、作者侧校验）都读同一个字段，所以**跨宿主误用不再静默通过**，而是被点名。

### mod registry 与跨包裁决（DESIGN §28.47 / §28.48）

- **§28.47 登记册**（移植 PR #3）：**装过什么 / 操作者启停过什么**落一份登记册，落点是 `SP_STATE_DIR`
  重定向的 `var/mod-registry.json`（并进 `.gitignore`：它是运行态，不是源码）。
- **§28.48 依赖 / 冲突**（移植 PR #3）：`pack.json.dependencies` / `conflicts` 在**装载期**裁决 —— 跨包的
  依赖装不上、或两个包互相冲突时，当场点名，而不是等某个玩家进游戏才发现功能少了一半。

### `trait.grantsBonds`：特质 ⇒ 盟约成员资格（DESIGN §28.49）

把「特质给出盟约成员资格」写成**数据**（纯数据叠加盟约层数），不再让每个包自己推一遍。这一刀另有 11 处
`shared/workshop.js` 引文修正：其中 1 处是本刀漂移、10 处是在**父提交上就已经指错**的旧账。

### 作者侧校验器读 `coreRouteShadow`（PR #6）

作者侧校验器原先**自己算**一遍路由遮蔽，于是「会被丢掉的 `routes` 声明」照样发 **VALID** —— 作者以为声明生效了，
游戏里没有。现在它读**服务器那一份** `coreRouteShadow`，同一份判据只有一处实现。

### 文档判据与若干修正

- 新增两条**文档判据**，把「按时间叙述」与「现在时断言」分开，避免把历史叙述误判成违规。
- `docs/prompts/kit.md` 一处 `server/sim/Battle.js:149` → `:150`、`:113` → `:114` 的引用位移重指；
  `docs/WORKSHOP.md` 加一条判据（走自选池的干员在 `data.chess` 里没有棋子是**正常形状**，别误报
  「永远进不了游戏」）；`docs/design/mod-layer.md` 修 8 处 `WORKSHOP.md` 引用；`docs/MOD-SURFACE.md`
  把 `morphPairing` 槽位半条的冻结锚点点名。
- 测试平台修复：浏览器套件截图落盘改用 `fileURLToPath`（Windows 上 `new URL(...).pathname` 会解成
  `E:\E:\…`，那是**测试工具**的错，不是产品的错）。
- `support/index.js` 补 3 行再导出，把引擎已有的 5 个原语交给工坊 kit（**只增导出**，不改既有行为）。

### 门槛（发布前全绿）

`node --test` **8367 条 / 8362 通过 / 0 失败 / 0 取消 / 5 跳过**（357.9 s）· 三件套
（`docs-consistency` / `docs-paths` / `promptCitations`）**39 / 39** · `npm run golden` exit 0
（六份语料 49 / 46 / 22 / 20 / 10 / 140 **全部 match**）· mod 闸门
（`tools/check-packs.mjs --engine .`）**exit 0**（`packs/` 8 包 + `demo/` 3 样板全部装上）·
`data/` 与 `test/golden/` **零改动**。

---
## 0.16.0-0.2.4 — 2026-10-12

### 对局战绩与可选账号（第 2 刀）

**战绩落盘 + 可选账号口令库（docs/RECORDS.md）。** 今天 `playerId` 每次连接都是新的，所以「我上一局打得
怎么样」换个会话就找不回来；这一刀给两样东西：一次完整结算落一条战绩，以及一个**默认关闭**的账号层（账号名 →
跨会话稳定的 `playerId`，口令由玩家自己持有）。

* **开关是显式的 `SP_ACCOUNTS=1`，不是「某个文件恰好存在」。** 没有它时 `AccountStore` 与 `MatchRecords` 都
  **不构造**：`hello` 里没有认证那一段、结算点不落盘、`GET /api/records/account/<NAME>` 回 404。**老客户端握手
  逐字节不变**（`playerId` 还是那 10 位十六进制临时 id）。
* **口令**：每账号 16 字节随机盐 + scrypt（`N=2^15, r=8, p=1`），`timingSafeEqual` 比较，**永不落明文、永不回显**，
  落盘 `0o600`。登录失败不区分「账号不存在」与「口令不对」（那会是账号枚举）；注册才分开
  `NAME_TAKEN` / `WEAK_PASSWORD`。坏库 / 版本不对 ⇒ 抛（fail closed）。
* **限流按客户端网络键**（`TokenBucket(0.1, 8)`）加同连接不并发派生 —— 一次 scrypt 是几十毫秒单核 CPU，没有这道
  闸门口令库就是一个 CPU 放大器。
* **改密入口本版不存在**（业主裁令）。投稿带的是 `POST /api/account/password` + 站点级共享 `SP_ADMIN_TOKEN`：共享的
  管理员密钥不是玩家的口令，而且它会让「必须提供旧口令」变成装饰。连为它服务的脚手架（`sameSecret` /
  `readJsonBody` / `adminToken` / `MIN_TOKEN_LENGTH`）都没有实现。将来要代改，另立一次性重置票据的设计。
* **战绩落盘有界**：JSONL 追加日志（行首 `v` = 行格式版本；坏行与未知版本**跳过并告警**），`byPlayer` ≤ 20000、
  `byRoom` ≤ 5000，追加到 5000 行时**原子压缩重写**（临时文件 + `rename`）。行数硬上界 `20000+5000+5000`。
  **代价**：压缩丢弃不再被索引引用的历史局 ⇒ 这不是一份可归档的战绩史（`SP_RECORDS_FILE` 指到会备份的地方）。
* **公开战绩面收窄**（业主裁令）：`GET /api/records/<CODE>` 只给 **seat + 是否本人**；`GET /api/records/account/<NAME>`
  只回**被查账号本人那一行聚合**（队友的昵称与逐回合购卡明细都不出现，本人明细走 `records.mine`）。昵称与购卡
  明细只到房间成员与本人。`playerId` 任何档位都不出现在公开面。**房间号不是安全边界**。
* **两条只读战绩路由限流**：每客户端地址 `TokenBucket(1/s, 突发 10)`，超限 **429 + `Retry-After`**；两条共用一只
  桶。HTTP 面不受 WebSocket 的桶保护，而 `/account/<NAME>` 若不限流就是一个账号名枚举面。名字与登录同一套键
  （NFC 归一 + 小写、**精确匹配**），「账号不存在」与「存在但没打过」**同答复**（否则是存在性探针）。
* **协议面**：`hello` 加**可选** `auth` / `password`；C2S 加 `records.mine`、S2C 加 `records.latest`。
  **`PROTOCOL_VERSION` 与 `MOD_API_VERSION` 都不动**，不改默认游戏行为 ⇒ **不需要 `golden:update`**。
  `server/net.js` 的 `HEAVY_TYPES` **只**多 `records.mine`（`room.list` / `room.skins` / `user.activity` /
  `lastInputAt` 属于第 3、4 刀，投稿的补丁把它们混在一起了，这里一律不带）。
* **`sanitizeName` 一律不动**：投稿要禁 `test` / `admin` / 三位以上 `a`。那反转的是**既有判定**（脱敏 + 截断），
  会打断 `test/lobby.test.js` 与 `test/client-static.test.js` 的既有断言，客户端 `title.js` 另有一份会漂移，而且
  它**不解决顶替** —— 另议。

### 房间目录读面：`GET /api/rooms` 只报一个数（第 3 刀）

**新增只读端点 `GET | HEAD /api/rooms` ⇒ `{ "publicRooms": <int> }`（DESIGN §28.42，docs/META.md §1.7a）。**

- **一个数，不是列表**：公开面**永远只有** `publicRooms` 这一个整数字段，**不**回答房号、房主名、人数或任何明细
  —— 任何一个这样的字段都能把「数」变成对某一个房间的**侧写**。`sendJson` 回答（`no-store`），
  `POST` 等动词走既有的 `405` + `Allow: GET, HEAD` 闸。
- **管理员面不新建任何东西**：`/healthz` 的 `rooms`（= `Lobby.stats().rooms` = `rooms.size` = **全部房间数**）
  就是业主要的那个数，运维口径。**本刀不引入** `SP_ADMIN_TOKEN` 这类共享管理员秘密。
- **「公开」的定义：今天没有这个概念，所以照实说。** 引擎今天没有「公开 / 私有」这个房间属性（`inviteOnly`
  不存在，本刀**不预埋**），因此 `publicRooms` 与 `/healthz` 的 `rooms` **今天恒等**，两者共用
  `Lobby.roomCounts()` 的**同一次遍历**与同一个 `rooms.size`（solo 房算数）。`this.rooms` 只装在册房间
  （`disposeRoom` 立刻 `delete`）。`inviteOnly` 将来落地后，`roomCounts()` 是唯一该改的地方。
- **协议面一字未动**：`shared/protocol.js` 的 C2S / S2C 不改，`server/net.js` 的 `HEAVY_TYPES` 不加任何东西,
  **不引入** `ACTIVITY_TYPES` / `user.activity` / `lastInputAt`；`PROTOCOL_VERSION` / `MOD_API_VERSION` **不抬**；
  默认逐字节不变（不新增任何线上帧，`/healthz` 的字段集合不变）。
- **投稿 `7ca51de6f346` 的采纳/改动说明**（作者 **Leiothrix**，来源 `NeoPecos/Stronghold-Protocol 2cadc618`，
  基线 `sganggs/Stronghold-Protocol bc50cac0`，许可 **GPL-3.0-or-later**，原件不含游戏素材）：
  原件要的是 C2S `room.list` + `user.activity` 与 S2C `room.list` —— 整张**公开合作房间**列表，每条含房号、
  房主代号、难度、真人与 AI 人数、在线及近期操作人数、招募或对局状态，并提供加入 / 观战入口，招募房间优先，
  **独立模拟（solo）房间不公开列出**；它自己在 `SOURCE.md` 里就写明这需要引擎提供**受限的列表读面**，
  **不要让普通模组直接访问整个 Lobby 内部**。
  **采纳**：受限只读读面这一条**方向**（业主裁令收窄为「只给公开房间数 + 管理员可看全部房间数」），
  以及「不要暴露 Lobby 内部」的边界主张。
  **改动**：不做全量枚举、不做 `room.list` / `user.activity` / `lastInputAt` / `inviteOnly` / `recruitWanted`，
  不做加入 / 观战入口与招募排序，**也不预埋**这些字段；公开面只剩一个整数。
  **未采纳的原因**：整张列表需要先有一整套「公开 / 私有」房间属性、一个心跳口径和一套限流，且会把 4 字母房号
  变成可枚举的东西。**solo 房**按业主裁令**算数**（与 `stats().rooms` 同口径），与原件「solo 不列出」不同 ——
  这一处是我们**刻意**的口径差异。
- **隐私边界（照实写）**：只给数 ⇒ 不泄露房号 / 房主名 / 人数明细；但 `n = 1` 时「数」就等于暴露「有一个房间
  存在」，`n = 0` 与 `n >= 1` 的差别本身可推「现在有没有人在玩」，这个量级无法再降。而 `/healthz.rooms` **今天
  就已经公开同一个数**（默认 `HOST='::'` 全网卡绑定），所以本刀新增的信息量约等于零。
- **测试**：`test/lobby.test.js` —— body 恰好一个字段、随注册表 +1 / 离开 −1、**隐私哨兵**（建房后响应文本不得
  含该房号或房主名）、HEAD 200 无 body、POST 405、`roomCounts()` 与 `stats()` 同源
  （`publicRooms === total ===` `/healthz` 的 `rooms`）。

### 素材加载源：`pack.json.assets.mirrors[]` + `sources(ctx)`（第 5 刀）

**素材加载源：`pack.json.assets.mirrors[]` + `sources(ctx)`（DESIGN §28.40，docs/WORKSHOP.md §1.21）。**
投稿 `2a031cf0f869`（「CDN 源选择」）的作者在 `note` 里把话说得很直：**做不到改素材加载源**。这一版把那一格补上，
由两半组成 —— 数据那一半 `assets.mirrors[] = [{ id, base, sha256 }]` 说**哪些镜像被允许**，面板模块导出的
`sources(ctx)` 说**先试哪一条**。

- **只镜像「本包自己的容器」**，绝不做「把整棵 `/assets` 树指到第三方」。三条硬事实：`data/assets.json` 只有
  清单级摘要、**没有逐文件摘要**（哈希锁得住清单字节、**锁不住图**）；把整站素材树交给第三方正是「不分发官方
  素材」要拦的形态；坏一个镜像就等于**全站**素材出问题，收窄之后只影响一个包。`server/http/static.js` 一行未改。
- **形状与守卫全部点名**：`base` 必须绝对 `https://`（有主机、无凭据、无查询、尾斜杠）、id 唯一且 ≤ 4 条、
  `sha256` 是 64 位小写 hex、字段闭集；声明了 `mirrors` **必须**写 `license`
  （`ASSETS_MIRROR_NEEDS_LICENSE`：素材的再分发者是作者，授权问题不因为换了一台主机就消失 —— 与 §28.36 的
  `VOICE_CDN_NEEDS_LICENSE` 逐字同一条理由）。八条拒绝码：
  `ASSETS_MIRROR_{BAD_SHAPE,UNKNOWN_FIELD,BAD_ID,DUPLICATE_ID,BAD_BASE,BAD_DIGEST,TOO_MANY,NEEDS_LICENSE}`。
- **装载期比对、不下载**：每条镜像的 `sha256` 必须等于**装载期从包内文件算出的**容器摘要；对不上的那条**停用并
  点名**（`ASSETS_MIRROR_DIGEST_MISMATCH`）而**不是拒绝整个包**（§28.35「宁少不拒」）。**服务端一条网络请求都不
  发** —— 没有服务端超时、没有服务端缓存目录、没有启动期阻塞（与 §28.36 的 `voiceCdn` 相反）。
- **客户端次序是硬性的**：取清单 → 取容器 → **先核整包 sha256**（必须 `checked && ok`）→ 再走**既有**的逐文件
  SHA-1[0:12] 导入与写缓存；任何一步不过就换下一条；**全都不行 ⇒ 回落包内那条 `/workshop-resources/…` URL 并
  点名**（`CLIENT_SOURCES_FALLBACK` + `via: 'pack'`，面板可见）。**不静默、不空白。**
- **`sources(ctx)` 结构上不可能引入主机名**：与外观提供者（`appearance(ctx)`）逐条同构（进程内最多一个、
  四个具名拒绝码、只提供不 `mount` 不是错），返回 `{ order(mirrors) }`，**只许回已声明 id 的排列或子集**；
  喂主机名 / URL / 未声明 id ⇒ `CLIENT_SOURCES_BAD_ORDER`，整条顺序作废。地址只在 `pack.json`，
  而每条都已在装载期与包内容器摘要比对过。
- **一键回退**：设置里新增「工坊素材源」（`settings.workshopSources`，默认开）。关掉 ⇒ 走的与「没声明 `mirrors`」
  **完全同一条**路径，镜像那条 URL **一次都不被请求**。
- **如实说清的做不到**：容器大于 **256 MiB** 用不了镜像（浏览器没有流式摘要接口），那类包只能走包内；不设这条线
  就等于「不核摘要也导入」，那是「不能算错」的直接反面。
- **缺省逐字节不变**：不声明 `mirrors` 的包归一化清单里没有这个键、`welcome.modAssets` 里没有这个字段、请求的
  URL 与次序与从前逐字相同、引擎 SW（§28.13.5）一行未改。**`MOD_API_VERSION` 仍是 1**（加一格字段不抬版本）、
  **不要求 `combat: true`**（只改「哪台主机送同一份已校验字节」，改不了这一局的结果；容器摘要本来就在内容哈希里）。
  **不新增协议消息、不动 `server/http/routeMount.js`、不动 `MOD_SURFACE_FROZEN['1']`**（新表面 `client.sources`
  只加不改）。

### 口径轴 `form`：干员形态投影（第 6 刀）

**口径轴 `form`：普通干员按精锐形态出战（DESIGN §28.41，docs/WORKSHOP.md §1.20）。** 投稿 `e4fe4d5cf0a0`
（「干员满练mod」）的 `training` 一段真正想做的那件事，在这里单独立项落地：`pack.json.variants` 加第三条轴
`form`（`official` / `elite`，缺省 `official` = 引擎今天的行为），`elite` 时每条**普通（`_a`）**棋子按它精锐兄弟
（`_b`）的**战斗职能**出战。

* **数值全部由引擎自己烘，包一个数都不许塞。** 投影从**引擎自己的** `_b` 记录读 `stats` / `trait` / `skill` /
  `skills` / `talents` / `module` / `modules[]` / `assets`（`shared/formProjection.js`；`IDENTITY_FIELDS` 复用
  `shared/standIn.js` 那一份）。投稿自带的那套数**没有被采纳**，而且是刻意不采纳：它比引擎今天**低**
  （投稿给 `chess_char_1_01_a` 的 `atk` 是 497，引擎的 `_b` 是 531），照搬会**静默降级**干员。
* **身份与价格都不动**：棋子 id、`tier`、`price`、`sellPrice`、盟约、特质、`upgradeNum` / `upgradeChessId` 仍是
  `_a` 那一份。
* **`status` 是身份标牌，不参与投影**（`phase` / `level` / `skillLevel` / `equipLevel` 整格留在 `_a`）。这条是**刻意
  的**，三条理由：**①** 引擎从它读补位形态（`shared/standIn.js` 的 `statusKey` → `backups.units[charId].forms`）、
  模组激活与技能档位（`:64`），`test/backups.test.js:209` 逐字钉住 `_b` 的 `status` —— 挪过去会连带改掉这三条既有
  语义；**② 数据本身不允许**：129 对里 **39 对**的 `_b.level` **小于** `_a.level`（`1/55` → `2/50`），照搬会让那 39
  块地**显示练度回落**，直接违反本轴的「不许降级」；**③** 投稿自己也是这个口径（它对 `_a` 只写
  `status.skillLevel = 7`，不改 `phase` / `level`）。作者的意图仍然达成：投影后 `_a.skills[]` 每条的 `level` 与
  `_a.skill.level` **都跟着精锐走**（引擎里 `skillLevel` 与 `skills[].level` 恒等，`test/data.test.js:453` 钉住）。
* **两条如实披露的后果**（业主裁决 2026-10-13；两者都是刻意的，也是它必须标 `combat: true` 的理由）：
  **① 1 阶价拿到精锐形态的数值**（价格不动 ⇒ 一枚 1 阶棋子带着精锐的数值上场）；
  **② `upgradeNum` 不动 ⇒「3 张 `_a` 换 1 张 `_b`」在投影下价值中性**（不是 bug：投影改的是战斗职能，不是合成经济，
  改它就越出这个声明的范围）。
* **召唤物同一个轴**：`data/tokens.json` 里 owner 变体有 `_a` / `_b` 一对的召唤物（本季 19 个），`_a` 的 owner 变体
  在 `form: "elite"` 下换成 `_b` 的那一条；没有 `_b` 变体的原样不动。
* **缺省逐字节不变**：不声明这个轴的包，`GameData.chess(id)` / `DataSource.rawChess(id)` 返回 `data/chess.json` 里
  **那个对象本身**（`===`，对象身份不变）；`test/golden/*.json` 一个字节都不动，**不需要** `golden:update`。
* **面板与战斗不分叉**：`Match` 建**一份**形态视图，`GameData` 与这一局的 `DataSource` 共用；`Match.js` 的
  `dsCache` 缓存键并进了 `form` 口径（同一份 data 的两个房间，一个声明 `elite`、一个不声明，各拿各的
  `DataSource`）。
* **`combat: true` 是硬闸门**：沿用既有的 `VARIANTS_NEED_COMBAT`（口径改对局结果 ⇒ 必须进房间摘要闸门与 golden
  语料），本刀没有新增闸门。**`MOD_API_VERSION` 仍是 1**（只加一格口径选项，不新增协议消息、不改默认游戏行为）。
* **不许降级**是逐条断言的门（干员与召唤物都过）：投影后每条记录的 `atk` / `maxHp` / `def` 必须 ≥ 投影前
  （`test/form-projection.test.js`）。

### 行为补丁 / 声明通道：`pack.json.behaviour`（第 4 刀）

**`pack.json.behaviour`：引擎实现一格，任何包声明它（DESIGN §28.43，docs/WORKSHOP.md §1.22）。** 投稿
`ac8c9821f5ba`（「卫戍协议mod-跨版本一键安装包-v1.4.8-适配0.2.4」）把「改一条规则」做成了**安装器**：`install.mjs`
（43,658 B）按 `files.json` 的 `copy` 清单**整份覆盖** `data/{chess,config,items,official,skins}.json`、`server/**`
48 个文件（含 `server/sim/**` 22 个）、`public/**` 五十余个与 `payload/tools/**` 13 个。它自己的 `files.json`
把语义写得很直：「**Nothing is trimmed: a target that gets the whole file gets the whole feature**」。本刀**不
把这套搬进引擎**，而是开一条受约束的声明通道 —— 判断与 `official` / `config` / `meta` / `shared` / `theme` /
`serverModules` 六格「刻意没有通道」**逐字一致**。

* **形状与 `variants` 逐字同构、表独立**：`behaviour = [{ switch, option?, name?, desc? }]`，条目字段闭集，
  归一化结果按开关名排序（键序是清单字节）。它与口径**分两张表**，因为入场券不同 —— 口径必有「官方那一档」、
  缺省＝引擎今天的行为；行为开关是「引擎里本来没有、现在由维护者实现的规则」。混在一起会把口径那条唯一的执行点
  逼成一个通用 patch 分发器。**`VARIANT_AXES` 一字不动。**
* **包里没有数值、也没有路径**：动作（`{ kind, value }`）**由引擎构造**，`value` 只能来自那一格或引擎自己的常量。
  `module` / `entry` / `file` / `path` / `value` / `key` 这类键在形状层**点名拒**，理由里写清「一条行为声明只说
  一个开关与它的一个选项」；这一层**没有**「删官方键」的表达能力（没有 `$del`）。
* **不认识的声明响亮失败**：`BEHAVIOUR_UNKNOWN_SWITCH` / `BEHAVIOUR_UNKNOWN_OPTION` / `BEHAVIOUR_BAD_OPTION` /
  `BEHAVIOUR_BAD_SHAPE` / `BEHAVIOUR_DUPLICATE_SWITCH`，每一条都整包拒绝并点名。
* **本版那张表是空的 —— 这是交付物本身**（业主裁决 2026-10-13）：第 4 刀交的是「**通道 + 守卫**」，通道真的通、
  且响 —— **任何**一条 `behaviour` 声明都被 `BEHAVIOUR_UNKNOWN_SWITCH` 点名整包拒（空表不是「一律忽略」，而是
  一个都不认识，文案里写清「本版一个开关都没有，因为没有实现点」）。**首格与它的引擎实现点一起落**，由业主点名；
  加一格的门槛因此比加口径轴更严。
* **第五条 `combat` 硬闸门**（`BEHAVIOUR_NEEDS_COMBAT`）：一格的入场券本就是「它改一条规则」⇒ 必须进房间摘要闸门
  与 golden 语料，与 `server.meta` / `server.battle` / `modules[].uses: ["matchClass"]` / `variants` 四条同一条线。
  将来若有一格**明确改不了结果**，它必须**不**要求 `combat`（判据是能力，不是意图）。
* **不是贡献项**：一个只带 `behaviour` 的包照旧 `EMPTY_PACK`（与 `support` / `playtest` / `variants` 同一条），
  文案里点名 `"behaviour" is NOT a contribution`。
* **缺省逐字节不变**：不声明 `behaviour` 的包归一化清单里**没有**这个键（否则所有已发布包的内容哈希全变、房间的
  摘要闸门误判）；声明了**必须**进包身份哈希（只差一个开关的两份包摘要必须不同），**不进** `modDigest`
  （只哈希 `[id, hash]`），随 `welcome.mods[].behaviour` 与 `variants` 并列投影（漏掉投影 = 开关**静默不生效**）。
  **`MOD_API_VERSION` 仍是 1**（加一格字段不抬版本）、**不新增协议消息**、不改默认游戏行为 ⇒
  **不需要 `golden:update`**。**`MOD_SURFACE_FROZEN['1']` 不动**（新表面 `behaviour` 只加不改）。
* **判据写成「表是入参」的纯函数**（`parseBehaviourDecl(raw, table)` / `behaviourSwitchIssues(table)` …）：表是空的，
  写死的话「选项名不认识」「同一个开关写两遍」「缺省写错」这些分支**任何测试都碰不到**，而一条从来没验过失败分支的
  守卫和没有守卫是一回事（与 `surfaceLedgerIssues(ids, generation)` 同一条理由）。`normalizePackManifest` 因此多一个
  **可选** `opts.behaviourSwitches`（默认真表；装载器 / 校验器 / 编辑器一律不传）。**如实说清**：这是为可测性加的
  一个入口，不是新能力。
* **投稿 `ac8c9821f5ba` 的采纳 / 改动说明**（作者 B站@伊佐那邪_，来源
  `github.com/yznx09/Stronghold-Protocol-Rhodes-Kazdel-Mod`，站点 `flagged/`，`flags` 含 `EXECUTABLE`(blocker) /
  `NO_PACK_JSON` / `WRAPPED`）：
  **采纳**：它真正需要的那一类「改一条规则」的**方向** —— 由引擎实现、由包声明（本刀把那一格开好）；
  以及它**自带内容包**那一半（`payload/packs/fanpack/`：`pack.json` 893 B + `records` / `chess` / `tokens` /
  `variants` + 7 张**自制** PNG）所属的通道 —— 那一半今天**已有**通道（`content` + `kits/` + `art` / `bondIcons` /
  `itemIcons` + `variants`），只是**格式不同**（它的 `type: "data"` / `files{}` / `_doc` / `credits` /
  `englishName` 不在 `PACK_FIELDS` 里，会被 `PACK_UNKNOWN_FIELD` 点名拒）。
  **改动 / 未采纳**：**不采纳安装器**（`install.mjs` + `一键跨版本安装.bat`）、**不采纳整包 `payload/` 上架**、
  **不采纳**对 `data/*.json` / `server/sim/**` / 整屏 UI / `tools/**` 的**整份覆盖**语义；`EXECUTABLE` 那条
  suspected 命中的只是文件名 `.bat`（规则字面判对、实务误判），但**整份覆盖**这条语义本身正是本刀要拦的形态。
  **它自己遵守「不分发官方素材」**：`files.json` 自述官方 `public/assets/**` 从不随包发（`install.mjs --assets`
  才下），所以那 7 张图是自制的 —— **对外表述必须与这条一致**，不要把它说成侵权包。
  **站侧含义**：原件在 `flagged/` 且 `flags` 含 `NO_PACK_JSON` + `WRAPPED`（全部文件套在 `跨版本安装包/` 一层下）
  ⇒ **若做成兼容包上传，必须先扁平化**（`pack.json` 必须在 zip 根）。这条归站侧那条线。

### 本版刻意没有做、或被否决的部分（照实写）

- **②（战绩/账号）**：投稿带的 `POST /api/account/password` + 站点级共享 `SP_ADMIN_TOKEN` **没有实现**，连为它服务的
  脚手架（`sameSecret` / `readJsonBody` / `adminToken`）都没有 —— 改密必须是**账号上的操作**，等一次性重置票据的设计。
  投稿还要禁 `test` / `admin` 这类名字，**未采纳**（那会反转既有判定，且不解决顶替）。
- **③（房间目录）**：投稿原件的 C2S `room.list` / `user.activity` 与 S2C `room.list`（整张房间列表 + 招募排序 + 加入 /
  观战入口）**没有采纳**，`inviteOnly` / `recruitWanted` / `lastInputAt` **一律不预埋**；公开面只剩一个整数。
  **solo 房算数**（与原件「solo 不列出」不同）—— 这是刻意的口径差异。
- **⑤（素材源）**：不把整棵 `/assets` 树指到第三方，**只镜像本包自己的容器**；服务端**不发任何网络请求**；
  容器 > 256 MiB 用不了镜像（浏览器没有流式摘要接口）。
- **⑥（形态投影）**：`status` **不参与投影**（身份标牌；39/129 对里 `_b.level` 更低，照搬会显示练度回落）；
  价格与 `upgradeNum` 不动 ⇒「一档价拿到精锐数值」与「3 张 `_a` 换 1 张 `_b` 价值中性」两条**如实披露**。
- **④（行为声明通道）**：第 4 刀落地时**那一格没有任何可用开关** —— `BEHAVIOUR_SWITCHES` 当初为空 ⇒ **任何**一条
  `behaviour` 声明都会被 `BEHAVIOUR_UNKNOWN_SWITCH` **点名整包拒**。那是刻意的：**格子先立起来、开关逐个按需加**
  （首格与它的引擎实现点一起落）。**第 8 刀按这条落了前三格，见下。**

### 行为开关的第一批格（第 8 刀）

**投稿 `b293e061b38f`（「商店刷新盟约装备几率提升」）与 `8b4e5da55c58`（「休整期可更换技能和模组」）要的那两件事，
收成引擎里两格实现好的开关（DESIGN §28.43.1）。** 两份原件都把它们做成了**安装器**（`files.json` 的 `copy` 整份
覆盖 `data/items.json`、`server/match/**`、`shared/protocol.js` 与客户端文件）。本刀不采纳安装器：**引擎实现一格，
任何包声明它**（`docs/WORKSHOP.md` §1.22 / §1.23）。

* **`shopBias`**：`official`（缺省，今天的行为）· `bondBias`（装备槽只在本玩家**已激活**盟约对应的装备里抽，
  **只偏置、不授予**）。读取点 `bondBiasPreference`（`server/match/pool.js`）→ `bondBiasBonds`
  （`server/match/player/economy.js`）→ `PlayerEconomy._rollItemSlot`。**抽到的阶级仍由棋子份额决定**，某一级无命中
  就**回落官方那一份**（偏向不会把商店抽空），库存闸门一步不跳过。
* **未实现的两条 + 未读的两个字段（如实披露）**：原件的 `_doc` 还提到「已激活**核心**盟约优先于已激活附加盟约」
  与「骑士戒律也接入这套偏向」，其 `payload/data/items.json` 另带 `giveBondBiasOnly`（115 处）与一批
  `canGiveBond`（115 处）。那两条的源件不在我们手上 ⇒ **不做、也不在 `effect` 里声称做了**；这一格**只读
  `giveBondId`**，不读 `giveBondBiasOnly`（我们数据里连这个键都不存在）。`test/shopBias.test.js` 用源码级断言钉住。
* **缺省路径逐字节不变**：不声明 / 选缺省 ⇒ `restrict` 为 `null`，与从前同一份代码路径、同一份结果；
  `Match` 只多一行 `mergeBehaviourDecls`（与 `variants` 同一个投影点，**不新增协议消息**）。
  **不需要 `golden:update`**：没有任何一格在缺省时改变一局的结果。
* **`prepLoadout`**：`locked`（缺省，今天的行为）· `prep`（休整期里、且**这个座位还没准备**时，也收一次既有的
  `room.loadout { entries, ops? }`）。读取点 `LOADOUT_PHASES` / `loadoutPhasesFor`
  （`server/match/match/platform.js`）→ `MatchPlatform.setLoadout` 的相位闸门。**不新增协议消息**（投稿自己那个
  `g.loadout` 我们不需要：`room.loadout` 在比赛进行中本来就走到 `Match.setLoadout`）；`PREP` 那一次走
  `mergeLoadoutEntries`：**只覆盖这次写了的干员**，没写的保留当前配发（整份替换会把其余干员静默打回默认）。
  `INFO_CHECK` 那一半**不看** `ps.ready`（今天也不看）—— 两个相位是两条独立的门。缺省档读到的相位数组与从前
  逐字相同（只有 `INFO_CHECK`），**不需要 `golden:update`**。
* **测试**：新增 `test/shopBias.test.js`（9 条）+ `test/prepLoadout.test.js`（8 条：形状 / 两档 / 缺省与今天
  逐字相同 / `prep` 档的合并语义 / `ready` 后仍拒 / 别的相位照旧 `WRONG_PHASE` / 协议面一个字节不动）。
* **`morphPairing`**：`official`（缺省，今天的行为：少于两件装备不配对、配上了就每一件 `giveBondId` 都授予）·
  `plus`（投稿 `19ea65909cf6` 那一套：**一件起配**、只取装备行里**最左边**那一件）。**判据只有一份** ——
  `shared/morph.js` 的 `grantedBondsByMorph`：投稿原件是把**三处读取点各覆盖一份**
  （`bondsMeta.js` / `sim/content/support/index.js` / `public/js/ui/gameLogic/bonds.js`），三处各写一份循环正是
  这条规则最容易分叉的地方。本刀把那三处收成一个纯函数：prep 侧从 `GameData.morphPairing` 读（`Match` 建
  `GameData` 时传进去），战斗侧由 `withMorphPairing` 的作用域给（与 `withGameData` 同一条同步作用域纪律，
  `Battle` 构造期与每一步都压上），客户端由 `roomMods.js` 从 `welcome.mods` 合成后写入
  （`setMorphPairing`，合并规则直接调 `mergeBehaviourDecls`，不自己实现一遍）。BattleSpec 与
  `battleOptsFromMatch` 各带一个 `morphPairing` 键，**只在非缺省档才出现**。缺省档一个键都不多 ⇒ 逐字节不变。
* **`morphPairing` 的槽位语义（第 7 段补上的那半条）**：投稿还要求「不占装备位、每名干员只一件、第三件顶掉真占格
  那两件」—— 第三格落地时它被如实记成「未做」，这一段把它做完。判据是同一份 `shared/morph.js` 的
  **`morphSlotPolicy(decl)`**：`official`（缺省）⇒ **`OFFICIAL_SLOT_POLICY`**，一个**共享的冻结单例**，每个方法都
  逐字是引擎今天那条算术（`slotsUsed` = `items.length`、`slotCap` / `maxItems` = `equipPerChess`、`replacedIndex`
  的「`replaceUid` 找不到 ⇒ 0」）；`plus` ⇒ **`PLUS_SLOT_POLICY`**（不占位、每名干员最多一件、顶替只挑真正占格的
  那一件、一行最多 `equipPerChess + 1` 件）。六处读取点**同判**：服务端 `player/items.js`（`_attach` /
  `_takeReplaced` / `equip` 的两条守卫）· `player/acquire.js`（回收）· `bot.js`（选人与选装备）· `invariants.js`
  （不变量），客户端 `ui/detailPanel.js`（`EQUIP n/2` 分子与「不占装备格」标签）· `ui/gameLogic/placement.js`
  （`equipReplaces` 的替换判据，`roomMods.js` 把档位写进 `bonds.setMorphSlotPolicy`）。
  **缺省档逐字节不变**：没声明 / `official` / 不认识的档位返回的都是**那个单例本身**，缺省路径上「同一批数字、
  同一次比较、同一个 splice 下标」⇒ **不需要 `golden:update`**，已发布包一个字节不动。`gamedata.equipPerChess`
  本身**一字未动**（那两格装备位是官方的，策略只回答「这一行占了几格、能不能再放一件、顶替挑哪一件」）。
  `getItem` 的契约写在 `shared/morph.js`（收一件棋子或一个 id，回 items 记录）—— 第 7 段第一版在这里踩过一次真
  bug（`invariants.js` 写的是收棋子的形状、其余写的是收 id 的，判据只假设一种 ⇒ 不变量把变形同构体当成占位的普通
  装备），所以它由 `test/morphSlots.test.js` 的 `collectViolations` 断言回归。
* **测试**：新增 `test/morphSlots.test.js`（8 条行为级：缺省档拿到官方单例 / 官方档它占位且会被顶掉 / `plus` 档
  两件真装备 + 它共存 / 第三件真装备顶掉真占格的那一件 / 点名它做 `replaceUid` 被拒 / 每名干员最多一件 / 点名真
  占格的有效 / 官方档不认「槽位豁免」）。`test/morphPairing.test.js` 原地改了两条：原来钉「未实现」的那条**反过来
  钉「已经做了」**（`effect` 必须写明动了槽位、四处服务端读取点都必须读这一局的策略），另加两条单元级断言
  （缺省档 `===` 官方单例、`equipSlotsUsed` 的裸入口）。
* **测试**：`test/morphPairing.test.js`（形状 / 档位归一化 / 判据本体两档 / prep 读取点 / 战斗读取点的
  缓存按档位失效 / **三处读取点同判**（逐行遍历两档）/ 三处共用同一份判据的源码级断言）。
* **`test/packBehaviour.test.js` 原地改了三处（换语义，不放松）**：①「本版是空表」→「真表里每一格都通过形状守卫、
  每一格至少两档且有非缺省档」；②「空表也响亮」→「不认识的开关也响亮」（被拒的名字从 `shopBias` 换成真表外的名字，
  并新增「文案必须列出真表里的每一个开关」）；③「真表（空）下包装不上」→「真表下不认识的开关装不上」+ 新增
  「选了缺省档 = 引擎今天的行为（逐格遍历真表）」。`PACK_FIELDS` 的闭集计数**不变**（这一刀加的是**表里的成员**，
  不是顶层键）。`test/modSurface.test.js` 的 `ANCHOR_MODULES` 多登记三个模块（`pool` / `economy` / `platform`）
  —— 那是**判据的登记**，不是放松：新增的锚点照样逐条被验。

### 第 8 刀第四格 `unequip`：装备拆卸，以及本层**第一条「开关 + 新意图」**

**投稿 `79de9ff03518`（「装备拆卸mod」）要的那件事收成引擎里一格开关 + 一条新意图（DESIGN §28.43.2）。**
原件同样是安装器：`files.json` 的 `copy` **整份覆盖** `shared/protocol.js`、`server/match/match/intents.js`、
`server/match/player/items.js` 与六个客户端文件，并自加 `g.unequip {itemUid}` 意图。

* **`unequip`**：`official`（缺省，今天的行为：装上之后只能靠精英化 / 合成 / 卖出离开）· `allow`（休整期可以
  把一件已装备的装备**退回手牌**，右→左优先；手牌满则进**临时整备区**）。读取点：
  `unequipAllowed(decl)`（`server/match/player/items.js`，模块层纯函数）→ `PlayerState.unequip`；客户端同一判据
  读它决定**画不画**「卸下」按钮。
* **第一条「开关 + 新意图」的五处落点**（将来加意图照抄这份清单）：① `shared/protocol.js` 的 `C2S` 表
  `'g.unequip': { itemUid: isUid }`（与 `g.equip.itemUid` / `g.destroy.uid` **同一个 `isUid` 子**）；
  ② `server/match/match/intents.js` 一行分支；③ `PlayerState.unequip`；④ 客户端发送点（`gameActions.js` 复用
  既有 `act()`）+ UI（`detailPanel.js` 的 `ItemRow` 的「卸下」+ `game.js` 接线）；⑤ 一处可锚的判据导出。
  **`PROTOCOL_VERSION` 不动**（新增类型不是改已有形状，先例 `records.mine`）；**不新增 S2C 消息**。
* **缺省档逐字节不变**：`unequipAllowed` 为假 ⇒ 回 `ERR.BAD_TARGET` + `'equipped items are locked'`，
  **与 `destroy` 今天那一句逐字相同**；客户端**一个按钮都不画**（判据是「有人传 `onUnequip` 且 `unequipAllowed()`」），
  `ItemDetail` 那句「配发后无法取下」**只在 `allow` 档**换成不带那半句的版本 ⇒ **不需要 `golden:update`**。
* **原子性**（这一格最容易做坏的地方）：`_detach` 之后 `stow(piece, { allowTemp: true })` 可能返回 `null`
  （手牌与临时都满）。那时按**原下标**塞回 `holder.items` 并回 `ERR.HAND_FULL` —— 先摘后塞没有回滚的话装备会
  **凭空消失**。用 `HAND_FULL` 而不是 `BAD_TARGET`：「没地方放」是独立、可行动的错误。
* **池不变式照旧**：装备只是从**装备位**移到**手牌 / 临时**（同一个 `piece`、同一个 `uid`）⇒
  `SharedItemPool.held()` 前后都数得到它 ⇒ `held` / `cap` / `left` 全不变。**没有「归还」这回事**
  （`destroy` / `sell` 才真让池子少一件）。
* **刻意的决定：本格不发内容钩子。** `HOOKS` 那 19 个是**契约面**（进 `META`），「卸下」用哪一个都不贴切
  （不是 `onDestroy`、不是 `onEquip`），今天也没有包需要被通知；将来真有需要就**另立一刀**按契约面扩展。
  写进 §28.43.2 是为了让后人知道这是**决定**，不是漏做。
* **i18n**：新增两个词条（`卸下`、以及不带「无法取下」的那半句），**四个包都补齐**（en / ja / ko / zh-TW）。
  `node tools/i18n.mjs check --all --strict` 的 msgid 数 **1283 → 1285**，en 仍 **100 %**，ja / ko / zh-TW 的
  **57 个缺失与基线逐字相同**（那是既有缺口，不是本刀引入的）。
* **测试**：新增 `test/unequip.test.js`（10 条：真表那一格 / `C2S` 登记与 `validateC2S` 的拒绝（**两层都钉**：
  `validateC2S` 返回原因串、`server/net.js` 折成 `BAD_MSG`，而 `Match.handle` 只认过了它的消息）/ 缺省档
  `g.destroy` 与 `g.unequip` 回**同一句**且一个字节不落地 / `allow` 档三分支（手牌 / 临时 / 两者都满 ⇒
  原子回滚 + `HAND_FULL` 且**下标与失败前相同**）/ 池快照与 `checkInvariants` 前后一致 / `recompute` 后盟约人数
  真的变了（1 → 0，用 `morph-bonds.test.js` 的配方）/ 客户端源码级断言 / 四个 i18n 包的两个新词条）。
  `test/modSurface.test.js` 的 `ANCHOR_MODULES` 多登记一个模块（`items`）—— 同样是**判据的登记**，不是放松。
* **`test/match/fuzz.test.js` 必须同时教一遍**（这一次全量跑出来的真事）：那个模糊测试按 `C2S` 表逐个类型造随机
  载荷，并有 `assert.equal(validateC2S(msg), null, …)` 钉住「造出来的每一条都是合法消息」。新类型没进它的
  `switch` 就会掉进 `default`（`{ t }`，缺字段）⇒ **当场两条红**。补法是加一行
  `case 'g.unequip': return { t, itemUid: uid() };` —— **断言一字未动**，而新意图这下真的进了模糊覆盖
  （随机 uid 会打到 `BAD_TARGET` / 缺省档那句，都被 `assert.ok(res.ok || ERR[res.error])` 接住）。
  ⇒ **记在这里**：这一层将来再加意图，`fuzz.test.js` 的 `randomIntent` 是必须同步的第三处（协议表、`intents.js`、
  它的 `switch`）。

### 第 8 刀第二格的**客户端半**：修掉一句写了很久的谎话（投稿 `8b4e5da55c58`）

第二格的服务端半（`Match.setLoadout` 读 `LOADOUT_PHASES`）第 8 刀就落了，客户端半一直没落。取证发现它**不是**
"少一个发送点"，而是**客户端在撒谎**：

* **发送链路整套早就有**：`public/js/ui/loadoutSync.js` 的 `installLoadoutSync` 早在发 `room.loadout { entries, ops }`
  （500 ms 去抖、面板关闭立刻冲刷、`WRONG_PHASE`/`ROOM_STARTED` ⇒ `'locked'` + 提示）；单干员编辑的纯函数也早在
  （`loadoutModel.setChoice`，缺键即删 entry，与 `mergeLoadoutEntries` 的"只覆盖写了的干员"天然对齐）。
  ⇒ **本刀不新造发送链路、不新增协议消息、不动 `PROTOCOL_VERSION`。**
* **缺的是客户端自己的相位判据，而它写死在两处**（`screens/loadout.js`）：
  1. 「本局已锁定 · 下一局生效」那句的 `locked`（原来"在局中、相位不是 `INFO_CHECK` 就算锁定"）—— 实测它
     **只喂两处文案、不 disable 任何控件** ⇒ 声明 `prep` 的房间出现「**服务端收得下、界面却说锁着**」；
  2. `shouldAutoClose` 的简报那一支 ⇒ 玩家刚进 `PREP`（正是服务端允许改调配的那一段）面板被**自动收走**。
* **做法**：把那份判据收成"一份两档的表 + 一个纯函数"。`loadoutSync.js` 导出 `LOADOUT_CLIENT_PHASES` /
  `loadoutLockPhases(option)` / `currentLoadoutLockPhases()` / `setPrepLoadout(option)`；`roomMods.js` 在**同一处**
  （与 `morphPairing` / `unequip` 并列）用**同一份合并规则**（`mergeBehaviourDecls` + `behaviourValue`）喂档位。
* **两张表的关系**：客户端的表与服务端的 `LOADOUT_PHASES` 是两张表（客户端不能 `import server/**`），这是这一层
  既有的做法 —— **客户端副本 + 一个测试把两张表钉在一起**（与 `CLIENT_WRAP_COMPONENTS`↔`MOD_COMPONENT_IDS`、
  `CLIENT_PANEL_SLOTS`↔`MOD_PANEL_SLOTS` 逐字同一条）。
* **缺省逐字节不变**：缺省 / 没声明 / 不认识的档位 ⇒ 只含 `INFO_CHECK`；两处的旧表达式与新判据
  **逐相位遍历同一个布尔** ⇒ 界面一个字节不变，**没有任何 `golden:update`**。
* ⚠️ **还没做的一件（如实披露，`docs/design/mod-layer.md` §28.43.4 记账）**：`PREP` 里**没有入口**能打开干员调配
  面板 —— `LoadoutButton` 只在大厅 / 房间 / 简报（只活在 `INFO_CHECK`）里出现，`screens/game.js` 里一个都没有
  ⇒ 在贴一个 `PREP` 入口之前，"服务端开了"与"玩家改得了"之间还差最后一步。那是**在对局屏新增一个可见控件**，
  属"新渲染分支"，本轮不做、记账待裁。
* **顺带排查（同类写死相位 / 写死能力，只记录不改）**：`screens/support.js` 的 `shouldAutoClose` 同形，但助战
  **没有开关**且服务端 `room.support` 同样只在 `INFO_CHECK` 收 ⇒ **两边一致、不是缺陷**（将来若要"休整期换助战"，
  那就是第 5 格开关）；`ui/equipReplace.js` 的 `if (equipped.length < 2) return null;` 与
  `ui/gameLogic/placement.js` 的 `items.length < 2` 把**装备位写死 2** ⇒ **与第 7 段（槽位语义）直接相关**，
  第 7 段必须一并交代（否则客户端对话框的触发判据会与服务端的 `equipPerChess` 对不上）。
* **测试**：新增 `test/prepLoadoutClient.test.js`（10 条：缺省档相位表逐字相等 / 默认状态不许"默认开" /
  **逐相位遍历**新旧判据同判 / `prep` 档只放开 `PREP` 一个相位 / **两张表逐档逐字相等** / 源码级（那一行读函数、
  旧写死消失、`ownLocked` 原样保留）/ `shouldAutoClose` 两档行为 / `roomMods` 接线 / **客户端半不新造发送链路**）。
