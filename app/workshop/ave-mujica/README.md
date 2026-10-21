# 颂乐人偶（Ave Mujica）— 内容与引擎扩展点清单

本包 `workshop/ave-mujica/` 是一个**完整的自走棋（卫戍协议）内容包**，而不是前置接口包：它带来一条
**核心盟约**「颂乐人偶（`aveMujica`）」、**5 名成员干员**（丰川祥子 / 三角初华 / 祐天寺若麦 / 八幡海铃 / 若叶睦，
每位含普通与精锐两版，共 10 条棋子）、每位成员的**专属特质（garrison）**、一个团队爆发机制 **Fever**，
以及一条策略「无忧梦呓」与配套美术/语音/时装。它把原来住在引擎 `server/sim/mod/ave-mujica/` 下的 mod 专属代码
**整体搬进了包内**（`battle/main.mjs` + `meta/main.mjs`），因此引擎不再含任何本 mod 的专属逻辑。

玩起来：集齐 5 名成员把盟约铺满 5 层，成员不断用普通攻击给团队 Fever 充能，满 450 触发 20 秒 Fever 状态，
期间成员近乎无视技力持续开技能；5 人成型时「所有效果翻倍」——攻速/停顿/凋亡损伤/资金/部署位全面拉满。

- `gameVersion`：**0.3.1**（`pack.json`；包自身版本 `version` 见文件头）。
- **前置依赖：无。** 它的盟约 `bondType` 是 **`SEASON`**、`isCore: true`，是**核心盟约**（不是 `SIDE_STORY`），
  既不需要也不走 `workshop/side-story` 的那套接口。与 `workshop/rimbilliton`（雷姆必拓）**兼容**：若叶睦同时带
  `rimBilliton` 盟约，两包各自把自己那条盟约算进 5 人判定，互不覆盖（本包 `overrides` 为空）。
- **素材授权**：`pack.json.license` 为 **`GPL-3.0-or-later`**；包含头像/立绘/Spine/技能图/时装/语音/**官方特效 prefab** 等大量素材
  （`assets/` 共 **1092** 个文件，其中 `fx/` 896），分发与再创作前请留意该授权。

---

## 0. 概览表

| 面 | 项 | 数量 / 值 |
|---|---|---|
| 数据 `content` | `bonds` | 1（`aveMujica`） |
| | `chess` | 10（5 名成员 × 普通/精锐） |
| | `garrisons` | 10（`180/181/182/183/164` 各 `_a`/`_b`） |
| | `bands` | 1（`band_wuyouyoumeng`） |
| | `effects` | 1（`aceffect_band_wuyouyoumeng`） |
| 素材 `art` | `chars` | 5（`char_4182_oblvns` / `_4183_mortis` / `_4184_dolris` / `_4185_amoris` / `_4186_tmoris`） |
| | `skills` | 11 |
| | `bonds` | 1（`aveMujica` → `bond/icon_aveMujica.png`） |
| | `bands` | 1（`band_wuyouyoumeng` → `band/band_wuyouyoumeng.png`） |
| `bondIcons` / `itemIcons` | 无（本包用 `art.bonds` / `art.bands` 两家扁平表，未用顶层 `bondIcons`/`itemIcons`） |
| `skins` | 5（每名成员 1 套） |
| `voices` | 5 名 charId（`assets/voice/jp/<charId>/`，共 70 个 mp3） |
| 服务端模块 | `server.battle` | `battle/main.mjs`（`combat: true`） |
| | `server.meta` | `meta/main.mjs` |
| 客户端面板 | `client` | `screen.game.overlay` 面板 `ui/fever.js`（+`ui/fever.css`）＋ 一条 `game.hud.topBar` **组件改写**；面板数据表声明 `chess` |
| 特效 `fx` | `manifest` | `fx/manifest.json`（官方 prefab 侧表；`assets/fx/` 896 个文件，含 `index.json` 与 tex/prefab；5 套时装的特效变体见 §7.12） |
| 行为层 | `kits/` | 5 个（每名成员一个 `<chessId>_a.js`） |
| 文件数 | 合计 | **1108**（`assets` 1092 / 数据 json 6 / `kits` 5 / `ui` 2 / `battle` 1 / `meta` 1 / `README.md` 1） |

---

## 1. 盟约

| 字段 | 值 |
|---|---|
| `bondId` / `name` | `aveMujica` / 颂乐人偶 |
| `isCore` / `bondType` | **真 / `SEASON`** —— **核心盟约**（不是附加、不是 `SIDE_STORY`） |
| `identifier` / `bondOrder` | 30 / 20 |
| `activeCount` | 1（只需 1 名成员即激活） |
| `thresholds` | `[1, 2, 3, 4, 5]`（人数阈值逐档向上） |
| `thresholdTemplate` / `countMode` / `activeType` | `count_threshold_upward` / `BOARD` / `BATTLE` |
| `weight` | 10 |
| `members` / `visibleMembers` | 5（本包 5 名成员的**普通版** chessId） |
| 效果图 | `bond/icon_aveMujica.png`（经 `art.bonds`） |

### 1.1 人数阈值与每档效果（`desc`，由 `meta/main.mjs` 的 `bond:aveMujica` 逐档实现）

| 档 | 需要的成员数 | 效果 |
|---|---|---|
| 1 | 1 | 每刷新 **9** 次，获得 1 名阶级不超过调度中心的随机【颂乐人偶】干员（5 人时每 4 次） |
| 2 | 2 | **休整期结束时**，场上每有 1 名**不重复的**成员，使**所有已激活盟约**层数 +1（5 人时 +2） |
| 3 | 3 | 成员获得特质「进入休整期时额外获得 **1** 资金」，该效果最多生效 **2** 名成员 |
| 4 | 4 | 可部署干员数量上限 **+1**（5 人时 +2） |
| 5 | 5 | 【颂乐人偶】**所有效果翻倍**（`dblOf = tier>=5 ? 2 : 1`） |

### 1.2 盟约自带的 5 名成员战斗效果（黑板 `bb`，由 `battle/main.mjs` 的 installer 实现）

| 成员 | 效果 | 取值（`base` + `per_stack`×层数，5 人再 ×2） |
|---|---|---|
| 祐天寺若麦 Amoris | 成员**攻击力**提升 | `amoris_atk 0.25` + `amoris_atk_per 0.0005`/层（文本同步改成「每1层增加0.05%」，见 §7.15） |
| 八幡海铃 Timoris | 成员攻击命中时概率**停顿** | `timoris_prob 0.2` + `timoris_prob_per 0.0005`/层，停顿 `timoris_dur 1` 秒 |
| 若叶睦 Mortis | 成员攻击附带**凋亡损伤** | `mortis_pct 0.1` + `mortis_pct_per 0.0005`/层 × 攻击力 |
| 三角初华 Doloris | 成员获得的 **Fever 翻倍** | `fever_ratio 2` |
| 丰川祥子 Oblivionis | **非成员**干员也获得上述三项效果的 10% | `obliv_share 0.1`（5 人再 ×2） |

> 其余黑板键：`refresh_every 9`、`prep_layer 1`、`prep_fund 1`、`deploy_slot 1`。数据侧另带 `spec.tiers` /
> `spec.formulas` / `spec.assumed`（简化假设），供人读与对账。

### 1.3 层数轴怎么涨

基础层数走引擎核心盟约的通用经济规则（战斗内累积 + 回合）；本包**另加**如下 +层来源（都在包内代码里）：

| 来源 | 触发 | 加多少 | 上限 | 在哪 |
|---|---|---|---|---|
| 盟约 2 人 tier | 休整期结束，每名在场成员 | `prep_layer 1`×成员数（×2 if 5 人） | — | `meta/main.mjs` `onPrepEnd` |
| 祥子 garrison `AVEMUJICA_FEVER_KILL` | 战斗内击倒敌人 | `kill_layers`（普通 1 / 精锐 2） | 全场 `max_count`（12 / 12） | `battle/main.mjs` |
| 初华 garrison `AVEMUJICA_EXTRA_TRIGGER` | 祥子的击倒特质触发且初华在场 | `partner_layers`（1 / 2） | **每场 1 次**（放大器本身另受 `max_count 1` 限制：每名成员最多被额外放大 1 次，见 §7.15） | `battle/main.mjs` |
| 海铃 garrison `AVEMUJICA_REFRESH_LAYERS` | 休整期手动刷新商店（**需海铃在场上**） | `layers`（1 / 2） | 该干员每回合 `max_count`（6 / 6） | `meta/main.mjs` |
| 若麦 garrison `AVEMUJICA_PREP_REWARD` | 进入休整期（**需若麦在场上**） | `themselves`：成员数 <3 → `fund` / 否则 `refresh` 次免费刷新 | 每回合 1 次 | `meta/main.mjs` |

>「使已激活盟约层数 +n」= 对玩家**所有已激活盟约**加层（同「蜜莓」官方写法，含颂乐人偶自身）。

### 1.4 覆盖的官方盟约名册（本包成员身上的盟约）

5 名成员除 `aveMujica` 外还各带一条**官方盟约**（见 §2 的 `bonds` 列）。为了让这些成员在**自身拥有的盟约**里也能被看到，
本包为其中 3 条写了最小覆盖记录（只有 `bondId` + `members` + `visibleMembers`）：

| 官方盟约 | 加入的成员（`_a`） |
|---|---|
| `skillfulShip`（绝技） | `chess_char_5_31_a`（祐天寺若麦）、`chess_ws_dos_lin_a`（林，定义在 dossoles） |
| `miraShip`（奇迹） | `chess_char_6_30_a`（丰川祥子）、`chess_ws_col_heyak_a`（霍尔海雅，定义在 columbia） |
| `soloShip`（独行） | `chess_char_5_32_a`（八幡海铃） |

> 其余三条成员盟约（`deputShip` 助力 / `siracusaShip` 叙拉古 / `indomShip` 不屈）由 **rimbilliton** 统一出头（那里已覆盖这些官方盟约）。
> 合并语义：`members` / `visibleMembers` 走**求并集**（`shared/workshop.js` 的 `OVERRIDE_UNION_LISTS`），只写自己那几位、官方名单不丢；
> 但**一条盟约只认一个包**（`PACK_ID_COLLISION`），所以一条官方盟约的 mod 干员只能由它的**唯一主人**一起列。

### 1.5 Fever 怎么攒、怎么触发（战斗侧，2026-10-13 逐条接线）

- **状态**：每场战斗一份**团队值**（上限 **450**），存在 `battleStore(battle,'avemujica:st')` 的 `{ fever, until }` 里（每场重新从 0 起）。
- **攒的来源**（都走同一个 `gainFever`，共用乘数「三角初华在场 ×`fever_ratio`，5 人再 ×2」）：
  - **基础填充**：任何**成员**每次普通攻击命中造成伤害 **+2**（丰川祥子在场时，**非成员**干员也按 `obliv_share` 计）。
  - **五位成员「毋畏X」特质各自的增量** —— 数值**逐条取自该干员 chess 记录里那条特质的 `bb`**（不写死在代码里）：
    | 干员 | 特质 | `bb` 键 | 触发 | 值 |
    |---|---|---|---|---|
    | 丰川祥子 | 毋畏遗忘 | `fever` | 对敌人造成**任何**伤害（普攻与技能） | 3 |
    | 三角初华 | 毋畏悲伤 | `fever` | **治疗**【颂乐人偶】成员时 | 5 |
    | 祐天寺若麦 | 毋畏爱意 | `fever_per_sec` | **在场时每秒** | 3 |
    | 八幡海铃 | 毋畏恐惧 | `fever` | **使敌人停顿**（Timoris 减速命中）时 | 2 |
    | 若叶睦 | 毋畏死亡 | `cnt` | **自身受到一次伤害或损伤**时 | 3 |
  - **祥子 `AVEMUJICA_FEVER_KILL`**：`<战斗开始时>` `fever += floor(盟约层数 × fever_ratio)`（普通 0.5 / 精锐 1）。
- **触发**：`fever ≥ 450` ⇒ 清零、进入 **20 s Fever 状态**，并打引擎内置的 `fever` 特效（品红团队光环，锚在**一名在场成员**身上）。
  触发后进度**同步清零**，客户端图标跟着重置。
- **Fever 期间**（2026-10-17 逐条接线）：
  - 成员**自身技力照常恢复**（不再强行回满）；「无视技力限制持续放技能」由引擎公开的
    `skill.activate('fever', { free: true })` 承担 ⇒ **不消耗技力、不受技力限制**，**切换类技能除外**。
  - 触发那一刻**强制打断**在场成员当前正在释放的技能、紧接着**立刻重开**一次；期间每 0.5 s 持续开，
    并把已激活的**持续类技能延长到 Fever 结束**；Fever 结束**强制结束**它们。
  - **技力条**：成员自己那条整条换成**玫红**的 Fever 条（填充 = 共用的 Fever 窗口剩余比例 ⇒ 全员同时结束），结束后恢复。
  - **BGM**：`ui/fever.js` 按「场上五名成员是否齐全」播放包内 KillKiss 伴奏 / 人声的 **20 秒片段**（从文件 0 秒起播、不 seek，1 s 淡入淡出），同时压低场地 BGM —— 见 §7.16。
  - **S3「残月的余响」免死**：祥子的 S3 生效且处于 Fever 时，成员受**致命伤害不撤退**（引擎把血顶到 1）；
    **Fever 结束**（或该成员先离场）时**退场** —— 见 §7.11。

### 1.6 成员特质的「另一半」（2026-10-14 补齐）

每位成员的「毋畏X」特质除 Fever 增量外还有后半段（数值同样**逐条取自该干员 `chess.json` 里那条 `bb`**），
全部由战斗侧盟约安装器 [`battle/main.mjs`](battle/main.mjs)（`installAveMujica`）实现，团队/成员判定都在那一处：

| 成员 | 特质 | `bb` 键 | 效果 | 实现 |
|---|---|---|---|---|
| 三角初华 Doloris | 毋畏悲伤 | `bonus_scale` | **攻击范围内**成员攻击时，附带「初华攻击力 × bonus_scale」的**法术**伤害 | 成员普攻钩子 `onDmg` + `S.inRange(初华, 攻击者)` |
| 八幡海铃 Timoris | 毋畏恐惧 | `dmg_up` | **在场时**，成员对处于**停顿 / 恐惧**的敌人造成的伤害 ×(1 + dmg_up) | 全局 `hit` 钩子：`dmg.mul *= 1 + dmg_up` |
| 若叶睦 Mortis | 毋畏死亡 | `max_hp` | **在场时**，**全体成员**生命上限 +max_hp | `bond:avemujica:hp`（`directMods({hp})`；deploy / death / layerGain / 每 0.5 s 刷新） |
| 丰川祥子 Oblivionis | 颂乐音符 | `def_pen` / `res_pen` / `max_stack` | 场上每存在 1 个**音符**，成员无视敌人 def_pen 防御 / res_pen 法抗（最多 max_stack 层） | `bond:avemujica:note` → `{ defIgnorePct, resIgnorePct }` |

- **音符**（2026-10-17 起是**包侧自建实体**；2026-10-18 按 PRTS Wiki 校正参数与伤害规则）：`battle/main.mjs` **自己积分**
  音符的位置与状态（引擎 `addProjectile` 只在 sim 侧飞、客户端的弹道视觉按 `atk` 事件画 ⇒ 自建弹道进不了那条渲染管线），
  位置经模块级表 `NOTES_LIVE` 交本包面板（`ui/fever.js`）绘制。层数 = `min(max_stack, 场上音符数)`，buff 每 **0.25 s** 刷新一次。
  ⇒ **运动参数（三套）、命中结算、S3 混档索敌、Fever 免死** 见 **§7.11**。
- **穿透键名**：`defIgnorePct` / `resIgnorePct` 是**源（攻击者）侧**统计量，引擎 `mitigate` 按百分比扣防御 / 法抗。
- **增伤键名**：`hit` 钩子在减伤结算前改写 `dmg.mul`；**生命上限**走 `hpPct`（`directMods`）。
- 若叶睦那处原本只把 `hpPct` 加在**自身**（kit 内 `[ASSUMED]`），现改为**对全体成员生效**——team 判定回到盟约安装器。

---


## 2. 干员

**记录形状（2026-10-18 修）**：记录上的 `skill`（选中技能那一份）**不写 `isDefault`** —— 默认档只由 `skills[]` 里那一条
`isDefault: true` 标记（官方记录如此，引擎 `shared/plugins/records.js:113` 也会把它从 `skill` 上删掉）。写了它会被校验器
判 `PLUGIN_RECORD_SKILLS`（`test/plugins/loopCaps.test.js` 就是那道闸门）。本次清掉了 8 条记录上多余的这一个键：
`chess_char_5_30_a/_b`、`5_31_a/_b`、`5_32_a/_b`、`6_30_a/_b`。

本包 `overrides` 为**空**——**没有 override 任何官方 id**，10 条棋子全部是**新增加**的。

| chessId | 名字 / 代号 | 阶级 | 职业 | 盟约（`bonds`） | 特质要点（`garrisonIds`） |
|---|---|---|---|---|---|
| `chess_char_6_30_a` | 丰川祥子 / Oblivionis | 6 | WARRIOR·领主 lord | `aveMujica`, `miraShip` | `garrison_180_a`：战斗开始获得 ½ 层数 Fever；击倒敌人 → 全员盟约层 +1（≤12 次） |
| `chess_char_6_30_b` | 丰川祥子（精锐） | 6 | 同上 | 同上 | `garrison_180_b`：开场获得**全部**层数 Fever；击倒 → +2（≤12 次）。模组 `LOR-Y` 激活（攻速 +12） |
| `chess_char_5_30_a` | 三角初华 / Doloris | 4 | SUPPORT·吟游者 bard | `aveMujica`, `deputShip` | `garrison_181_a`：成员特质触发额外 +1 次；源为祥子时全员盟约层 +1（每回合 1 次） |
| `chess_char_5_30_b` | 三角初华（精锐） | 4 | 同上 | 同上 | `garrison_181_b`：额外触发 +2、同伴加层 +2。模组 `BAR-X` 激活（3 名以上同格 → 攻击力 +8%） |
| `chess_char_5_32_a` | 八幡海铃 / Timoris | 3 | SPECIAL·伏击客 stalker | `aveMujica`, `siracusaShip`, `soloShip` | `garrison_182_a`：战斗中刷新时自身所属盟约层 +1（≤6 次） |
| `chess_char_5_32_b` | 八幡海铃（精锐） | 3 | 同上 | 同上 | `garrison_182_b`：刷新 +2（≤6 次）。模组 `AMB-Y` 激活（闪避 50%→65%） |
| `chess_char_5_31_a` | 祐天寺若麦 / Amoris | 2 | WARRIOR·撼地者 hammer | `aveMujica`, `skillfulShip` | `garrison_183_a`：进入休整期时成员 <3 → +1 资金；否则 1 次免费刷新 |
| `chess_char_5_31_b` | 祐天寺若麦（精锐） | 2 | 同上 | 同上 | `garrison_183_b`：资金 +2 / 免费刷新 2 次。模组 `HAM-X` 激活（溅射 ≥3 敌 → 当次攻击 ×115%） |
| `chess_char_5_25_a` | 若叶睦 / Mortis | 5 | SPECIAL·傀儡师 dollkeeper | `aveMujica`, `rimBilliton`, `indomShip` | `garrison_164_a`：战斗内受伤时自身盟约层 +5（≤2 次） |
| `chess_char_5_25_b` | 若叶睦（精锐） | 5 | 同上 | 同上 | `garrison_164_b`：受伤 +10（≤2 次）。模组 `PUM-Y` 激活 |

**普通与精锐的差别**：精锐（`*_b`）`isGolden: true`、等级 60 / 技能 7 级、基础面板更高、模组（`modules`）为
1 级并**激活**；对应 garrison 的数值翻倍（见 §3），技能组也换成 `skillIndex: 2` 的那一套。所有成员 `price 3~5`、
`visible: true`、`isHidden: false`、`isDiy: false`。

---

## 3. 策略（`bands`）与效果（`effects`）

### 3.1 策略

| 字段 | 值 |
|---|---|
| `bandId` / `name` | `band_wuyouyoumeng` / 丰川祥子 |
| `modeTypeList` | `SINGLE`, `MULTI` |
| `totalHp`（初始生命） / `victorCount` | 21 / 3 |
| `effectId` | `aceffect_band_wuyouyoumeng`（无忧梦呓） |
| `bondIds` | `aveMujica` |
| 效果 | 每回合**首次**获得 `<颂乐人偶>` 干员时，获得 **1 位阶级等于调度中心的随机干员**（`count 1`） |

实现：`meta/main.mjs` 的 `registry.band('band_wuyouyoumeng', { onGain })`——本回合已触发过则跳过（`ctx.counter === ctx.round`），
命中条件为 `piece.kind === 'chess'` 且其 `bonds` 含 `aveMujica`。

### 3.2 效果

| `effectId` | 名字 | `effectType` | 说明 |
|---|---|---|---|
| `aceffect_band_wuyouyoumeng` | 无忧梦呓 | `BAND_INITIAL` | 与策略同源的初始效果，键 `band_wuyouyoumeng_first_gain_bond_gain_random_char`，`bb.count 1`、`bbStr.bond aveMujica` |

> 本包**没有**单独的盟约效果条目（`bondeffect_avemujica` 未落盘为 `effects.json` 条目）——盟约效果由 `bonds.json`
> 的 `bb`/`buff` 与 `battle`/`meta` 两段代码共同承担。

---

## 4. 干员特质（`garrisons`）

逐条列出 `effectKey`（`garrisonIds` 里的那个串）、触发时机 `eventType` 与效果：

| garrisonId | 归属干员 | `effectType` | `eventType` | 效果（`bb`） |
|---|---|---|---|---|
| `garrison_180_a` | 丰川祥子 | `AVEMUJICA_FEVER_KILL` | `IN_BATTLE` | 战斗开始 Fever += 层数 × `fever_ratio 0.5`；击倒敌人 → 所有活跃盟约层 `+kill_layers 1`（`max_count 12`） |
| `garrison_180_b` | 丰川祥子（精锐） | `AVEMUJICA_FEVER_KILL` | `IN_BATTLE` | 开场 Fever += 层数 × `1`；击倒 → `+2`（`max_count 12`） |
| `garrison_181_a` | 三角初华 | `AVEMUJICA_EXTRA_TRIGGER` | `IN_BATTLE` | 成员特质触发额外 `+extra_trigger 1` 次（`max_count 1`：每名成员最多被额外放大 1 次）；触发者为祥子（`bbStr.partner oblivionis`）时全员盟约 `+partner_layers 1`，每场 1 次 |
| `garrison_181_b` | 三角初华（精锐） | `AVEMUJICA_EXTRA_TRIGGER` | `IN_BATTLE` | 额外触发 `+2`（同样 `max_count 1`）、同伴加层 `+2` |
| `garrison_182_a` | 八幡海铃 | `AVEMUJICA_REFRESH_LAYERS` | `SERVER_REFRESH_SHOP` | 刷新时使自身所属已激活盟约 `+layers 1`（`max_count 6`）；`bbStr.conditionkey character_target_inboard` ⇒ **需在场上** |
| `garrison_182_b` | 八幡海铃（精锐） | `AVEMUJICA_REFRESH_LAYERS` | `SERVER_REFRESH_SHOP` | `+2`（`max_count 6`；同样**需在场上**） |
| `garrison_183_a` | 祐天寺若麦 | `AVEMUJICA_PREP_REWARD` | `SERVER_PREP_START` | 进入休整期成员 <`check_count 3` → +`fund 1` 资金；否则 免费刷新 `refresh 1` 次；`bbStr.conditionkey character_target_inboard` ⇒ **需在场上** |
| `garrison_183_b` | 祐天寺若麦（精锐） | `AVEMUJICA_PREP_REWARD` | `SERVER_PREP_START` | 资金 `+2` / 免费刷新 `2` 次（同样**需在场上**） |
| `garrison_164_a` | 若叶睦 | `act_gar_event_onhurt_add_bond_layer`（`effectType: ADD_BOND`） | `IN_BATTLE` | 受到伤害时使**自身**所属盟约 `+bond_add_count 5`（`max_count 2`，`battleRuneKey: env_gbuff_new_with_verify`） |
| `garrison_164_b` | 若叶睦（精锐） | 同上 | `IN_BATTLE` | `+10`（`max_count 2`） |

> 说明：`eventType` 里 `SERVER_PREP_START` = 进入休整期（本轮开始）、`SERVER_REFRESH_SHOP` = 手动刷新商店、
> `IN_BATTLE` = 战场内持续叠加。`AVEMUJICA_*` 这 4 条由**本包注册**（见 §5）；`garrison_164` 的**数据**在本包，
> **行为**早先只住在**雷姆必拓包**里（若叶睦是**双盟约成员**，`rimBilliton` 那条 traits 与这条共用同一个
> effectKey `act_gar_event_onhurt_add_bond_layer`），2026-10-18 起**本包也原样复制了一份**（见 §7.14）：
> 每次受到伤害 `it.fired++` 并 `fireGain`，`it.fired >= bb.max_count` 后不再触发 ⇒ **上限读的是 `bb.max_count`**。
> 两份实现**逐字一致**，而引擎的 `registerGarrisonInstaller` 对同名键是**先到先得、重复静默忽略** ⇒ 两包同时
> 装着时只有先加载的那一份生效（行为一致）；**只装本包也已生效** —— 这正是复制它的目的。仍**不写进**
> `pack.json` 的 `registers`（`registers` 只列 `meta` 模块的注册键，见 §5.2 末尾那条对比）。

---

## 5. 服务端逻辑

### 5.1 `server.battle`（`battle/main.mjs`，`combat: true`）

模块顶层**一次性**完成注册（服务端与浏览器各加载一次，两端都会注册）；`install()` 为空，无每场逻辑。

| 注册调用 | 目标 | 作用 |
|---|---|---|
| `registerBondInstaller('aveMujica', installAveMujica)` | 盟约 installer | 5 名成员特质（Amoris ATK / Timoris 停顿 / Mortis 凋亡损伤 / Doloris Fever ×2 / Oblivionis 效果共享 10%，精锐 25%）+ **Fever 状态机**（上限 450、满触发 20 s；期间成员技能由 `skill.activate('fever', { free: true })` 驱动，不耗技力）+ **祥子「颂乐音符」自建弹道**（§7.11）+ **S3 期间的 Fever 免死**（§7.11） |
| `registerGarrisonInstaller('AVEMUJICA_FEVER_KILL', …)` | 祥子 | 开场按层数注入 Fever；击倒敌人 → 全员盟约加层 + 初华连携 |
| `registerGarrisonInstaller('AVEMUJICA_EXTRA_TRIGGER', …)` | 初华 | 把「成员特质额外触发」做进 `battle._rbAmplifiers` 放大器列表 |
| `registerGarrisonInstaller('act_gar_event_onhurt_add_bond_layer', …)` | 若叶睦 | 「受伤加层」：每次受到伤害 → 自身已激活盟约 `+bond_add_count`，至多 `bb.max_count` 次。**自雷姆必拓包原样复制**（同键「先到先得」，见 §7.14） |

用到的引擎钩子 / 读法（均来自包侧 SDK `@battle/mod.js`）：
`registerBondInstaller`、`registerGarrisonInstaller`、`reached`、`onLayers`、`onUnitDamaged`、`isEnemyTarget`、
`ownTag`、`byUnit`、`fireGain`、`num`；以及 `battleStore`、`bondLayers`、`bondMembers`、`playerOps`、`player`、
`passiveBuff`、`directMods`、`gainLayers`、`garrisonRecord`、`onField`、`fxOn`；战场对象上的 `battle.on(...)` /
`battle.every(...)` / `addBuff` / `removeBuff` / `applyStatus` / `dealDamage` / `rng`。

### 5.2 `server.meta`（`meta/main.mjs`）

**逐条**列出 `pack.json.server.meta.registers` 的 4 个键并说明：

| 注册键 | 类型 | 作用 |
|---|---|---|
| `bond:aveMujica` | 盟约 tier | 5 档效果：`onRefresh` 每 9 次发随机成员 / `onPrepEnd` 按成员数给全盟约加层 / `onRoundStart` 每回合 ≤3 名成员各 +1 资金 / `onBondChange` 4 人时当帧 `addDeployCap` / 5 人翻倍 |
| `garrison:AVEMUJICA_REFRESH_LAYERS` | 特质（休整期） | 海铃刷新时给其所属盟约加层；用 `ctx.incPieceCounter(uid,'avemujica:refresh')` 做「每回合上限」计数 |
| `garrison:AVEMUJICA_PREP_REWARD` | 特质（休整期） | 若麦进入休整期：成员数 `<check_count` → `grantFreeRefresh`；否则 `addFunds` |
| `band:band_wuyouyoumeng` | 策略 | 无忧梦呓 `onGain`：每回合首次获得成员 → `rollChess` + `grantChess` 发一名随机干员 |

用到的引擎通用能力：`registry.api.{ num, bondOrder }`（meta 模块只许 import 本包文件与 `registry.api`，不许 import 引擎）；
`ctx` 读法 `bond` / `gd.bond` / `gd.chess` / `counter`·`setCounter` / `round` / `shopLevel` / `rollChess` / `grantChess` /
`grantFreeRefresh` / `addLayers` / `addFunds` / `addDeployCap` / `bondCount` / `bondActive` / `band` / `band.buffs` /
`source`（含 `source.piece`、`source.bb`）/ `incPieceCounter`。

> 对比：**战斗侧**的 `AVEMUJICA_FEVER_KILL` / `AVEMUJICA_EXTRA_TRIGGER` 用 `registerGarrisonInstaller` 在
> `battle/main.mjs` 注册，**不出现在** `pack.json.server.meta.registers`；`registers` 只列 meta 模块的注册键。

### 5.3 客户端面板（`client.panels`：`ui/fever.js` + `ui/fever.css`）

战场上的【颂乐人偶】干员身边那颗**连音符 Fever 进度图标**：**半透明黑底剪影 + 品红自下而上填充**，触发 Fever 后清零 ⇒ 图标同步清空。
图标的**两张素材由业主提供**（`assets/ui/fever_note_empty.png` / `fever_note_full.png`）—— 同一枚实心连音符剪影、同尺寸、**像素级对齐**：
空态是黑、`alpha=72/255`（≈28%，业主从 24/255 调亮的）的半透明底，满态是实心 `rgb(235,63,116)`。实现就是把**满态那张按 Fever 比例从下往上切一条**、
用 `overflow:hidden` 的壳（底部对齐）叠在空态上；再给整个图标上两层 `drop-shadow` 沿剪影投阴影（素材本身没有描边）。
**没有为本包新增任何引擎扩展点**，靠这些**通用**能力拼出来：

| 需要什么 | 从哪来 |
|---|---|
| 谁在场上 | 本包多声明一条 `game.hud.topBar` 的**组件改写**，把顶栏 props 的 `pub`/`priv`/`myId` 抄进面板（顶栏每帧都有最新一份）；再对照只读 `chess` 表筛出棋盘上 `bonds` 含 `aveMujica` 的棋子 |
| Fever 当前值 | 本包 `battle/main.mjs` 把 `{ fever, cap, on, until, len, full }` 写进模块级表 `FEVER_LIVE.byPid[pid]`（`full` = 五名成员是否齐全 ⇒ 面板据此选 BGM；`len` = 一段 Fever 的总时长）；面板从 `battleRunner.currentBattle().spec.workshopBattle` 里取到**同 URL**（`/workshop-battle/ave-mujica/battle/main.mjs?v=<hash>`）再 `import()` —— ES module 按 URL 去重，拿到的就是运行器加载的**同一个实例** |
| 贴在哪 | 引擎战场视图（`globalThis.__SP_VIEW__`，`ui/fieldHost.js` 挂载时写入）的 **`tileScreen(row, col)`** 把棋子所在的 **board 格子**映射成屏幕位置与大小（`public/js/render/app.js`）；面板用 `position: fixed` 把图标贴到该格**右下角**（干员模型右下方，尺寸/偏移都按「一格在屏幕上的高度」缩放）。**不用 `pieceScreenRect(uid)`** —— 实测它解析不了战斗单位（两枚在不同格上的棋子会返回**同一个**身体矩形 ⇒ 图标全叠一处） |
| 玫红技力条 | 引擎通用面 **`view.setUnitSpBar(uid, {color, frac})`**（传 `null` 恢复）：Fever 期间把成员自己的技力条换掉，填充 = 共用的 Fever 窗口**剩余比例**（`until` 同一个时间点 ⇒ 全员同时结束）。**2026-10-18 修**：同一个 `uid` 在引擎的 `views` 里可能有**两条**（棋盘那条 `p:<uid>` 的 prep 视图 + **战斗里那条**）—— 旧实现只写第一条，于是偶尔 tint 到**屏幕上不画**的那条上（业主：「每次 Fever 触发时总有的技力条还是黄条」）；现在 `setUnitSpBar` **把所有匹配到的视图都写上**并数出命中条数（控制台 `[sp-bar] uid=… 命中视图 N 条`）。 |
| 颂乐音符画在哪 | 音符是**自建弹道**，引擎不渲染 ⇒ 面板按 `NOTES_LIVE` 的世界坐标经 `tileScreen` **双线性插值**贴到屏幕；优先走官方 prefab（`raw.ofx.spawn('oblvns_attack_01_trail', …)` 每帧 `place()`），官方特效缺席时回落到包内两张贴图（拖尾 `oblvns_trail_01` + 星光 `star_02`） |
| Fever 音乐 | 面板直接 `import { audio } from '/js/audio.js'`，播放包内**20 秒片段**（`start: 0` ⇒ 不 seek）+ `play`（1 s 淡入淡出），并 `audio.playBgm(null)` 压低场地 BGM、结束再恢复（§7.16） |

> 限制：**服务端跑战斗**（`SP_COMBAT=server`）时，本包的 `server.battle` 模块不在浏览器里执行 ⇒ `FEVER_LIVE` 为空 ⇒ 面板不画。
> 默认的客户端战斗（client-side combat）下正常。

---

## 6. 引擎侧需要的支持

### 6.1 引擎里与本包直接相关、需要保留的文件

| 引擎文件 | 位置 | 与本包的关系 |
|---|---|---|
| `app/public/js/render/fx/kinds.js` | 第 8–10 行 | 引擎内置的 **`fever` 特效类型**（品红团队光环，`dur: 20`），注释**点名** `workshop/ave-mujica` 的战斗逻辑；本包 `battle/main.mjs` 用 `S.fxOn(battle,'fever',…)` 打这个特效 |
| `app/shared/kitImports.js` | 第 56–57 行、第 88 行 | kit / 战斗模块的 **import 白名单**：`@kit/tier1.js`（第 56 行）、`@kit/tier2.js`（第 57 行）供 5 个 kit 使用；`@battle/mod.js`（第 88 行）是 `battle/main.mjs` 的注册面入口；`BATTLE_IMPORT_PREFIXES = ['@battle/','@sim/']`（第 47 行） |
| `app/server/sim/content/support/mod.js` | 第 28–29 行 | 战斗内容层 SDK / 注册面：`registerBondInstaller`（第 28 行）、`registerGarrisonInstaller`（第 29 行）——本包盟约与战斗特质的注册入口 |

**`app/server/` 与 `app/shared/` 中没有任何本 mod 的专属运行时代码**（`grep -i mujica` 两处均无命中）——本包
已把战斗/休整期逻辑整体内聚到包里，引擎只为它保留了上表这些**通用**能力与一处特效注释。

### 6.2 本包依赖的引擎通用能力（不是为本包新增，但本包用到了）

| 能力 | 载体 |
|---|---|
| 战斗内容层 SDK / `register*` 全局表 | `@battle/mod.js` → `server/sim/content/support/mod.js`（`BondInstaller` / `GarrisonInstaller`） |
| 休整期注册表契约 | `pack.json.server.meta` + `meta/main.mjs` 的 `registry.bond/garrison/band`（键 = `registers`；引擎侧见 `server/match/effectsMeta.js` 的 `garrison:`/`band:`/`bond:` 键名规则） |
| kit 双端加载与 `@kit/*`/`@battle/*` 白名单 | `app/shared/kitImports.js`（服务端 `server/workshop.js`、浏览器 `public/js/battle/runner.js` 共用同一张表） |
| 盟约/分队**扁平图集** `art.bonds` / `art.bands` | `app/shared/workshop.js` 的 `normalizePackManifest` / `ART_TABLES` / `BOND_ICON_CONFLICT`；消费端 `app/public/js/ui/assetUrls.js` 的 `bondIconUrl()` / `bandIconUrl()` |
| 「受伤加层」garrison handler | **不在引擎**：`registerGarrisonInstaller('act_gar_event_onhurt_add_bond_layer', …)` 由 `workshop/ave-mujica/battle/main.mjs`（本包，2026-10-18 起）与 `workshop/rimbilliton/battle/main.mjs` **各注册一份、内容逐字一致**（引擎的 `server/sim/content/garrisons/battle.js` 只提供 `registerGarrisonInstaller` 这个**扩展点**，以及 `fireGain` / `byUnit` / `bbStr.bond_add_type` 的通用路径，**没有**这条键）——两包同时装着时按引擎的「同名键先到先得」只有一份生效（行为一致），**只装本包也生效** |
| 战斗内 `fever` 特效类型 | `app/public/js/render/fx/kinds.js` |
| 战场视图 + `pieceScreenRect(uid)` | `app/public/js/ui/fieldHost.js`（`globalThis.__SP_VIEW__` 的写入点）、`app/public/js/render/app.js`（`pieceScreenRect` 的实现）；引擎自己的 `screens/game/standInTags.js` 用的是同一条 |
| 面板能 `import` 引擎站点模块 | `docs/WORKSHOP.md` 的「你的面板模块可以直接 import 引擎的流程」——本包面板由此 `import { battleRunner } from '/js/battle/runner.js'`（同 data-board） |
| 面板槽 `screen.game.overlay` / 组件改写 `game.hud.topBar` | `app/public/js/ui/extensions.js` 的槽与改写链；`app/public/js/screens/game.js` 的 `.mod-host` 宿主 |

### 6.3 与本包绑定的验证脚本（非引擎运行时，供参考）

- `app/forge-flow-avemujica.mjs`：本 mod（Forge 版）的 prep 流程验证（盟约激活、1/2/3/4/5 人各档、双盟约若叶睦）。
- `app/forge-kit-behavior.mjs`：用真实工坊 kit 加载器验证 Ave Mujica 的 kits。
- `app/test/workshopArtTables.test.js`：以本包 `art.bonds` / `art.bands` 为例钉住扁平图集契约。

---

## 7. 素材

### 7.1 `art.chars`（5 名成员，每名含头像/立绘/Spine）

- `char_4182_oblvns`、`char_4184_dolris`、`char_4186_tmoris`、`char_4185_amoris`、`char_4183_mortis`。
- 每人 4 张图：`char/avatar/<charId>.png`、`char/avatar/<charId>_2.png`（精英化头像 `avatarE2`）、
  `char/portrait/<charId>.png`、`char/portrait/<charId>_2.png`；外加 `spine/op/<charId>/{front,back}/` 的
  `.skel` / `.atlas` / `.png` 与动画映射（`idle`/`deploy`/`attack`/`skill`/`die`/`skills{0,1,2}`）。
- 注意 `char_4183_mortis` 的 `portrait` 指向 `char_4183_mortis_1.png`（其它成员是 `_2`）。
- `anims` 的 `skill`/`skills` 已由项目 Spine 管线（`tools/assets/skel.mjs` + `tools/assets/anim-roles.mjs`）对真实骨架重算：
  `char_4183_mortis` 原先把 `via:"attack"` 写进了技能片段，导致开技能时只播普攻动作，现已改回 `Skill_1`/`Skill_2`。

### 7.2 盟约 / 分队图标（走扁平表，非 `bondIcons`）

| 表 | 键 | 文件 |
|---|---|---|
| `art.bonds` | `aveMujica` | `bond/icon_aveMujica.png` |
| `art.bands` | `band_wuyouyoumeng` | `band/band_wuyouyoumeng.png` |

> 本包**未用**顶层 `bondIcons` / `itemIcons`（无道具）。`art.bonds` 与 `bondIcons` 是「同一件事的两种写法」，
> 不可对同一 id 两处都声明（会整包拒绝）。

### 7.3 `art.skills`（11 张技能图标）

`skchr_am_doloris_1/2`、`skchr_am_timoris_1/2`、`skchr_am_amoris_1/2`、`skchr_am_oblivionis_1/2/3`、
`skchr_mortis_1/2`（落盘 `skill/<名>.png`）。

> ⚠️ **图标键 ≠ 技能 id。** `chess.json` 里的技能 id 用的是**官方 id**（`skchr_oblvns_1/2/3`、`skchr_dolris_1/2`、
> `skchr_amoris_1/2`、`skchr_tmoris_1/2`、`skchr_mortis_1/2`）——引擎的官方技能特效（`public/js/render/vfx/skills.js`
> 的 `resolveSkill`）只认官方 id，写 mod 自造的旧名 `skchr_am_*` 会让这一批 prefab 特效**一次都不播**。
> 而**图标**仍旧按包内那 11 个键取：客户端 `skillIconUrl` 的查找顺序是 `assets.skillIcon → skill.iconId →
> skill.skillId`，所以 `iconId` / `assets.skillIcon` 保持旧名，PNG 不用改名。
> （2026-10-17 修：此前四个人的技能 id 与包内 fx 索引对不上 ⇒ 技能特效全缺。）

### 7.4 单位战斗音效 `art.sfxUnits`（5 名成员）

落点 `assets.audio.sfx.units[<charId>]`（客户端 `public/js/assets.js unitSfxUrl` 与 `public/js/audio.js unit()`
读的就是这张表；25 个 mp3 在 `assets/sfx/player/p_atk|p_imp|p_skill/` 下）。

| 键 | 含义 |
|---|---|
| `attack` / `hit` | 普攻挥击 / 命中（`player/p_atk`、`player/p_imp`） |
| `skills` | `{ "<技能 index>": 路径 }` —— 该技能的**发动音**（`player/p_skill`，少数落在 `p_atk`） |
| `attacks` / `hits` | `{ "<技能 index>": 路径 }` —— **技能期间**那次攻击的挥击 / 命中（客户端只在技能开启时取） |
| `mix` / `attackMix` / `hitMix` | 官方音源表的「概率 / 音量」（本包未用 ⇒ 必定播放） |

> `die` / `born` 故意**不写**：官方那两条就是通用 `b_char_dead.mp3` / `b_char_set.mp3`，引擎在本单位没有自己的
> 死亡/登场音时会回落到它们（`public/js/audio.js` 的 `deathSfx`），写进来只是多两份重复文件。
> 音效文件取自引擎素材管线同一处上游（`tools/assets/sources.mjs` 的 `RAW.aa2voice`，经 `gh-proxy.com` 前缀代理），
> 与另外 484 名官方干员**同源同路径**；本地客户端里它们是 `.ab` 内的 FSB5，不能直接当音频用。

### 7.5 时装 `skins`（5 套）

| `id` | `name` | `charId` |
|---|---|---|
| `avemujica-oblvns` | 旋律的主人 | `char_4182_oblvns` |
| `avemujica-mortis` | 提线的本我 | `char_4183_mortis` |
| `avemujica-dolris` | 笼中歌者 | `char_4184_dolris` |
| `avemujica-amoris` | 情热魔术师 | `char_4185_amoris` |
| `avemujica-tmoris` | 月下执行者 | `char_4186_tmoris` |

`series` 均为 `Ave Mujica`；每套含 `skin/op/<charId>/` 下的 `avatar.png`、`portrait.png` 与
`front|back/<charId>_avemujica_1.{skel,atlas,png}`。

### 7.6 语音 `voices`（5 名 charId）

每人一组，键为 `start` / `faceEnemy` / `select` / `place` / `skill1`~`skill4` / `resultFour` / `resultThree` /
`resultTwo` / `resultLose`；文件为 `assets/voice/jp/<charId>/cn_0xx.mp3`（共 70 个文件）。

### 7.8 颂乐音符：清掉「引擎自己画的官方普攻弹道」

`assets/fx/index.json` 里 `units.char_4182_oblvns.modes[Default]` 的 `attack` / `combat` 两个能力
**删掉了 `projectileKey`**（原本是 `projectile_chr_oblvns`，其 `main` = 音符轨迹 prefab
`oblvns_attack_01_trail`）。

理由：她的普攻在 sim 里 `kind=null`（近战出手），而官方那格是 `MultiRangedAttack` + 弹道 ⇒ 客户端
`public/js/render/vfx/wiring.js` 会按「a sim-melee attack whose official ability is a ranged one with a
projectile: the projectile flies for show」把它**为了好看**飞过去打到敌人身上 —— 那就是「普攻把音符直接射到敌人身上」。
本包的「颂乐音符」是 `battle/main.mjs` 的**自建弹道**（面板按 `NOTES_LIVE` 画、射出后自己索敌追击），
官方那条留着就是同一个音符两套视觉。清掉之后：

* `oblvns_attack_01_start`（出手时他身上的施法特效）**照旧**播放；
* 飞行的音符只剩面板那一枚（贴图仍用官方音符轨迹 `oblvns_trail_01-*.webp`，看起来与官方一致）；
* 其余模式（`S2_AttackSpeed` / `S2_Atk` / `S2_Fever` / `S3` / `S2_Fever_Mag`）与其余 4 名成员的
  `projectileKey` **一个字节没动**。

> 这行改动是**从提取产物里删数据**，只对这一个单位的一个模式生效；`fx/manifest.json` 与 prefab 文件表不变
> （被删的只是「谁来发射」的引用，prefab 本身仍在包里，`art.skills` / 其他模式仍会用到它们）。

> **2026-10-18 补：S1「新月的苏醒」的官方 8 枚音符弹道也要摘掉**（业主：「祥子在 Fever 时会锁定敌人目标额外发射
> 一道由数个音符组成的很长的音符串，这个不应该存在」）。`units.char_4182_oblvns.skills.skchr_oblvns_1` 原本带
> **8 个 `projectile_chr_oblvns_s1_1..8`**，`abilities` 里还有 `MultiProjectileToTileAbility` / `MultiRangedAttack`
> （`additionalTimes: 7`）—— 引擎 `render/vfx/skills.js` 会按这两处把这 8 枚音符**为了好看**依次飞出去打敌人。
> 而 **Fever 期间 `openFeverSkills()` 会强制开她的技能** ⇒ 这串音符反复出现；本包真正的音符是另一套（自建弹道、
> `NOTES_LIVE`）⇒ 看上去就是「额外多出来的一长串」。
> 与 Default 模式同型：**只删「谁来发射」的引用**（prefab / `refs` / `projectiles` 定义表照旧留在包里）。
>
> ⚠️ **2026-10-18 修正（关键 —— 头两次没改对）**：索引里有**三处**能发射官方弹道，我先前只改了第一处
> （`units.<char>.{skills,modes}`），而引擎真正读的是**顶层的 `skills` 表**（`index.skills[<skillId>]` ——
> `render/vfx/skills.js` 的注释就写着它读 `skills[id].projectiles`）；第三处是 `units.<char>.abilities`
> （S3 的 `ExtraAttackMagic` 带 `projectile_chr_oblvns_s3_mag`，`S2_*` 的 `ExtraAttack*` 带 `s2_slow…`）。
> 所以前两次的改动**实际上没生效** —— 这正是业主随后仍看到「一技能的音符在带 3 技能时的 Fever 里出现」的原因。
> 现在**三处一起清**：递归删掉祥子整棵 fx 条目里的 `projectileKey` / `projectiles` / `additionalProjectiles`
> （`unit.projectiles` **花名册**、`refs`、`projectiles` 定义表**保留**）；S1 那两条带弹道的 `ability` 节点也摘掉
> （只留根 `AbilitySelectableGroup`，`effects` 保留 ⇒ 开技能那一下的抬手特效照旧播）。
> 复查（扫全表找 `oblvns_s1_` / `oblvns_s2` / `oblvns_s3` 的引用）：**只剩 `units.char_4182_oblvns.projectiles`
> 那条花名册**，没有任何发射引用。
> 其余 4 名成员**原样未动**（当时）。**2026-10-18 再追加（业主：「清理其他成员的同类问题」）**：同一套「三处引用」的
> 清理现在覆盖**本包 5 名成员的全部 fx 条目**（`units.<char>` 整棵树 + 顶层 `skills` 表 11 条）—— 只删
> `projectileKey` / `additionalProjectile` / `projectiles` / `additionalProjectiles` / `extraProjectileKeys` 这些
> **发射引用**；花名册 `unit.projectiles`、`refs` 与 `projectiles` 定义表**照旧保留**。复查：**残留发射引用 0 处**；
> `units` 5 / `skills` 11 / `prefabs` 80 完好。

### 7.9 表现修正：动作段、音符视觉、无目标音符的技力、每场重播

五处 2026-10-17 的修正（引擎侧只多了一个 `clipPerAttack` 口子，其余都在包内：`pack.json` 的 spine `anims`、`battle/main.mjs`、`ui/fever.js`）：

**(1) 祥子 index 1（满月的舞会，图标 `am_oblivionis_3`）的 `loop` / `idle` 归位。**
skel 里这套技能的长这样：`Skill_2_Start`（1.000 s，开启的过渡）→ `Skill_2_Idle_A`（4.000 s，**技能期间待机**）
＋ `Skill_2_Loop_A`（1.300 s，**攻击段**）。原先把 `Idle_A` 写进了 `loop` 槽 ⇒ 引擎 `_attackClip()` 在技能期间
每次攻击播的都是那段 **4 秒待机**（业主 2026-10-17 反馈「动作不对」）。现在：

```json
"skills": { "1": { "begin": "Skill_2_Start", "loop": "Skill_2_Loop_A", "end": null, "index": 1, "idle": "Skill_2_Idle_A" } }
```

⇒ 开启时播一次 `Skill_2_Start`，随后**待机是 `Skill_2_Idle_A`**，而**每次攻击播的是 `Skill_2_Loop_A`**
（引擎 `spine.js` 的 `_attackClip()` / `_skillIdle()` 正是按这对语义读的）。index 0（新月，`Skill_1`）与
index 2（残月，`Skill_3_Begin/Loop/End/Idle`）本来就是对的，未动。

> 官方推导器 `tools/assets/anim-roles.mjs` 在这套 skel 上也会挑到 `Skill_2_Idle_A`（它的 `variant` 规则排除
> `^…_idle$` 结尾的名字，而这里是 `Skill_2_Idle_A`，后缀是 `_A`）—— 也就是说这里必须**手写覆盖**，
> 不能照推导器抄。其余 4 名成员的每个技能槽与推导器逐条一致（已用脚本比对）。

**(2) 若麦（`char_4185_amoris`）声明 `anims.clipPerAttack: true`（含她的时装）。**
引擎 `render/units.js` 原本只给**敌人**这条政策（`actor.clipPerAttack = this.isEnemy`）：一次攻击**播完整一遍**
那段动作（自己的速度，只有当攻击间隔短过动作时才加速），播完回待机 —— 而不是按节奏把动作拉长/在每次攻击时打断重播。
现在**包可以声明**它（`anims.clipPerAttack: true`，`anims` 是 `shared/workshop.js` 原样透传的对象；引擎读
`units.js`：`this.isEnemy || entry.anims.clipPerAttack === true`；`test/render/feedback2-enemy-attack-clip.test.js`
钉住了这条）。已声明：**若麦**（默认前后向 + `avemujica-amoris` 时装前后向）。

测得的动作长度 vs 攻击间隔（正面 skel 实读 + 战斗里 `s.interval`）：

| 干员 | Attack | 技能片段 | 攻击间隔 | 声明 `clipPerAttack` |
|---|---|---|---|---|
| 若麦 | 1.800 s | `Skill_1` / `Skill_2` 均 1.800 s | 1.607 s | ✅ 已声明（动作比节奏长） |
| 初华 | —（吟游者） | `Skill_1_Loop` 3.333 s | 1.161 s | ❌ 未声明（要就说一声，一行） |
| 祥子 | 1.300 s | `Skill_2_Loop_A` 1.300 / `Skill_3_Loop` 1.167 s | 1.161 s | ❌ 未声明 |
| 海铃 | 1.000 s | `Skill_1` 1.500 / `Skill_2_Loop` 2.000 s | 3.500 s | ❌ 未声明（动作都短过间隔） |
| 若叶睦 | 1.200 s | `Skill_1` 1.200 / `Skill_2` 0.900 s | 1.200 s | ❌ 未声明 |

**(3) 颂乐音符的视觉：拖尾 + 星光（不再是两条白线）。**
面板原来只把 `oblvns_trail_01` 那张**拖尾**贴图当一枚正方形贴到屏幕上 ⇒ 看上去就是两条平线（业主 2026-10-17 带截图反馈）。
现在按官方 prefab 的构成画两笔：拖尾**沿运动方向拉长**、按 `projectWorld` 算出的**屏幕投影角**旋转，前端再叠 `star_02`
那枚星光（两张贴图都是官方 prefab 里用的）。`NOTES_LIVE` 的每项随之扩成
`[x, y, tracking, id, dirX, dirY, loose, skillOn]`（共 **8** 位：`id` 让面板跨帧认出同一个音符；后两位 `loose` / `skillOn`
是 (6) 加的，现**备用**）。
> 想 100% 还原官方 prefab 的话可以改用 `view.ofx.spawn('oblvns_attack_01_trail', …)` —— 引擎 `OfficialFx.spawn(key, place)`
> 是公开面，只差一个「棋盘坐标 → Unity 坐标」的换算（`render/vfx/mounts.js` 的 `spawnPoint`）；本包先用贴图近似。

**(4) 无目标那次「持续攻击」的技力。**
引擎只在它自己发出的攻击上给 `spType === 'attack'` 的技力（`server/sim/skills.js`），而「攻击范围内无目标」这一路引擎
**根本不发 atk** ⇒ `battle/main.mjs` 的持续攻击循环里在**射出音符的那一刻**按**同一条判据**（技能持续期间不给）补
`u.skill.gainSp(1, 'attack')`（业主 2026-10-17：不必命中）。实测（无敌人、只剩祥子）：`sp` 随每枚音符 +1，攒满后正常进充能。

**(5) 每场战斗第一次 Fever 的音乐从 0:00 播。**
`startMusic` 改成**先定位、再 play**：元数据没到就先把起播点记进 `pendingFrom`，`loadedmetadata` / `canplay` 时 seek+play；
`driveMusic` 里另有一条帧帧往后补的守卫。此前第一次 Fever 会从 0:00 开播 —— `currentTime = from` 在元数据就绪前被浏览器丢掉，`play()` 便从 0 开始。

> **2026-10-18 晚再修（本轮，根治）**：① 是**根**，而当时那条「预取」只是缓解（`preload='auto'` 不保证下完）。
> 业主裁决**方案 B** ⇒ 两首曲子裁成 **20 秒片段**、`start: 0`、**完全不 seek**，这条根消失。详见 §7.16。

> **2026-10-18 补：触发 Fever 时有时**整场没声音**（业主报）。**三条根因 + 三条修法**，都在 `ui/fever.js`：
> ① **工坊素材路由不支持 Range 请求** —— `/workshop-assets/**` 一律整段 `200 OK`、没有 `Accept-Ranges`
> （`server/http/static.js` 那条分支 `readFile` 整个文件后 `writeHead(200)`，**从不看 `Range`**；引擎自己的 `/js/**`
> 是正常的 `206 Partial Content`）。而本曲必须**seek 到 102/103 秒**：素材没**整段缓冲完**时 `currentTime = 102`
> 不生效 ⇒ 歌从 0:00 播、甚至出不了声。修法：**战斗一开始就预取两首曲子**（`preloadMusic()`，每首一个长期复用的
> `<audio>`）⇒ Fever 触发时它已整段在内存里，seek 立刻落地。
> ② **换场时 `music.on` 没归零** ⇒ 新一场的 Fever 见不到 off→on 边沿，那一支**根本不会起播**。修法：换场 /
> 离开对局时一并归零。
> ③ `startMusic` 一进门就 `audio.playBgm(null)`：Fever 曲迟迟不出声时玩家听到的是**整场死寂**（连场地 BGM 都没了）。
> 修法：**宽限 2.5 s**（`MUSIC_START_GRACE`）—— 还没出声就先把 BGM 放回来，一旦出声再压掉；重试改看
> **「播放位置有没有在往前走」**（不再只看 `el.paused`：`play()` 被挡时个别浏览器 `paused` 已经变回 false），
> 并在「到片段末尾、seek 落不下去」时**收尾而不是每帧重播**（后者会把 `volume` 钉在 0 ⇒ 同样是整场没声音）。

**(6) 自建音符要**自己触发攻击动作**（三技能「攻击还是待机」的真因）。**
引擎只在**它自己发出的攻击**上驱动攻击动画（`atk` 事件 / 快照前瞻）。祥子的「持续演奏」音符是本包自建的虚拟普攻，
引擎不发 atk ⇒ 客户端那条 actor 在技能开启期间一直停在**技能待机片段**（`Skill_3_Idle` 那一类）——
这就是「三技能攻击还是用的待机动作」。修法：面板在**认出刚出现一枚无目标音符**时（`NOTES_LIVE` 第 7 位标了
`loose`、第 4 位是音符 id）调一次引擎新开的 `view.setUnitAttack(uid)`（`render/units.js UnitView.playAttack`）——
那条 actor 就会按当前间隔播一遍攻击片段（有目标时引擎自己的 atk 已经播过，不会重复）。
> 2026-10-17 收紧三处（业主反馈「自动普攻时不会触发攻击动作」）：① **记账/触发移到屏幕投影之前** —— 音符刚出生
> 那一帧投不出屏幕就被 `continue` 掉的旧写法会把动作触发一起吞掉；② `playAttack` 改用 **view 自己的 `atkInterval`**
> （与引擎那条 `onAttack` 同一个来源），不再落到 actor 的缺省 1.0 s；③ 引擎 API 缺席（例如浏览器还是旧的
> `app.js`）时**报一次 console.warn** 而不是静默。`/js/render/*` 的响应头是 `no-cache`（带 ETag），普通刷新即可拿新版。
> 再补一条**不依赖新引擎 API** 的兜底：`view.setUnitAttack` 不通时直接取 `view.views` 里那条 UnitView 的
> `actor.attack()`（引擎任何版本都有这个方法）；两条都不通才 warn。⚠️ 注意 `no-cache` 只管「下次加载」——
> **已经打开的页面会一直用加载进模块图的旧模块**，改完必须刷新页面（推荐 Ctrl+Shift+R）后重进对局。
>
> **⚠️ 方向修正（2026-10-17 → 2026-10-18 定稿）**：先收紧成「技能外不播、技能期间才播该技能的攻击段」；
> 随后业主进一步裁决 —— **自建音符一律不播任何攻击动作**：技能外保持 `Idle`，技能中保持该技能的**待机**片段
> （`Skill_3_Idle` 那一类）。⇒ `ui/fever.js` 里那次 `triggerAttack` 调用**已注释停用**
> （`// if (it[6] === 1 && it[7] === 1) triggerAttack(raw);`）。`NOTES_LIVE` 的第 7/8 位（`loose` / `skillOn`）
> 与面板那条 `console.info` 自证**留着备用**，但**不要再打开**（`setUnitAttack` / `views.actor` 两条入口仍在，
> 想恢复只改一行）。

> **2026-10-17 (4) 三条真 bug / 回归**：① Fever 音乐「第一次没声音」= `startMusic` 每次 `new Audio()` 新建元素，
> 新元素没有「用户手势解锁」⇒ 自动播放门挡掉第一段 `play()`（rejected 被静默吞）。修法：`<audio>` **只建一次长期复用**
> + `driveMusic` 里「该响却没响就每 0.5s 重试 play()」。② 若麦「除了第一次都不完整」= 我上一轮只改了**攻击事件**那条路，
> 没改引擎实际用的**前瞻 `windUp`**（它从打击帧起播）。修法：`clipPerAttack` 声明过的单位在 windUp 里也**强制第 0 帧**、
> 不走 fast 循环（探针实测连做 4 次 windUp 都 `trackTime = 0`）。③ 有敌人时「看着像直射」= 自由段当时只有 0.1 s
> ⇒ 曾临时改成 **0.6 s**；**2026-10-18 按 PRTS Wiki 改回 0.1 s**（wiki：非技能期间最短自由移动时间 = 0.1 s），而「直射」观感
> 由新的【自由移动】参数解决 —— **技能外·有目标那一档改成「固定 2.0 沿当前方向直行」**，见 §7.11。另：官方音符特效的判定去掉了 `ofx.lib.has` 前置
> （只要有 `ofx.spawn` 就走官方，spawn 包 try），并给面板加了一行控制台自证
> `[ave-mujica] 音符攻击动作：触发成功（setUnitAttack / views.actor）`，用于定责「面板→引擎」这一段。

**(7) 声明的 `clipPerAttack` 一律**从第 0 帧**起播（若麦「只有第一次完整」的真因）。**
上一条只在 `interval ≥ 片段长` 时才从第 0 帧起播；若麦的动作 1.8 s 长过她的节奏 1.607 s ⇒ 后面的攻击都从**打击帧**
起播（片段后半段）⇒ 看着「只有第一次是完整的」。现在声明过 `anims.clipPerAttack` 的单位一律整遍播
（`spine.js` 的 `clipPerAttackWhole`；敌人仍按原来的 `interval ≥ 片段` 规则）。引擎侧同样由那次 actor 探针实测：
祥子三槽 / 若麦三槽 的 `trackTime` 都从 `hit` 变成 **0**。

**时装同步**：祥子、若麦的 `clipPerAttack` 都写在**默认前后向 + `avemujica-*` 时装前后向**（共 8 处）；
祥子 index 1 的 loop/idle 修正也含她的时装（见 (1)）。

**(8) ~~有目标的音符也走「扩张正弦」~~ —— 2026-10-18 按 PRTS Wiki 撤销。**
2026-10-17 曾把两条路径的轨迹**并成一条**（出生即扩张正弦、≥0.1 s 后锁上去追）。2026-10-18 按 wiki 拆回**三套参数**：
**技能外·有目标的【自由移动】= 固定 2.0 沿当前方向直行**（不是正弦），只有技能外·无目标与**技能期间**才是扩张正弦。
⇒「有目标时看着像直射」同样不再成立 —— 详见 **§7.11**。
（`forge-flow-avemujica.mjs` 的 D1 仍把若麦放在远处，量的是「祥子击倒敌人 → 层数+2」这条特质本身。）

**(9) 自动普攻的音符特效改用**官方 prefab**。**
面板不再只画贴图近似：拿 `__SP_VIEW__.raw.ofx.spawn('oblvns_attack_01_trail', place)` 给每枚音符起一枚官方特效，
**每帧 `place()`** 把它的锚点推到音符当前位置（轨迹粒子跟着锚点动 ⇒ 真拖尾），音符消失即 `kill()`（该 prefab 是 loop 的）。
棋盘 → fx 的坐标换算与 `render/vfx/mounts.js unitPoint` **逐字一致**（`x-10, y-9, -z`；离地 0.35 格按骨架 30° 倾斜分解
成 `(0, up·0.866, -up·0.5)`）。官方特效没装 / 设置关着 ⇒ `spawn` 返回 null，回落到 (3) 那套贴图近似（拖尾 + 星光）。

### 7.10 落盘目录约定

```
assets/
  char/avatar/<charId>.png, <charId>_2.png
  char/portrait/<charId>.png, <charId>_2.png
  skill/<skillIcon>.png
  bond/icon_aveMujica.png
  band/band_wuyouyoumeng.png
  skin/op/<charId>/{avatar.png,portrait.png,front/,back/}
  spine/op/<charId>/{front/,back/}
  sfx/player/{p_atk|p_imp|p_skill}/<名字全小写>.mp3
  voice/jp/<charId>/cn_0xx.mp3
  bgm/killkiss_inst.m4a, killkiss_vocal.mp3       # Fever 音乐（20 秒片段，§7.16）
  ui/fever_note_empty.png, fever_note_full.png    # 连音符积攒图标（§5.3）
  fx/index.json, fx/manifest.json, fx/tex/, fx/prefab/…   # 官方特效侧表 + 贴图/prefab（§7.8 / §7.9(9)）
```

（`pack.json.art.*` 里的路径均相对 `assets/`；Spine 的 `textures`/`skel`/`atlas` 必须同目录。）

---

## 7.11 「颂乐音符」按 PRTS Wiki 校正（2026-10-18）

祥子天赋「颂乐音符」与 S3「残月的余响」此前多处是 `[ASSUMED]` 近似。2026-10-18 照 PRTS Wiki（丰川祥子 页的
天赋备注 + S3 备注）**逐条校正**，改动全在 [`battle/main.mjs`](battle/main.mjs) 的 `installAveMujica` 内。

**A. 音符运动参数拆成三套**（`NOTE_PROFILES`；按「攻击时范围内有无目标 / 是否技能期间」选档）：

| 档 | 何时用 | 【自由移动】 | 最短自由 | 【追踪移动】 |
|---|---|---|---|---|
| `loose` | 技能外 · 出生时**无**目标 | **扩张正弦**：基础振幅 **0.3**、x 速度 **1.3** | **0.1 s** | 速度 **2.0**、转向 **7/30** 每帧 |
| `aim` | 技能外 · 出生时**有**目标 | **固定 2.0 沿当前方向直行**（不是正弦） | **0.1 s** | 速度 **2.0**、转向 **1/6** 每帧 |
| `skill` | **技能期间**（无论有无目标） | **扩张正弦**：基础振幅 **0.5**、x 速度 **0.8** | **0.8 s** | 速度 **1.3**、转向 **1/4** 每帧 |

三档统一：**更新间隔 0.4 s**、追踪范围半径 **1.0**、初始方向 = 祥子朝向 **左 20°~右 20° 随机**（天赋备注限定
「未开启技能时」，但 S3 备注另写明「技能期间同样随机」⇒ 一贯随机）、【已命中】状态**不存在**（命中即出列）、
攻击范围外且**连续 1 s 无追踪目标** ⇒ 消失、祥子退场 ⇒ 清除**不处于追踪中**的音符。
另按 wiki 修正了【自由移动】的取目标时机：**只在「不存在有效追踪目标」时**才取「自身半径内最近的敌人」
（旧实现是每 0.4 s 都拿最近的重设一次）。

**B. 新增一条发射前判定**：**攻击范围内不存在敌人**时，若朝向的**前方一格地块「通行类型 = 无」**（`tile.pass === 'NONE'`）
⇒ **无法发射音符** ⇒ 自动演奏循环直接跳过。

**C. S3 攻击档 = 钢琴 + 风琴**（`activeSkillAttack` 认出混档 → `playMixed`）：
**S3 生效期间**，一次「持续攻击」奏出**钢琴（物理）2 枚 + 风琴（法术）2 枚**，每枚 **×`atk_scale`（本级 140%）**；
**没开技能（哪怕装备着 S3）一律只奏 1 枚**（见 **H**）。
**两对各自按 S3 自己的规则索敌** —— **分别追踪法术抗性和防御力最高的敌人**（wiki 原文「……物理和法术伤害的音符，
且**分别追踪法术抗性和防御力最高的敌人**」——两串名单**顺序对位**：**物理↔法术抗性最高、法术↔防御力最高**）。
⇒ 这 4 枚音符**不绑定祥子这一击「选中的那个敌人」**（否则 4 枚会一起怼在她打的那个人身上）；它们照天赋的方式
**自己飘出去索敌**：出生即带各自的目标，先走【自由移动】（技能档 = 扩张正弦、最短 **0.8 s**）再【追踪移动】。
规则记在音符的 `prefer` 上 ⇒ **追踪目标失效**后仍按该规则重选。
**主动普攻与自动演奏共用**这一档的说法已经不成立 —— 祥子**没有主动普攻**，这一档只在「持续攻击」循环里走（见 **G**）。

**D. 「近战 / 远程」在音符出生那一刻定死**（wiki：所有音符强制使用缓存攻击力与攻击倍率；**未阻挡敌人时发射**的音符
视为**远程** ⇒ 始终吃特性 **80%**；**阻挡敌人时发射**的视为**近战** ⇒ **不吃** 80%，且**该音符之后去打别的敌人也不吃**）。
实现：出生时记 `n.melee = (祥子此刻正在阻挡敌人)`，命中结算 `amount = 缓存攻击力 × atk_scale × (melee ? 1 : 0.8)`。
（此前是**无条件**乘 0.8。）结算**排在出列之前** —— wiki：命中那一枚也计入穿透层数。

**E. S3 期间的 Fever 免死**（wiki S3：「Fever 期间 Ave Mujica 成员受到致命伤害时**不撤退**，**Fever 结束后退场**」；
备注：「免死效果需要处于技能期间生效，**优先级 −3000**，期间触发过此免死效果的单位将在 **Fever 结束时 / 自身退场时退场**」）：
一条**不带 owner** 的 `battle.on('fatal', …, { priority: -3000 })`（owner 钩子会在该干员离场时被 `offOwner` 撤掉 ⇒
重新部署后就没了），命中条件 = **祥子的 S3 正在生效** 且 当前处于 **Fever**（Fever 期间成员被强制开着技能 ⇒ 也满足
「处于技能期间」）⇒ `c.prevented = true`（引擎把血顶到 1），并把该成员记进 `avemujica:feverSaved`；
**Fever 结束**那一刻让这些成员 `battle.retreat`（该成员若已先离场则自动销账）。

**F. 技能的伤害由 **kit** 承担、音符承担「攻击那一下」—— 这两套必须**去重****（2026-10-18 修）：
`kits/chess_char_6_30_a.js` 早就把三条技能教给了引擎（S1 `onStart` 按 `bb.scales` 直接打 **8 下**法术伤害；
S2 `attack: { hits: 2, arts }`；S3 `attack: { hits: 4, atkScale: 1.4, arts }`），而本包的音符又按同一档播一遍
⇒ S3 期间等于「引擎 4 下 ×1.4 + 自建音符 4 枚 ×1.4」= **双倍**。修法：`hit` 钩子里那次置 0 **去掉 `d.isSkill`
那道例外** —— 凡 `isAttack` 的攻击伤害（普攻 **与技能攻击**）都由音符承担；kit 的 S1 那 8 下**不带 `isAttack`**，
所以照旧保留（它是 S1 唯一的伤害来源，本包没为它建音符实体）。
**S2 的二连击现在只在 Fever 期间生效**（wiki：「**Fever 期间**变为当前音色的二连击」）—— 平时只奏 **1 枚**。
**仍未建模**：S2 的钢琴/风琴切换（音色 → 物理/法术、两套飞行/攻速参数）与各技能自己那套音符运动参数，
一律按「技能期间」通用档近似；【已命中】的固定停留时长未做。

**G. 「祥子没有主动普攻」—— 发射路径只剩一条**（业主 2026-10-18 纠正）：她的攻击**全部**是天赋的「持续攻击」
（**无论攻击范围内是否有目标都持续攻击**），所以 `battle.on('attack')` 那条钩子**不再产生音符** —— 早期版本正是
由它把引擎选中的 `targets[0]` 当音符的出生目标，音符才会「一直锁定在敌人身上」。现在：

- **唯一节拍源** = `battle.every(NOTE_DT)` 的「持续攻击」循环（按 `s.interval` 奏）；顺带**删掉了 `u.atkCd > 0`
  那道门** —— 引擎有目标时一直在开火、`atkCd` 长期为正，留着它会把**唯一**这条路挡死。`frontPassable` 的
  「前方一格通行类型 = 无 ⇒ 不发射」保留。
- 音符**出生不带追踪目标**，自己飘出去索敌；**S3 例外**（它的规则要求「分别追踪最高法抗 / 最高防御」，那 4 枚
  出生即带规则选出的目标）。
- 运动参数改由「**这一拍攻击范围内有没有可选敌人**」决定（`aim` / `loose`），与「音符有没有追踪目标」脱钩。
- **技力不重复给**：引擎这一拍自己开过火时，它会自己给 `spType === 'attack'` 的技力（`server/sim/skills.js`），
  所以 `attack` 钩子改成只记一个标记（`noteState.engineAtk`），循环里看到标记就不再补 —— 只在**引擎没开火**
  （攻击范围内无目标那一路）时才按同一条判据补上。

**H. 「技能档」只在技能**生效期间**才生效**（业主 2026-10-18：「你是不是把 3 技能的演奏音符数量当成常态了？
开启 3 技能时才会额外演奏 4 个音符（2 个钢琴、2 个风琴），正常持续攻击时只有 1 个音符」）。`activeSkillAttack` 加两道门：

- **`inSkill(u)`**：**没开技能就一律 null** ⇒ 持续攻击只奏 **1 枚**（原来装备着某个技能就按它的档奏多枚）。
- **`skillIndexOf` 改读「现行装备」的 index**：`u.skill.def.index`（退回 `u.def.skill.index`）。原写法先看 `u.skill.index`
  —— 实测 `SkillRuntime` 上**没有**这个字段（恒 `undefined`），于是退到 `raw.backup.skillIndex`：那是 chess 记录里
  「默认/备份」的技能选择、**与当前装备无关**，实测祥子装备 S3 时它仍是 **1** ⇒ 一直读到的是 **S2 的档**
  （2 枚法术音符）⇒「额外音符」成了常态，而 **S3 的混档根本取不到**。
- 实测（`test/` 的 harness 起真实战斗，三种 loadout）：未开技能 ⇒ 都是 **1 枚**；**S3 生效** ⇒ `mixed half=2 scale=1.4`
  （2 物理 + 2 法术 ×140%）；**S2 生效** ⇒ `hits=2 arts`（数据给的 2 枚，见 **F**）。

**I. 索敌提前到「每帧」**（业主 2026-10-18：「怎么有些时候丰川祥子的音符在场上却没办法及时索敌？」）：
非 S3 的音符（`prefer` 为空）**出生不带目标**，只能靠 wiki 的更新规则选目标 —— 而那条规则是**每 0.4 s 采一次样**、
在**音符自身 1.0 半径内**取最近的敌人。音符以 **2.0 格/s**（技能外·有敌那一档）飞行时，两次采样之间会走
**0.8 格** ⇒ 它**可能整段从敌人身侧掠过**（两次采样都落在 1.0 之外）⇒ 永远锁不上、飞出攻击范围后 **1 s** 消失。
**S3 那 4 枚**因为出生就带规则选出的目标，所以从不出现这个现象 —— 这正是「有些时候」的由来。
修法：**把「选目标」这一步从「每 0.4 s 一次」提前到「每帧一次」**（还是同一条规则：`nearestEnemy(自身, 1.0)`）；
状态机的节拍（0.4 s 更新 / 最短自由移动时间 / 追踪↔自由 切换 / `prefer` 的规则重选）**一字未动** —— 规则没变，
只是不再因为采样太疏而漏掉。

---

### 7.12 时装的战斗特效（2026-10-18）

业主：「切换时装后，特效也要一起更换为时装的特效，这些文件也是放在对应的包中，不放在本体中。」

**取证事实（从游戏客户端 `StreamingAssets/AB/Windows`）**：官方**不是**「每套时装一个特效包」，而是把这 5 套时装的
特效 prefab 与默认皮肤的放在**同一个** bundle 里，命名 = 「基础 key + `_<时装 id 去掉 charId 前缀>`」。5 名成员的
官方时装 id 都是 `<charId>_avemujica#1`，所以后缀统一是 **`avemujica#1`**：

| 面 | 客户端位置 | 命名 |
|---|---|---|
| 时装模型（官方时装 id） | `skinpack/<charId>.ab` | `char_4182_oblvns_avemujica#1`（`dyn/battle/prefabs/skins/character/<charId>/…`） |
| 时装特效 prefab | `battle/prefabs/effects/<短名>.ab` | `oblvns_skill_01_start_avemujica#1`、`amoris_skill_02_start_01_avemujica#1` … 共 **92 个** |
| 时装要用的贴图/网格 | 同上（与 prefab 同 bundle） | 随 prefab 一起提，新增 **186 张**贴图（371 个文件，含半尺寸）+ **36 个**网格 |

> 本机提取源里确实**没有**这 5 套时装的任何 prefab（包原先只有默认皮肤那 80 个）；上面这批只能从客户端补提。

**本包落了什么**（全部在包内，引擎本体零素材）：

- `assets/fx/prefabs/` 新增 **92** 个时装 prefab。文件名走提取器自己的 `fx_file()`：key 里的 `#` 会转成 `_` 并附
  CRC32 尾号（如 `oblvns_skill_01_start_avemujica_1-39ea0f25.json`）；`assets/fx/tex/`、`assets/fx/mesh/` 补齐它们引用
  的贴图与网格。
- `assets/fx/index.json` 的 `skins` 多出 **5 条时装条目**，**按该时装的模型 stem 为键**（`char_4182_oblvns_avemujica_1`，
  即 `pack.json.skins[].art.spine.front.skel` 的文件名去掉 `.skel` —— 也正是引擎画这套时装时用的那个 stem），每条带
  `source`（`skinpack/<charId>.ab <时装 id>`）、`graphic`、`points`（**该时装自己的挂载点**，从 `skinpack` 的时装
  prefab 提）与 **`fx: "avemujica#1"`**（客户端把特效 key 拼成 `<key>_<fx>` 的那个后缀）。
- `assets/fx/manifest.json` 的 `fx/prefabs` / `fx/tex` / `fx/mesh` 三组补上这些新键（路径统一
  `/workshop-assets/ave-mujica/fx/…`），`fx.index.prefabs` 80→**172**、`fx.textures.count` 136→**322**。
- `pack.json.version` 1.8.13 → **1.8.14**（**`pack.json.skins[]` 一个字没动** —— 后缀由 fx 数据侧声明）。

**引擎那一环（只新增、不改动原有行为）**：

| 引擎文件 | 改动 |
|---|---|
| `public/js/render/vfx/wiring.js` | 新增 `skinFor(v, u)`：先问 `opts.skin`（当前穿的时装的模型 stem）→ `index.json.skins[<stem>]`，查不到才退回原来的 `skinOf(unitOf(v))`；`playOn()` 在取 prefab **之前**把 key 拼成 `<key>_<fx>`（数据里有就用它），挂载点改取自 `skinFor` 的记录；`_fly()` / `_bounce()` 的挂载同理；`keysFor()` 顺手预载这些后缀变体 |
| `public/js/render/app.js` | 给 `FxWiring` 的 opts 传 `skin: (info) => assets.skinModel(info.ownerId, <charId 候选>)`（候选串与 `unitKey` 同一个） |
| `public/js/assets.js` | `assets.skinModel(owner, charId)`：复用换装链（`portraitChain.appearanceSpineFor`）拿到该主人选中的时装模型，返回其文件名 stem —— 与**模型换装**同一条链、同一份选择状态 |
| `public/js/render/vfx/funnelfx.js` | 两处 `skinOf(unitOf(x))` 改成 `skinFor(x)`（浮游单位的命中点也跟着时装走） |
| `public/js/render/app.js` | `paintNoteFx(key, entries, o)` 多一个**可选的** `o = { owner, charId }`：面板自建的弹道（§5.3 的颂乐音符拖尾）点名「这些音符是祥子的 ⇒ 她穿时装时起 `<key>_<fx>`」，与 `playOn()` 同一条规则 |
| `docs/design/vfx-format.md` | §35.12 Skin 增补「时装是独立条目 + `fx`」，changelog 加 2026-10-18 一条 |

> **面板自建弹道那一半**（业主 2026-10-18：「其他特效都对，唯独丰川祥子的**音符特效**没有变化」）：颂乐音符是
> **包自己**的弹道，走的是引擎的 `view.paintNoteFx(key, entries, o)`（面板拿不到 `ofx` 实例），所以它**不经过**
> `playOn()` —— 只在 `paintNoteFx` 里按同一条规则换 key，音符才跟着换装。`ui/fever.js` 三次调用里只有真正起特效的
> 那次传了 `noteFxOwner()`（`{ owner: state.feed.myId, charId: 'char_4182_oblvns' }`）。

**没有时装 / 那套时装没登记 `fx` 时的行为**：`skins[<stem>]` 查不到 ⇒ 一律退回本来的记录 ⇒ **与从前逐字相同**
（`opts.skin` 根本没传时也一样）。所以其它包（含 `workshop/skin-supplement` 那批时装）**行为不变** —— 它们想拿到
时装特效，照本节给自己的时装补 `skins[<stem>]` 条目（带 `fx`）即可，**不需要再改引擎**。

> 提取口径：这 92 个 prefab 用项目自带的 `tools/local-extract/fx.py` 的 `--fx-keys` 增量模式提，客户端版本与包内
> `index.json.source.client` 一致（`26-09-13-15-28-10-30688348`）；时装挂载点来自 `skinpack` 的时装 prefab，其
> `graphic` 与默认皮肤用**同一个**（客户端里时装就挂在同一个 `Graphic` 节点之下）。

---

### 7.13 若叶睦（精锐）「受伤加层」上限 4 → 2（2026-10-18）

业主：「把若叶睦的特质，精锐后从最多4次改为2次。」

- `garrisons.json` 的 `garrison_164_b`：`bb.max_count` **4 → 2**，`desc` / `descRaw` 同步改成「最多2次」；
  普通版（`garrison_164_a`）的 `max_count 2` 不动。
- 改的**是数据**：上限由雷姆必拓包注册的 handler 读 `bb.max_count`（见 §4 那条说明），引擎与本包代码都不动。
- `bond_add_count 10` 不变 ⇒ 精锐现在是「每次受击 +10，至多 **2** 次」（普通：「+5，至多 2 次」）。

---

### 7.14 若叶睦「受伤加层」的实现复制进本包（2026-10-18）

业主：「把若叶睦的这个特质的实现复制一份到颂乐人偶mod中。」

- **核实**：`act_gar_event_onhurt_add_bond_layer` 这条 effectKey **引擎里没有**（`server/sim/content/garrisons/
  battle.js` 只提供 `registerGarrisonInstaller` 这个扩展点），原先只有 `workshop/rimbilliton/battle/main.mjs`
  注册 ⇒ **只装本包时若叶睦的 `garrison_164` 一次都不触发**（本包对雷姆必拓包的隐式硬依赖）。
- **现在** [battle/main.mjs](battle/main.mjs) 末尾**新增一份逐字一致的注册**（同一个 `battle.on('damaged')` 逻辑：
  受击 → `it.fired++` → `fireGain(battle, it)`；`it.fired >= bb.max_count` 后停）⇒ **本包自足，只装本包也生效**。
- ⚠️ 引擎的 `registerGarrisonInstaller` 对**同名键先到先得、重复静默忽略**（`EXTRA_INSTALLERS`）⇒ 两包同时装着时
  只有**先加载的那一份**生效。两份**必须逐字一致**（否则行为会随包的加载次序漂）：改本包这一份就要**同步**改
  `workshop/rimbilliton/battle/main.mjs` 里的那一份，反之亦然。
- 新用到的 SDK 导出：`byUnit`、`fireGain`（`@battle/mod.js`）。
- **数据侧不动**：`garrison_164_a/_b` 的 `max_count` / `bond_add_count` 见 §7.13。

---

### 7.15 四条：初华上限、若麦每层增攻、休整期「在场」闸门（2026-10-18）

业主四条（第 1 条经核实为**本来就不成立**，不动代码）：

1. **盟约 2 人数效果不受三角初华特质影响 —— 核实成立，不改。** 初华的特质在引擎里是一条**放大器**
   （`battle._rbAmplifiers`），它只放大「**加层类驻站特质的触发**」（走引擎 `fireGain`）；而 2 人数那条
   「休整期结束时、每名在场成员 +1 层」在 [meta/main.mjs](meta/main.mjs) 的 `onPrepEnd` 里走 `ctx.addLayers`，
   **不经过 `fireGain`** ⇒ 放大器碰不到它。
2. **初华 `AVEMUJICA_EXTRA_TRIGGER` 加「每个颂乐人偶干员最多1次」**：`garrison_181_a` / `_b` 的 `bb` 加
   `max_count: 1` —— 引擎 `fireGain` 的 `usedBy` 是**按来源干员**计的，所以这是「每名成员每场最多被额外放大 1 次」；
   `desc` / `descRaw` 同步写成「额外触发1次 / 2次（每个颂乐人偶干员最多1次）」。精锐的 `extra_trigger 2`、
   `partner_layers 1/2` 与「祥子加层那半每场 1 次」都不变。
3. **祐天寺若麦每层增攻 0.1% → 0.05%**：`bb.amoris_atk_per` 0.001 → **0.0005**、`buffs[0].bb.amoris_atk_per`
   0.0025 → **0.0005**、[battle/main.mjs](battle/main.mjs) 里的代码回退值 0.0025 → **0.0005**、
   `spec.formulas.amorisAtk` 同步；文本四处（`desc` / `descRaw` / `effectDesc` / `effectDescRaw`）改成「每1层增加0.05%」。
   ⚠️ 原先两处数据**并不一致**：顶层 `bb` 写 0.001（=0.1%/层，只进描述参数表），而战斗真正读的是 `buffs[0].bb`
   的 0.0025（=**0.25%/层**）—— 引擎 `bondBb()` 对 mod 盟约按 `bbStr.key` 取那条 buff 的 `bb`。这次按业主口径
   **统一到 0.0005**，战斗实际生效值因此从 0.25%/层 降到 **0.05%/层**（文本与实战从此一致）。
4. **休整期侧必须「干员在场上」才生效**：`garrison_182_a/_b`（海铃 刷新加层）与 `garrison_183_a/_b`（若麦 休整期奖励）
   的 `bbStr` 加 `conditionkey: "character_target_inboard"`（与 [workshop/rimbilliton](workshop/rimbilliton) 同一写法）
   ⇒ 两条特质**只在干员站在场上时触发**，收进手牌 / 临时整备区即不再生效（引擎 `effectsMeta._garrisons` 对
   `where === 'hand'` 直接 `continue`）。盟约自己的 tier 效果本来就只数**场上**成员（`countMode: BOARD` ⇒
   `bondsMeta.computeBonds` 只取 `onBoard`），4 人的部署位还会在人数掉下来时由 `onBondChange` 当帧回退。
- `pack.json.version` 1.8.18 → **1.8.19**。

---

### 7.16 Fever 音乐改成 20 秒片段（根治「有些时候听不到」）（2026-10-18）

业主：「fever 的音乐有些时候无法正常跟随 fever 触发时播放，看看是什么问题」→ 诊出根因后裁决
**方案 B：把素材裁成 20 秒片段替换掉**。

**根因（实测链条）**：`MUSIC` 原先指向**整首**曲子（`inst` 3:25 / `vocal` 3:28），播放点要 **seek 到 102 / 103 秒** ——
而这条素材路由 `/workshop-assets/**` **不宣告 `Accept-Ranges`**（实测：带 `Range: bytes=0-99` 的请求仍回
`200` + 整段 1 593 439 字节、没有 `Content-Range`；`server/http/static.js` 那条分支 `readFile` 整个文件后
`writeHead(200)`，**从不看 `Range`**）。media element 只能在**已缓冲到的那一段**里 seek ⇒ 素材没整段下完时
`currentTime = 102` 落不下去：轻则这首歌**从 0:00 播到 2:02**（位置全错、还压着场地 BGM），重则**不出声**；
而 `startMusic` 一进门就把场地 BGM 压掉 ⇒ 那一段时间是**死寂**。**时好时坏**的原因也清楚：
`Cache-Control: public, max-age=86400` —— 同一首**成功整段下过一次**之后缓存里有完整数据、seek 立即落地，
而**冷缓存 / 战斗一开始就触发 Fever / 网络或磁盘忙**的那几次就会踩空。
（§7.9 的「先定位、再 play」与上一条 2026-10-18 的「预取两首」都长在这个根上，是**缓解**不是根治。）

**改法**：
- 素材（无损切段，**没有二次编码**，都用 `ffmpeg -ss <秒> -t 20 -c copy` 切）：
  - `assets/bgm/killkiss_inst.m4a` —— 原 `killkiss_inst.mp3`（**其实装的是 MP4/AAC**，只是扩展名写成了 `.mp3`）
    的 **102–122 s** 片段：155 076 B / 20.0 s / AAC LC 立体声 60 kb/s；
  - `assets/bgm/killkiss_vocal.mp3` —— 真 MP3 的 **103–123 s** 片段：161 067 B / 20.0 s / MP3 单声道 64 kb/s。
  - `.m4a` 在 `WORKSHOP_ASSET_TYPES` 白名单里（`audio/mp4`）⇒ 服务端按真格式发，**不再靠浏览器嗅探**一个
    名叫 `.mp3` 的 MP4。
- 代码：`MUSIC` 改成 `start: 0, end: 20` ⇒ **完全不 seek**（起点就是文件第 0 秒）。`preloadMusic()` 保留
  （冷缓存时少等一次下载），但不再是「seek 落不下去」的必需项；`startMusic` 的「先定位、再 play」与
  `driveMusic` 的定位守卫现在只服务**同一场内续播**那个几秒的偏移。
- `pack.json.version` 1.8.19 → **1.8.20**。

> ⚠️ 没动引擎、没动那条路由：`/workshop-assets/**` 的 Range 支持（引擎侧 `serveFile` 本来就有）**这一轮不动**
> —— 那是方案 A。若以后还有别的包要靠 seek（长音频、视频），再单独提。

### 7.17 海铃 S2 期间的姿态：引擎新增技能槽 `hold`（2026-10-18）

业主：「八幡海玲的 2 技能持续期间内使用的动作应该是 loop，而现在用的却是 end。」

- **根因（引擎侧）**：`public/js/render/spine.js` 的 `case 'attack'` 在**一次攻击播完**时，只要当前那条 clip 声明了
  `end` 就插播它。海铃 S2 期间 `_attackClip()` 返回的正是**技能槽**（`begin: Skill_2_Begin, loop: Skill_2_Loop,
  end: Skill_2_End`，**没有自己的 idle**）⇒ 每个攻击间隔末尾都插一段 `Skill_2_End`。旧代码只对「技能**有自己的
  idle**」的技能豁免这一条（`toSkillIdle`），海铃不属于那一类。
  ⚠️ **不能一刀切改**：同形声明在官方干员身上是对的 —— 「宴 S1 分神」的 `Skill_End` 就是「坐一下再站起来」的
  每次施法收尾，`test/render/feedback3-skill-idle.test.js` 明确把它钉成「**unchanged**」。所以这里是**新增声明位**。
- **引擎（只加，不改既有行为）**：技能槽可声明 **`hold: true`**（`spine.js`）⇒ 该技能的 `loop` 是**整段持续期间的
  姿态**：每次攻击播完回这条槽的 `idle`（有的话）或 **`loop`**，`end` 交给 `setSkill(false)`（只在技能结束时播）。
  不声明的槽行为**逐字不变**。
- **包内**：`pack.json` 里该三元组的 **8 处**（初华 / 海铃 × 前向 / 后向 × 本体 / 时装）都加 `"hold": true` ——
  这两人的 S2 都是 `duration`（`kits/chess_char_5_30_a.js` / `5_32_a.js`）。
- `docs/ASSETS.md` 的「技能片段」一节同步记了这个字段；`pack.json.version` 1.8.20 → **1.8.21**。

### 7.18 Fever 音乐「只有每场第一次响」的回归：续播点被记成片段末尾（2026-10-18）

业主：「fever 的音乐现在只有每场战斗第一次触发时才会出现，后续触发都没了。」—— 这是 **§7.16 那次改动的回归**。

- **根因（两条链）**：
  1. §7.16 把曲子换成 **20 秒片段**（`start: 0, end: 20`）后，`driveMusic` 记录「续播点」的判据
     `pos > MUSIC[which].start` **变得几乎恒真** —— 原先 `start` 是 102 / 103 秒，只有真的往后播过一段才记为续播点；
     现在片段起点是 0，而 **Fever 时长（20 s）恰好等于片段长度**，正常结束的 Fever 往往停在 ≈ `end`（20 s）⇒ 把 **`resume = 20`（片段末尾）** 记了下来。
  2. 下一次 Fever：`startMusic` 取 `from = max(spec.start, resume) = 20`、写入 `m.pendingFrom = 20`；`el.currentTime = 20`
     一落地就满足 `pos >= spec.end` ⇒ **立刻**走「整段播完 ⇒ 回起点重播」分支 `replayMusic()`（把 `currentTime` 拨回 0）。
     但 `replayMusic()` 只清了 `m.resume`、**没清 `m.pendingFrom`** ⇒ `driveMusic` 的「起播定位守卫」每帧看到
     `el.currentTime(0) < pendingFrom(20) − 0.25`，又把它 **seek 回 20** ⇒ 位置永远卡在片段末尾 ⇒ 1.5 s 后
     `m.stuckSince` 超时 → 淡出收尾 ⇒ **整个 Fever 期间静音**。每场战斗的第一次之后都这样。
- **改法（都在 `ui/fever.js`，两处）**：
  1. `replayMusic()` 里补 **`m.pendingFrom = null`** —— 重播 = 从头开始，定位守卫一并作废；
  2. 记录续播点的判据收紧为「**确实停在片段中间**」：`pos > spec.start + 0.25 && pos < spec.end − 0.25`
     （这样整段播完的 Fever 不再留下 `resume = end`，下一次 Fever 才真正从头播）。
- `pack.json.version` 1.8.21 → **1.8.22**。
- ⚠️ 只动包的客户端面板，未动引擎；改完需**重启 `:3000`**（客户端拿的是启动时装载的那份）。

### 7.19 祐天寺若麦：S2 八连击完整结算 + 「持续攻击」（2026-10-18）

业主：「祐天寺若麦的伤害不对 —— 开启技能后的攻击**只有第一段**。她的 S2「如麦般生长」应是一套动作 **8 段**伤害
（S1 是 **3 段**）：一套动作内**完整打完 8 段**才重置；**不因为敌人消失（死亡）/ 目标转移就重置当前攻击段数**；
她和丰川祥子一样是「**持续攻击**」。」

**根因（复现实测）**：技能黑板（`hits: 8`）与生效档都对 —— S2 生效时 `effectiveProfile(u).hits === 8`。问题在
**引擎的连击循环**：`server/sim/ai.js` 的 `resolveHit` 写的是

```js
for (let h = 0; h < hits && target.alive; h++) { … b.dealDamage(u, target, …) }
```

⇒ 目标在**第 1 段**就被打死时整条连击**立刻中断**。实测量化（同一场、同一段代码）：S2 打**扛得住**的靶子
⇒ **8 次** `damaged`；换成**血薄**的靶子（第 1 段即死）⇒ 只剩 **1 次**，第 2 个范围内的敌人一次都没挨到。
S1（3 段）同理：扛得住 = 3 次、第 1 段即死 = 1 次。

**为什么不在引擎里翻掉那一句**：`&& target.alive` 是引擎对**所有**干员的既有语义（黄金语料逐字节依赖它）。
只给若麦改就会动到全部内容，所以修在**包侧**。

**改法（两处，都在包内）**：

1. [`kits/chess_char_5_31_a.js`](kits/chess_char_5_31_a.js)：S1 / S2 的攻击档改成 `combo(N, scales)` —— 引擎那一下
   只算 **第 1 段**（`hits: 1`，它一定会发生、不受后续循环影响，倍率走 `scales[0]`），其余 `N − 1` 段在
   **`attack.onHit`** 里补完：**一段一次 `dealDamage`**、**每段用自己那一档倍率**，且**每一段都重新**在攻击范围内
   随机取一个**存活**敌人（数据原文「随机攻击范围内的目标」），无可用目标的那一段**空过而不重置段数**。
   ⇒ 一套动作必定打满 `N` 段；目标阵亡 / 目标转移都不会腰斩或重置这一套。段伤害与引擎同一式：
   `atk × 该段倍率 × 单位的 atkScaleMul`；第 1 段（引擎那一下）仍带 S1 的溅射。
   （`attack.onHit` 是引擎既有的 kit 面 —— `skills.js` 的技能档注释与 `op-mantra` / `snhunt` 等官方 kit 都这么用。）
   **每段倍率逐段取自该技能自己的 `bb`**（业主 2026-10-18 确认数据为真）：

   | 技能 | 段 1 | 段 2–3 | 段 4 | **段 5** | 段 6–8 | 合计 |
   |---|---|---|---|---|---|---|
   | S1 如焰般热烈（3 段） | `first_scale` **1.3** | `sub_scale` 0.2 | — | — | — | **1.7 × atk** |
   | S2 如麦般生长（8 段） | `main_scale` **1.0** | `sub_scale` 0.1 | `sub_scale` 0.1 | `main_scale` **1.0** | `sub_scale` 0.1 | **2.6 × atk** |

   （S2 的原文：「第一、五次攻击的攻击力变为 100%，其余攻击的攻击力变为 10%」。）**回落**：某段该键缺席时用它
   所属技能的 `atk_scale`（默认 1.0）—— 即数据没写 `first_scale` / `main_scale` / `sub_scale` 的技能行为与改动前
   **逐字一致**。
2. [`battle/main.mjs`](battle/main.mjs)（盟约安装器 `installAveMujica`）：「**持续攻击**」与祥子同款 ——
   一条 `battle.every(NOTE_DT)` 循环按**自身攻击间隔**（`s.interval`）出手，**攻击范围内有没有目标都照打**：
   记一笔到自省句柄 **`battle._avemujicaAmoris.actions`**，并在**引擎这一拍没自己开火**（范围内无目标那一路引擎
   根本不发 atk）时补 `spType === 'attack'` 的技力（技能持续期间不给，与 `skills.js onAttackPerformed` 同一条判据；
   引擎开过火则用 `engineAtk` 标记去重）。同祥子：**不看 `u.atkCd`**（引擎有目标时它长期为正）。
   伤害本体仍由引擎那一下 + kit 的 `onHit` 承担，这一支**不重复结算**。

**新增测试**：[`app/test/content/avemujica_amoris.test.js`](../../test/content/avemujica_amoris.test.js) 4 条（另加 §7.20 的 2 条）——
S2 打满 8 段且**段 1 / 段 5 = 100%、其余 6 段 = 10%、合计 ≈2.6×atk** / S1 打满 3 段且 **1.3 / 0.2 / 0.2、合计
≈1.7×atk** / 目标在连击途中阵亡时其余 7 段落到范围内的另一个敌人（`n ≥ 7`）/ 范围内无敌人时
`_avemujicaAmoris.actions` 仍在涨且技力在涨。用**显式** `workshopDir` 读一份带本包 overlay 的数据，不碰进程单例。
- `pack.json.version` 1.8.22 → **1.8.23**。

---

### 7.20 音符索敌：被任意成员阻挡的敌人也成为「追踪目标」（2026-10-18）

业主：「**被其他 ave mujica 成员阻挡的目标也会成为丰川祥子射出音符的索敌目标。**」这里把「其他成员」按**超集**
理解 —— **任意**【颂乐人偶】成员（含祥子自己）阻挡的敌人，都被并入音符的索敌候选池。

**改动只有一处**：[`battle/main.mjs`](battle/main.mjs) 的 `nearestEnemy`（音符每帧/每 0.4 s 索敌时用的那个函数）。

- **候选池**从「**自身半径 1.0 内**的敌人」扩成「**半径 1.0 内**的敌人 **∪** **被任意成员阻挡**的敌人」；两类合并后
  仍按**原来的规则**取「离音符最近的」一个，`e.hidden` 照旧不可选。被成员阻挡的敌人**不必落在半径内**（阻挡它的
  成员常在别处，音符照样飞过去锁它）—— 这正是本次新增的那一半。
- **阻挡关系取引擎自己的那一份**（`server/sim/battle/blocking.js`）：敌人 `e.blockedBy` 指向阻挡它的我方单位；
  是不是成员用 `roleOf`（五名成员的 chess id）判 —— **不自己重实现阻挡**。
- **未动**（保持既有规则）：
  - **S3 那两对**（`prefer` = 最高法抗 / 最高防御）走 `bestInRange`，仍是 wiki 的「分别追踪法术抗性和防御力最高的
    敌人」，**不加**这条阻挡项；
  - 状态机节拍（0.4 s 状态更新 / 最短自由移动时间 / 追踪↔自由 的切换 / 追踪目标失效后按当前方向重入自由移动）与
    §7.11-I 的「每帧索敌」都**一字未动**；
  - 祥子**自身普攻**的领主行为「**优先攻击自己阻挡的敌人，且不受攻击范围限制**」（PRTS 选择器）本就由**引擎**的
    `Battle.blockedTargets` / `acquireTargets` 承担（DESIGN §20），本次不碰 —— 本改动只落在**包侧自建音符**的索敌上。

**新增测试**：[`app/test/content/avemujica_amoris.test.js`](../../test/content/avemujica_amoris.test.js) 2 条 ——
① 一名**非祥子**成员（若叶睦，阻挡数 2）挡下一个敌人 ⇒ 祥子的音符**锁定了它**，并且锁定时音符与目标相距 **> 1.0**
（在半径之外 ⇒ 只可能靠新规则，而不是「半径内最近」）；② **对照组**：被一名**非** aveMujica 单位（官方重装）阻挡的
同一套场景里，音符**从未**锁定它（它既不在半径内，也不被成员阻挡）。两条都用引擎的真实阻挡关系（敌人出生在阻挡者
的接触半径内，下一 tick 由 `_checkBlock` 记成 `e.blockedBy`），不手写 `blockedBy`。

- `pack.json.version` 1.8.23 → **1.8.24**。

---

## 8. 文件清单

| 目录 / 文件 | 数量 | 关键文件名 |
|---|---|---|
| `pack.json` | 1 | 声明 `content` 5 表、`server.battle` + `server.meta`（`combat: true`）、`client.panels`（`ui/fever.js` 连音符 Fever 进度）、`fx.manifest`、`art`（含 `sfxUnits` 单位战斗音效）、`voices`、`skins`；`overrides` 3 条 `bonds:` |
| `bonds.json` | 1 | `aveMujica` + 3 条官方盟约名册覆盖（`skillfulShip` / `miraShip` / `soloShip`） |
| `chess.json` | 10 | `chess_char_5_25_a/_b`、`5_30_a/_b`、`5_31_a/_b`、`5_32_a/_b`、`6_30_a/_b` |
| `garrisons.json` | 10 | `garrison_180_a/_b`、`181_a/_b`、`182_a/_b`、`183_a/_b`、`164_a/_b` |
| `bands.json` | 1 | `band_wuyouyoumeng` |
| `effects.json` | 1 | `aceffect_band_wuyouyoumeng` |
| `battle/` | 1 | `main.mjs` |
| `meta/` | 1 | `main.mjs` |
| `ui/` | 2 | `fever.js`（客户端面板）、`fever.css` |
| `kits/` | 5 | `chess_char_5_25_a.js`、`5_30_a.js`、`5_31_a.js`、`5_32_a.js`、`6_30_a.js` |
| `assets/` | **1092** | `char/avatar`(10)、`char/portrait`(10)、`skill`(11)、`bond`(1)、`band`(1)、`skin/op`(37)、`spine/op`(27)、`fx`(**896**，官方 prefab + 贴图 + `index.json` / `manifest.json`；含 5 套时装的特效变体，见 §7.12)、`sfx`(25，单位战斗音效)、`voice/jp`(70)、`ui`(2，连音符 `fever_note_empty/full.png`)、`bgm`(2，Fever 音乐 20 秒片段 `killkiss_inst.m4a` / `killkiss_vocal.mp3`，见 §7.16) |
| `README.md` | 1 | 本文件 |
| **合计** | **1108** | — |

---

## 9. 扩展这个包时的约定

- **新增成员**：在 `chess.json` 加 `_a`/`_b` 两条（`bonds` 至少含 `aveMujica`），在 `battle/main.mjs` 的
  `ROLE_BY_CHESS` 里登记 `chessId → 角色`（角色名决定它吃哪条成员特质），并在 `bonds.json` 的
  `members` / `visibleMembers` 里补上 `_a` 的 id；如需专属特质，再写 `garrisonIds` 并在 `garrisons.json` 出条目。
- **新增特质（`garrison`）**：`effectKey` 必须被某个 `registerGarrisonInstaller(key, …)`（`battle/main.mjs`）或
  `registry.garrison(key, …)`（`meta/main.mjs`）接住；后者还要把键写进 `pack.json.server.meta.registers`——
  它既是白名单也是房间摘要闸门的输入，**漏写会导致该特质静默不生效**。
- **新增策略 / 效果**：在 `bands.json` + `effects.json` 写数据，并在 `meta/main.mjs` 用
  `registry.band('<bandId>', …)` 接上处理器，同时更新 `registers`。
- **美术**：盟约图标写 `art.bonds`、分队图标写 `art.bands`（勿与顶层 `bondIcons` 对同一 id 重复声明）；新素材落盘
  见 §7.6 约定。
- **kit**：一个成员一个 `<chessId>_a.js`，只允许 import `@kit/*` / `@sim/` / `@ops/*` 白名单或本包 `kits/` 下的
  相对路径（`./…`，不得含 `..`）；战斗/休整期这种**整场级**逻辑不要塞进 kit，放 `battle/` 或 `meta/`。
- **注意**：本包为**核心盟约**（`SEASON`），改动 `thresholds` / `isCore` 会直接影响引擎的核心盟约抽签与调和规则，
  动手前先核对 `bonds.json` 语法。