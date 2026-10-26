# TASKS — room.card 打通 + compat 八项审计

对应 spec：`specs/room-card-and-compat-audit/spec.md`

## 实施

- [x] T1 `shared/protocol.js`：C2S 新增 `'room.card': { charId: (v) => v === '' || isCharId(v) }`；不抬 `PROTOCOL_VERSION`。
- [x] T2 `server/lobby.js`：Seat typedef / 分发 / 房态输出 / `humanSeat` / `card()`。
- [x] T3 `public/js/screens/lobby.js`：`room.list` 轮询写 `lobbyStats` + `presence.matchmaking`；无限火力偏好护栏。
- [x] T4 `server/matchmaking.js`：`counts()`；`roomDirectory()` 输出 `matchmaking`。
- [x] T5 新增 `test/lobby-card.test.js`。
- [x] T6 `public/js/ui/accounts.js`：接 `server-ext` 的 `/mod-ws/server-ext/accounts`（lookup + token），顶栏昵称 / #编号 / 头像。
- [x] T7 `public/js/ui/friends.js`：真实好友面板（添加 / 移除 / 在线 / 复制房间邀请）。
- [x] T8 `public/js/ui/achievements.js`：账号侧成就面板。
- [x] T9 `public/js/ui/namecards.js` + `ui/settings.js` + `shared/namecards.js`：官方个人名片 34 主题（`nc00`…`nc33`，美术在 `public/assets/ui/namecard/`），设置里用懒加载缩略图选择。
- [x] T10 `workshop/server-ext/server/accounts.mjs`：`profile` / `namecard` / `friend*` / `achievements`；`lookup` 带 `namecard`；包版本 `2.5.0`。
- [x] T11 `public/js/federation.js`：单节点目录开启（`enabled = true`，`local`）。
- [x] T12 `CHANGELOG.md` 记一节。

## 验证

- [x] V1 `node --check` 全部改动的 JS / mjs。
- [x] V2 `node --test test/lobby-card.test.js` 全绿。
- [x] V3 `node --test test/i18n.test.js` 全绿（新增词条已补 `en.json`）。
- [x] V4 相关 UI 单测（settings-keys / screen-fit / cosmetics-lazy / feedback3-ready）通过。
- [x] V5 `server-ext` 好友 / 名片 / 成就方法内存断言通过（临时脚本已删除）。
- [x] V6 真浏览器：注册/登录 → 顶栏 #编号（测试甲 #1035）→ 设置名片背景 → 建房选名片干员（立绘变更）→ 大厅在线人数 1、成就「入席 / 名片」已完成。
- [x] V7 用 `server/modServer.js`（真机启动方式）在 3910 + 临时状态目录复验；测试服务与临时账号库已删除。正式服务需在无对局时重启。

## 说明

- 现有 `var/mod/server-ext/accounts.json` 未迁移、未改写；新字段在装载时补齐。
- 无限火力仍按能力隐藏（无 `room.setRandom` 与服务端玩法骨架），本次未做。
- 既有 `quickmatch` / `roomList` 测试在本机多包环境下先于本次改动失败（`room.create` 未声 `modIds`），不是本次回归。
