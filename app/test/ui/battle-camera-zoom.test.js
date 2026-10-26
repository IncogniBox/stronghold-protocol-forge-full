// 重构战场的**战斗**摄像机：普通带的战斗与休整期看同一条自己的半场，并在非官方布局的图上同样推近 50%（业主 2026-10-26
// 「战斗时的摄像机视角是不是没有和休整期一样拉近 50%」）。官方 19×21 的图不推近。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { presetCamera } from '../../public/js/render/projection.js';
import { layoutOf } from '../../public/js/render/layout.js';
import { isOfficialLayout, isDualLayout } from '../../shared/layout.js';

const STAGE = JSON.parse(fs.readFileSync(new URL('../../workshop/mode-recon/stages.json', import.meta.url), 'utf8')).my_map;
const L = layoutOf(STAGE);
const SRC = fs.readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');

describe('big-map combat camera: the prep 50% zoom', () => {
  test('presetCamera zoom 1.5 scales the fitted tile size by exactly 1.5', () => {
    const rect = { r0: L.battle.normal.r0, r1: L.battle.normal.r1, c0: 18, c1: 30 };
    const vp = { width: 1920, height: 1080 };
    const plain = presetCamera('normal', vp, { rect, side: 'L', layout: L });
    const close = presetCamera('normal', vp, { rect, side: 'L', layout: L, zoom: 1.5 });
    assert.ok(Math.abs(close.scale / plain.scale - 1.5) < 1e-6, `${close.scale} / ${plain.scale}`);
  });

  test('the combat view lands on the prep view (same half, same zoom); the old full-band view was much farther', () => {
    const vp = { width: 1920, height: 1080 };
    const prep = presetCamera('prep', vp, { rect: { r0: 31, r1: 38, c0: 18, c1: 30 }, side: 'L', layout: L, zoom: 1.5 });
    const combat = presetCamera('normal', vp, { rect: { r0: 34, r1: 38, c0: 18, c1: 30 }, side: 'L', layout: L, zoom: 1.5 });
    const old = presetCamera('normal', vp, { rect: { r0: 34, r1: 38, c0: 20, c1: 40 }, side: 'L', layout: L });
    const ratio = combat.scale / prep.scale;
    assert.ok(ratio > 0.9 && ratio < 1.25, `combat/prep tile scale ${ratio.toFixed(3)}`);
    assert.ok(old.scale < prep.scale * 0.6, `the old full-band view was ${(old.scale / prep.scale).toFixed(3)}× the prep scale`);
  });

  test('the ordinary-band combat field takes its own half rect (outer margin kept) + the prep zoom', () => {
    assert.equal(isDualLayout(L), true, '重构战场的普通带是左右两半');
    // the same rect the prep frames horizontally: 2 cols of outer margin, up to the meeting column
    const n = L.deployRects.normalLeft, p = L.battle.prep;
    assert.deepEqual([Math.min(p.c0, n[2] - 2), n[3]], [18, 30]);
    assert.equal(L.mirrorCol - 18, 42, 'the right half mirrors it');
    assert.match(SRC, /const mapZoom = stageLayout && !isOfficialLayout\(stageLayout\) \? 1\.5 : null/);
    assert.match(SRC, /ownHalfRect = kind === 'normal' && !field\.prep/);
    assert.match(SRC, /rect: ownHalfRect, side, \.\.\.\(mapZoom \? \{ zoom: mapZoom \} : \{\}\)/);
  });

  test('watching a teammate: the prep scout frames the watched player\'s own half, symmetrically', () => {
    const vp = { width: 1920, height: 1080 };
    const left = presetCamera('prep', vp, { rect: { r0: 31, r1: 38, c0: 18, c1: 30 }, side: 'L', layout: L, zoom: 1.5 });
    const right = presetCamera('prep', vp, { rect: { r0: 31, r1: 38, c0: 30, c1: 42 }, side: 'R', layout: L, zoom: 1.5 });
    assert.ok(Math.abs(left.scale - right.scale) < 1e-6, 'both halves frame the same 13 columns');
    assert.ok(left.scale > presetCamera('prep', vp, { rect: L.battle.prep, side: 'L', layout: L }).scale * 1.4,
      'a half at 1.5× is much closer than the whole band');
    assert.match(SRC, /const scoutRect = watchedSide \? normalHalfRect\(watchedSide, true\) : null/);
    assert.match(SRC, /watchedSide = watchedId && watchedId !== myId && dualNormal \? normalPairSide\(watchedId\) : null/);
  });

  test('a same-field teammate is reached with the ‹ › pill (normal halves get the switch too)', () => {
    assert.match(SRC, /normalStartLayer = cc && kind === 'normal' && !field\.prep && dualNormal \? side : null/);
    assert.match(SRC, /cameraLayers\(field, pub, myId, stageLayout\)/);
    assert.match(SRC, /field\.kind === 'normal' && dualNormal && \(k === 'L' \|\| k === 'R'\)/);
  });

  test('official layouts are still not zoomed', () => {
    assert.equal(isOfficialLayout(layoutOf(null)), true);
    assert.equal(layoutOf(null).size[0], 19);
    assert.doesNotMatch(SRC, /zoom: 1\.5.*isOfficialLayout|isOfficialLayout.*zoom: 1\.5/, '官方图那条路不请求 zoom');
  });
});
