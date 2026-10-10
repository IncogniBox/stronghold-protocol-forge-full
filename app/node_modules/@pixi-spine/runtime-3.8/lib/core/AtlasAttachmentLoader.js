'use strict';

require('./attachments/Attachment.js');
var BoundingBoxAttachment = require('./attachments/BoundingBoxAttachment.js');
var ClippingAttachment = require('./attachments/ClippingAttachment.js');
var MeshAttachment = require('./attachments/MeshAttachment.js');
var PathAttachment = require('./attachments/PathAttachment.js');
var PointAttachment = require('./attachments/PointAttachment.js');
var RegionAttachment = require('./attachments/RegionAttachment.js');

class AtlasAttachmentLoader {
  constructor(atlas) {
    this.atlas = atlas;
  }
  /** @return May be null to not load an attachment. */
  newRegionAttachment(skin, name, path) {
    const region = this.atlas.findRegion(path);
    if (region == null)
      throw new Error(`Region not found in atlas: ${path} (region attachment: ${name})`);
    const attachment = new RegionAttachment.RegionAttachment(name);
    attachment.region = region;
    return attachment;
  }
  /** @return May be null to not load an attachment. */
  newMeshAttachment(skin, name, path) {
    const region = this.atlas.findRegion(path);
    if (region == null)
      throw new Error(`Region not found in atlas: ${path} (mesh attachment: ${name})`);
    const attachment = new MeshAttachment.MeshAttachment(name);
    attachment.region = region;
    return attachment;
  }
  /** @return May be null to not load an attachment. */
  newBoundingBoxAttachment(skin, name) {
    return new BoundingBoxAttachment.BoundingBoxAttachment(name);
  }
  /** @return May be null to not load an attachment */
  newPathAttachment(skin, name) {
    return new PathAttachment.PathAttachment(name);
  }
  newPointAttachment(skin, name) {
    return new PointAttachment.PointAttachment(name);
  }
  newClippingAttachment(skin, name) {
    return new ClippingAttachment.ClippingAttachment(name);
  }
}

exports.AtlasAttachmentLoader = AtlasAttachmentLoader;
//# sourceMappingURL=AtlasAttachmentLoader.js.map
