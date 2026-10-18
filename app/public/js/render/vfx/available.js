// render/vfx/available.js — the official battle effects' file list (data/local-fx.json, DESIGN §35.1), fetched once per
// page and shared by the effects layer (render/vfx/library.js) and 设置「官方特效」 (ui/settings.js shows the setting only
// when effects were extracted). The served view answers `{ groups: {} }` on an install without effects; a server
// without the view (an older one, a static host) may answer 404 — both mean "none".
//
// Since 包自带特效 (docs/WORKSHOP.md §1.19.2) the list is a **union of sources**: every installed pack that declared a
// `fx.manifest` — its registered URL arrives in `welcome.modFx`, `main.js` hands it here — comes BEFORE the locally
// extracted one, and within the packs the order is the pack-id order the server sent. 「包优先」: a pack's entry wins
// over the locally extracted one (and a smaller pack id wins over a bigger one, DESIGN §28.3).
//
// So `loadFxList` answers `{ sources: [{ pack, groups }, …] }`, highest priority first, and render/vfx/library.js does
// the merging (ONE place — it merges the per-key tables *and* the shared index / texture tables, which cannot simply
// be overlaid because the locally extracted one covers every official operator).

export const FX_LIST_URL = '/data/local-fx.json';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** True when a file-table group names effect prefabs. */
const hasPrefabs = (groups) => {
  const g = groups && groups['fx/prefabs'];
  return !!(isObj(g) && Object.keys(g).length);
};

/** The declared pack fx manifests, `[{ pack, manifest }]`, in the order the server sent them (pack id order). */
let packs = [];
let packsKey = '';
let listPromise = null;

/**
 * Register the pack fx manifests the server declared (`welcome.modFx`, docs/WORKSHOP.md §1.19.2).
 *
 * **包优先**: the entries are kept in the order they arrive (`workshopModFxFrom` sorts by pack id), and every pack's
 * entries beat the locally extracted ones. Calling it again with the same list is a no-op; a different list drops the
 * cached view (a battle opened from now on sees it, `resetFxList`).
 * @param {Array<{ pack: string, manifest: string }>} entries
 */
export function installPackFx(entries) {
  const next = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.pack === 'string' && e.pack && typeof e.manifest === 'string' && e.manifest)
    .map((e) => ({ pack: e.pack, manifest: e.manifest }));
  const key = JSON.stringify(next);
  if (key === packsKey) return;
  packs = next;
  packsKey = key;
  resetFxList();
}

/**
 * The file list (null when absent or unreadable): the installed packs' declared tables first, the locally extracted
 * one last. A pack whose manifest 404s or is not a `{ groups }` object is simply skipped — one broken pack must not
 * cost the player the effects they already have.
 */
export function loadFxList(fetchFn = globalThis.fetch) {
  if (!listPromise) {
    listPromise = (async () => {
      if (typeof fetchFn !== 'function') return null;
      const read = async (url) => {
        try {
          const res = await fetchFn(url);
          if (!res || !res.ok) return null;
          const j = await res.json();
          return j && typeof j === 'object' ? j : null;
        } catch { return null; }
      };
      const declared = packs.slice();
      const bodies = await Promise.all(declared.map((p) => read(p.manifest)));
      const sources = [];
      for (let i = 0; i < declared.length; i++) {
        const j = bodies[i];
        if (isObj(j) && isObj(j.groups)) sources.push({ pack: declared[i].pack, groups: j.groups });
      }
      const base = await read(FX_LIST_URL);
      if (isObj(base) && isObj(base.groups)) sources.push({ pack: null, groups: base.groups });
      return sources.length ? { sources } : null;
    })();
  }
  return listPromise;
}

/** True when the list names effect prefabs — a `{ sources }` view (loadFxList) or a plain `{ groups }` table. */
export function listHasEffects(list) {
  if (Array.isArray(list && list.sources)) return list.sources.some((s) => hasPrefabs(s && s.groups));
  return hasPrefabs(list && list.groups);
}

/** Resolves to whether effects were extracted (the file list, else the local-art manifest's Phase 1a fx groups). */
export async function fxAvailable(assets) {
  if (listHasEffects(await loadFxList())) return true;
  try {
    const local = assets?.local ? await assets.local() : null;
    return listHasEffects(local);
  } catch { return false; }
}

/** Forget the cached view (tests, a re-extraction while the page is open). The registered pack manifests stay. */
export function resetFxList() { listPromise = null; }
