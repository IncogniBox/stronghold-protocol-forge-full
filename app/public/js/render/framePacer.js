// public/js/render/framePacer.js — which animation-frame callbacks become pictures (performance proposal §1: 帧率).
//
// The battlefield view is driven by its own `requestAnimationFrame` instead of PIXI's self-running ticker
// (render/app.js: `app.ticker.autoStart` off, `onRaf` → `app.ticker.update(ts)`), because a browser cannot be asked
// for a frame rate: the display runs at its own rate (60 / 100 / 120 / 144 Hz) and every callback that is drawn costs a
// full picture. This module decides, per callback, whether that callback draws one. Pure (no PIXI, no DOM), so the
// rhythm is tested with synthetic timestamps (test/render/frame-pacer.test.js).
//
// The wanted interval is `I = 1000 / 帧率`; the display's own period `P` is the median of the last few callback
// intervals. Three cases (the proposal's algorithm):
//   * `0` (跟随屏幕) — every callback draws: the behaviour before this option existed, frame for frame.
//   * the display is not faster than the wanted rate (`r = I / P ≤ 1.06`) — every callback draws; nothing to pace.
//   * `r` is (nearly) a whole number (60 on a 120 Hz panel, 30 on a 60 Hz panel) — the display's own clock decides:
//     draw once `r` display frames (minus half) have passed, so 59.94 Hz gives 59.94 pictures, never a dropped frame.
//   * otherwise (60 on a 144 Hz panel) — a picture is due when the callback is within half a display frame of its
//     ideal time (`next`); the pictures then sit 2 or 3 display frames apart and average the wanted rate (1 000 : 666
//     over 144 Hz). No picture is ever more than half a display frame from its ideal time.
// A first callback, a stall and a tab switch (the picture would be far later than `I`) always draw, restarting the
// rhythm at `ts + I` — the pacer never "catches up" by drawing a burst of late pictures.

/** The last intervals kept for the median (the proposal's ring). */
const RING = 21;
/** An interval below this is not a display period (one callback taken twice / a zero delta). */
const MIN_INTERVAL = 1;
/** An interval above this is a stall or a hidden tab, not a display period (also render/app.js' own `dtRaw` limit). */
const MAX_INTERVAL = 100;
/** Fewer samples than this: the display's period is not known yet — draw every callback. */
const SAMPLE_MIN = 5;
/** How close `r` must be to a whole number for "the wanted rate divides the display rate". */
const NEAR = 0.06;
/** `r` at or below this: the display is not faster than the wanted rate — draw every callback. */
const NOT_FASTER = 1.06;
/** A picture later than this many wanted intervals after the previous one is a stall / a restart, not a rhythm. */
const STALL_INTERVALS = 3;

export class FramePacer {
  /** @param {number} targetFps 30 / 60 / 120, or 0 for 跟随屏幕 (every callback draws) */
  constructor(targetFps = 60) {
    this._ints = [];          // the recent callback intervals (ms), at most RING
    this._ts = null;          // the previous callback's timestamp (ms)
    this._pictureTs = null;   // the previous picture's timestamp (ms)
    this._next = 0;           // the ideal time of the next picture (ms), the non-dividing case
    this.setTarget(targetFps);
  }

  /**
   * The wanted frame rate. `0` (or anything not a positive number) = 跟随屏幕: every callback draws, the behaviour
   * that was there before this setting. Called from the 帧率 setting (render/app.js setSettings).
   * @param {number} fps
   */
  setTarget(fps) {
    const n = Number(fps);
    this.targetFps = Number.isFinite(n) && n > 0 ? n : 0;
    this._interval = this.targetFps > 0 ? 1000 / this.targetFps : 0;
  }

  /**
   * One animation-frame callback: record its timestamp and decide whether it draws a picture.
   * @param {number} ts the callback's timestamp (ms, the same clock as performance.now())
   * @returns {number|null} the picture's frame time in ms (0 for the first picture, the weather-vane for
   *   render/app.js' `dt`), or null when this callback draws no picture
   */
  frame(ts) {
    const prev = this._ts;
    this._ts = ts;
    if (prev != null && ts - prev >= MIN_INTERVAL && ts - prev <= MAX_INTERVAL) {
      this._ints.push(ts - prev);
      if (this._ints.length > RING) this._ints.shift();
    }
    if (!this._interval) return this._show(ts);                                  // 跟随屏幕
    if (this._pictureTs == null || ts - this._pictureTs > STALL_INTERVALS * this._interval) {
      this._next = ts + this._interval;                                          // first / stall: restart the rhythm
      return this._show(ts);
    }
    const P = this._period();
    if (!P) return this._show(ts);                                               // the period is not known yet
    const r = this._interval / P;
    if (r <= NOT_FASTER) return this._show(ts);                                  // the display is not faster
    if (Math.abs(r - Math.round(r)) <= NEAR) {                                   // the rate divides the display's
      return ts - this._pictureTs >= (Math.round(r) - 0.5) * P ? this._show(ts) : null;
    }
    const tau = Math.min(P, this._interval) / 2;                                 // 60 on 144 Hz and the like
    if (ts < this._next - tau) return null;
    const dt = this._show(ts);
    this._next = Math.max(this._next + this._interval, ts + this._interval - tau);
    return dt;
  }

  /** The display's own period: the median of the recorded intervals, 0 while there are too few of them. */
  _period() {
    const n = this._ints.length;
    if (n < SAMPLE_MIN) return 0;
    const a = this._ints.slice().sort((x, y) => x - y);
    const m = n >> 1;
    return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /** Mark `ts` as a picture and return its frame time. */
  _show(ts) {
    const dt = this._pictureTs == null ? 0 : ts - this._pictureTs;
    this._pictureTs = ts;
    return dt;
  }
}
