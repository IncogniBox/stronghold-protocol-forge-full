import { SCALE_MODES, MIPMAP_MODES, ALPHA_MODES, Rectangle, Texture } from '@pixi/core';
import { TextureFilter, TextureWrap, TextureRegion, filterFromString } from './TextureRegion.mjs';

class RegionFields {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.originalWidth = 0;
    this.originalHeight = 0;
    this.rotate = 0;
    this.index = 0;
  }
}
class TextureAtlas {
  constructor(atlasText, textureLoader, callback) {
    this.pages = new Array();
    this.regions = new Array();
    if (atlasText) {
      this.addSpineAtlas(atlasText, textureLoader, callback);
    }
  }
  addTexture(name, texture) {
    const pages = this.pages;
    let page = null;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].baseTexture === texture.baseTexture) {
        page = pages[i];
        break;
      }
    }
    if (page === null) {
      page = new TextureAtlasPage();
      page.name = "texturePage";
      const baseTexture = texture.baseTexture;
      page.width = baseTexture.realWidth;
      page.height = baseTexture.realHeight;
      page.baseTexture = baseTexture;
      page.minFilter = page.magFilter = TextureFilter.Nearest;
      page.uWrap = TextureWrap.ClampToEdge;
      page.vWrap = TextureWrap.ClampToEdge;
      pages.push(page);
    }
    const region = new TextureAtlasRegion();
    region.name = name;
    region.page = page;
    region.texture = texture;
    region.index = -1;
    this.regions.push(region);
    return region;
  }
  addTextureHash(textures, stripExtension) {
    for (const key in textures) {
      if (textures.hasOwnProperty(key)) {
        this.addTexture(stripExtension && key.indexOf(".") !== -1 ? key.substr(0, key.lastIndexOf(".")) : key, textures[key]);
      }
    }
  }
  addSpineAtlas(atlasText, textureLoader, callback) {
    return this.load(atlasText, textureLoader, callback);
  }
  load(atlasText, textureLoader, callback) {
    if (textureLoader == null) {
      throw new Error("textureLoader cannot be null.");
    }
    const reader = new TextureAtlasReader(atlasText);
    const entry = new Array(4);
    let page = null;
    const pageFields = {};
    let region = null;
    pageFields.size = () => {
      page.width = parseInt(entry[1]);
      page.height = parseInt(entry[2]);
    };
    pageFields.format = () => {
    };
    pageFields.filter = () => {
      page.minFilter = filterFromString(entry[1]);
      page.magFilter = filterFromString(entry[2]);
    };
    pageFields.repeat = () => {
      if (entry[1].indexOf("x") != -1)
        page.uWrap = TextureWrap.Repeat;
      if (entry[1].indexOf("y") != -1)
        page.vWrap = TextureWrap.Repeat;
    };
    pageFields.pma = () => {
      page.pma = entry[1] == "true";
    };
    const regionFields = {};
    regionFields.xy = () => {
      region.x = parseInt(entry[1]);
      region.y = parseInt(entry[2]);
    };
    regionFields.size = () => {
      region.width = parseInt(entry[1]);
      region.height = parseInt(entry[2]);
    };
    regionFields.bounds = () => {
      region.x = parseInt(entry[1]);
      region.y = parseInt(entry[2]);
      region.width = parseInt(entry[3]);
      region.height = parseInt(entry[4]);
    };
    regionFields.offset = () => {
      region.offsetX = parseInt(entry[1]);
      region.offsetY = parseInt(entry[2]);
    };
    regionFields.orig = () => {
      region.originalWidth = parseInt(entry[1]);
      region.originalHeight = parseInt(entry[2]);
    };
    regionFields.offsets = () => {
      region.offsetX = parseInt(entry[1]);
      region.offsetY = parseInt(entry[2]);
      region.originalWidth = parseInt(entry[3]);
      region.originalHeight = parseInt(entry[4]);
    };
    regionFields.rotate = () => {
      const rotateValue = entry[1];
      let rotate = 0;
      if (rotateValue.toLocaleLowerCase() == "true") {
        rotate = 6;
      } else if (rotateValue.toLocaleLowerCase() == "false") {
        rotate = 0;
      } else {
        rotate = (720 - parseFloat(rotateValue)) % 360 / 45;
      }
      region.rotate = rotate;
    };
    regionFields.index = () => {
      region.index = parseInt(entry[1]);
    };
    let line = reader.readLine();
    while (line != null && line.trim().length == 0) {
      line = reader.readLine();
    }
    while (true) {
      if (line == null || line.trim().length == 0)
        break;
      if (reader.readEntry(entry, line) == 0)
        break;
      line = reader.readLine();
    }
    const iterateParser = () => {
      while (true) {
        if (line == null) {
          return callback && callback(this);
        }
        if (line.trim().length == 0) {
          page = null;
          line = reader.readLine();
        } else if (page === null) {
          page = new TextureAtlasPage();
          page.name = line.trim();
          while (true) {
            if (reader.readEntry(entry, line = reader.readLine()) == 0)
              break;
            const field = pageFields[entry[0]];
            if (field)
              field();
          }
          this.pages.push(page);
          textureLoader(page.name, (texture) => {
            if (texture === null) {
              this.pages.splice(this.pages.indexOf(page), 1);
              return callback && callback(null);
            }
            page.baseTexture = texture;
            if (page.pma) {
              texture.alphaMode = ALPHA_MODES.PMA;
            }
            if (!texture.valid) {
              texture.setSize(page.width, page.height);
            }
            page.setFilters();
            if (!page.width || !page.height) {
              page.width = texture.realWidth;
              page.height = texture.realHeight;
              if (!page.width || !page.height) {
                console.log(
                  `ERROR spine atlas page ${page.name}: meshes wont work if you dont specify size in atlas (http://www.html5gamedevs.com/topic/18888-pixi-spines-and-meshes/?p=107121)`
                );
              }
            }
            iterateParser();
          });
          break;
        } else {
          region = new RegionFields();
          const atlasRegion = new TextureAtlasRegion();
          atlasRegion.name = line;
          atlasRegion.page = page;
          let names = null;
          let values = null;
          while (true) {
            const count = reader.readEntry(entry, line = reader.readLine());
            if (count == 0)
              break;
            const field = regionFields[entry[0]];
            if (field) {
              field();
            } else {
              if (names == null) {
                names = [];
                values = [];
              }
              names.push(entry[0]);
              const entryValues = [];
              for (let i = 0; i < count; i++) {
                entryValues.push(parseInt(entry[i + 1]));
              }
              values.push(entryValues);
            }
          }
          if (region.originalWidth == 0 && region.originalHeight == 0) {
            region.originalWidth = region.width;
            region.originalHeight = region.height;
          }
          const resolution = page.baseTexture.resolution;
          region.x /= resolution;
          region.y /= resolution;
          region.width /= resolution;
          region.height /= resolution;
          region.originalWidth /= resolution;
          region.originalHeight /= resolution;
          region.offsetX /= resolution;
          region.offsetY /= resolution;
          const swapWH = region.rotate % 4 !== 0;
          const frame = new Rectangle(region.x, region.y, swapWH ? region.height : region.width, swapWH ? region.width : region.height);
          const orig = new Rectangle(0, 0, region.originalWidth, region.originalHeight);
          const trim = new Rectangle(region.offsetX, region.originalHeight - region.height - region.offsetY, region.width, region.height);
          atlasRegion.texture = new Texture(atlasRegion.page.baseTexture, frame, orig, trim, region.rotate);
          atlasRegion.index = region.index;
          atlasRegion.texture.updateUvs();
          this.regions.push(atlasRegion);
        }
      }
    };
    iterateParser();
  }
  findRegion(name) {
    for (let i = 0; i < this.regions.length; i++) {
      if (this.regions[i].name == name) {
        return this.regions[i];
      }
    }
    return null;
  }
  dispose() {
    for (let i = 0; i < this.pages.length; i++) {
      this.pages[i].baseTexture.dispose();
    }
  }
}
class TextureAtlasReader {
  constructor(text) {
    this.index = 0;
    this.lines = text.split(/\r\n|\r|\n/);
  }
  readLine() {
    if (this.index >= this.lines.length) {
      return null;
    }
    return this.lines[this.index++];
  }
  readEntry(entry, line) {
    if (line == null)
      return 0;
    line = line.trim();
    if (line.length == 0)
      return 0;
    const colon = line.indexOf(":");
    if (colon == -1)
      return 0;
    entry[0] = line.substr(0, colon).trim();
    for (let i = 1, lastMatch = colon + 1; ; i++) {
      const comma = line.indexOf(",", lastMatch);
      if (comma == -1) {
        entry[i] = line.substr(lastMatch).trim();
        return i;
      }
      entry[i] = line.substr(lastMatch, comma - lastMatch).trim();
      lastMatch = comma + 1;
      if (i == 4)
        return 4;
    }
  }
}
class TextureAtlasPage {
  constructor() {
    this.minFilter = TextureFilter.Nearest;
    this.magFilter = TextureFilter.Nearest;
    this.uWrap = TextureWrap.ClampToEdge;
    this.vWrap = TextureWrap.ClampToEdge;
  }
  setFilters() {
    const tex = this.baseTexture;
    const filter = this.minFilter;
    if (filter == TextureFilter.Linear) {
      tex.scaleMode = SCALE_MODES.LINEAR;
    } else if (this.minFilter == TextureFilter.Nearest) {
      tex.scaleMode = SCALE_MODES.NEAREST;
    } else {
      tex.mipmap = MIPMAP_MODES.POW2;
      if (filter == TextureFilter.MipMapNearestNearest) {
        tex.scaleMode = SCALE_MODES.NEAREST;
      } else {
        tex.scaleMode = SCALE_MODES.LINEAR;
      }
    }
  }
}
class TextureAtlasRegion extends TextureRegion {
}

export { TextureAtlas, TextureAtlasPage, TextureAtlasRegion };
//# sourceMappingURL=TextureAtlas.mjs.map
