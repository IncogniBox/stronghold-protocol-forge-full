// test/official-data.mjs — the test suite's data baseline (policy of 2026-10-11).
//
// This repository ships **ready-to-run** workshop packs under `workshop/` (ave-mujica / rimbilliton / skin-picker) so a
// fresh clone (and the release bundle) has them. Almost every unit test here, however, validates the **official**
// content — and some assert exactly that (`test/workshop.test.js`: the process singleton must not see workshop content,
// 266 chess; `test/workshop.test.js` also asserts the bundled packs DO live under `workshop/`). `getData()` is a
// **process singleton whose first call wins**, so if a test file's first caller used the default workshop dir, pack
// content would leak into every later assertion of that file (42 bands instead of 40, extra chess in the tier/kit
// coverage sweeps, …).
//
// `node --test --import ./test/official-data.mjs …` (package.json `test`, `.github/workflows/ci.yml`, `tools/ci.mjs`)
// loads this module **before any test file** (the flag is inherited by the test child processes), pinning the singleton
// to the official data with the overlay off. Pack behaviour is still covered: those suites pass an explicit
// `workshopDir` to `loadData()` (`test/workshop*.test.js`, `test/packManager.test.js`, …), which never touches the
// singleton. `tools/golden.mjs` pins the same baseline for the golden corpus.
//
// The **server** path is the other reader of `workshop/`: `startServer()` (server/index.js) honours the documented
// `SP_WORKSHOP` env seam (editor/playtest.mjs uses it) and otherwise defaults to the repo's own `workshop/`. A test
// process that starts a real server (the lobby / realtime / ws suites) would therefore run the bundled packs and gate
// every `room.create` behind the mod-set handshake ("this server runs 3 workshop pack(s) … a client must confirm the
// mod set to enter"). Point `SP_WORKSHOP` at an **empty** directory here, so those servers run the official baseline
// too; the suites that DO exercise packs pass `workshopDir` explicitly to `startServer()` and are unaffected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetData, getData } from '../server/data.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

// A stable, empty workshop root for the whole test run (a missing dir is the loader's "no packs" normal case, but an
// explicit empty dir keeps the intent unambiguous). Not cleaned up: it is one empty directory under the OS temp dir.
const EMPTY_WORKSHOP = path.join(os.tmpdir(), 'sp-official-data-empty-workshop');
fs.mkdirSync(EMPTY_WORKSHOP, { recursive: true });
process.env.SP_WORKSHOP = EMPTY_WORKSHOP;

resetData();
getData({ log: quiet, workshopDir: null });
