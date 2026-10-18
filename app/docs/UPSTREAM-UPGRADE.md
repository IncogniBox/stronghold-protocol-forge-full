# 上游更新校对清单

> 用途：**原项目发布新版本后**，照这份单子走一遍，就能找齐所有「会被上游改动打断」的地方。
> 本文只讲**怎么核对与怎么修**，不讲设计（设计在 `docs/design/mod-layer.md` 与 `docs/MOD-SURFACE.md`）。
>
> 一句话原则：**契约面（规范）上游会照顾我们；引擎内部（实现）我们自己盯。**
> 前者动一下会进上游 CHANGELOG，后者挪个文件就可能让包装不上。

---

## 0. 先跑一条命令

```powershell
npm run ci
```

六步里会红给你看的东西（都不需要人去找）：

| 步骤 | 会抓到什么 | 名字长什么样 |
|---|---|---|
| `test` | 白名单别名指向的文件不见了 | `@kit/tier2.js → …/tier2.js 不存在` |
| `test` | 具名组件枚举与客户端的 `modComponent(id, …)` 漂移 | `CLIENT_WRAP_UNKNOWN_COMPONENT` |
| `test` | 表面清单里的锚点符号被改名/挪走 | `表面 "…" 锚在 X 上，但 Y 不再导出这个名字` |
| `imports` | 跨层 import 越界（`shared/` 不许引 `server/`） | 逐条点名 |
| `typecheck` | 上游改了签名而我们还在旧写法 | `tsc` 报点 |
| `lint` | 该走 `t()` 的字面量、`server/sim/` 里出现时钟/随机 | 逐条点名 |

**拦住「已装的 mod 会不会重置」的正是第一行那条**（见 §2）。

---

## 1. 契约面（11 个文件）：上游会照顾，我们只读

这 11 个是**两边共同的规范**，上游动它们会进 CHANGELOG：

| 文件 | 它是什么 |
|---|---|
| `shared/protocol.js` | 线上消息契约 |
| `shared/constants.js` | 阶段、错误码、`MOD_API_VERSION` |
| `shared/packs.js` | 包类型表 |
| `shared/i18n.js` / `shared/i18nPacks.js` | 界面词条 |
| `shared/modIdentity.js` | 房间身份与摘要 |
| `shared/diy.js` | 自选池记录 |
| `shared/support.js` | 助战目录 |
| `shared/packs` 的三个同族文件 | 见 `npm run ci` 的 imports 步骤 |

**核对方式**：看上游 CHANGELOG 有没有改这 11 个；有，就逐条读它改了什么形状。

**什么时候抬 `MOD_API_VERSION`**：只有「**契约语义变了、没有别名可对**」才抬
（比如 kit 函数的签名变了、效果注册表的形状变了）。抬了老包会**响亮地被拒**（`MOD_API_INCOMPATIBLE`）——
这是对的，**不能悄悄跑错**。

**加一个能力永远不抬版本**：`docs/MOD-SURFACE.md` 的版本政策写死了这一条，所以 `ctx.me`、宿主键、
表面清单加行这些**加法**不会让已发布的包失效。

---

## 2. 引擎内部（会打断包的地方）

上游**挪文件 / 改名**是最常见的一类改动，而它对包的影响只经过下面这几个口子。**改这里，包不动、mod 不重置。**

> 2026-10-12 起：三个 bundled 包（ave-mujica / rimbilliton / columbia）的**全部行为代码**都在包内
> （`workshop/<包>/battle/*.mjs` 战斗逻辑、`workshop/<包>/meta/*.mjs` 休整期、`workshop/<包>/kits/*.js` 干员/召唤物 kit）。
> 引擎里**不再有** `server/sim/mod/`，也不再有任何 mod 专属的挂载点 —— 包只经由官方通道
> （`kits/` / `pack.json.server.battle` / `pack.json.server.meta`）接进对局。所以下面这几处**都是通用契约**，
> 上游改它们才会打断包。

### 2.1 白名单别名（最常见，只改一行）

`shared/kitImports.js` 的 `KIT_IMPORT_FILES`：`@kit/`（tier1..6 + summoner）、`@sim/`（constants / dir / targeting）、
`@ops/`（官方 op kit，包 kit 可复用：shwaz / ray / aglna2 / thumpy / aphris / nasti / jesca2 / heyak）、
`@battle/`（`index.js` → `server/sim/content/support/index.js`，`mod.js` → `server/sim/content/support/mod.js`）。

**上游把某个文件挪走时**：改**这一行**的目标。包的源码**一个字节都不用动**，mod 作者什么也不用改，玩家不用重装。

**实测证据**（把 `tier2.js` 改名模拟上游挪文件）：

- 守卫报「白名单里指向缺失文件的条目 = 1」⇒ CI 期就红；
- 一个用到它的包装载时得到 `KIT_IMPORT_FAILED`，**点名是哪个包的哪个 kit**；
- 那条别名重指之后，同一个包原样能跑。**⇒ 不需要重置。**

### 2.1b 包侧 SDK 的注册面与 `META_API`（上游改导出名会打断包）

包靠两组**具名导出**把行为接进官方表；`test/kitImports.test.js` 的「导出名下限」守卫逐条钉着它们，
删名 / 改名就红：

- `server/sim/content/support/mod.js`（`@battle/mod.js`）再导出的 `registerBondInstaller`（`bonds/core.js`）、
  `registerGarrisonInstaller` / `registerGarrisonReader` / `byUnit` / `fireGain` / `garrisonIdsOf`
  （`garrisons/battle.js`）、`registerItemBehaviour` / `bp` / `isProc` / `procTags` / `memberOf` / `addShieldLayer`
  （`items/battle.js`），以及 `reached` / `onLayers` / `onUnitDamaged` / `isEnemyTarget` / `ownTag` / `bondBb`。
- `server/match/metaPack.js` 的 `META_API`：`num` / `bondRecord` / `itemRecord` / `garrisonRecord` / `bandRecord` /
  `effectRecord` / `buffsOf` / `buffParams` / `itemKeyOf` / `isGoldenId`，以及休整期读法
  `ids` / `bondOrder` / `chessOnBoard` / `metaBonds` / `frontPiece`。

### 2.1c 通用能力（引擎里的“开口子”，包依赖它们的语义）

- `shared/equipSlots.js`：装备 `params.slot_cap` → 装备格容量（源石辅助仪的 +2 / +4）。
- `ctx.pieceData` / `ctx.setPieceData`：休息期把数据挂在棋子上、随战斗输入进 `u.pieceData`（源石辅助仪的继承）。
- `server/sim/content/support/index.js unitBonds`：读 `u.pieceData.bondGrants`（继承来的盟约计入成员）。
- 休整期注册表的 `onBondChange` / `onBondActivate`：编队变化当帧 / 首次激活的钩子。
- `shared/workshop.js` / `server/workshop.js` 的 `stripDiyOverlaps`：把包内干员从自选池摘除。
- `battle._rbAmplifiers` / `battle.rbAddGarrison`（`garrisons/battle.js`）：特质放大器与战斗内追加特质。
- **战斗 → 休整期的通用标记通道**：战斗侧 `support/index.js setBattleMark(battle, pid, key, value)` →
  `BattleResult.perPlayer[pid].marks` → `compactResult`（`server/sim/spec.js`）→ `shared/protocol.js RESULT_LIMITS.marks`
  / `isBattleResult` → 客户端回传时 `server/match/fields.js validateClientResult` 保留 → `server/match/match/combat.js
  _finishCombat` 收进 `ps.marks` → 休整期 `ctx.mark(key)`（`server/match/effectsMeta.js`）读。改这条链上的任何一处
  都会让「战斗结果带到下一次休整期」的包级效果静默失效（雷姆必拓 安洁莉娜/暴行、哥伦比亚 卡夫卡都靠它）。
- **部署侧两个环境开关**（上游官方包都没有，重跑上游文件后要重新打上）：
  * `SP_ASSET_CDN`（`server/http/static.js`）：把 `data/assets.json` / `local-assets.json` / `emotes.json` 响应里的素材地址
    改写成 CDN 绝对地址（只在响应层，磁盘不动）。两张映射：`/assets/…`、`/fonts/…` → `<base>assets|fonts/…`（官方素材）；
    `/workshop-assets/<pack>/<rel>` → `<base>packs/<pack>/<rel>`（包自带素材，落在 `packs/<pack>/…` 命名空间下，避开官方键）。
    丢了它 = 素材回落到本机上行。
  * `SP_WS_COMPRESSION=on`（`server/wsCompression.js` + `server/http/websocket.js`）：开启 WS 链路压缩
    （白名单 + 12 位窗口 + 512 字节阈值）。丢了它 = 稳态上行回到 ~4× 未压缩。

### 2.2 具名组件枚举（少见）

`shared/workshop.js CLIENT_WRAP_COMPONENTS` 的 10 个 id：`game.bondStrip` / `game.hud.topBar` /
`game.shopCard` / `loadout.detail` / `lobby.modPicker` / `lobby.modManager` / `room.modManager` /
`briefing.bonds` / `briefing.banned` / `sweep.bonds`。

每个 id 在 `public/js/**` 里正好**一处** `modComponent('<id>', impl)`。上游改组件名 ⇒ 两边一起改。
有一条守卫盯着「枚举里的每个 id 在客户端真的有实现」。

### 2.3 宿主与挂载点（十个槽位）

`CLIENT_PANEL_SLOTS` 指向的十个宿主容器（`[data-mod-slot]`）。上游改动对局屏结构 ⇒ 核这十个还在不在
（前四个是引擎按需创建的浮层，后六个由组件自己渲染：`screens/game.js`、`ui/bondStrip.js`、`ui/detailPanel.js`、
`ui/shopBar.js`、`screens/room.js`）。
**注意**：注入面**刻意**不给 store / 对局对象 / battleRunner（面板可以画错，但不能算错）——
不要因为上游改了内部结构就顺手把这些开出去。

### 2.4 表面清单

`shared/modSurface.js` 的 24 行 + `docs/MOD-SURFACE.md`。加即可，删/改名才抬版本。

---

## 3. 复算性：改完必须还能比

- `npm run golden` 六份语料必须**全 match**（`roster` / `bonds` / `fields` / `matches` / `standins` / `diy`）。
- **有意改动玩法**才跑 `npm run golden:update`，而且**同一次提交**里点名每一个移动的场景与理由
  （`AGENTS.md` 的硬规则）。上游更新本身**不该**让 golden 移动 —— 移动了就说明我们误改了行为。

---

## 4. 上游更新时的执行顺序（建议）

1. `git fetch` 上游，读它的 CHANGELOG / DESIGN 版本行。
2. 合进来（或重新对齐），先解冲突 —— 冲突几乎总在**契约面**那 11 个文件上。
3. 跑 `npm run ci`：第 0 节那张表会点名所有断掉的地方。
4. 断在白名单 ⇒ 照 §2.1 改一行。断在组件枚举 ⇒ 照 §2.2 改一行。
5. 跑 `npm run golden`：**应当全 match**。有移动 ⇒ 停下来查是我们误改还是上游真改了玩法。
6. 用 `_up/mod-compat/out/verify-both-packs.mjs` 把两个第三方 mod 真装一遍（0 拒绝 + 面板/kits 都挂上）。

---

## 5. 明确**不**做的两件事（避免以后有人重新提议）

- **不做就地补丁分发**（让包去改引擎文件）。它会换掉「多 mod 共存 / 升级不冲突 / 成绩可复算」三样，
  而那三样正是这个工坊存在的理由。详见 `_up/mod-compat/deliver/说明/改引擎与工坊支持.md`。
- **不做适配层**（把 20 个依赖收成一层 `modHost`）。收益只是「我们少改几行」，代价是多一层可能撒谎的间接；
  真正的升级成本是 §2 那四处的**几行**，而且已经有守卫盯着。
