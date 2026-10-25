// 名片背景目录（官方「个人名片」34 个主题，来源 PRTS 个人名片一览，静态预览图）。
// id 是协议里的稳定键；`name` 是模块级文案（N_ 标记，显示处再 t()）。美术在
// `public/assets/ui/namecard/<id>.png`（每个主题取无水印/无界面文字的 `预览1+`，缺失时回落 `预览1`）。
import { N_ } from './i18n.js';

/** @type {ReadonlyArray<{ id: string, name: string }>} */
export const NAMECARDS = Object.freeze([
  { id: 'nc00', name: N_('默认') },
  { id: 'nc01', name: N_('☆超新星☆') },
  { id: 'nc02', name: N_('冰纹玉釉') },
  { id: 'nc03', name: N_('布道人') },
  { id: 'nc04', name: N_('渡星客') },
  { id: 'nc05', name: N_('合照') },
  { id: 'nc06', name: N_('弧光') },
  { id: 'nc07', name: N_('回溯') },
  { id: 'nc08', name: N_('集锦') },
  { id: 'nc09', name: N_('健将') },
  { id: 'nc10', name: N_('剧幕') },
  { id: 'nc11', name: N_('决意') },
  { id: 'nc12', name: N_('梦人') },
  { id: 'nc13', name: N_('暖意') },
  { id: 'nc14', name: N_('飘游') },
  { id: 'nc15', name: N_('青漾') },
  { id: 'nc16', name: N_('山水') },
  { id: 'nc17', name: N_('圣境') },
  { id: 'nc18', name: N_('失语者') },
  { id: 'nc19', name: N_('时序花圃') },
  { id: 'nc20', name: N_('甜意') },
  { id: 'nc21', name: N_('雾色秘访') },
  { id: 'nc22', name: N_('戏中身') },
  { id: 'nc23', name: N_('险途') },
  { id: 'nc24', name: N_('行者') },
  { id: 'nc25', name: N_('演算') },
  { id: 'nc26', name: N_('邀月') },
  { id: 'nc27', name: N_('一起去狩猎喵！') },
  { id: 'nc28', name: N_('移星桂冠') },
  { id: 'nc29', name: N_('遗君') },
  { id: 'nc30', name: N_('熠曲丰碑') },
  { id: 'nc31', name: N_('永恒的演出') },
  { id: 'nc32', name: N_('月落镜水') },
  { id: 'nc33', name: N_('祝鼓祭') },
]);

/** Every legal id, in display order. */
export const NAMECARD_IDS = Object.freeze(NAMECARDS.map((c) => c.id));
