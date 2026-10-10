import { Utils } from '@pixi-spine/base';

const _Sequence = class {
  constructor(count) {
    this.id = _Sequence.nextID();
    this.start = 0;
    this.digits = 0;
    /** The index of the region to show for the setup pose. */
    this.setupIndex = 0;
    this.regions = new Array(count);
  }
  copy() {
    const copy = new _Sequence(this.regions.length);
    Utils.arrayCopy(this.regions, 0, copy.regions, 0, this.regions.length);
    copy.start = this.start;
    copy.digits = this.digits;
    copy.setupIndex = this.setupIndex;
    return copy;
  }
  apply(slot, attachment) {
    let index = slot.sequenceIndex;
    if (index == -1)
      index = this.setupIndex;
    if (index >= this.regions.length)
      index = this.regions.length - 1;
    const region = this.regions[index];
    if (attachment.region != region) {
      attachment.region = region;
    }
  }
  getPath(basePath, index) {
    let result = basePath;
    const frame = (this.start + index).toString();
    for (let i = this.digits - frame.length; i > 0; i--)
      result += "0";
    result += frame;
    return result;
  }
  static nextID() {
    return _Sequence._nextID++;
  }
};
let Sequence = _Sequence;
Sequence._nextID = 0;
var SequenceMode = /* @__PURE__ */ ((SequenceMode2) => {
  SequenceMode2[SequenceMode2["hold"] = 0] = "hold";
  SequenceMode2[SequenceMode2["once"] = 1] = "once";
  SequenceMode2[SequenceMode2["loop"] = 2] = "loop";
  SequenceMode2[SequenceMode2["pingpong"] = 3] = "pingpong";
  SequenceMode2[SequenceMode2["onceReverse"] = 4] = "onceReverse";
  SequenceMode2[SequenceMode2["loopReverse"] = 5] = "loopReverse";
  SequenceMode2[SequenceMode2["pingpongReverse"] = 6] = "pingpongReverse";
  return SequenceMode2;
})(SequenceMode || {});
const SequenceModeValues = [
  0 /* hold */,
  1 /* once */,
  2 /* loop */,
  3 /* pingpong */,
  4 /* onceReverse */,
  5 /* loopReverse */,
  6 /* pingpongReverse */
];

export { Sequence, SequenceMode, SequenceModeValues };
//# sourceMappingURL=Sequence.mjs.map
