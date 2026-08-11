// Vector Strike — ARENA VE OYUN SABİTLERİ
// Bu dosya hem tarayıcı istemcisi hem de otoriter sunucu tarafından kullanılır.
// Buradaki sayılar iki tarafta AYNI olmak zorundadır; yoksa client prediction
// ile sunucu simülasyonu birbirinden ayrışır.

export const TARGET_SCORE = 25;
export const ROUND_SECONDS = 150;
export const SPAWN_SHIELD_SECONDS = 3;
export const PLAYER_HEIGHT = 1.72;
export const PLAYER_RADIUS = 0.42;
export const ARENA_HALF_WIDTH = 24;
export const ARENA_HALF_DEPTH = 36;

export const WALK_SPEED = 7.5;
export const SPRINT_SPEED = 10.8;
export const GRAVITY = 22;
export const JUMP_VELOCITY = 8.2;
export const JUMP_PAD_VELOCITY = 20.5;
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;

export const WEAPON_KEYS = ["rifle", "shotgun", "smg", "marksman"];

export const WEAPONS = {
  rifle:    { damage: 21, pellets: 1, spread: 0.009, interval: 0.105, magazine: 30, reload: 1.35, range: 60 },
  shotgun:  { damage: 12, pellets: 9, spread: 0.075, interval: 0.7,   magazine: 6,  reload: 1.7,  range: 60 },
  smg:      { damage: 14, pellets: 1, spread: 0.016, interval: 0.065, magazine: 40, reload: 1.2,  range: 60 },
  marksman: { damage: 54, pellets: 1, spread: 0.003, interval: 0.42,  magazine: 10, reload: 1.85, range: 60 },
};

export const BARRIERS = [
  { x: 0, z: -36, width: 49, depth: 1, height: 4 },
  { x: 0, z: 36, width: 49, depth: 1, height: 4 },
  { x: -24, z: 0, width: 1, depth: 73, height: 4 },
  { x: 24, z: 0, width: 1, depth: 73, height: 4 },
  { x: -10.5, z: -25, width: 10, depth: 2.2, height: 2.55, rotation: -0.48 },
  { x: 10.5, z: -24.5, width: 8.4, depth: 2, height: 2.55, rotation: 0.38 },
  { x: 14, z: -21.8, width: 2, depth: 6.2, height: 2.55, rotation: -0.12 },
  { x: -11, z: -9, width: 7.5, depth: 6.7, height: 2.8, rotation: 0.08 },
  { x: 0, z: -8, width: 5.5, depth: 5.5, height: 0.34, rotation: 0.15, shape: "triangle", collidable: false },
  { x: 13.2, z: -6.5, width: 6.6, depth: 7.1, height: 2.8, rotation: -0.06 },
  { x: 10.5, z: 14, width: 5.8, depth: 5.8, height: 2.35, rotation: -0.18, shape: "triangle" },
  { x: -4, z: 26, width: 7.2, depth: 6, height: 2.65, rotation: 0.06 },
];

export const JUMP_PADS = [
  { x: 16, z: -16 },
  { x: 0, z: -8, y: 0.36 },
  { x: -13, z: 3 },
];

export const WEAPON_PADS = [
  { x: -1, z: -19, weapon: "shotgun" },
  { x: 15, z: 7, weapon: "rifle" },
  { x: -12, z: 18, weapon: "smg" },
  { x: 7.5, z: 26, weapon: "marksman" },
];

export const PICKUP_PADS = [
  { x: -18, z: -2, kind: "health", amount: 45 },
  { x: 18, z: 19, kind: "health", amount: 45 },
  { x: 2.2, z: -19, kind: "armor", amount: 55 },
  { x: 12, z: 7, kind: "armor", amount: 55 },
  { x: -15, z: 18, kind: "armor", amount: 55 },
];

export const SPAWNS = [
  { x: 0, z: 32, yaw: Math.PI },
  { x: 0, z: -32, yaw: 0 },
  { x: -20, z: -18, yaw: -Math.PI / 2 },
  { x: 20, z: 14, yaw: Math.PI / 2 },
  { x: -19, z: 18, yaw: -Math.PI / 2 },
  { x: 19, z: -29, yaw: Math.PI / 2 },
];

// ——— paylaşılan geometri yardımcıları ———

export function collidesWithBarrier(x, z, radius, barrier) {
  if (barrier.collidable === false) return false;
  // Üçgen bloklar ekranda üçgen prizma olarak çizilir; kare çarpışma kutusu
  // kullanmak köşelerde GÖRÜNMEZ DUVAR yaratıyordu. Onun yerine dairesel test.
  if (barrier.shape === "triangle") {
    const r = (Math.max(barrier.width, barrier.depth) / 2) * 0.66;
    return Math.hypot(x - barrier.x, z - barrier.z) < r + radius;
  }
  const rotation = barrier.rotation ?? 0;
  const cosine = Math.cos(-rotation);
  const sine = Math.sin(-rotation);
  const dx = x - barrier.x;
  const dz = z - barrier.z;
  const localX = dx * cosine - dz * sine;
  const localZ = dx * sine + dz * cosine;
  return Math.abs(localX) < barrier.width / 2 + radius && Math.abs(localZ) < barrier.depth / 2 + radius;
}

export function platformHeightAt(x, z) {
  let height = 0;
  for (let i = 4; i < BARRIERS.length; i++) {
    const barrier = BARRIERS[i];
    if (barrier.collidable === false) continue;
    const supportMargin = PLAYER_RADIUS * 0.55;
    if (barrier.shape === "triangle") {
      const r = (Math.max(barrier.width, barrier.depth) / 2) * 0.66;
      if (Math.hypot(x - barrier.x, z - barrier.z) < r + supportMargin) {
        height = Math.max(height, barrier.height);
      }
      continue;
    }
    const rotation = barrier.rotation ?? 0;
    const cosine = Math.cos(-rotation);
    const sine = Math.sin(-rotation);
    const dx = x - barrier.x;
    const dz = z - barrier.z;
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    if (Math.abs(localX) < barrier.width / 2 + supportMargin && Math.abs(localZ) < barrier.depth / 2 + supportMargin) {
      height = Math.max(height, barrier.height);
    }
  }
  return height;
}

export function playerBlockedAt(x, z, feetY) {
  return BARRIERS.some((barrier) => collidesWithBarrier(x, z, PLAYER_RADIUS, barrier) && feetY < barrier.height - 0.12);
}

// Işın ile engel kesişimi — sunucu tarafı atış doğrulaması için.
// Eksen hizalı olmayan kutuları yerel uzaya döndürüp slab testi uygular.
export function rayHitsBarrier(ox, oy, oz, dx, dy, dz, maxDist) {
  let nearest = Infinity;
  for (const barrier of BARRIERS) {
    if (barrier.collidable === false) continue;
    // üçgenler: yaklaşık daire — çizilen şekle uyar, hayalet duvar bırakmaz
    const effW = barrier.shape === "triangle" ? Math.max(barrier.width, barrier.depth) * 0.66 : barrier.width;
    const effD = barrier.shape === "triangle" ? Math.max(barrier.width, barrier.depth) * 0.66 : barrier.depth;
    const rotation = barrier.rotation ?? 0;
    const cosine = Math.cos(-rotation);
    const sine = Math.sin(-rotation);
    const rx = ox - barrier.x;
    const rz = oz - barrier.z;
    const localOx = rx * cosine - rz * sine;
    const localOz = rx * sine + rz * cosine;
    const localDx = dx * cosine - dz * sine;
    const localDz = dx * sine + dz * cosine;

    const hw = effW / 2;
    const hd = effD / 2;
    let tmin = 0;
    let tmax = maxDist;

    const slab = (origin, dir, min, max) => {
      if (Math.abs(dir) < 1e-8) return origin >= min && origin <= max;
      const t1 = (min - origin) / dir;
      const t2 = (max - origin) / dir;
      const lo = Math.min(t1, t2);
      const hi = Math.max(t1, t2);
      tmin = Math.max(tmin, lo);
      tmax = Math.min(tmax, hi);
      return tmax >= tmin;
    };

    if (!slab(localOx, localDx, -hw, hw)) continue;
    if (!slab(localOz, localDz, -hd, hd)) continue;
    if (!slab(oy, dy, 0, barrier.height)) continue;
    if (tmin >= 0 && tmin < nearest) nearest = tmin;
  }
  return nearest;
}
