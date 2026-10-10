import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color, Utils } from '@pixi-spine/base';

class PathAttachment extends VertexAttachment {
  constructor(name) {
    super(name);
    this.type = AttachmentType.Path;
    /** If true, the start and end knots are connected. */
    this.closed = false;
    /** If true, additional calculations are performed to make calculating positions along the path more accurate. If false, fewer
     * calculations are performed but calculating positions along the path is less accurate. */
    this.constantSpeed = false;
    /** The color of the path as it was in Spine. Available only when nonessential data was exported. Paths are not usually
     * rendered at runtime. */
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
