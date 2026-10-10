'use strict';

var Attachment = require('./attachments/Attachment.js');
var base = require('@pixi-spine/base');
require('./attachments/RegionAttachment.js');

class Animation {
  constructor(name, timelines, duration) {
    if (name == null)
      throw new Error("name cannot be null.");
    if (timelines == null)
      throw new Error("timelines cannot be null.");
    this.name = name;
    this.timelines = timelines;
    this.timelineIds = [];
    for (let i = 0; i < timelines.length; i++)
      this.timelineIds[timelines[i].getPropertyId()] = true;
    this.duration = duration;
  }
  hasTimeline(id) {
    return this.timelineIds[id] == true;
  }
  /** Applies all the animation's timelines to the specified skeleton.
   *
   * See Timeline {@link Timeline#apply(Skeleton, float, float, Array, float, MixBlend, MixDirection)}.
   * @param loop If true, the animation repeats after {@link #getDuration()}.
   * @param events May be null to ignore fired events. */
  apply(skeleton, lastTime, time, loop, events, alpha, blend, direction) {
    if (skeleton == null)
      throw new Error("skeleton cannot be null.");
    if (loop && this.duration != 0) {
      time %= this.duration;
      if (lastTime > 0)
        lastTime %= this.duration;
    }
    const timelines = this.timelines;
    for (let i = 0, n = timelines.length; i < n; i++)
      timelines[i].apply(skeleton, lastTime, time, events, alpha, blend, direction);
  }
  /** @param target After the first and before the last value.
   * @returns index of first value greater than the target. */
  static binarySearch(values, target, step = 1) {
    let low = 0;
    let high = values.length / step - 2;
    if (high == 0)
      return step;
    let current = high >>> 1;
    while (true) {
      if (values[(current + 1) * step] <= target)
        low = current + 1;
      else
        high = current;
      if (low == high)
        return (low + 1) * step;
      current = low + high >>> 1;
    }
  }
  static linearSearch(values, target, step) {
    for (let i = 0, last = values.length - step; i <= last; i += step)
      if (values[i] > target)
        return i;
    return -1;
  }
}
var TimelineType = /* @__PURE__ */ ((TimelineType2) => {
  TimelineType2[TimelineType2["rotate"] = 0] = "rotate";
  TimelineType2[TimelineType2["translate"] = 1] = "translate";
  TimelineType2[TimelineType2["scale"] = 2] = "scale";
  TimelineType2[TimelineType2["shear"] = 3] = "shear";
  TimelineType2[TimelineType2["attachment"] = 4] = "attachment";
  TimelineType2[TimelineType2["color"] = 5] = "color";
  TimelineType2[TimelineType2["deform"] = 6] = "deform";
  TimelineType2[TimelineType2["event"] = 7] = "event";
  TimelineType2[TimelineType2["drawOrder"] = 8] = "drawOrder";
  TimelineType2[TimelineType2["ikConstraint"] = 9] = "ikConstraint";
  TimelineType2[TimelineType2["transformConstraint"] = 10] = "transformConstraint";
  TimelineType2[TimelineType2["pathConstraintPosition"] = 11] = "pathConstraintPosition";
  TimelineType2[TimelineType2["pathConstraintSpacing"] = 12] = "pathConstraintSpacing";
  TimelineType2[TimelineType2["pathConstraintMix"] = 13] = "pathConstraintMix";
  TimelineType2[TimelineType2["twoColor"] = 14] = "twoColor";
  return TimelineType2;
})(TimelineType || {});
const _CurveTimeline = class {
  constructor(frameCount) {
    if (frameCount <= 0)
      throw new Error(`frameCount must be > 0: ${frameCount}`);
    this.curves = base.Utils.newFloatArray((frameCount - 1) * _CurveTimeline.BEZIER_SIZE);
  }
  /** The number of key frames for this timeline. */
  getFrameCount() {
    return this.curves.length / _CurveTimeline.BEZIER_SIZE + 1;
  }
  /** Sets the specified key frame to linear interpolation. */
  setLinear(frameIndex) {
    this.curves[frameIndex * _CurveTimeline.BEZIER_SIZE] = _CurveTimeline.LINEAR;
  }
  /** Sets the specified key frame to stepped interpolation. */
  setStepped(frameIndex) {
    this.curves[frameIndex * _CurveTimeline.BEZIER_SIZE] = _CurveTimeline.STEPPED;
  }
  /** Returns the interpolation type for the specified key frame.
   * @returns Linear is 0, stepped is 1, Bezier is 2. */
  getCurveType(frameIndex) {
    const index = frameIndex * _CurveTimeline.BEZIER_SIZE;
    if (index == this.curves.length)
      return _CurveTimeline.LINEAR;
    const type = this.curves[index];
    if (type == _CurveTimeline.LINEAR)
      return _CurveTimeline.LINEAR;
    if (type == _CurveTimeline.STEPPED)
      return _CurveTimeline.STEPPED;
    return _CurveTimeline.BEZIER;
  }
  /** Sets the specified key frame to Bezier interpolation. `cx1` and `cx2` are from 0 to 1,
   * representing the percent of time between the two key frames. `cy1` and `cy2` are the percent of the
   * difference between the key frame's values. */
  setCurve(frameIndex, cx1, cy1, cx2, cy2) {
    const tmpx = (-cx1 * 2 + cx2) * 0.03;
    const tmpy = (-cy1 * 2 + cy2) * 0.03;
    const dddfx = ((cx1 - cx2) * 3 + 1) * 6e-3;
    const dddfy = ((cy1 - cy2) * 3 + 1) * 6e-3;
    let ddfx = tmpx * 2 + dddfx;
    let ddfy = tmpy * 2 + dddfy;
    let dfx = cx1 * 0.3 + tmpx + dddfx * 0.16666667;
    let dfy = cy1 * 0.3 + tmpy + dddfy * 0.16666667;
    let i = frameIndex * _CurveTimeline.BEZIER_SIZE;
    const curves = this.curves;
    curves[i++] = _CurveTimeline.BEZIER;
    let x = dfx;
    let y = dfy;
    for (let n = i + _CurveTimeline.BEZIER_SIZE - 1; i < n; i += 2) {
      curves[i] = x;
      curves[i + 1] = y;
      dfx += ddfx;
      dfy += ddfy;
      ddfx += dddfx;
      ddfy += dddfy;
      x += dfx;
      y += dfy;
    }
  }
  /** Returns the interpolated percentage for the specified key frame and linear percentage. */
  getCurvePercent(frameIndex, percent) {
    percent = base.MathUtils.clamp(percent, 0, 1);
    const curves = this.curves;
    let i = frameIndex * _CurveTimeline.BEZIER_SIZE;
    const type = curves[i];
    if (type == _CurveTimeline.LINEAR)
      return percent;
    if (type == _CurveTimeline.STEPPED)
      return 0;
    i++;
    let x = 0;
    for (let start = i, n = i + _CurveTimeline.BEZIER_SIZE - 1; i < n; i += 2) {
      x = curves[i];
      if (x >= percent) {
        let prevX;
        let prevY;
        if (i == start) {
          prevX = 0;
          prevY = 0;
        } else {
          prevX = curves[i - 2];
          prevY = curves[i - 1];
        }
        return prevY + (curves[i + 1] - prevY) * (percent - prevX) / (x - prevX);
      }
    }
    const y = curves[i - 1];
    return y + (1 - y) * (percent - x) / (1 - x);
  }
};
let CurveTimeline = _CurveTimeline;
CurveTimeline.LINEAR = 0;
CurveTimeline.STEPPED = 1;
CurveTimeline.BEZIER = 2;
CurveTimeline.BEZIER_SIZE = 10 * 2 - 1;
const _RotateTimeline = class extends CurveTimeline {
  // time, degrees, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount << 1);
  }
  getPropertyId() {
    return (0 /* rotate */ << 24) + this.boneIndex;
  }
  /** Sets the time and angle of the specified keyframe. */
  setFrame(frameIndex, time, degrees) {
    frameIndex <<= 1;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _RotateTimeline.ROTATION] = degrees;
  }
  apply(skeleton, lastTime, time, events, alpha, blend, direction) {
    const frames = this.frames;
    const bone = skeleton.bones[this.boneIndex];
    if (!bone.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          bone.rotation = bone.data.rotation;
          return;
        case base.MixBlend.first:
          const r2 = bone.data.rotation - bone.rotation;
          bone.rotation += (r2 - (16384 - (16384.499999999996 - r2 / 360 | 0)) * 360) * alpha;
      }
      return;
    }
    if (time >= frames[frames.length - _RotateTimeline.ENTRIES]) {
      let r2 = frames[frames.length + _RotateTimeline.PREV_ROTATION];
      switch (blend) {
        case base.MixBlend.setup:
          bone.rotation = bone.data.rotation + r2 * alpha;
          break;
        case base.MixBlend.first:
        case base.MixBlend.replace:
          r2 += bone.data.rotation - bone.rotation;
          r2 -= (16384 - (16384.499999999996 - r2 / 360 | 0)) * 360;
        case base.MixBlend.add:
          bone.rotation += r2 * alpha;
      }
      return;
    }
    const frame = Animation.binarySearch(frames, time, _RotateTimeline.ENTRIES);
    const prevRotation = frames[frame + _RotateTimeline.PREV_ROTATION];
    const frameTime = frames[frame];
    const percent = this.getCurvePercent((frame >> 1) - 1, 1 - (time - frameTime) / (frames[frame + _RotateTimeline.PREV_TIME] - frameTime));
    let r = frames[frame + _RotateTimeline.ROTATION] - prevRotation;
    r = prevRotation + (r - (16384 - (16384.499999999996 - r / 360 | 0)) * 360) * percent;
    switch (blend) {
      case base.MixBlend.setup:
        bone.rotation = bone.data.rotation + (r - (16384 - (16384.499999999996 - r / 360 | 0)) * 360) * alpha;
        break;
      case base.MixBlend.first:
      case base.MixBlend.replace:
        r += bone.data.rotation - bone.rotation;
      case base.MixBlend.add:
        bone.rotation += (r - (16384 - (16384.499999999996 - r / 360 | 0)) * 360) * alpha;
    }
  }
};
let RotateTimeline = _RotateTimeline;
RotateTimeline.ENTRIES = 2;
RotateTimeline.PREV_TIME = -2;
RotateTimeline.PREV_ROTATION = -1;
RotateTimeline.ROTATION = 1;
const _TranslateTimeline = class extends CurveTimeline {
  // time, x, y, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount * _TranslateTimeline.ENTRIES);
  }
  getPropertyId() {
    return (1 /* translate */ << 24) + this.boneIndex;
  }
  /** Sets the time in seconds, x, and y values for the specified key frame. */
  setFrame(frameIndex, time, x, y) {
    frameIndex *= _TranslateTimeline.ENTRIES;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _TranslateTimeline.X] = x;
    this.frames[frameIndex + _TranslateTimeline.Y] = y;
  }
  apply(skeleton, lastTime, time, events, alpha, blend, direction) {
    const frames = this.frames;
    const bone = skeleton.bones[this.boneIndex];
    if (!bone.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          bone.x = bone.data.x;
          bone.y = bone.data.y;
          return;
        case base.MixBlend.first:
          bone.x += (bone.data.x - bone.x) * alpha;
          bone.y += (bone.data.y - bone.y) * alpha;
      }
      return;
    }
    let x = 0;
    let y = 0;
    if (time >= frames[frames.length - _TranslateTimeline.ENTRIES]) {
      x = frames[frames.length + _TranslateTimeline.PREV_X];
      y = frames[frames.length + _TranslateTimeline.PREV_Y];
    } else {
      const frame = Animation.binarySearch(frames, time, _TranslateTimeline.ENTRIES);
      x = frames[frame + _TranslateTimeline.PREV_X];
      y = frames[frame + _TranslateTimeline.PREV_Y];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(frame / _TranslateTimeline.ENTRIES - 1, 1 - (time - frameTime) / (frames[frame + _TranslateTimeline.PREV_TIME] - frameTime));
      x += (frames[frame + _TranslateTimeline.X] - x) * percent;
      y += (frames[frame + _TranslateTimeline.Y] - y) * percent;
    }
    switch (blend) {
      case base.MixBlend.setup:
        bone.x = bone.data.x + x * alpha;
        bone.y = bone.data.y + y * alpha;
        break;
      case base.MixBlend.first:
      case base.MixBlend.replace:
        bone.x += (bone.data.x + x - bone.x) * alpha;
        bone.y += (bone.data.y + y - bone.y) * alpha;
        break;
      case base.MixBlend.add:
        bone.x += x * alpha;
        bone.y += y * alpha;
    }
  }
};
let TranslateTimeline = _TranslateTimeline;
TranslateTimeline.ENTRIES = 3;
TranslateTimeline.PREV_TIME = -3;
TranslateTimeline.PREV_X = -2;
TranslateTimeline.PREV_Y = -1;
TranslateTimeline.X = 1;
TranslateTimeline.Y = 2;
class ScaleTimeline extends TranslateTimeline {
  constructor(frameCount) {
    super(frameCount);
  }
  getPropertyId() {
    return (2 /* scale */ << 24) + this.boneIndex;
  }
  apply(skeleton, lastTime, time, events, alpha, blend, direction) {
    const frames = this.frames;
    const bone = skeleton.bones[this.boneIndex];
    if (!bone.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          bone.scaleX = bone.data.scaleX;
          bone.scaleY = bone.data.scaleY;
          return;
        case base.MixBlend.first:
          bone.scaleX += (bone.data.scaleX - bone.scaleX) * alpha;
          bone.scaleY += (bone.data.scaleY - bone.scaleY) * alpha;
      }
      return;
    }
    let x = 0;
    let y = 0;
    if (time >= frames[frames.length - ScaleTimeline.ENTRIES]) {
      x = frames[frames.length + ScaleTimeline.PREV_X] * bone.data.scaleX;
      y = frames[frames.length + ScaleTimeline.PREV_Y] * bone.data.scaleY;
    } else {
      const frame = Animation.binarySearch(frames, time, ScaleTimeline.ENTRIES);
      x = frames[frame + ScaleTimeline.PREV_X];
      y = frames[frame + ScaleTimeline.PREV_Y];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(frame / ScaleTimeline.ENTRIES - 1, 1 - (time - frameTime) / (frames[frame + ScaleTimeline.PREV_TIME] - frameTime));
      x = (x + (frames[frame + ScaleTimeline.X] - x) * percent) * bone.data.scaleX;
      y = (y + (frames[frame + ScaleTimeline.Y] - y) * percent) * bone.data.scaleY;
    }
    if (alpha == 1) {
      if (blend == base.MixBlend.add) {
        bone.scaleX += x - bone.data.scaleX;
        bone.scaleY += y - bone.data.scaleY;
      } else {
        bone.scaleX = x;
        bone.scaleY = y;
      }
    } else {
      let bx = 0;
      let by = 0;
      if (direction == base.MixDirection.mixOut) {
        switch (blend) {
          case base.MixBlend.setup:
            bx = bone.data.scaleX;
            by = bone.data.scaleY;
            bone.scaleX = bx + (Math.abs(x) * base.MathUtils.signum(bx) - bx) * alpha;
            bone.scaleY = by + (Math.abs(y) * base.MathUtils.signum(by) - by) * alpha;
            break;
          case base.MixBlend.first:
          case base.MixBlend.replace:
            bx = bone.scaleX;
            by = bone.scaleY;
            bone.scaleX = bx + (Math.abs(x) * base.MathUtils.signum(bx) - bx) * alpha;
            bone.scaleY = by + (Math.abs(y) * base.MathUtils.signum(by) - by) * alpha;
            break;
          case base.MixBlend.add:
            bx = bone.scaleX;
            by = bone.scaleY;
            bone.scaleX = bx + (Math.abs(x) * base.MathUtils.signum(bx) - bone.data.scaleX) * alpha;
            bone.scaleY = by + (Math.abs(y) * base.MathUtils.signum(by) - bone.data.scaleY) * alpha;
        }
      } else {
        switch (blend) {
          case base.MixBlend.setup:
            bx = Math.abs(bone.data.scaleX) * base.MathUtils.signum(x);
            by = Math.abs(bone.data.scaleY) * base.MathUtils.signum(y);
            bone.scaleX = bx + (x - bx) * alpha;
            bone.scaleY = by + (y - by) * alpha;
            break;
          case base.MixBlend.first:
          case base.MixBlend.replace:
            bx = Math.abs(bone.scaleX) * base.MathUtils.signum(x);
            by = Math.abs(bone.scaleY) * base.MathUtils.signum(y);
            bone.scaleX = bx + (x - bx) * alpha;
            bone.scaleY = by + (y - by) * alpha;
            break;
          case base.MixBlend.add:
            bx = base.MathUtils.signum(x);
            by = base.MathUtils.signum(y);
            bone.scaleX = Math.abs(bone.scaleX) * bx + (x - Math.abs(bone.data.scaleX) * bx) * alpha;
            bone.scaleY = Math.abs(bone.scaleY) * by + (y - Math.abs(bone.data.scaleY) * by) * alpha;
        }
      }
    }
  }
}
class ShearTimeline extends TranslateTimeline {
  constructor(frameCount) {
    super(frameCount);
  }
  getPropertyId() {
    return (3 /* shear */ << 24) + this.boneIndex;
  }
  apply(skeleton, lastTime, time, events, alpha, blend, direction) {
    const frames = this.frames;
    const bone = skeleton.bones[this.boneIndex];
    if (!bone.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          bone.shearX = bone.data.shearX;
          bone.shearY = bone.data.shearY;
          return;
        case base.MixBlend.first:
          bone.shearX += (bone.data.shearX - bone.shearX) * alpha;
          bone.shearY += (bone.data.shearY - bone.shearY) * alpha;
      }
      return;
    }
    let x = 0;
    let y = 0;
    if (time >= frames[frames.length - ShearTimeline.ENTRIES]) {
      x = frames[frames.length + ShearTimeline.PREV_X];
      y = frames[frames.length + ShearTimeline.PREV_Y];
    } else {
      const frame = Animation.binarySearch(frames, time, ShearTimeline.ENTRIES);
      x = frames[frame + ShearTimeline.PREV_X];
      y = frames[frame + ShearTimeline.PREV_Y];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(frame / ShearTimeline.ENTRIES - 1, 1 - (time - frameTime) / (frames[frame + ShearTimeline.PREV_TIME] - frameTime));
      x = x + (frames[frame + ShearTimeline.X] - x) * percent;
      y = y + (frames[frame + ShearTimeline.Y] - y) * percent;
    }
    switch (blend) {
      case base.MixBlend.setup:
        bone.shearX = bone.data.shearX + x * alpha;
        bone.shearY = bone.data.shearY + y * alpha;
        break;
      case base.MixBlend.first:
      case base.MixBlend.replace:
        bone.shearX += (bone.data.shearX + x - bone.shearX) * alpha;
        bone.shearY += (bone.data.shearY + y - bone.shearY) * alpha;
        break;
      case base.MixBlend.add:
        bone.shearX += x * alpha;
        bone.shearY += y * alpha;
    }
  }
}
const _ColorTimeline = class extends CurveTimeline {
  // time, r, g, b, a, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount * _ColorTimeline.ENTRIES);
  }
  getPropertyId() {
    return (5 /* color */ << 24) + this.slotIndex;
  }
  /** Sets the time in seconds, red, green, blue, and alpha for the specified key frame. */
  setFrame(frameIndex, time, r, g, b, a) {
    frameIndex *= _ColorTimeline.ENTRIES;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _ColorTimeline.R] = r;
    this.frames[frameIndex + _ColorTimeline.G] = g;
    this.frames[frameIndex + _ColorTimeline.B] = b;
    this.frames[frameIndex + _ColorTimeline.A] = a;
  }
  apply(skeleton, lastTime, time, events, alpha, blend, direction) {
    const slot = skeleton.slots[this.slotIndex];
    if (!slot.bone.active)
      return;
    const frames = this.frames;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          slot.color.setFromColor(slot.data.color);
          return;
        case base.MixBlend.first:
          const color = slot.color;
          const setup = slot.data.color;
          color.add((setup.r - color.r) * alpha, (setup.g - color.g) * alpha, (setup.b - color.b) * alpha, (setup.a - color.a) * alpha);
      }
      return;
    }
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    if (time >= frames[frames.length - _ColorTimeline.ENTRIES]) {
      const i = frames.length;
      r = frames[i + _ColorTimeline.PREV_R];
      g = frames[i + _ColorTimeline.PREV_G];
      b = frames[i + _ColorTimeline.PREV_B];
      a = frames[i + _ColorTimeline.PREV_A];
    } else {
      const frame = Animation.binarySearch(frames, time, _ColorTimeline.ENTRIES);
      r = frames[frame + _ColorTimeline.PREV_R];
      g = frames[frame + _ColorTimeline.PREV_G];
      b = frames[frame + _ColorTimeline.PREV_B];
      a = frames[frame + _ColorTimeline.PREV_A];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(frame / _ColorTimeline.ENTRIES - 1, 1 - (time - frameTime) / (frames[frame + _ColorTimeline.PREV_TIME] - frameTime));
      r += (frames[frame + _ColorTimeline.R] - r) * percent;
      g += (frames[frame + _ColorTimeline.G] - g) * percent;
      b += (frames[frame + _ColorTimeline.B] - b) * percent;
      a += (frames[frame + _ColorTimeline.A] - a) * percent;
    }
    if (alpha == 1)
      slot.color.set(r, g, b, a);
    else {
      const color = slot.color;
      if (blend == base.MixBlend.setup)
        color.setFromColor(slot.data.color);
      color.add((r - color.r) * alpha, (g - color.g) * alpha, (b - color.b) * alpha, (a - color.a) * alpha);
    }
  }
};
let ColorTimeline = _ColorTimeline;
ColorTimeline.ENTRIES = 5;
ColorTimeline.PREV_TIME = -5;
ColorTimeline.PREV_R = -4;
ColorTimeline.PREV_G = -3;
ColorTimeline.PREV_B = -2;
ColorTimeline.PREV_A = -1;
ColorTimeline.R = 1;
ColorTimeline.G = 2;
ColorTimeline.B = 3;
ColorTimeline.A = 4;
const _TwoColorTimeline = class extends CurveTimeline {
  // time, r, g, b, a, r2, g2, b2, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount * _TwoColorTimeline.ENTRIES);
  }
  getPropertyId() {
    return (14 /* twoColor */ << 24) + this.slotIndex;
  }
  /** Sets the time in seconds, light, and dark colors for the specified key frame. */
  setFrame(frameIndex, time, r, g, b, a, r2, g2, b2) {
    frameIndex *= _TwoColorTimeline.ENTRIES;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _TwoColorTimeline.R] = r;
    this.frames[frameIndex + _TwoColorTimeline.G] = g;
    this.frames[frameIndex + _TwoColorTimeline.B] = b;
    this.frames[frameIndex + _TwoColorTimeline.A] = a;
    this.frames[frameIndex + _TwoColorTimeline.R2] = r2;
    this.frames[frameIndex + _TwoColorTimeline.G2] = g2;
    this.frames[frameIndex + _TwoColorTimeline.B2] = b2;
  }
  apply(skeleton, lastTime, time, events, alpha, blend, direction) {
    const slot = skeleton.slots[this.slotIndex];
    if (!slot.bone.active)
      return;
    const frames = this.frames;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          slot.color.setFromColor(slot.data.color);
          slot.darkColor.setFromColor(slot.data.darkColor);
          return;
        case base.MixBlend.first:
          const light = slot.color;
          const dark = slot.darkColor;
          const setupLight = slot.data.color;
          const setupDark = slot.data.darkColor;
          light.add((setupLight.r - light.r) * alpha, (setupLight.g - light.g) * alpha, (setupLight.b - light.b) * alpha, (setupLight.a - light.a) * alpha);
          dark.add((setupDark.r - dark.r) * alpha, (setupDark.g - dark.g) * alpha, (setupDark.b - dark.b) * alpha, 0);
      }
      return;
    }
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let r2 = 0;
    let g2 = 0;
    let b2 = 0;
    if (time >= frames[frames.length - _TwoColorTimeline.ENTRIES]) {
      const i = frames.length;
      r = frames[i + _TwoColorTimeline.PREV_R];
      g = frames[i + _TwoColorTimeline.PREV_G];
      b = frames[i + _TwoColorTimeline.PREV_B];
      a = frames[i + _TwoColorTimeline.PREV_A];
      r2 = frames[i + _TwoColorTimeline.PREV_R2];
      g2 = frames[i + _TwoColorTimeline.PREV_G2];
      b2 = frames[i + _TwoColorTimeline.PREV_B2];
    } else {
      const frame = Animation.binarySearch(frames, time, _TwoColorTimeline.ENTRIES);
      r = frames[frame + _TwoColorTimeline.PREV_R];
      g = frames[frame + _TwoColorTimeline.PREV_G];
      b = frames[frame + _TwoColorTimeline.PREV_B];
      a = frames[frame + _TwoColorTimeline.PREV_A];
      r2 = frames[frame + _TwoColorTimeline.PREV_R2];
      g2 = frames[frame + _TwoColorTimeline.PREV_G2];
      b2 = frames[frame + _TwoColorTimeline.PREV_B2];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(frame / _TwoColorTimeline.ENTRIES - 1, 1 - (time - frameTime) / (frames[frame + _TwoColorTimeline.PREV_TIME] - frameTime));
      r += (frames[frame + _TwoColorTimeline.R] - r) * percent;
      g += (frames[frame + _TwoColorTimeline.G] - g) * percent;
      b += (frames[frame + _TwoColorTimeline.B] - b) * percent;
      a += (frames[frame + _TwoColorTimeline.A] - a) * percent;
      r2 += (frames[frame + _TwoColorTimeline.R2] - r2) * percent;
      g2 += (frames[frame + _TwoColorTimeline.G2] - g2) * percent;
      b2 += (frames[frame + _TwoColorTimeline.B2] - b2) * percent;
    }
    if (alpha == 1) {
      slot.color.set(r, g, b, a);
      slot.darkColor.set(r2, g2, b2, 1);
    } else {
      const light = slot.color;
      const dark = slot.darkColor;
      if (blend == base.MixBlend.setup) {
        light.setFromColor(slot.data.color);
        dark.setFromColor(slot.data.darkColor);
      }
      light.add((r - light.r) * alpha, (g - light.g) * alpha, (b - light.b) * alpha, (a - light.a) * alpha);
      dark.add((r2 - dark.r) * alpha, (g2 - dark.g) * alpha, (b2 - dark.b) * alpha, 0);
    }
  }
};
let TwoColorTimeline = _TwoColorTimeline;
TwoColorTimeline.ENTRIES = 8;
TwoColorTimeline.PREV_TIME = -8;
TwoColorTimeline.PREV_R = -7;
TwoColorTimeline.PREV_G = -6;
TwoColorTimeline.PREV_B = -5;
TwoColorTimeline.PREV_A = -4;
TwoColorTimeline.PREV_R2 = -3;
TwoColorTimeline.PREV_G2 = -2;
TwoColorTimeline.PREV_B2 = -1;
TwoColorTimeline.R = 1;
TwoColorTimeline.G = 2;
TwoColorTimeline.B = 3;
TwoColorTimeline.A = 4;
TwoColorTimeline.R2 = 5;
TwoColorTimeline.G2 = 6;
TwoColorTimeline.B2 = 7;
class AttachmentTimeline {
  constructor(frameCount) {
    this.frames = base.Utils.newFloatArray(frameCount);
    this.attachmentNames = new Array(frameCount);
  }
  getPropertyId() {
    return (4 /* attachment */ << 24) + this.slotIndex;
  }
  /** The number of key frames for this timeline. */
  getFrameCount() {
    return this.frames.length;
  }
  /** Sets the time in seconds and the attachment name for the specified key frame. */
  setFrame(frameIndex, time, attachmentName) {
    this.frames[frameIndex] = time;
    this.attachmentNames[frameIndex] = attachmentName;
  }
  apply(skeleton, lastTime, time, events, alpha, blend, direction) {
    const slot = skeleton.slots[this.slotIndex];
    if (!slot.bone.active)
      return;
    if (direction == base.MixDirection.mixOut) {
      if (blend == base.MixBlend.setup)
        this.setAttachment(skeleton, slot, slot.data.attachmentName);
      return;
    }
    const frames = this.frames;
    if (time < frames[0]) {
      if (blend == base.MixBlend.setup || blend == base.MixBlend.first)
        this.setAttachment(skeleton, slot, slot.data.attachmentName);
      return;
    }
    let frameIndex = 0;
    if (time >= frames[frames.length - 1])
      frameIndex = frames.length - 1;
    else
      frameIndex = Animation.binarySearch(frames, time, 1) - 1;
    const attachmentName = this.attachmentNames[frameIndex];
    skeleton.slots[this.slotIndex].setAttachment(attachmentName == null ? null : skeleton.getAttachment(this.slotIndex, attachmentName));
  }
  setAttachment(skeleton, slot, attachmentName) {
    slot.setAttachment(attachmentName == null ? null : skeleton.getAttachment(this.slotIndex, attachmentName));
  }
}
let zeros = null;
class DeformTimeline extends CurveTimeline {
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount);
    this.frameVertices = new Array(frameCount);
    if (zeros == null)
      zeros = base.Utils.newFloatArray(64);
  }
  getPropertyId() {
    return (6 /* deform */ << 27) + Number(this.attachment.id) + this.slotIndex;
  }
  /** Sets the time in seconds and the vertices for the specified key frame.
   * @param vertices Vertex positions for an unweighted VertexAttachment, or deform offsets if it has weights. */
  setFrame(frameIndex, time, vertices) {
    this.frames[frameIndex] = time;
    this.frameVertices[frameIndex] = vertices;
  }
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    const slot = skeleton.slots[this.slotIndex];
    if (!slot.bone.active)
      return;
    const slotAttachment = slot.getAttachment();
    if (!(slotAttachment instanceof Attachment.VertexAttachment) || !(slotAttachment.deformAttachment == this.attachment))
      return;
    const deformArray = slot.deform;
    if (deformArray.length == 0)
      blend = base.MixBlend.setup;
    const frameVertices = this.frameVertices;
    const vertexCount = frameVertices[0].length;
    const frames = this.frames;
    if (time < frames[0]) {
      const vertexAttachment = slotAttachment;
      switch (blend) {
        case base.MixBlend.setup:
          deformArray.length = 0;
          return;
        case base.MixBlend.first:
          if (alpha == 1) {
            deformArray.length = 0;
            break;
          }
          const deform2 = base.Utils.setArraySize(deformArray, vertexCount);
          if (vertexAttachment.bones == null) {
            const setupVertices = vertexAttachment.vertices;
            for (let i = 0; i < vertexCount; i++)
              deform2[i] += (setupVertices[i] - deform2[i]) * alpha;
          } else {
            alpha = 1 - alpha;
            for (let i = 0; i < vertexCount; i++)
              deform2[i] *= alpha;
          }
      }
      return;
    }
    const deform = base.Utils.setArraySize(deformArray, vertexCount);
    if (time >= frames[frames.length - 1]) {
      const lastVertices = frameVertices[frames.length - 1];
      if (alpha == 1) {
        if (blend == base.MixBlend.add) {
          const vertexAttachment = slotAttachment;
          if (vertexAttachment.bones == null) {
            const setupVertices = vertexAttachment.vertices;
            for (let i = 0; i < vertexCount; i++) {
              deform[i] += lastVertices[i] - setupVertices[i];
            }
          } else {
            for (let i = 0; i < vertexCount; i++)
              deform[i] += lastVertices[i];
          }
        } else {
          base.Utils.arrayCopy(lastVertices, 0, deform, 0, vertexCount);
        }
      } else {
        switch (blend) {
          case base.MixBlend.setup: {
            const vertexAttachment2 = slotAttachment;
            if (vertexAttachment2.bones == null) {
              const setupVertices = vertexAttachment2.vertices;
              for (let i = 0; i < vertexCount; i++) {
                const setup = setupVertices[i];
                deform[i] = setup + (lastVertices[i] - setup) * alpha;
              }
            } else {
              for (let i = 0; i < vertexCount; i++)
                deform[i] = lastVertices[i] * alpha;
            }
            break;
          }
          case base.MixBlend.first:
          case base.MixBlend.replace:
            for (let i = 0; i < vertexCount; i++)
              deform[i] += (lastVertices[i] - deform[i]) * alpha;
            break;
          case base.MixBlend.add:
            const vertexAttachment = slotAttachment;
            if (vertexAttachment.bones == null) {
              const setupVertices = vertexAttachment.vertices;
              for (let i = 0; i < vertexCount; i++) {
                deform[i] += (lastVertices[i] - setupVertices[i]) * alpha;
              }
            } else {
              for (let i = 0; i < vertexCount; i++)
                deform[i] += lastVertices[i] * alpha;
            }
        }
      }
      return;
    }
    const frame = Animation.binarySearch(frames, time);
    const prevVertices = frameVertices[frame - 1];
    const nextVertices = frameVertices[frame];
    const frameTime = frames[frame];
    const percent = this.getCurvePercent(frame - 1, 1 - (time - frameTime) / (frames[frame - 1] - frameTime));
    if (alpha == 1) {
      if (blend == base.MixBlend.add) {
        const vertexAttachment = slotAttachment;
        if (vertexAttachment.bones == null) {
          const setupVertices = vertexAttachment.vertices;
          for (let i = 0; i < vertexCount; i++) {
            const prev = prevVertices[i];
            deform[i] += prev + (nextVertices[i] - prev) * percent - setupVertices[i];
          }
        } else {
          for (let i = 0; i < vertexCount; i++) {
            const prev = prevVertices[i];
            deform[i] += prev + (nextVertices[i] - prev) * percent;
          }
        }
      } else {
        for (let i = 0; i < vertexCount; i++) {
          const prev = prevVertices[i];
          deform[i] = prev + (nextVertices[i] - prev) * percent;
        }
      }
    } else {
      switch (blend) {
        case base.MixBlend.setup: {
          const vertexAttachment2 = slotAttachment;
          if (vertexAttachment2.bones == null) {
            const setupVertices = vertexAttachment2.vertices;
            for (let i = 0; i < vertexCount; i++) {
              const prev = prevVertices[i];
              const setup = setupVertices[i];
              deform[i] = setup + (prev + (nextVertices[i] - prev) * percent - setup) * alpha;
            }
          } else {
            for (let i = 0; i < vertexCount; i++) {
              const prev = prevVertices[i];
              deform[i] = (prev + (nextVertices[i] - prev) * percent) * alpha;
            }
          }
          break;
        }
        case base.MixBlend.first:
        case base.MixBlend.replace:
          for (let i = 0; i < vertexCount; i++) {
            const prev = prevVertices[i];
            deform[i] += (prev + (nextVertices[i] - prev) * percent - deform[i]) * alpha;
          }
          break;
        case base.MixBlend.add:
          const vertexAttachment = slotAttachment;
          if (vertexAttachment.bones == null) {
            const setupVertices = vertexAttachment.vertices;
            for (let i = 0; i < vertexCount; i++) {
              const prev = prevVertices[i];
              deform[i] += (prev + (nextVertices[i] - prev) * percent - setupVertices[i]) * alpha;
            }
          } else {
            for (let i = 0; i < vertexCount; i++) {
              const prev = prevVertices[i];
              deform[i] += (prev + (nextVertices[i] - prev) * percent) * alpha;
            }
          }
      }
    }
  }
}
class EventTimeline {
  constructor(frameCount) {
    this.frames = base.Utils.newFloatArray(frameCount);
    this.events = new Array(frameCount);
  }
  getPropertyId() {
    return 7 /* event */ << 24;
  }
  /** The number of key frames for this timeline. */
  getFrameCount() {
    return this.frames.length;
  }
  /** Sets the time in seconds and the event for the specified key frame. */
  setFrame(frameIndex, event) {
    this.frames[frameIndex] = event.time;
    this.events[frameIndex] = event;
  }
  /** Fires events for frames > `lastTime` and <= `time`. */
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    if (firedEvents == null)
      return;
    const frames = this.frames;
    const frameCount = this.frames.length;
    if (lastTime > time) {
      this.apply(skeleton, lastTime, Number.MAX_VALUE, firedEvents, alpha, blend, direction);
      lastTime = -1;
    } else if (lastTime >= frames[frameCount - 1])
      return;
    if (time < frames[0])
      return;
    let frame = 0;
    if (lastTime < frames[0])
      frame = 0;
    else {
      frame = Animation.binarySearch(frames, lastTime);
      const frameTime = frames[frame];
      while (frame > 0) {
        if (frames[frame - 1] != frameTime)
          break;
        frame--;
      }
    }
    for (; frame < frameCount && time >= frames[frame]; frame++)
      firedEvents.push(this.events[frame]);
  }
}
class DrawOrderTimeline {
  constructor(frameCount) {
    this.frames = base.Utils.newFloatArray(frameCount);
    this.drawOrders = new Array(frameCount);
  }
  getPropertyId() {
    return 8 /* drawOrder */ << 24;
  }
  /** The number of key frames for this timeline. */
  getFrameCount() {
    return this.frames.length;
  }
  /** Sets the time in seconds and the draw order for the specified key frame.
   * @param drawOrder For each slot in {@link Skeleton#slots}, the index of the new draw order. May be null to use setup pose
   *           draw order. */
  setFrame(frameIndex, time, drawOrder) {
    this.frames[frameIndex] = time;
    this.drawOrders[frameIndex] = drawOrder;
  }
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    const drawOrder = skeleton.drawOrder;
    const slots = skeleton.slots;
    if (direction == base.MixDirection.mixOut && blend == base.MixBlend.setup) {
      base.Utils.arrayCopy(skeleton.slots, 0, skeleton.drawOrder, 0, skeleton.slots.length);
      return;
    }
    const frames = this.frames;
    if (time < frames[0]) {
      if (blend == base.MixBlend.setup || blend == base.MixBlend.first)
        base.Utils.arrayCopy(skeleton.slots, 0, skeleton.drawOrder, 0, skeleton.slots.length);
      return;
    }
    let frame = 0;
    if (time >= frames[frames.length - 1])
      frame = frames.length - 1;
    else
      frame = Animation.binarySearch(frames, time) - 1;
    const drawOrderToSetupIndex = this.drawOrders[frame];
    if (drawOrderToSetupIndex == null)
      base.Utils.arrayCopy(slots, 0, drawOrder, 0, slots.length);
    else {
      for (let i = 0, n = drawOrderToSetupIndex.length; i < n; i++)
        drawOrder[i] = slots[drawOrderToSetupIndex[i]];
    }
  }
}
const _IkConstraintTimeline = class extends CurveTimeline {
  // time, mix, softness, bendDirection, compress, stretch, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount * _IkConstraintTimeline.ENTRIES);
  }
  getPropertyId() {
    return (9 /* ikConstraint */ << 24) + this.ikConstraintIndex;
  }
  /** Sets the time in seconds, mix, softness, bend direction, compress, and stretch for the specified key frame. */
  setFrame(frameIndex, time, mix, softness, bendDirection, compress, stretch) {
    frameIndex *= _IkConstraintTimeline.ENTRIES;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _IkConstraintTimeline.MIX] = mix;
    this.frames[frameIndex + _IkConstraintTimeline.SOFTNESS] = softness;
    this.frames[frameIndex + _IkConstraintTimeline.BEND_DIRECTION] = bendDirection;
    this.frames[frameIndex + _IkConstraintTimeline.COMPRESS] = compress ? 1 : 0;
    this.frames[frameIndex + _IkConstraintTimeline.STRETCH] = stretch ? 1 : 0;
  }
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    const frames = this.frames;
    const constraint = skeleton.ikConstraints[this.ikConstraintIndex];
    if (!constraint.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          constraint.mix = constraint.data.mix;
          constraint.softness = constraint.data.softness;
          constraint.bendDirection = constraint.data.bendDirection;
          constraint.compress = constraint.data.compress;
          constraint.stretch = constraint.data.stretch;
          return;
        case base.MixBlend.first:
          constraint.mix += (constraint.data.mix - constraint.mix) * alpha;
          constraint.softness += (constraint.data.softness - constraint.softness) * alpha;
          constraint.bendDirection = constraint.data.bendDirection;
          constraint.compress = constraint.data.compress;
          constraint.stretch = constraint.data.stretch;
      }
      return;
    }
    if (time >= frames[frames.length - _IkConstraintTimeline.ENTRIES]) {
      if (blend == base.MixBlend.setup) {
        constraint.mix = constraint.data.mix + (frames[frames.length + _IkConstraintTimeline.PREV_MIX] - constraint.data.mix) * alpha;
        constraint.softness = constraint.data.softness + (frames[frames.length + _IkConstraintTimeline.PREV_SOFTNESS] - constraint.data.softness) * alpha;
        if (direction == base.MixDirection.mixOut) {
          constraint.bendDirection = constraint.data.bendDirection;
          constraint.compress = constraint.data.compress;
          constraint.stretch = constraint.data.stretch;
        } else {
          constraint.bendDirection = frames[frames.length + _IkConstraintTimeline.PREV_BEND_DIRECTION];
          constraint.compress = frames[frames.length + _IkConstraintTimeline.PREV_COMPRESS] != 0;
          constraint.stretch = frames[frames.length + _IkConstraintTimeline.PREV_STRETCH] != 0;
        }
      } else {
        constraint.mix += (frames[frames.length + _IkConstraintTimeline.PREV_MIX] - constraint.mix) * alpha;
        constraint.softness += (frames[frames.length + _IkConstraintTimeline.PREV_SOFTNESS] - constraint.softness) * alpha;
        if (direction == base.MixDirection.mixIn) {
          constraint.bendDirection = frames[frames.length + _IkConstraintTimeline.PREV_BEND_DIRECTION];
          constraint.compress = frames[frames.length + _IkConstraintTimeline.PREV_COMPRESS] != 0;
          constraint.stretch = frames[frames.length + _IkConstraintTimeline.PREV_STRETCH] != 0;
        }
      }
      return;
    }
    const frame = Animation.binarySearch(frames, time, _IkConstraintTimeline.ENTRIES);
    const mix = frames[frame + _IkConstraintTimeline.PREV_MIX];
    const softness = frames[frame + _IkConstraintTimeline.PREV_SOFTNESS];
    const frameTime = frames[frame];
    const percent = this.getCurvePercent(frame / _IkConstraintTimeline.ENTRIES - 1, 1 - (time - frameTime) / (frames[frame + _IkConstraintTimeline.PREV_TIME] - frameTime));
    if (blend == base.MixBlend.setup) {
      constraint.mix = constraint.data.mix + (mix + (frames[frame + _IkConstraintTimeline.MIX] - mix) * percent - constraint.data.mix) * alpha;
      constraint.softness = constraint.data.softness + (softness + (frames[frame + _IkConstraintTimeline.SOFTNESS] - softness) * percent - constraint.data.softness) * alpha;
      if (direction == base.MixDirection.mixOut) {
        constraint.bendDirection = constraint.data.bendDirection;
        constraint.compress = constraint.data.compress;
        constraint.stretch = constraint.data.stretch;
      } else {
        constraint.bendDirection = frames[frame + _IkConstraintTimeline.PREV_BEND_DIRECTION];
        constraint.compress = frames[frame + _IkConstraintTimeline.PREV_COMPRESS] != 0;
        constraint.stretch = frames[frame + _IkConstraintTimeline.PREV_STRETCH] != 0;
      }
    } else {
      constraint.mix += (mix + (frames[frame + _IkConstraintTimeline.MIX] - mix) * percent - constraint.mix) * alpha;
      constraint.softness += (softness + (frames[frame + _IkConstraintTimeline.SOFTNESS] - softness) * percent - constraint.softness) * alpha;
      if (direction == base.MixDirection.mixIn) {
        constraint.bendDirection = frames[frame + _IkConstraintTimeline.PREV_BEND_DIRECTION];
        constraint.compress = frames[frame + _IkConstraintTimeline.PREV_COMPRESS] != 0;
        constraint.stretch = frames[frame + _IkConstraintTimeline.PREV_STRETCH] != 0;
      }
    }
  }
};
let IkConstraintTimeline = _IkConstraintTimeline;
IkConstraintTimeline.ENTRIES = 6;
IkConstraintTimeline.PREV_TIME = -6;
IkConstraintTimeline.PREV_MIX = -5;
IkConstraintTimeline.PREV_SOFTNESS = -4;
IkConstraintTimeline.PREV_BEND_DIRECTION = -3;
IkConstraintTimeline.PREV_COMPRESS = -2;
IkConstraintTimeline.PREV_STRETCH = -1;
IkConstraintTimeline.MIX = 1;
IkConstraintTimeline.SOFTNESS = 2;
IkConstraintTimeline.BEND_DIRECTION = 3;
IkConstraintTimeline.COMPRESS = 4;
IkConstraintTimeline.STRETCH = 5;
const _TransformConstraintTimeline = class extends CurveTimeline {
  // time, rotate mix, translate mix, scale mix, shear mix, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount * _TransformConstraintTimeline.ENTRIES);
  }
  getPropertyId() {
    return (10 /* transformConstraint */ << 24) + this.transformConstraintIndex;
  }
  /** The time in seconds, rotate mix, translate mix, scale mix, and shear mix for the specified key frame. */
  setFrame(frameIndex, time, rotateMix, translateMix, scaleMix, shearMix) {
    frameIndex *= _TransformConstraintTimeline.ENTRIES;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _TransformConstraintTimeline.ROTATE] = rotateMix;
    this.frames[frameIndex + _TransformConstraintTimeline.TRANSLATE] = translateMix;
    this.frames[frameIndex + _TransformConstraintTimeline.SCALE] = scaleMix;
    this.frames[frameIndex + _TransformConstraintTimeline.SHEAR] = shearMix;
  }
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    const frames = this.frames;
    const constraint = skeleton.transformConstraints[this.transformConstraintIndex];
    if (!constraint.active)
      return;
    if (time < frames[0]) {
      const data = constraint.data;
      switch (blend) {
        case base.MixBlend.setup:
          constraint.rotateMix = data.rotateMix;
          constraint.translateMix = data.translateMix;
          constraint.scaleMix = data.scaleMix;
          constraint.shearMix = data.shearMix;
          return;
        case base.MixBlend.first:
          constraint.rotateMix += (data.rotateMix - constraint.rotateMix) * alpha;
          constraint.translateMix += (data.translateMix - constraint.translateMix) * alpha;
          constraint.scaleMix += (data.scaleMix - constraint.scaleMix) * alpha;
          constraint.shearMix += (data.shearMix - constraint.shearMix) * alpha;
      }
      return;
    }
    let rotate = 0;
    let translate = 0;
    let scale = 0;
    let shear = 0;
    if (time >= frames[frames.length - _TransformConstraintTimeline.ENTRIES]) {
      const i = frames.length;
      rotate = frames[i + _TransformConstraintTimeline.PREV_ROTATE];
      translate = frames[i + _TransformConstraintTimeline.PREV_TRANSLATE];
      scale = frames[i + _TransformConstraintTimeline.PREV_SCALE];
      shear = frames[i + _TransformConstraintTimeline.PREV_SHEAR];
    } else {
      const frame = Animation.binarySearch(frames, time, _TransformConstraintTimeline.ENTRIES);
      rotate = frames[frame + _TransformConstraintTimeline.PREV_ROTATE];
      translate = frames[frame + _TransformConstraintTimeline.PREV_TRANSLATE];
      scale = frames[frame + _TransformConstraintTimeline.PREV_SCALE];
      shear = frames[frame + _TransformConstraintTimeline.PREV_SHEAR];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(
        frame / _TransformConstraintTimeline.ENTRIES - 1,
        1 - (time - frameTime) / (frames[frame + _TransformConstraintTimeline.PREV_TIME] - frameTime)
      );
      rotate += (frames[frame + _TransformConstraintTimeline.ROTATE] - rotate) * percent;
      translate += (frames[frame + _TransformConstraintTimeline.TRANSLATE] - translate) * percent;
      scale += (frames[frame + _TransformConstraintTimeline.SCALE] - scale) * percent;
      shear += (frames[frame + _TransformConstraintTimeline.SHEAR] - shear) * percent;
    }
    if (blend == base.MixBlend.setup) {
      const data = constraint.data;
      constraint.rotateMix = data.rotateMix + (rotate - data.rotateMix) * alpha;
      constraint.translateMix = data.translateMix + (translate - data.translateMix) * alpha;
      constraint.scaleMix = data.scaleMix + (scale - data.scaleMix) * alpha;
      constraint.shearMix = data.shearMix + (shear - data.shearMix) * alpha;
    } else {
      constraint.rotateMix += (rotate - constraint.rotateMix) * alpha;
      constraint.translateMix += (translate - constraint.translateMix) * alpha;
      constraint.scaleMix += (scale - constraint.scaleMix) * alpha;
      constraint.shearMix += (shear - constraint.shearMix) * alpha;
    }
  }
};
let TransformConstraintTimeline = _TransformConstraintTimeline;
TransformConstraintTimeline.ENTRIES = 5;
TransformConstraintTimeline.PREV_TIME = -5;
TransformConstraintTimeline.PREV_ROTATE = -4;
TransformConstraintTimeline.PREV_TRANSLATE = -3;
TransformConstraintTimeline.PREV_SCALE = -2;
TransformConstraintTimeline.PREV_SHEAR = -1;
TransformConstraintTimeline.ROTATE = 1;
TransformConstraintTimeline.TRANSLATE = 2;
TransformConstraintTimeline.SCALE = 3;
TransformConstraintTimeline.SHEAR = 4;
const _PathConstraintPositionTimeline = class extends CurveTimeline {
  // time, position, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount * _PathConstraintPositionTimeline.ENTRIES);
  }
  getPropertyId() {
    return (11 /* pathConstraintPosition */ << 24) + this.pathConstraintIndex;
  }
  /** Sets the time in seconds and path constraint position for the specified key frame. */
  setFrame(frameIndex, time, value) {
    frameIndex *= _PathConstraintPositionTimeline.ENTRIES;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _PathConstraintPositionTimeline.VALUE] = value;
  }
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    const frames = this.frames;
    const constraint = skeleton.pathConstraints[this.pathConstraintIndex];
    if (!constraint.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          constraint.position = constraint.data.position;
          return;
        case base.MixBlend.first:
          constraint.position += (constraint.data.position - constraint.position) * alpha;
      }
      return;
    }
    let position = 0;
    if (time >= frames[frames.length - _PathConstraintPositionTimeline.ENTRIES])
      position = frames[frames.length + _PathConstraintPositionTimeline.PREV_VALUE];
    else {
      const frame = Animation.binarySearch(frames, time, _PathConstraintPositionTimeline.ENTRIES);
      position = frames[frame + _PathConstraintPositionTimeline.PREV_VALUE];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(
        frame / _PathConstraintPositionTimeline.ENTRIES - 1,
        1 - (time - frameTime) / (frames[frame + _PathConstraintPositionTimeline.PREV_TIME] - frameTime)
      );
      position += (frames[frame + _PathConstraintPositionTimeline.VALUE] - position) * percent;
    }
    if (blend == base.MixBlend.setup)
      constraint.position = constraint.data.position + (position - constraint.data.position) * alpha;
    else
      constraint.position += (position - constraint.position) * alpha;
  }
};
let PathConstraintPositionTimeline = _PathConstraintPositionTimeline;
PathConstraintPositionTimeline.ENTRIES = 2;
PathConstraintPositionTimeline.PREV_TIME = -2;
PathConstraintPositionTimeline.PREV_VALUE = -1;
PathConstraintPositionTimeline.VALUE = 1;
class PathConstraintSpacingTimeline extends PathConstraintPositionTimeline {
  constructor(frameCount) {
    super(frameCount);
  }
  getPropertyId() {
    return (12 /* pathConstraintSpacing */ << 24) + this.pathConstraintIndex;
  }
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    const frames = this.frames;
    const constraint = skeleton.pathConstraints[this.pathConstraintIndex];
    if (!constraint.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          constraint.spacing = constraint.data.spacing;
          return;
        case base.MixBlend.first:
          constraint.spacing += (constraint.data.spacing - constraint.spacing) * alpha;
      }
      return;
    }
    let spacing = 0;
    if (time >= frames[frames.length - PathConstraintSpacingTimeline.ENTRIES])
      spacing = frames[frames.length + PathConstraintSpacingTimeline.PREV_VALUE];
    else {
      const frame = Animation.binarySearch(frames, time, PathConstraintSpacingTimeline.ENTRIES);
      spacing = frames[frame + PathConstraintSpacingTimeline.PREV_VALUE];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(
        frame / PathConstraintSpacingTimeline.ENTRIES - 1,
        1 - (time - frameTime) / (frames[frame + PathConstraintSpacingTimeline.PREV_TIME] - frameTime)
      );
      spacing += (frames[frame + PathConstraintSpacingTimeline.VALUE] - spacing) * percent;
    }
    if (blend == base.MixBlend.setup)
      constraint.spacing = constraint.data.spacing + (spacing - constraint.data.spacing) * alpha;
    else
      constraint.spacing += (spacing - constraint.spacing) * alpha;
  }
}
const _PathConstraintMixTimeline = class extends CurveTimeline {
  // time, rotate mix, translate mix, ...
  constructor(frameCount) {
    super(frameCount);
    this.frames = base.Utils.newFloatArray(frameCount * _PathConstraintMixTimeline.ENTRIES);
  }
  getPropertyId() {
    return (13 /* pathConstraintMix */ << 24) + this.pathConstraintIndex;
  }
  /** The time in seconds, rotate mix, and translate mix for the specified key frame. */
  setFrame(frameIndex, time, rotateMix, translateMix) {
    frameIndex *= _PathConstraintMixTimeline.ENTRIES;
    this.frames[frameIndex] = time;
    this.frames[frameIndex + _PathConstraintMixTimeline.ROTATE] = rotateMix;
    this.frames[frameIndex + _PathConstraintMixTimeline.TRANSLATE] = translateMix;
  }
  apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction) {
    const frames = this.frames;
    const constraint = skeleton.pathConstraints[this.pathConstraintIndex];
    if (!constraint.active)
      return;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          constraint.rotateMix = constraint.data.rotateMix;
          constraint.translateMix = constraint.data.translateMix;
          return;
        case base.MixBlend.first:
          constraint.rotateMix += (constraint.data.rotateMix - constraint.rotateMix) * alpha;
          constraint.translateMix += (constraint.data.translateMix - constraint.translateMix) * alpha;
      }
      return;
    }
    let rotate = 0;
    let translate = 0;
    if (time >= frames[frames.length - _PathConstraintMixTimeline.ENTRIES]) {
      rotate = frames[frames.length + _PathConstraintMixTimeline.PREV_ROTATE];
      translate = frames[frames.length + _PathConstraintMixTimeline.PREV_TRANSLATE];
    } else {
      const frame = Animation.binarySearch(frames, time, _PathConstraintMixTimeline.ENTRIES);
      rotate = frames[frame + _PathConstraintMixTimeline.PREV_ROTATE];
      translate = frames[frame + _PathConstraintMixTimeline.PREV_TRANSLATE];
      const frameTime = frames[frame];
      const percent = this.getCurvePercent(
        frame / _PathConstraintMixTimeline.ENTRIES - 1,
        1 - (time - frameTime) / (frames[frame + _PathConstraintMixTimeline.PREV_TIME] - frameTime)
      );
      rotate += (frames[frame + _PathConstraintMixTimeline.ROTATE] - rotate) * percent;
      translate += (frames[frame + _PathConstraintMixTimeline.TRANSLATE] - translate) * percent;
    }
    if (blend == base.MixBlend.setup) {
      constraint.rotateMix = constraint.data.rotateMix + (rotate - constraint.data.rotateMix) * alpha;
      constraint.translateMix = constraint.data.translateMix + (translate - constraint.data.translateMix) * alpha;
    } else {
      constraint.rotateMix += (rotate - constraint.rotateMix) * alpha;
      constraint.translateMix += (translate - constraint.translateMix) * alpha;
    }
  }
};
let PathConstraintMixTimeline = _PathConstraintMixTimeline;
PathConstraintMixTimeline.ENTRIES = 3;
PathConstraintMixTimeline.PREV_TIME = -3;
PathConstraintMixTimeline.PREV_ROTATE = -2;
PathConstraintMixTimeline.PREV_TRANSLATE = -1;
PathConstraintMixTimeline.ROTATE = 1;
PathConstraintMixTimeline.TRANSLATE = 2;

exports.Animation = Animation;
exports.AttachmentTimeline = AttachmentTimeline;
exports.ColorTimeline = ColorTimeline;
exports.CurveTimeline = CurveTimeline;
exports.DeformTimeline = DeformTimeline;
exports.DrawOrderTimeline = DrawOrderTimeline;
exports.EventTimeline = EventTimeline;
exports.IkConstraintTimeline = IkConstraintTimeline;
exports.PathConstraintMixTimeline = PathConstraintMixTimeline;
exports.PathConstraintPositionTimeline = PathConstraintPositionTimeline;
exports.PathConstraintSpacingTimeline = PathConstraintSpacingTimeline;
exports.RotateTimeline = RotateTimeline;
exports.ScaleTimeline = ScaleTimeline;
exports.ShearTimeline = ShearTimeline;
exports.TimelineType = TimelineType;
exports.TransformConstraintTimeline = TransformConstraintTimeline;
exports.TranslateTimeline = TranslateTimeline;
exports.TwoColorTimeline = TwoColorTimeline;
//# sourceMappingURL=Animation.js.map
