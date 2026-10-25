// panel.js —— 账号面板（本包 `pack.json.client.panels[]` 的第四块界面，挂点 `root.overlays`）。
//
// ## 它对应参考文档的哪一块
// `registration.md` §1 里账号有两个入口：「起名界面」与「**大厅右上角账号入口**」。这一块就是后者。
// 「起名界面」那一个**包做不到**：面板要等 `welcome` 帧才被 `apply()`，而起名发生在 `hello` 之前
// （见 `public/js/ui/extensions.js` 顶部那份说明）—— 那是引擎自己的客户端才有权做的事。
//
// ## 界面
// 右下角一枚芯片（头像首字 + `昵称#编号`，未登录时是「登录 / 注册」）。点开是一个弹窗，三段：
//   1. **未登录**：登录（QQ 或 `昵称#编号` + 口令）/ 注册（昵称 + QQ + 口令）；
//   2. **已登录**：`昵称#编号`、QQ、头像（可上传，**待审核**）、改名、改口令、**云配置同步**、退出登录；
//   3. **管理后台**：粘贴管理口令（启动日志里那一串）之后，名称审核列表 + allow/ban/unban + 词表编辑。
//
// ## 三条纪律
//   * **文本是数据，不是标记**：一律走 Preact 文本节点，从不 `innerHTML`（与 `ui/chat.js` 同一条）。
//   * **引擎给的边界内工作**：改游戏名走 `ctx.session.setName`（引擎表面），云配置走 `ctx.cloud`
//     （引擎表面）——**两格都先探测再使用**，宿主没装就当场说明，而不是点了没反应。
//   * **面板不重挂**：所有跨帧状态都在组件里，卸载时把连接一并关掉（`client.close()`）。
//
// ## 样式
// 宿主 `ctx.host`（`.mod-panel`）被引擎置 `pointer-events: none`，所以根类 `.acct` 显式打开 `auto`（见 `acct.css`）。

import { h, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';
// （账号客户端在文件末尾，见下面那一段。）

/** htm 的全静态子树缓存会留住旧 DOM（与 `ui/chat.js` 的 `hFresh` 同一条）。 */
const hFresh = function (type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
};
const html = htmlOrHtm();

/** 页面级单例：整个页面共用一条 lane 连接（多块面板也只会开一条）。 */
let sharedClient = null;
/** 这一页上还活着的本模块面板（起名页那一格与大厅芯片那一格**可能同时在**）。用**集合**而不是计数：同一次挂载
 * 天然只记一个记号，重复 apply / 漏掉一次 unmount 都不会把它算错（`close()` 因此不会被人为拖住）。 */
const liveMounts = new Set();
/** 「**这一页里**已经进过一次大厅」没有 —— 它是「记住我」与「同页内退回起名屏」的分界线：
 *   * 新开页面 / 刷新：模块重新加载 ⇒ `false` ⇒ 起名页那一格认到 token 有效就**零输入直达**（记住我）；
 *   * 玩家在大厅按「返回」退回起名屏：同一次页面会话 ⇒ 那一格重新挂载时它已经是 `true` ⇒ **不再自动送进**，
 *     停在起名屏，由玩家点「以 昵称#编号 进入」再进。
 * **只放在模块级**（不落 localStorage / store）：「这一页里进过没有」是**这一次页面会话**的事实；写进
 * localStorage 反而会让下一次打开页面也变成「不自动进」，把「记住我」弄坏。 */
let enteredFromHere = false;
function clientFor(ctx) {
  if (!sharedClient) sharedClient = new AccountClient({ log: ctx && ctx.log });
  return sharedClient;
}

/** 一个不会抛的 htm 绑定（`htm.bind` 在极旧浏览器上才会缺；缺了退化成 `h`）。 */
function htmlOrHtm() {
  try { return htm.bind(hFresh); } catch { return hFresh; }
}

const trim = (v) => String(v == null ? '' : v).trim();

/** 头像：**只认已审核的那一枚**。`account` 是服务端回的那份完整形状 —— `avatar` 有值、且不在 `pending` /
 *  `rejected` 状态里才算「已审核」（`me` / 登录 / 注册的应答里都带着这两个标记，见 README §7.1 的 `avatar`）。
 *  审核通过之前 / 未登录 / 已退出 ⇒ `null`（引擎那两处退回它原本的画法：策略图标 / 首字）。 */
const approvedAvatar = (account) =>
  (account && typeof account.avatar === 'string' && account.avatar && !account.pending && !account.rejected ? account.avatar : null);

/** 把这枚头像交给引擎（`ctx.session.setAvatar`，引擎表面 §28.58.3）：大厅右上角那枚个人芯片与局内左上角自己那一行
 *  都会照它画。**先探测再使用**（与本模块对 `setName` / `cloud` 同一条纪律）：宿主没装这一格时静默跳过 —— 头像
 *  只是外观，不该因为它弹一句说明；引擎那边拒了（形状不对）也只当没发生。 */
function pushAvatar(ctx, account) {
  try {
    if (ctx && ctx.session && typeof ctx.session.setAvatar === 'function') ctx.session.setAvatar(approvedAvatar(account));
  } catch { /* 引擎那一格没装 / 拒绝了这次写入：外观照旧 */ }
}

/** 一个小输入框（受控）。 */
function Field({ label, type = 'text', value, onInput, placeholder, maxLength, autoComplete }) {
  return html`<label class="acct-field">
    <span class="acct-field__label">${label}</span>
    <input class="acct-field__input" type=${type} value=${value ?? ''} placeholder=${placeholder || ''}
      maxLength=${maxLength || 64} autoComplete=${autoComplete || 'off'}
      onInput=${(e) => onInput(e && e.target ? e.target.value : '')} />
  </label>`;
}

/** 一行「说明 + 值」。 */
const Row = ({ k, v }) => html`<div class="acct-row"><span class="acct-row__k">${k}</span><span class="acct-row__v">${v}</span></div>`;

/** 头像：有图就画图，没有就画首字。 */
function Avatar({ account, size = 44 }) {
  const name = account && account.name ? account.name : '';
  const style = { width: `${size}px`, height: `${size}px` };
  if (account && account.avatar) {
    return html`<span class="acct-avatar" style=${style}><img class="acct-avatar__img" src=${account.avatar} alt="" /></span>`;
  }
  return html`<span class="acct-avatar acct-avatar--text" style=${style}>${name ? [...name][0] : '?'}</span>`;
}

/**
 * 起名页那张卡片里的**内联**注册 / 登录（挂点 `screen.title.entry`）—— 与右下角那枚账号芯片是**同一个模块的两个
 * 面板**。为什么必须同模块：引擎只服务**声明过**的面板模块（`/workshop-panels/<包>/<module>`），兄弟文件不在那份
 * 名单里（`import './x.js'` 当场 404，实测过），所以「两个槽位共用同一枚 lane 客户端」只有共用同一个模块这一条路
 * ——`ctx.slot` 就是告诉它「你在哪个宿主里」的那一格。
 *
 * 这里**不走弹窗**：注册 / 登录就长在「开始」按钮下面。成功之后用 `ctx.session.setName(账号名)` 落地 ——
 * 那是引擎唯一允许面板改游戏名的入口（见包内 README §5/§6），于是「按开始进大厅」与「账号名即游戏名」是同一件事。
 * 想做游客的人**不受影响**：上面那个代号框与「开始」按钮一个字都没动。
 *
 * **「记住我」的边界**（`enteredFromHere`）：这一格挂载时若本机 token 有效，会认人、**并且**在「这一页里还没进过」
 * 时直接送进大厅 —— 这就是「新开页面零输入直达」。但玩家在大厅按「返回」退回这张起名屏时，这一刻已经是「这一页里
 * 进过一次」了，所以**不再自动送进**（否则就是回环），停在起名屏，改由玩家点账号栏里的「以 昵称#编号 进入」再进。
 */
function EntryForm({ ctx }) {
  const client = useMemo(() => clientFor(ctx), [ctx]);
  const [tab, setTab] = useState('register');
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ login: readLastLogin(), password: '', nickname: '', qq: '' });
  /** `ctx.session.setName` 那一格：登录成功后「把账号名落成游戏名并进大厅」的唯一入口。 */
  const canEnter = !!(ctx && ctx.session && typeof ctx.session.setName === 'function');
  // 头像跟上账号：登录 / 注册 / 自动认人（「记住我」那条）之后，把这枚**已审核**的头像交给引擎 —— 大厅右上角那枚
  // 个人芯片与局内左上角自己那一行都读它；退出登录 ⇒ `null`，那两处退回引擎原本的画法。
  useEffect(() => { pushAvatar(ctx, account); }, [ctx, account]);

  const say = (kind, text) => setNotice({ kind, text });
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try { await fn(); } catch (err) { say('err', err && err.message ? err.message : String(err || '出错')); }
    finally { setBusy(false); }
  };

  // 本机 token 还有效 ⇒ 认到人之后**是否**直接进大厅，取决于**这一页里进过没有**（`enteredFromHere`，见其注释）：
  // 新开页面 = 零输入直达（记住我）；玩家在大厅按「返回」退回起名屏之后 = 停在这里，由玩家点「以 … 进入」再进。
  // 这一格只挂在起名页上 ⇒ 「我在这里」就等于「玩家还没进大厅」，不会有重复进入的问题。
  useEffect(() => {
    let alive = true;
    if (!readToken()) return () => { alive = false; };
    client.me()
      .then((payload) => {
        if (!alive || !payload || !payload.account) return;
        const next = payload.account;
        setAccount(next);
        writeLastLogin(loginLabel(next));
        if (!enteredFromHere) enterWith(next);   // 这一页里已经进过一次 ⇒ 不再自动送进（回环的根因就在这一步）
      })
      .catch(() => { /* 未登录 / token 失效 / 服务没开：上次的登录名留着供回填 */ });
    return () => { alive = false; };
  }, [client]);

  const enterWith = (next) => {
    if (!next) return;
    if (!canEnter) {
      say('ok', `已登录：${next.name}#${next.tag}。这台服务器没有装 ctx.session.setName —— 把上面的代号改成这个名字再按「开始」`);
      return;
    }
    try {
      ctx.session.setName(next.name);
      enteredFromHere = true;   // 名字**真的落地**了才算「这一页里进过一次」；进不去（canEnter=false 那条）不算。
    }
    catch { say('err', '名字没落地（引擎拒绝了这次改名）'); }
  };

  const doLogin = () => run(async () => {
    const payload = await client.login(trim(form.login), form.password);
    writeToken(payload.token || '');
    const next = payload && payload.account ? payload.account : null;
    setAccount(next);
    writeLastLogin(loginLabel(next));
    enterWith(next);
  });

  const doRegister = () => run(async () => {
    const payload = await client.register(trim(form.nickname), trim(form.qq), form.password);
    writeToken(payload.token || '');
    const next = payload && payload.account ? payload.account : null;
    setAccount(next);
    writeLastLogin(loginLabel(next));
    enterWith(next);
  });

  const doLogout = () => run(async () => {
    try { await client.logout(); } catch { /* 服务端撤不掉也照样本机登出 */ }
    writeToken('');
    setAccount(null);
    say('ok', '已退出登录');
  });

  return html`<div class="acct-entry">
    ${notice ? html`<div class="acct-notice acct-notice--${notice.kind}">${notice.text}</div>` : null}
    ${account ? html`<div class="acct-entry__who">
      <span class="acct-entry__name">${account.name}<span class="acct-entry__tag">#${account.tag}</span></span>
      <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${() => enterWith(account)}>以 ${account.name}#${account.tag} 进入</button>
      <button type="button" class="acct-btn" disabled=${busy} onClick=${doLogout}>退出</button>
      <span class="acct-entry__hint">已登录 —— 按上面的「开始」，就以这个身份进大厅</span>
    </div>` : html`<div class="acct-entry__form">
      <div class="acct-tabs">
        <button type="button" class=${`acct-tab${tab === 'login' ? ' is-on' : ''}`} onClick=${() => setTab('login')}>登录</button>
        <button type="button" class=${`acct-tab${tab === 'register' ? ' is-on' : ''}`} onClick=${() => setTab('register')}>注册</button>
        <span class="acct-entry__hint">想做游客：直接填上面的代号，按「开始」即可</span>
      </div>
      ${tab === 'login' ? html`<div class="acct-entry__row">
        <${Field} label="登录名" value=${form.login} placeholder="QQ，或 昵称#编号" maxLength=${70}
          onInput=${(v) => setForm((f) => ({ ...f, login: v }))} />
        <${Field} label="口令" type="password" value=${form.password} onInput=${(v) => setForm((f) => ({ ...f, password: v }))} />
        <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doLogin}>登录</button>
      </div>` : html`<div class="acct-entry__row">
        <${Field} label="昵称" value=${form.nickname} placeholder="1～12 个字" maxLength=${12}
          onInput=${(v) => setForm((f) => ({ ...f, nickname: v }))} />
        <${Field} label="QQ" value=${form.qq} placeholder="5～12 位数字" maxLength=${12}
          onInput=${(v) => setForm((f) => ({ ...f, qq: v }))} />
        <${Field} label="口令" type="password" value=${form.password} placeholder="6～64 个字符"
          onInput=${(v) => setForm((f) => ({ ...f, password: v }))} />
        <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doRegister}>注册</button>
      </div>`}
      <div class="acct-entry__hint">注册后服务端会分配一个四位编号；登录名是「昵称#编号」或 QQ。</div>
    </div>`}
  </div>`;
}

/**
 * **统计页那一栏里的账号区块**（挂点 `screen.stats.profile`）—— 业主裁令（2026-10）：账号界面**并入右上角的
 * 个人信息页**，不再有右下角那枚浮动芯片与弹窗。所以这里渲染的是一个**普通段落**：登录 / 注册、身份卡、头像上传、
 * 改名、改口令、云配置、管理后台、退出登录全在这一块里；它随统计页开关（宿主要么在要么不在）。
 * @param {{ ctx: any }} props
 */
function ProfileBlock({ ctx }) {
  const client = useMemo(() => clientFor(ctx), [ctx]);
  const [tab, setTab] = useState('login');           // login | register | admin
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);        // { kind: 'ok'|'err', text }
  const [form, setForm] = useState({ login: readLastLogin(), password: '', nickname: '', qq: '', next: '', current: '' });
  const [adminToken, setAdminToken] = useState('');
  const [adminRows, setAdminRows] = useState([]);
  const [adminStatus, setAdminStatus] = useState('pending');
  const [adminQuery, setAdminQuery] = useState('');
  const [rules, setRules] = useState('');
  /** 管理台「头像审核」那一块：筛的状态与当前名单（服务端只在管理口令之后才给图）。 */
  const [avatarStatus, setAvatarStatus] = useState('pending');
  const [avatarRows, setAvatarRows] = useState([]);
  /** 本机 game 身份的绑定状态：`idle` 未试 / `ok` 已绑定 / `none` 服务器没装票据面 / `fail` 票据没通过。 */
  const [bind, setBind] = useState('idle');
  const [boundId, setBoundId] = useState('');
  const fileRef = useRef(null);
  /** 账号库里的管理账号（`accounts.json` 里 `admin: true`）：登录后不必再敲管理口令。 */
  const isAdmin = !!(account && account.admin === true);

  /** 引擎两格表面的可用性（探测一次，写进界面说明里 —— 点了没反应是最坏的一种失败）。 */
  const canSetName = !!(ctx && ctx.session && typeof ctx.session.setName === 'function');
  // 同上一条：账号视图里 `account` 一变（认人 / 上传头像 / 退出登录），就把这枚**已审核**的头像交给引擎。
  useEffect(() => { pushAvatar(ctx, account); }, [ctx, account]);
  const cloud = ctx && ctx.cloud && typeof ctx.cloud.read === 'function' ? ctx.cloud : null;

  const say = (kind, text) => setNotice({ kind, text });
  const fail = (err) => {
    const code = err && err.code ? err.code : 'ERROR';
    const text = err && err.message ? err.message : String(err || '出错');
    say('err', text || code);
  };

  /** 把一次成功应答里的 account 收下（服务端一律回完整账号形状）。 */
  const adopt = (payload) => {
    const next = payload && payload.account ? payload.account : null;
    if (next) setAccount(next);
    return next;
  };

  /** 当前 `welcome` 帧里的票据（引擎签发；没有这一格 = 服务器没装票据面）。 */
  const ticket = () => {
    const frame = ctx.net && typeof ctx.net.welcome === 'function' ? ctx.net.welcome() : null;
    return frame && typeof frame.bindTicket === 'string' && frame.bindTicket ? frame.bindTicket : '';
  };

  /**
   * 把本机 game 的 `playerId` 绑到这个账号上（参考文档 §3 的 `/accounts/bind`）。
   *
   * 票据是**引擎签的**：客户端只是把它原样转发给包的服务端 —— 这一格存在的全部意义就是「客户端自报 playerId 不算数」。
   * 所以这里不猜、也不改票据内容；拿不到票据就如实显示「这台服务器没装」。
   */
  const bindCurrent = async () => {
    const raw = ticket();
    if (!raw) { setBind('none'); return; }
    try {
      const payload = await client.request('bind', { ticket: raw });
      if (payload && typeof payload.playerId === 'string' && payload.playerId) {
        setBoundId(payload.playerId);
        setBind('ok');
      } else setBind('fail');
    } catch { setBind('fail'); }
  };

  // 每次收到新的 `welcome`（重连、改名后重发都算）就带**那一帧**的新票据再绑一次 —— 票据 120 秒有效，
  // 而玩家可能在大厅里停了很久才登录；等一条新 welcome 是这里唯一能拿到新票据的时机。
  useEffect(() => {
    if (!ctx.net || typeof ctx.net.on !== 'function') return () => {};
    const off = ctx.net.on('welcome', () => { if (readToken()) void bindCurrent(); });
    return () => { try { off(); } catch { /* 已经退订 */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, client]);

  // 已登录时把游戏名对齐到账号名（幂等：名字一样就不发，避免每次开面板都把 hello 重发一遍）。
  const alignName = (next) => {
    if (!canSetName || !next || !next.name) return;
    const mine = ctx.me && ctx.me.name ? ctx.me.name : '';
    if (mine === next.name) return;
    try { ctx.session.setName(next.name); } catch { /* 名字没落地不影响账号本身 */ }
  };

  /** 认一次人：本机 token 还有效就把账号收回界面、把游戏名对齐、顺手绑定这一局的 playerId。 */
  const refreshMe = () => {
    if (!readToken()) return;
    client.me()
      .then((payload) => {
        if (!payload || !payload.account) return;
        setAccount(payload.account);
        alignName(payload.account);   // 「账号名即游戏名」：带着游客名进来时把它对齐过来
        void bindCurrent();           // 本机 token 还有效 ⇒ 顺手把这一局的 playerId 绑上
      })
      .catch(() => { /* token 过期 / 服务没开：安静地当作未登录 */ });
  };

  // 挂上时认一次人：玩家可能**就在起名页那张卡片里**注册/登录过（两个面板各自拿着自己的会话状态，谁也不知道
  // 对方刚干了什么 —— 真机自测撞到过「格子里注册完、这一块还显示登录 / 注册表单」）。
  useEffect(() => { refreshMe(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client]);

  // 面板卸载：把这条连接关掉（在挂载那一层做，组件自己不持有生命周期）。
  // 这一层只负责渲染；`mount()` 返回的 `unmount` 才会调用 `client.close()`。

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try { await fn(); }
    catch (err) { fail(err); }
    finally { setBusy(false); }
  };

  const doLogin = () => run(async () => {
    const payload = await client.login(trim(form.login), form.password);
    writeToken(payload.token || '');
    const next = adopt(payload);
    writeLastLogin(loginLabel(next));
    alignName(next);
    void bindCurrent();
    say('ok', `已登录：${next.name}#${next.tag}`);
  });

  const doRegister = () => run(async () => {
    const payload = await client.register(trim(form.nickname), trim(form.qq), form.password);
    writeToken(payload.token || '');
    const next = adopt(payload);
    alignName(next);
    void bindCurrent();
    say('ok', `注册成功：${next.name}#${next.tag}`);
  });

  const doLogout = () => run(async () => {
    try { await client.logout(); } catch { /* 服务端撤不掉也照样本机登出 */ }
    writeToken('');
    setAccount(null);
    setTab('login');
    say('ok', '已退出登录');
  });

  const doRename = (name) => run(async () => {
    const next = adopt(await client.rename(trim(name)));
    alignName(next);
    say('ok', '昵称已更新');
  });

  const doPassword = () => run(async () => {
    await client.changePassword(form.current, form.next);
    setForm((f) => ({ ...f, current: '', next: '' }));
    say('ok', '口令已更新，其他设备已退出');
  });

  const doAvatar = (file) => run(async () => {
    const data = await cropAvatar(file);
    if (!data) { say('err', '这张图片读不出来（换一张 PNG / JPEG / WebP）'); return; }
    const next = adopt(await client.uploadAvatar(data));
    say('ok', next.pending ? '头像已上传，等待审核' : '头像已更新');
  });

  const doCloudUpload = () => run(async () => {
    if (!cloud) { say('err', '这台服务器没有装云配置接口（ctx.cloud），本包不能读写本机偏好'); return; }
    const snapshot = cloud.read();
    if (!snapshot) { say('err', '本机偏好读不出来'); return; }
    const payload = await client.prefsPut(snapshot);
    const cats = payload && payload.prefs ? Object.keys(payload.prefs) : [];
    say('ok', `已上传：${cats.join('、') || '（空）'}`);
  });

  const doCloudDownload = () => run(async () => {
    if (!cloud) { say('err', '这台服务器没有装云配置接口（ctx.cloud），本包不能把云端配置落到本机'); return; }
    const payload = await client.prefsGet();
    if (!payload || !payload.prefs || !Object.keys(payload.prefs).length) { say('ok', '云端还没有这份账号的配置'); return; }
    // `ctx.cloud.apply` 落盘之后**会重载页面**（偏好是引擎开机时读的），所以这句话之后页面就刷新了。
    say('ok', '正在把云端配置写到本机，页面马上重载…');
    cloud.apply(payload.prefs);
  });

  const doAdminFetch = () => run(async () => {
    const payload = await client.admin('names', { adminToken, status: adminStatus, q: adminQuery });
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    setAdminRows(rows);
    if (Array.isArray(payload.rules)) setRules(payload.rules.join('\n'));
    say('ok', `取到 ${rows.length} 行`);
  });

  const doAdminReview = (name, action) => run(async () => {
    await client.admin('review', { adminToken, name, reviewAction: action, note: '' });
    say('ok', `${name} → ${action}`);
    const payload = await client.admin('names', { adminToken, status: adminStatus, q: adminQuery });
    setAdminRows(Array.isArray(payload.rows) ? payload.rows : []);
  });

  const doAdminScan = () => run(async () => {
    const payload = await client.admin('scan', { adminToken });
    say('ok', `扫描完成：命中 ${Array.isArray(payload.observations) ? payload.observations.length : 0} 条`);
  });

  const doAdminRules = () => run(async () => {
    const words = rules.split('\n').map((w) => w.trim()).filter(Boolean);
    const payload = await client.admin('rules', { adminToken, words });
    say('ok', `词表已更新（${Array.isArray(payload.rules) ? payload.rules.length : 0} 条）`);
  });

  const doAdminAvatars = () => run(async () => {
    const payload = await client.admin('avatars', { adminToken, status: avatarStatus });
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    setAvatarRows(rows);
    say('ok', `取到 ${rows.length} 张头像`);
  });

  const doAdminAvatarReview = (accountId, action) => run(async () => {
    const payload = await client.admin('avatar-review', { adminToken, accountId, reviewAction: action, note: '' });
    setAvatarRows(Array.isArray(payload.rows) ? payload.rows : []);
    say('ok', `已处理：${action}（剩余待审 ${Array.isArray(payload.rows) ? payload.rows.length : 0}）`);
  });

  /**
   * 管理后台那一段。**它与「登没登录」无关**：运营方可能自己就登着账号，而「管理口令」是另一把钥匙
   * （服务器启动日志里那一串）。所以它被提成一个独立的「视图」（`tab === 'admin'`），两个状态都能进去。
   */
  const adminSection = html`<div class="acct-sec">
    ${isAdmin
    ? html`<div class="acct-hint">当前账号 ${account.name}#${account.tag} 拥有管理权限，无需再输入管理口令。</div>`
    : html`<div class="acct-hint">管理口令在服务器启动日志里（本包首次启动生成，存于服务器的 mod/server-ext/ 目录）。</div>
      <${Field} label="管理口令" value=${adminToken} onInput=${setAdminToken} />`}
    <div class="acct-actions">
      <button type="button" class="acct-btn" disabled=${busy} onClick=${doAdminScan}>扫描</button>
      <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doAdminFetch}>取列表</button>
    </div>
    <${Field} label="筛状态（pending/all/banned/allow/accounts）" value=${adminStatus} onInput=${setAdminStatus} />
    <${Field} label="搜名字" value=${adminQuery} onInput=${setAdminQuery} />
    <div class="acct-list">
      ${adminRows.length ? adminRows.map((row) => html`<div class="acct-list__row" key=${`${row.name}#${row.tag ?? ''}`}>
        <span class="acct-list__name">${row.name}${row.tag ? `#${row.tag}` : ''}</span>
        <span class="acct-list__why">${row.source || row.qq || ''}</span>
        <button type="button" class="acct-mini" onClick=${() => doAdminReview(row.name, 'allow')}>放行</button>
        <button type="button" class="acct-mini" onClick=${() => doAdminReview(row.name, 'ban')}>停用</button>
        <button type="button" class="acct-mini" onClick=${() => doAdminReview(row.name, 'unban')}>解除</button>
      </div>`) : html`<div class="acct-empty">（先点「取列表」）</div>`}
    </div>
    <div class="acct-sec__title">头像审核</div>
    <div class="acct-hint">待审的头像只有你看得到（别人那一侧的查询会被服务端挡掉）；「通过」之后才会出现在房间名单等处。驳回保留图片但不公开；禁传会关掉这个账号的上传按钮。</div>
    <${Field} label="筛状态（pending/rejected/banned/all）" value=${avatarStatus} onInput=${setAvatarStatus} />
    <div class="acct-actions">
      <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doAdminAvatars}>取头像列表</button>
    </div>
    <div class="acct-list">
      ${avatarRows.length ? avatarRows.map((row) => html`<div class="acct-list__row" key=${row.accountId}>
        ${row.avatar
    ? html`<img class="acct-thumb" src=${row.avatar} alt="" />`
    : html`<span class="acct-thumb acct-thumb--none">—</span>`}
        <span class="acct-list__name">${row.name}${row.tag ? `#${row.tag}` : ''}</span>
        <span class="acct-list__why">${row.pending ? '待审' : ''}${row.rejected ? '已驳回' : ''}${row.uploadBanned ? '禁传' : ''}</span>
        <button type="button" class="acct-mini" onClick=${() => doAdminAvatarReview(row.accountId, 'approve')}>通过</button>
        <button type="button" class="acct-mini" onClick=${() => doAdminAvatarReview(row.accountId, 'reject')}>驳回</button>
        <button type="button" class="acct-mini" onClick=${() => doAdminAvatarReview(row.accountId, 'ban')}>禁传</button>
        <button type="button" class="acct-mini" onClick=${() => doAdminAvatarReview(row.accountId, 'unban')}>解禁</button>
      </div>`) : html`<div class="acct-empty">（先点「取头像列表」）</div>`}
    </div>

    <div class="acct-sec__title">词表（一行一条）</div>
    <textarea class="acct-textarea" rows="5" value=${rules} onInput=${(e) => setRules(e && e.target ? e.target.value : '')}></textarea>
    <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doAdminRules}>保存词表</button>
  </div>`;

  // 这一块**不是浮层**：它是**统计页个人那一栏**里的一个段落（挂点 `screen.stats.profile`），所以没有芯片、没有
  // 弹窗、也不必在局内让路 —— 宿主要么在（统计页开着）要么不在，那是引擎那侧的事。
  return html`<div class="acct-block">
    <div class="acct-block__head">
      <span class="acct-block__title">账号</span>
      <span class="acct-block__hint">服务器功能扩展</span>
    </div>

    ${notice ? html`<div class="acct-notice acct-notice--${notice.kind}">${notice.text}</div>` : null}

      ${tab === 'admin' ? html`<div class="acct-body">
        <div class="acct-tabs">
          <button type="button" class="acct-tab is-on">管理后台</button>
          <button type="button" class="acct-tab" onClick=${() => setTab('login')}>返回</button>
        </div>
        ${adminSection}
      </div>` : account ? html`<div class="acct-body">
        <div class="acct-id">
          <${Avatar} account=${account} size=${56} />
          <div class="acct-id__text">
            <div class="acct-id__name">${account.name}<span class="acct-id__tag">#${account.tag}</span></div>
            <div class="acct-id__sub">QQ ${account.qq}</div>
            ${account.pending ? html`<div class="acct-id__flag">头像待审核</div>` : null}
            ${account.rejected ? html`<div class="acct-id__flag acct-id__flag--bad">头像被驳回，请重新上传</div>` : null}
            ${account.nameBanned ? html`<div class="acct-id__flag acct-id__flag--bad">原昵称「${account.originalName || ''}」已被停用，请改名</div>` : null}
          </div>
        </div>

        <div class="acct-actions">
          <button type="button" class="acct-btn" disabled=${busy || account.uploadBanned} onClick=${() => fileRef.current && fileRef.current.click()}>上传头像</button>
          ${account.uploadBanned ? html`<span class="acct-hint acct-hint--bad">本账号已被禁止上传头像</span>` : null}
          <input ref=${fileRef} class="acct-file" type="file" accept="image/*"
            onChange=${(e) => { const f = e && e.target && e.target.files ? e.target.files[0] : null; if (f) doAvatar(f); if (e && e.target) e.target.value = ''; }} />
        </div>

        <${Row} k="游戏名" v=${canSetName ? (ctx.me && ctx.me.name ? ctx.me.name : '—') : '（本服务器未装 ctx.session.setName）'} />
        <${Row} k="本机身份" v=${bind === 'ok' ? `已绑定（playerId ${boundId.slice(0, 10)}…）`
    : bind === 'none' ? '这台服务器没有装票据面（welcome.bindTicket 缺失）'
      : bind === 'fail' ? '票据没通过（过期或已用过）—— 重新进一次大厅再试'
        : '未绑定'} />

        <div class="acct-sec">
          <div class="acct-sec__title">改名</div>
          <${Field} label="新昵称" value=${form.nickname} placeholder="1～12 个字，不含「#」" maxLength=${12}
            onInput=${(v) => setForm((f) => ({ ...f, nickname: v }))} />
          <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${() => doRename(form.nickname)}>保存昵称</button>
        </div>

        <div class="acct-sec">
          <div class="acct-sec__title">改口令</div>
          <${Field} label="当前口令" type="password" value=${form.current} onInput=${(v) => setForm((f) => ({ ...f, current: v }))} />
          <${Field} label="新口令" type="password" value=${form.next} placeholder="6～64 个字符" onInput=${(v) => setForm((f) => ({ ...f, next: v }))} />
          <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doPassword}>保存口令</button>
        </div>

        <div class="acct-sec">
          <div class="acct-sec__title">云配置</div>
          ${cloud
    ? html`<div class="acct-hint">把本机的干员调配 / 持有 / 自选 / 时装 / 设置 / 语言存到账号上，换一台机器读回来。</div>`
    : html`<div class="acct-hint acct-hint--bad">这台服务器没有装云配置接口（ctx.cloud）：本包读不到本机偏好，这一栏不可用。</div>`}
          <div class="acct-actions">
            <button type="button" class="acct-btn" disabled=${busy || !cloud} onClick=${doCloudUpload}>上传本机配置</button>
            <button type="button" class="acct-btn" disabled=${busy || !cloud} onClick=${doCloudDownload}>下载云端配置</button>
          </div>
        </div>

        <div class="acct-actions acct-actions--end">
          <button type="button" class="acct-btn" onClick=${() => setTab('admin')}>管理后台</button>
          <button type="button" class="acct-btn" disabled=${busy} onClick=${doLogout}>退出登录</button>
        </div>
      </div>` : html`<div class="acct-body">
        <div class="acct-tabs">
          <button type="button" class=${`acct-tab${tab === 'login' ? ' is-on' : ''}`} onClick=${() => setTab('login')}>登录</button>
          <button type="button" class=${`acct-tab${tab === 'register' ? ' is-on' : ''}`} onClick=${() => setTab('register')}>注册</button>
          <button type="button" class=${`acct-tab${tab === 'admin' ? ' is-on' : ''}`} onClick=${() => setTab('admin')}>管理</button>
        </div>

        ${tab === 'login' ? html`<div class="acct-sec">
          <${Field} label="登录名" value=${form.login} placeholder="QQ，或 昵称#编号" maxLength=${70}
            onInput=${(v) => setForm((f) => ({ ...f, login: v }))} />
          <${Field} label="口令" type="password" value=${form.password} onInput=${(v) => setForm((f) => ({ ...f, password: v }))} />
          <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doLogin}>登录</button>
        </div>` : null}

        ${tab === 'register' ? html`<div class="acct-sec">
          <${Field} label="昵称" value=${form.nickname} placeholder="1～12 个字，不含「#」" maxLength=${12}
            onInput=${(v) => setForm((f) => ({ ...f, nickname: v }))} />
          <${Field} label="QQ" value=${form.qq} placeholder="5～12 位数字" maxLength=${12}
            onInput=${(v) => setForm((f) => ({ ...f, qq: v }))} />
          <${Field} label="口令" type="password" value=${form.password} placeholder="6～64 个字符"
            onInput=${(v) => setForm((f) => ({ ...f, password: v }))} />
          <button type="button" class="acct-btn acct-btn--go" disabled=${busy} onClick=${doRegister}>注册</button>
          <div class="acct-hint">注册后服务端会分配一个四位编号，登录名是「昵称#编号」或 QQ。</div>
        </div>` : null}

      </div>`}
  </div>`;
}

/**
 * 面板挂载（引擎的挂载点契约，见 `public/js/ui/extensions.js`）。
 * @param {any} ctx
 * @returns {{ unmount: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  // 同一个模块挂在两个宿主上：`screen.title.entry`（起名页那张卡片里）与 `screen.stats.profile`（统计页个人那一栏）。
  // `ctx.slot` 是引擎给的「你在哪」——它比猜 DOM 稳。
  const isEntry = !!(ctx && ctx.slot === 'screen.title.entry');
  const root = globalThis.document.createElement('div');
  root.className = isEntry ? 'acct-entry-root' : 'acct-root';
  if (host && typeof host.appendChild === 'function') host.appendChild(root);
  const token = {};
  liveMounts.add(token);
  render(isEntry ? html`<${EntryForm} ctx=${ctx} />` : html`<${ProfileBlock} ctx=${ctx} />`, root);
  return {
    unmount() {
      try { render(null, root); } catch { /* 已经拆过 */ }
      if (typeof root.remove === 'function') root.remove();
      // 两个面板共用一条连接：**最后一个**走的时候才关（起名页那一格进大厅时会先卸掉）。
      liveMounts.delete(token);
      if (!liveMounts.size && sharedClient) { sharedClient.close(); sharedClient = null; }
    },
  };
}

// ---- 账号客户端（原先在 ui/acct.js，现并进同一个模块）----
// 引擎只服务**声明过**的面板模块（`/workshop-panels/<包>/<module>`），兄弟文件不在那份名单里，
// 拆成两个文件会让 `import './acct.js'` 当场 404（实测过）。所以客户端与服务端一样：一个模块、一份字节、
// 一起进包摘要。
// acct.js —— 本包账号服务的**客户端**：一条自己开的 WebSocket（本包的 lane）+ 一个请求/应答信封。
//
// ## 为什么是 WebSocket 而不是 fetch
// 服务端那一半只挂在 `host.lane` 上（见 `server/accounts.mjs` 的文件头：`host.route` 收不到任何参数、只有
// GET/HEAD、且无鉴权）。所以客户端也用同一条通道：本包与宿主之间**不新增任何引擎协议类型** —— 这条 URL 只由
// 本包的界面自己用（`/mod-ws/server-ext/accounts`，宿主按声明开、包自己完成握手）。
//
// ## 会话
// 登录成功时服务端回一个 token；本模块把它存进**本机** localStorage（`sp.pref.panel.server-ext.token`，与
// 引擎的面板偏好同一个前缀）——「这台机器上我是谁」是纯本地状态，换台机器就要重新登录。
//
// ## 失败方向
// 「连不上 / 被关掉 / 没应答」一律**拒绝 pending 的请求并报出来**（错误对象带 `code`），绝不留一个永远等不到
// 应答的 Promise；重新发请求时会自动重连一次。

/** 本包 lane 的路径（与 `server/accounts.mjs` 的 `LANE_PATH` 同一份字面量；两边都写死成同一条）。 */
export const LANE_PATH = '/mod-ws/server-ext/accounts';

/** 本机会话 token 的存储键。 */
export const TOKEN_KEY = 'sp.pref.panel.server-ext.token';

/**
 * **上次用的登录名**（`昵称#编号`）的存储键 —— 「记住我」只记名字，**绝不记口令**。
 *
 * 为什么口令不进 localStorage：这是一台**公开可达的服务器**，浏览器里存明文口令等于「拿到这台机器（或吃到一次 XSS）
 * 就拿到账号」。而「下次不用再输」这件事**本来就不需要口令** —— 会话 token 已经落盘（见 `TOKEN_KEY`），
 * 服务端也把它持久在账号库里，所以下次打开页面直接以这个身份进大厅即可。名字只在「token 失效 / 主动退出」之后
 * 用来回填输入框（省得连登录名都重打一遍）。
 */
export const LAST_LOGIN_KEY = 'sp.pref.panel.server-ext.lastLogin';

/** 读上次的登录名（不可用时退化成空串）。 */
export function readLastLogin() {
  try { const v = globalThis.localStorage?.getItem(LAST_LOGIN_KEY); return typeof v === 'string' ? v : ''; }
  catch { return ''; }
}

/** 写上次的登录名（`昵称#编号`；传空串即清除）。 */
export function writeLastLogin(value) {
  try {
    const text = typeof value === 'string' && value.trim() ? value.trim() : '';
    if (text) globalThis.localStorage?.setItem(LAST_LOGIN_KEY, text);
    else globalThis.localStorage?.removeItem(LAST_LOGIN_KEY);
  } catch { /* 隐私模式：记不住就算了 */ }
}

/** 一个账号的**规范登录名**：`昵称#编号`（登录名可以填 QQ 或昵称本身，但这个总是有效）。 */
const loginLabel = (account) => (account && account.name ? `${account.name}#${account.tag}` : '');

/** 一次请求的默认超时（毫秒）——超时就当场失败，而不是让界面一直转圈。 */
export const REQUEST_TIMEOUT_MS = 12000;

/** 一个带 `code` 的账号错误（界面据此显示服务端给的具体原因，而不是笼统的「失败了」）。 */
export class AccountError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AccountError';
    this.code = code || 'ERROR';
  }
}

/** 读/写本机会话 token（`localStorage` 不可用时退化成「这一页里有效」）。 */
let memoryToken = '';
export function readToken() {
  try { const v = globalThis.localStorage?.getItem(TOKEN_KEY); return typeof v === 'string' ? v : memoryToken; }
  catch { return memoryToken; }
}
export function writeToken(token) {
  memoryToken = typeof token === 'string' ? token : '';
  try {
    if (memoryToken) globalThis.localStorage?.setItem(TOKEN_KEY, memoryToken);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch { /* 隐私模式：这一页里有效，落不了盘 */ }
}

/** 当前页的 lane 地址。 */
export function laneUrl() {
  const proto = globalThis.location && globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = globalThis.location ? globalThis.location.host : 'localhost';
  return `${proto}//${host}${LANE_PATH}`;
}

/**
 * 账号客户端。一条连接、一个自增 `id`，请求/应答按 `id` 对上。
 */
export class AccountClient {
  constructor({ log = null } = {}) {
    this.log = log;
    this.ws = null;
    this.connecting = null;
    /** @type {Map<number, { resolve: Function, reject: Function, timer: any }>} */
    this.pending = new Map();
    this.seq = 1;
    /** 连接状态（界面可以据此画一个「离线」角标）。 */
    this.status = 'idle';
    /** @type {Set<Function>} */
    this.watchers = new Set();
  }

  /** 订阅状态变化（返回退订函数）。 */
  onStatus(fn) {
    if (typeof fn !== 'function') return () => {};
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  setStatus(next) {
    if (this.status === next) return;
    this.status = next;
    for (const fn of [...this.watchers]) { try { fn(next); } catch { /* 观察者自己的异常不外溢 */ } }
  }

  /** 建立（或复用）连接。 */
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.setStatus('connecting');
    this.connecting = new Promise((resolve, reject) => {
      let socket;
      try { socket = new globalThis.WebSocket(laneUrl()); }
      catch (err) { this.connecting = null; this.setStatus('failed'); reject(new AccountError('NO_SOCKET', `无法连接账号服务：${err && err.message ? err.message : err}`)); return; }
      this.ws = socket;
      socket.onopen = () => { this.connecting = null; this.setStatus('online'); resolve(); };
      socket.onerror = () => { /* onclose 会接着说 */ };
      socket.onclose = (ev) => {
        this.ws = null;
        this.connecting = null;
        this.setStatus('closed');
        const why = ev && typeof ev.code === 'number' ? `连接已断开（${ev.code}）` : '连接已断开';
        this.failAll(new AccountError('DISCONNECTED', why));
      };
      socket.onmessage = (ev) => this.onFrame(ev && ev.data);
    });
    return this.connecting;
  }

  /** 一次应答：`{ id, ok, ... }` / `{ id, ok:false, error }`。 */
  onFrame(raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); }
    catch { this.log?.warn?.('[server-ext/acct] dropped a non-JSON frame'); return; }
    if (!msg || typeof msg.id !== 'number') return;
    const slot = this.pending.get(msg.id);
    if (!slot) return;
    this.pending.delete(msg.id);
    try { clearTimeout(slot.timer); } catch { /* 已经触发过 */ }
    if (msg.ok === false) {
      const err = msg.error || {};
      slot.reject(new AccountError(err.code || 'ERROR', err.message || ''));
      return;
    }
    slot.resolve(msg);
  }

  /** 断线：把所有在等的请求一次性失败掉。 */
  failAll(err) {
    for (const [, slot] of this.pending) {
      try { clearTimeout(slot.timer); } catch { /* 已经触发过 */ }
      slot.reject(err);
    }
    this.pending.clear();
  }

  /** 叫停（面板卸载时用；`unmount` 之后没人再等应答）。 */
  close() {
    this.failAll(new AccountError('DISCONNECTED', '账号面板已关闭'));
    const socket = this.ws;
    this.ws = null;
    this.connecting = null;
    this.setStatus('idle');
    if (socket) { try { socket.close(1000, 'panel closed'); } catch { /* 已经没了 */ } }
  }

  /**
   * 发一条请求。`fields` 里的 `token` 由这里补上（每个请求都带，服务端据此认人）。
   * @param {string} op
   * @param {Record<string, any>} [fields]
   * @returns {Promise<any>} 应答载荷（已去掉 `id` / `ok`）
   */
  async request(op, fields = {}) {
    await this.connect();
    const socket = this.ws;
    if (!socket || socket.readyState !== 1) throw new AccountError('DISCONNECTED', '账号服务未连接');
    const id = this.seq++;
    const token = readToken();
    const payload = { id, op, ...(token ? { token } : {}), ...fields };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AccountError('TIMEOUT', '账号服务没有应答（超时）'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (msg) => { const { id: _id, ok: _ok, ...rest } = msg; resolve(rest); },
        reject,
        timer,
      });
      try { socket.send(JSON.stringify(payload)); }
      catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new AccountError('SEND_FAILED', `发送失败：${err && err.message ? err.message : err}`));
      }
    });
  }

  // ---- 语义化的调用口（界面只认这几个） --------------------------------------------------------

  register(nickname, qq, password) { return this.request('register', { nickname, qq, password }); }
  login(login, password) { return this.request('login', { login, password }); }
  me() { return this.request('me'); }
  logout() { return this.request('logout'); }
  rename(name) { return this.request('name', { name }); }
  changePassword(current, next) { return this.request('password', { current, next }); }
  uploadAvatar(data) { return this.request('avatar', { data }); }
  prefsGet() { return this.request('prefsGet'); }
  prefsPut(patch) { return this.request('prefsPut', { patch }); }
  admin(action, fields = {}) { return this.request('admin', { action, ...fields }); }
}

/**
 * 把一张图片文件裁成 128×128 的 PNG data URL（居中裁切、等比缩放）。
 *
 * 为什么在客户端裁：服务端只收 PNG/JPEG/WebP 且有一个字节上限（`server/accounts.mjs` 的 `LIMITS.avatarMax`），
 * 而玩家手机相册里的一张照片动辄几 MB —— 让它先在这台机器上变成 128×128 再上路，是唯一不浪费一条 lane 带宽的做法。
 * 任一步失败返回 `null`（调用方据此提示，而不是发一张半成品上去）。
 * @param {File} file
 * @param {number} [size]
 * @returns {Promise<string|null>}
 */
export async function cropAvatar(file, size = 128) {
  if (!file || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    if (typeof bitmap.close === 'function') bitmap.close();
    return canvas.toDataURL('image/png');
  } catch { return null; }
}
