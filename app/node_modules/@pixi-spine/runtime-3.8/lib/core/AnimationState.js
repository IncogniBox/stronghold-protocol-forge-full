'use strict';

var base = require('@pixi-spine/base');
var Animation = require('./Animation.js');

const _AnimationState = class {
  constructor(data) {
    /** The list of tracks that currently have animations, which may contain null entries. */
    this.tracks = new Array();
    /** Multiplier for the delta time when the animation state is updated, causing time for all animations and mixes to play slower
     * or faster. Defaults to 1.
     *
     * See TrackEntry {@link TrackEntry#timeScale} for affecting a single animation. */
    this.timeScale = 1;
    this.unkeyedState = 0;
    this.events = new Array();
    this.listeners = new Array();
    this.queue = new EventQueue(this);
    this.propertyIDs = new base.IntSet();
    this.animationsChanged = false;
    this.trackEntryPool = new base.Pool(() => new TrackEntry());
    this.data = data;
  }
  /** Increments each track entry {@link TrackEntry#trackTime()}, setting queued animations as current if needed. */
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
          next.trackTime += current.timeScale == 0 ? 0 : (nextTime / current.timeScale + delta) * next.timeScale;
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
  /** Returns true when all mixing from entries are complete. */
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
  /** Poses the skeleton using the track entry animations. There are no side effects other than invoking listeners, so the
   * animation state can be applied to multiple skeletons to pose them identically.
   * @returns True if any animations were applied. */
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
          const timeline = timelines[ii];
          if (timeline instanceof Animation.AttachmentTimeline)
            this.applyAttachmentTimeline(timeline, skeleton, animationTime, blend, true);
          else
            timeline.apply(skeleton, animationLast, animationTime, events, mix, blend, base.MixDirection.mixIn);
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
          } else if (timeline instanceof Animation.AttachmentTimeline) {
            this.applyAttachmentTimeline(timeline, skeleton, animationTime, blend, true);
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
    const setupState = this.unkeyedState + _AnimationState.SETUP;
    const slots = skeleton.slots;
    for (let i = 0, n = skeleton.slots.length; i < n; i++) {
      const slot = slots[i];
      if (slot.attachmentState == setupState) {
        const attachmentName = slot.data.attachmentName;
        slot.setAttachment(attachmentName == null ? null : skeleton.getAttachment(slot.data.index, attachmentName));
      }
    }
    this.unkeyedState += 2;
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
            if (!drawOrder && timeline instanceof Animation.DrawOrderTimeline)
              continue;
            timelineBlend = blend;
            alpha = alphaMix;
            break;
          case _AnimationState.FIRST:
            timelineBlend = base.MixBlend.setup;
            alpha = alphaMix;
            break;
          case _AnimationState.HOLD_SUBSEQUENT:
            timelineBlend = blend;
            alpha = alphaHold;
            break;
          case _AnimationState.HOLD_FIRST:
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
        else if (timeline instanceof Animation.AttachmentTimeline)
          this.applyAttachmentTimeline(timeline, skeleton, animationTime, timelineBlend, attachments);
        else {
          base.Utils.webkit602BugfixHelper(alpha, blend);
          if (drawOrder && timeline instanceof Animation.DrawOrderTimeline && timelineBlend == base.MixBlend.setup)
            direction = base.MixDirection.mixIn;
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
  applyAttachmentTimeline(timeline, skeleton, time, blend, attachments) {
    const slot = skeleton.slots[timeline.slotIndex];
    if (!slot.bone.active)
      return;
    const frames = timeline.frames;
    if (time < frames[0]) {
      if (blend == base.MixBlend.setup || blend == base.MixBlend.first)
        this.setAttachment(skeleton, slot, slot.data.attachmentName, attachments);
    } else {
      let frameIndex;
      if (time >= frames[frames.length - 1])
        frameIndex = frames.length - 1;
      else
        frameIndex = Animation.Animation.binarySearch(frames, time) - 1;
      this.setAttachment(skeleton, slot, timeline.attachmentNames[frameIndex], attachments);
    }
    if (slot.attachmentState <= this.unkeyedState)
      slot.attachmentState = this.unkeyedState + _AnimationState.SETUP;
  }
  setAttachment(skeleton, slot, attachmentName, attachments) {
    slot.setAttachment(attachmentName == null ? null : skeleton.getAttachment(slot.data.index, attachmentName));
    if (attachments)
      slot.attachmentState = this.unkeyedState + _AnimationState.CURRENT;
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
    if (!bone.active)
      return;
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
  /** Removes all animations from all tracks, leaving skeletons in their current pose.
   *
   * It may be desired to use {@link AnimationState#setEmptyAnimation()} to mix the skeletons back to the setup pose,
   * rather than leaving them in their current pose. */
  clearTracks() {
    const oldDrainDisabled = this.queue.drainDisabled;
    this.queue.drainDisabled = true;
    for (let i = 0, n = this.tracks.length; i < n; i++)
      this.clearTrack(i);
    this.tracks.length = 0;
    this.queue.drainDisabled = oldDrainDisabled;
    this.queue.drain();
  }
  /** Removes all animations from the track, leaving skeletons in their current pose.
   *
   * It may be desired to use {@link AnimationState#setEmptyAnimation()} to mix the skeletons back to the setup pose,
   * rather than leaving them in their current pose. */
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
  /** Sets an animation by name.
   *
   * {@link #setAnimationWith(}. */
  setAnimation(trackIndex, animationName, loop) {
    const animation = this.data.skeletonData.findAnimation(animationName);
    if (animation == null)
      throw new Error(`Animation not found: ${animationName}`);
    return this.setAnimationWith(trackIndex, animation, loop);
  }
  /** Sets the current animation for a track, discarding any queued animations. If the formerly current track entry was never
   * applied to a skeleton, it is replaced (not mixed from).
   * @param loop If true, the animation will repeat. If false it will not, instead its last frame is applied if played beyond its
   *           duration. In either case {@link TrackEntry#trackEnd} determines when the track is cleared.
   * @returns A track entry to allow further customization of animation playback. References to the track entry must not be kept
   *         after the {@link AnimationStateListener#dispose()} event occurs. */
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
  /** Queues an animation by name.
   *
   * See {@link #addAnimationWith()}. */
  addAnimation(trackIndex, animationName, loop, delay) {
    const animation = this.data.skeletonData.findAnimation(animationName);
    if (animation == null)
      throw new Error(`Animation not found: ${animationName}`);
    return this.addAnimationWith(trackIndex, animation, loop, delay);
  }
  /** Adds an animation to be played after the current or last queued animation for a track. If the track is empty, it is
   * equivalent to calling {@link #setAnimationWith()}.
   * @param delay If > 0, sets {@link TrackEntry#delay}. If <= 0, the delay set is the duration of the previous track entry
   *           minus any mix duration (from the {@link AnimationStateData}) plus the specified `delay` (ie the mix
   *           ends at (`delay` = 0) or before (`delay` < 0) the previous track entry duration). If the
   *           previous entry is looping, its next loop completion is used instead of its duration.
   * @returns A track entry to allow further customization of animation playback. References to the track entry must not be kept
   *         after the {@link AnimationStateListener#dispose()} event occurs. */
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
  /** Sets an empty animation for a track, discarding any queued animations, and sets the track entry's
   * {@link TrackEntry#mixduration}. An empty animation has no timelines and serves as a placeholder for mixing in or out.
   *
   * Mixing out is done by setting an empty animation with a mix duration using either {@link #setEmptyAnimation()},
   * {@link #setEmptyAnimations()}, or {@link #addEmptyAnimation()}. Mixing to an empty animation causes
   * the previous animation to be applied less and less over the mix duration. Properties keyed in the previous animation
   * transition to the value from lower tracks or to the setup pose value if no lower tracks key the property. A mix duration of
   * 0 still mixes out over one frame.
   *
   * Mixing in is done by first setting an empty animation, then adding an animation using
   * {@link #addAnimation()} and on the returned track entry, set the
   * {@link TrackEntry#setMixDuration()}. Mixing from an empty animation causes the new animation to be applied more and
   * more over the mix duration. Properties keyed in the new animation transition from the value from lower tracks or from the
   * setup pose value if no lower tracks key the property to the value keyed in the new animation. */
  setEmptyAnimation(trackIndex, mixDuration) {
    const entry = this.setAnimationWith(trackIndex, _AnimationState.emptyAnimation, false);
    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;
    return entry;
  }
  /** Adds an empty animation to be played after the current or last queued animation for a track, and sets the track entry's
   * {@link TrackEntry#mixDuration}. If the track is empty, it is equivalent to calling
   * {@link #setEmptyAnimation()}.
   *
   * See {@link #setEmptyAnimation()}.
   * @param delay If > 0, sets {@link TrackEntry#delay}. If <= 0, the delay set is the duration of the previous track entry
   *           minus any mix duration plus the specified `delay` (ie the mix ends at (`delay` = 0) or
   *           before (`delay` < 0) the previous track entry duration). If the previous entry is looping, its next
   *           loop completion is used instead of its duration.
   * @return A track entry to allow further customization of animation playback. References to the track entry must not be kept
   *         after the {@link AnimationStateListener#dispose()} event occurs. */
  addEmptyAnimation(trackIndex, mixDuration, delay) {
    if (delay <= 0)
      delay -= mixDuration;
    const entry = this.addAnimationWith(trackIndex, _AnimationState.emptyAnimation, false, delay);
    entry.mixDuration = mixDuration;
    entry.trackEnd = mixDuration;
    return entry;
  }
  /** Sets an empty animation for every track, discarding any queued animations, and mixes to it over the specified mix
   * duration. */
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
    base.Utils.ensureArrayCapacity(this.tracks, index + 1, null);
    this.tracks.length = index + 1;
    return null;
  }
  /** @param last May be null. */
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
    entry.mixBlend = base.MixBlend.replace;
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
          this.computeHold(entry);
        entry = entry.mixingTo;
      } while (entry != null);
    }
  }
  computeHold(entry) {
    const to = entry.mixingTo;
    const timelines = entry.animation.timelines;
    const timelinesCount = entry.animation.timelines.length;
    const timelineMode = base.Utils.setArraySize(entry.timelineMode, timelinesCount);
    entry.timelineHoldMix.length = 0;
    const timelineDipMix = base.Utils.setArraySize(entry.timelineHoldMix, timelinesCount);
    const propertyIDs = this.propertyIDs;
    if (to != null && to.holdPrevious) {
      for (let i = 0; i < timelinesCount; i++) {
        timelineMode[i] = propertyIDs.add(timelines[i].getPropertyId()) ? _AnimationState.HOLD_FIRST : _AnimationState.HOLD_SUBSEQUENT;
      }
      return;
    }
    outer:
      for (let i = 0; i < timelinesCount; i++) {
        const timeline = timelines[i];
        const id = timeline.getPropertyId();
        if (!propertyIDs.add(id))
          timelineMode[i] = _AnimationState.SUBSEQUENT;
        else if (to == null || timeline instanceof Animation.AttachmentTimeline || timeline instanceof Animation.DrawOrderTimeline || timeline instanceof Animation.EventTimeline || !to.animation.hasTimeline(id)) {
          timelineMode[i] = _AnimationState.FIRST;
        } else {
          for (let next = to.mixingTo; next != null; next = next.mixingTo) {
            if (next.animation.hasTimeline(id))
              continue;
            if (entry.mixDuration > 0) {
              timelineMode[i] = _AnimationState.HOLD_MIX;
              timelineDipMix[i] = next;
              continue outer;
            }
            break;
          }
          timelineMode[i] = _AnimationState.HOLD_FIRST;
        }
      }
  }
  /** Returns the track entry for the animation currently playing on the track, or null if no animation is currently playing. */
  getCurrent(trackIndex) {
    if (trackIndex >= this.tracks.length)
      return null;
    return this.tracks[trackIndex];
  }
  /** Adds a listener to receive events for all track entries. */
  addListener(listener) {
    if (listener == null)
      throw new Error("listener cannot be null.");
    this.listeners.push(listener);
  }
  /** Removes the listener added with {@link #addListener()}. */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index >= 0)
      this.listeners.splice(index, 1);
  }
  /** Removes all listeners added with {@link #addListener()}. */
  clearListeners() {
    this.listeners.length = 0;
  }
  /** Discards all listener notifications that have not yet been delivered. This can be useful to call from an
   * {@link AnimationStateListener} when it is known that further notifications that may have been already queued for delivery
   * are not wanted because new animations are being set. */
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
/** 1. A previously applied timeline has set this property.
 *
 * Result: Mix from the current pose to the timeline pose. */
AnimationState.SUBSEQUENT = 0;
/** 1. This is the first timeline to set this property.
 * 2. The next track entry applied after this one does not have a timeline to set this property.
 *
 * Result: Mix from the setup pose to the timeline pose. */
AnimationState.FIRST = 1;
/** 1) A previously applied timeline has set this property.<br>
 * 2) The next track entry to be applied does have a timeline to set this property.<br>
 * 3) The next track entry after that one does not have a timeline to set this property.<br>
 * Result: Mix from the current pose to the timeline pose, but do not mix out. This avoids "dipping" when crossfading
 * animations that key the same property. A subsequent timeline will set this property using a mix. */
AnimationState.HOLD_SUBSEQUENT = 2;
/** 1) This is the first timeline to set this property.<br>
 * 2) The next track entry to be applied does have a timeline to set this property.<br>
 * 3) The next track entry after that one does not have a timeline to set this property.<br>
 * Result: Mix from the setup pose to the timeline pose, but do not mix out. This avoids "dipping" when crossfading animations
 * that key the same property. A subsequent timeline will set this property using a mix. */
AnimationState.HOLD_FIRST = 3;
/** 1. This is the first timeline to set this property.
 * 2. The next track entry to be applied does have a timeline to set this property.
 * 3. The next track entry after that one does have a timeline to set this property.
 * 4. timelineHoldMix stores the first subsequent track entry that does not have a timeline to set this property.
 *
 * Result: The same as HOLD except the mix percentage from the timelineHoldMix track entry is used. This handles when more than
 * 2 track entries in a row have a timeline that sets the same property.
 *
 * Eg, A -> B -> C -> D where A, B, and C have a timeline setting same property, but D does not. When A is applied, to avoid
 * "dipping" A is not mixed out, however D (the first entry that doesn't set the property) mixing in is used to mix out A
 * (which affects B and C). Without using D to mix out, A would be applied fully until mixing completes, then snap into
 * place. */
AnimationState.HOLD_MIX = 4;
AnimationState.SETUP = 1;
AnimationState.CURRENT = 2;
AnimationState.deprecatedWarning1 = false;
AnimationState.deprecatedWarning2 = false;
AnimationState.deprecatedWarning3 = false;
const _TrackEntry = class {
  constructor() {
    /** Controls how properties keyed in the animation are mixed with lower tracks. Defaults to {@link MixBlend#replace}, which
     * replaces the values from the lower tracks with the animation values. {@link MixBlend#add} adds the animation values to
     * the values from the lower tracks.
     *
     * The `mixBlend` can be set for a new track entry only before {@link AnimationState#apply()} is first
     * called. */
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
  /** Uses {@link #trackTime} to compute the `animationTime`, which is between {@link #animationStart}
   * and {@link #animationEnd}. When the `trackTime` is 0, the `animationTime` is equal to the
   * `animationStart` time. */
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
  /** Returns true if at least one loop has been completed.
   *
   * See {@link AnimationStateListener#complete()}. */
  isComplete() {
    return this.trackTime >= this.animationEnd - this.animationStart;
  }
  /** Resets the rotation directions for mixing this entry's rotate timelines. This can be useful to avoid bones rotating the
   * long way around when using {@link #alpha} and starting animations on other tracks.
   *
   * Mixing with {@link MixBlend#replace} involves finding a rotation between two others, which has two possible solutions:
   * the short way or the long way around. The two rotations likely change over time, so which direction is the short or long
   * way also changes. If the short way was always chosen, bones would flip to the other side when that direction became the
   * long way. TrackEntry chooses the short way the first time it is applied and remembers that direction. */
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
class AnimationStateAdapter {
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
exports.AnimationStateAdapter = AnimationStateAdapter;
exports.EventQueue = EventQueue;
exports.EventType = EventType;
exports.TrackEntry = TrackEntry;
//# sourceMappingURL=AnimationState.js.map
