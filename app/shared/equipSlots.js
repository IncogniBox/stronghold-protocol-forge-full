// shared/equipSlots.js — 装备格的**容量**：本仓库对官方「每名干员 2 个装备格」的唯一扩展点。
//
// 官方面板是固定 2 格（`data/config.json` `economy.equipPerChess`）。一个内容包可以让某件装备声明
// `params.slot_cap`（哥伦比亚 mod 的**源石辅助仪**：普通 +2 / 进阶 +4），容量对**携带者**叠加：
//
//   capacity = base + Σ(这一点干员携带的每件装备的 params.slot_cap)
//
// 语义（业主 spec，2026-10-11）：
//   * 该装备**自己仍占一格** —— 它不是「不占格」的装备；「装备格+2」是「从 2 格变成 4 格」。
//   * 容量在**判断能否装下这一件**时要把**这一件**算进去：一个 2/2 满格的干员仍然装得下源石辅助仪
//     （装上去之后上限是 4，实际占了 3 格），这正是「满格也能装它」。
//   * 反过来，拆掉一件带 slot_cap 的装备会让上限掉回去，超出的装备按原有规则被替换 / 退回（见调用方）。
//
// 两端共用这一份：服务端 `server/match/gamedata.js equipCapacity()` 与客户端
// `public/js/ui/gameLogic/placement.js` 都调它，容量不可能对不上（`test/match/equipCapacity.test.js`）。

/** 官方基础格数（`data/config.json` `economy.equipPerChess`）；服务端从 config 读，客户端用这个默认值。 */
export const DEFAULT_EQUIP_PER_CHESS = 2;

/**
 * 一件装备声明的装备格加成（`params.slot_cap`），没有 / 不是正数时是 0。
 * @param {any} rec items.json 记录
 * @returns {number}
 */
export function slotCapOf(rec) {
  const v = rec && rec.params && rec.params.slot_cap;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 一个携带者的装备格上限。
 * @param {number} base 基础格数（`gd.equipPerChess`，官方 2）
 * @param {Iterable<any>} items 携带的装备：记录、`{ id }` 零件，或 id 字符串（后者需要 `getItem`）
 * @param {(id: string) => any} [getItem] 把零件的 id 解析成记录（只有 id 会传给它）
 * @returns {number}
 */
export function equipCapacity(base, items, getItem = null) {
  const b = Number.isFinite(base) && base > 0 ? base : DEFAULT_EQUIP_PER_CHESS;
  let extra = 0;
  for (const it of items || []) {
    const rec = getItem ? getItem(typeof it === 'string' ? it : it && it.id) : it;
    extra += slotCapOf(rec);
  }
  return b + extra;
}
