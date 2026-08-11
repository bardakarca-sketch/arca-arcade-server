// ARCA ARCADE — turnuva odası.
// Model: herkes aynı tohumla aynı oyunu oynar, en yüksek skor turu kazanır.
// Tur kazananı 1 puan alır. 4 tur sonunda en çok puan toplayan turnuvayı kazanır.
import { Match } from "./match.mjs";

export const ROUNDS = [
  { game: "highway-run", name: "HIGHWAY RUN", limitSec: 180, metric: "EN UZUN MESAFE" },
  { game: "catlak",      name: "ÇATLAK",      limitSec: 240, metric: "EN ÇOK PUAN",
    vote: {
      key: "difficulty",
      title: "TAKİPÇİ ZORLUĞU",
      options: [
        { value: 0, label: "YALNIZ" },
        { value: 1, label: "ACEMİ" },
        { value: 2, label: "USTA" },
        { value: 3, label: "KESKİN" },
        { value: 4, label: "AMANSIZ" },
      ],
      fallback: 2,
    } },
  { game: "fuse",        name: "FUSE",        limitSec: 180, metric: "EN BÜYÜK KASA" },
  { game: "vector-strike", name: "VECTOR STRIKE", limitSec: 240, metric: "EN ÇOK ELEME", optional: true },
];

const MAX_PLAYERS = 8;
const RESULT_SECONDS = 12;      // tur sonrası tablo süresi
const VOTE_SECONDS = 20;        // oylama süresi
const ROUND_GRACE_MS = 15000;   // herkes bitirmezse bekleme payı

/** Verilen oyun kimliklerini geçerli tur nesnelerine çevirir (sıra korunur). */
function resolveRounds(games) {
  if (!Array.isArray(games)) return [];
  const out = [];
  for (const id of games) {
    const found = ROUNDS.find((r) => r.game === id);
    if (found && !out.includes(found)) out.push(found);
  }
  return out;
}

/** Oda kurulurken: geçerli liste yoksa hepsini oyna. */
function pickRounds(games) {
  const out = resolveRounds(games);
  return out.length ? out : ROUNDS.slice();
}

export class Tournament {
  constructor(code, opts = {}) {
    this.code = code;
    this.allRounds = ROUNDS;
    this.players = new Map();      // id -> player
    this.nextId = 1;
    this.state = "lobby";          // lobby | playing | result | finished
    this.roundIndex = -1;
    this.seed = 0;
    this.rounds = pickRounds(opts.games);
    this.roundStartedAt = 0;
    this.resultUntil = 0;
    this.lastRoundTable = null;
    this.events = [];
    this.emptySince = null;
    this.match = null;             // Vector Strike canlı maçı (PvP seçilirse)
    this.matchPlayers = new Map(); // turnuva oyuncu id -> maç oyuncusu
  }

  // ——— VECTOR STRIKE CANLI MAÇ ———
  ensureMatch() {
    if (!this.match) {
      this.match = new Match(this.code);
      this.match.phase = "running";
      this.match.timeLeft = 9999;   // süreyi turnuva turu belirler
    }
    return this.match;
  }

  matchJoin(p) {
    if (this.state !== "playing") return null;
    const round = this.rounds[this.roundIndex];
    if (!round || round.game !== "vector-strike") return null;
    const match = this.ensureMatch();
    const existing = this.matchPlayers.get(p.id);
    if (existing && match.players.has(existing.id)) return existing;
    const stub = { open: true, send() {}, sendJSON() {} };
    const mp = match.addPlayer(p.name, stub);
    match.phase = "running";
    this.matchPlayers.set(p.id, mp);
    this.events.push({ t: "vsJoin", name: p.name });
    return mp;
  }

  matchInput(p, msg) {
    const mp = this.matchPlayers.get(p.id);
    if (!mp || !this.match) return;
    this.match.applyInput(mp, msg);
  }

  matchLeave(p) {
    const mp = this.matchPlayers.get(p.id);
    if (!mp || !this.match) return;
    this.match.removePlayer(mp.id);
    this.matchPlayers.delete(p.id);
  }

  /** 30 Hz'de çağrılır; canlı maç varsa ilerletir ve anlık durumu döndürür. */
  stepMatch() {
    if (!this.match || this.matchPlayers.size === 0) return null;
    if (this.state !== "playing") return null;
    return this.match.step();
  }

  /** PvP oynayanların eleme sayısını tur skoru olarak yaz. */
  harvestMatchScores() {
    if (!this.match) return;
    for (const [tid, mp] of this.matchPlayers) {
      const player = this.players.get(tid);
      const live = this.match.players.get(mp.id);
      if (!player || !live) continue;
      const kills = live.score ?? 0;
      if (player.score === null || kills > player.score) player.score = kills;
      player.attempts += 1;
    }
    this.match = null;
    this.matchPlayers.clear();
  }

  get playerCount() { return this.players.size; }
  isFull() { return this.players.size >= MAX_PLAYERS; }

  addPlayer(name, conn) {
    const id = this.nextId++;
    const player = {
      id,
      name: String(name || "PLAYER").slice(0, 14).toUpperCase() || "PLAYER",
      conn,
      points: 0,
      ready: false,
      score: null,        // bu turdaki EN İYİ skor
      attempts: 0,        // bu turda kaç kez denedi
      done: false,        // "bitirdim" dedi mi
      vote: null,
      host: this.players.size === 0,
      lastSeen: Date.now(),
    };
    this.players.set(id, player);
    this.events.push({ t: "join", name: player.name });
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.events.push({ t: "leave", name: p.name });
    this.players.delete(id);
    // ev sahibi ayrıldıysa devret
    if (p.host) {
      const next = this.players.values().next().value;
      if (next) next.host = true;
    }
  }

  /** Ev sahibi lobide hangi oyunların oynanacağını seçer. */
  setGames(p, games) {
    if (!p.host) return;
    if (this.state !== "lobby") return;
    // Burada varsayılana DÜŞÜLMEZ: geçersiz/boş istek yok sayılır,
    // yoksa boş liste göndermek seçimi sessizce sıfırlardı.
    const next = resolveRounds(games);
    if (!next.length) return;
    this.rounds = next;
    this.events.push({ t: "games", list: next.map((r) => r.game) });
  }

  setReady(p, ready) {
    if (this.state !== "lobby" && this.state !== "result") return;
    p.ready = !!ready;
  }

  /** Ev sahibi turnuvayı başlatır. */
  start(p) {
    if (!p.host) return;
    if (this.state !== "lobby") return;
    if (this.players.size < 2) return;
    this.roundIndex = -1;
    for (const pl of this.players.values()) { pl.points = 0; pl.ready = false; }
    this.nextRound();
  }

  nextRound() {
    this.roundIndex += 1;
    if (this.roundIndex >= this.rounds.length) { this.finish(); return; }
    const round = this.rounds[this.roundIndex];
    for (const pl of this.players.values()) {
      pl.score = null; pl.attempts = 0; pl.done = false; pl.ready = false; pl.vote = null;
    }
    this.roundOption = null;
    this.match = null;
    this.matchPlayers.clear();
    if (round.vote) {
      this.state = "vote";
      this.voteUntil = Date.now() + VOTE_SECONDS * 1000;
      this.events.push({ t: "vote", name: round.name, title: round.vote.title });
      return;
    }
    this.beginPlay();
  }

  beginPlay() {
    const round = this.rounds[this.roundIndex];
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.state = "playing";
    this.roundStartedAt = Date.now();
    this.events.push({
      t: "round", index: this.roundIndex, game: round.game,
      name: round.name, seed: this.seed, option: this.roundOption,
    });
  }

  castVote(p, value) {
    if (this.state !== "vote") return;
    const round = this.rounds[this.roundIndex];
    if (!round || !round.vote) return;
    const allowed = round.vote.options.some((o) => o.value === value);
    if (!allowed) return;
    p.vote = value;
  }

  tallyVote() {
    const round = this.rounds[this.roundIndex];
    const counts = new Map();
    for (const pl of this.players.values()) {
      if (pl.vote === null || pl.vote === undefined) continue;
      counts.set(pl.vote, (counts.get(pl.vote) ?? 0) + 1);
    }
    let best = round.vote.fallback;
    let bestCount = -1;
    for (const [value, count] of counts) {
      // beraberlikte daha zor olan (büyük değer) kazanır
      if (count > bestCount || (count === bestCount && value > best)) { best = value; bestCount = count; }
    }
    this.roundOption = best;
    const chosen = round.vote.options.find((o) => o.value === best);
    this.events.push({ t: "voteEnd", label: chosen ? chosen.label : String(best) });
    this.beginPlay();
  }

  /**
   * Bir deneme bitti. Tur süresi boyunca sınırsız deneme yapılabilir;
   * sıralamaya oyuncunun EN İYİ skoru girer.
   */
  submitScore(p, score) {
    if (this.state !== "playing") return;
    if (p.done) return;                       // "bitirdim" dediyse artık sayılmaz
    const value = Number(score);
    const clean = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    p.attempts += 1;
    const isBest = p.score === null || clean > p.score;
    if (isBest) p.score = clean;
    this.events.push({ t: "try", name: p.name, score: clean, best: p.score, isBest });
  }

  /** Oyuncu "bitirdim" dedi — bu turda artık denemeyecek. */
  standDown(p) {
    if (this.state !== "playing") return;
    p.done = true;
    this.events.push({ t: "done", name: p.name, score: p.score ?? 0 });
    if ([...this.players.values()].every((pl) => pl.done)) this.closeRound();
  }

  closeRound() {
    if (this.state !== "playing") return;
    this.harvestMatchScores();
    const table = [...this.players.values()]
      .map((pl) => ({ id: pl.id, name: pl.name, score: pl.score ?? 0 }))
      .sort((a, b) => b.score - a.score);

    // en yüksek skor 1 puan; beraberlikte hepsi alır
    const top = table.length ? table[0].score : 0;
    const winners = table.filter((row) => row.score === top && top > 0);
    for (const w of winners) {
      const pl = this.players.get(w.id);
      if (pl) pl.points += 1;
    }

    this.lastRoundTable = {
      round: this.roundIndex,
      name: this.rounds[this.roundIndex].name,
      table,
      winners: winners.map((w) => w.name),
    };
    this.state = "result";
    this.resultUntil = Date.now() + RESULT_SECONDS * 1000;
    this.events.push({ t: "roundEnd", winners: this.lastRoundTable.winners, name: this.lastRoundTable.name });
  }

  finish() {
    this.state = "finished";
    const standings = this.standings();
    const best = standings.length ? standings[0].points : 0;
    const champs = standings.filter((s) => s.points === best && best > 0).map((s) => s.name);
    this.champion = champs.length ? champs.join(" & ") : null;
    this.events.push({ t: "final", champion: this.champion });
  }

  standings() {
    return [...this.players.values()]
      .map((pl) => ({ id: pl.id, name: pl.name, points: pl.points, host: pl.host }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }

  /** Yeni turnuva (bitmiş odada). */
  restart(p) {
    if (!p.host) return;
    if (this.state !== "finished") return;
    this.state = "lobby";
    this.roundIndex = -1;
    this.lastRoundTable = null;
    this.champion = null;
    for (const pl of this.players.values()) {
      pl.points = 0; pl.ready = false; pl.score = null; pl.done = false;
      pl.attempts = 0; pl.vote = null;
    }
    this.roundOption = null;
    this.events.push({ t: "lobby" });
  }

  step() {
    const now = Date.now();

    if (this.state === "vote") {
      const everyoneVoted = this.players.size > 0 &&
        [...this.players.values()].every((pl) => pl.vote !== null && pl.vote !== undefined);
      if (everyoneVoted || now >= this.voteUntil) this.tallyVote();
    } else if (this.state === "playing") {
      const limit = this.rounds[this.roundIndex].limitSec * 1000;
      // Tur süresi dolunca kapanır. O ana kadar herkes istediği kadar deneyebilir.
      if (now - this.roundStartedAt > limit) {
        for (const pl of this.players.values()) { pl.score = pl.score ?? 0; pl.done = true; }
        this.closeRound();
      }
    } else if (this.state === "result") {
      const allReady = this.players.size > 0 && [...this.players.values()].every((pl) => pl.ready);
      if (allReady || now >= this.resultUntil) this.nextRound();
    }

    if (this.players.size < 2 && this.state === "playing") {
      // tek kişi kaldıysa turnuvayı bitir
      this.finish();
    }
    return this.snapshot();
  }

  snapshot() {
    const round = this.roundIndex >= 0 && this.roundIndex < this.rounds.length
      ? this.rounds[this.roundIndex] : null;
    const snap = {
      t: "room",
      code: this.code,
      state: this.state,
      roundIndex: this.roundIndex,
      roundCount: this.rounds.length,
      catalog: ROUNDS.map((r) => ({ game: r.game, name: r.name, metric: r.metric })),
      games: this.rounds.map((r) => r.game),
      round: round ? { game: round.game, name: round.name, limitSec: round.limitSec } : null,
      seed: this.seed,
      timeLeft: this.state === "playing" && round
        ? Math.max(0, Math.round((round.limitSec * 1000 - (Date.now() - this.roundStartedAt)) / 1000))
        : (this.state === "result" ? Math.max(0, Math.round((this.resultUntil - Date.now()) / 1000))
        : (this.state === "vote" ? Math.max(0, Math.round((this.voteUntil - Date.now()) / 1000)) : 0)),
      metric: round ? round.metric : null,
      vote: round && round.vote && this.state === "vote"
        ? { title: round.vote.title, options: round.vote.options } : null,
      option: this.roundOption ?? null,
      players: [...this.players.values()].map((pl) => ({
        id: pl.id, name: pl.name, points: pl.points,
        ready: pl.ready, done: pl.done, score: pl.score,
        attempts: pl.attempts, vote: pl.vote, host: pl.host,
      })),
      standings: this.standings(),
      lastRound: this.lastRoundTable,
      champion: this.champion ?? null,
      events: this.events,
    };
    this.events = [];
    return snap;
  }
}
