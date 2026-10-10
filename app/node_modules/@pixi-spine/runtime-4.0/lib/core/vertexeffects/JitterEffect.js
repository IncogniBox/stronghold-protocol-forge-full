'use strict';

var base = require('@pixi-spine/base');

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
    position.x += base.MathUtils.randomTriangular(-this.jitterX, this.jitterY);
    position.y += base.MathUtils.randomTriangular(-this.jitterX, this.jitterY);
  }
  end() {
  }
}

exports.JitterEffect = JitterEffect;
//# sourceMappingURL=JitterEffect.js.map
