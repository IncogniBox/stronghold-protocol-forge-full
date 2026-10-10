'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class PointAttachment extends Attachment.VertexAttachment {
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.Point;
    /** The color of the point attachment as it was in Spine. Available only when nonessential data was exported. Point attachments
     * are not usually rendered at runtime. */
    this.color = new base.Color(0.38, 0.94, 0, 1);
  }
  computeWorldPosition(bone, point) {
    const mat = bone.matrix;
    point.x = this.x * mat.a + this.y * mat.c + bone.worldX;
    point.y = this.x * mat.b + this.y * mat.d + bone.worldY;
    return point;
  }
  computeWorldRotation(bone) {
    const mat = bone.matrix;
    const cos = base.MathUtils.cosDeg(this.rotation);
    const sin = base.MathUtils.sinDeg(this.rotation);
    const x = cos * mat.a + sin * mat.c;
    const y = cos * mat.b + sin * mat.d;
    return Math.atan2(y, x) * base.MathUtils.radDeg;
  }
  copy() {
    const copy = new PointAttachment(this.name);
    copy.x = this.x;
    copy.y = this.y;
    copy.rotation = this.rotation;
    copy.color.setFromColor(this.color);
    return copy;
  }
}

exports.PointAttachment = PointAttachment;
//# sourceMappingURL=PointAttachment.js.map
