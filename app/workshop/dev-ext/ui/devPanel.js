// workshop/dev-ext/ui/devPanel.js — 「开发者功能扩展」的只读诊断浮层（左下角，可收起 / 展开）。
//
// 只读读数，全部来自引擎已经给出的注入面（没有任何 store / match / Battle 句柄）：
//   ctx.net.welcome()     服务器身份读数（版本 / 本房间跑哪些模组）
//   ctx.me.room           本房间的展示面快照
//   ctx.data.get('chess') 一张数据表的只读快照（本包声明了 data:["chess"]）
//   ctx.battle.damage()   本场战斗的逐人伤害累计
// 面板每秒重画一次；拿不到读数时画「—」，不抛、不编造。收起 / 展开的状态记在面板偏好里（`ctx.session`），
// 刷新页面也记得住。
//
// **仅本地端生效**：本包的这块面板（以及大厅那一处「全量模拟」入口）只在服务端对端地址是回环 / 私网的会话上出现 ——
// 服务端在 `welcome.devAllowed` 里如实说明（`ctx.net.welcome()`），拿不到就整块不画（见 mount 的第一段）。

export function mount(ctx) {
  // **仅本地端生效**：服务端只在「对端是回环 / 私网」的会话上给出 `welcome.devAllowed`（非本地端那个键根本不出现）。
  // 拿不到 ⇒ 一整块面板（连同它那个左下角的把手）一个字都不画，`unmount` 也是空操作 —— 上传到公网服务器时，
  // 从这里连进来的浏览器看到的页面与本包不存在时逐字节相同。
  const w0 = ctx.net && typeof ctx.net.welcome === 'function' ? ctx.net.welcome() : null;
  if (!(w0 && w0.devAllowed === true)) return { unmount() {} };
  const host = ctx.host;
  if (!host) return { unmount() {} };
  const doc = host.ownerDocument;

  const box = doc.createElement('div');
  box.className = 'devext-panel';

  const head = doc.createElement('div');
  head.className = 'devext-panel__head';
  const title = doc.createElement('div');
  title.className = 'devext-panel__title';
  title.textContent = '开发者功能扩展';
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'devext-panel__toggle';
  head.append(title, toggle);

  const body = doc.createElement('pre');
  body.className = 'devext-panel__body';
  box.append(head, body);
  host.appendChild(box);

  let collapsed = ctx.session.getPref('collapsed', false) === true;
  const applyCollapsed = () => {
    box.classList.toggle('is-collapsed', collapsed);
    toggle.textContent = collapsed ? '展开' : '收起';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };

  const render = () => {
    if (collapsed) { body.textContent = ''; return; }
    const lines = [];
    lines.push(`mod      : ${ctx.pack}`);
    const w = ctx.net.welcome();
    lines.push(`server   : ${w && typeof w.version === 'string' ? w.version : '—'}`);
    const room = ctx.me.room;
    lines.push(`room mods: ${room && Array.isArray(room.mods) ? room.mods.join(', ') : '—'}`);
    const chess = ctx.data.get('chess');
    lines.push(`chess    : ${chess ? Object.keys(chess).length : '—'}`);
    const dmg = ctx.battle.damage();
    if (dmg) {
      let total = 0;
      for (const p of dmg.players) total += p.dmg;
      lines.push(`battle   : ${dmg.battleId || '—'} · ${dmg.kind || '—'} · dmg ${Math.round(total)}`);
    } else {
      lines.push('battle   : —');
    }
    body.textContent = lines.join('\n');
  };

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    ctx.session.setPref('collapsed', collapsed);
    applyCollapsed();
    render();
  });

  applyCollapsed();
  render();
  const timer = doc.defaultView.setInterval(render, 1000);
  return {
    unmount() {
      doc.defaultView.clearInterval(timer);
      box.remove();
    },
  };
}

export default mount;
