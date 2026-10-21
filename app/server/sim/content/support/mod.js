// server/sim/content/support/mod.js — the pack-facing **Layer-B SDK** (docs/design/mod-layer.md §28.17).
//
// WHY THIS FILE EXISTS: a pack's `server.battle` module (`pack.json.server.battle`) and a pack's `kits/*.js` may import
// engine code through a small set of prefixes (`@battle/`, `@sim/`, `@kit/`). `@battle/index.js` is the *base* content
// helper set (the module the official wave-B modules are built on). A real community mod also needs the two things a
// wave-B module gets by importing its own siblings:
//
//   * the **registration functions** — `registerBondInstaller` / `registerGarrisonInstaller` / `registerGarrisonReader` /
//     `registerItemBehaviour`: how a mod bond / IN_BATTLE trait / layer reader / equipment behaviour adds itself to the
//     official tables WITHOUT editing them. A `server.battle` module calls these once at module top level (it is imported
//     once at boot / once per browser page), so a registration lands before any battle runs; its exported `install(battle)`
//     stays empty unless the mod needs per-battle work. (A summon kit is NOT here: a pack declares its summon by putting
//     `kits/<tokenId>.js` — the official §4.7 channel — not by registering into the engine's token table.)
//   * the **wave-B read helpers** the official installers use (`reached`, `onLayers`, `onUnitDamaged`, `isEnemyTarget`,
//     `ownTag`, `bondBb`, `byUnit`, `fireGain`, `garrisonIdsOf`, `bp`, `isProc`, `procTags`, `memberOf`,
//     `addShieldLayer`, `ids`, `bondOrder`, `chessOnBoard`, `metaBonds`, `frontPiece`) and the **stat reading** a pack
//     needs to scale an item's effect (`itemStatMods`, items/battle.js — the same numbers `installItem` applies).
//
// This module is a **leaf**: it re-exports from those sibling modules and imports nothing that imports it, so there is
// no cycle. It is reached through the two-end whitelist (`shared/kitImports.js`, `@battle/mod.js`): the server rewrites
// the specifier to a real `file:` URL before loading a `data:` module, and the browser resolves the same prefix through
// `public/index.html`'s import map — so a pack's source runs unmodified on both ends.

// the base content helpers (num, bondRecord, buffParams, bondActive, isMember, playerOps, passiveBuff, directMods,
// battleStore, gainLayers, fxOn, itemsOf, itemKeyOf, itemRecord, garrisonRecord, bondRecord, …)
export * from './index.js';

// registration surface (a mod's bond / trait / item / token)
export { registerBondInstaller, reached, onLayers, onUnitDamaged, isEnemyTarget, ownTag, bondBb } from '../bonds/core.js';
export { registerGarrisonInstaller, registerGarrisonReader, byUnit, fireGain, garrisonIdsOf } from '../garrisons/battle.js';
export { registerItemBehaviour, bp, isProc, procTags, memberOf, addShieldLayer, itemStatMods } from '../items/battle.js';

// prep-side / data helpers a mod reads (bondOrder / chessOnBoard / ids / metaBonds / frontPiece)
export { ids, bondOrder, chessOnBoard } from '../garrisons/meta.js';
export { metaBonds, frontPiece } from './meta.js';
