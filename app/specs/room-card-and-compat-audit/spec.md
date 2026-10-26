# SPEC — room.card 打通 + compat 八项审计

日期：2026-10-25
范围：`d:\Ark\Stronghold-Protocol-Forge-0.19.1-0.3.0-win-x64\app`

## 1. 目标

1. 把 `room.card`（名片干员同步）这条服务端通道补全，让同房队友能看到彼此选的立绘。
2. 把 compat 八项（账号 / 好友 / 成就 / 名片 / 联邦 / 匹配 / 皮肤 / 无限火力）逐项核对，指出真实缺口并修掉低风险的部分。

## 2. 审计结论（已核实）

| 功能 | 仓库现状 | 结论 |
|---|---|---|
| 账号 | `public/js/ui/accounts.js` 垫片齐全（`AccountMeChip` / `useAccount` / `AccountTag`）；无账号服务 | 正常关闭，不改 |
| 好友 | `friends.js` 垫片齐全，`openFriends.unavailable = true`，房间按此隐藏「邀请好友」 | 正常关闭，不改 |
| 成就 | `achievements.js` 两个组件返回 `null`，大厅入口不显示 | 正常关闭，不改 |
| 名片背景 | `namecards.js` 的 `NameCardLayer` 返回 `null` | 正常关闭，不改 |
| 联邦 | `federation.js` `enabled = false`、`currentNode = ''` | 正常关闭，不改 |
| 皮肤 | `skins.js` / `skinPicker.js` 是**真实模块**，非垫片；`hasAnySkinChoices` 无皮肤数据时自动隐藏 | 正常，不改 |
| 匹配人数 | 大厅读 `store.presence?.matchmaking`，但**全仓库没有任何地方写入 `presence`**；服务器 `roomDirectory()` 也不提供按难度计数 | 真实缺口（本次只记录，不实现服务端计数） |
| 无限火力 | `shared/randomMode.js` 是垫片（回合数全 0、`unsupported: true`）；入口由 `CAN_FIREPOWER = HAS('room.setRandom')` 隐藏（本服无此消息） | 入口隐藏正确；但旧 localStorage 可把 `lobby.simulation` 落回 `'firepower'`，需加护栏 |
| 大厅统计 | 大厅读 `store.lobbyStats`，但**全仓库没有任何地方写入 `lobbyStats`**；`room.list` 的回执 `room.listed` 恰好是同一形状（`online / roomsCount / matchesCount / rooms`） | 真实缺口：在线人数永远 1、缺人同盟永远空。本次修复 |

额外确认：`room.card` 前端已就绪（`room.js` 的 `CARD_SYNC`、`seatArt.seatPortrait` 会读 `room.state.seats[].card`），只缺协议与服务端。

## 3. 决策

- **D1 消息形状**：`room.card { charId }`，`charId` 只接受 `''`（清空）或 `isCharId(v)`（`shared/protocol.js` 已有导出，同时覆盖官方干员与 `char_x_` 插件干员）。缺字段 / 非字符串 / 形状不符 ⇒ `BAD_MSG`。
- **D2 白名单**：用 `operatorCharIds(this.dataFor(room))`（与本仓库 `room.skins` 同一份来源：有房用房间内容，无房用进程数据）。白名单外的 id ⇒ `BAD_MSG 'unknown operator'`。
- **D3 会话持久**：`session.card` 存在会话上；进房 / 换房都随人走。`humanSeat()` 写入 `card: session.card || null`。
- **D4 房态输出**：只有非空且非 bot 才带字段 —— `...(!s.isBot && s.card ? { card: s.card } : {})`，没选过的房态与从前逐字节相同。
- **D5 纯展示**：比赛中也接受，**不改 ready**。有房间时立即 `broadcastState`；无房间只存会话。
- **D6 前端不改**：`room.js` 已按 `C2S['room.card']` 自动开启同步与提示文案。
- **D7 大厅统计**：大厅挂载时及每 10 秒请求一次 `room.list`，把回执写进 `store.lobbyStats`（`store` 从 `public/js/store.js` 导出，`store.set(patch)` 已存在）。联邦模式分支保持原样。
- **D8 无限火力护栏**：`lobbySimulationPreference()` 在 `!CAN_FIREPOWER` 时不允许返回 `'firepower'`，避免旧偏好落到一个没有入口的模式。
- **D9 匹配人数不实现**：按难度排队人数需要服务端新增计数（`MatchmakeQueue` 内部状态 → `roomDirectory`），本次只记录为待办，不改服务端队列。

## 4. 改动清单

### 4.1 `shared/protocol.js`

在 `C2S` 的 `'room.appearance'` 之前（或 `'room.skins'` 旁边）新增：

```js
// 名片干员（room.card）：纯展示，`''` = 用「按 playerId 分配」的默认立绘。
// 形状层只认 charId；「这个 id 本房有没有」由 server/lobby.js 的 card() 裁决。
'room.card': { charId: (v) => v === '' || isCharId(v) },
```

`PROTOCOL_VERSION` 不动（新增 C2S，老客户端一个字节都不发）。

### 4.2 `server/lobby.js`

1. `Seat` typedef（约 291–303 行）补 `card?: string | null`。
2. `handleMessage()`（约 1133 行）在 `room.appearance` 之后加：
   ```js
   case 'room.card': return this.card(session, msg);
   ```
3. `toState()` 的 seats 映射（约 611–620 行）加：
   ```js
   ...(!s.isBot && s.card ? { card: s.card } : {}),
   ```
4. `humanSeat(idx, session)`（约 3023 行）返回值加 `card: session.card || null`。
5. `appearance()` 之后新增处理器：
   ```js
   /**
    * room.card { charId }: 名片干员（纯展示）。`''` = 清空，回到「按 playerId 分配」。
    * 只接受本房内容里的干员；比赛中也接受；绝不改 ready。
    */
   card(session, { charId }) {
     const id = charId || '';
     const room = this.roomOf(session);
     if (id && !operatorCharIds(this.dataFor(room)).has(id)) return fail(ERR.BAD_MSG, 'unknown operator');
     session.card = id || null;
     const seat = room ? room.seatOf(session.playerId) : null;
     if (seat && seat.card !== session.card) { seat.card = session.card; this.broadcastState(room); }
     return OK;
   }
   ```

### 4.3 `public/js/screens/lobby.js`

1. 取得 `store`：`import { store } from '../store.js';`（按该文件现有 import 风格合并）。
2. 在读取 `lobbyStats` 的大厅组件里（约 1124 行附近）新增一个 effect：挂载即请求、之后每 10 秒一次：
   ```js
   useEffect(() => {
     let stop = false;
     const tick = () => { if (!stop) net.request('room.list').then((r) => {
       if (!stop && r && typeof r.online === 'number') store.set({ lobbyStats: { online: r.online, roomsCount: r.roomsCount, matchesCount: r.matchesCount, rooms: r.rooms } });
     }).catch(() => {}); };
     tick();
     const id = setInterval(tick, 10_000);
     return () => { stop = true; clearInterval(id); };
   }, []);
   ```
   `federationEnabled` 的既有分支保持不动（联邦时仍用 `room.list` 直接 setData）。
3. `lobbySimulationPreference()`（约 178 行）：在返回前加
   ```js
   if (!CAN_FIREPOWER) return 'coop';
   ```
   （`CAN_FIREPOWER` 在同文件 60 行，已定义。）

### 4.4 测试 `test/lobby-card.test.js`（新增）

以包内 `optional/room-card/test/lobby-card.test.js` 为底本，改 import 前缀：

- `../server/index.js`、`../server/match/StubMatch.js`、`./helpers/wsClient.js`、`../shared/constants.js`、`../shared/protocol.js`、`../data/chess.json`（本仓库 `app/test/` 为根）。
- 断言保留：形状校验、进房带卡、队友可见、变更广播、未知 id ⇒ `BAD_MSG`、`''` ⇒ 字段消失、ready 不被打断、服务端无 error 日志。

### 4.5 `CHANGELOG.md`

未发布节新增一小节「房间：名片干员同步（room.card）」，写明协议 / 服务端 / 前端零改动 / 大厅统计修复 / 无限火力护栏，以及「匹配人数仍不可用（服务端无计数）」。

## 5. 不做的事

- 不接账号 / 好友 / 成就 / 名片背景服务，不伪造数据。
- 不新增 `room.setRandom` / `room.setPrivate` / `room.setMaxSeats`；无限火力与私密房继续按能力隐藏。
- 不改 `MatchmakeQueue`，不新增 `presence.matchmaking` 计数。
- 不替换 `ui-package-20261014` 的 payload（已确认是我们 UI 的旧快照）。

## 6. 验证

1. `node --test test/lobby-card.test.js` 全绿；再跑 `node --test test/lobby.test.js test/ui/feedback3-ready.test.js`（若存在）确认无回归。
2. `node --check` 三个改动文件。
3. 真浏览器双窗口（同一本机端口）：
   - A 建房，点自己的席位卡选干员 → B 加入后立刻看到 A 的立绘；
   - B 选另一名干员且已 ready → A 看到立绘变化、B 仍是「已就绪」；
   - B 选「默认」→ A 的席位回到按 playerId 分配的立绘；
   - 控制台无报错。
4. 大厅：在线人数 / 缺人同盟列表在 10 秒内随房间创建与解散变化；无限火力入口仍不出现。
5. 服务端必须**重启**才生效：实现与本地测试完成后，若无对局则重启本机服务；线上由用户挑无人对局时段重启。

## 7. 批准

实现前需用户确认本 spec（特别是 D7 大厅轮询、D9 匹配人数暂不做）。
