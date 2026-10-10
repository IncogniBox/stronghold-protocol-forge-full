// server/sim/mod/rimbilliton/index.js — 雷姆必拓 mod 的入口（每个 mod 一个子目录，顶层 mod/index.js 聚合）。
// 约定：导出 { kits?, install?, registerMeta? }；kits 在官方 KITS 之后解析。
export { kits, install, registerMeta } from './rimbilliton.js';
