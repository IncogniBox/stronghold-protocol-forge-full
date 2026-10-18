# 干员冲突兼容（Operator Conflict）— 前置包与接口说明

本包 `workshop/operator-conflict/` 是**「同一个 id 被两个包各贡献一份」这件事的公共层**：它自己**不含**任何干员、
素材或代码，只声明这一层已经就位。它要解决的是一件很具体的事：

> A 模组新增了一个阿米娅、B 模组也新增了一个阿米娅 —— 合并层按包 id 字典序只留一个赢家（`PACK_ID_COLLISION`），
> 输的那一份**整个丢掉**。一份合并结果是对的（客户端与服务端都只看得见一份），但玩家从此**不知道还有另一份**。

装上本包之后，丢掉的那几份被保留下来，干员界面（干员调配 → 干员详情）出现一排**「数据来源」按钮**：这个干员本局
用哪个模组的那一份数据。选择**按玩家**生效 —— 同一个干员在不同玩家的棋盘上可以是不同的一份。

---

## 0. 为什么界面与协议在**引擎**里，不在这个包里

一个包能做两件事：**声明数据 / 素材**，以及**改写引擎已经具名的组件与槽位**（`pack.json.client.panels[].wraps`）。
它**不能**做第三件事：**发一条会改变对局状态的消息**。

证据在引擎里写得很直白 —— `public/js/ui/extensions.js`：

```js
export const PANEL_SEND_TYPES = Object.freeze(['room.appearance']);
```

这是一张**闭合的白名单**，只收录**纯显示**的消息（`room.appearance` 是外观选择：谁的棋子画成谁的皮肤，不改任何
对局数据）。那张表旁边的注释就是这条纪律本身：「面板能改对局状态的那一天，就是这一层失效的那一天」。

而「这个干员本局用哪一份记录」**是**对局状态：它决定服务端派哪一个棋子、走哪一套数值、客户端画哪一份记录。所以
它必须走引擎自己的 C2S 通道（`room.conflict`），由引擎的干员界面画那排按钮。**这不是偷懒，是能力边界。**

于是本包是一个**声明 + 说明**型的包（与 `workshop/side-story/` 同一形态）：
`pack.json` 声明一条 `notices`（包要么带来内容、要么带来声明，不然会被判成空包 `EMPTY_PACK`），外加这份 README。

---

## 1. 引擎侧的四条轨道（本包依赖的全部）

| # | 在哪 | 干什么 |
|---|---|---|
| ① | `shared/workshop.js`（`applyWorkshop`） | 合并时把**输家那一份**留下来：`data.workshopConflicts = { [file]: { [id]: { winner, packs: [{ pack, record }…] } } }`。`packs[0]` 恒是赢家（「今天实际生效的那一份」）；覆盖官方 id 的那种情况下，输家的候选是**官方 + 它那条补丁的合成体**，不是一条缺一半字段的补丁。**没有冲突就不设这个键** —— 一份普通的合并结果与从前逐字节相同。 |
| ② | `shared/protocol.js` | `room.conflict { picks }`：`{ [chessId]: packId }`，结构上限 `CONFLICT_LIMITS.picks = 64`。判据 `checkConflictPicks` **宽松**：挑了一个这局数据里没有的冲突、或一个没贡献过这条记录的包，**逐项丢掉**，绝不让整条消息变成 `BAD_MSG`（一个过期的选择不该把玩家别的选择一起废掉）。 |
| ③ | `server/lobby.js` + `server/net.js` | 收到 `room.conflict` 就把它存在会话与座位上（与 `room.loadout` / `room.ownership` / `room.diy` 完全同轨）；一局开始取座位上的那一份。对局中改只存给下一局（回 `ROOM_STARTED`，客户端提示「修改将在下一局生效」）。`'room.conflict'` 进了 `HEAVY_TYPES`（与其它三条同类消息一样计费）。 |
| ④ | `server/match/player/conflict.js` + `server/match/PlayerState.js` | 对局内按玩家换记录：`conflictGameData(gd, records)` 是又一层 `Object.create(gd)` 视图，`view.chess(id)` 返回**这个玩家**挑的那份记录，其余查询落到比赛那一份。它是引擎里**唯一**的组装点（`rebuildPlayerView`：DIY 先叠、冲突后叠，后叠的赢），所以两条设置各自改动都不会把对方的视图冲掉。 |

只读的那条 HTTP 路由：`GET /workshop-conflicts.json`（`server/http/routes.js`，`server/index.js` 接线）——
它只回答「有什么可挑」；**选择本身走 WebSocket**。没有冲突时 body 是 `null`（不是 `{}`）：「这台服务器上根本没有
冲突」与「有冲突但列表是空的」不是同一件事。

客户端那半在引擎里（`public/js/ui/conflictModel.js` 纯逻辑、`ui/loadoutSync.js` 的记忆与同步、
`screens/loadout.js` 的那排按钮、`css/screens/loadout.css`）；每浏览器的选择存在 localStorage（`sp.pref.conflict`）。

---

## 2. 拿到这个包之后，别的包要做什么

**什么都不用做。** 冲突本身是「两个包都写了同一个 id」的自然结果，引擎自己会认出来。作者唯一需要知道的是：

- 撞了同一个 id 时**不会**变成「两个都生效」—— 仍然是字典序小的包赢（既有裁决，DESIGN §28.3），报告里照样点名
  `PACK_ID_COLLISION`。装上本包以后，多出来的只是「玩家可以改选输家那一份」。
- 如果你**不希望**别人改选，就别让两个包撞同一个 id（换一个 id，或让其中一个包在自己的 `chess.json` 里用
  `overrides` 声明覆盖官方记录 —— 那是**另一条**通道，不产生冲突索引）。

---

## 3. 边界（这一层**不**做的事）

- **不改合并规则**：赢家仍是字典序小的包 id，报告一字未改。
- **不做数值融合**：两个候选就是两份**完整的**记录，选哪一份就是哪一份，不会把「A 的攻击 + B 的生命」拼起来
  —— 拼法没有正确答案，猜一个就等于替玩家做了一个会影响对局的决定。
- **不改官方数据**：只有**包与包**撞同一个 id 才产生冲突。一个包覆盖官方记录（`overrides`）依旧照既有规则合并。
- **不影响棋子的身份**：换的是「这一条记录的身体」（数值 / 技能 / 天赋），棋子 id、盟约、阶级、价格与合并规则都
  还是同一条 —— 与「补位」那条通道（`shared/standIn.js`）同一条「身份归棋子、身体归记录」的分界。
- **服的还是这一局的数据**：候选只在**这一局实际的合并结果**里成立（`checkConflictPicks` 读本局数据），所以换了
  包、换了版本之后过期的选择会被丢掉，而不是让这一局拿到一份数据里根本没有的记录。
