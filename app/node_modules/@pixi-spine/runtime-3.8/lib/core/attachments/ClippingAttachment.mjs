import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color } from '@pixi-spine/base';

class ClippingAttachment extends VertexAttachment {
  // ce3a3aff
  constructor(name) {
    super(name);
    this.type = AttachmentType.Clipping;
    // Nonessential.
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
