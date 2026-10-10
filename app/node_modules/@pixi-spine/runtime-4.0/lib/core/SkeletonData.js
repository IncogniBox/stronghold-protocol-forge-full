'use strict';

class SkeletonData {
  constructor() {
    /** The skeleton's name, which by default is the name of the skeleton data file, if possible. May be null. */
    this.name = null;
    /** The skeleton's bones, sorted parent first. The root bone is always the first bone. */
    this.bones = new Array();
    // Ordered parents first.
    /** The skeleton's slots. */
    this.slots = new Array();
    // Setup pose draw order.
    this.skins = new Array();
    /** The skeleton's default skin. By default this skin contains all attachments that were not in a skin in Spine.
     *
     * See {@link Skeleton#getAttachmentByName()}.
     * May be null. */
    this.defaultSkin = null;
    /** The skeleton's events. */
    this.events = new Array();
    /** The skeleton's animations. */
    this.animations = new Array();
    /** The skeleton's IK constraints. */
    this.ikConstraints = new Array();
    /** The skeleton's transform constraints. */
    this.transformConstraints = new Array();
    /** The skeleton's path constraints. */
    this.pathConstraints = new Array();
    /** The X coordinate of the skeleton's axis aligned bounding box in the setup pose. */
    this.x = 0;
    /** The Y coordinate of the skeleton's axis aligned bounding box in the setup pose. */
    this.y = 0;
    /** The width of the skeleton's axis aligned bounding box in the setup pose. */
    this.width = 0;
    /** The height of the skeleton's axis aligned bounding box in the setup pose. */
    this.height = 0;
    /** The Spine version used to export the skeleton data, or null. */
    this.version = null;
    /** The skeleton data hash. This value will change if any of the skeleton data has changed. May be null. */
    this.hash = null;
    // Nonessential
    /** The dopesheet FPS in Spine. Available only when nonessential data was exported. */
    this.fps = 0;
    /** The path to the images directory as defined in Spine. Available only when nonessential data was exported. May be null. */
    this.imagesPath = null;
    /** The path to the audio directory as defined in Spine. Available only when nonessential data was exported. May be null. */
    this.audioPath = null;
  }
  /** Finds a bone by comparing each bone's name. It is more efficient to cache the results of this method than to call it
   * multiple times.
   * @returns May be null. */
  findBone(boneName) {
    if (!boneName)
      throw new Error("boneName cannot be null.");
    const bones = this.bones;
    for (let i = 0, n = bones.length; i < n; i++) {
      const bone = bones[i];
      if (bone.name == boneName)
        return bone;
    }
    return null;
  }
  /** removed from spine-ts runtime **/
  findBoneIndex(boneName) {
    if (!boneName)
      throw new Error("boneName cannot be null.");
    const bones = this.bones;
    for (let i = 0, n = bones.length; i < n; i++)
      if (bones[i].name == boneName)
        return i;
    return -1;
  }
  /** Finds a slot by comparing each slot's name. It is more efficient to cache the results of this method than to call it
   * multiple times.
   * @returns May be null. */
  findSlot(slotName) {
    if (!slotName)
      throw new Error("slotName cannot be null.");
    const slots = this.slots;
    for (let i = 0, n = slots.length; i < n; i++) {
      const slot = slots[i];
      if (slot.name == slotName)
        return slot;
    }
    return null;
  }
  /** removed from spine-ts runtime **/
  findSlotIndex(slotName) {
    if (!slotName)
      throw new Error("slotName cannot be null.");
    const slots = this.slots;
    for (let i = 0, n = slots.length; i < n; i++)
      if (slots[i].name == slotName)
        return i;
    return -1;
  }
  /** Finds a skin by comparing each skin's name. It is more efficient to cache the results of this method than to call it
   * multiple times.
   * @returns May be null. */
  findSkin(skinName) {
    if (!skinName)
      throw new Error("skinName cannot be null.");
    const skins = this.skins;
    for (let i = 0, n = skins.length; i < n; i++) {
      const skin = skins[i];
      if (skin.name == skinName)
        return skin;
    }
    return null;
  }
  /** Finds an event by comparing each events's name. It is more efficient to cache the results of this method than to call it
   * multiple times.
   * @returns May be null. */
  findEvent(eventDataName) {
    if (!eventDataName)
      throw new Error("eventDataName cannot be null.");
    const events = this.events;
    for (let i = 0, n = events.length; i < n; i++) {
      const event = events[i];
      if (event.name == eventDataName)
        return event;
    }
    return null;
  }
  /** Finds an animation by comparing each animation's name. It is more efficient to cache the results of this method than to
   * call it multiple times.
   * @returns May be null. */
  findAnimation(animationName) {
    if (!animationName)
      throw new Error("animationName cannot be null.");
    const animations = this.animations;
    for (let i = 0, n = animations.length; i < n; i++) {
      const animation = animations[i];
      if (animation.name == animationName)
        return animation;
    }
    return null;
  }
  /** Finds an IK constraint by comparing each IK constraint's name. It is more efficient to cache the results of this method
   * than to call it multiple times.
   * @return May be null. */
  findIkConstraint(constraintName) {
    if (!constraintName)
      throw new Error("constraintName cannot be null.");
    const ikConstraints = this.ikConstraints;
    for (let i = 0, n = ikConstraints.length; i < n; i++) {
      const constraint = ikConstraints[i];
      if (constraint.name == constraintName)
        return constraint;
    }
    return null;
  }
  /** Finds a transform constraint by comparing each transform constraint's name. It is more efficient to cache the results of
   * this method than to call it multiple times.
   * @return May be null. */
  findTransformConstraint(constraintName) {
    if (!constraintName)
      throw new Error("constraintName cannot be null.");
    const transformConstraints = this.transformConstraints;
    for (let i = 0, n = transformConstraints.length; i < n; i++) {
      const constraint = transformConstraints[i];
      if (constraint.name == constraintName)
        return constraint;
    }
    return null;
  }
  /** Finds a path constraint by comparing each path constraint's name. It is more efficient to cache the results of this method
   * than to call it multiple times.
   * @return May be null. */
  findPathConstraint(constraintName) {
    if (!constraintName)
      throw new Error("constraintName cannot be null.");
    const pathConstraints = this.pathConstraints;
    for (let i = 0, n = pathConstraints.length; i < n; i++) {
      const constraint = pathConstraints[i];
      if (constraint.name == constraintName)
        return constraint;
    }
    return null;
  }
  /** removed from spine-ts runtime **/
  findPathConstraintIndex(pathConstraintName) {
    if (pathConstraintName == null)
      throw new Error("pathConstraintName cannot be null.");
    const pathConstraints = this.pathConstraints;
    for (let i = 0, n = pathConstraints.length; i < n; i++)
      if (pathConstraints[i].name == pathConstraintName)
        return i;
    return -1;
  }
}

exports.SkeletonData = SkeletonData;
//# sourceMappingURL=SkeletonData.js.map
