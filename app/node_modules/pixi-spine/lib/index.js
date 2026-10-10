'use strict';

var loaderUni = require('@pixi-spine/loader-uni');
var base = require('@pixi-spine/base');
var runtime4_1 = require('@pixi-spine/runtime-4.1');



Object.defineProperty(exports, 'Spine', {
	enumerable: true,
	get: function () { return loaderUni.Spine; }
});
Object.defineProperty(exports, 'SkeletonBounds', {
	enumerable: true,
	get: function () { return runtime4_1.SkeletonBounds; }
});
Object.keys(base).forEach(function (k) {
	if (k !== 'default' && !exports.hasOwnProperty(k)) Object.defineProperty(exports, k, {
		enumerable: true,
		get: function () { return base[k]; }
	});
});
//# sourceMappingURL=index.js.map
