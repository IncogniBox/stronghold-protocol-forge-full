'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class MeshAttachment extends Attachment.VertexAttachment {
  constructor(name) {
    super(name);
    this.type = base.AttachmentType.Mesh;
    this.color = new base.Color(1, 1, 1, 1);
    this.tempColor = new base.Color(0, 0, 0, 0);
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
  copy() {
    if (this.parentMesh != null)
      return this.newLinkedMesh();
    const copy = new MeshAttachment(this.name);
    copy.region = this.region;
    copy.path = this.path;
    copy.color.setFromColor(this.color);
    this.copyTo(copy);
    copy.regionUVs = new Float32Array(this.regionUVs.length);
    base.Utils.arrayCopy(this.regionUVs, 0, copy.regionUVs, 0, this.regionUVs.length);
    copy.triangles = new Array(this.triangles.length);
    base.Utils.arrayCopy(this.triangles, 0, copy.triangles, 0, this.triangles.length);
    copy.hullLength = this.hullLength;
    if (this.edges != null) {
      copy.edges = new Array(this.edges.length);
      base.Utils.arrayCopy(this.edges, 0, copy.edges, 0, this.edges.length);
    }
    copy.width = this.width;
    copy.height = this.height;
    return copy;
  }
  newLinkedMesh() {
    const copy = new MeshAttachment(this.name);
    copy.region = this.region;
    copy.path = this.path;
    copy.color.setFromColor(this.color);
    copy.deformAttachment = this.deformAttachment;
    copy.setParentMesh(this.parentMesh != null ? this.parentMesh : this);
    return copy;
  }
}

exports.MeshAttachment = MeshAttachment;
//# sourceMappingURL=MeshAttachment.js.map
