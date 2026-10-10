import { Color } from '@pixi-spine/base';
import { BLEND_MODES } from '@pixi/core';

class SlotData {
  constructor(index, name, boneData) {
    /** The index of the slot in {@link Skeleton#getSlots()}. */
    this.index = 0;
    /** The color used to tint the slot's attachment. If {@link #getDarkColor()} is set, this is used as the light color for two
     * color tinting. */
    this.color = new Color(1, 1, 1, 1);
    /** The dark color used to tint the slot's attachment for two color tinting, or null if two color tinting is not used. The dark
     * color's alpha is not used. */
    this.darkColor = null;
    /** The name of the attachment that is visible for this slot in the setup pose, or null if no attachment is visible. */
    this.attachmentName = null;
    /** The blend mode for drawing the slot's attachment. */
    this.blendMode = BLEND_MODES.NORMAL;
    if (index < 0)
      throw new Error("index must be >= 0.");
    if (!name)
      throw new Error("name cannot be null.");
    if (!boneData)
      throw new Error("boneData cannot be null.");
    this.index = index;
    this.name = name;
    this.boneData = boneData;
  }
}

export { SlotData };
//# sourceMappingURL=SlotData.mjs.map
