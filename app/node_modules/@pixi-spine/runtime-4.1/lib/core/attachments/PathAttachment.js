'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class PathAttachment extends Attachment.VertexAttachment {
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.Path;
    /** The lengths along the path in the setup pose from the start of the path to the end of each Bezier curve. */
    this.lengths = [];
    /** If true, the start and end knots are connected. */
    this.closed = false;
    /** If true, additional calculations are performed to make calculating positions along the path more accurate. If false, fewer
     * calculations are performed but calculating positions along the path is less accurate. */
    this.constantSpeed = false;
    /** The color of the path as it was in Spine. Available only when nonessential data was exported. Paths are not usually
     * rendered at runtime. */
    this.color = new base.Color(1, 1, 1, 1);
  }
  copy() {
    const copy = new PathAttachment(this.name);
    this.copyTo(copy);
    copy.lengths = new Array(this.lengths.length);
    base.Utils.arrayCopy(this.lengths, 0, copy.lengths, 0, this.lengths.length);
    copy.closed = closed;
    copy.constantSpeed = this.constantSpeed;
    copy.color.setFromColor(this.color);
    return copy;
  }
}

exports.PathAttachment = PathAttachment;
//# sourceMappingURL=PathAttachment.js.map
