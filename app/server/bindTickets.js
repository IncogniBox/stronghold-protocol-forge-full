// 绑定票据（`bindTicket`，DESIGN §28.59）。
//
// 这一层只做两件事：**签**一张票据、**验**一张票据。它不认识 HTTP、不认识 WebSocket、不认识工坊包 ——
// 三个接线点分别在 server/net.js（签，每个 `welcome` 一签）、server/modModules.js（把验交出去，`uses: ["tickets"]`）
// 与包自己那只账号 lane（拿票据去绑定 playerId）。与 server/accounts.js 同一条「一层只做一件事」的写法。
//
// ## 它为什么存在
// 工坊包可以自建一套旁路账号服务（自己的 WebSocket lane），但它**拿不到游戏的 `playerId`** —— 客户端在 `pack.msg`
// 里自报的那个 `playerId` 永远不可信（改一个字段就是冒充另一个人）。缺的这半是：**游戏核心签发一张票据**，
// 那张票据**只在游戏核心里**能签（密钥不外泄），包拿票据去账号服务绑定身份。参照实现（上游那套账号系统）走的
// 正是这条路：核心签票 → 账号服务持票绑定。
//
// ## 票据串的确切形状
//   `v1.<base64url(载荷 JSON)>.<base64url(HMAC-SHA256(secret, "v1." + <载荷>))>`
// 载荷 = `{ v: 1, pid, iat, exp, jti }`：
//   * `pid`  游戏的 playerId（账号开启时是**跨会话稳定**的那个，见 accounts.js；否则是当次连接的 `p_…`）；
//   * `iat`  签发时刻（毫秒）；
//   * `exp`  = `iat + ttlMs`（缺省 120 秒）—— **一票一用、且短命**：它只够「连上包的账号服务那一刻」用；
//   * `jti`  16 随机字节的十六进制（32 字符），一次性消费靠它去重。
//
// ## 三条刻意的性质（也写在 docs/design/mod-layer.md §28.59）
//   * **每进程一份、不落盘**：`secret` 缺省 `randomBytes(32)`，进程重启即换新 ⇒ 重启前签出的票据全部作废。这不是
//     疏忽，是取舍：票据只活 120 秒，落盘换来的只是「重启后旧票还能用」，而代价是多一份要保护的密钥材料。
//   * **一票一用**（`consume`）：验证方（包的账号服务）第一次验过就把它记进一个有界集合；同 `jti` 再来 ⇒ 拒绝。
//     否则一张被截获的票据可以在有效期内反复把一个 playerId 绑到任意多个账号上。
//   * **密钥永不外泄**：模块只导出 `mint` 与 `verify`，`secret` 关在闭包里。包拿到的只是 `verify` 这个**函数**
//     （server/modModules.js `host.tickets`）—— 于是包能**验**、**不能签**。「谁是 x」这件事永远只有游戏核心说得算。
//
// ## 失败一律返回 `{ ok: false, reason }`，绝不抛
//   票据的每一段都可能坏（不是字符串 / 段数不对 / 前缀不对 / base64 坏 / 签名对不上 / 过期 / 已被消费）。
//   一个抛出来的验证函数会把「格式坏」变成「拒绝服务」，而这条路的正确失败方式是「这张票不成立」。

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 票据串的版本前缀。写进被签的那段，所以换格式 = 换前缀 = 老票当场作废（这就是「版本」的用途）。 */
const PREFIX = 'v1';
/** `jti` 的随机字节数（16 ⇒ 32 位十六进制）。 */
const JTI_BYTES = 16;
/** 缺省密钥的字节数（HMAC-SHA256 的密钥长度）。 */
const SECRET_BYTES = 32;

/** `Buffer → base64url`（无填充、URL 安全，与票据串里那两段同一个编码）。 */
const toB64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * 造一个签发/验证器。参数都可注入，所以它能被测试（`now` 是时钟，`secret` 是密钥）而不碰全局。
 *
 * @param {{ ttlMs?: number, maxConsumed?: number, now?: () => number, secret?: string|Buffer }} [opts]
 *   * `ttlMs`     票据寿命（毫秒，缺省 120000 = 120 秒）；
 *   * `maxConsumed` 一次性集合的上限（缺省 4096；FIFO 淘汰最旧的那一条）；
 *   * `now`       时钟（缺省 `Date.now`，测试注入固定/推进的时钟）；
 *   * `secret`    HMAC 密钥（缺省 `randomBytes(32)` —— **每进程一份、不落盘**）。
 * @returns {{ mint: (playerId: string) => string, verify: (ticket: unknown, opts?: { consume?: boolean }) => { ok: true, playerId: string, expiresAt: number } | { ok: false, reason: string } }}
 */
export function createBindTickets({ ttlMs = 120000, maxConsumed = 4096, now = Date.now, secret } = {}) {
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? randomBytes(SECRET_BYTES));
  // 已经消费过的 `jti`。`Map` 的迭代顺序就是插入顺序 ⇒ 「上限 + 删第一个键」正是 FIFO。
  /** @type {Map<string, true>} */
  const consumed = new Map();
  // 被签的那段带上前缀：换版本前缀就换掉签名的对象，老票因此对不上（无需另存版本号）。
  const sign = (body) => toB64(createHmac('sha256', key).update(`${PREFIX}.${body}`).digest());

  return {
    /**
     * 签一张票。`playerId` 是**游戏核心认的**那一个（调用方保证它是本会话的真身，不是客户端自报的值）。
     * @param {string} playerId
     */
    mint(playerId) {
      const iat = now();
      const payload = { v: 1, pid: playerId, iat, exp: iat + ttlMs, jti: randomBytes(JTI_BYTES).toString('hex') };
      const body = toB64(JSON.stringify(payload));
      return `${PREFIX}.${body}.${sign(body)}`;
    },

    /**
     * 验一张票。**先判串形状，再判签名（长度先判），最后判过期**；`consume` 为真时再走一次性消费。
     *
     * 顺序是刻意的：签名没验之前，载荷里的任何字段都不可信（`pid` / `exp` / `jti` 都可能被人改过），
     * 所以形状与签名必须挡在解析之前。签名比对用 `timingSafeEqual`，且**先比长度** —— `timingSafeEqual`
     * 对不等长会抛，而抛就是一个可观测的差异（长度不等在这里只可能是票据损坏，不是攻击面）。
     *
     * @param {unknown} ticket
     * @param {{ consume?: boolean }} [opts] `consume: true` ⇒ 把 `jti` 记进一次性集合（同 jti 再来即拒）。
     * @returns {{ ok: true, playerId: string, expiresAt: number } | { ok: false, reason: string }}
     */
    verify(ticket, { consume = false } = {}) {
      if (typeof ticket !== 'string') return { ok: false, reason: 'not a string' };
      const parts = ticket.split('.');
      if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) return { ok: false, reason: 'bad shape' };
      const [, body, sig] = parts;
      const expected = sign(body);
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return { ok: false, reason: 'bad signature' };
      }
      let payload;
      try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
      catch { return { ok: false, reason: 'bad payload' }; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || payload.v !== 1 || typeof payload.pid !== 'string' || !payload.pid
        || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)
        || typeof payload.jti !== 'string' || !payload.jti) {
        return { ok: false, reason: 'bad payload' };
      }
      if (payload.exp <= now()) return { ok: false, reason: 'expired' };
      if (consume) {
        if (consumed.has(payload.jti)) return { ok: false, reason: 'consumed' };
        consumed.set(payload.jti, true);
        while (consumed.size > maxConsumed) consumed.delete(consumed.keys().next().value);
      }
      return { ok: true, playerId: payload.pid, expiresAt: payload.exp };
    },
  };
}

/**
 * **进程级单例**。net.js 用它签（每个 `welcome` 一签），modModules.js 的 `host.tickets` 用它验 —— 同一份密钥、
 * 同一条一次性集合，所以「谁签的」与「谁能验」天然对齐。进程重启 ⇒ 新密钥 ⇒ 重启前签出的票全部作废（设计取舍，
 * 见 docs/design/mod-layer.md §28.59）。
 */
export const bindTickets = createBindTickets();
