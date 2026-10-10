import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color } from '@pixi-spine/base';

class ClippingAttachment extends VertexAttachment {
  // ce3a3aff
  constructor(name) {
    super(name);
    this.type = AttachmentType.Clipping;
    /** Clipping is performed between the clipping polygon's slot and the end slot. Returns null if clipping is done until the end of
     * the skeleton's rendering. */
    this.endSlot = null;
    // Nonessential.
    /** The color of the clipping polygon as it was in Spine. Available only when nonessential data was exported. Clipping polygons
     * are not usually rendered at runtime. */
    this.color = new Color(0.2275, 0.2275, 0.8078, 1);
  }
  copy() {
    const copy = new ClippingAttachment(this.name);
    this.copyTo(copy);
    copy.endSlot = this.endSlot;
    copy.color.setFromColor(this.color);
    return copy;
  }
}

export { ClippingAttachment };
//# sourceMappingURL=ClippingAttachment.mjs.map
