'use strict';

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

class Spine extends base.SpineBase {
  createSkeleton(spineData) {
    const ver = versions.detectSpineVersion(spineData.version);
    let spine = null;
    if (ver === versions.SPINE_VERSION.VER37) {
      spine = spine37__namespace;
    }
    if (ver === versions.SPINE_VERSION.VER38) {
      spine = spine38__namespace;
    }
    if (ver === versions.SPINE_VERSION.VER40 || ver === versions.SPINE_VERSION.VER41) {
      spine = spine41__namespace;
    }
    if (!spine) {
      const error = `Cant detect version of spine model ${spineData.version}`;
      console.error(error);
    }
    this.skeleton = new spine.Skeleton(spineData);
    this.skeleton.updateWorldTransform();
    this.stateData = new spine.AnimationStateData(spineData);
    this.state = new spine.AnimationState(this.stateData);
  }
}

exports.Spine = Spine;
//# sourceMappingURL=Spine.js.map
