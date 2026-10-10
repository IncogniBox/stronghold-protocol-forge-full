function filterFromString(text) {
  switch (text.toLowerCase()) {
    case "nearest":
      return TextureFilter.Nearest;
    case "linear":
      return TextureFilter.Linear;
    case "mipmap":
      return TextureFilter.MipMap;
    case "mipmapnearestnearest":
      return TextureFilter.MipMapNearestNearest;
    case "mipmaplinearnearest":
      return TextureFilter.MipMapLinearNearest;
    case "mipmapnearestlinear":
      return TextureFilter.MipMapNearestLinear;
    case "mipmaplinearlinear":
      return TextureFilter.MipMapLinearLinear;
    default:
      throw new Error(`Unknown texture filter ${text}`);
  }
}
function wrapFromString(text) {
  switch (text.toLowerCase()) {
    case "mirroredtepeat":
      return TextureWrap.MirroredRepeat;
    case "clamptoedge":
      return TextureWrap.ClampToEdge;
    case "repeat":
      return TextureWrap.Repeat;
    default:
      throw new Error(`Unknown texture wrap ${text}`);
  }
}
var TextureFilter = /* @__PURE__ */ ((TextureFilter2) => {
  TextureFilter2[TextureFilter2["Nearest"] = 9728] = "Nearest";
  TextureFilter2[TextureFilter2["Linear"] = 9729] = "Linear";
  TextureFilter2[TextureFilter2["MipMap"] = 9987] = "MipMap";
  TextureFilter2[TextureFilter2["MipMapNearestNearest"] = 9984] = "MipMapNearestNearest";
  TextureFilter2[TextureFilter2["MipMapLinearNearest"] = 9985] = "MipMapLinearNearest";
  TextureFilter2[TextureFilter2["MipMapNearestLinear"] = 9986] = "MipMapNearestLinear";
  TextureFilter2[TextureFilter2["MipMapLinearLinear"] = 9987] = "MipMapLinearLinear";
  return TextureFilter2;
})(TextureFilter || {});
var TextureWrap = /* @__PURE__ */ ((TextureWrap2) => {
  TextureWrap2[TextureWrap2["MirroredRepeat"] = 33648] = "MirroredRepeat";
  TextureWrap2[TextureWrap2["ClampToEdge"] = 33071] = "ClampToEdge";
  TextureWrap2[TextureWrap2["Repeat"] = 10497] = "Repeat";
  return TextureWrap2;
})(TextureWrap || {});
class TextureRegion {
  constructor() {
    // thats for overrides
    this.size = null;
    this.names = null;
    this.values = null;
    this.renderObject = null;
  }
  get width() {
    const tex = this.texture;
    if (tex.trim) {
      return tex.trim.width;
    }
    return tex.orig.width;
  }
  get height() {
    const tex = this.texture;
    if (tex.trim) {
      return tex.trim.height;
    }
    return tex.orig.height;
  }
  get u() {
    return this.texture._uvs.x0;
  }
  get v() {
    return this.texture._uvs.y0;
  }
  get u2() {
    return this.texture._uvs.x2;
  }
  get v2() {
    return this.texture._uvs.y2;
  }
  get offsetX() {
    const tex = this.texture;
    return tex.trim ? tex.trim.x : 0;
  }
  get offsetY() {
    return this.spineOffsetY;
  }
  get pixiOffsetY() {
    const tex = this.texture;
    return tex.trim ? tex.trim.y : 0;
  }
  get spineOffsetY() {
    const tex = this.texture;
    return this.originalHeight - this.height - (tex.trim ? tex.trim.y : 0);
  }
  get originalWidth() {
    return this.texture.orig.width;
  }
  get originalHeight() {
    return this.texture.orig.height;
  }
  get x() {
    return this.texture.frame.x;
  }
  get y() {
    return this.texture.frame.y;
  }
  get rotate() {
    return this.texture.rotate !== 0;
  }
  get degrees() {
    return (360 - this.texture.rotate * 45) % 360;
  }
}

export { TextureFilter, TextureRegion, TextureWrap, filterFromString, wrapFromString };
//# sourceMappingURL=TextureRegion.mjs.map
