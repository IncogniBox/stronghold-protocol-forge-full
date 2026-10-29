// test/match/recon-music.test.js — 重构模拟的首领战斗音乐（业主 2026-10-28：把对应·重构boss的战斗音乐换成
// `D:\Ark\音频\boss音频` 里的曲子；杰斯顿两首随机一首；“终始”与 AMa-10 分开）。
//
// 这条只钉「数据面」：包声明了面板、曲目文件都在、首领 key 都能在 enemies.json 里解析到、战斗模块与面板两份名单一致、
// AMa / 异构体与“终始”不是同一首、杰斯顿两首不同。播放本身（<audio> / 相位 / 音量）走浏览器，Node 里不跑。
//
// 跑法：node --test test/match/recon-music.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PACK = new URL('../../workshop/mode-recon/', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, PACK), 'utf8');

const pack = JSON.parse(read('pack.json'));
const enemies = JSON.parse(read('enemies.json'));
const panelSrc = read('ui/music.js');
const battleSrc = read('battle/main.mjs');

const blockOf = (src, start, end) => {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `找不到 ${start} … ${end}`);
  return src.slice(i, j);
};
const keysIn = (text) => [...text.matchAll(/'(enemy_ws_recon_[a-z0-9_]+)'/g)].map((m) => m[1]);

/** 面板 TRACKS 的 key → 文件。 */
const tracks = Object.fromEntries([...blockOf(panelSrc, 'const TRACKS = {', 'const ALTERNATIVES').matchAll(/(enemy_ws_recon_[a-z0-9_]+)'?\s*:\s*'([^']+\.mp3)'/g)].map((m) => [m[1], m[2]]));
/** 面板 ALTERNATIVES（两首随机的首领）。 */
const alts = Object.fromEntries([...blockOf(panelSrc, 'const ALTERNATIVES = {', '};').matchAll(/(enemy_ws_recon_[a-z0-9_]+)'?\s*:\s*\[([^\]]+)\]/g)].map((m) => [m[1], [...m[2].matchAll(/'([^']+\.mp3)'/g)].map((x) => x[1])]));
/** 战斗模块 MUSIC_BOSSES 的名单。 */
const battleKeys = keysIn(blockOf(battleSrc, 'MUSIC_BOSSES = new Set([', ']);'));

test('包声明了首领音乐面板（screen.game.overlay）', () => {
  const panels = pack.client && Array.isArray(pack.client.panels) ? pack.client.panels : [];
  const p = panels.find((x) => x && x.id === 'reconMusic');
  assert.ok(p, 'reconMusic 面板');
  assert.equal(p.slot, 'screen.game.overlay');
  assert.equal(p.module, 'ui/music.js');
  assert.ok(fs.existsSync(new URL('ui/music.js', PACK)), '面板模块在包里');
});

test('两份名单一致：面板 TRACKS + 随机曲 = 战斗模块 MUSIC_BOSSES；每个 key 都是包里的·重构首领', () => {
  const panelKeys = [...Object.keys(tracks), ...Object.keys(alts)].sort();
  assert.deepEqual([...battleKeys].sort(), panelKeys, '面板与战斗模块的首领名单逐条相同');
  for (const k of panelKeys) assert.ok(enemies[k], `${k} 在 enemies.json 里`);
});

test('曲目文件都在 assets/bgm 里：每个被引用的文件存在且非空', () => {
  const files = [...Object.values(tracks), ...Object.values(alts).flat()];
  assert.ok(files.length >= 28, `曲目数量（${files.length}）`);
  for (const f of new Set(files)) {
    const p = new URL(`assets/bgm/${f}`, PACK);
    assert.ok(fs.existsSync(p), `assets/bgm/${f}`);
    assert.ok(fs.statSync(p).size > 0, `assets/bgm/${f} 非空`);
  }
});

test('“终始”与 AMa-10 / 异构体分开：终始有自己的曲子，AMa 与异构体共用另一首', () => {
  assert.ok(tracks.enemy_ws_recon_musnake, '终始有曲子');
  assert.ok(tracks.enemy_ws_recon_muama && tracks.enemy_ws_recon_mutwin, 'AMa-10 / 异构体有曲子');
  assert.notEqual(tracks.enemy_ws_recon_musnake, tracks.enemy_ws_recon_muama, '终始 ≠ AMa-10');
  assert.equal(tracks.enemy_ws_recon_mutwin, tracks.enemy_ws_recon_muama, 'AMa-10 与异构体同一首');
});

test('杰斯顿：两首不同的曲子，每局随机一首', () => {
  const list = alts.enemy_ws_recon_jakill;
  assert.ok(Array.isArray(list) && list.length === 2, '两首');
  assert.notEqual(list[0], list[1], '不是同一首');
  for (const f of list) assert.ok(fs.existsSync(new URL(`assets/bgm/${f}`, PACK)), `assets/bgm/${f}`);
});

test('成对 / 成组的首领共用一首（霜星按首领认，源目录 12 里的那首归 R8 那一格）', () => {
  assert.equal(tracks.enemy_ws_recon_dekght, tracks.enemy_ws_recon_dekght_2, '腐败 + 凋零');
  assert.equal(tracks.enemy_ws_recon_mephi, tracks.enemy_ws_recon_faust, '梅菲斯特 + 浮士德');
  assert.equal(tracks.enemy_ws_recon_suizzh, tracks.enemy_ws_recon_suisho, '岁四部位');
  assert.equal(tracks.enemy_ws_recon_shorbb, tracks.enemy_ws_recon_shophm, '洛伦茨 + 源阶方');
  assert.equal(tracks.enemy_ws_recon_frstar2, 'r12_frstar2.mp3', '霜星“冬痕”');
});

// 业主 2026-10-29：首领自带的音乐要**覆盖**其他音乐（包括战斗里玩家自己替换的曲目）；
// 多索雷斯盟约 / 颂乐人偶 Fever 两条例外不被覆盖，但音量降到 50%。
const AUDIO = fs.readFileSync(new URL('../../public/js/audio.js', import.meta.url), 'utf8');
const BATTLE_MUSIC = fs.readFileSync(new URL('../../public/js/ui/battleMusic.js', import.meta.url), 'utf8');
const DOS_MUSIC = fs.readFileSync(new URL('../../workshop/dossoles/ui/music.js', import.meta.url), 'utf8');
const FEVER = fs.readFileSync(new URL('../../workshop/ave-mujica/ui/fever.js', import.meta.url), 'utf8');

test('首领曲通过 audio.setBossMusic 广播接管状态', () => {
  assert.match(AUDIO, /this\.bossMusicOn = false/);
  assert.match(AUDIO, /setBossMusic\(on\) \{/);
  assert.match(AUDIO, /subscribeBossMusic\(fn\) \{/);
  assert.match(panelSrc, /audio\.setBossMusic\(true\)/, '接管时置位');
  assert.match(panelSrc, /audio\.setBossMusic\(false\)/, '首领离开 / 战斗结束时交还');
});

test('战斗自定曲（ui/battleMusic.js）在首领曲接管时暂停，结束后回来', () => {
  assert.match(BATTLE_MUSIC, /!audio\.bossMusicOn/, 'sync 的目标条件带上首领曲');
  assert.match(BATTLE_MUSIC, /audio\.subscribeBossMusic/, '订阅接管状态变化');
});

test('多索雷斯 / 颂乐人偶 Fever：不被覆盖，只压到 50%', () => {
  assert.match(DOS_MUSIC, /VOLUME \* \(audio\.bossMusicOn \? 0\.5 : 1\)/, '多索雷斯假日 → 50%');
  assert.match(FEVER, /audio\.bossMusicOn \? 0\.5 : 1/, 'Fever → 50%');
  assert.match(FEVER, /Math\.min\(fadeIn, fadeOut\) \* vol \* duck/, 'Fever 音量乘上 duck');
});
