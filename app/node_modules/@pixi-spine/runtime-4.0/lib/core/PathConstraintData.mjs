import { ConstraintData } from './ConstraintData.mjs';

class PathConstraintData extends ConstraintData {
  constructor(name) {
    super(name, 0, false);
    /** The bones that will be modified by this path constraint. */
    this.bones = new Array();
    this.mixRotate = 0;
    this.mixX = 0;
    this.mixY = 0;
  }
}
var SpacingMode = /* @__PURE__ */ ((SpacingMode2) => {
  SpacingMode2[SpacingMode2["Length"] = 0] = "Length";
  SpacingMode2[SpacingMode2["Fixed"] = 1] = "Fixed";
  SpacingMode2[SpacingMode2["Percent"] = 2] = "Percent";
  SpacingMode2[SpacingMode2["Proportional"] = 3] = "Proportional";
  return SpacingMode2;
})(SpacingMode || {});

export { PathConstraintData, SpacingMode };
//# sourceMappingURL=PathConstraintData.mjs.map
