// Minimal RFC 6455 WebSocket sunucusu — sıfır bağımlılık.
// Sadece bu oyunun ihtiyaç duyduğu kadarını uygular:
// metin çerçeveleri, ping/pong, kapatma, parçalı olmayan mesajlar.
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE_BYTES = 64 * 1024; // kötü niyetli dev mesajlara karşı

export class WsConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.open = true;
    this.closeFired = false;
    this.onMessage = null;
    this.onClose = null;
    this.isAlive = true;

    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("error", () => this.close());
    socket.on("close", () => this._fireClose());
  }

  _fireClose() {
    if (this.closeFired) return;   // yalnızca bir kez
    this.closeFired = true;
    this.open = false;
    if (this.onClose) { try { this.onClose(); } catch { /* yut */ } }
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_MESSAGE_BYTES * 2) { this.close(); return; }

    while (this.open) {
      const frame = this._readFrame();
      if (!frame) break;
      const { opcode, payload } = frame;
      if (opcode === 0x8) { this.close(); break; }          // close
      if (opcode === 0x9) { this._send(0xA, payload); continue; } // ping → pong
      if (opcode === 0xA) { this.isAlive = true; continue; }      // pong
      if (opcode === 0x1) {                                        // text
        this.isAlive = true;
        if (this.onMessage) {
          try { this.onMessage(payload.toString("utf8")); }
          catch { /* tek mesaj hatası bağlantıyı düşürmesin */ }
        }
      }
      // ikili çerçeveler kullanılmıyor, sessizce atlanır
    }
  }

  _readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const first = buf[0];
    const second = buf[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_MESSAGE_BYTES)) { this.close(); return null; }
      length = Number(big);
      offset += 8;
    }
    if (length > MAX_MESSAGE_BYTES) { this.close(); return null; }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];

    this.buffer = buf.subarray(offset + length);
    return { opcode, payload };
  }

  _send(opcode, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this.close(); }
  }

  send(text) { this._send(0x1, Buffer.from(text, "utf8")); }
  sendJSON(obj) { this.send(JSON.stringify(obj)); }
  ping() { this._send(0x9, Buffer.alloc(0)); }

  close() {
    if (this.open) {
      try { this._send(0x8, Buffer.alloc(0)); } catch { /* yut */ }
      this.open = false;
      try { this.socket.end(); } catch { /* yut */ }
    }
    this._fireClose();
  }
}

// HTTP sunucusuna WebSocket yükseltme desteği ekler.
export function attachWebSocket(httpServer, onConnection) {
  httpServer.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    const conn = new WsConnection(socket);
    onConnection(conn, req);
  });
}
