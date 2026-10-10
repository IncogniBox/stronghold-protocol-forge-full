import { MathUtils } from '@pixi-spine/base';

class JitterEffect {
  constructor(jitterX, jitterY) {
    this.jitterX = 0;
    this.jitterY = 0;
    this.jitterX = jitterX;
    this.jitterY = jitterY;
  }
  // @ts-ignore
  begin(skeleton) {
  }
  // @ts-ignore
  transform(position, uv, light, dark) {
    position.x += MathUtils.randomTriangular(-this.jitterX, this.jitterY);
    position.y += MathUtils.randomTriangular(-this.jitterX, this.jitterY);
  }
  end() {
  }
}

export { JitterEffect };
//# sourceMappingURL=JitterEffect.mjs.map
