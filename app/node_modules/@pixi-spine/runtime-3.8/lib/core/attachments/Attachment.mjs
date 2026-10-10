import { Utils } from '@pixi-spine/base';

class Attachment {
  constructor(name) {
    if (name == null)
      throw new Error("name cannot be null.");
    this.name = name;
  }
}
const _VertexAttachment = class extends Attachment {
  constructor(name) {
    super(name);
    this.id = (_VertexAttachment.nextID++ & 65535) << 11;
    this.worldVerticesLength = 0;
    this.deformAttachment = this;
  }
  computeWorldVerticesOld(slot, worldVertices) {
    this.computeWorldVertices(slot, 0, this.worldVerticesLength, worldVertices, 0, 2);
  }
  /** Transforms local vertices to world coordinates.
   * @param start The index of the first local vertex value to transform. Each vertex has 2 values, x and y.
   * @param count The number of world vertex values to output. Must be <= {@link #getWorldVerticesLength()} - start.
   * @param worldVertices The output world vertices. Must have a length >= offset + count.
   * @param offset The worldVertices index to begin writing values. */
  computeWorldVertices(slot, start, count, worldVertices, offset, stride) {
    count = offset + (count >> 1) * stride;
    const skeleton = slot.bone.skeleton;
    const deformArray = slot.deform;
    let vertices = this.vertices;
    const bones = this.bones;
    if (bones == null) {
      if (deformArray.length > 0)
        vertices = deformArray;
      const mat = slot.bone.matrix;
      const x = mat.tx;
      const y = mat.ty;
      const a = mat.a;
      const b = mat.c;
      const c = mat.b;
      const d = mat.d;
      for (let v2 = start, w = offset; w < count; v2 += 2, w += stride) {
        const vx = vertices[v2];
        const vy = vertices[v2 + 1];
        worldVertices[w] = vx * a + vy * b + x;
        worldVertices[w + 1] = vx * c + vy * d + y;
      }
      return;
    }
    let v = 0;
    let skip = 0;
    for (let i = 0; i < start; i += 2) {
      const n = bones[v];
      v += n + 1;
      skip += n;
    }
    const skeletonBones = skeleton.bones;
    if (deformArray.length == 0) {
      for (let w = offset, b = skip * 3; w < count; w += stride) {
        let wx = 0;
        let wy = 0;
        let n = bones[v++];
        n += v;
        for (; v < n; v++, b += 3) {
          const mat = skeletonBones[bones[v]].matrix;
          const vx = vertices[b];
          const vy = vertices[b + 1];
          const weight = vertices[b + 2];
          wx += (vx * mat.a + vy * mat.c + mat.tx) * weight;
          wy += (vx * mat.b + vy * mat.d + mat.ty) * weight;
        }
        worldVertices[w] = wx;
        worldVertices[w + 1] = wy;
      }
    } else {
      const deform = deformArray;
      for (let w = offset, b = skip * 3, f = skip << 1; w < count; w += stride) {
        let wx = 0;
        let wy = 0;
        let n = bones[v++];
        n += v;
        for (; v < n; v++, b += 3, f += 2) {
          const mat = skeletonBones[bones[v]].matrix;
          const vx = vertices[b] + deform[f];
          const vy = vertices[b + 1] + deform[f + 1];
          const weight = vertices[b + 2];
          wx += (vx * mat.a + vy * mat.c + mat.tx) * weight;
          wy += (vx * mat.b + vy * mat.d + mat.ty) * weight;
        }
        worldVertices[w] = wx;
        worldVertices[w + 1] = wy;
      }
    }
  }
  copyTo(attachment) {
    if (this.bones != null) {
      attachment.bones = new Array(this.bones.length);
      Utils.arrayCopy(this.bones, 0, attachment.bones, 0, this.bones.length);
    } else
      attachment.bones = null;
    if (this.vertices != null) {
      attachment.vertices = Utils.newFloatArray(this.vertices.length);
      Utils.arrayCopy(this.vertices, 0, attachment.vertices, 0, this.vertices.length);
    } else
      attachment.vertices = null;
    attachment.worldVerticesLength = this.worldVerticesLength;
    attachment.deformAttachment = this.deformAttachment;
  }
};
let VertexAttachment = _VertexAttachment;
VertexAttachment.nextID = 0;

export { Attachment, VertexAttachment };
//# sourceMappingURL=Attachment.mjs.map
