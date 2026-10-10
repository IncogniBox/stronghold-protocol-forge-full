'use strict';

var base = require('@pixi-spine/base');
var Skeleton = require('./core/Skeleton.js');
var AnimationState = require('./core/AnimationState.js');
var AnimationStateData = require('./core/AnimationStateData.js');

class Spine extends base.SpineBase {
  createSkeleton(spineData) {
    this.skeleton = new Skeleton.Skeleton(spineData);
    this.skeleton.updateWorldTransform();
    this.stateData = new AnimationStateData.AnimationStateData(spineData);
    this.state = new AnimationState.AnimationState(this.stateData);
  }
}

exports.Spine = Spine;
//# sourceMappingURL=Spine.js.map
