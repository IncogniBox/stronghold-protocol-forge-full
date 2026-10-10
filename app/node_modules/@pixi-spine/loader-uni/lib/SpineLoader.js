'use strict';

var loaderBase = require('@pixi-spine/loader-base');
var base = require('@pixi-spine/base');
var spine38 = require('@pixi-spine/runtime-3.8');
var spine37 = require('@pixi-spine/runtime-3.7');
var spine41 = require('@pixi-spine/runtime-4.1');
var versions = require('./versions.js');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var spine38__namespace = /*#__PURE__*/_interopNamespaceDefault(spine38);
var spine37__namespace = /*#__PURE__*/_interopNamespaceDefault(spine37);
var spine41__namespace = /*#__PURE__*/_interopNamespaceDefault(spine41);

class UniBinaryParser {
  constructor() {
    this.scale = 1;
  }
  readSkeletonData(atlas, dataToParse) {
    let parser = null;
    let version = this.readVersionOldFormat(dataToParse);
    let ver = versions.detectSpineVersion(version);
    if (ver === versions.SPINE_VERSION.VER38) {
      parser = new spine38__namespace.SkeletonBinary(new spine38__namespace.AtlasAttachmentLoader(atlas));
    }
    version = this.readVersionNewFormat(dataToParse);
    ver = versions.detectSpineVersion(version);
    if (ver === versions.SPINE_VERSION.VER40 || ver === versions.SPINE_VERSION.VER41) {
      parser = new spine41__namespace.SkeletonBinary(new spine41__namespace.AtlasAttachmentLoader(atlas));
    }
    if (!parser) {
      const error = `Unsupported version of spine model ${version}, please update pixi-spine`;
      console.error(error);
    }
    parser.scale = this.scale;
    return parser.readSkeletonData(dataToParse);
  }
  readVersionOldFormat(dataToParse) {
    const input = new base.BinaryInput(dataToParse);
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
    const input = new base.BinaryInput(dataToParse);
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
    const ver = versions.detectSpineVersion(version);
    let parser = null;
    if (ver === versions.SPINE_VERSION.VER37) {
      parser = new spine37__namespace.SkeletonJson(new spine37__namespace.AtlasAttachmentLoader(atlas));
    }
    if (ver === versions.SPINE_VERSION.VER38) {
      parser = new spine38__namespace.SkeletonJson(new spine38__namespace.AtlasAttachmentLoader(atlas));
    }
    if (ver === versions.SPINE_VERSION.VER40 || ver === versions.SPINE_VERSION.VER41) {
      parser = new spine41__namespace.SkeletonJson(new spine41__namespace.AtlasAttachmentLoader(atlas));
    }
    if (!parser) {
      const error = `Unsupported version of spine model ${version}, please update pixi-spine`;
      console.error(error);
    }
    parser.scale = this.scale;
    return parser.readSkeletonData(dataToParse);
  }
}
class SpineLoader extends loaderBase.SpineLoaderAbstract {
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

exports.SpineLoader = SpineLoader;
//# sourceMappingURL=SpineLoader.js.map
