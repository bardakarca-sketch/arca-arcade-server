// ARCA ARCADE — turnuva sunucusu (sıfır bağımlılık, Node 22+)
// Çalıştır: node index.mjs        (varsayılan port 8080)
import { createServer } from "node:http";
import { attachWebSocket } from "./ws.mjs";
import { Tournament } from "./tournament.mjs";

const PORT = Number(process.env.PORT || 8080);
const TICK_MS = 250;               // turnuva mantığı hızlı tick istemez
const IDLE_ROOM_MS = 10 * 60_000;
const CLIENT_TIMEOUT_MS = 60_000;

const rooms = new Map();

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (rooms.has(code));
  return code;
}

const httpServer = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true, rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.playerCount, 0),
    }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Arca Arcade turnuva sunucusu calisiyor.\n");
});

attachWebSocket(httpServer, (conn) => {
  let room = null;
  let player = null;
  let name = "PLAYER";

  const fail = (reason) => conn.sendJSON({ t: "error", reason });

  conn.onMessage = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (player) player.lastSeen = Date.now();

    // kabuk bağlanınca kimlik gönderir
    if (msg.t === "hello") {
      name = String(msg.name || "PLAYER").slice(0, 14);
      conn.sendJSON({ t: "hello-ok", name });
      return;
    }

    if (msg.t === "create") {
      if (player) return;
      const code = makeCode();
      room = new Tournament(code, { includeVectorStrike: !!msg.withVectorStrike });
      rooms.set(code, room);
      player = room.addPlayer(msg.name || name, conn);
      conn.sendJSON({ t: "joined", code, id: player.id, host: true });
      return;
    }

    if (msg.t === "join") {
      if (player) return;
      const code = String(msg.code || "").toUpperCase().trim();
      const target = rooms.get(code);
      if (!target) { fail("ODA BULUNAMADI"); return; }
      if (target.isFull()) { fail("ODA DOLU"); return; }
      if (target.state === "playing") { fail("MAÇ BAŞLADI — SONRAKİ TURU BEKLE"); return; }
      room = target;
      player = room.addPlayer(msg.name || name, conn);
      conn.sendJSON({ t: "joined", code, id: player.id, host: !!player.host });
      return;
    }

    if (!room || !player) return;

    if (msg.t === "ready") { room.setReady(player, msg.value !== false); return; }
    if (msg.t === "start") { room.start(player); return; }
    if (msg.t === "score") { room.submitScore(player, msg.score); return; }
    if (msg.t === "standDown") { room.standDown(player); return; }
    if (msg.t === "vote") { room.castVote(player, Number(msg.value)); return; }
    if (msg.t === "restart") { room.restart(player); return; }
    if (msg.t === "leave") {
      room.removePlayer(player.id);
      room = null; player = null;
      conn.sendJSON({ t: "left" });
      return;
    }
  };

  conn.onClose = () => {
    if (room && player) {
      room.removePlayer(player.id);
      if (room.playerCount === 0) room.emptySince = Date.now();
    }
    room = null; player = null;
  };
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.playerCount === 0) {
      if (!room.emptySince) room.emptySince = now;
      if (now - room.emptySince > IDLE_ROOM_MS) rooms.delete(code);
      continue;
    }
    room.emptySince = null;
    for (const p of [...room.players.values()]) {
      if (now - p.lastSeen > CLIENT_TIMEOUT_MS) {
        try { p.conn.close(); } catch { /* yut */ }
        room.removePlayer(p.id);
      }
    }
    if (room.playerCount === 0) continue;
    const snap = room.step();
    const payload = JSON.stringify(snap);
    for (const p of room.players.values()) if (p.conn.open) p.conn.send(payload);
  }
}, TICK_MS);

setInterval(() => {
  for (const room of rooms.values()) {
    for (const p of room.players.values()) if (p.conn.open) p.conn.ping();
  }
}, 20000);

httpServer.listen(PORT, () => {
  console.log(`Arca Arcade turnuva sunucusu :${PORT}`);
});
