import { TransformMode } from '@pixi-spine/base';

class BoneData {
  constructor(index, name, parent) {
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.shearX = 0;
    this.shearY = 0;
    this.transformMode = TransformMode.Normal;
    if (index < 0)
      throw new Error("index must be >= 0.");
    if (name == null)
      throw new Error("name cannot be null.");
    this.index = index;
    this.name = name;
    this.parent = parent;
  }
}

export { BoneData };
//# sourceMappingURL=BoneData.mjs.map
