// ui/reconTrain.js — 重构协议·特训（模式扩展-重构模拟，shared/reconModes.js）的休整期 UI：
// 一个「特训」按钮（PHASE.PREP 且当回合 ∈ RECON_TRAINING_ROUNDS；本回合已交过就画成已完成并禁点）与一个选人
// 弹窗 —— 从**场上与待部署区**各点一名干员：教官列点一位、学员列点一位，交 `g.reconTrain`。学员在战斗里完整
// 继承教官的技能 / 特质 / 天赋（sim getChess 的 traineeOf 组成通道）并攻 / 防 / 生命 = 学员基础值 + 教官的
// RECON_TRAINEE_STAT_RATIO（0.5），获授
// 附加盟约 bond_recon（棋子芯片因此自动出现）。
import { useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel } from './components.js';
import { Img } from './gameComponents.js';
import { chessAvatarUrl } from './assetUrls.js';
import { act } from './gameActions.js';
import { t } from '../../../shared/i18n.js';

/** 弹窗里一枚可选的干员瓦片（选中态按角着色：教官金 / 学员青）。 */
function TraineeChip({ m, p, rec, role, onPick }) {
  return html`<button type="button" class="rt-pick ${role ? `is-${role}` : ''}" data-uid=${p.uid} onClick=${() => onPick(p.uid)}>
    <span class="rt-pick__pic"><${Img} src=${chessAvatarUrl(m, rec)} fallback=${html`<${Icon} name="warn" />`} /></span>
    <b class="rt-pick__name">${rec?.name || p.id}</b>
    ${role ? html`<i class="rt-pick__tag">${role === 'mentor' ? t('教官') : t('学员')}</i>` : null}
  </button>`;
}

/**
 * 特训弹窗：`priv` = 本人视图（board / temp 的棋子视图 + reconTraining），`round` = 当前特训回合号。
 * 提交走 `g.reconTrain { mentor, trainee }`（act 成功回 true、失败已 toast）——成功即关。同一人不能既是教官
 * 又是学员；本回合已交过再打开 = 改主意换人（服务端覆盖同回合那条）。
 */
export function ReconTrainModal({ m, pub, priv, gd, round, busy, onClose }) {
  const prev = (priv?.reconTraining || []).find((x) => x.round === round) || null;
  const [mentorUid, setMentorUid] = useState(prev ? prev.mentor : null);
  const [traineeUid, setTraineeUid] = useState(prev ? prev.trainee : null);

  const pieces = [
    ...((priv?.board || []).filter((p) => p && p.kind === 'chess')),
    ...((priv?.temp || []).filter((p) => p && p.kind === 'chess')),
    ...((priv?.hand || []).filter((p) => p && p.kind === 'chess')),
  ];
  const recOf = (p) => gd.chess(p.id);
  const pickMentor = (uid) => { setMentorUid(uid === mentorUid ? null : uid); };
  const pickTrainee = (uid) => { setTraineeUid(uid === traineeUid ? null : uid); };
  const ready = mentorUid != null && traineeUid != null && mentorUid !== traineeUid;
  const submit = async () => {
    if (!ready || busy) return;
    if (await act('g.reconTrain', { mentor: mentorUid, trainee: traineeUid })) onClose();
  };
  // 取消本回合已交的那条（选错了 / 想换人前先撤掉）：服务端只回收这条关系授予的盟约，其它来源保留
  const cancel = async () => {
    if (!prev || busy) return;
    if (await act('g.reconTrainCancel', { trainee: prev.trainee })) onClose();
  };
  const mentorPiece = pieces.find((p) => p.uid === mentorUid) || null;
  const traineePiece = pieces.find((p) => p.uid === traineeUid) || null;
  return html`<div class="rt-overlay" role="dialog" aria-modal="true" aria-label=${t('重构协议·特训')} onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="rt-modal">
      <header class="rt-modal__head">
        <div class="rt-modal__title"><${MicroLabel} tone="ice">R${String(round).padStart(2, '0')}<//><h3>${t('重构协议·特训')}</h3></div>
        <button type="button" class="rt-modal__x" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
      </header>
      <p class="rt-modal__hint">${t('从场上、待部署区与手牌里各点一名干员：前者成为教官，后者成为学员。学员本局永久叠加教官的技能效果、特质与天赋，攻击 / 防御 / 生命上限 = 学员基础值 + 教官的 50%，并获得盟约【重构】。')}</p>
      <div class="rt-modal__cols">
        <section class="rt-modal__col">
          <div class="rt-modal__chead"><${MicroLabel} tone="gold">${t('教官 · 点选一名')}<//>
            ${mentorPiece ? html`<b>${recOf(mentorPiece)?.name || ''}</b>` : html`<b class="is-empty">${t('未选择')}</b>`}</div>
          <div class="rt-picks">${pieces.map((p) => html`<${TraineeChip} key=${p.uid} m=${m} p=${p} rec=${recOf(p)} role=${p.uid === mentorUid ? 'mentor' : null} onPick=${pickMentor} />`)}</div>
        </section>
        <section class="rt-modal__col">
          <div class="rt-modal__chead"><${MicroLabel} tone="ice">${t('学员 · 点选一名')}<//>
            ${traineePiece ? html`<b>${recOf(traineePiece)?.name || ''}</b>` : html`<b class="is-empty">${t('未选择')}</b>`}</div>
          <div class="rt-picks">${pieces.map((p) => html`<${TraineeChip} key=${p.uid} m=${m} p=${p} rec=${recOf(p)} role=${p.uid === traineeUid ? 'trainee' : null} onPick=${pickTrainee} />`)}</div>
        </section>
      </div>
      <footer class="rt-modal__foot">
        ${prev ? html`<${Button} variant="ghost" disabled=${!!busy} onClick=${cancel}>${t('取消本回合特训')}<//>` : null}
        <${Button} variant="primary" disabled=${!ready || busy} loading=${!!busy} onClick=${submit}>${prev ? t('更换特训') : t('确认特训')}<//>
      </footer>
    </div>
  </div>`;
}

/** 休整期顶栏的「特训」按钮（done = 本回合已交过：仍可点开——弹窗里能更换或取消）。 */
export function ReconTrainButton({ done, onClick }) {
  return html`<button type="button" class="gm__gear gm__train ${done ? 'is-done' : ''}" aria-label=${t('重构协议·特训')}
    title=${done ? t('本回合已特训：可更换或取消') : t('重构协议·特训')}
    onClick=${onClick}><${Icon} name="book" /></button>`;
}
