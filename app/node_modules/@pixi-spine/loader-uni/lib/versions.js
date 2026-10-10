'use strict';

var SPINE_VERSION = /* @__PURE__ */ ((SPINE_VERSION2) => {
  SPINE_VERSION2[SPINE_VERSION2["UNKNOWN"] = 0] = "UNKNOWN";
  SPINE_VERSION2[SPINE_VERSION2["VER37"] = 37] = "VER37";
  SPINE_VERSION2[SPINE_VERSION2["VER38"] = 38] = "VER38";
  SPINE_VERSION2[SPINE_VERSION2["VER40"] = 40] = "VER40";
  SPINE_VERSION2[SPINE_VERSION2["VER41"] = 41] = "VER41";
  return SPINE_VERSION2;
})(SPINE_VERSION || {});
function detectSpineVersion(version) {
  const ver3 = version.substr(0, 3);
  const verNum = Math.floor(Number(ver3) * 10 + 1e-3);
  if (ver3 === "3.7") {
    return 37 /* VER37 */;
  }
  if (ver3 === "3.8") {
    return 38 /* VER38 */;
  }
  if (ver3 === "4.0") {
    return 40 /* VER40 */;
  }
  if (ver3 === "4.1") {
    return 41 /* VER41 */;
  }
  if (verNum < 37 /* VER37 */) {
    return 37 /* VER37 */;
  }
  return 0 /* UNKNOWN */;
}

exports.SPINE_VERSION = SPINE_VERSION;
exports.detectSpineVersion = detectSpineVersion;
//# sourceMappingURL=versions.js.map
