'use strict';

var Attachment = require('./Attachment.js');
var base = require('@pixi-spine/base');

class MeshAttachment extends Attachment.VertexAttachment {
  constructor(name, path) {
    super(name);
    this.type = base.AttachmentType.Mesh;
    this.region = null;
    /** Triplets of vertex indices which describe the mesh's triangulation. */
    this.triangles = [];
    /** The color to tint the mesh. */
    this.color = new base.Color(1, 1, 1, 1);
    /** The width of the mesh's image. Available only when nonessential data was exported. */
    this.width = 0;
    /** The height of the mesh's image. Available only when nonessential data was exported. */
    this.height = 0;
    /** The number of entries at the beginning of {@link #vertices} that make up the mesh hull. */
    this.hullLength = 0;
    /** Vertex index pairs describing edges for controling triangulation. Mesh triangles will never cross edges. Only available if
     * nonessential data was exported. Triangulation is not performed at runtime. */
    this.edges = [];
    this.parentMesh = null;
    this.sequence = null;
    this.tempColor = new base.Color(0, 0, 0, 0);
    this.path = path;
  }
  /** The parent mesh if this is a linked mesh, else null. A linked mesh shares the {@link #bones}, {@link #vertices},
   * {@link #regionUVs}, {@link #triangles}, {@link #hullLength}, {@link #edges}, {@link #width}, and {@link #height} with the
   * parent mesh, but may have a different {@link #name} or {@link #path} (and therefore a different texture). */
  getParentMesh() {
    return this.parentMesh;
  }
  /** @param parentMesh May be null. */
  setParentMesh(parentMesh) {
    this.parentMesh = parentMesh;
    if (parentMesh) {
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
    if (this.parentMesh)
      return this.newLinkedMesh();
    const copy = new MeshAttachment(this.name, this.path);
    copy.region = this.region;
    copy.color.setFromColor(this.color);
    this.copyTo(copy);
    copy.regionUVs = new Float32Array(this.regionUVs.length);
    base.Utils.arrayCopy(this.regionUVs, 0, copy.regionUVs, 0, this.regionUVs.length);
    copy.triangles = new Array(this.triangles.length);
    base.Utils.arrayCopy(this.triangles, 0, copy.triangles, 0, this.triangles.length);
    copy.hullLength = this.hullLength;
    copy.sequence = this.sequence != null ? this.sequence.copy() : null;
    if (this.edges) {
      copy.edges = new Array(this.edges.length);
      base.Utils.arrayCopy(this.edges, 0, copy.edges, 0, this.edges.length);
    }
    copy.width = this.width;
    copy.height = this.height;
    return copy;
  }
  computeWorldVertices(slot, start, count, worldVertices, offset, stride) {
    if (this.sequence != null)
      this.sequence.apply(slot, this);
    super.computeWorldVertices(slot, start, count, worldVertices, offset, stride);
  }
  /** Returns a new mesh with the {@link #parentMesh} set to this mesh's parent mesh, if any, else to this mesh. **/
  newLinkedMesh() {
    const copy = new MeshAttachment(this.name, this.path);
    copy.region = this.region;
    copy.color.setFromColor(this.color);
    copy.timelineAttachment = this.timelineAttachment;
    copy.setParentMesh(this.parentMesh ? this.parentMesh : this);
    return copy;
  }
}

exports.MeshAttachment = MeshAttachment;
//# sourceMappingURL=MeshAttachment.js.map
