'use strict';

var base = require('@pixi-spine/base');

class TransformConstraint {
  constructor(data, skeleton) {
    this.mixRotate = 0;
    this.mixX = 0;
    this.mixY = 0;
    this.mixScaleX = 0;
    this.mixScaleY = 0;
    this.mixShearY = 0;
    this.temp = new base.Vector2();
    this.active = false;
    if (!data)
      throw new Error("data cannot be null.");
    if (!skeleton)
      throw new Error("skeleton cannot be null.");
    this.data = data;
    this.mixRotate = data.mixRotate;
    this.mixX = data.mixX;
    this.mixY = data.mixY;
    this.mixScaleX = data.mixScaleX;
    this.mixScaleY = data.mixScaleY;
    this.mixShearY = data.mixShearY;
    this.bones = new Array();
    for (let i = 0; i < data.bones.length; i++)
      this.bones.push(skeleton.findBone(data.bones[i].name));
    this.target = skeleton.findBone(data.target.name);
  }
  isActive() {
    return this.active;
  }
  update() {
    if (this.mixRotate == 0 && this.mixX == 0 && this.mixY == 0 && this.mixScaleX == 0 && this.mixScaleY == 0 && this.mixShearY == 0)
      return;
    if (this.data.local) {
      if (this.data.relative)
        this.applyRelativeLocal();
      else
        this.applyAbsoluteLocal();
    } else if (this.data.relative)
      this.applyRelativeWorld();
    else
      this.applyAbsoluteWorld();
  }
  applyAbsoluteWorld() {
    const mixRotate = this.mixRotate;
    const mixX = this.mixX;
    const mixY = this.mixY;
    const mixScaleX = this.mixScaleX;
    const mixScaleY = this.mixScaleY;
    const mixShearY = this.mixShearY;
    const translate = mixX != 0 || mixY != 0;
    const target = this.target;
    const targetMat = target.matrix;
    const ta = targetMat.a;
    const tb = targetMat.c;
    const tc = targetMat.b;
    const td = targetMat.d;
    const degRadReflect = ta * td - tb * tc > 0 ? base.MathUtils.degRad : -base.MathUtils.degRad;
    const offsetRotation = this.data.offsetRotation * degRadReflect;
    const offsetShearY = this.data.offsetShearY * degRadReflect;
    const bones = this.bones;
    for (let i = 0, n = bones.length; i < n; i++) {
      const bone = bones[i];
      const mat = bone.matrix;
      if (mixRotate != 0) {
        const a = mat.a;
        const b = mat.c;
        const c = mat.b;
        const d = mat.d;
        let r = Math.atan2(tc, ta) - Math.atan2(c, a) + offsetRotation;
        if (r > base.MathUtils.PI)
          r -= base.MathUtils.PI2;
        else if (r < -base.MathUtils.PI)
          r += base.MathUtils.PI2;
        r *= mixRotate;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        mat.a = cos * a - sin * c;
        mat.c = cos * b - sin * d;
        mat.b = sin * a + cos * c;
        mat.d = sin * b + cos * d;
      }
      if (translate) {
        const temp = this.temp;
        target.localToWorld(temp.set(this.data.offsetX, this.data.offsetY));
        mat.tx += (temp.x - mat.tx) * mixX;
        mat.ty += (temp.y - mat.ty) * mixY;
      }
      if (mixScaleX != 0) {
        let s = Math.sqrt(mat.a * mat.a + mat.b * mat.b);
        if (s != 0)
          s = (s + (Math.sqrt(ta * ta + tc * tc) - s + this.data.offsetScaleX) * mixScaleX) / s;
        mat.a *= s;
        mat.b *= s;
      }
      if (mixScaleY != 0) {
        let s = Math.sqrt(mat.c * mat.c + mat.d * mat.d);
        if (s != 0)
          s = (s + (Math.sqrt(tb * tb + td * td) - s + this.data.offsetScaleY) * mixScaleY) / s;
        mat.c *= s;
        mat.d *= s;
      }
      if (mixShearY > 0) {
        const b = mat.c;
        const d = mat.d;
        const by = Math.atan2(d, b);
        let r = Math.atan2(td, tb) - Math.atan2(tc, ta) - (by - Math.atan2(mat.b, mat.a));
        if (r > base.MathUtils.PI)
          r -= base.MathUtils.PI2;
        else if (r < -base.MathUtils.PI)
          r += base.MathUtils.PI2;
        r = by + (r + offsetShearY) * mixShearY;
        const s = Math.sqrt(b * b + d * d);
        mat.c = Math.cos(r) * s;
        mat.d = Math.sin(r) * s;
      }
      bone.updateAppliedTransform();
    }
  }
  applyRelativeWorld() {
    const mixRotate = this.mixRotate;
    const mixX = this.mixX;
    const mixY = this.mixY;
    const mixScaleX = this.mixScaleX;
    const mixScaleY = this.mixScaleY;
    const mixShearY = this.mixShearY;
    const translate = mixX != 0 || mixY != 0;
    const target = this.target;
    const targetMat = target.matrix;
    const ta = targetMat.a;
    const tb = targetMat.c;
    const tc = targetMat.b;
    const td = targetMat.d;
    const degRadReflect = ta * td - tb * tc > 0 ? base.MathUtils.degRad : -base.MathUtils.degRad;
    const offsetRotation = this.data.offsetRotation * degRadReflect;
    const offsetShearY = this.data.offsetShearY * degRadReflect;
    const bones = this.bones;
    for (let i = 0, n = bones.length; i < n; i++) {
      const bone = bones[i];
      const mat = bone.matrix;
      if (mixRotate != 0) {
        const a = mat.a;
        const b = mat.c;
        const c = mat.b;
        const d = mat.d;
        let r = Math.atan2(tc, ta) + offsetRotation;
        if (r > base.MathUtils.PI)
          r -= base.MathUtils.PI2;
        else if (r < -base.MathUtils.PI)
          r += base.MathUtils.PI2;
        r *= mixRotate;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        mat.a = cos * a - sin * c;
        mat.c = cos * b - sin * d;
        mat.b = sin * a + cos * c;
        mat.d = sin * b + cos * d;
      }
      if (translate) {
        const temp = this.temp;
        target.localToWorld(temp.set(this.data.offsetX, this.data.offsetY));
        mat.tx += temp.x * mixX;
        mat.ty += temp.y * mixY;
      }
      if (mixScaleX != 0) {
        const s = (Math.sqrt(ta * ta + tc * tc) - 1 + this.data.offsetScaleX) * mixScaleX + 1;
        mat.a *= s;
        mat.b *= s;
      }
      if (mixScaleY != 0) {
        const s = (Math.sqrt(tb * tb + td * td) - 1 + this.data.offsetScaleY) * mixScaleY + 1;
        mat.c *= s;
        mat.d *= s;
      }
      if (mixShearY > 0) {
        let r = Math.atan2(td, tb) - Math.atan2(tc, ta);
        if (r > base.MathUtils.PI)
          r -= base.MathUtils.PI2;
        else if (r < -base.MathUtils.PI)
          r += base.MathUtils.PI2;
        const b = mat.c;
        const d = mat.d;
        r = Math.atan2(d, b) + (r - base.MathUtils.PI / 2 + offsetShearY) * mixShearY;
        const s = Math.sqrt(b * b + d * d);
        mat.c = Math.cos(r) * s;
        mat.d = Math.sin(r) * s;
      }
      bone.updateAppliedTransform();
    }
  }
  applyAbsoluteLocal() {
    const mixRotate = this.mixRotate;
    const mixX = this.mixX;
    const mixY = this.mixY;
    const mixScaleX = this.mixScaleX;
    const mixScaleY = this.mixScaleY;
    const mixShearY = this.mixShearY;
    const target = this.target;
    const bones = this.bones;
    for (let i = 0, n = bones.length; i < n; i++) {
      const bone = bones[i];
      let rotation = bone.arotation;
      if (mixRotate != 0) {
        let r = target.arotation - rotation + this.data.offsetRotation;
        r -= (16384 - (16384.499999999996 - r / 360 | 0)) * 360;
        rotation += r * mixRotate;
      }
      let x = bone.ax;
      let y = bone.ay;
      x += (target.ax - x + this.data.offsetX) * mixX;
      y += (target.ay - y + this.data.offsetY) * mixY;
      let scaleX = bone.ascaleX;
      let scaleY = bone.ascaleY;
      if (mixScaleX != 0 && scaleX != 0)
        scaleX = (scaleX + (target.ascaleX - scaleX + this.data.offsetScaleX) * mixScaleX) / scaleX;
      if (mixScaleY != 0 && scaleY != 0)
        scaleY = (scaleY + (target.ascaleY - scaleY + this.data.offsetScaleY) * mixScaleY) / scaleY;
      let shearY = bone.ashearY;
      if (mixShearY != 0) {
        let r = target.ashearY - shearY + this.data.offsetShearY;
        r -= (16384 - (16384.499999999996 - r / 360 | 0)) * 360;
        shearY += r * mixShearY;
      }
      bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
    }
  }
  applyRelativeLocal() {
    const mixRotate = this.mixRotate;
    const mixX = this.mixX;
    const mixY = this.mixY;
    const mixScaleX = this.mixScaleX;
    const mixScaleY = this.mixScaleY;
    const mixShearY = this.mixShearY;
    const target = this.target;
    const bones = this.bones;
    for (let i = 0, n = bones.length; i < n; i++) {
      const bone = bones[i];
      const rotation = bone.arotation + (target.arotation + this.data.offsetRotation) * mixRotate;
      const x = bone.ax + (target.ax + this.data.offsetX) * mixX;
      const y = bone.ay + (target.ay + this.data.offsetY) * mixY;
      const scaleX = bone.ascaleX * ((target.ascaleX - 1 + this.data.offsetScaleX) * mixScaleX + 1);
      const scaleY = bone.ascaleY * ((target.ascaleY - 1 + this.data.offsetScaleY) * mixScaleY + 1);
      const shearY = bone.ashearY + (target.ashearY + this.data.offsetShearY) * mixShearY;
      bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
    }
  }
}

exports.TransformConstraint = TransformConstraint;
//# sourceMappingURL=TransformConstraint.js.map
