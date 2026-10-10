import { Color } from '@pixi-spine/base';

class SlotData {
  constructor(index, name, boneData) {
    /** The color used to tint the slot's attachment. If {@link #getDarkColor()} is set, this is used as the light color for two
     * color tinting. */
    this.color = new Color(1, 1, 1, 1);
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
