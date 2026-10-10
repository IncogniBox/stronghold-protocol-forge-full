'use strict';

var Event = require('./Event.js');
var SkeletonData = require('./SkeletonData.js');
var SlotData = require('./SlotData.js');
var BoneData = require('./BoneData.js');
var IkConstraintData = require('./IkConstraintData.js');
var TransformConstraintData = require('./TransformConstraintData.js');
var PathConstraintData = require('./PathConstraintData.js');
var Skin = require('./Skin.js');
var EventData = require('./EventData.js');
var Animation = require('./Animation.js');
var base = require('@pixi-spine/base');
var core = require('@pixi/core');

const _SkeletonBinary = class {
  constructor(attachmentLoader) {
    this.scale = 1;
    this.linkedMeshes = new Array();
    this.attachmentLoader = attachmentLoader;
  }
  readSkeletonData(binary) {
    const scale = this.scale;
    const skeletonData = new SkeletonData.SkeletonData();
    skeletonData.name = "";
    const input = new base.BinaryInput(binary);
    skeletonData.hash = input.readString();
    skeletonData.version = input.readString();
    if (skeletonData.version === "3.8.75") {
      const error = `Unsupported skeleton data, 3.8.75 is deprecated, please export with a newer version of Spine.`;
      console.error(error);
    }
    skeletonData.x = input.readFloat();
    skeletonData.y = input.readFloat();
    skeletonData.width = input.readFloat();
    skeletonData.height = input.readFloat();
    const nonessential = input.readBoolean();
    if (nonessential) {
      skeletonData.fps = input.readFloat();
      skeletonData.imagesPath = input.readString();
      skeletonData.audioPath = input.readString();
    }
    let n = 0;
    n = input.readInt(true);
    for (let i = 0; i < n; i++)
      input.strings.push(input.readString());
    n = input.readInt(true);
    for (let i = 0; i < n; i++) {
      const name = input.readString();
      const parent = i == 0 ? null : skeletonData.bones[input.readInt(true)];
      const data = new BoneData.BoneData(i, name, parent);
      data.rotation = input.readFloat();
      data.x = input.readFloat() * scale;
      data.y = input.readFloat() * scale;
      data.scaleX = input.readFloat();
      data.scaleY = input.readFloat();
      data.shearX = input.readFloat();
      data.shearY = input.readFloat();
      data.length = input.readFloat() * scale;
      data.transformMode = _SkeletonBinary.TransformModeValues[input.readInt(true)];
      data.skinRequired = input.readBoolean();
      if (nonessential)
        base.Color.rgba8888ToColor(data.color, input.readInt32());
      skeletonData.bones.push(data);
    }
    n = input.readInt(true);
    for (let i = 0; i < n; i++) {
      const slotName = input.readString();
      const boneData = skeletonData.bones[input.readInt(true)];
      const data = new SlotData.SlotData(i, slotName, boneData);
      base.Color.rgba8888ToColor(data.color, input.readInt32());
      const darkColor = input.readInt32();
      if (darkColor != -1)
        base.Color.rgb888ToColor(data.darkColor = new base.Color(), darkColor);
      data.attachmentName = input.readStringRef();
      data.blendMode = _SkeletonBinary.BlendModeValues[input.readInt(true)];
      skeletonData.slots.push(data);
    }
    n = input.readInt(true);
    for (let i = 0, nn; i < n; i++) {
      const data = new IkConstraintData.IkConstraintData(input.readString());
      data.order = input.readInt(true);
      data.skinRequired = input.readBoolean();
      nn = input.readInt(true);
      for (let ii = 0; ii < nn; ii++)
        data.bones.push(skeletonData.bones[input.readInt(true)]);
      data.target = skeletonData.bones[input.readInt(true)];
      data.mix = input.readFloat();
      data.softness = input.readFloat() * scale;
      data.bendDirection = input.readByte();
      data.compress = input.readBoolean();
      data.stretch = input.readBoolean();
      data.uniform = input.readBoolean();
      skeletonData.ikConstraints.push(data);
    }
    n = input.readInt(true);
    for (let i = 0, nn; i < n; i++) {
      const data = new TransformConstraintData.TransformConstraintData(input.readString());
      data.order = input.readInt(true);
      data.skinRequired = input.readBoolean();
      nn = input.readInt(true);
      for (let ii = 0; ii < nn; ii++)
        data.bones.push(skeletonData.bones[input.readInt(true)]);
      data.target = skeletonData.bones[input.readInt(true)];
      data.local = input.readBoolean();
      data.relative = input.readBoolean();
      data.offsetRotation = input.readFloat();
      data.offsetX = input.readFloat() * scale;
      data.offsetY = input.readFloat() * scale;
      data.offsetScaleX = input.readFloat();
      data.offsetScaleY = input.readFloat();
      data.offsetShearY = input.readFloat();
      data.rotateMix = input.readFloat();
      data.translateMix = input.readFloat();
      data.scaleMix = input.readFloat();
      data.shearMix = input.readFloat();
      skeletonData.transformConstraints.push(data);
    }
    n = input.readInt(true);
    for (let i = 0, nn; i < n; i++) {
      const data = new PathConstraintData.PathConstraintData(input.readString());
      data.order = input.readInt(true);
      data.skinRequired = input.readBoolean();
      nn = input.readInt(true);
      for (let ii = 0; ii < nn; ii++)
        data.bones.push(skeletonData.bones[input.readInt(true)]);
      data.target = skeletonData.slots[input.readInt(true)];
      data.positionMode = _SkeletonBinary.PositionModeValues[input.readInt(true)];
      data.spacingMode = _SkeletonBinary.SpacingModeValues[input.readInt(true)];
      data.rotateMode = _SkeletonBinary.RotateModeValues[input.readInt(true)];
      data.offsetRotation = input.readFloat();
      data.position = input.readFloat();
      if (data.positionMode == base.PositionMode.Fixed)
        data.position *= scale;
      data.spacing = input.readFloat();
      if (data.spacingMode == PathConstraintData.SpacingMode.Length || data.spacingMode == PathConstraintData.SpacingMode.Fixed)
        data.spacing *= scale;
      data.rotateMix = input.readFloat();
      data.translateMix = input.readFloat();
      skeletonData.pathConstraints.push(data);
    }
    const defaultSkin = this.readSkin(input, skeletonData, true, nonessential);
    if (defaultSkin != null) {
      skeletonData.defaultSkin = defaultSkin;
      skeletonData.skins.push(defaultSkin);
    }
    {
      let i = skeletonData.skins.length;
      base.Utils.setArraySize(skeletonData.skins, n = i + input.readInt(true));
      for (; i < n; i++)
        skeletonData.skins[i] = this.readSkin(input, skeletonData, false, nonessential);
    }
    n = this.linkedMeshes.length;
    for (let i = 0; i < n; i++) {
      const linkedMesh = this.linkedMeshes[i];
      const skin = linkedMesh.skin == null ? skeletonData.defaultSkin : skeletonData.findSkin(linkedMesh.skin);
      if (skin == null)
        throw new Error(`Skin not found: ${linkedMesh.skin}`);
      const parent = skin.getAttachment(linkedMesh.slotIndex, linkedMesh.parent);
      if (parent == null)
        throw new Error(`Parent mesh not found: ${linkedMesh.parent}`);
      linkedMesh.mesh.deformAttachment = linkedMesh.inheritDeform ? parent : linkedMesh.mesh;
      linkedMesh.mesh.setParentMesh(parent);
    }
    this.linkedMeshes.length = 0;
    n = input.readInt(true);
    for (let i = 0; i < n; i++) {
      const data = new EventData.EventData(input.readStringRef());
      data.intValue = input.readInt(false);
      data.floatValue = input.readFloat();
      data.stringValue = input.readString();
      data.audioPath = input.readString();
      if (data.audioPath != null) {
        data.volume = input.readFloat();
        data.balance = input.readFloat();
      }
      skeletonData.events.push(data);
    }
    n = input.readInt(true);
    for (let i = 0; i < n; i++)
      skeletonData.animations.push(this.readAnimation(input, input.readString(), skeletonData));
    return skeletonData;
  }
  readSkin(input, skeletonData, defaultSkin, nonessential) {
    let skin = null;
    let slotCount = 0;
    if (defaultSkin) {
      slotCount = input.readInt(true);
      if (slotCount == 0)
        return null;
      skin = new Skin.Skin("default");
    } else {
      skin = new Skin.Skin(input.readStringRef());
      skin.bones.length = input.readInt(true);
      for (let i = 0, n = skin.bones.length; i < n; i++)
        skin.bones[i] = skeletonData.bones[input.readInt(true)];
      for (let i = 0, n = input.readInt(true); i < n; i++)
        skin.constraints.push(skeletonData.ikConstraints[input.readInt(true)]);
      for (let i = 0, n = input.readInt(true); i < n; i++)
        skin.constraints.push(skeletonData.transformConstraints[input.readInt(true)]);
      for (let i = 0, n = input.readInt(true); i < n; i++)
        skin.constraints.push(skeletonData.pathConstraints[input.readInt(true)]);
      slotCount = input.readInt(true);
    }
    for (let i = 0; i < slotCount; i++) {
      const slotIndex = input.readInt(true);
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const name = input.readStringRef();
        const attachment = this.readAttachment(input, skeletonData, skin, slotIndex, name, nonessential);
        if (attachment != null)
          skin.setAttachment(slotIndex, name, attachment);
      }
    }
    return skin;
  }
  readAttachment(input, skeletonData, skin, slotIndex, attachmentName, nonessential) {
    const scale = this.scale;
    let name = input.readStringRef();
    if (name == null)
      name = attachmentName;
    const typeIndex = input.readByte();
    const type = _SkeletonBinary.AttachmentTypeValues[typeIndex];
    switch (type) {
      case base.AttachmentType.Region: {
        let path = input.readStringRef();
        const rotation = input.readFloat();
        const x = input.readFloat();
        const y = input.readFloat();
        const scaleX = input.readFloat();
        const scaleY = input.readFloat();
        const width = input.readFloat();
        const height = input.readFloat();
        const color = input.readInt32();
        if (path == null)
          path = name;
        const region = this.attachmentLoader.newRegionAttachment(skin, name, path);
        if (region == null)
          return null;
        region.path = path;
        region.x = x * scale;
        region.y = y * scale;
        region.scaleX = scaleX;
        region.scaleY = scaleY;
        region.rotation = rotation;
        region.width = width * scale;
        region.height = height * scale;
        base.Color.rgba8888ToColor(region.color, color);
        return region;
      }
      case base.AttachmentType.BoundingBox: {
        const vertexCount = input.readInt(true);
        const vertices = this.readVertices(input, vertexCount);
        const color = nonessential ? input.readInt32() : 0;
        const box = this.attachmentLoader.newBoundingBoxAttachment(skin, name);
        if (box == null)
          return null;
        box.worldVerticesLength = vertexCount << 1;
        box.vertices = vertices.vertices;
        box.bones = vertices.bones;
        if (nonessential)
          base.Color.rgba8888ToColor(box.color, color);
        return box;
      }
      case base.AttachmentType.Mesh: {
        let path = input.readStringRef();
        const color = input.readInt32();
        const vertexCount = input.readInt(true);
        const uvs = this.readFloatArray(input, vertexCount << 1, 1);
        const triangles = this.readShortArray(input);
        const vertices = this.readVertices(input, vertexCount);
        const hullLength = input.readInt(true);
        let edges = null;
        let width = 0;
        let height = 0;
        if (nonessential) {
          edges = this.readShortArray(input);
          width = input.readFloat();
          height = input.readFloat();
        }
        if (path == null)
          path = name;
        const mesh = this.attachmentLoader.newMeshAttachment(skin, name, path);
        if (mesh == null)
          return null;
        mesh.path = path;
        base.Color.rgba8888ToColor(mesh.color, color);
        mesh.bones = vertices.bones;
        mesh.vertices = vertices.vertices;
        mesh.worldVerticesLength = vertexCount << 1;
        mesh.triangles = triangles;
        mesh.regionUVs = new Float32Array(uvs);
        mesh.hullLength = hullLength << 1;
        if (nonessential) {
          mesh.edges = edges;
          mesh.width = width * scale;
          mesh.height = height * scale;
        }
        return mesh;
      }
      case base.AttachmentType.LinkedMesh: {
        let path = input.readStringRef();
        const color = input.readInt32();
        const skinName = input.readStringRef();
        const parent = input.readStringRef();
        const inheritDeform = input.readBoolean();
        let width = 0;
        let height = 0;
        if (nonessential) {
          width = input.readFloat();
          height = input.readFloat();
        }
        if (path == null)
          path = name;
        const mesh = this.attachmentLoader.newMeshAttachment(skin, name, path);
        if (mesh == null)
          return null;
        mesh.path = path;
        base.Color.rgba8888ToColor(mesh.color, color);
        if (nonessential) {
          mesh.width = width * scale;
          mesh.height = height * scale;
        }
        this.linkedMeshes.push(new LinkedMesh(mesh, skinName, slotIndex, parent, inheritDeform));
        return mesh;
      }
      case base.AttachmentType.Path: {
        const closed = input.readBoolean();
        const constantSpeed = input.readBoolean();
        const vertexCount = input.readInt(true);
        const vertices = this.readVertices(input, vertexCount);
        const lengths = base.Utils.newArray(vertexCount / 3, 0);
        for (let i = 0, n = lengths.length; i < n; i++)
          lengths[i] = input.readFloat() * scale;
        const color = nonessential ? input.readInt32() : 0;
        const path = this.attachmentLoader.newPathAttachment(skin, name);
        if (path == null)
          return null;
        path.closed = closed;
        path.constantSpeed = constantSpeed;
        path.worldVerticesLength = vertexCount << 1;
        path.vertices = vertices.vertices;
        path.bones = vertices.bones;
        path.lengths = lengths;
        if (nonessential)
          base.Color.rgba8888ToColor(path.color, color);
        return path;
      }
      case base.AttachmentType.Point: {
        const rotation = input.readFloat();
        const x = input.readFloat();
        const y = input.readFloat();
        const color = nonessential ? input.readInt32() : 0;
        const point = this.attachmentLoader.newPointAttachment(skin, name);
        if (point == null)
          return null;
        point.x = x * scale;
        point.y = y * scale;
        point.rotation = rotation;
        if (nonessential)
          base.Color.rgba8888ToColor(point.color, color);
        return point;
      }
      case base.AttachmentType.Clipping: {
        const endSlotIndex = input.readInt(true);
        const vertexCount = input.readInt(true);
        const vertices = this.readVertices(input, vertexCount);
        const color = nonessential ? input.readInt32() : 0;
        const clip = this.attachmentLoader.newClippingAttachment(skin, name);
        if (clip == null)
          return null;
        clip.endSlot = skeletonData.slots[endSlotIndex];
        clip.worldVerticesLength = vertexCount << 1;
        clip.vertices = vertices.vertices;
        clip.bones = vertices.bones;
        if (nonessential)
          base.Color.rgba8888ToColor(clip.color, color);
        return clip;
      }
    }
    return null;
  }
  readVertices(input, vertexCount) {
    const verticesLength = vertexCount << 1;
    const vertices = new Vertices();
    const scale = this.scale;
    if (!input.readBoolean()) {
      vertices.vertices = this.readFloatArray(input, verticesLength, scale);
      return vertices;
    }
    const weights = new Array();
    const bonesArray = new Array();
    for (let i = 0; i < vertexCount; i++) {
      const boneCount = input.readInt(true);
      bonesArray.push(boneCount);
      for (let ii = 0; ii < boneCount; ii++) {
        bonesArray.push(input.readInt(true));
        weights.push(input.readFloat() * scale);
        weights.push(input.readFloat() * scale);
        weights.push(input.readFloat());
      }
    }
    vertices.vertices = base.Utils.toFloatArray(weights);
    vertices.bones = bonesArray;
    return vertices;
  }
  readFloatArray(input, n, scale) {
    const array = new Array(n);
    if (scale == 1) {
      for (let i = 0; i < n; i++)
        array[i] = input.readFloat();
    } else {
      for (let i = 0; i < n; i++)
        array[i] = input.readFloat() * scale;
    }
    return array;
  }
  readShortArray(input) {
    const n = input.readInt(true);
    const array = new Array(n);
    for (let i = 0; i < n; i++)
      array[i] = input.readShort();
    return array;
  }
  readAnimation(input, name, skeletonData) {
    const timelines = new Array();
    const scale = this.scale;
    let duration = 0;
    const tempColor1 = new base.Color();
    const tempColor2 = new base.Color();
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const slotIndex = input.readInt(true);
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const timelineType = input.readByte();
        const frameCount = input.readInt(true);
        switch (timelineType) {
          case _SkeletonBinary.SLOT_ATTACHMENT: {
            const timeline = new Animation.AttachmentTimeline(frameCount);
            timeline.slotIndex = slotIndex;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++)
              timeline.setFrame(frameIndex, input.readFloat(), input.readStringRef());
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[frameCount - 1]);
            break;
          }
          case _SkeletonBinary.SLOT_COLOR: {
            const timeline = new Animation.ColorTimeline(frameCount);
            timeline.slotIndex = slotIndex;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
              const time = input.readFloat();
              base.Color.rgba8888ToColor(tempColor1, input.readInt32());
              timeline.setFrame(frameIndex, time, tempColor1.r, tempColor1.g, tempColor1.b, tempColor1.a);
              if (frameIndex < frameCount - 1)
                this.readCurve(input, frameIndex, timeline);
            }
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.ColorTimeline.ENTRIES]);
            break;
          }
          case _SkeletonBinary.SLOT_TWO_COLOR: {
            const timeline = new Animation.TwoColorTimeline(frameCount);
            timeline.slotIndex = slotIndex;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
              const time = input.readFloat();
              base.Color.rgba8888ToColor(tempColor1, input.readInt32());
              base.Color.rgb888ToColor(tempColor2, input.readInt32());
              timeline.setFrame(frameIndex, time, tempColor1.r, tempColor1.g, tempColor1.b, tempColor1.a, tempColor2.r, tempColor2.g, tempColor2.b);
              if (frameIndex < frameCount - 1)
                this.readCurve(input, frameIndex, timeline);
            }
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.TwoColorTimeline.ENTRIES]);
            break;
          }
        }
      }
    }
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const boneIndex = input.readInt(true);
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const timelineType = input.readByte();
        const frameCount = input.readInt(true);
        switch (timelineType) {
          case _SkeletonBinary.BONE_ROTATE: {
            const timeline = new Animation.RotateTimeline(frameCount);
            timeline.boneIndex = boneIndex;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
              timeline.setFrame(frameIndex, input.readFloat(), input.readFloat());
              if (frameIndex < frameCount - 1)
                this.readCurve(input, frameIndex, timeline);
            }
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.RotateTimeline.ENTRIES]);
            break;
          }
          case _SkeletonBinary.BONE_TRANSLATE:
          case _SkeletonBinary.BONE_SCALE:
          case _SkeletonBinary.BONE_SHEAR: {
            let timeline;
            let timelineScale = 1;
            if (timelineType == _SkeletonBinary.BONE_SCALE)
              timeline = new Animation.ScaleTimeline(frameCount);
            else if (timelineType == _SkeletonBinary.BONE_SHEAR)
              timeline = new Animation.ShearTimeline(frameCount);
            else {
              timeline = new Animation.TranslateTimeline(frameCount);
              timelineScale = scale;
            }
            timeline.boneIndex = boneIndex;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
              timeline.setFrame(frameIndex, input.readFloat(), input.readFloat() * timelineScale, input.readFloat() * timelineScale);
              if (frameIndex < frameCount - 1)
                this.readCurve(input, frameIndex, timeline);
            }
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.TranslateTimeline.ENTRIES]);
            break;
          }
        }
      }
    }
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const index = input.readInt(true);
      const frameCount = input.readInt(true);
      const timeline = new Animation.IkConstraintTimeline(frameCount);
      timeline.ikConstraintIndex = index;
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        timeline.setFrame(frameIndex, input.readFloat(), input.readFloat(), input.readFloat() * scale, input.readByte(), input.readBoolean(), input.readBoolean());
        if (frameIndex < frameCount - 1)
          this.readCurve(input, frameIndex, timeline);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.IkConstraintTimeline.ENTRIES]);
    }
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const index = input.readInt(true);
      const frameCount = input.readInt(true);
      const timeline = new Animation.TransformConstraintTimeline(frameCount);
      timeline.transformConstraintIndex = index;
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        timeline.setFrame(frameIndex, input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat());
        if (frameIndex < frameCount - 1)
          this.readCurve(input, frameIndex, timeline);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.TransformConstraintTimeline.ENTRIES]);
    }
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const index = input.readInt(true);
      const data = skeletonData.pathConstraints[index];
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const timelineType = input.readByte();
        const frameCount = input.readInt(true);
        switch (timelineType) {
          case _SkeletonBinary.PATH_POSITION:
          case _SkeletonBinary.PATH_SPACING: {
            let timeline;
            let timelineScale = 1;
            if (timelineType == _SkeletonBinary.PATH_SPACING) {
              timeline = new Animation.PathConstraintSpacingTimeline(frameCount);
              if (data.spacingMode == PathConstraintData.SpacingMode.Length || data.spacingMode == PathConstraintData.SpacingMode.Fixed)
                timelineScale = scale;
            } else {
              timeline = new Animation.PathConstraintPositionTimeline(frameCount);
              if (data.positionMode == base.PositionMode.Fixed)
                timelineScale = scale;
            }
            timeline.pathConstraintIndex = index;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
              timeline.setFrame(frameIndex, input.readFloat(), input.readFloat() * timelineScale);
              if (frameIndex < frameCount - 1)
                this.readCurve(input, frameIndex, timeline);
            }
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.PathConstraintPositionTimeline.ENTRIES]);
            break;
          }
          case _SkeletonBinary.PATH_MIX: {
            const timeline = new Animation.PathConstraintMixTimeline(frameCount);
            timeline.pathConstraintIndex = index;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
              timeline.setFrame(frameIndex, input.readFloat(), input.readFloat(), input.readFloat());
              if (frameIndex < frameCount - 1)
                this.readCurve(input, frameIndex, timeline);
            }
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[(frameCount - 1) * Animation.PathConstraintMixTimeline.ENTRIES]);
            break;
          }
        }
      }
    }
    for (let i = 0, n = input.readInt(true); i < n; i++) {
      const skin = skeletonData.skins[input.readInt(true)];
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        const slotIndex = input.readInt(true);
        for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii++) {
          const attachment = skin.getAttachment(slotIndex, input.readStringRef());
          const weighted = attachment.bones != null;
          const vertices = attachment.vertices;
          const deformLength = weighted ? vertices.length / 3 * 2 : vertices.length;
          const frameCount = input.readInt(true);
          const timeline = new Animation.DeformTimeline(frameCount);
          timeline.slotIndex = slotIndex;
          timeline.attachment = attachment;
          for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            const time = input.readFloat();
            let deform;
            let end = input.readInt(true);
            if (end == 0)
              deform = weighted ? base.Utils.newFloatArray(deformLength) : vertices;
            else {
              deform = base.Utils.newFloatArray(deformLength);
              const start = input.readInt(true);
              end += start;
              if (scale == 1) {
                for (let v = start; v < end; v++)
                  deform[v] = input.readFloat();
              } else {
                for (let v = start; v < end; v++)
                  deform[v] = input.readFloat() * scale;
              }
              if (!weighted) {
                for (let v = 0, vn = deform.length; v < vn; v++)
                  deform[v] += vertices[v];
              }
            }
            timeline.setFrame(frameIndex, time, deform);
            if (frameIndex < frameCount - 1)
              this.readCurve(input, frameIndex, timeline);
          }
          timelines.push(timeline);
          duration = Math.max(duration, timeline.frames[frameCount - 1]);
        }
      }
    }
    const drawOrderCount = input.readInt(true);
    if (drawOrderCount > 0) {
      const timeline = new Animation.DrawOrderTimeline(drawOrderCount);
      const slotCount = skeletonData.slots.length;
      for (let i = 0; i < drawOrderCount; i++) {
        const time = input.readFloat();
        const offsetCount = input.readInt(true);
        const drawOrder = base.Utils.newArray(slotCount, 0);
        for (let ii = slotCount - 1; ii >= 0; ii--)
          drawOrder[ii] = -1;
        const unchanged = base.Utils.newArray(slotCount - offsetCount, 0);
        let originalIndex = 0;
        let unchangedIndex = 0;
        for (let ii = 0; ii < offsetCount; ii++) {
          const slotIndex = input.readInt(true);
          while (originalIndex != slotIndex)
            unchanged[unchangedIndex++] = originalIndex++;
          drawOrder[originalIndex + input.readInt(true)] = originalIndex++;
        }
        while (originalIndex < slotCount)
          unchanged[unchangedIndex++] = originalIndex++;
        for (let ii = slotCount - 1; ii >= 0; ii--)
          if (drawOrder[ii] == -1)
            drawOrder[ii] = unchanged[--unchangedIndex];
        timeline.setFrame(i, time, drawOrder);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[drawOrderCount - 1]);
    }
    const eventCount = input.readInt(true);
    if (eventCount > 0) {
      const timeline = new Animation.EventTimeline(eventCount);
      for (let i = 0; i < eventCount; i++) {
        const time = input.readFloat();
        const eventData = skeletonData.events[input.readInt(true)];
        const event = new Event.Event(time, eventData);
        event.intValue = input.readInt(false);
        event.floatValue = input.readFloat();
        event.stringValue = input.readBoolean() ? input.readString() : eventData.stringValue;
        if (event.data.audioPath != null) {
          event.volume = input.readFloat();
          event.balance = input.readFloat();
        }
        timeline.setFrame(i, event);
      }
      timelines.push(timeline);
      duration = Math.max(duration, timeline.frames[eventCount - 1]);
    }
    return new Animation.Animation(name, timelines, duration);
  }
  readCurve(input, frameIndex, timeline) {
    switch (input.readByte()) {
      case _SkeletonBinary.CURVE_STEPPED:
        timeline.setStepped(frameIndex);
        break;
      case _SkeletonBinary.CURVE_BEZIER:
        this.setCurve(timeline, frameIndex, input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat());
        break;
    }
  }
  setCurve(timeline, frameIndex, cx1, cy1, cx2, cy2) {
    timeline.setCurve(frameIndex, cx1, cy1, cx2, cy2);
  }
};
let SkeletonBinary = _SkeletonBinary;
SkeletonBinary.AttachmentTypeValues = [
  0,
  1,
  2,
  3,
  4,
  5,
  6
];
SkeletonBinary.TransformModeValues = [
  base.TransformMode.Normal,
  base.TransformMode.OnlyTranslation,
  base.TransformMode.NoRotationOrReflection,
  base.TransformMode.NoScale,
  base.TransformMode.NoScaleOrReflection
];
SkeletonBinary.PositionModeValues = [base.PositionMode.Fixed, base.PositionMode.Percent];
SkeletonBinary.SpacingModeValues = [PathConstraintData.SpacingMode.Length, PathConstraintData.SpacingMode.Fixed, PathConstraintData.SpacingMode.Percent];
SkeletonBinary.RotateModeValues = [base.RotateMode.Tangent, base.RotateMode.Chain, base.RotateMode.ChainScale];
SkeletonBinary.BlendModeValues = [core.BLEND_MODES.NORMAL, core.BLEND_MODES.ADD, core.BLEND_MODES.MULTIPLY, core.BLEND_MODES.SCREEN];
SkeletonBinary.BONE_ROTATE = 0;
SkeletonBinary.BONE_TRANSLATE = 1;
SkeletonBinary.BONE_SCALE = 2;
SkeletonBinary.BONE_SHEAR = 3;
SkeletonBinary.SLOT_ATTACHMENT = 0;
SkeletonBinary.SLOT_COLOR = 1;
SkeletonBinary.SLOT_TWO_COLOR = 2;
SkeletonBinary.PATH_POSITION = 0;
SkeletonBinary.PATH_SPACING = 1;
SkeletonBinary.PATH_MIX = 2;
SkeletonBinary.CURVE_LINEAR = 0;
SkeletonBinary.CURVE_STEPPED = 1;
SkeletonBinary.CURVE_BEZIER = 2;
class LinkedMesh {
  constructor(mesh, skin, slotIndex, parent, inheritDeform) {
    this.mesh = mesh;
    this.skin = skin;
    this.slotIndex = slotIndex;
    this.parent = parent;
    this.inheritDeform = inheritDeform;
  }
}
class Vertices {
  constructor(bones = null, vertices = null) {
    this.bones = bones;
    this.vertices = vertices;
  }
}

exports.SkeletonBinary = SkeletonBinary;
//# sourceMappingURL=SkeletonBinary.js.map
