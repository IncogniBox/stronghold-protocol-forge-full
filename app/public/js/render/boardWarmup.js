// render/boardWarmup.js — 对局前的棋盘素材预热（业主 2026-10-31：地图资源进对局才开始拉，看着慢）。
//
// 战场视图（render/app.js createFieldView）是在**进入对局**那一刻才开始下载棋盘贴图与 3D 棋盘包的，而
// 房间 → 简报 → 预重构 → 首轮准备本来就是一段空闲窗口：玩家在这段时间里并没有在看棋盘。这里在房间界面挂载时
// 就用同一套加载器开始下载，进战斗时直接命中页面级缓存 —— boardArt.js 的 `cached`、board3d/load.js 的 `packs`
// 都是页面级、幂等的，render/app.js 再问一次时拿到的是同一个 promise，不会下载第二遍。
//
// 顺序：先 2D 棋盘图集（6 张贴图约 1.7 MB，3D 棋盘包的 D 用的也是这一张），再 3D 棋盘包（只有 WebGL2 才有）。
// 2D 先到 ⇒ 万一 3D 包还没齐，战场画的是已经就绪的 2D 棋盘，而不是空板。
//
// 预热是可选的：任何一步失败都只是让这里停下来（进战斗时照旧按需下载），绝不影响界面。

let warm = null;

/**
 * 预热棋盘素材，整页一次（幂等）。从不 reject。
 * @param {any} [store] 资源 store（缺省是页面的 public/js/assets.js 单例；测试用它注入假的 store）
 * @returns {Promise<void>|null}
 */
export function warmBoard(store) {
  if (warm) return warm;
  warm = (async () => {
    try {
      // 省流模式（navigator.connection.saveData）不预热：这不是界面必需的东西，留给进战斗时的按需下载
      if (globalThis.navigator?.connection?.saveData) return;
      const [{ assets }, { loadBoardArt }, { boardArtListed, loadBoardPack, loadThree, webgl2Available }] = await Promise.all([
        import('../assets.js'),
        import('./boardArt.js'),
        import('./board3d/load.js'),
      ]);
      const m = store || assets;
      if (!m || typeof m.local !== 'function') return;
      if (!(await boardArtListed(m).catch(() => false))) return;
      const art = await loadBoardArt(m).catch(() => null);
      if (!art || !webgl2Available()) return;
      // three.js（本地 vendor，同源）与棋盘包的贴图/网格并行；两者都是页面级缓存
      await Promise.all([loadThree().catch(() => null), loadBoardPack(m).catch(() => null)]);
    } catch { /* 预热失败只意味着进战斗时还要再等一次 */ }
  })();
  return warm;
}

/** Forget the warm-up (tests / hot reload). */
export function resetBoardWarmup() { warm = null; }
