'use strict';

var ConstraintData = require('./ConstraintData.js');

class IkConstraintData extends ConstraintData.ConstraintData {
  constructor(name) {
    super(name, 0, false);
    /** The bones that are constrained by this IK constraint. */
    this.bones = new Array();
    /** The bone that is the IK target. */
    this._target = null;
    /** Controls the bend direction of the IK bones, either 1 or -1. */
    this.bendDirection = 1;
    /** When true and only a single bone is being constrained, if the target is too close, the bone is scaled to reach it. */
    this.compress = false;
    /** When true, if the target is out of range, the parent bone is scaled to reach it. If more than one bone is being constrained
     * and the parent bone has local nonuniform scale, stretch is not applied. */
    this.stretch = false;
    /** When true, only a single bone is being constrained, and {@link #getCompress()} or {@link #getStretch()} is used, the bone
     * is scaled on both the X and Y axes. */
    this.uniform = false;
    /** A percentage (0-1) that controls the mix between the constrained and unconstrained rotations. */
    this.mix = 1;
    /** For two bone IK, the distance from the maximum reach of the bones that rotation will slow. */
    this.softness = 0;
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

exports.IkConstraintData = IkConstraintData;
//# sourceMappingURL=IkConstraintData.js.map
