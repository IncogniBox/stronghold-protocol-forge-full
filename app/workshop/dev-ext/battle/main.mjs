// workshop/dev-ext/battle/main.mjs — 开发者功能扩展的服务端战斗逻辑（`pack.json.server.battle`，DESIGN §28.17）。
//
// 只做一件事：把开发者面板改过的**干员数值**挂到那名干员身上。面板改的数值由核心的 `g.dev {action:'grantChess',
// overrides}` 写在棋子的 `meta.data.devExt`（随战斗输入进 `u.pieceData.devExt`），这里在 `battleStart` 把它翻成
// **直接乘算**的属性 buff（与 `S.directMods` 同一套语义）。
//
// 覆盖键（都来自面板表单）：
//   atk / def / hp   比例（0.5 = +50%）        aspd / resFlat / batPct / blockCnt  点数 / 比例
// 只有真的带了覆盖的干员才有这条 buff（没有覆盖的干员：`removeBuff`，与从前逐字相同）。

import * as S from '@battle/mod.js';
import { num } from '@battle/mod.js';

/** 一个干员的 devExt 覆盖 → buff mods（空对象 = 没有覆盖）。 */
function devMods(ov) {
  const m = S.directMods({ atk: num(ov.atk, 0), def: num(ov.def, 0), hp: num(ov.hp, 0) });
  const put = (k, v) => { if (Number.isFinite(v) && v !== 0) m[k] = v; };
  put('aspd', num(ov.aspd, 0));
  put('resFlat', num(ov.res, 0));
  put('batPct', num(ov.bat, 0));
  put('blockCnt', num(ov.blockCnt, 0));
  return m;
}

/** 每场战斗跑一次：把每个带 `u.pieceData.devExt` 的干员挂上开发者面板改的数值。 */
export function install(battle) {
  if (!battle || typeof battle.on !== 'function') return;
  const apply = () => {
    for (const u of battle.allyUnits) {
      if (!u || u.kind !== 'op') continue;
      const key = `devext:${u.id}`;
      const ov = u.pieceData && typeof u.pieceData.devExt === 'object' ? u.pieceData.devExt : null;
      const m = ov ? devMods(ov) : {};
      if (Object.keys(m).length) {
        battle.addBuff(u, { key, persist: true, allowDead: true, refresh: 'replace', mods: m, tags: ['dev'] });
        // 生命上限是在**部署之后**才挂上去的（部署那一刻按旧 maxHp 发的血）：把当前血量补到新的上限，
        // 否则「改了生命上限」在血量条上看起来毫无变化。
        if (m.hpPct || m.hpMul) { if (typeof u.markDirty === 'function') u.markDirty(); u.hp = u.s.maxHp; }
      } else {
        battle.removeBuff(u, key);
      }
    }
  };
  battle.on('battleStart', apply);
}
