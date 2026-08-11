// Otoriter maç odası. İstemci yalnızca GİRDİ gönderir; can, skor, pickup,
// maç süresi ve isabet kararları burada verilir.
import {
  TARGET_SCORE, ROUND_SECONDS, SPAWN_SHIELD_SECONDS,
  PLAYER_HEIGHT, PLAYER_RADIUS, ARENA_HALF_WIDTH, ARENA_HALF_DEPTH,
  WALK_SPEED, SPRINT_SPEED, GRAVITY, JUMP_VELOCITY, JUMP_PAD_VELOCITY,
  MAX_HEALTH, MAX_ARMOR, WEAPONS, WEAPON_KEYS,
  JUMP_PADS, WEAPON_PADS, PICKUP_PADS, SPAWNS,
  platformHeightAt, playerBlockedAt, rayHitsBarrier,
} from "./arena.mjs";

export const TICK_HZ = 30;
const TICK_DT = 1 / TICK_HZ;
const MAX_PLAYERS = 8;
const RESPAWN_SECONDS = 2.4;
const PICKUP_RESPAWN = 12;
const MAX_QUEUED_INPUTS = 24;  // istemci girdi taşkını sınırı
const MAX_INPUT_DT = 0.05;     // tek girdi karesinin üst sınırı (hız hilesine karşı)
const BUDGET_TOLERANCE = 1.15; // gerçek zamanın en fazla %15 üstü işlenir
const HEAD_HEIGHT = 1.55;   // omuz/kafa merkezi (ayaktan yukarı)
const HIT_RADIUS = 0.55;    // gövde isabet yarıçapı

function fullAmmo() {
  const ammo = {};
  for (const key of WEAPON_KEYS) ammo[key] = WEAPONS[key].magazine;
  return ammo;
}

export class Match {
  constructor(code) {
    this.code = code;
    this.players = new Map();   // id -> player
    this.nextId = 1;
    this.timeLeft = ROUND_SECONDS;
    this.phase = "lobby";       // lobby | running | finished
    this.winner = null;
    this.events = [];           // bu tick'te yayınlanacak olaylar
    this.pickups = PICKUP_PADS.map((data, index) => ({ index, data, available: true, respawn: 0 }));
    this.lastTick = Date.now();
  }

  get playerCount() { return this.players.size; }
  isFull() { return this.players.size >= MAX_PLAYERS; }

  spawnPointFor(id) {
    // en uzak spawn'ı seç — düşmanın üstüne doğmayı azaltır
    const others = [...this.players.values()].filter((p) => p.id !== id && p.alive);
    let best = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
    let bestScore = -1;
    for (const spawn of SPAWNS) {
      let nearest = Infinity;
      for (const other of others) {
        nearest = Math.min(nearest, Math.hypot(spawn.x - other.x, spawn.z - other.z));
      }
      const score = others.length ? nearest : Math.random();
      if (score > bestScore) { bestScore = score; best = spawn; }
    }
    return best;
  }

  addPlayer(name, conn) {
    const id = this.nextId++;
    const spawn = this.spawnPointFor(id);
    const player = {
      id, name: String(name || "PLAYER").slice(0, 14).toUpperCase(), conn,
      x: spawn.x, y: PLAYER_HEIGHT, z: spawn.z, yaw: spawn.yaw, pitch: 0,
      velocityY: 0, grounded: true,
      health: MAX_HEALTH, armor: 0, alive: true,
      score: 0, deaths: 0,
      weapon: "rifle", ammo: fullAmmo(), inventory: ["rifle", "shotgun"],
      shotCooldown: 0, reloadTimer: 0, reloadTotal: 0,
      respawn: 0, padCooldown: 0, spawnShield: SPAWN_SHIELD_SECONDS,
      inputQueue: [], timeBudget: 0,
      lastSeq: 0, connected: true, lastSeen: Date.now(),
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
  }

  startMatch() {
    this.phase = "running";
    this.timeLeft = ROUND_SECONDS;
    this.winner = null;
    for (const p of this.players.values()) this.respawnPlayer(p, true);
    this.pickups.forEach((pk) => { pk.available = true; pk.respawn = 0; });
    this.events.push({ t: "start" });
  }

  respawnPlayer(p, resetScore = false) {
    const spawn = this.spawnPointFor(p.id);
    p.x = spawn.x; p.z = spawn.z; p.y = PLAYER_HEIGHT; p.yaw = spawn.yaw; p.pitch = 0;
    p.velocityY = 0; p.grounded = true;
    p.health = MAX_HEALTH; p.armor = 0; p.alive = true;
    p.ammo = fullAmmo(); p.weapon = "rifle"; p.inventory = ["rifle", "shotgun"];
    p.shotCooldown = 0; p.reloadTimer = 0; p.reloadTotal = 0;
    p.respawn = 0; p.padCooldown = 0; p.spawnShield = SPAWN_SHIELD_SECONDS;
    p.inputQueue.length = 0; p.timeBudget = 0;
    if (resetScore) { p.score = 0; p.deaths = 0; }
  }

  // ——— girdi doğrulama: istemciye güvenilmez ———
  // Girdiler KUYRUĞA alınır ve her biri kendi dt'siyle işlenir. Böylece
  // istemcideki client prediction ile sunucu birebir aynı adımları uygular.
  applyInput(p, msg) {
    if (!p) return;
    p.lastSeen = Date.now();
    if (p.inputQueue.length >= MAX_QUEUED_INPUTS) p.inputQueue.shift(); // taşkına karşı
    const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    const clamp1 = (v) => Math.max(-1, Math.min(1, num(v)));
    p.inputQueue.push({
      seq: num(msg.seq),
      dt: Math.max(0, Math.min(MAX_INPUT_DT, num(msg.dt, 1 / 30))),
      f: clamp1(msg.f),
      r: clamp1(msg.r),
      sprint: msg.sp ? 1 : 0,
      jump: !!msg.j,
      fire: !!msg.fi,
      reload: !!msg.rl,
      yaw: num(msg.yaw, p.yaw),
      pitch: Math.max(-1.35, Math.min(1.35, num(msg.pitch, p.pitch))),
      weapon: typeof msg.w === "string" ? msg.w : null,
    });
  }

  step() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000) || TICK_DT;
    this.lastTick = now;

    if (this.phase === "running") {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
    }

    for (const p of this.players.values()) {
      this.stepPlayer(p, dt);
    }
    this.stepPickups(dt);

    if (this.phase === "running") {
      const leader = [...this.players.values()].sort((a, b) => b.score - a.score)[0];
      if (leader && leader.score >= TARGET_SCORE) this.finish(leader);
      else if (this.timeLeft <= 0) this.finish(leader ?? null);

    }
    return this.snapshot();
  }

  finish(leader) {
    this.phase = "finished";
    this.winner = leader ? leader.name : null;
    this.events.push({ t: "end", winner: this.winner });

  }

  stepPlayer(p, dt) {
    if (p.spawnShield > 0) p.spawnShield = Math.max(0, p.spawnShield - dt);
    if (p.padCooldown > 0) p.padCooldown = Math.max(0, p.padCooldown - dt);
    if (p.shotCooldown > 0) p.shotCooldown = Math.max(0, p.shotCooldown - dt);

    if (!p.alive) {
      p.respawn -= dt;
      p.inputQueue.length = 0;
      if (p.respawn <= 0 && this.phase === "running") this.respawnPlayer(p);
      return;
    }
    if (this.phase !== "running") { p.inputQueue.length = 0; return; }

    // ——— yeniden doldurma (sunucu saatiyle) ———
    if (p.reloadTimer > 0) {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) {
        p.ammo[p.weapon] = WEAPONS[p.weapon].magazine;
        p.reloadTimer = 0; p.reloadTotal = 0;
      }
    }

    // ——— girdi kuyruğunu tüket ———
    // Zaman bütçesi: istemci gerçek zamandan daha fazla hareket satın alamaz.
    p.timeBudget = Math.min(p.timeBudget + dt * BUDGET_TOLERANCE, 0.5);
    while (p.inputQueue.length) {
      const cmd = p.inputQueue[0];
      if (cmd.dt > p.timeBudget) break;
      p.inputQueue.shift();
      p.timeBudget -= cmd.dt;
      this.applyCommand(p, cmd);
    }
  }

  applyCommand(p, cmd) {
    const dt = cmd.dt;
    p.yaw = cmd.yaw;
    p.pitch = cmd.pitch;
    p.lastSeq = cmd.seq;

    if (cmd.weapon && p.inventory.includes(cmd.weapon) && WEAPONS[cmd.weapon] && p.weapon !== cmd.weapon) {
      p.weapon = cmd.weapon;
      p.reloadTimer = 0;
    }
    if (cmd.reload && p.reloadTimer <= 0 && p.ammo[p.weapon] < WEAPONS[p.weapon].magazine) {
      p.reloadTotal = WEAPONS[p.weapon].reload;
      p.reloadTimer = p.reloadTotal;
    }

    // ——— yatay hareket (istemcideki formülün aynısı) ———
    const inputX = cmd.r;
    const inputZ = cmd.f;
    const magnitude = Math.min(1, Math.hypot(inputX, inputZ));
    const normX = magnitude ? inputX / Math.hypot(inputX, inputZ) : 0;
    const normZ = magnitude ? inputZ / Math.hypot(inputX, inputZ) : 0;
    const speed = cmd.sprint ? SPRINT_SPEED : WALK_SPEED;
    const rightX = Math.cos(p.yaw), rightZ = -Math.sin(p.yaw);
    const forwardX = -Math.sin(p.yaw), forwardZ = -Math.cos(p.yaw);
    const moveX = (rightX * normX + forwardX * normZ) * speed * magnitude * dt;
    const moveZ = (rightZ * normX + forwardZ * normZ) * speed * magnitude * dt;

    const feetY = p.y - PLAYER_HEIGHT;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(moveX), Math.abs(moveZ)) / 0.11));
    for (let i = 0; i < steps; i++) {
      const prevX = p.x;
      p.x = Math.max(-ARENA_HALF_WIDTH + 1.1, Math.min(ARENA_HALF_WIDTH - 1.1, prevX + moveX / steps));
      if (playerBlockedAt(p.x, p.z, feetY)) p.x = prevX;
      const prevZ = p.z;
      p.z = Math.max(-ARENA_HALF_DEPTH + 1.1, Math.min(ARENA_HALF_DEPTH - 1.1, prevZ + moveZ / steps));
      if (playerBlockedAt(p.x, p.z, feetY)) p.z = prevZ;
    }

    // ——— dikey hareket ———
    const supportBefore = platformHeightAt(p.x, p.z);
    if (p.grounded && Math.abs((p.y - PLAYER_HEIGHT) - supportBefore) > 0.16) p.grounded = false;
    if (cmd.jump && p.grounded) { p.velocityY = JUMP_VELOCITY; p.grounded = false; }
    const prevFeet = p.y - PLAYER_HEIGHT;
    p.velocityY -= GRAVITY * dt;
    p.y += p.velocityY * dt;
    const landing = platformHeightAt(p.x, p.z);
    const nextFeet = p.y - PLAYER_HEIGHT;
    if (p.velocityY <= 0 && nextFeet <= landing && prevFeet >= landing - 0.28) {
      p.y = PLAYER_HEIGHT + landing; p.velocityY = 0; p.grounded = true;
    } else if (p.y <= PLAYER_HEIGHT) {
      p.y = PLAYER_HEIGHT; p.velocityY = 0; p.grounded = true;
    }

    // ——— jump pad ———
    if (p.padCooldown <= 0 && p.y < 3.35) {
      const pad = JUMP_PADS.find((item) => Math.hypot(p.x - item.x, p.z - item.z) < 1.65);
      if (pad) {
        p.velocityY = JUMP_PAD_VELOCITY; p.grounded = false; p.padCooldown = 0.9;
        this.events.push({ t: "pad", id: p.id });
      }
    }

    // ——— silah pad'i ———
    const wpad = WEAPON_PADS.find((item) => Math.hypot(p.x - item.x, p.z - item.z) < 1.7);
    if (wpad && p.padCooldown <= 0) {
      const need = p.weapon !== wpad.weapon || p.ammo[wpad.weapon] < WEAPONS[wpad.weapon].magazine;
      if (need) {
        p.padCooldown = 1;
        p.ammo[wpad.weapon] = WEAPONS[wpad.weapon].magazine;
        if (!p.inventory.includes(wpad.weapon)) p.inventory.push(wpad.weapon);
        p.weapon = wpad.weapon;
        p.reloadTimer = 0;
        this.events.push({ t: "wpad", id: p.id, w: wpad.weapon });
      }
    }

    // ——— can/zırh pickup ———
    for (const pk of this.pickups) {
      if (!pk.available) continue;
      if (Math.hypot(p.x - pk.data.x, p.z - pk.data.z) > 1.5) continue;
      if (pk.data.kind === "health") {
        if (p.health >= MAX_HEALTH) continue;
        p.health = Math.min(MAX_HEALTH, p.health + pk.data.amount);
      } else {
        if (p.armor >= MAX_ARMOR) continue;
        p.armor = Math.min(MAX_ARMOR, p.armor + pk.data.amount);
      }
      pk.available = false;
      pk.respawn = PICKUP_RESPAWN;
      this.events.push({ t: "pick", id: p.id, k: pk.data.kind, i: pk.index });
    }

    // ——— ateş ———
    if (cmd.fire) this.tryFire(p);
  }

  stepPickups(dt) {
    for (const pk of this.pickups) {
      if (pk.available) continue;
      pk.respawn -= dt;
      if (pk.respawn <= 0) { pk.available = true; pk.respawn = 0; }
    }
  }

  tryFire(shooter) {
    if (!shooter.alive || this.phase !== "running") return;
    if (shooter.shotCooldown > 0 || shooter.reloadTimer > 0) return;
    const spec = WEAPONS[shooter.weapon];
    if (!spec) return;
    if (shooter.ammo[shooter.weapon] <= 0) {
      shooter.reloadTotal = spec.reload;
      shooter.reloadTimer = spec.reload;
      return;
    }

    // sunucu tarafı atış hızı limiti (istemci hilesine karşı)
    shooter.shotCooldown = spec.interval;
    shooter.ammo[shooter.weapon] -= 1;
    shooter.spawnShield = 0;   // ateş edince kalkan düşer

    const ox = shooter.x;
    const oy = shooter.y;
    const oz = shooter.z;
    let hitAny = false;

    for (let pellet = 0; pellet < spec.pellets; pellet++) {
      const spreadYaw = (Math.random() - 0.5) * spec.spread * 2;
      const spreadPitch = (Math.random() - 0.5) * spec.spread * 2;
      const yaw = shooter.yaw + spreadYaw;
      const pitch = shooter.pitch + spreadPitch;
      const dx = -Math.sin(yaw) * Math.cos(pitch);
      const dy = Math.sin(pitch);
      const dz = -Math.cos(yaw) * Math.cos(pitch);

      const wallDist = rayHitsBarrier(ox, oy, oz, dx, dy, dz, spec.range);
      let bestT = Math.min(wallDist, spec.range);
      let victim = null;

      for (const target of this.players.values()) {
        if (target.id === shooter.id || !target.alive) continue;
        if (target.spawnShield > 0) continue;
        const t = this.rayHitsPlayer(ox, oy, oz, dx, dy, dz, target, bestT);
        if (t !== null && t < bestT) { bestT = t; victim = target; }
      }

      if (victim) {
        hitAny = true;
        this.damage(victim, shooter, spec.damage);
      }
    }

    this.events.push({ t: "shot", id: shooter.id, w: shooter.weapon, hit: hitAny });
  }

  // ışın–silindir(kapsül yaklaşık) kesişimi
  rayHitsPlayer(ox, oy, oz, dx, dy, dz, target, maxT) {
    const cx = target.x;
    const cz = target.z;
    const footY = target.y - PLAYER_HEIGHT;
    const topY = footY + PLAYER_HEIGHT;

    const mx = ox - cx;
    const mz = oz - cz;
    const a = dx * dx + dz * dz;
    if (a < 1e-8) return null;
    const b = 2 * (mx * dx + mz * dz);
    const c = mx * mx + mz * mz - HIT_RADIUS * HIT_RADIUS;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = (-b - sq) / (2 * a);
    if (t < 0) t = (-b + sq) / (2 * a);
    if (t < 0 || t > maxT) return null;
    const hitY = oy + dy * t;
    if (hitY < footY || hitY > topY + 0.15) return null;
    return t;
  }

  damage(victim, shooter, amount) {
    if (!victim.alive || victim.spawnShield > 0) return;
    let remaining = amount;
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, remaining * 0.6);
      victim.armor -= absorbed;
      remaining -= absorbed;
    }
    victim.health -= remaining;
    this.events.push({
      t: "hurt", id: victim.id, by: shooter.id,
      ax: shooter.x, az: shooter.z,
    });
    if (victim.health <= 0) {
      victim.health = 0;
      victim.alive = false;
      victim.deaths += 1;
      victim.respawn = RESPAWN_SECONDS;
      shooter.score += 1;
      this.events.push({ t: "kill", killer: shooter.name, victim: victim.name, kid: shooter.id, vid: victim.id });
    }
  }

  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id, n: p.name,
        x: round2(p.x), y: round2(p.y), z: round2(p.z),
        yaw: round3(p.yaw), pitch: round3(p.pitch),
        h: Math.round(p.health), a: Math.round(p.armor),
        al: p.alive ? 1 : 0, s: p.score, d: p.deaths,
        w: p.weapon, sh: p.spawnShield > 0 ? 1 : 0,
        am: p.ammo[p.weapon], rl: p.reloadTimer > 0 ? 1 : 0,
        seq: p.lastSeq,
      });
    }
    const snap = {
      t: "state",
      phase: this.phase,
      time: Math.round(this.timeLeft * 10) / 10,
      players,
      pickups: this.pickups.map((pk) => (pk.available ? 1 : 0)),
      events: this.events,
      winner: this.winner,
    };
    this.events = [];
    return snap;
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
