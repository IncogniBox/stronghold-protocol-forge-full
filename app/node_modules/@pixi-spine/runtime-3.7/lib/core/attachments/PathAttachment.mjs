import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color } from '@pixi-spine/base';

class PathAttachment extends VertexAttachment {
  constructor(name) {
    super(name);
    this.type = AttachmentType.Path;
    this.closed = false;
    this.constantSpeed = false;
    this.color = new Color(1, 1, 1, 1);
  }
}

export { PathAttachment };
//# sourceMappingURL=PathAttachment.mjs.map
