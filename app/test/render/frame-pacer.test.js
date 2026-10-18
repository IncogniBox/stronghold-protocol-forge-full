// test/render/frame-pacer.test.js — the 帧率 lock (performance proposal §1, render/framePacer.js): a browser cannot be
// asked for a frame rate, so the pacer decides per animation-frame callback whether that one draws a picture. Pure, so
// the rhythm is run on synthetic timestamps: displays at 60 / 100 / 120 / 144 / 240 Hz, the target 30 / 60 / 120 fps,
// and the 跟随屏幕 mode that must keep drawing every callback (the behaviour before this setting existed).
//
// The wanted interval I = 1000 / targetFps, the display's own period P = the median of the last callback intervals.
//   * the rate divides the display's (60 on a 120 Hz panel, 30 on a 60 Hz panel): the panel's own clock — every
//     round(I/P) display frames, so a 59.94 Hz panel gives 59.94 pictures, no dropped frame;
//   * no whole ratio (60 on a 144 Hz panel): 2 or 3 display frames apart, averaging the target;
//   * the display is not faster than the target (120 on a 60 Hz panel): every callback draws.
// A first callback, a stall and a hidden tab draw at once and restart the rhythm — the pacer never catches up.
//
// The first ~6 callbacks all draw (the display's period is not known before 5 intervals); the assertions below measure
// the steady rhythm after that (`steady`, `rateOf`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer } from '../../public/js/render/framePacer.js';

const period = (hz) => 1000 / hz;
/** Call `frame()` at `hz` for `ms` from `from`; the timestamps whose callback drew a picture. */
function pace(pacer, hz, ms, from = 0) {
  const P = period(hz), pics = [];
  for (let k = 0; ; k++) {
    const t = from + k * P;
    if (t - from > ms) break;
    if (pacer.frame(t) != null) pics.push(t);
  }
  return pics;
}
/** The picture gaps once the rhythm is established (skip the warm-up: the period needs 5 samples to be known). */
const steady = (pics, skip = 8) => pics.slice(skip + 1).map((t, i) => t - pics[skip + i]);
/** Pictures a second over the steady gaps. */
const rateOf = (pics) => { const g = steady(pics); return g.length / (g.reduce((s, d) => s + d, 0) / 1000); };
/** Every steady gap is exactly `frames` display periods? */
const everyGap = (pics, frames, hz) => {
  const P = period(hz);
  for (const d of steady(pics)) assert.ok(Math.abs(d - frames * P) < 1e-6, `${frames} display frames apart (${(d / P).toFixed(3)})`);
};
/** Every steady gap is a whole number of display periods, within `set`. */
const gapsWithin = (pics, hz, set) => {
  const P = period(hz);
  for (const d of steady(pics)) {
    const f = d / P, r = Math.round(f);
    assert.ok(Math.abs(f - r) < 1e-6, `a whole number of display frames (${f})`);
    assert.ok(set.includes(r), `one of ${set.join('/')} display frames (${f})`);
  }
};

test('跟随屏幕 (target 0): every callback draws — what the renderer did before this setting existed', () => {
  const pacer = new FramePacer(0);
  for (let k = 0; k < 60; k++) assert.notEqual(pacer.frame(k * period(144)), null, `callback ${k} draws`);
  assert.equal(pacer.targetFps, 0);
  assert.equal(new FramePacer(-1).targetFps, 0, 'anything that is not a positive number means 跟随屏幕');
});

test('a 120 Hz display at 60 frames: the panel\'s own clock — every picture 2 display frames after the last', () => {
  const pics = pace(new FramePacer(60), 120, 6000);
  everyGap(pics, 2, 120);
  assert.ok(Math.abs(rateOf(pics) - 60) < 0.2, `≈ 60 pictures a second (${rateOf(pics).toFixed(3)})`);
});

test('a 144 Hz display at 60 frames: 2 or 3 display frames apart, averaging the target', () => {
  const pics = pace(new FramePacer(60), 144, 6000);
  gapsWithin(pics, 144, [2, 3]);
  assert.ok(Math.abs(rateOf(pics) - 60) < 0.2, `≈ 60 pictures a second (${rateOf(pics).toFixed(3)})`);
});

test('a 100 Hz display at 60 frames: 1 or 2 display frames apart, averaging the target', () => {
  const pics = pace(new FramePacer(60), 100, 6000);
  gapsWithin(pics, 100, [1, 2]);
  assert.ok(Math.abs(rateOf(pics) - 60) < 0.2, `≈ 60 pictures a second (${rateOf(pics).toFixed(3)})`);
});

test('30 frames on a 60 Hz display: every picture 2 display frames after the last', () => {
  const pics = pace(new FramePacer(30), 60, 4000);
  everyGap(pics, 2, 60);
  assert.ok(Math.abs(rateOf(pics) - 30) < 0.2, `≈ 30 pictures a second (${rateOf(pics).toFixed(3)})`);
});

test('60 frames on a 240 Hz display (a whole ratio, 4): every picture 4 display frames after the last', () => {
  const pics = pace(new FramePacer(60), 240, 4000);
  everyGap(pics, 4, 240);
  assert.ok(Math.abs(rateOf(pics) - 60) < 0.2, `≈ 60 pictures a second (${rateOf(pics).toFixed(3)})`);
});

test('a display slower than the target (120 frames on a 60 Hz panel): every callback draws', () => {
  const pics = pace(new FramePacer(120), 60, 1000);
  assert.equal(pics.length, pace(new FramePacer(0), 60, 1000).length, 'as many pictures as callbacks');
});

test('the display\'s period is unknown until 5 intervals: every callback draws', () => {
  const pacer = new FramePacer(60);
  for (let k = 0; k < 6; k++) assert.notEqual(pacer.frame(k * period(144)), null, `callback ${k}`);
});

test('a first callback, a stall and a hidden tab draw at once; the rhythm restarts and never catches up', () => {
  const pacer = new FramePacer(60);
  assert.equal(pacer.frame(0), 0, 'the first picture draws (no picture before it: no frame time yet)');
  const pics = pace(pacer, 60, 300, 5000);          // a 5 s gap (a hidden tab) → the next callback draws at once
  assert.equal(pics[0], 5000, 'the callback right after the stall');
  assert.equal(pics.length, 19, 'then one picture per callback (the target is the panel\'s rate): 5000…5300');
  const late = new FramePacer(60);
  pace(late, 144, 100);
  const after = pace(late, 144, 300, 10_000);       // a stall on a 144 Hz panel: no burst of late pictures
  assert.equal(after[0], 10_000, 'the first callback after the stall draws');
  assert.ok(after[1] - after[0] >= 2 * period(144) - 1e-6, 'and the next one is a display frame apart, not a catch-up');
});

test('the median ignores intervals that are not a display period (a callback taken twice, a stall)', () => {
  const P = period(144);
  const a = new FramePacer(60), b = new FramePacer(60);
  let pa = 0, pb = 0;
  for (let k = 0; k < 40; k++) {
    if (a.frame(k * P) != null) pa++;
    if (k === 20) a.frame(20 * P + 0.4);            // the same display frame twice: not a display period
    if (b.frame(k * P) != null) pb++;
  }
  assert.equal(pa, pb, 'a callback taken twice in one display frame adds no picture');
  a.frame(40 * P + 1000);                           // a 1 s stall: outside 1…100 ms, dropped as well
  gapsWithin(pace(a, 144, 3000, 50_000), 144, [2, 3]);
});

test('setTarget goes both ways (60 → 跟随屏幕 → 60)', () => {
  const pacer = new FramePacer(60);
  pace(pacer, 120, 500);
  pacer.setTarget(0);
  for (let k = 0; k < 10; k++) assert.notEqual(pacer.frame(30_000 + k * period(120)), null, '跟随屏幕: every callback');
  pacer.setTarget(60);
  assert.ok(Math.abs(rateOf(pace(pacer, 120, 4000, 40_000)) - 60) < 0.2, 'locked again');
});
