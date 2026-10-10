'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class ClippingAttachment extends Attachment.VertexAttachment {
  // ce3a3aff
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.Clipping;
    // Nonessential.
    /** The color of the clipping polygon as it was in Spine. Available only when nonessential data was exported. Clipping polygons
     * are not usually rendered at runtime. */
    this.color = new base.Color(0.2275, 0.2275, 0.8078, 1);
  }
  copy() {
    const copy = new ClippingAttachment(this.name);
    this.copyTo(copy);
    copy.endSlot = this.endSlot;
    copy.color.setFromColor(this.color);
    return copy;
  }
}

exports.ClippingAttachment = ClippingAttachment;
//# sourceMappingURL=ClippingAttachment.js.map
