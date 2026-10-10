'use strict';

var Constraint = require('./Constraint.js');

class PathConstraintData extends Constraint.ConstraintData {
  constructor(name) {
    super(name, 0, false);
    this.bones = new Array();
  }
}
var SpacingMode = /* @__PURE__ */ ((SpacingMode2) => {
  SpacingMode2[SpacingMode2["Length"] = 0] = "Length";
  SpacingMode2[SpacingMode2["Fixed"] = 1] = "Fixed";
  SpacingMode2[SpacingMode2["Percent"] = 2] = "Percent";
  return SpacingMode2;
})(SpacingMode || {});

exports.PathConstraintData = PathConstraintData;
exports.SpacingMode = SpacingMode;
//# sourceMappingURL=PathConstraintData.js.map
