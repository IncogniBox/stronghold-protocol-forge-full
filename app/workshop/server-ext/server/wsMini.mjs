// wsMini.mjs —— 本包自己那条 WebSocket lane 的**帧编解码**（RFC 6455 服务端一侧，最小实现）。
//
// ## 为什么这个包要自己带一份
// `server.modules[].lane` 只把**升级**交到包手上（`host.lane(onUpgrade)`，签名见 `server/http/wsLanes.js`）：
// 「complete the 101 yourself」——宿主替你开了这条路径、替你记账，但**协议本体是包的**。所以握手应答与帧的读写
// 都得在这个包里写完，而不是指望引擎再开一格。
//
// ## 它做什么、不做什么
//   * 握手应答（`Sec-WebSocket-Accept` = base64(sha1(key + GUID))）；
//   * 读：拆帧（含 126/127 两种扩展长度、客户端掩码还原、分片按 fin 聚合）、PING→PONG、CLOSE→回执并关；
//   * 写：只发**未掩码**的服务端帧（客户端帧必须掩码，服务端帧**必须不掩码** —— 反过来浏览器直接断连）；
//   * 上限：单条消息超过 `maxPayload` 就 1009（message too big）关掉，绝不为一条超长帧无限攒缓冲。
//   * **不做** permessage-deflate（我们不协商任何扩展：应答里没有 `Sec-WebSocket-Extensions`，浏览器就不会压缩）。
//
// 这一份是**协议胶水**，不含任何账号语义 —— 语义在 `accounts.mjs`。

import { createHash } from 'node:crypto';

/** RFC 6455 的固定 GUID（握手应答的哈希后缀）。 */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 帧的 opcode（只列我们用得到的）。 */
const OP = Object.freeze({ CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa });

/** 控制帧不许分片、载荷不许超过 125 字节（RFC 6455 §5.5）。 */
const CONTROL_MAX = 125;

/** `Sec-WebSocket-Accept` 的算法体（单独导出：测试要能直接钉住这一串，不必开一条真 socket）。 */
export const acceptKey = (key) => createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');

/**
 * 完成升级握手：写 101 应答。**没有** `Sec-WebSocket-Key` 时返回 false（调用方回 400 并关连接）。
 * 应答里刻意**不写** `Sec-WebSocket-Extensions` —— 不协商任何扩展，于是浏览器不会启用压缩。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @returns {boolean} 是否应答了 101
 */
export function acceptUpgrade(req, socket) {
  const key = req && req.headers ? req.headers['sec-websocket-key'] : null;
  if (typeof key !== 'string' || !key) return false;
  const version = req.headers['sec-websocket-version'];
  if (version !== undefined && String(version) !== '13') return false;
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  return true;
}

/**
 * 一条已经升级完毕的连接。构造它之前必须先 `acceptUpgrade` 成功。
 *
 * 失败方向一律是**关连接 + 记一行**（`onClose` 只叫一次）：这个协议没有「半个消息」这种状态，
 * 一旦读到不成形的字节，唯一诚实的做法是断开，而不是猜。
 */
export class WsServer {
  /**
   * @param {import('node:stream').Duplex} socket
   * @param {{ onMessage?: (text: string, ws: WsServer) => void, onClose?: (code: number) => void,
   *   maxPayload?: number, log?: { warn?: Function, error?: Function } | null }} handlers
   */
  constructor(socket, handlers = {}) {
    this.socket = socket;
    this.onMessage = typeof handlers.onMessage === 'function' ? handlers.onMessage : () => {};
    this.onClose = typeof handlers.onClose === 'function' ? handlers.onClose : () => {};
    this.maxPayload = Number.isFinite(handlers.maxPayload) ? handlers.maxPayload : 262144;
    this.log = handlers.log || null;
    /** 累积的字节（未拆完的帧尾巴留到下一次 data）。 */
    this.buf = Buffer.alloc(0);
    /** 分片聚合（`fin === 0` 的数据帧先攒着）。 */
    this.frag = null;
    this.closed = false;
    socket.on('data', (chunk) => this._feed(chunk));
    socket.on('error', (err) => { this.log?.warn?.(`socket error: ${err && err.message ? err.message : err}`); this._finish(); });
    socket.on('close', () => this._finish());
  }

  /** 只叫一次（socket 的 error 与 close 谁先来都行）。 */
  _finish(code = 1006) {
    if (this.closed) return;
    this.closed = true;
    try { this.onClose(code); } catch { /* 观察者自己的异常不外溢到协议层 */ }
  }

  /** @param {Buffer} chunk */
  _feed(chunk) {
    if (this.closed || !chunk || !chunk.length) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    // 一条 data 里可能塞了好几帧（也可能半个），所以逐个拆到拆不动为止。
    for (;;) {
      const step = this._parseOne();
      if (step === 'need-more') return;
      if (step === 'closed') return;
    }
  }

  /** @returns {'ok'|'need-more'|'closed'} */
  _parseOne() {
    const b = this.buf;
    if (b.length < 2) return 'need-more';
    const b0 = b[0];
    const b1 = b[1];
    const fin = (b0 & 0x80) !== 0;
    const op = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return 'need-more';
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return 'need-more';
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) { this._fail(1009, 'frame too big'); return 'closed'; }
      len = Number(big);
      off = 10;
    }
    const control = op === OP.CLOSE || op === OP.PING || op === OP.PONG;
    if (control && (len > CONTROL_MAX || !fin)) { this._fail(1002, 'bad control frame'); return 'closed'; }
    if (len > this.maxPayload) { this._fail(1009, 'message too big'); return 'closed'; }
    if (masked) off += 4;
    if (b.length < off + len) return 'need-more';
    let payload;
    if (masked) {
      const mask = b.subarray(off - 4, off);
      payload = Buffer.from(b.subarray(off, off + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    } else payload = Buffer.from(b.subarray(off, off + len));
    this.buf = b.subarray(off + len);

    // 客户端帧**必须**掩码（RFC 6455 §5.1）：没掩码就不是浏览器，直接断。
    if (!masked) { this._fail(1002, 'unmasked client frame'); return 'closed'; }

    if (op === OP.PING) { this._frame(OP.PONG, payload); return 'ok'; }
    if (op === OP.PONG) return 'ok';
    if (op === OP.CLOSE) { this._frame(OP.CLOSE, payload.subarray(0, 2)); this._fail(1000, 'client closed', { silent: true }); return 'closed'; }
    if (op === OP.TEXT || op === OP.BIN || op === OP.CONT) {
      // 分片：先攒，fin 到齐了再当一条消息交出去。控制帧可以插在分片中间（上面已经处理，不碰 frag）。
      if (op !== OP.CONT) {
        if (this.frag) { this._fail(1002, 'new data frame inside a fragmented message'); return 'closed'; }
        this.frag = { op, parts: [payload] };
      } else {
        if (!this.frag) { this._fail(1002, 'continuation without a start'); return 'closed'; }
        this.frag.parts.push(payload);
      }
      const total = this.frag.parts.reduce((n, p) => n + p.length, 0);
      if (total > this.maxPayload) { this._fail(1009, 'fragmented message too big'); return 'closed'; }
      if (!fin) return 'ok';
      const whole = Buffer.concat(this.frag.parts);
      const wasBin = this.frag.op === OP.BIN;
      this.frag = null;
      if (wasBin) return 'ok';   // 本包只收文本（JSON），二进制帧忽略
      try { this.onMessage(whole.toString('utf8'), this); }
      catch (err) { this.log?.error?.(`onMessage threw: ${err && err.message ? err.message : err}`); }
      return 'ok';
    }
    return 'ok';   // 未知 opcode：忽略（RFC 允许，且本包没有要它做的事）
  }

  /** 组装并写出一帧（服务端帧不掩码）。 */
  _frame(op, payload) {
    if (this.closed) return;
    const body = payload && payload.length ? payload : Buffer.alloc(0);
    let header;
    if (body.length < 126) {
      header = Buffer.alloc(2);
      header[1] = body.length;
    } else if (body.length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(body.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(body.length), 2);
    }
    header[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([header, body])); }
    catch (err) { this.log?.warn?.(`write failed: ${err && err.message ? err.message : err}`); this._finish(); }
  }

  /** 发一条文本消息（本包的载荷一律是 JSON 字符串）。 */
  send(text) {
    if (this.closed) return false;
    this._frame(OP.TEXT, Buffer.from(String(text ?? ''), 'utf8'));
    return true;
  }

  /** 关连接：先发 CLOSE 帧再 destroy。 */
  _fail(code, why, { silent = false } = {}) {
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this._frame(OP.CLOSE, payload);
    if (!silent) this.log?.warn?.(`closing (${code}): ${why}`);
    try { this.socket.destroy(); } catch { /* 已经没了 */ }
    this._finish(code);
  }

  /** 主动关（`ctx.reject` 那条路之外的正常收尾）。 */
  close(code = 1000) { this._fail(code, 'closed by the pack', { silent: true }); }
}
