'use strict';

var base = require('@pixi-spine/base');
var Attachment = require('./attachments/Attachment.js');

class Slot {
  constructor(data, bone) {
    /** The dark color used to tint the slot's attachment for two color tinting, or null if two color tinting is not used. The dark
     * color's alpha is not used. */
    this.darkColor = null;
    this.attachment = null;
    this.attachmentState = 0;
    /** The index of the texture region to display when the slot's attachment has a {@link Sequence}. -1 represents the
     * {@link Sequence#getSetupIndex()}. */
    this.sequenceIndex = -1;
    /** Values to deform the slot's attachment. For an unweighted mesh, the entries are local positions for each vertex. For a
     * weighted mesh, the entries are an offset for each vertex which will be added to the mesh's local vertex positions.
     *
     * See {@link VertexAttachment#computeWorldVertices()} and {@link DeformTimeline}. */
    this.deform = new Array();
    if (!data)
      throw new Error("data cannot be null.");
    if (!bone)
      throw new Error("bone cannot be null.");
    this.data = data;
    this.bone = bone;
    this.color = new base.Color();
    this.darkColor = !data.darkColor ? null : new base.Color();
    this.setToSetupPose();
    this.blendMode = this.data.blendMode;
  }
  /** The skeleton this slot belongs to. */
  getSkeleton() {
    return this.bone.skeleton;
  }
  /** The current attachment for the slot, or null if the slot has no attachment. */
  getAttachment() {
    return this.attachment;
  }
  /** Sets the slot's attachment and, if the attachment changed, resets {@link #sequenceIndex} and clears the {@link #deform}.
   * The deform is not cleared if the old attachment has the same {@link VertexAttachment#getTimelineAttachment()} as the
   * specified attachment. */
  setAttachment(attachment) {
    if (this.attachment == attachment)
      return;
    if (!(attachment instanceof Attachment.VertexAttachment) || !(this.attachment instanceof Attachment.VertexAttachment) || attachment.timelineAttachment != this.attachment.timelineAttachment) {
      this.deform.length = 0;
    }
    this.attachment = attachment;
    this.sequenceIndex = -1;
  }
  /** Sets this slot to the setup pose. */
  setToSetupPose() {
    this.color.setFromColor(this.data.color);
    if (this.darkColor)
      this.darkColor.setFromColor(this.data.darkColor);
    if (!this.data.attachmentName)
      this.attachment = null;
    else {
      this.attachment = null;
      this.setAttachment(this.bone.skeleton.getAttachment(this.data.index, this.data.attachmentName));
    }
  }
}

exports.Slot = Slot;
//# sourceMappingURL=Slot.js.map
