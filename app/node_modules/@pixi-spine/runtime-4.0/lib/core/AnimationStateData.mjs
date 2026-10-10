class AnimationStateData {
  constructor(skeletonData) {
    this.animationToMixTime = {};
    /** The mix duration to use when no mix duration has been defined between two animations. */
    this.defaultMix = 0;
    if (skeletonData == null)
      throw new Error("skeletonData cannot be null.");
    this.skeletonData = skeletonData;
  }
  /** Sets a mix duration by animation name.
   *
   * See {@link #setMixWith()}. */
  setMix(fromName, toName, duration) {
    const from = this.skeletonData.findAnimation(fromName);
    if (from == null)
      throw new Error(`Animation not found: ${fromName}`);
    const to = this.skeletonData.findAnimation(toName);
    if (to == null)
      throw new Error(`Animation not found: ${toName}`);
    this.setMixWith(from, to, duration);
  }
  /** Sets the mix duration when changing from the specified animation to the other.
   *
   * See {@link TrackEntry#mixDuration}. */
  setMixWith(from, to, duration) {
    if (from == null)
      throw new Error("from cannot be null.");
    if (to == null)
      throw new Error("to cannot be null.");
    const key = `${from.name}.${to.name}`;
    this.animationToMixTime[key] = duration;
  }
  /** Returns the mix duration to use when changing from the specified animation to the other, or the {@link #defaultMix} if
   * no mix duration has been set. */
  getMix(from, to) {
    const key = `${from.name}.${to.name}`;
    const value = this.animationToMixTime[key];
    return value === void 0 ? this.defaultMix : value;
  }
}

export { AnimationStateData };
//# sourceMappingURL=AnimationStateData.mjs.map
