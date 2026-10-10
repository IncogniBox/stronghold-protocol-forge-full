import { ConstraintData } from './ConstraintData.mjs';
import { PositionMode, RotateMode } from '@pixi-spine/base';

class PathConstraintData extends ConstraintData {
  constructor(name) {
    super(name, 0, false);
    /** The bones that will be modified by this path constraint. */
    this.bones = new Array();
    /** The slot whose path attachment will be used to constrained the bones. */
    this._target = null;
    /** The mode for positioning the first bone on the path. */
    this.positionMode = PositionMode.Fixed;
    /** The mode for positioning the bones after the first bone on the path. */
    this.spacingMode = SpacingMode.Fixed;
    /** The mode for adjusting the rotation of the bones. */
    this.rotateMode = RotateMode.Chain;
    /** An offset added to the constrained bone rotation. */
    this.offsetRotation = 0;
    /** The position along the path. */
    this.position = 0;
    /** The spacing between bones. */
    this.spacing = 0;
    this.mixRotate = 0;
    this.mixX = 0;
    this.mixY = 0;
  }
  set target(slotData) {
    this._target = slotData;
  }
  get target() {
    if (!this._target)
      throw new Error("SlotData not set.");
    else
      return this._target;
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
