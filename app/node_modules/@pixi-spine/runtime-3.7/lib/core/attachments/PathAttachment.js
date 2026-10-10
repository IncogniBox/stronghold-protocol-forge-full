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
}

exports.PathAttachment = PathAttachment;
//# sourceMappingURL=PathAttachment.js.map
