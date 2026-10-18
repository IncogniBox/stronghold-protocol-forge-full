// 绑定票据（`welcome.bindTicket` + `uses: ["tickets"]`，DESIGN §28.59）的判据。
//
// 这一条钉的是**引擎侧的那一半**：签（`mint`）与验（`verify`）的形状、过期、篡改、一次性消费与有界集合，
// 以及**进程级单例**（`net.js` 签、`modModules.js` 验共用的那一份）。包那一半（拿票去认领 playerId）在包自己
// 那侧，这里不测。
//
// Run: node --test test/bindTickets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBindTickets, bindTickets } from '../server/bindTickets.js';

/** 一张票据析出的三段（`v1.<载荷>.<签名>`）。 */
const pieces = (ticket) => ticket.split('.');

/** 用一份**已知**密钥给一段载荷签一张票 —— 用来造「签名对、载荷坏」这一类输入。 */
const signWith = (secret, body) => {
  const sig = createHmac('sha256', secret).update(`v1.${body}`).digest('base64url');
  return `v1.${body}.${sig}`;
};

test('mint/verify：正常路径把 playerId 与 expiresAt 原样交回，票据串是三段 v1', () => {
  const t = createBindTickets({ ttlMs: 120_000, now: () => 1_000_000, secret: 'k' });
  const ticket = t.mint('p_alice');
  const [version, body, sig] = pieces(ticket);
  assert.equal(version, 'v1');
  assert.equal(pieces(ticket).length, 3);
  assert.match(body, /^[A-Za-z0-9_-]+$/, '载荷段是 base64url（无填充、URL 安全）');
  assert.match(sig, /^[A-Za-z0-9_-]+$/, '签名段是 base64url');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'jti', 'pid', 'v'].sort(), '载荷字段一个不多一个不少');
  assert.equal(payload.v, 1);
  assert.equal(payload.pid, 'p_alice');
  assert.equal(payload.iat, 1_000_000);
  assert.equal(payload.exp, 1_120_000, 'exp = iat + ttlMs');
  assert.match(payload.jti, /^[0-9a-f]{32}$/, 'jti 是 16 随机字节的十六进制');
  const r = t.verify(ticket);
  assert.deepEqual(r, { ok: true, playerId: 'p_alice', expiresAt: 1_120_000 });
  // 不带 consume 时可以反复验（读票据不该把票烧掉）
  assert.deepEqual(t.verify(ticket), r);
});

test('缺省 ttl 是 120 秒（业主口径），且同一进程里两次 mint 的 jti 不同', () => {
  const t = createBindTickets({ now: () => 0, secret: 'k' });
  const [a, b] = [t.mint('p_x'), t.mint('p_x')];
  const expOf = (ticket) => JSON.parse(Buffer.from(pieces(ticket)[1], 'base64url').toString('utf8'));
  assert.equal(expOf(a).exp, 120_000, '缺省 120 秒');
  assert.notEqual(expOf(a).jti, expOf(b).jti, '每张票一个 jti');
});

test('过期：`exp <= now` 一律 expired（边界上也是）', () => {
  let clock = 0;
  const t = createBindTickets({ ttlMs: 1000, now: () => clock, secret: 'k' });
  const ticket = t.mint('p_bob');
  clock = 999;
  assert.equal(t.verify(ticket).ok, true, '还没到点');
  clock = 1000;
  assert.deepEqual(t.verify(ticket), { ok: false, reason: 'expired' }, '到点即过期（`<=`）');
  clock = 5000;
  assert.equal(t.verify(ticket).ok, false);
});

test('被篡改的签名 / 被篡改的载荷：签名段或载荷段任一改动都拒（bad signature）', () => {
  const t = createBindTickets({ now: () => 0, secret: 'k' });
  const ticket = t.mint('p_bob');
  const [v, body, sig] = pieces(ticket);
  // 改签名：翻转最后一字符（换成一个不同的合法 base64url 字符）
  const badSig = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  assert.deepEqual(t.verify(`${v}.${body}.${badSig}`), { ok: false, reason: 'bad signature' });
  // 改载荷：把 pid 换掉，却留着原来的签名 ⇒ 签名对不上
  const forged = Buffer.from(JSON.stringify({ v: 1, pid: 'p_eve', iat: 0, exp: 9e9, jti: 'x'.repeat(32) })).toString('base64url');
  assert.notEqual(forged, body);
  assert.deepEqual(t.verify(`${v}.${forged}.${sig}`), { ok: false, reason: 'bad signature' }, '载荷被改 = 签名对不上');
  // 另一个密钥签的票也过不了（进程级单例的「同一份密钥」正是靠这个隔离）
  const other = createBindTickets({ now: () => 0, secret: 'k2' });
  assert.deepEqual(other.verify(ticket), { ok: false, reason: 'bad signature' });
});

test('乱形状：不是字符串 / 段数不对 / 前缀不对 / 空段，全部 ok:false（且不抛）', () => {
  const t = createBindTickets({ now: () => 0, secret: 'k' });
  const good = t.mint('p_bob');
  for (const bad of [null, undefined, 42, {}, [], '', 'v1', 'v1.abc', 'v2.a.b', 'v1..sig', 'v1.body.', 'a.b.c.d', 'v1.body']) {
    const r = t.verify(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} 必须被拒`);
    assert.equal(typeof r.reason, 'string');
  }
  // 段数与前缀都对、base64 坏 ⇒ 先在签名/载荷那一步落，仍然只是 ok:false
  assert.equal(t.verify('v1.%%%%.$$$$').ok, false);
  assert.equal(typeof t.verify(good).reason, 'undefined', '好票不该带 reason');
});

test('载荷形状坏（但签名是对的）⇒ bad payload', () => {
  const secret = 'known-secret';
  const t = createBindTickets({ now: () => 0, secret });
  const body = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const cases = [
    { v: 2, pid: 'p', iat: 0, exp: 9e9, jti: 'j' },        // 版本不对
    { v: 1, pid: '', iat: 0, exp: 9e9, jti: 'j' },         // pid 空
    { v: 1, pid: 'p', iat: 'x', exp: 9e9, jti: 'j' },      // iat 不是数
    { v: 1, pid: 'p', iat: 0, exp: 9e9 },                  // 缺 jti
    [1, 2, 3],                                             // 不是对象
  ];
  for (const bad of cases) {
    assert.deepEqual(t.verify(signWith(secret, body(bad))), { ok: false, reason: 'bad payload' }, JSON.stringify(bad));
  }
  // 载荷不是合法 JSON ⇒ 也只是 ok:false
  assert.equal(t.verify(signWith(secret, 'not-json')).ok, false);
});

test('consume：一次性的（第二次即 consumed），但不带 consume 的读法不烧票', () => {
  const t = createBindTickets({ now: () => 0, secret: 'k' });
  const ticket = t.mint('p_carol');
  assert.equal(t.verify(ticket).ok, true, '读一次不消费');
  assert.equal(t.verify(ticket, { consume: true }).ok, true, '第一次消费成功');
  assert.deepEqual(t.verify(ticket, { consume: true }), { ok: false, reason: 'consumed' }, '同一张票再消费即拒');
  // 不带 consume 的读法仍然可以（它不查一次性集合）
  assert.equal(t.verify(ticket).ok, true);
});

test('consume 的集合是有界的：超过 maxConsumed 时按 FIFO 淘汰最旧的一条', () => {
  const t = createBindTickets({ now: () => 0, maxConsumed: 2, secret: 'k' });
  const [t1, t2, t3] = [t.mint('p_a'), t.mint('p_b'), t.mint('p_c')];
  assert.equal(t.verify(t1, { consume: true }).ok, true);
  assert.equal(t.verify(t2, { consume: true }).ok, true);
  assert.equal(t.verify(t3, { consume: true }).ok, true, '第 3 张进来 ⇒ t1 被挤出集合');
  assert.equal(t.verify(t1, { consume: true }).ok, true, 't1 已被淘汰，因此又能被消费一次');
  assert.deepEqual(t.verify(t3, { consume: true }), { ok: false, reason: 'consumed' }, '最近的一张还在集合里');
});

test('进程级单例：`bindTickets` 能被同一个进程共用（签的那份密钥与验的那一份是同一份）', () => {
  const ticket = bindTickets.mint('p_shared');
  const r = bindTickets.verify(ticket);
  assert.equal(r.ok, true);
  assert.equal(r.playerId, 'p_shared');
  // 单例与「另造一个」互不相认（各自一份密钥）—— 这正是 net.js 签 / modModules.js 验必须共用同一个实例的理由
  const other = createBindTickets();
  assert.deepEqual(other.verify(ticket), { ok: false, reason: 'bad signature' });
});
