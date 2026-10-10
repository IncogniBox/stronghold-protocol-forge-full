'use strict';

var display = require('@pixi/display');
var graphics = require('@pixi/graphics');
var AttachmentType = require('./core/AttachmentType.js');
var SkeletonBoundsBase = require('./core/SkeletonBoundsBase.js');

class SpineDebugRenderer {
  constructor() {
    this.registeredSpines = /* @__PURE__ */ new Map();
    this.drawDebug = true;
    this.drawMeshHull = true;
    this.drawMeshTriangles = true;
    this.drawBones = true;
    this.drawPaths = true;
    this.drawBoundingBoxes = true;
    this.drawClipping = true;
    this.drawRegionAttachments = true;
    this.lineWidth = 1;
    this.regionAttachmentsColor = 30975;
    this.meshHullColor = 30975;
    this.meshTrianglesColor = 16763904;
    this.clippingPolygonColor = 16711935;
    this.boundingBoxesRectColor = 65280;
    this.boundingBoxesPolygonColor = 65280;
    this.boundingBoxesCircleColor = 65280;
    this.pathsCurveColor = 16711680;
    this.pathsLineColor = 16711935;
    this.skeletonXYColor = 16711680;
    this.bonesColor = 61132;
  }
  /**
   * The debug is attached by force to each spine object. So we need to create it inside the spine when we get the first update
   */
  registerSpine(spine) {
    if (this.registeredSpines.has(spine)) {
      console.warn("SpineDebugRenderer.registerSpine() - this spine is already registered!", spine);
    }
    const debugDisplayObjects = {
      parentDebugContainer: new display.Container(),
      bones: new display.Container(),
      skeletonXY: new graphics.Graphics(),
      regionAttachmentsShape: new graphics.Graphics(),
      meshTrianglesLine: new graphics.Graphics(),
      meshHullLine: new graphics.Graphics(),
      clippingPolygon: new graphics.Graphics(),
      boundingBoxesRect: new graphics.Graphics(),
      boundingBoxesCircle: new graphics.Graphics(),
      boundingBoxesPolygon: new graphics.Graphics(),
      pathsCurve: new graphics.Graphics(),
      pathsLine: new graphics.Graphics()
    };
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.bones);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.skeletonXY);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.regionAttachmentsShape);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.meshTrianglesLine);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.meshHullLine);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.clippingPolygon);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.boundingBoxesRect);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.boundingBoxesCircle);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.boundingBoxesPolygon);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.pathsCurve);
    debugDisplayObjects.parentDebugContainer.addChild(debugDisplayObjects.pathsLine);
    spine.addChild(debugDisplayObjects.parentDebugContainer);
    this.registeredSpines.set(spine, debugDisplayObjects);
  }
  renderDebug(spine) {
    if (!this.registeredSpines.has(spine)) {
      this.registerSpine(spine);
    }
    const debugDisplayObjects = this.registeredSpines.get(spine);
    debugDisplayObjects.skeletonXY.clear();
    debugDisplayObjects.regionAttachmentsShape.clear();
    debugDisplayObjects.meshTrianglesLine.clear();
    debugDisplayObjects.meshHullLine.clear();
    debugDisplayObjects.clippingPolygon.clear();
    debugDisplayObjects.boundingBoxesRect.clear();
    debugDisplayObjects.boundingBoxesCircle.clear();
    debugDisplayObjects.boundingBoxesPolygon.clear();
    debugDisplayObjects.pathsCurve.clear();
    debugDisplayObjects.pathsLine.clear();
    for (let len = debugDisplayObjects.bones.children.length; len > 0; len--) {
      debugDisplayObjects.bones.children[len - 1].destroy({ children: true, texture: true, baseTexture: true });
    }
    const scale = spine.scale.x || spine.scale.y || 1;
    const lineWidth = this.lineWidth / scale;
    if (this.drawBones) {
      this.drawBonesFunc(spine, debugDisplayObjects, lineWidth, scale);
    }
    if (this.drawPaths) {
      this.drawPathsFunc(spine, debugDisplayObjects, lineWidth);
    }
    if (this.drawBoundingBoxes) {
      this.drawBoundingBoxesFunc(spine, debugDisplayObjects, lineWidth);
    }
    if (this.drawClipping) {
      this.drawClippingFunc(spine, debugDisplayObjects, lineWidth);
    }
    if (this.drawMeshHull || this.drawMeshTriangles) {
      this.drawMeshHullAndMeshTriangles(spine, debugDisplayObjects, lineWidth);
    }
    if (this.drawRegionAttachments) {
      this.drawRegionAttachmentsFunc(spine, debugDisplayObjects, lineWidth);
    }
  }
  drawBonesFunc(spine, debugDisplayObjects, lineWidth, scale) {
    const skeleton = spine.skeleton;
    const skeletonX = skeleton.x;
    const skeletonY = skeleton.y;
    const bones = skeleton.bones;
    debugDisplayObjects.skeletonXY.lineStyle(lineWidth, this.skeletonXYColor, 1);
    for (let i = 0, len = bones.length; i < len; i++) {
      const bone = bones[i];
      const boneLen = bone.data.length;
      const starX = skeletonX + bone.matrix.tx;
      const starY = skeletonY + bone.matrix.ty;
      const endX = skeletonX + boneLen * bone.matrix.a + bone.matrix.tx;
      const endY = skeletonY + boneLen * bone.matrix.b + bone.matrix.ty;
      if (bone.data.name === "root" || bone.data.parent === null) {
        continue;
      }
      const w = Math.abs(starX - endX);
      const h = Math.abs(starY - endY);
      const a2 = Math.pow(w, 2);
      const b = h;
      const b2 = Math.pow(h, 2);
      const c = Math.sqrt(a2 + b2);
      const c2 = Math.pow(c, 2);
      const rad = Math.PI / 180;
      const B = Math.acos((c2 + b2 - a2) / (2 * b * c)) || 0;
      if (c === 0) {
        continue;
      }
      const gp = new graphics.Graphics();
      debugDisplayObjects.bones.addChild(gp);
      const refRation = c / 50 / scale;
      gp.beginFill(this.bonesColor, 1);
      gp.drawPolygon(0, 0, 0 - refRation, c - refRation * 3, 0, c - refRation, 0 + refRation, c - refRation * 3);
      gp.endFill();
      gp.x = starX;
      gp.y = starY;
      gp.pivot.y = c;
      let rotation = 0;
      if (starX < endX && starY < endY) {
        rotation = -B + 180 * rad;
      } else if (starX > endX && starY < endY) {
        rotation = 180 * rad + B;
      } else if (starX > endX && starY > endY) {
        rotation = -B;
      } else if (starX < endX && starY > endY) {
        rotation = B;
      } else if (starY === endY && starX < endX) {
        rotation = 90 * rad;
      } else if (starY === endY && starX > endX) {
        rotation = -90 * rad;
      } else if (starX === endX && starY < endY) {
        rotation = 180 * rad;
      } else if (starX === endX && starY > endY) {
        rotation = 0;
      }
      gp.rotation = rotation;
      gp.lineStyle(lineWidth + refRation / 2.4, this.bonesColor, 1);
      gp.beginFill(0, 0.6);
      gp.drawCircle(0, c, refRation * 1.2);
      gp.endFill();
    }
    const startDotSize = lineWidth * 3;
    debugDisplayObjects.skeletonXY.moveTo(skeletonX - startDotSize, skeletonY - startDotSize);
    debugDisplayObjects.skeletonXY.lineTo(skeletonX + startDotSize, skeletonY + startDotSize);
    debugDisplayObjects.skeletonXY.moveTo(skeletonX + startDotSize, skeletonY - startDotSize);
    debugDisplayObjects.skeletonXY.lineTo(skeletonX - startDotSize, skeletonY + startDotSize);
  }
  drawRegionAttachmentsFunc(spine, debugDisplayObjects, lineWidth) {
    const skeleton = spine.skeleton;
    const slots = skeleton.slots;
    debugDisplayObjects.regionAttachmentsShape.lineStyle(lineWidth, this.regionAttachmentsColor, 1);
    for (let i = 0, len = slots.length; i < len; i++) {
      const slot = slots[i];
      const attachment = slot.getAttachment();
      if (attachment == null || attachment.type !== AttachmentType.AttachmentType.Region) {
        continue;
      }
      const regionAttachment = attachment;
      const vertices = new Float32Array(8);
      if (regionAttachment.updateOffset)
        regionAttachment.updateOffset();
      regionAttachment.computeWorldVertices(slot, vertices, 0, 2);
      debugDisplayObjects.regionAttachmentsShape.drawPolygon(Array.from(vertices.slice(0, 8)));
    }
  }
  drawMeshHullAndMeshTriangles(spine, debugDisplayObjects, lineWidth) {
    const skeleton = spine.skeleton;
    const slots = skeleton.slots;
    debugDisplayObjects.meshHullLine.lineStyle(lineWidth, this.meshHullColor, 1);
    debugDisplayObjects.meshTrianglesLine.lineStyle(lineWidth, this.meshTrianglesColor, 1);
    for (let i = 0, len = slots.length; i < len; i++) {
      const slot = slots[i];
      if (!slot.bone.active) {
        continue;
      }
      const attachment = slot.getAttachment();
      if (attachment == null || attachment.type !== AttachmentType.AttachmentType.Mesh) {
        continue;
      }
      const meshAttachment = attachment;
      const vertices = new Float32Array(meshAttachment.worldVerticesLength);
      const triangles = meshAttachment.triangles;
      let hullLength = meshAttachment.hullLength;
      meshAttachment.computeWorldVertices(slot, 0, meshAttachment.worldVerticesLength, vertices, 0, 2);
      if (this.drawMeshTriangles) {
        for (let i2 = 0, len2 = triangles.length; i2 < len2; i2 += 3) {
          const v1 = triangles[i2] * 2;
          const v2 = triangles[i2 + 1] * 2;
          const v3 = triangles[i2 + 2] * 2;
          debugDisplayObjects.meshTrianglesLine.moveTo(vertices[v1], vertices[v1 + 1]);
          debugDisplayObjects.meshTrianglesLine.lineTo(vertices[v2], vertices[v2 + 1]);
          debugDisplayObjects.meshTrianglesLine.lineTo(vertices[v3], vertices[v3 + 1]);
        }
      }
      if (this.drawMeshHull && hullLength > 0) {
        hullLength = (hullLength >> 1) * 2;
        let lastX = vertices[hullLength - 2];
        let lastY = vertices[hullLength - 1];
        for (let i2 = 0, len2 = hullLength; i2 < len2; i2 += 2) {
          const x = vertices[i2];
          const y = vertices[i2 + 1];
          debugDisplayObjects.meshHullLine.moveTo(x, y);
          debugDisplayObjects.meshHullLine.lineTo(lastX, lastY);
          lastX = x;
          lastY = y;
        }
      }
    }
  }
  drawClippingFunc(spine, debugDisplayObjects, lineWidth) {
    const skeleton = spine.skeleton;
    const slots = skeleton.slots;
    debugDisplayObjects.clippingPolygon.lineStyle(lineWidth, this.clippingPolygonColor, 1);
    for (let i = 0, len = slots.length; i < len; i++) {
      const slot = slots[i];
      if (!slot.bone.active) {
        continue;
      }
      const attachment = slot.getAttachment();
      if (attachment == null || attachment.type !== AttachmentType.AttachmentType.Clipping) {
        continue;
      }
      const clippingAttachment = attachment;
      const nn = clippingAttachment.worldVerticesLength;
      const world = new Float32Array(nn);
      clippingAttachment.computeWorldVertices(slot, 0, nn, world, 0, 2);
      debugDisplayObjects.clippingPolygon.drawPolygon(Array.from(world));
    }
  }
  drawBoundingBoxesFunc(spine, debugDisplayObjects, lineWidth) {
    debugDisplayObjects.boundingBoxesRect.lineStyle(lineWidth, this.boundingBoxesRectColor, 5);
    const bounds = new SkeletonBoundsBase.SkeletonBoundsBase();
    bounds.update(spine.skeleton, true);
    debugDisplayObjects.boundingBoxesRect.drawRect(bounds.minX, bounds.minY, bounds.getWidth(), bounds.getHeight());
    const polygons = bounds.polygons;
    const drawPolygon = (polygonVertices, _offset, count) => {
      debugDisplayObjects.boundingBoxesPolygon.lineStyle(lineWidth, this.boundingBoxesPolygonColor, 1);
      debugDisplayObjects.boundingBoxesPolygon.beginFill(this.boundingBoxesPolygonColor, 0.1);
      if (count < 3) {
        throw new Error("Polygon must contain at least 3 vertices");
      }
      const paths = [];
      const dotSize = lineWidth * 2;
      for (let i = 0, len = polygonVertices.length; i < len; i += 2) {
        const x1 = polygonVertices[i];
        const y1 = polygonVertices[i + 1];
        debugDisplayObjects.boundingBoxesCircle.lineStyle(0);
        debugDisplayObjects.boundingBoxesCircle.beginFill(this.boundingBoxesCircleColor);
        debugDisplayObjects.boundingBoxesCircle.drawCircle(x1, y1, dotSize);
        debugDisplayObjects.boundingBoxesCircle.endFill();
        paths.push(x1, y1);
      }
      debugDisplayObjects.boundingBoxesPolygon.drawPolygon(paths);
      debugDisplayObjects.boundingBoxesPolygon.endFill();
    };
    for (let i = 0, len = polygons.length; i < len; i++) {
      const polygon = polygons[i];
      drawPolygon(polygon, 0, polygon.length);
    }
  }
  drawPathsFunc(spine, debugDisplayObjects, lineWidth) {
    const skeleton = spine.skeleton;
    const slots = skeleton.slots;
    debugDisplayObjects.pathsCurve.lineStyle(lineWidth, this.pathsCurveColor, 1);
    debugDisplayObjects.pathsLine.lineStyle(lineWidth, this.pathsLineColor, 1);
    for (let i = 0, len = slots.length; i < len; i++) {
      const slot = slots[i];
      if (!slot.bone.active) {
        continue;
      }
      const attachment = slot.getAttachment();
      if (attachment == null || attachment.type !== AttachmentType.AttachmentType.Path) {
        continue;
      }
      const pathAttachment = attachment;
      let nn = pathAttachment.worldVerticesLength;
      const world = new Float32Array(nn);
      pathAttachment.computeWorldVertices(slot, 0, nn, world, 0, 2);
      let x1 = world[2];
      let y1 = world[3];
      let x2 = 0;
      let y2 = 0;
      if (pathAttachment.closed) {
        const cx1 = world[0];
        const cy1 = world[1];
        const cx2 = world[nn - 2];
        const cy2 = world[nn - 1];
        x2 = world[nn - 4];
        y2 = world[nn - 3];
        debugDisplayObjects.pathsCurve.moveTo(x1, y1);
        debugDisplayObjects.pathsCurve.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
        debugDisplayObjects.pathsLine.moveTo(x1, y1);
        debugDisplayObjects.pathsLine.lineTo(cx1, cy1);
        debugDisplayObjects.pathsLine.moveTo(x2, y2);
        debugDisplayObjects.pathsLine.lineTo(cx2, cy2);
      }
      nn -= 4;
      for (let ii = 4; ii < nn; ii += 6) {
        const cx1 = world[ii];
        const cy1 = world[ii + 1];
        const cx2 = world[ii + 2];
        const cy2 = world[ii + 3];
        x2 = world[ii + 4];
        y2 = world[ii + 5];
        debugDisplayObjects.pathsCurve.moveTo(x1, y1);
        debugDisplayObjects.pathsCurve.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
        debugDisplayObjects.pathsLine.moveTo(x1, y1);
        debugDisplayObjects.pathsLine.lineTo(cx1, cy1);
        debugDisplayObjects.pathsLine.moveTo(x2, y2);
        debugDisplayObjects.pathsLine.lineTo(cx2, cy2);
        x1 = x2;
        y1 = y2;
      }
    }
  }
  unregisterSpine(spine) {
    if (!this.registeredSpines.has(spine)) {
      console.warn("SpineDebugRenderer.unregisterSpine() - spine is not registered, can't unregister!", spine);
    }
    const debugDisplayObjects = this.registeredSpines.get(spine);
    debugDisplayObjects.parentDebugContainer.destroy({ baseTexture: true, children: true, texture: true });
    this.registeredSpines.delete(spine);
  }
}

exports.SpineDebugRenderer = SpineDebugRenderer;
//# sourceMappingURL=SpineDebugRenderer.js.map
