'use strict';

var base = require('@pixi-spine/base');
var Animation = require('./Animation.js');

const _AnimationState = class {
  constructor(data) {
    this.tracks = new Array();
    this.events = new Array();
    this.listeners = new Array();
    this.queue = new EventQueue(this);
    this.propertyIDs = new base.IntSet();
    this.animationsChanged = false;
    this.timeScale = 1;
    this.trackEntryPool = new base.Pool(() => new TrackEntry());
    this.data = data;
  }
  update(delta) {
    delta *= this.timeScale;
    const tracks = this.tracks;
    for (let i = 0, n = tracks.length; i < n; i++) {
      const current = tracks[i];
      if (current == null)
        continue;
      current.animationLast = current.nextAnimationLast;
      current.trackLast = current.nextTrackLast;
      let currentDelta = delta * current.timeScale;
      if (current.delay > 0) {
        current.delay -= currentDelta;
        if (current.delay > 0)
          continue;
        currentDelta = -current.delay;
        current.delay = 0;
      }
      let next = current.next;
      if (next != null) {
        const nextTime = current.trackLast - next.delay;
        if (nextTime >= 0) {
          next.delay = 0;
          next.trackTime = current.timeScale == 0 ? 0 : (nextTime / current.timeScale + delta) * next.timeScale;
          current.trackTime += currentDelta;
          this.setCurrent(i, next, true);
          while (next.mixingFrom != null) {
            next.mixTime += delta;
            next = next.mixingFrom;
          }
          continue;
        }
      } else if (current.trackLast >= current.trackEnd && current.mixingFrom == null) {
        tracks[i] = null;
        this.queue.end(current);
        this.disposeNext(current);
        continue;
      }
      if (current.mixingFrom != null && this.updateMixingFrom(current, delta)) {
        let from = current.mixingFrom;
        current.mixingFrom = null;
        if (from != null)
          from.mixingTo = null;
        while (from != null) {
          this.queue.end(from);
          from = from.mixingFrom;
        }
      }
      current.trackTime += currentDelta;
    }
    this.queue.drain();
  }
  updateMixingFrom(to, delta) {
    const from = to.mixingFrom;
    if (from == null)
      return true;
    const finished = this.updateMixingFrom(from, delta);
    from.animationLast = from.nextAnimationLast;
    from.trackLast = from.nextTrackLast;
    if (to.mixTime > 0 && to.mixTime >= to.mixDuration) {
      if (from.totalAlpha == 0 || to.mixDuration == 0) {
        to.mixingFrom = from.mixingFrom;
        if (from.mixingFrom != null)
          from.mixingFrom.mixingTo = to;
        to.interruptAlpha = from.interruptAlpha;
        this.queue.end(from);
      }
      return finished;
    }
    from.trackTime += delta * from.timeScale;
    to.mixTime += delta;
    return false;
  }
  apply(skeleton) {
    if (skeleton == null)
      throw new Error("skeleton cannot be null.");
    if (this.animationsChanged)
      this._animationsChanged();
    const events = this.events;
    const tracks = this.tracks;
    let applied = false;
    for (let i = 0, n = tracks.length; i < n; i++) {
      const current = tracks[i];
      if (current == null || current.delay > 0)
        continue;
      applied = true;
      const blend = i == 0 ? base.MixBlend.first : current.mixBlend;
      let mix = current.alpha;
      if (current.mixingFrom != null)
        mix *= this.applyMixingFrom(current, skeleton, blend);
      else if (current.trackTime >= current.trackEnd && current.next == null)
        mix = 0;
      const animationLast = current.animationLast;
      const animationTime = current.getAnimationTime();
      const timelineCount = current.animation.timelines.length;
      const timelines = current.animation.timelines;
      if (i == 0 && mix == 1 || blend == base.MixBlend.add) {
        for (let ii = 0; ii < timelineCount; ii++) {
          base.Utils.webkit602BugfixHelper(mix, blend);
          timelines[ii].apply(skeleton, animationLast, animationTime, events, mix, blend, base.MixDirection.mixIn);
        }
      } else {
        const timelineMode = current.timelineMode;
        const firstFrame = current.timelinesRotation.length == 0;
        if (firstFrame)
          base.Utils.setArraySize(current.timelinesRotation, timelineCount << 1, null);
        const timelinesRotation = current.timelinesRotation;
        for (let ii = 0; ii < timelineCount; ii++) {
          const timeline = timelines[ii];
          const timelineBlend = timelineMode[ii] == _AnimationState.SUBSEQUENT ? blend : base.MixBlend.setup;
          if (timeline instanceof Animation.RotateTimeline) {
            this.applyRotateTimeline(timeline, skeleton, animationTime, mix, timelineBlend, timelinesRotation, ii << 1, firstFrame);
          } else {
            base.Utils.webkit602BugfixHelper(mix, blend);
            timeline.apply(skeleton, animationLast, animationTime, events, mix, timelineBlend, base.MixDirection.mixIn);
          }
        }
      }
      this.queueEvents(current, animationTime);
      events.length = 0;
      current.nextAnimationLast = animationTime;
      current.nextTrackLast = current.trackTime;
    }
    this.queue.drain();
    return applied;
  }
  applyMixingFrom(to, skeleton, blend) {
    const from = to.mixingFrom;
    if (from.mixingFrom != null)
      this.applyMixingFrom(from, skeleton, blend);
    let mix = 0;
    if (to.mixDuration == 0) {
      mix = 1;
      if (blend == base.MixBlend.first)
        blend = base.MixBlend.setup;
    } else {
      mix = to.mixTime / to.mixDuration;
      if (mix > 1)
        mix = 1;
      if (blend != base.MixBlend.first)
        blend = from.mixBlend;
    }
    const events = mix < from.eventThreshold ? this.events : null;
    const attachments = mix < from.attachmentThreshold;
    const drawOrder = mix < from.drawOrderThreshold;
    const animationLast = from.animationLast;
    const animationTime = from.getAnimationTime();
    const timelineCount = from.animation.timelines.length;
    const timelines = from.animation.timelines;
    const alphaHold = from.alpha * to.interruptAlpha;
    const alphaMix = alphaHold * (1 - mix);
    if (blend == base.MixBlend.add) {
      for (let i = 0; i < timelineCount; i++)
        timelines[i].apply(skeleton, animationLast, animationTime, events, alphaMix, blend, base.MixDirection.mixOut);
    } else {
      const timelineMode = from.timelineMode;
      const timelineHoldMix = from.timelineHoldMix;
      const firstFrame = from.timelinesRotation.length == 0;
      if (firstFrame)
        base.Utils.setArraySize(from.timelinesRotation, timelineCount << 1, null);
      const timelinesRotation = from.timelinesRotation;
      from.totalAlpha = 0;
      for (let i = 0; i < timelineCount; i++) {
        const timeline = timelines[i];
        let direction = base.MixDirection.mixOut;
        let timelineBlend;
        let alpha = 0;
        switch (timelineMode[i]) {
          case _AnimationState.SUBSEQUENT:
            if (!attachments && timeline instanceof Animation.AttachmentTimeline)
              continue;
            if (!drawOrder && timeline instanceof Animation.DrawOrderTimeline)
              continue;
            timelineBlend = blend;
            alpha = alphaMix;
            break;
          case _AnimationState.FIRST:
            timelineBlend = base.MixBlend.setup;
            alpha = alphaMix;
            break;
          case _AnimationState.HOLD:
            timelineBlend = base.MixBlend.setup;
            alpha = alphaHold;
            break;
          default:
            timelineBlend = base.MixBlend.setup;
            const holdMix = timelineHoldMix[i];
            alpha = alphaHold * Math.max(0, 1 - holdMix.mixTime / holdMix.mixDuration);
            break;
        }
        from.totalAlpha += alpha;
        if (timeline instanceof Animation.RotateTimeline)
          this.applyRotateTimeline(timeline, skeleton, animationTime, alpha, timelineBlend, timelinesRotation, i << 1, firstFrame);
        else {
          base.Utils.webkit602BugfixHelper(alpha, blend);
          if (timelineBlend == base.MixBlend.setup) {
            if (timeline instanceof Animation.AttachmentTimeline) {
              if (attachments)
                direction = base.MixDirection.mixOut;
            } else if (timeline instanceof Animation.DrawOrderTimeline) {
              if (drawOrder)
                direction = base.MixDirection.mixOut;
            }
          }
          timeline.apply(skeleton, animationLast, animationTime, events, alpha, timelineBlend, direction);
        }
      }
    }
    if (to.mixDuration > 0)
      this.queueEvents(from, animationTime);
    this.events.length = 0;
    from.nextAnimationLast = animationTime;
    from.nextTrackLast = from.trackTime;
    return mix;
  }
  applyRotateTimeline(timeline, skeleton, time, alpha, blend, timelinesRotation, i, firstFrame) {
    if (firstFrame)
      timelinesRotation[i] = 0;
    if (alpha == 1) {
      timeline.apply(skeleton, 0, time, null, 1, blend, base.MixDirection.mixIn);
      return;
    }
    const rotateTimeline = timeline;
    const frames = rotateTimeline.frames;
    const bone = skeleton.bones[rotateTimeline.boneIndex];
    let r1 = 0;
    let r2 = 0;
    if (time < frames[0]) {
      switch (blend) {
        case base.MixBlend.setup:
          bone.rotation = bone.data.rotation;
        default:
          return;
        case base.MixBlend.first:
          r1 = bone.rotation;
          r2 = bone.data.rotation;
      }
    } else {
      r1 = blend == base.MixBlend.setup ? bone.data.rotation : bone.rotation;
      if (time >= frames[frames.length - Animation.RotateTimeline.ENTRIES])
        r2 = bone.data.rotation + frames[frames.length + Animation.RotateTimeline.PREV_ROTATION];
      else {
        const frame = Animation.Animation.binarySearch(frames, time, Animation.RotateTimeline.ENTRIES);
        const prevRotation = frames[frame + Animation.RotateTimeline.PREV_ROTATION];
        const frameTime = frames[frame];
        const percent = rotateTimeline.getCurvePercent((frame >> 1) - 1, 1 - (time - frameTime) / (frames[frame + Animation.RotateTimeline.PREV_TIME] - frameTime));
        r2 = frames[frame + Animation.RotateTimeline.ROTATION] - prevRotation;
        r2 -= (16384 - (16384.499999999996 - r2 / 360 | 0)) * 360;
        r2 = prevRotation + r2 * percent + bone.data.rotation;
        r2 -= (16384 - (16384.499999999996 - r2 / 360 | 0)) * 360;
      }
    }
    let total = 0;
    let diff = r2 - r1;
    diff -= (16384 - (16384.499999999996 - diff / 360 | 0)) * 360;
    if (diff == 0) {
      total = timelinesRotation[i];
    } else {
      let lastTotal = 0;
      let lastDiff = 0;
      if (firstFrame) {
        lastTotal = 0;
        lastDiff = diff;
      } else {
        lastTotal = timelinesRotation[i];
        lastDiff = timelinesRotation[i + 1];
      }
      const current = diff > 0;
      let dir = lastTotal >= 0;
      if (base.MathUtils.signum(lastDiff) != base.MathUtils.signum(diff) && Math.abs(lastDiff) <= 90) {
        if (Math.abs(lastTotal) > 180)
          lastTotal += 360 * base.MathUtils.signum(lastTotal);
        dir = current;
      }
      total = diff + lastTotal - lastTotal % 360;
      if (dir != current)
        total += 360 * base.MathUtils.signum(lastTotal);
      timelinesRotation[i] = total;
    }
    timelinesRotation[i + 1] = diff;
    r1 += total * alpha;
    bone.rotation = r1 - (16384 - (16384.499999999996 - r1 / 360 | 0)) * 360;
  }
  queueEvents(entry, animationTime) {
    const animationStart = entry.animationStart;
    const animationEnd = entry.animationEnd;
    const duration = animationEnd - animationStart;
    const trackLastWrapped = entry.trackLast % duration;
    const events = this.events;
    let i = 0;
    const n = events.length;
    for (; i < n; i++) {
      const event = events[i];
      if (event.time < trackLastWrapped)
        break;
      if (event.time > animationEnd)
        continue;
      this.queue.event(entry, event);
    }
    let complete = false;
    if (entry.loop)
      complete = duration == 0 || trackLastWrapped > entry.trackTime % duration;
    else
      complete = animationTime >= animationEnd && entry.animationLast < animationEnd;
    if (complete)
      this.queue.complete(entry);
    for (; i < n; i++) {
      const event = events[i];
      if (event.time < animationStart)
        continue;
      this.queue.event(entry, events[i]);
    }
  }
  clearTracks() {
    const oldDrainDisabled = this.queue.drainDisabled;
    this.queue.drainDisabled = true;
    for (let i = 0, n = this.tracks.length; i < n; i++)
      this.clearTrack(i);
    this.tracks.length = 0;
    this.queue.drainDisabled = oldDrainDisabled;
    this.queue.drain();
  }
  clearTrack(trackIndex) {
    if (trackIndex >= this.tracks.length)
      return;
    const current = this.tracks[trackIndex];
    if (current == null)
      return;
    this.queue.end(current);
    this.disposeNext(current);
    let entry = current;
    while (true) {
      const from = entry.mixingFrom;
      if (from == null)
        break;
      this.queue.end(from);
      entry.mixingFrom = null;
      entry.mixingTo = null;
      entry = from;
    }
    this.tracks[current.trackIndex] = null;
    this.queue.drain();
  }
  setCurrent(index, current, interrupt) {
    const from = this.expandToIndex(index);
    this.tracks[index] = current;
    if (from != null) {
      if (interrupt)
        this.queue.interrupt(from);
      current.mixingFrom = from;
      from.mixingTo = current;
      current.mixTime = 0;
      if (from.mixingFrom != null && from.mixDuration > 0)
        current.interruptAlpha *= Math.min(1, from.mixTime / from.mixDuration);
      from.timelinesRotation.length = 0;
    }
    this.queue.start(current);
  }
  setAnimation(trackIndex, animationName, loop) {
    const animation = this.data.skeletonData.findAnimation(animationName);
    if (animation == null)
      throw new Error(`Animation not found: ${animationName}`);
    return this.setAnimationWith(trackIndex, animation, loop);
  }
  setAnimationWith(trackIndex, animation, loop) {
    if (animation == null)
      throw new Error("animation cannot be null.");
    let interrupt = true;
    let current = this.expandToIndex(trackIndex);
    if (current != null) {
      if (current.nextTrackLast == -1) {
        this.tracks[trackIndex] = current.mixingFrom;
        this.queue.interrupt(current);
        this.queue.end(current);
        this.disposeNext(current);
        current = current.mixingFrom;
        interrupt = false;
      } else
        this.disposeNext(current);
    }
    const entry = this.trackEntry(trackIndex, animation, loop, current);
    this.setCurrent(trackIndex, entry, interrupt);
    this.queue.drain();
    return entry;
  }
  addAnimation(trackIndex, animationName, loop, delay) {
    const animation = this.data.skeletonData.findAnimation(animationName);
    if (animation == null)
      throw new Error(`Animation not found: ${animationName}`);
    return this.addAnimationWith(trackIndex, animation, loop, delay);
  }
  addAnimationWith(trackIndex, animation, loop, delay) {
    if (animation == null)
      throw new Error("animation cannot be null.");
    let last = this.expandToIndex(trackIndex);
    if (last != null) {
      while (last.next != null)
        last = last.next;
    }
    const entry = this.trackEntry(trackIndex, animation, loop, last);
    if (last == null) {
      this.setCurrent(trackIndex, entry, true);
      this.queue.drain();
    } else {
      last.next = entry;
      if (delay <= 0) {
        const duration = last.animationEnd - last.animationStart;
        if (duration != 0) {
          if (last.loop)
            delay += duration * (1 + (last.trackTime / duration | 0));
          else
            delay += Math.max(duration, last.trackTime);
          delay -= this.data.getMix(last.animation, animation);
        } else
          delay = last.trackTime;
      }
    }
    entry.delay = delay;
    return entry;
  }
  setEmptyAnimation(trackIndex, mixDuration) {
    const entry = this.setAnimationWith(trackIndex, _AnimationState.emptyAnimation, false);
    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;
    return entry;
  }
  addEmptyAnimation(trackIndex, mixDuration, delay) {
    if (delay <= 0)
      delay -= mixDuration;
    const entry = this.addAnimationWith(trackIndex, _AnimationState.emptyAnimation, false, delay);
    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;
    return entry;
  }
  setEmptyAnimations(mixDuration) {
    const oldDrainDisabled = this.queue.drainDisabled;
    this.queue.drainDisabled = true;
    for (let i = 0, n = this.tracks.length; i < n; i++) {
      const current = this.tracks[i];
      if (current != null)
        this.setEmptyAnimation(current.trackIndex, mixDuration);
    }
    this.queue.drainDisabled = oldDrainDisabled;
    this.queue.drain();
  }
  expandToIndex(index) {
    if (index < this.tracks.length)
      return this.tracks[index];
    base.Utils.ensureArrayCapacity(this.tracks, index - this.tracks.length + 1, null);
    this.tracks.length = index + 1;
    return null;
  }
  trackEntry(trackIndex, animation, loop, last) {
    const entry = this.trackEntryPool.obtain();
    entry.trackIndex = trackIndex;
    entry.animation = animation;
    entry.loop = loop;
    entry.holdPrevious = false;
    entry.eventThreshold = 0;
    entry.attachmentThreshold = 0;
    entry.drawOrderThreshold = 0;
    entry.animationStart = 0;
    entry.animationEnd = animation.duration;
    entry.animationLast = -1;
    entry.nextAnimationLast = -1;
    entry.delay = 0;
    entry.trackTime = 0;
    entry.trackLast = -1;
    entry.nextTrackLast = -1;
    entry.trackEnd = Number.MAX_VALUE;
    entry.timeScale = 1;
    entry.alpha = 1;
    entry.interruptAlpha = 1;
    entry.mixTime = 0;
    entry.mixDuration = last == null ? 0 : this.data.getMix(last.animation, animation);
    return entry;
  }
  disposeNext(entry) {
    let next = entry.next;
    while (next != null) {
      this.queue.dispose(next);
      next = next.next;
    }
    entry.next = null;
  }
  _animationsChanged() {
    this.animationsChanged = false;
    this.propertyIDs.clear();
    for (let i = 0, n = this.tracks.length; i < n; i++) {
      let entry = this.tracks[i];
      if (entry == null)
        continue;
      while (entry.mixingFrom != null)
        entry = entry.mixingFrom;
      do {
        if (entry.mixingFrom == null || entry.mixBlend != base.MixBlend.add)
          this.setTimelineModes(entry);
        entry = entry.mixingTo;
      } while (entry != null);
    }
  }
  setTimelineModes(entry) {
    const to = entry.mixingTo;
    const timelines = entry.animation.timelines;
    const timelinesCount = entry.animation.timelines.length;
    const timelineMode = base.Utils.setArraySize(entry.timelineMode, timelinesCount);
    entry.timelineHoldMix.length = 0;
    const timelineDipMix = base.Utils.setArraySize(entry.timelineHoldMix, timelinesCount);
    const propertyIDs = this.propertyIDs;
    if (to != null && to.holdPrevious) {
      for (let i = 0; i < timelinesCount; i++) {
        propertyIDs.add(timelines[i].getPropertyId());
        timelineMode[i] = _AnimationState.HOLD;
      }
      return;
    }
    outer:
      for (let i = 0; i < timelinesCount; i++) {
        const id = timelines[i].getPropertyId();
        if (!propertyIDs.add(id))
          timelineMode[i] = _AnimationState.SUBSEQUENT;
        else if (to == null || !this.hasTimeline(to, id))
          timelineMode[i] = _AnimationState.FIRST;
        else {
          for (let next = to.mixingTo; next != null; next = next.mixingTo) {
            if (this.hasTimeline(next, id))
              continue;
            if (entry.mixDuration > 0) {
              timelineMode[i] = _AnimationState.HOLD_MIX;
              timelineDipMix[i] = next;
              continue outer;
            }
            break;
          }
          timelineMode[i] = _AnimationState.HOLD;
        }
      }
  }
  hasTimeline(entry, id) {
    const timelines = entry.animation.timelines;
    for (let i = 0, n = timelines.length; i < n; i++)
      if (timelines[i].getPropertyId() == id)
        return true;
    return false;
  }
  getCurrent(trackIndex) {
    if (trackIndex >= this.tracks.length)
      return null;
    return this.tracks[trackIndex];
  }
  addListener(listener) {
    if (listener == null)
      throw new Error("listener cannot be null.");
    this.listeners.push(listener);
  }
  /** Removes the listener added with {@link #addListener(AnimationStateListener)}. */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index >= 0)
      this.listeners.splice(index, 1);
  }
  clearListeners() {
    this.listeners.length = 0;
  }
  clearListenerNotifications() {
    this.queue.clear();
  }
  setAnimationByName(trackIndex, animationName, loop) {
    if (!_AnimationState.deprecatedWarning1) {
      _AnimationState.deprecatedWarning1 = true;
      console.warn("Spine Deprecation Warning: AnimationState.setAnimationByName is deprecated, please use setAnimation from now on.");
    }
    this.setAnimation(trackIndex, animationName, loop);
  }
  addAnimationByName(trackIndex, animationName, loop, delay) {
    if (!_AnimationState.deprecatedWarning2) {
      _AnimationState.deprecatedWarning2 = true;
      console.warn("Spine Deprecation Warning: AnimationState.addAnimationByName is deprecated, please use addAnimation from now on.");
    }
    this.addAnimation(trackIndex, animationName, loop, delay);
  }
  hasAnimation(animationName) {
    const animation = this.data.skeletonData.findAnimation(animationName);
    return animation !== null;
  }
  hasAnimationByName(animationName) {
    if (!_AnimationState.deprecatedWarning3) {
      _AnimationState.deprecatedWarning3 = true;
      console.warn("Spine Deprecation Warning: AnimationState.hasAnimationByName is deprecated, please use hasAnimation from now on.");
    }
    return this.hasAnimation(animationName);
  }
};
let AnimationState = _AnimationState;
AnimationState.emptyAnimation = new Animation.Animation("<empty>", [], 0);
AnimationState.SUBSEQUENT = 0;
AnimationState.FIRST = 1;
AnimationState.HOLD = 2;
AnimationState.HOLD_MIX = 3;
AnimationState.deprecatedWarning1 = false;
AnimationState.deprecatedWarning2 = false;
AnimationState.deprecatedWarning3 = false;
const _TrackEntry = class {
  constructor() {
    this.mixBlend = base.MixBlend.replace;
    this.timelineMode = new Array();
    this.timelineHoldMix = new Array();
    this.timelinesRotation = new Array();
  }
  reset() {
    this.next = null;
    this.mixingFrom = null;
    this.mixingTo = null;
    this.animation = null;
    this.listener = null;
    this.timelineMode.length = 0;
    this.timelineHoldMix.length = 0;
    this.timelinesRotation.length = 0;
  }
  getAnimationTime() {
    if (this.loop) {
      const duration = this.animationEnd - this.animationStart;
      if (duration == 0)
        return this.animationStart;
      return this.trackTime % duration + this.animationStart;
    }
    return Math.min(this.trackTime + this.animationStart, this.animationEnd);
  }
  setAnimationLast(animationLast) {
    this.animationLast = animationLast;
    this.nextAnimationLast = animationLast;
  }
  isComplete() {
    return this.trackTime >= this.animationEnd - this.animationStart;
  }
  resetRotationDirections() {
    this.timelinesRotation.length = 0;
  }
  get time() {
    if (!_TrackEntry.deprecatedWarning1) {
      _TrackEntry.deprecatedWarning1 = true;
      console.warn("Spine Deprecation Warning: TrackEntry.time is deprecated, please use trackTime from now on.");
    }
    return this.trackTime;
  }
  set time(value) {
    if (!_TrackEntry.deprecatedWarning1) {
      _TrackEntry.deprecatedWarning1 = true;
      console.warn("Spine Deprecation Warning: TrackEntry.time is deprecated, please use trackTime from now on.");
    }
    this.trackTime = value;
  }
  get endTime() {
    if (!_TrackEntry.deprecatedWarning2) {
      _TrackEntry.deprecatedWarning2 = true;
      console.warn("Spine Deprecation Warning: TrackEntry.endTime is deprecated, please use trackEnd from now on.");
    }
    return this.trackTime;
  }
  set endTime(value) {
    if (!_TrackEntry.deprecatedWarning2) {
      _TrackEntry.deprecatedWarning2 = true;
      console.warn("Spine Deprecation Warning: TrackEntry.endTime is deprecated, please use trackEnd from now on.");
    }
    this.trackTime = value;
  }
  loopsCount() {
    return Math.floor(this.trackTime / this.trackEnd);
  }
};
let TrackEntry = _TrackEntry;
TrackEntry.deprecatedWarning1 = false;
TrackEntry.deprecatedWarning2 = false;
const _EventQueue = class {
  constructor(animState) {
    this.objects = [];
    this.drainDisabled = false;
    this.animState = animState;
  }
  start(entry) {
    this.objects.push(EventType.start);
    this.objects.push(entry);
    this.animState.animationsChanged = true;
  }
  interrupt(entry) {
    this.objects.push(EventType.interrupt);
    this.objects.push(entry);
  }
  end(entry) {
    this.objects.push(EventType.end);
    this.objects.push(entry);
    this.animState.animationsChanged = true;
  }
  dispose(entry) {
    this.objects.push(EventType.dispose);
    this.objects.push(entry);
  }
  complete(entry) {
    this.objects.push(EventType.complete);
    this.objects.push(entry);
  }
  event(entry, event) {
    this.objects.push(EventType.event);
    this.objects.push(entry);
    this.objects.push(event);
  }
  deprecateStuff() {
    if (!_EventQueue.deprecatedWarning1) {
      _EventQueue.deprecatedWarning1 = true;
      console.warn(
        "Spine Deprecation Warning: onComplete, onStart, onEnd, onEvent art deprecated, please use listeners from now on. 'state.addListener({ complete: function(track, event) { } })'"
      );
    }
    return true;
  }
  drain() {
    if (this.drainDisabled)
      return;
    this.drainDisabled = true;
    const objects = this.objects;
    const listeners = this.animState.listeners;
    for (let i = 0; i < objects.length; i += 2) {
      const type = objects[i];
      const entry = objects[i + 1];
      switch (type) {
        case EventType.start:
          if (entry.listener != null && entry.listener.start)
            entry.listener.start(entry);
          for (let ii = 0; ii < listeners.length; ii++)
            if (listeners[ii].start)
              listeners[ii].start(entry);
          entry.onStart && this.deprecateStuff() && entry.onStart(entry.trackIndex);
          this.animState.onStart && this.deprecateStuff() && this.deprecateStuff && this.animState.onStart(entry.trackIndex);
          break;
        case EventType.interrupt:
          if (entry.listener != null && entry.listener.interrupt)
            entry.listener.interrupt(entry);
          for (let ii = 0; ii < listeners.length; ii++)
            if (listeners[ii].interrupt)
              listeners[ii].interrupt(entry);
          break;
        case EventType.end:
          if (entry.listener != null && entry.listener.end)
            entry.listener.end(entry);
          for (let ii = 0; ii < listeners.length; ii++)
            if (listeners[ii].end)
              listeners[ii].end(entry);
          entry.onEnd && this.deprecateStuff() && entry.onEnd(entry.trackIndex);
          this.animState.onEnd && this.deprecateStuff() && this.animState.onEnd(entry.trackIndex);
        case EventType.dispose:
          if (entry.listener != null && entry.listener.dispose)
            entry.listener.dispose(entry);
          for (let ii = 0; ii < listeners.length; ii++)
            if (listeners[ii].dispose)
              listeners[ii].dispose(entry);
          this.animState.trackEntryPool.free(entry);
          break;
        case EventType.complete:
          if (entry.listener != null && entry.listener.complete)
            entry.listener.complete(entry);
          for (let ii = 0; ii < listeners.length; ii++)
            if (listeners[ii].complete)
              listeners[ii].complete(entry);
          const count = base.MathUtils.toInt(entry.loopsCount());
          entry.onComplete && this.deprecateStuff() && entry.onComplete(entry.trackIndex, count);
          this.animState.onComplete && this.deprecateStuff() && this.animState.onComplete(entry.trackIndex, count);
          break;
        case EventType.event:
          const event = objects[i++ + 2];
          if (entry.listener != null && entry.listener.event)
            entry.listener.event(entry, event);
          for (let ii = 0; ii < listeners.length; ii++)
            if (listeners[ii].event)
              listeners[ii].event(entry, event);
          entry.onEvent && this.deprecateStuff() && entry.onEvent(entry.trackIndex, event);
          this.animState.onEvent && this.deprecateStuff() && this.animState.onEvent(entry.trackIndex, event);
          break;
      }
    }
    this.clear();
    this.drainDisabled = false;
  }
  clear() {
    this.objects.length = 0;
  }
};
let EventQueue = _EventQueue;
EventQueue.deprecatedWarning1 = false;
var EventType = /* @__PURE__ */ ((EventType2) => {
  EventType2[EventType2["start"] = 0] = "start";
  EventType2[EventType2["interrupt"] = 1] = "interrupt";
  EventType2[EventType2["end"] = 2] = "end";
  EventType2[EventType2["dispose"] = 3] = "dispose";
  EventType2[EventType2["complete"] = 4] = "complete";
  EventType2[EventType2["event"] = 5] = "event";
  return EventType2;
})(EventType || {});
class AnimationStateAdapter2 {
  start(entry) {
  }
  interrupt(entry) {
  }
  end(entry) {
  }
  dispose(entry) {
  }
  complete(entry) {
  }
  event(entry, event) {
  }
}

exports.AnimationState = AnimationState;
exports.AnimationStateAdapter2 = AnimationStateAdapter2;
exports.EventQueue = EventQueue;
exports.EventType = EventType;
exports.TrackEntry = TrackEntry;
//# sourceMappingURL=AnimationState.js.map
