import { Color } from '@pixi-spine/base';

class SlotData {
  constructor(index, name, boneData) {
    this.color = new Color(1, 1, 1, 1);
    if (index < 0)
      throw new Error("index must be >= 0.");
    if (name == null)
      throw new Error("name cannot be null.");
    if (boneData == null)
      throw new Error("boneData cannot be null.");
    this.index = index;
    this.name = name;
    this.boneData = boneData;
  }
}

export { SlotData };
//# sourceMappingURL=SlotData.mjs.map
