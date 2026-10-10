import { ConstraintData } from './Constraint.mjs';

class PathConstraintData extends ConstraintData {
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

export { PathConstraintData, SpacingMode };
//# sourceMappingURL=PathConstraintData.mjs.map
