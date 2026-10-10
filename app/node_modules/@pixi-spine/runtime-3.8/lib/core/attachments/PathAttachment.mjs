import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color, Utils } from '@pixi-spine/base';

class PathAttachment extends VertexAttachment {
  constructor(name) {
    super(name);
    this.type = AttachmentType.Path;
    this.closed = false;
    this.constantSpeed = false;
    this.color = new Color(1, 1, 1, 1);
  }
  copy() {
    const copy = new PathAttachment(this.name);
    this.copyTo(copy);
    copy.lengths = new Array(this.lengths.length);
    Utils.arrayCopy(this.lengths, 0, copy.lengths, 0, this.lengths.length);
    copy.closed = closed;
    copy.constantSpeed = this.constantSpeed;
    copy.color.setFromColor(this.color);
    return copy;
  }
}

export { PathAttachment };
//# sourceMappingURL=PathAttachment.mjs.map
