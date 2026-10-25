// editor/ui/propThumb.js — 「官方摆件」的缩略图。
//
// 编辑器的摆件选择以前只有一个下拉框，写着「官方 4 / 官方 5 …」：作者看不出每个编号是桌子、灯笼还是一根杆子。
// 这里把主题素材包里的 OBJ 网格按一个固定的 3/4 视角做正交投影 + 平面着色，直接画进 56×56 的 2D canvas —
// 不依赖 WebGL（3D 预览不可用时也照样有图），也不生成 / 提交任何图片文件。
//
// `previewFaces` 是纯几何（可在 Node 里测）；`drawThumb` 只要求一个 2D context。

/** 固定视角：绕 Y 轴转（三分之四侧看），再绕 X 轴俯视一点。 */
const YAW = -0.6;
const PITCH = 0.45;
const LIGHT = (() => {
  const v = [-0.35, 0.75, 0.55];
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
})();

/**
 * 把 `parseObj` 的网格投到 `width × height` 的缩略图里：返回按深度排好序的三角形（远的先画）。
 * 每个面 `{ pts: [[x,y],[x,y],[x,y]], depth, shade (0.35…1), top }`。
 * @param {{position: Float32Array, index: Uint16Array|Uint32Array}|null} mesh
 * @param {number} width @param {number} height
 * @param {{margin?: number}} [opts]
 */
export function previewFaces(mesh, width, height, opts = {}) {
  if (!mesh || !mesh.position || !mesh.index || !(width > 0) || !(height > 0)) return [];
  const margin = Number.isFinite(opts.margin) ? opts.margin : 3;
  const P = mesh.position;
  const n = Math.floor(P.length / 3);
  if (!n) return [];
  const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const rx = new Float64Array(n), ry = new Float64Array(n), rz = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    rx[i] = x1; ry[i] = y2; rz[i] = z2;
    if (x1 < minX) minX = x1;
    if (x1 > maxX) maxX = x1;
    if (y2 < minY) minY = y2;
    if (y2 > maxY) maxY = y2;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const s = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY);
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const toX = (x) => width / 2 + (x - midX) * s;
  const toY = (y) => height / 2 - (y - midY) * s;
  const out = [];
  const I = mesh.index;
  for (let i = 0; i + 2 < I.length; i += 3) {
    const a = I[i], b = I[i + 1], c = I[i + 2];
    if (!(a < n && b < n && c < n)) continue;
    const ax = rx[a], ay = ry[a], az = rz[a];
    const bx = rx[b], by = ry[b], bz = rz[b];
    const cx = rx[c], cyy = ry[c], cz = rz[c];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cyy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-9)) continue;
    nx /= len; ny /= len; nz /= len;
    // 双面受光：摆件是薄片也能看清
    const lit = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    out.push({
      pts: [[toX(ax), toY(ay)], [toX(bx), toY(by)], [toX(cx), toY(cyy)]],
      depth: (az + bz + cz) / 3,
      shade: 0.35 + 0.65 * lit,
      top: ny > 0.55,
    });
  }
  // 远的先画（depth 越小越远）
  out.sort((p, q) => p.depth - q.depth);
  return out;
}

/** 缩略图的底色：top 面偏暖、侧面偏冷，和 天镜阁 的石木摆件协调。 */
const TOP_RGB = [208, 190, 156];
const SIDE_RGB = [150, 134, 110];

/**
 * 把网格画进一个 2D canvas（建议 56×56）。返回是否真的画出了面。
 * @param {HTMLCanvasElement} canvas
 * @param {object|null} mesh `parseObj` 的返回值
 */
export function drawThumb(canvas, mesh) {
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return false;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const faces = previewFaces(mesh, w, h);
  if (!faces.length) return false;
  ctx.lineJoin = 'round';
  for (const f of faces) {
    const base = f.top ? TOP_RGB : SIDE_RGB;
    const r = Math.round(base[0] * f.shade);
    const g = Math.round(base[1] * f.shade);
    const b = Math.round(base[2] * f.shade);
    ctx.beginPath();
    ctx.moveTo(f.pts[0][0], f.pts[0][1]);
    ctx.lineTo(f.pts[1][0], f.pts[1][1]);
    ctx.lineTo(f.pts[2][0], f.pts[2][1]);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(24,28,32,0.45)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  return true;
}
