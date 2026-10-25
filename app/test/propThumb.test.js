// 官方摆件缩略图（editor/ui/propThumb.js）：把 OBJ 网格正交投影成 2D 面，供编辑器的摆件选择器画图。
// 这里只测纯几何（不碰 canvas）：真实素材包里的每个模型都要有面、且全部落在缩略图内。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseObj } from '../public/js/render/board3d/obj.js';
import { previewFaces } from '../editor/ui/propThumb.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public/assets/local/props/skymirror');

const CUBE = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

test('previewFaces: a cube projects into the thumbnail, sorted far → near', () => {
  const faces = previewFaces(parseObj(CUBE), 56, 56);
  assert.equal(faces.length, 12, 'six quads fanned into 12 triangles');
  for (const f of faces) {
    for (const [x, y] of f.pts) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x >= 0 && x <= 56 && y >= 0 && y <= 56, `point ${x},${y} inside the canvas`);
    }
    assert.ok(f.shade >= 0.35 && f.shade <= 1);
  }
  for (let i = 1; i < faces.length; i++) assert.ok(faces[i - 1].depth <= faces[i].depth, 'painter order');
});

test('every official prop of the skymirror pack yields a non-empty thumbnail', () => {
  const props = JSON.parse(readFileSync(join(DIR, 'props.json'), 'utf8')).props;
  assert.ok(props.length > 0);
  for (const p of props) {
    const mesh = parseObj(readFileSync(join(DIR, p.file), 'utf8'));
    const faces = previewFaces(mesh, 56, 56);
    assert.ok(faces.length > 0, `${p.id} has faces`);
    for (const f of faces) {
      for (const [x, y] of f.pts) assert.ok(x >= 0 && x <= 56 && y >= 0 && y <= 56, `${p.id} point inside`);
    }
  }
});
