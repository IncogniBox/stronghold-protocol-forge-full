'use strict';

require('@pixi-spine/loader-base');
var SpineLoader = require('./SpineLoader.js');
var Spine = require('./Spine.js');
var versions = require('./versions.js');

new SpineLoader.SpineLoader().installLoader();

exports.Spine = Spine.Spine;
exports.SPINE_VERSION = versions.SPINE_VERSION;
exports.detectSpineVersion = versions.detectSpineVersion;
//# sourceMappingURL=index.js.map
