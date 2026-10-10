import { VertexAttachment } from './Attachment.mjs';
import { AttachmentType, Color } from '@pixi-spine/base';

class MeshAttachment extends VertexAttachment {
  constructor(name) {
    super(name);
    this.type = AttachmentType.Mesh;
    this.color = new Color(1, 1, 1, 1);
    this.inheritDeform = false;
    this.tempColor = new Color(0, 0, 0, 0);
  }
  applyDeform(sourceAttachment) {
    return this == sourceAttachment || this.inheritDeform && this.parentMesh == sourceAttachment;
  }
  getParentMesh() {
    return this.parentMesh;
  }
  /** @param parentMesh May be null. */
  setParentMesh(parentMesh) {
    this.parentMesh = parentMesh;
    if (parentMesh != null) {
      this.bones = parentMesh.bones;
      this.vertices = parentMesh.vertices;
      this.worldVerticesLength = parentMesh.worldVerticesLength;
      this.regionUVs = parentMesh.regionUVs;
      this.triangles = parentMesh.triangles;
      this.hullLength = parentMesh.hullLength;
      this.worldVerticesLength = parentMesh.worldVerticesLength;
    }
  }
  // computeWorldVerticesWith(slot, 0, this.worldVerticesLength, worldVertices, 0);
}

export { MeshAttachment };
//# sourceMappingURL=MeshAttachment.mjs.map
