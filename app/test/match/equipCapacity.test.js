// 装备格**容量**（shared/equipSlots.js）：官方 2 格 + 携带装备声明的 `params.slot_cap`（哥伦比亚 mod 的源石辅助仪
// 普通 +2 / 进阶 +4）。服务端 server/match/gamedata.js `equipCapacity()` 与客户端 placement.js / detailPanel.js
// 共用同一份，本文件把两端的判定口径钉住：
//   * 装备自己仍占一格，「装备格+2」是「2 格 → 4 格」；
//   * 判断能否装下**这一件**时把这一件算进容量 —— 2/2 满格也装得下源石辅助仪（装完上限 4、实际占 3）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equipCapacity, slotCapOf, DEFAULT_EQUIP_PER_CHESS } from '../../shared/equipSlots.js';
import { BOND_LAYER_CAP, RECON_BOND_LAYER_CAP, bondLayerCap, layerGainRoom } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';

const ITEMS = {
  plain_a: { id: 'plain_a', itemType: 'EQUIP', tier: 1, params: {} },
  plain_b: { id: 'plain_b', itemType: 'EQUIP', tier: 1, params: {} },
  device_a: { id: 'device_a', itemType: 'EQUIP', tier: 6, params: { slot_cap: 2 } },
  device_b: { id: 'device_b', itemType: 'EQUIP', tier: 6, params: { slot_cap: 4 } },
  zero_a: { id: 'zero_a', itemType: 'EQUIP', tier: 1, params: { slot_cap: 0 } },
};
const gd = new GameData({ items: ITEMS, config: {} }, 'mode_multi_hard');
const piece = (id) => ({ id, uid: id });
const cap = (items, extra = null) => gd.equipCapacity(items.map(piece), extra);

test('重构模拟：每名干员的装备格 +1（官方 2 → 3，与 slot_cap 叠加）；官方对局不变', () => {
  const recon = new GameData({ items: ITEMS, config: {} }, 'mode_recon_abyss');
  assert.equal(recon.equipCapacity([]), 3, '重构对局的基础装备格 = 3');
  assert.equal(recon.equipCapacity([piece('device_a')]), 5, '3 + 源石辅助仪 2');
  assert.equal(recon.equipCapacity([piece('plain_a')], piece('device_b')), 7, '含正落下的那一件（3 + 0 + 4）');
  assert.equal(gd.equipCapacity([]), 2, '官方对局仍是 2 格');
});

test('重构模拟的盟约层数上限是 2000（官方 999）', () => {
  assert.equal(bondLayerCap('mode_recon_abyss'), RECON_BOND_LAYER_CAP);
  assert.equal(RECON_BOND_LAYER_CAP, 2000);
  assert.equal(bondLayerCap('mode_multi_abyss'), BOND_LAYER_CAP);
  assert.equal(bondLayerCap(null), BOND_LAYER_CAP);
  assert.equal(layerGainRoom(1500, 600, RECON_BOND_LAYER_CAP), 500, '到 2000 为止');
  assert.equal(layerGainRoom(1500, 600), 0, '官方 999 早已到顶');
});

test('slotCapOf: only a positive finite slot_cap counts', () => {
  assert.equal(slotCapOf(ITEMS.device_a), 2);
  assert.equal(slotCapOf(ITEMS.zero_a), 0);
  assert.equal(slotCapOf({ params: { slot_cap: -3 } }), 0);
  assert.equal(slotCapOf({ params: { slot_cap: '4' } }), 0);
  assert.equal(slotCapOf({ params: null }), 0);
  assert.equal(slotCapOf(null), 0);
});

test('equipCapacity: base 2 plus every carried slot_cap; a non-positive base falls back to 2', () => {
  assert.equal(DEFAULT_EQUIP_PER_CHESS, 2);
  assert.equal(gd.equipPerChess, 2);
  assert.equal(equipCapacity(2, []), 2);
  assert.equal(equipCapacity(2, [ITEMS.device_a]), 4);
  assert.equal(equipCapacity(2, [ITEMS.device_b, ITEMS.plain_a]), 6);
  assert.equal(equipCapacity(0, [ITEMS.device_a]), 4, 'a missing base still uses the official 2');
  assert.equal(equipCapacity(4, ['device_a'], (id) => ITEMS[id]), 6, 'id strings resolve through getItem');
});

test('the incoming item counts towards its own capacity: a 2/2 carrier still fits a 源石辅助仪', () => {
  // server/match/player/items.js _attach loops while items.length >= equipCapacity(items, incoming)
  const full = [piece('plain_a'), piece('plain_b')];
  assert.equal(gd.equipCapacity(full), 2, 'capacity without the incoming item');
  assert.equal(gd.equipCapacity(full, ITEMS.device_a), 4, 'the device raises the cap as it lands');
  assert.ok(full.length < gd.equipCapacity(full, ITEMS.device_a), '2 < 4 → no replace dialog');
  // a third plain item on a 2/2 carrier still replaces (official behaviour unchanged)
  assert.ok(full.length >= gd.equipCapacity(full, ITEMS.plain_a), '2 >= 2 → the oldest is replaced');
});

test('a carrier wearing the device takes its extra slots, and replaces only past the raised cap', () => {
  const wearer = [piece('device_a'), piece('plain_a')];
  assert.equal(gd.equipCapacity(wearer), 4, '2 + slot_cap 2');
  assert.ok(wearer.length < gd.equipCapacity(wearer, ITEMS.plain_b), '3 < 4 → fits');
  wearer.push(piece('plain_b'));
  assert.equal(wearer.length, 3);
  assert.ok(wearer.length < gd.equipCapacity(wearer, ITEMS.plain_a), '3 < 4 → still fits');
  wearer.push(piece('zero_a'));
  assert.equal(wearer.length, 4);
  assert.ok(wearer.length >= gd.equipCapacity(wearer, ITEMS.plain_a), '4 >= 4 → a 5th replaces');
  assert.equal(gd.equipCapacity(wearer, ITEMS.device_b), 8, 'with the carried device an incoming golden device gives 2 + 2 + 4');
});
