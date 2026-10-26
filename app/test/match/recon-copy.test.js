// 预重构屏 ↔ 工坊包的「id 即接口」契约（`specs/pre-recon-polish` T8）。
//
// 六个选项 id 是**同一个命名空间**的三处拼写：屏上的 ASSIST_OPTS / LOAD_OPTS、`g.reconChoice` 交上去的值、
// `workshop/mode-recon` 里 meta / battle 按 id 生效的分支。任何一侧改名而另侧没跟上，就是一条静默失效
// （选择交上去了、机制不认识它）。这条测试只读源码文本，把六者钉在一起。
//
// 跑法：node --test test/match/recon-copy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('预重构屏的六个选项 id 都在包内 meta / battle 源码里（id 即接口）', () => {
  const screen = read('public/js/screens/preRecon.js');
  const ids = [...new Set([...screen.matchAll(/id: '(recon_(?:assist|load)_[a-z]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(ids, [
    'recon_assist_bond', 'recon_assist_data', 'recon_assist_equip',
    'recon_load_bond', 'recon_load_data', 'recon_load_equip',
  ], '屏上恰好六条（id 拼写就是协议与包共用的那一份）');

  const meta = read('workshop/mode-recon/meta/main.mjs');
  const battle = read('workshop/mode-recon/battle/main.mjs');
  for (const id of ids) {
    assert.ok(meta.includes(id) || battle.includes(id), `${id} 没有在包内出现（两侧改名就会漂移）`);
  }
});
