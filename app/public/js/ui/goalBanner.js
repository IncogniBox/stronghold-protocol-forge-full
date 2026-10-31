// 「全局作战目标」 (the event's footage, video 7:52.4–7:55.1): as the field first comes up after 协议启动！ a dark band crosses
// the middle of the screen — the contour map (goal_bg) on its right, the ring with its hatching and cross-hair on the left
// between two brackets, the tiny 00 / 01 / STRONGHOLD PROTOCOL marks — with the match's goal in two lines: 全局作战目标 in
// green over 消灭敌方领袖！ in white. It fades in while the words wipe in from the left, holds ≈ 2 s and fades; the round
// plate (ui/matchPopups.js RoundPopup) follows it. Shown once, at round 1's 回合开始 (screens/game.js).
// Ported from the UI复刻 package (2026-10-29 snapshot): the sprites live in our /assets/local/ui/battle/ tree,
// positions measured off the video at 1280×720 (one --p = one px there). Styles: css/screens/goal-banner.css.
// pointer-events none: the field stays usable under it.
import { html } from './components.js';
import { useTimedLeave } from './matchPopups.js';
import { t } from '../../../shared/i18n.js';

const ART = '/assets/local/ui/battle/';

/** How long the band holds before it fades (the footage: in at 472.6, out from 474.9). */
export const GOAL_MS = 2300;

/** The match's goal line, or null when it has none to show (no final assault: no leader to defeat). */
export function goalOf(pub) {
  return Number.isFinite(Number(pub?.bossRound)) && Number(pub.bossRound) > 0 ? t('消灭敌方领袖！') : null;
}

const img = (name, cls) => html`<img class=${`gbn__${cls}`} src=${`${ART}${name}.png`} alt="" draggable="false" />`;

export function GoalBanner({ text, onDone }) {
  const leaving = useTimedLeave(GOAL_MS, onDone);
  return html`<div class=${`gbn${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" data-testid="goal-banner">
    <div class="gbn__band">
      ${img('banner_back', 'back')}
      ${img('goal_bg', 'map')}
      ${img('goal_round', 'round')}
      <i class="gbn__hatch" aria-hidden="true"></i>
      ${img('goal_cross', 'cross')}
      <i class="gbn__br gbn__br--l" aria-hidden="true"></i><i class="gbn__br gbn__br--r" aria-hidden="true"></i>
      ${img('goal_text_04', 't04')}${img('goal_text_00', 't00')}${img('goal_text_01', 't01')}${img('goal_text_03', 't03')}
      <i class="gbn__sq" aria-hidden="true"></i>
      <div class="gbn__words"><b>${t('全局作战目标')}</b><strong>${text}</strong></div>
    </div>
  </div>`;
}
