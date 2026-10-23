# 16 · AUE 对照 oracle 对拍报告（方案 B 落地）

2026-10-22。用 Arknights-Universal-Engine（AUE，pin 上游 SP v0.3.1）的差分测试对拍**本工作区**
（Forge 0.19.1，上游 game 0.3.0 基座 + 本地改动）。结论先行：

> **纯函数域零逻辑分歧。** 662 条差分属性里 656 条直接通过；6 条失败的根因全部是
> 本 forge 把棋盘从 19×21 扩到 **45×60**（`server/sim/constants.js`）——同一份逻辑吃不同常量。
> 把对拍放到同尺寸棋盘上重跑，**6/6 全绿**。

## 1. 工具链落位

| 件 | 位置 |
|---|---|
| AUE 克隆（浅克隆，pin `cd76522`） | `d:\Ark\tools\aue`（仓库外，工具目录） |
| 依赖 | `npx pnpm@11.28.0 install`（README 自带方案；Node 24 ✓） |
| 上游 oracle | `pnpm exec aue-check oracle` → `.cache/oracle/stronghold-b3deebdae4a9`（SP v0.3.1，`b3deebda`） |
| 指向本工作区 | 环境变量 `AUE_STRONGHOLD_DIR=d:\Ark\Stronghold-Protocol-Forge-0.19.1-0.3.0-win-x64\app` |
| 本地补丁 | `packages/testkit/src/oracle.js` 的 `loadOracle`：`AUE_STRONGHOLD_DIR` 覆盖时**跳过 pin-sha 校验**（否则只认 v0.3.1 的 HEAD）。这是对拍本地 fork 的必要开关，勿回传上游 |

## 2. 结果

**基线**（对 pin 的上游 v0.3.1）：`node --test packages/{math,sim,simcheck}/test/*.test.js` → **662/662 全绿**（AUE 自家 CI 的口径，工具链可信）。

**对拍本工作区**（`AUE_STRONGHOLD_DIR` 指向我们的 app）：**656/662，6 失败**，全部集中在三个域：

| 失败条款 | 测试 | 失败形态 | 归因 |
|---|---|---|---|
| 体积-1/2（occupied tiles） | body.test.js:21 | key `[0,21]` vs 期望 `[0,60]` | 列数 60 vs 21：key = `row×COLS+col`，**常量不同** |
| 体积-1（halfway 取整） | body.test.js:34 | key `242` vs `86` = `4×60+2` vs `4×21+2` | 同上。**不是** DIF-0003 复发——我们的 body.js 本来就用 `roundHalfEven` |
| 体积-4（Chebyshev reach） | body.test.js:51 | 同类 | 同上 |
| 寻路-1/2（flow field） | paths.test.js:32 | dist/next 形状不一致 | oracle `Grid` 构造器**无视传入边界、直接读模块常量** `ROWS/COLS`（grid.js:151-152）——我们的 45×60 流进逐字节相同的 grid.js |
| 索敌-1（range key set）×2 | targeting.test.js:46,57 | key 集合数值不同 | 同上：`absoluteRangeKeys` 用模块常量算 key，`rangeKeys` 用测试给的 G（21 列） |

关键事实：我们工作区与 v0.3.1 oracle 的 `server/sim/` 逐文件 MD5 对比，**grid.js 与 targeting.js 逐字节相同**；
diff 的文件只有 `ai.js / Battle.js / buffs.js / constants.js / damage.js / groundPaths.js / simdata.js / snapshot.js / spec.js`
（forge 的行为层与数据面改动），其中被差分测试覆盖的纯函数域（body/grid/targeting/detmath）里只有 constants.js 不同。

**同尺寸复测**（`d:\Ark\tools\aue\scratch-equalized.test.js`，把 AUE 侧的 G 换成 45×60、跑同样的生成器与种子 20261011）：
**6/6 全绿**——bodyKeys/bodyOnTile/bodyInKeys/hitRect/halfway/bodyTileReach/flowField/rangeKeys 与我们**逐位一致**。

## 3. 结论与口径

1. **可引以为傲**：AUE 用几百条随机属性（fast-check，各 1500–4000 runs）对拍上游 SP 的 body/寻路/索敌/确定性数学——
   我们工作区在这些域与 AUE 的官方口径实现**无分歧**，且顺带验证了 forge 的 45×60 扩展棋盘没有破坏这些纯函数。
2. AUE 登记表的 37 条 known-differences 是「AUE ↔ 上游 v0.3.1」的账；本报告是「AUE ↔ Forge 0.19.1」的账：
   净差异 = 棋盘几何（有意）+ 上表之外的 forge 行为改动（不在差分覆盖面，走我们自己的测试体系）。
3. 662 条里未覆盖的域（damage 只有穿透公式、combat/buffs/status 等）——AUE 的差分面目前就这些；
   它们的 spec 条款（见 [15-aue-spec-index.md](15-aue-spec-index.md) §2）仍是核对依据。

## 4. 重跑方法

```powershell
cd d:\Ark\tools\aue
# 基线（上游 v0.3.1）：
node --test (Get-ChildItem packages/math/test,packages/sim/test,packages/simcheck/test -Filter *.test.js | % { $_.FullName })
# 对拍本工作区（45×60 失败是预期；同尺寸复测见 scratch）：
$env:AUE_STRONGHOLD_DIR = "d:\Ark\Stronghold-Protocol-Forge-0.19.1-0.3.0-win-x64\app"
node --test (Get-ChildItem packages/math/test,packages/sim/test,packages/simcheck/test -Filter *.test.js | % { $_.FullName })
node --test scratch-equalized.test.js
```

`scratch-equalized.test.js` 就是「同尺寸对拍」的可重跑载体——上游大版本更新后，先把这里的常量对齐新棋盘再跑。
