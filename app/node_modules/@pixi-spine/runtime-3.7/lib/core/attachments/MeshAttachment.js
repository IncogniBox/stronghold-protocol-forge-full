'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class MeshAttachment extends Attachment.VertexAttachment {
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.Mesh;
    this.color = new base.Color(1, 1, 1, 1);
    this.inheritDeform = false;
    this.tempColor = new base.Color(0, 0, 0, 0);
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

exports.MeshAttachment = MeshAttachment;
//# sourceMappingURL=MeshAttachment.js.map
