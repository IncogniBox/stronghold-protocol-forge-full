'use strict';

var base = require('@pixi-spine/base');

class SlotData {
  constructor(index, name, boneData) {
    this.color = new base.Color(1, 1, 1, 1);
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

exports.SlotData = SlotData;
//# sourceMappingURL=SlotData.js.map
