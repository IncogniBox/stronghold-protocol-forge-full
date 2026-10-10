import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color, MathUtils } from '@pixi-spine/base';

class PointAttachment extends VertexAttachment {
  constructor(name) {
    super(name);
    this.type = AttachmentType.Point;
    /** The color of the point attachment as it was in Spine. Available only when nonessential data was exported. Point attachments
     * are not usually rendered at runtime. */
    this.color = new Color(0.38, 0.94, 0, 1);
  }
  computeWorldPosition(bone, point) {
    const mat = bone.matrix;
    point.x = this.x * mat.a + this.y * mat.c + bone.worldX;
    point.y = this.x * mat.b + this.y * mat.d + bone.worldY;
    return point;
  }
  computeWorldRotation(bone) {
    const mat = bone.matrix;
    const cos = MathUtils.cosDeg(this.rotation);
    const sin = MathUtils.sinDeg(this.rotation);
    const x = cos * mat.a + sin * mat.c;
    const y = cos * mat.b + sin * mat.d;
    return Math.atan2(y, x) * MathUtils.radDeg;
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

export { PointAttachment };
//# sourceMappingURL=PointAttachment.mjs.map
