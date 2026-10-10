'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class BoundingBoxAttachment extends Attachment.VertexAttachment {
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.BoundingBox;
    this.color = new base.Color(1, 1, 1, 1);
  }
}

exports.BoundingBoxAttachment = BoundingBoxAttachment;
//# sourceMappingURL=BoundingBoxAttachment.js.map
