import { SpineLoaderAbstract } from '@pixi-spine/loader-base';
import { BinaryInput } from '@pixi-spine/base';
import * as spine38 from '@pixi-spine/runtime-3.8';
import * as spine37 from '@pixi-spine/runtime-3.7';
import * as spine41 from '@pixi-spine/runtime-4.1';
import { detectSpineVersion, SPINE_VERSION } from './versions.mjs';

class UniBinaryParser {
  constructor() {
    this.scale = 1;
  }
  readSkeletonData(atlas, dataToParse) {
    let parser = null;
    let version = this.readVersionOldFormat(dataToParse);
    let ver = detectSpineVersion(version);
    if (ver === SPINE_VERSION.VER38) {
      parser = new spine38.SkeletonBinary(new spine38.AtlasAttachmentLoader(atlas));
    }
    version = this.readVersionNewFormat(dataToParse);
    ver = detectSpineVersion(version);
    if (ver === SPINE_VERSION.VER40 || ver === SPINE_VERSION.VER41) {
      parser = new spine41.SkeletonBinary(new spine41.AtlasAttachmentLoader(atlas));
    }
    if (!parser) {
      const error = `Unsupported version of spine model ${version}, please update pixi-spine`;
      console.error(error);
    }
    parser.scale = this.scale;
    return parser.readSkeletonData(dataToParse);
  }
  readVersionOldFormat(dataToParse) {
    const input = new BinaryInput(dataToParse);
    let version;
    try {
      input.readString();
      version = input.readString();
    } catch (e) {
      version = "";
    }
    return version || "";
  }
  readVersionNewFormat(dataToParse) {
    const input = new BinaryInput(dataToParse);
    input.readInt32();
    input.readInt32();
    let version;
    try {
      version = input.readString();
    } catch (e) {
      version = "";
    }
    return version || "";
  }
}
class UniJsonParser {
  constructor() {
    this.scale = 1;
  }
  readSkeletonData(atlas, dataToParse) {
    const version = dataToParse.skeleton.spine;
    const ver = detectSpineVersion(version);
    let parser = null;
    if (ver === SPINE_VERSION.VER37) {
      parser = new spine37.SkeletonJson(new spine37.AtlasAttachmentLoader(atlas));
    }
    if (ver === SPINE_VERSION.VER38) {
      parser = new spine38.SkeletonJson(new spine38.AtlasAttachmentLoader(atlas));
    }
    if (ver === SPINE_VERSION.VER40 || ver === SPINE_VERSION.VER41) {
      parser = new spine41.SkeletonJson(new spine41.AtlasAttachmentLoader(atlas));
    }
    if (!parser) {
      const error = `Unsupported version of spine model ${version}, please update pixi-spine`;
      console.error(error);
    }
    parser.scale = this.scale;
    return parser.readSkeletonData(dataToParse);
  }
}
class SpineLoader extends SpineLoaderAbstract {
  createBinaryParser() {
    return new UniBinaryParser();
  }
  createJsonParser() {
    return new UniJsonParser();
  }
  parseData(parser, atlas, dataToParse) {
    const parserCast = parser;
    return {
      spineData: parserCast.readSkeletonData(atlas, dataToParse),
      spineAtlas: atlas
    };
  }
}

export { SpineLoader };
//# sourceMappingURL=SpineLoader.mjs.map
