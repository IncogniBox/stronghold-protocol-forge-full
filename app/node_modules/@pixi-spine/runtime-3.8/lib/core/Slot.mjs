import { Color } from '@pixi-spine/base';

class Slot {
  constructor(data, bone) {
    this.deform = new Array();
    if (data == null)
      throw new Error("data cannot be null.");
    if (bone == null)
      throw new Error("bone cannot be null.");
    this.data = data;
    this.bone = bone;
    this.color = new Color();
    this.darkColor = data.darkColor == null ? null : new Color();
    this.setToSetupPose();
    this.blendMode = this.data.blendMode;
  }
  /** @return May be null. */
  getAttachment() {
    return this.attachment;
  }
  /** Sets the attachment and if it changed, resets {@link #getAttachmentTime()} and clears {@link #getAttachmentVertices()}.
   * @param attachment May be null. */
  setAttachment(attachment) {
    if (this.attachment == attachment)
      return;
    this.attachment = attachment;
    this.attachmentTime = this.bone.skeleton.time;
    this.deform.length = 0;
  }
  setAttachmentTime(time) {
    this.attachmentTime = this.bone.skeleton.time - time;
  }
  /** Returns the time since the attachment was set. */
  getAttachmentTime() {
    return this.bone.skeleton.time - this.attachmentTime;
  }
  setToSetupPose() {
    this.color.setFromColor(this.data.color);
    if (this.darkColor != null)
      this.darkColor.setFromColor(this.data.darkColor);
    if (this.data.attachmentName == null)
      this.attachment = null;
    else {
      this.attachment = null;
      this.setAttachment(this.bone.skeleton.getAttachment(this.data.index, this.data.attachmentName));
    }
  }
}

export { Slot };
//# sourceMappingURL=Slot.mjs.map
