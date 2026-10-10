import { SpineBase } from '@pixi-spine/base';
import { Skeleton } from './core/Skeleton.mjs';
import { AnimationState } from './core/AnimationState.mjs';
import { AnimationStateData } from './core/AnimationStateData.mjs';

class Spine extends SpineBase {
  createSkeleton(spineData) {
    this.skeleton = new Skeleton(spineData);
    this.skeleton.updateWorldTransform();
    this.stateData = new AnimationStateData(spineData);
    this.state = new AnimationState(this.stateData);
  }
}

export { Spine };
//# sourceMappingURL=Spine.mjs.map
