'use strict';

var Constraint = require('./Constraint.js');

class IkConstraintData extends Constraint.ConstraintData {
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

exports.IkConstraintData = IkConstraintData;
//# sourceMappingURL=IkConstraintData.js.map
