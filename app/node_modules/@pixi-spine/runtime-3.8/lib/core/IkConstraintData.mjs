import { ConstraintData } from './Constraint.mjs';

class IkConstraintData extends ConstraintData {
  constructor(name) {
    super(name, 0, false);
    this.bones = new Array();
    this.bendDirection = 1;
    this.compress = false;
    this.stretch = false;
    this.uniform = false;
    this.mix = 1;
    this.softness = 0;
  }
}

export { IkConstraintData };
//# sourceMappingURL=IkConstraintData.mjs.map
