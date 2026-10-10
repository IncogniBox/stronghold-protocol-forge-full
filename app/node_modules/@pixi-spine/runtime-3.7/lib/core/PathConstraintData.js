'use strict';

class PathConstraintData {
  constructor(name) {
    this.order = 0;
    this.bones = new Array();
    this.name = name;
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
