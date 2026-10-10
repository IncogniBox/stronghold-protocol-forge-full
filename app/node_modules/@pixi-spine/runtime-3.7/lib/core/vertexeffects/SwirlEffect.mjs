import { PowOut, MathUtils } from '@pixi-spine/base';

const _SwirlEffect = class {
  constructor(radius) {
    this.centerX = 0;
    this.centerY = 0;
    this.radius = 0;
    this.angle = 0;
    this.worldX = 0;
    this.worldY = 0;
    this.radius = radius;
  }
  begin(skeleton) {
    this.worldX = skeleton.x + this.centerX;
    this.worldY = skeleton.y + this.centerY;
  }
  transform(position, uv, light, dark) {
    const radAngle = this.angle * MathUtils.degreesToRadians;
    const x = position.x - this.worldX;
    const y = position.y - this.worldY;
    const dist = Math.sqrt(x * x + y * y);
    if (dist < this.radius) {
      const theta = _SwirlEffect.interpolation.apply(0, radAngle, (this.radius - dist) / this.radius);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      position.x = cos * x - sin * y + this.worldX;
      position.y = sin * x + cos * y + this.worldY;
    }
  }
  end() {
  }
};
let SwirlEffect = _SwirlEffect;
SwirlEffect.interpolation = new PowOut(2);

export { SwirlEffect };
//# sourceMappingURL=SwirlEffect.mjs.map
