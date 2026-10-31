// 「协议已失效」 (ui/downedPlate.js, css/screens/official-pages.css §33): when it is due, the official panel's layers,
// the project's Modal, the wiring in screens/game.js and the stylesheet's rules. In a browser: downed-plate.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const D = await import('../../public/js/ui/downedPlate.js');

const pub = (others) => ({ players: [{ playerId: 'me', alive: false }, ...others] });

test('downedDue: the own alive turning false with a teammate still in; not a reload, a spectator seat or the team\'s end', () => {
  const mate = [{ playerId: 'b', alive: true }];
  assert.equal(D.downedDue({ was: true, alive: false, spectator: false, pub: pub(mate), myId: 'me' }), true);
  assert.equal(D.downedDue({ was: undefined, alive: false, spectator: false, pub: pub(mate), myId: 'me' }), false, 'a reload that finds me out');
  assert.equal(D.downedDue({ was: false, alive: false, spectator: false, pub: pub(mate), myId: 'me' }), false, 'already out');
  assert.equal(D.downedDue({ was: true, alive: true, spectator: false, pub: pub(mate), myId: 'me' }), false);
  assert.equal(D.downedDue({ was: true, alive: false, spectator: true, pub: pub(mate), myId: 'me' }), false, 'a spectator seat');
  assert.equal(D.downedDue({ was: true, alive: false, spectator: false, pub: pub([{ playerId: 'b', alive: false }]), myId: 'me' }), false, 'nobody left: the match ends');
});

test('the event\'s own sprites are in the official mirror', () => {
  const base = 'public/assets/official/hub/ac/';
  for (const n of ['battle/icon_dead.png', 'battle/icon_text.png', 'battle/face_lower_dec.png', 'battle/dec_stronghold_protocol.png',
    'battle/btn_continue.png', 'battle/btn_end.png', 'battle/dec_text_upper_left_01.png', 'battle/dec_text_upper_left_02.png',
    'battle/dec_text_side_num.png', 'battle/dec_text_lower_corner.png', 'battle/dec_line_side.png', 'battle/dec_tiny_text_01.png',
    'battle/img_dec_cross.png', 'battle/left_frame.png', 'outer/robo_head.png']) {
    assert.ok(existsSync(path.join(ROOT, base + n)), n);
  }
});

test('the official map, the project\'s Modal, the tone filter; not ready without the art', () => {
  const js = read('public/js/ui/downedPlate.js');
  assert.ok('settle/settlemen_personal_fail' in JSON.parse(read('data/assets.json')).ui);
  assert.match(js, /<\$\{Modal\} open=\$\{open\} onClose=\$\{watch\}/, 'focus trap and Esc');
  assert.match(js, /downm-tone/, 'the map\'s colour matrix');
  assert.match(js, /data-autofocus=\$\{true\} onClick=\$\{watch\}/, '继续观战 has the focus');
  assert.equal(D.downedArtReady(), false, 'in Node (no Image) it never turns ready');
});

test('screens/game.js: the dialog once the own alive turns false from real data; 离开模拟 opens the exit dialog', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /if \(!spectator && !priv && !meP\) return;/);
  assert.match(g, /if \(downedArtReady\(\) && downedDue\(\{ was, alive, spectator, pub, myId \}\)\) setDowned\(true\);/);
  assert.match(g, /<\$\{DownedPlate\} open=\$\{downed\} onWatch=\$\{\(\) => setDowned\(false\)\} onLeave=\$\{\(\) => \{ setDowned\(false\); setExitOpen\(true\); \}\} \/>/);
});

test('the stylesheet: the official section 33 layers and keyframes, reduced motion stops it', () => {
  const css = read('public/css/screens/official-pages.css');
  const block = css.slice(css.indexOf('/* ---- 33.'), css.indexOf('/* ---- 34.'));
  for (const n of ['downm-band', 'downm-lead', 'downm-calm', 'downm-dead', 'downm-red', 'downm-title', 'downm-btns']) {
    assert.match(block, new RegExp(`@keyframes ${n} \\{`), n);
  }
  for (const c of ['downm__panel', 'downm__map', 'downm__grid', 'downm__tint', 'downm__face', 'downm__dead', 'downm__title',
    'downm__sub', 'downm__btns', 'downm__btn']) assert.match(block, new RegExp(`\\.${c}[ ,{]`), c);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{/);
});
