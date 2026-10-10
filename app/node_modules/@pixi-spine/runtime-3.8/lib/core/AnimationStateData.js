'use strict';

const _AnimationStateData = class {
  constructor(skeletonData) {
    this.animationToMixTime = {};
    this.defaultMix = 0;
    if (skeletonData == null)
      throw new Error("skeletonData cannot be null.");
    this.skeletonData = skeletonData;
  }
  setMix(fromName, toName, duration) {
    const from = this.skeletonData.findAnimation(fromName);
    if (from == null)
      throw new Error(`Animation not found: ${fromName}`);
    const to = this.skeletonData.findAnimation(toName);
    if (to == null)
      throw new Error(`Animation not found: ${toName}`);
    this.setMixWith(from, to, duration);
  }
  setMixByName(fromName, toName, duration) {
    if (!_AnimationStateData.deprecatedWarning1) {
      _AnimationStateData.deprecatedWarning1 = true;
      console.warn("Deprecation Warning: AnimationStateData.setMixByName is deprecated, please use setMix from now on.");
    }
    this.setMix(fromName, toName, duration);
  }
  setMixWith(from, to, duration) {
    if (from == null)
      throw new Error("from cannot be null.");
    if (to == null)
      throw new Error("to cannot be null.");
    const key = `${from.name}.${to.name}`;
    this.animationToMixTime[key] = duration;
  }
  getMix(from, to) {
    const key = `${from.name}.${to.name}`;
    const value = this.animationToMixTime[key];
    return value === void 0 ? this.defaultMix : value;
  }
};
let AnimationStateData = _AnimationStateData;
AnimationStateData.deprecatedWarning1 = false;

exports.AnimationStateData = AnimationStateData;
//# sourceMappingURL=AnimationStateData.js.map
