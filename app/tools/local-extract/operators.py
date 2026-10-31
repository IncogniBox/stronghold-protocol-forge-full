"""Local official art for plugin references outside our roster (DESIGN §36.28).
The official client's sprite packs and defaultskin prefab supply the pictures and Front/Back models.
No downloads, plugin imports, skin packs or changes to gameplay data. Partial/missing installs keep fallbacks.
"""
import json
import re
import subprocess
from pathlib import Path

SUB = 'plugin-art'
CHAR = re.compile(r'^char_[0-9]+_[a-z0-9]+$')
# [ASSUMED] Defence in depth for the bounded table-backed JS discovery (artReferences.js).
MAX_OPERATORS = 256
PICTURES = {'avatar': ('spritepack/ui_char_avatar_*.ab', ''),
            'portrait': ('spritepack/char_portrait_*.ab', '_1')}
# skill icons: spritepack/skill_icons_N.ab holds one Sprite per skill, named `skill_icon_<skillId>` (the id is the
# skill's own, e.g. skchr_blackd_2 — the same key data/assets.json's `skills` map uses)
SKILL_ICON_GLOB = 'spritepack/skill_icons_*.ab'
SKILL_ICON_PREFIX = 'skill_icon_'


def skill_icon_names(skill_id):
    """Sprite names an id can live under: its own, and the LINKAGE collab form where the table keeps `skchr_am_`
    (颂乐人偶's `skchr_am_amoris_1` → `skill_icon_skchr_amoris_1`, the name data/assets.json's skillsById maps)."""
    names = [skill_id]
    if skill_id.startswith('skchr_am_'):
        names.append('skchr_' + skill_id[len('skchr_am_'):])
    return names


def references(root):
    reader = Path(__file__).with_name('plugin-art.mjs')
    # Fail visibly rather than silently turning a discovery failure into an empty successful extraction.
    return json.loads(subprocess.check_output(['node', str(reader), str(root)], timeout=30))


def plan(ids):
    """Bound table-backed discovery ids before planning base/E2 sprites and default battle models."""
    selected = sorted({cid for cid in ids if isinstance(cid, str) and CHAR.fullmatch(cid)})[:MAX_OPERATORS]
    return [{'id': cid, 'bundle': f'chararts/{cid}.ab', 'prefab': f'/{cid}/defaultskin.prefab',
             'pictures': {kind: {'bundles': glob, 'names': {kind: cid + suffix, kind + 'E2': cid + '_2'}}
                          for kind, (glob, suffix) in PICTURES.items()},
             'spines': {face: f'spine/char/{cid}/{face}' for face in ('front', 'back')}}
            for cid in selected]


def merge_chars(old, new):
    """[ASSUMED] Keep earlier successful slots when a partial game install cannot re-extract them."""
    out = dict(old or {})
    for cid, art in new.items():
        prev = out.get(cid) or {}
        out[cid] = {**prev, **art}
        if prev.get('spine') or art.get('spine'):
            out[cid]['spine'] = {**prev.get('spine', {}), **art.get('spine', {})}
    return dict(sorted(out.items()))


def export(ab_root, out_root, groups, log, ids):
    import aklz4  # noqa: F401 (the existing local-client decoder)
    import UnityPy
    from extract import prefab_spine_nodes, write_spine

    jobs, chars, count = plan(ids), {}, 0
    if not jobs:
        return chars, count
    for kind, (glob, _suffix) in PICTURES.items():
        wanted = {name: (job['id'], slot) for job in jobs for slot, name in job['pictures'][kind]['names'].items()}
        for bundle in sorted(Path(ab_root).glob(glob)):
            if not wanted:
                break
            try:
                env = UnityPy.load(str(bundle))
            except Exception as err:
                log(f'warn {bundle.name}: {err}')
                continue
            for obj in env.objects:
                try:
                    if obj.type.name != 'Sprite':
                        continue
                    sprite = obj.read()
                    if sprite.m_Name not in wanted:
                        continue
                    cid, slot = wanted[sprite.m_Name]
                    img = sprite.image
                    sub, name = f'char/{kind}/{cid}', sprite.m_Name
                    target = Path(out_root) / sub / (name + '.png')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    img.save(target)
                    url = f'/assets/local/{sub}/{name}.png'
                    groups.setdefault(sub, {})[name] = {'path': url, 'w': img.width, 'h': img.height, 'kind': 'Sprite'}
                    chars.setdefault(cid, {})[slot] = url
                    del wanted[name]
                    count += 1
                    log(f'{bundle.name}: {name} -> {sub}/{name}.png')
                except Exception as err:
                    # One unreadable sprite must not hide later valid sprites in this bundle.
                    log(f'warn {bundle.name} sprite: {err}')
        for name in sorted(wanted):
            log(f'skip (not found) {kind} {name}')
    for job in jobs:
        cid, bundle = job['id'], Path(ab_root) / job['bundle']
        if not bundle.is_file():
            log(f'skip (not found) {job["bundle"]}')
            continue
        try:
            env = UnityPy.load(str(bundle))
            objects = {o.path_id: o for o in env.objects}
            ref = next((v for k, v in env.container.items() if k.endswith(job['prefab'])), None)
            nodes = prefab_spine_nodes(ref.read_typetree(), objects) if ref else []
            for face, sub in job['spines'].items():
                node = next((n for n in nodes if n[0].lower() == face), None)
                sda = objects.get(node[2]['m_PathID']) if node and not node[2].get('m_FileID') else None
                if sda is None:
                    log(f'skip (not found) {cid} {face}')
                    continue
                n = write_spine(objects, sda.read_typetree(), sub, cid, out_root, groups, log)
                if not n:
                    continue
                count += n
                files = groups[sub]
                skel = next(k for k in files if k.endswith('.skel'))
                reader = Path(__file__).with_name('plugin-art.mjs')
                meta = json.loads(subprocess.check_output(['node', str(reader), '--spine', str(Path(out_root) / sub / skel)], timeout=30))
                chars.setdefault(cid, {}).setdefault('spine', {})[face] = {
                    **meta, 'skel': files[skel]['path'], 'atlas': files[skel[:-5] + '.atlas']['path'],
                    'textures': [files[k]['path'] for k in sorted(files) if k.endswith('.png')]}
                log(f'{job["bundle"]}: {face} -> {sub} ({n} files)')
        except Exception as err:
            log(f'warn {cid}: {err}')
    return chars, count


def export_skill_icons(ab_root, out_root, groups, log, skill_ids):
    """Skill icons of the ids the game data names (skills[].iconId / skillId): one Sprite per id out of
    spritepack/skill_icons_*.ab → skill/<id>.png, manifest group `skill`, and the manifest's `skills` map
    (iconId → URL) plus `skillsById` (skillId → iconId), the two sections data/assets.json already uses.
    Returns ({'skills': …, 'skillsById': …}, file count) — the caller merges them into data/local-assets.json, and
    the served /data/assets.json picks them up through mergeLocalChars, so an id the official plan never listed still
    has its icon."""
    import aklz4  # noqa: F401 (the existing local-client decoder)
    import UnityPy

    wanted = {}
    for sid in skill_ids:
        if isinstance(sid, str) and sid:
            for name in skill_icon_names(sid):
                wanted.setdefault(SKILL_ICON_PREFIX + name, (sid, name))
    out = {'skills': {}, 'skillsById': {}}
    count = 0
    if not wanted:
        return out, count
    for bundle in sorted(Path(ab_root).glob(SKILL_ICON_GLOB)):
        if not wanted:
            break
        try:
            env = UnityPy.load(str(bundle))
        except Exception as err:
            log(f'warn {bundle.name}: {err}')
            continue
        for obj in env.objects:
            try:
                if obj.type.name != 'Sprite':
                    continue
                sprite = obj.read()
                sid = wanted.get(sprite.m_Name)
                if sid is None:
                    continue
                icon_id = sid[1]
                img = sprite.image
                sub, name = 'skill', icon_id
                target = Path(out_root) / sub / (name + '.png')
                target.parent.mkdir(parents=True, exist_ok=True)
                img.save(target)
                url = f'/assets/local/{sub}/{name}.png'
                groups.setdefault(sub, {})[name] = {'path': url, 'w': img.width, 'h': img.height, 'kind': 'Sprite'}
                out['skills'][icon_id] = url
                out['skillsById'][sid[0]] = icon_id
                del wanted[sprite.m_Name]
                count += 1
                log(f'{bundle.name}: {name} -> {sub}/{name}.png')
            except Exception as err:
                # One unreadable sprite must not hide later valid sprites in this bundle.
                log(f'warn {bundle.name} sprite: {err}')
    for sid in sorted({v[0] for v in wanted.values()} - set(out['skillsById'])):
        log(f'skip (not found) skill icon {sid}')
    return out, count
