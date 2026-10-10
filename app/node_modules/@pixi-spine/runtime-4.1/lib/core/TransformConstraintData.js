'use strict';

var ConstraintData = require('./ConstraintData.js');

class TransformConstraintData extends ConstraintData.ConstraintData {
  constructor(name) {
    super(name, 0, false);
    /** The bones that will be modified by this transform constraint. */
    this.bones = new Array();
    /** The target bone whose world transform will be copied to the constrained bones. */
    this._target = null;
    this.mixRotate = 0;
    this.mixX = 0;
    this.mixY = 0;
    this.mixScaleX = 0;
    this.mixScaleY = 0;
    this.mixShearY = 0;
    /** An offset added to the constrained bone rotation. */
    this.offsetRotation = 0;
    /** An offset added to the constrained bone X translation. */
    this.offsetX = 0;
    /** An offset added to the constrained bone Y translation. */
    this.offsetY = 0;
    /** An offset added to the constrained bone scaleX. */
    this.offsetScaleX = 0;
    /** An offset added to the constrained bone scaleY. */
    this.offsetScaleY = 0;
    /** An offset added to the constrained bone shearY. */
    this.offsetShearY = 0;
    this.relative = false;
    this.local = false;
  }
  set target(boneData) {
    this._target = boneData;
  }
  get target() {
    if (!this._target)
      throw new Error("BoneData not set.");
    else
      return this._target;
  }
}

exports.TransformConstraintData = TransformConstraintData;
//# sourceMappingURL=TransformConstraintData.js.map
