'use strict';

class TransformConstraintData {
  constructor(name) {
    this.order = 0;
    this.bones = new Array();
    this.rotateMix = 0;
    this.translateMix = 0;
    this.scaleMix = 0;
    this.shearMix = 0;
    this.offsetRotation = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.offsetScaleX = 0;
    this.offsetScaleY = 0;
    this.offsetShearY = 0;
    this.relative = false;
    this.local = false;
    if (name == null)
      throw new Error("name cannot be null.");
    this.name = name;
  }
}

exports.TransformConstraintData = TransformConstraintData;
//# sourceMappingURL=TransformConstraintData.js.map
