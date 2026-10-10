'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class PointAttachment extends Attachment.VertexAttachment {
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.Point;
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
}

exports.PointAttachment = PointAttachment;
//# sourceMappingURL=PointAttachment.js.map
