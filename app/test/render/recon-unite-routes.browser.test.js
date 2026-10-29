// test/render/recon-unite-routes.browser.test.js — 重构战场 45×60 的联防二段路线在真浏览器里跑一遍
// （业主 2026-10-27「先走右半边承接者上方的一条地面路线，进入右半保护目标的敌人保留当前状态再从下方的敌方入口出现
// 走一遍左半边下方的地面路线，进入左半边保护目标时再扣除对应生命值」）。
//
// 场上的 spec 是**真对局过线的那一份**（recon 房 + my_map + 2 名承接者走到 PHASE.UNITE，客户端跑模式下
// `m.fields[0].spec` 就是 b.start 带出去的 spec），页面里跑的是 /sim/ 的同一套模块（客户端 runner 走的就是
// createBattleFromSpec），帧照样推进真实的渲染 demo。断言：先到右门 → 从左下入口重新出现（HP 保留）→ 只在左门漏一次。
//
// Opt-in（starts Chrome）：RENDER_E2E=1 node --test test/render/recon-unite-routes.browser.test.js
// Chrome path: $CHROME_PATH。截图 → test/e2e/out/recon-unite-*.png。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, give, chessOfTier, legalTileFor } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';
const STAGE = JSON.parse(readFileSync(path.join(ROOT, 'workshop/mode-recon/stages.json'), 'utf8')).my_map;
const MID = STAGE.layout.mirrorCol / 2;

/** 真对局：recon + my_map + 3 人（p_0 漏怪，p_1 / p_2 满血 ⇒ 两位承接者），取过线的联防 spec。 */
function uniteSpec() {
  const prev = process.env.SP_STAGE;
  process.env.SP_STAGE = 'my_map';
  let m;
  try {
    const h = makeMatch({
      mode: 'recon', modeId: 'mode_recon_abyss', difficulty: 'ABYSS', humans: 3, bots: 0, seed: 1, fake: true, clientCombat: true,
      script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 2 } } : {}),
    }).start();
    m = h.m;
    h.toPrep(1);
    const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
    for (let i = 1; i < 3; i++) give(m, h.ps(`p_${i}`), ranged[i], 'board', legalTileFor(m, h.ps(`p_${i}`), ranged[i]));
    h.drive(() => m.phase === PHASE.UNITE);
    assert.equal(m.phase, PHASE.UNITE);
    assert.equal(m.unitePlan.helpers.length, 2);
    const spec = m.fields[0].spec;   // what the client receives (b.start.spec)
    assert.equal(spec.stageId, 'my_map');
    assert.ok(spec.spawns.every((s) => s.route && Array.isArray(s.route.steps)), '每条漏怪都带二段路线');
    return spec;
  } finally {
    if (prev === undefined) delete process.env.SP_STAGE; else process.env.SP_STAGE = prev;
    m?.dispose?.();
  }
}

const SPEC = uniteSpec();

/** Page side: the real sim in the browser (+ the workshop map), fed into the demo view. */
async function installSim({ spec, stage }) {
  const [S, simdata] = await Promise.all([import('/sim/spec.js'), import('/sim/simdata.js')]);
  const names = ['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects'];
  const raw = {};
  for (const n of names) raw[n] = await fetch(`/data/${n}.json`).then((r) => r.json());
  raw.stages[stage.id] = stage;   // 工作坊地图不在 /data/ 里：按记录原样补进去（与 makeBattle({ stage }) 同一份数据）
  simdata.setSimData(raw);
  const battle = S.createBattleFromSpec(spec, new simdata.DataSource(raw, null));
  const v = window.__demo.view;
  v.enterBattle({ ...battle.fieldMeta(), fieldId: 'u', kind: 'unite', rect: spec.rect, stageId: spec.stageId });
  v.setCamera('unite', { rect: spec.rect, side: 'R', instant: true });
  v.setLocalFeed({ on: true, speed: 2 });
  const frame = () => {
    const ev = battle.drainEvents();
    const gt = battle.time;
    if (ev.length) v.pushEvents({ t: 'b.ev', fieldId: 'u', gt, ev });
    const { t, ...rest } = battle.snapshot();
    v.pushSnapshot({ ...rest, t: 'b.snap', fieldId: 'u', gt: t });
  };
  frame();
  const leaks = [];
  battle.on('enemyLeak', (ctx) => leaks.push([Math.round(ctx.enemy.y), Math.round(ctx.enemy.x)]), { priority: 1000 });
  const enemyOf = () => battle.enemies.find((e) => e.alive) || null;
  const track = { rightSeen: false, backSeen: false, hpAtDisappear: null, hpAtRight: null, hpAfterAppear: null, id: null, maxHp: null };
  window.__sim = {
    battle,
    leaks,
    track,
    advance(n) {
      for (let i = 0; i < n && !battle.finished; i++) {
        battle.step();
        const enemy = enemyOf();
        if (!enemy) continue;
        track.id = enemy.id;
        track.maxHp = enemy.maxHp;
        if (enemy.hidden) {
          // 右门之后的消失（若这一步里还没出现下一个位置）：记下离开时的状态
          if (track.rightSeen && track.hpAtDisappear == null) track.hpAtDisappear = enemy.hp;
          continue;
        }
        if (!track.rightSeen && enemy.x >= spec.rect.c1 - 0.6) {
          track.rightSeen = true;
          track.hpAtRight = enemy.hp;
        }
        if (track.rightSeen && !track.backSeen && enemy.x <= 30.6) {
          track.backSeen = true;
          track.hpAfterAppear = enemy.hp;
        }
      }
      frame();
      return { ...track, t: battle.time, leaks: leaks.slice() };
    },
    result() { return battle.result(); },
  };
}

describe('重构战场联防: 右上 → 右门 → 左下入口 → 左门漏一次（headless Chrome, real sim）', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('先到右门、保留状态从 [35,30] 再入场、只在 [36,20] 漏一次', async () => {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=normal-m01&paused=1&panel=0`);
      await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
      await page.evaluate(installSim, { spec: SPEC, stage: STAGE });
      // the first leg: to the right gate
      const first = await page.evaluate(() => window.__sim.advance(1800));
      await page.screenshot({ path: path.join(OUT, 'recon-unite-right.png') });
      const second = await page.evaluate(() => window.__sim.advance(6000));
      await page.screenshot({ path: path.join(OUT, 'recon-unite-left.png') });
      const res = await page.evaluate(() => window.__sim.result());
      assert.equal(first.rightSeen, true, '敌人到过右门');
      assert.equal(second.backSeen, true, '右门之后从左下入口重新出现');
      assert.ok(first.hpAtDisappear != null || first.hpAtRight != null, '记到了右门时的状态');
      const hpBefore = first.hpAtDisappear ?? first.hpAtRight;
      assert.ok(second.hpAfterAppear != null, '重新出现时记到了状态');
      assert.ok(second.hpAfterAppear <= hpBefore + 1e-6, `跨门保留当前状态（${hpBefore} → ${second.hpAfterAppear}，不是满血重生）`);
      assert.ok(second.leaks.length >= 1, '有敌人走到了左门');
      assert.ok(second.leaks.every(([r, c]) => r === 36 && c === 20), '漏怪都在左门，右门不结算');
      const entries = Object.values(res.perPlayer).flatMap((pp) => pp.leaked || []);
      assert.equal(entries.length, second.leaks.length);
      assert.ok(entries.every((l) => l.sourcePlayerId === 'p_0'), '扣的是漏怪者');
      assert.deepEqual(problems, []);
    } finally {
      await page.close();
    }
  });
});
