import { TransformMode, Color } from '@pixi-spine/base';

class BoneData {
  constructor(index, name, parent) {
    /** The index of the bone in {@link Skeleton#getBones()}. */
    this.index = 0;
    /** @returns May be null. */
    this.parent = null;
    /** The bone's length. */
    this.length = 0;
    /** The local x translation. */
    this.x = 0;
    /** The local y translation. */
    this.y = 0;
    /** The local rotation. */
    this.rotation = 0;
    /** The local scaleX. */
    this.scaleX = 1;
    /** The local scaleY. */
    this.scaleY = 1;
    /** The local shearX. */
    this.shearX = 0;
    /** The local shearX. */
    this.shearY = 0;
    /** The transform mode for how parent world transforms affect this bone. */
    this.transformMode = TransformMode.Normal;
    /** When true, {@link Skeleton#updateWorldTransform()} only updates this bone if the {@link Skeleton#skin} contains this
     * bone.
     * @see Skin#bones */
    this.skinRequired = false;
    /** The color of the bone as it was in Spine. Available only when nonessential data was exported. Bones are not usually
     * rendered at runtime. */
    this.color = new Color();
    if (index < 0)
      throw new Error("index must be >= 0.");
    if (!name)
      throw new Error("name cannot be null.");
    this.index = index;
    this.name = name;
    this.parent = parent;
  }
}

export { BoneData };
//# sourceMappingURL=BoneData.mjs.map
