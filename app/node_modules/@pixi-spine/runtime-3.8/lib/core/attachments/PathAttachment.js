'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class PathAttachment extends Attachment.VertexAttachment {
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.Path;
    this.closed = false;
    this.constantSpeed = false;
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
