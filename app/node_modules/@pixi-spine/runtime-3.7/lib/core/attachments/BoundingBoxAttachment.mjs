import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color } from '@pixi-spine/base';

class BoundingBoxAttachment extends VertexAttachment {
  constructor(name) {
    super(name);
    this.type = AttachmentType.BoundingBox;
    this.color = new Color(1, 1, 1, 1);
  }
}

export { BoundingBoxAttachment };
//# sourceMappingURL=BoundingBoxAttachment.mjs.map
