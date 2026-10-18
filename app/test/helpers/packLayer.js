// test/helpers/packLayer.js — 把已安装工坊包的 **Layer-B 载荷**（`server.battle` + `server.meta`）按官方口径装起来，
// 供需要「真实 mod 行为」的测试使用（DESIGN §28.17 / §29）。
//
// 为什么需要它：包的战斗逻辑与休整期处理器**只在房间装配时才进对局**（`server/lobby.js`：每个房间一份 forked registry
// + `battleInstallers`）。进程级的默认注册表（`getDefaultRegistry()`）**只有官方内容**，故意不含任何包 —— 所以一个
// 直接 `makeMatch()` / `makeBattle()` 的测试要跑 mod 行为，就得自己按房间那条路装一遍。
//
//   const LAYER = await packLayer({ ids: ['columbia'] });
//   makeMatch({ ..., registry: LAYER.registry });
//   makeBattle({ ..., battleInstallers: LAYER.installers });

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkshop } from '../../server/workshop.js';
import { loadBattleInstallers } from '../../server/battlePack.js';
import { loadMetaModules, buildRoomRegistry } from '../../server/match/metaPack.js';
import { getDefaultRegistry } from '../../server/match/effectsMeta.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUIET = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

/**
 * @param {{ workshopDir?: string, log?: object, ids?: string[]|null }} [opts] `ids` 限定只装哪几个包
 * @returns {Promise<{ loaded: object, installers: Array<any>, registry: object, errors: Array<any> }>}
 */
export async function packLayer({ workshopDir = join(ROOT, 'workshop'), log = QUIET, ids = null } = {}) {
  const discovered = loadWorkshop(workshopDir, { log });
  const packs = { ...discovered, packs: (discovered.packs || []).filter((p) => !ids || ids.includes(p.id)) };
  const battle = await loadBattleInstallers(packs, { log });
  const meta = await loadMetaModules(packs, { log });
  const built = buildRoomRegistry({ packs: meta.modules, base: getDefaultRegistry(), log });
  return {
    loaded: packs,
    installers: battle.installers,
    registry: built.registry ?? getDefaultRegistry(),
    errors: [...(discovered.errors || []), ...battle.errors, ...meta.errors, ...built.errors],
  };
}
