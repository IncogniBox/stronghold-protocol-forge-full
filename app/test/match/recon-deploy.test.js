// 45×60 重构战场的**部署合法性**：客户端的 canPlace 镜像（ui/gameLogic/placement.js）必须与服务器在同一格上
// 一致。业主 2026-10-26「可以拖动了，但是无法部署到场上，会弹出黄框提示『无法部署到此位置』」：
// 双半场普通带（normalL / normalR）在 placementContext 里被当成 'normal' 读 `deployTiles.normal`，而这张图只有
// `normalLeft` / `normalRight`，于是客户端部署集为空 —— 服务端接受、客户端全拒。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boardRectOf } from '../../shared/layout.js';
import { makeMatch } from './harness.js';
import { placementContext, canPlace } from '../../public/js/ui/gameLogic/placement.js';

/** A recon match on the workshop's 45×60 map, at its first prep. */
function reconPrep() {
  const prev = process.env.SP_STAGE;
  process.env.SP_STAGE = 'my_map';
  try {
    const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', difficulty: 'ABYSS', humans: 2, bots: 0, seed: 1, fake: true });
    h.start();
    h.runToPhase('PREP');
    return h;
  } finally {
    if (prev === undefined) delete process.env.SP_STAGE; else process.env.SP_STAGE = prev;
  }
}

describe('重构战场 my_map：客户端部署合法性与服务器一致', () => {
  test('普通带的半场（normalL）有部署格，本地 canPlace 与服务端 g.move 都接受同一格', () => {
    const h = reconPrep();
    const m = h.m;
    assert.equal(m.stageId, 'my_map');
    const ps = h.ps('p_0');
    const piece = ps.newPiece('chess', 'char_002_amiya');
    ps.hand[0] = piece;
    const field = m.deployFieldOf(ps);
    assert.equal(field, 'normalL', '左右两半的普通带：这一局按座位落在自己的半场');
    const layout = m.deployLayoutOf(ps);
    const ctx = placementContext({
      priv: ps.privateView(), stage: m.stage, editable: true, field, layout,
      getChess: (id) => m.gd.chess(id), getToken: (id) => m.gd.token(id),
      getItem: (id) => m.gd.item(id), getEffect: (id) => m.gd.effect(id),
    });
    assert.ok(ctx.deploy.melee.size > 0, '本地部署集不再为空（这条曾经整片为空）');
    assert.ok(ctx.deploy.ranged.size > 0, '远程格也读到了');
    const B = boardRectOf(layout, field);
    let tile = null;
    for (let r = B.r0; r <= B.r1 && !tile; r++) {
      for (let c = B.c0; c <= B.c1; c++) {
        if (!ctx.deploy.melee.has(`${r},${c}`)) continue;
        if (canPlace(ctx, piece.uid, { area: 'board', row: r, col: c }).ok) { tile = { r, c }; break; }
      }
    }
    assert.ok(tile, '棋盘上至少有一格本地接受');
    assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile.r, col: tile.c } }), { ok: true },
      '同一格服务器也接受');
    assert.equal(ps.hand[0], null, '棋子离开整备区');
    assert.ok([...ps.board.values()].some((p) => p.uid === piece.uid), '棋子站到了那一格');
  });
});
