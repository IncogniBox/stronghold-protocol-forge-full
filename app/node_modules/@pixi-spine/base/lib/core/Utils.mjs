class IntSet {
  constructor() {
    this.array = new Array();
  }
  add(value) {
    const contains = this.contains(value);
    this.array[value | 0] = value | 0;
    return !contains;
  }
  contains(value) {
    return this.array[value | 0] != void 0;
  }
  remove(value) {
    this.array[value | 0] = void 0;
  }
  clear() {
    this.array.length = 0;
  }
}
class StringSet {
  constructor() {
    this.entries = {};
    this.size = 0;
  }
  add(value) {
    const contains = this.entries[value];
    this.entries[value] = true;
    if (!contains) {
      this.size++;
      return true;
    }
    return false;
  }
  addAll(values) {
    const oldSize = this.size;
    for (let i = 0, n = values.length; i < n; i++) {
      this.add(values[i]);
    }
    return oldSize != this.size;
  }
  contains(value) {
    return this.entries[value];
  }
  clear() {
    this.entries = {};
    this.size = 0;
  }
}
const _Color = class {
  constructor(r = 0, g = 0, b = 0, a = 0) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }
  set(r, g, b, a) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this.clamp();
  }
  setFromColor(c) {
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    this.a = c.a;
    return this;
  }
  setFromString(hex) {
    hex = hex.charAt(0) == "#" ? hex.substr(1) : hex;
    this.r = parseInt(hex.substr(0, 2), 16) / 255;
    this.g = parseInt(hex.substr(2, 2), 16) / 255;
    this.b = parseInt(hex.substr(4, 2), 16) / 255;
    this.a = hex.length != 8 ? 1 : parseInt(hex.substr(6, 2), 16) / 255;
    return this;
  }
  add(r, g, b, a) {
    this.r += r;
    this.g += g;
    this.b += b;
    this.a += a;
    return this.clamp();
  }
  clamp() {
    if (this.r < 0)
      this.r = 0;
    else if (this.r > 1)
      this.r = 1;
    if (this.g < 0)
      this.g = 0;
    else if (this.g > 1)
      this.g = 1;
    if (this.b < 0)
      this.b = 0;
    else if (this.b > 1)
      this.b = 1;
    if (this.a < 0)
      this.a = 0;
    else if (this.a > 1)
      this.a = 1;
    return this;
  }
  static rgba8888ToColor(color, value) {
    color.r = ((value & 4278190080) >>> 24) / 255;
    color.g = ((value & 16711680) >>> 16) / 255;
    color.b = ((value & 65280) >>> 8) / 255;
    color.a = (value & 255) / 255;
  }
  static rgb888ToColor(color, value) {
    color.r = ((value & 16711680) >>> 16) / 255;
    color.g = ((value & 65280) >>> 8) / 255;
    color.b = (value & 255) / 255;
  }
  static fromString(hex) {
    return new _Color().setFromString(hex);
  }
};
let Color = _Color;
Color.WHITE = new _Color(1, 1, 1, 1);
Color.RED = new _Color(1, 0, 0, 1);
Color.GREEN = new _Color(0, 1, 0, 1);
Color.BLUE = new _Color(0, 0, 1, 1);
Color.MAGENTA = new _Color(1, 0, 1, 1);
const _MathUtils = class {
  static clamp(value, min, max) {
    if (value < min)
      return min;
    if (value > max)
      return max;
    return value;
  }
  static cosDeg(degrees) {
    return Math.cos(degrees * _MathUtils.degRad);
  }
  static sinDeg(degrees) {
    return Math.sin(degrees * _MathUtils.degRad);
  }
  static signum(value) {
    return Math.sign(value);
  }
  static toInt(x) {
    return x > 0 ? Math.floor(x) : Math.ceil(x);
  }
  static cbrt(x) {
    const y = Math.pow(Math.abs(x), 1 / 3);
    return x < 0 ? -y : y;
  }
  static randomTriangular(min, max) {
    return _MathUtils.randomTriangularWith(min, max, (min + max) * 0.5);
  }
  static randomTriangularWith(min, max, mode) {
    const u = Math.random();
    const d = max - min;
    if (u <= (mode - min) / d)
      return min + Math.sqrt(u * d * (mode - min));
    return max - Math.sqrt((1 - u) * d * (max - mode));
  }
  static isPowerOfTwo(value) {
    return value && (value & value - 1) === 0;
  }
};
let MathUtils = _MathUtils;
MathUtils.PI = 3.1415927;
MathUtils.PI2 = _MathUtils.PI * 2;
MathUtils.radiansToDegrees = 180 / _MathUtils.PI;
MathUtils.radDeg = _MathUtils.radiansToDegrees;
MathUtils.degreesToRadians = _MathUtils.PI / 180;
MathUtils.degRad = _MathUtils.degreesToRadians;
class Interpolation {
  apply(start, end, a) {
    return start + (end - start) * this.applyInternal(a);
  }
}
class Pow extends Interpolation {
  constructor(power) {
    super();
    this.power = 2;
    this.power = power;
  }
  applyInternal(a) {
    if (a <= 0.5)
      return Math.pow(a * 2, this.power) / 2;
    return Math.pow((a - 1) * 2, this.power) / (this.power % 2 == 0 ? -2 : 2) + 1;
  }
}
class PowOut extends Pow {
  applyInternal(a) {
    return Math.pow(a - 1, this.power) * (this.power % 2 == 0 ? -1 : 1) + 1;
  }
}
const _Utils = class {
  static arrayCopy(source, sourceStart, dest, destStart, numElements) {
    for (let i = sourceStart, j = destStart; i < sourceStart + numElements; i++, j++) {
      dest[j] = source[i];
    }
  }
  static arrayFill(array, fromIndex, toIndex, value) {
    for (let i = fromIndex; i < toIndex; i++) {
      array[i] = value;
    }
  }
  static setArraySize(array, size, value = 0) {
    const oldSize = array.length;
    if (oldSize == size)
      return array;
    array.length = size;
    if (oldSize < size) {
      for (let i = oldSize; i < size; i++)
        array[i] = value;
    }
    return array;
  }
  static ensureArrayCapacity(array, size, value = 0) {
    if (array.length >= size)
      return array;
    return _Utils.setArraySize(array, size, value);
  }
  static newArray(size, defaultValue) {
    const array = new Array(size);
    for (let i = 0; i < size; i++)
      array[i] = defaultValue;
    return array;
  }
  static newFloatArray(size) {
    if (_Utils.SUPPORTS_TYPED_ARRAYS) {
      return new Float32Array(size);
    }
    const array = new Array(size);
    for (let i = 0; i < array.length; i++)
      array[i] = 0;
    return array;
  }
  static newShortArray(size) {
    if (_Utils.SUPPORTS_TYPED_ARRAYS) {
      return new Int16Array(size);
    }
    const array = new Array(size);
    for (let i = 0; i < array.length; i++)
      array[i] = 0;
    return array;
  }
  static toFloatArray(array) {
    return _Utils.SUPPORTS_TYPED_ARRAYS ? new Float32Array(array) : array;
  }
  static toSinglePrecision(value) {
    return _Utils.SUPPORTS_TYPED_ARRAYS ? Math.fround(value) : value;
  }
  // This function is used to fix WebKit 602 specific issue described at http://esotericsoftware.com/forum/iOS-10-disappearing-graphics-10109
  static webkit602BugfixHelper(alpha, blend) {
  }
  static contains(array, element, identity = true) {
    for (let i = 0; i < array.length; i++) {
      if (array[i] == element)
        return true;
    }
    return false;
  }
  static enumValue(type, name) {
    return type[name[0].toUpperCase() + name.slice(1)];
  }
};
let Utils = _Utils;
Utils.SUPPORTS_TYPED_ARRAYS = typeof Float32Array !== "undefined";
class DebugUtils {
  static logBones(skeleton) {
    for (let i = 0; i < skeleton.bones.length; i++) {
      const bone = skeleton.bones[i];
      const mat = bone.matrix;
      console.log(`${bone.data.name}, ${mat.a}, ${mat.b}, ${mat.c}, ${mat.d}, ${mat.tx}, ${mat.ty}`);
    }
  }
}
class Pool {
  constructor(instantiator) {
    this.items = new Array();
    this.instantiator = instantiator;
  }
  obtain() {
    return this.items.length > 0 ? this.items.pop() : this.instantiator();
  }
  free(item) {
    if (item.reset)
      item.reset();
    this.items.push(item);
  }
  freeAll(items) {
    for (let i = 0; i < items.length; i++) {
      this.free(items[i]);
    }
  }
  clear() {
    this.items.length = 0;
  }
}
class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }
  length() {
    const x = this.x;
    const y = this.y;
    return Math.sqrt(x * x + y * y);
  }
  normalize() {
    const len = this.length();
    if (len != 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }
}
class TimeKeeper {
  constructor() {
    this.maxDelta = 0.064;
    this.framesPerSecond = 0;
    this.delta = 0;
    this.totalTime = 0;
    this.lastTime = Date.now() / 1e3;
    this.frameCount = 0;
    this.frameTime = 0;
  }
  update() {
    const now = Date.now() / 1e3;
    this.delta = now - this.lastTime;
    this.frameTime += this.delta;
    this.totalTime += this.delta;
    if (this.delta > this.maxDelta)
      this.delta = this.maxDelta;
    this.lastTime = now;
    this.frameCount++;
    if (this.frameTime > 1) {
      this.framesPerSecond = this.frameCount / this.frameTime;
      this.frameTime = 0;
      this.frameCount = 0;
    }
  }
}
class WindowedMean {
  constructor(windowSize = 32) {
    this.addedValues = 0;
    this.lastValue = 0;
    this.mean = 0;
    this.dirty = true;
    this.values = new Array(windowSize);
  }
  hasEnoughData() {
    return this.addedValues >= this.values.length;
  }
  addValue(value) {
    if (this.addedValues < this.values.length)
      this.addedValues++;
    this.values[this.lastValue++] = value;
    if (this.lastValue > this.values.length - 1)
      this.lastValue = 0;
    this.dirty = true;
  }
  getMean() {
    if (this.hasEnoughData()) {
      if (this.dirty) {
        let mean = 0;
        for (let i = 0; i < this.values.length; i++) {
          mean += this.values[i];
        }
        this.mean = mean / this.values.length;
        this.dirty = false;
      }
      return this.mean;
    }
    return 0;
  }
}

export { Color, DebugUtils, IntSet, Interpolation, MathUtils, Pool, Pow, PowOut, StringSet, TimeKeeper, Utils, Vector2, WindowedMean };
//# sourceMappingURL=Utils.mjs.map
