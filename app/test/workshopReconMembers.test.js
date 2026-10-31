// 重构盟约（`recon_<官方 id>`）的名册：成员以**棋子自己的 `bonds`** 为准（`shared/workshop.js reconBondMembers`）。
//
// 业主 2026-10-27：「重构的盟约会包含所有拥有该盟约的干员（也包括从 mod 中新增的）」。重构记录是包里的静态 JSON，
// 手抄的名册只会是抄写那一刻的官方名单；另一个包后来新增、却带着同一条官方盟约的干员会缺席 —— 而局内计数读的是
// 棋子自己的 `bonds`，加成给了他却不在名单里。这条测试钉住：合并完所有包后名册按 chess 重算。
//
// 跑法：node --test test/workshopReconMembers.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkshop } from '../shared/workshop.js';

const base = {
  bonds: {
    yanShip: { bondId: 'yanShip', name: '炎', isCore: true, members: ['chess_official'], visibleMembers: ['chess_official'] },
  },
  chess: {
    chess_official: { chessId: 'chess_official', bonds: ['yanShip'], visible: true },
    chess_golden: { chessId: 'chess_golden', bonds: ['yanShip'], visible: true, isGolden: true },
    chess_hidden: { chessId: 'chess_hidden', bonds: ['yanShip'], visible: false },
  },
};

const reconPack = {
  id: 'mode-recon',
  files: {
    bonds: {
      recon_yanShip: {
        bondId: 'recon_yanShip', name: '炎·重构', isCore: true, thresholds: [3, 6, 9],
        // 包里的名册是抄的（只抄到官方那一位）——加载后应按 chess 重算
        members: ['chess_official'], visibleMembers: ['chess_official'],
      },
    },
    // 重构棋子：`recon_<官方 id>` 是覆盖记录（和官方那同一条干员），`recon_<新 id>` 是新增干员 —— 名册要用
    // **正式 id**（client 的 data.lookup 只认正式 id），覆盖记录与官方记录换回同一个 id 后要去重（业主 2026-10-31）
    chess: {
      recon_chess_official: { chessId: 'recon_chess_official', bonds: ['yanShip'], visible: true },
      recon_chess_new: { chessId: 'recon_chess_new', bonds: ['yanShip'], visible: true },
    },
  },
};

test('重构盟约的名册包含所有携带该盟约的棋子（含其它包新增的），并排除黄金形态与隐藏棋子', () => {
  const modPack = {
    id: 'zz-mod',
    files: { chess: { chess_mod: { chessId: 'chess_mod', bonds: ['yanShip'], visible: true } } },
  };
  const { data } = applyWorkshop(base, [reconPack, modPack]);
  assert.deepEqual(data.bonds.recon_yanShip.members, ['chess_official', 'chess_hidden', 'chess_new', 'chess_mod'], '非黄金形态的携带者全在，写正式 id 且去重');
  assert.deepEqual(data.bonds.recon_yanShip.visibleMembers, ['chess_official', 'chess_new', 'chess_mod'], '隐藏棋子不进名册');
  assert.deepEqual(data.bonds.recon_yanShip.thresholds, [3, 6, 9], '其余字段原样保留');
  assert.deepEqual(data.bonds.yanShip.members, ['chess_official'], '官方盟约记录逐字节不动');
});

test('没有 chess 表 / 没有 recon 记录时什么都不改（普通合并逐字节相同）', () => {
  const onlyBonds = { bonds: base.bonds };
  const { data } = applyWorkshop(onlyBonds, [{ id: 'mode-recon', files: { bonds: reconPack.files.bonds } }]);
  assert.deepEqual(data.bonds.recon_yanShip.members, ['chess_official'], '没有 chess 表就不重算');
  const { data: plain } = applyWorkshop(base, []);
  assert.equal(plain.bonds.recon_yanShip, undefined);
  assert.deepEqual(plain.bonds.yanShip.members, ['chess_official']);
});
