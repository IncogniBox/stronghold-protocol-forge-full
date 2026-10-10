import './attachments/Attachment.mjs';
import { BoundingBoxAttachment } from './attachments/BoundingBoxAttachment.mjs';
import { ClippingAttachment } from './attachments/ClippingAttachment.mjs';
import { MeshAttachment } from './attachments/MeshAttachment.mjs';
import { PathAttachment } from './attachments/PathAttachment.mjs';
import { PointAttachment } from './attachments/PointAttachment.mjs';
import { RegionAttachment } from './attachments/RegionAttachment.mjs';

class AtlasAttachmentLoader {
  constructor(atlas) {
    this.atlas = atlas;
  }
  /** @return May be null to not load an attachment. */
  newRegionAttachment(skin, name, path) {
    const region = this.atlas.findRegion(path);
    if (region == null)
      throw new Error(`Region not found in atlas: ${path} (region attachment: ${name})`);
    const attachment = new RegionAttachment(name);
    attachment.region = region;
    return attachment;
  }
  /** @return May be null to not load an attachment. */
  newMeshAttachment(skin, name, path) {
    const region = this.atlas.findRegion(path);
    if (region == null)
      throw new Error(`Region not found in atlas: ${path} (mesh attachment: ${name})`);
    const attachment = new MeshAttachment(name);
    attachment.region = region;
    return attachment;
  }
  /** @return May be null to not load an attachment. */
  newBoundingBoxAttachment(skin, name) {
    return new BoundingBoxAttachment(name);
  }
  /** @return May be null to not load an attachment */
  newPathAttachment(skin, name) {
    return new PathAttachment(name);
  }
  newPointAttachment(skin, name) {
    return new PointAttachment(name);
  }
  newClippingAttachment(skin, name) {
    return new ClippingAttachment(name);
  }
}

export { AtlasAttachmentLoader };
//# sourceMappingURL=AtlasAttachmentLoader.mjs.map
