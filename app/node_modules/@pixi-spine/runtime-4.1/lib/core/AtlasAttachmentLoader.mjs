import './attachments/Attachment.mjs';
import { BoundingBoxAttachment } from './attachments/BoundingBoxAttachment.mjs';
import { ClippingAttachment } from './attachments/ClippingAttachment.mjs';
import { MeshAttachment } from './attachments/MeshAttachment.mjs';
import { PathAttachment } from './attachments/PathAttachment.mjs';
import { PointAttachment } from './attachments/PointAttachment.mjs';
import { RegionAttachment } from './attachments/RegionAttachment.mjs';
import './attachments/Sequence.mjs';

class AtlasAttachmentLoader {
  constructor(atlas) {
    this.atlas = atlas;
  }
  loadSequence(name, basePath, sequence) {
    const regions = sequence.regions;
    for (let i = 0, n = regions.length; i < n; i++) {
      const path = sequence.getPath(basePath, i);
      const region = this.atlas.findRegion(path);
      if (region == null)
        throw new Error(`Region not found in atlas: ${path} (sequence: ${name})`);
      regions[i] = region;
      regions[i].renderObject = regions[i];
    }
  }
  newRegionAttachment(skin, name, path, sequence) {
    const attachment = new RegionAttachment(name, path);
    if (sequence != null) {
      this.loadSequence(name, path, sequence);
    } else {
      const region = this.atlas.findRegion(path);
      if (!region)
        throw new Error(`Region not found in atlas: ${path} (region attachment: ${name})`);
      region.renderObject = region;
      attachment.region = region;
    }
    return attachment;
  }
  newMeshAttachment(skin, name, path, sequence) {
    const attachment = new MeshAttachment(name, path);
    if (sequence != null) {
      this.loadSequence(name, path, sequence);
    } else {
      const region = this.atlas.findRegion(path);
      if (!region)
        throw new Error(`Region not found in atlas: ${path} (mesh attachment: ${name})`);
      region.renderObject = region;
      attachment.region = region;
    }
    return attachment;
  }
  newBoundingBoxAttachment(skin, name) {
    return new BoundingBoxAttachment(name);
  }
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
