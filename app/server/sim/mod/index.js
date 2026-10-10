// server/sim/mod/index.js — the content-pack / mod sim entry (docs/PACKS.md "mods"): one conventional module the
// content loader (content/index.js) imports — served to the browser with the rest of /sim/, so client-side combat runs
// the mod too.
//
// 多 mod 聚合入口：每个 mod 一个子目录 server/sim/mod/<modId>/（入口 <modId>/index.js，导出 { kits?, install?,
// registerMeta? }）。本文件把全部已注册 mod 聚合成一个视图：
//   kits        各 mod 的 kit 注册表合并（不同 mod 用不同 baseChessId，不冲突；同 key 后者覆盖）
//   install     每场战斗逐个调用各 mod 的 install
//   registerMeta 休整期逐个调用各 mod 的 registerMeta
// 新增一个 mod：新建 server/sim/mod/<modId>/（内容走扩展点追加注册），再在下方 MODS 列表加一行。
// 浏览器安全：聚合器只做静态 import（不依赖 node:fs / 运行时扫描目录），/sim/ 一并服务给浏览器，客户端战斗同样跑 mod。
// 无 mod 安装时本文件不存在 —— content/index.js 的 safeImport 载入空模块，行为与官方一致。

async function safeImport(path) {
  try {
    return await import(path);
  } catch (e) {
    console.error(`[content] failed to load mod ${path}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    return {};
  }
}

/** 已注册的 mod 入口（每个元素导出 { kits?, install?, registerMeta? }）。新增 mod 时在此追加。 */
const MODS = [
  await safeImport('./rimbilliton/index.js'),
  await safeImport('./ave-mujica/index.js'),
];

/** 各 mod 的 kit 注册表合并（baseChessId → (bb, chess, def) => Kit，官方 KITS 之后解析）。 */
export const kits = Object.assign({}, ...MODS.map((m) => m.kits ?? {}));

/** 每场战斗的额外安装：逐个调用各 mod 的 install。 */
export function install(battle) {
  for (const m of MODS) {
    if (typeof m.install !== 'function') continue;
    try { m.install(battle); } catch (e) { battle._handlerError?.('content:mod', null, e); }
  }
}

/** 休整期处理器的注册（server boot 时由 content/index.js registerAllMeta 调用）。 */
export function registerMeta(registry) {
  for (const m of MODS) {
    if (typeof m.registerMeta !== 'function') continue;
    try { m.registerMeta(registry); } catch (e) { console.error('[content] mod.registerMeta failed:', e); }
  }
}
