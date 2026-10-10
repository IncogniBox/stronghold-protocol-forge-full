import { ConstraintData } from './Constraint.mjs';

class TransformConstraintData extends ConstraintData {
  constructor(name) {
    super(name, 0, false);
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
  }
}

export { TransformConstraintData };
//# sourceMappingURL=TransformConstraintData.mjs.map
