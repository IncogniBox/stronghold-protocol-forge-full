import { Attachment } from './Attachment.mjs';
import { AttachmentType, Color, Utils } from '@pixi-spine/base';

const _RegionAttachment = class extends Attachment {
  constructor(name, path) {
    super(name);
    this.type = AttachmentType.Region;
    /** The local x translation. */
    this.x = 0;
    /** The local y translation. */
    this.y = 0;
    /** The local scaleX. */
    this.scaleX = 1;
    /** The local scaleY. */
    this.scaleY = 1;
    /** The local rotation. */
    this.rotation = 0;
    /** The width of the region attachment in Spine. */
    this.width = 0;
    /** The height of the region attachment in Spine. */
    this.height = 0;
    /** The color to tint the region attachment. */
    this.color = new Color(1, 1, 1, 1);
    this.rendererObject = null;
    this.region = null;
    this.sequence = null;
    /** For each of the 4 vertices, a pair of <code>x,y</code> values that is the local position of the vertex.
     *
     * See {@link #updateOffset()}. */
    this.offset = Utils.newFloatArray(8);
    this.uvs = Utils.newFloatArray(8);
    this.tempColor = new Color(1, 1, 1, 1);
    this.path = path;
  }
  /** Calculates the {@link #offset} using the region settings. Must be called after changing region settings. */
  updateRegion() {
    if (!this.region)
      throw new Error("Region not set.");
    const region = this.region;
    const regionScaleX = this.width / this.region.originalWidth * this.scaleX;
    const regionScaleY = this.height / this.region.originalHeight * this.scaleY;
    const localX = -this.width / 2 * this.scaleX + this.region.offsetX * regionScaleX;
    const localY = -this.height / 2 * this.scaleY + this.region.offsetY * regionScaleY;
    const localX2 = localX + this.region.width * regionScaleX;
    const localY2 = localY + this.region.height * regionScaleY;
    const radians = this.rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const x = this.x;
    const y = this.y;
    const localXCos = localX * cos + x;
    const localXSin = localX * sin;
    const localYCos = localY * cos + y;
    const localYSin = localY * sin;
    const localX2Cos = localX2 * cos + x;
    const localX2Sin = localX2 * sin;
    const localY2Cos = localY2 * cos + y;
    const localY2Sin = localY2 * sin;
    const offset = this.offset;
    offset[0] = localXCos - localYSin;
    offset[1] = localYCos + localXSin;
    offset[2] = localXCos - localY2Sin;
    offset[3] = localY2Cos + localXSin;
    offset[4] = localX2Cos - localY2Sin;
    offset[5] = localY2Cos + localX2Sin;
    offset[6] = localX2Cos - localYSin;
    offset[7] = localYCos + localX2Sin;
    const uvs = this.uvs;
    if (region.degrees == 90) {
      uvs[2] = region.u;
      uvs[3] = region.v2;
      uvs[4] = region.u;
      uvs[5] = region.v;
      uvs[6] = region.u2;
      uvs[7] = region.v;
      uvs[0] = region.u2;
      uvs[1] = region.v2;
    } else {
      uvs[0] = region.u;
      uvs[1] = region.v2;
      uvs[2] = region.u;
      uvs[3] = region.v;
      uvs[4] = region.u2;
      uvs[5] = region.v;
      uvs[6] = region.u2;
      uvs[7] = region.v2;
    }
  }
  /** Transforms the attachment's four vertices to world coordinates. If the attachment has a {@link #sequence}, the region may
   * be changed.
   * <p>
   * See <a href="http://esotericsoftware.com/spine-runtime-skeletons#World-transforms">World transforms</a> in the Spine
   * Runtimes Guide.
   * @param worldVertices The output world vertices. Must have a length >= <code>offset</code> + 8.
   * @param offset The <code>worldVertices</code> index to begin writing values.
   * @param stride The number of <code>worldVertices</code> entries between the value pairs written. */
  computeWorldVertices(slot, worldVertices, offset, stride) {
    if (this.sequence != null)
      this.sequence.apply(slot, this);
    const bone = slot.bone;
    const vertexOffset = this.offset;
    const mat = bone.matrix;
    const x = mat.tx;
    const y = mat.ty;
    const a = mat.a;
    const b = mat.c;
    const c = mat.b;
    const d = mat.d;
    let offsetX = 0;
    let offsetY = 0;
    offsetX = vertexOffset[0];
    offsetY = vertexOffset[1];
    worldVertices[offset] = offsetX * a + offsetY * b + x;
    worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
    offset += stride;
    offsetX = vertexOffset[2];
    offsetY = vertexOffset[3];
    worldVertices[offset] = offsetX * a + offsetY * b + x;
    worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
    offset += stride;
    offsetX = vertexOffset[4];
    offsetY = vertexOffset[5];
    worldVertices[offset] = offsetX * a + offsetY * b + x;
    worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
    offset += stride;
    offsetX = vertexOffset[6];
    offsetY = vertexOffset[7];
    worldVertices[offset] = offsetX * a + offsetY * b + x;
    worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
  }
  copy() {
    const copy = new _RegionAttachment(this.name, this.path);
    copy.region = this.region;
    copy.rendererObject = this.rendererObject;
    copy.x = this.x;
    copy.y = this.y;
    copy.scaleX = this.scaleX;
    copy.scaleY = this.scaleY;
    copy.rotation = this.rotation;
    copy.width = this.width;
    copy.height = this.height;
    Utils.arrayCopy(this.uvs, 0, copy.uvs, 0, 8);
    Utils.arrayCopy(this.offset, 0, copy.offset, 0, 8);
    copy.color.setFromColor(this.color);
    copy.sequence = this.sequence != null ? this.sequence.copy() : null;
    return copy;
  }
};
let RegionAttachment = _RegionAttachment;
RegionAttachment.X1 = 0;
RegionAttachment.Y1 = 1;
RegionAttachment.C1R = 2;
RegionAttachment.C1G = 3;
RegionAttachment.C1B = 4;
RegionAttachment.C1A = 5;
RegionAttachment.U1 = 6;
RegionAttachment.V1 = 7;
RegionAttachment.X2 = 8;
RegionAttachment.Y2 = 9;
RegionAttachment.C2R = 10;
RegionAttachment.C2G = 11;
RegionAttachment.C2B = 12;
RegionAttachment.C2A = 13;
RegionAttachment.U2 = 14;
RegionAttachment.V2 = 15;
RegionAttachment.X3 = 16;
RegionAttachment.Y3 = 17;
RegionAttachment.C3R = 18;
RegionAttachment.C3G = 19;
RegionAttachment.C3B = 20;
RegionAttachment.C3A = 21;
RegionAttachment.U3 = 22;
RegionAttachment.V3 = 23;
RegionAttachment.X4 = 24;
RegionAttachment.Y4 = 25;
RegionAttachment.C4R = 26;
RegionAttachment.C4G = 27;
RegionAttachment.C4B = 28;
RegionAttachment.C4A = 29;
RegionAttachment.U4 = 30;
RegionAttachment.V4 = 31;

export { RegionAttachment };
//# sourceMappingURL=RegionAttachment.mjs.map
