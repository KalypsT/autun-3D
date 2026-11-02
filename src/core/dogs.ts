/**
 * Chiens (D199) : d'abord des chiens en laisse, qui suivent leur maître avec un peu de retard et de flânerie (ils reniflent, s'arrêtent,
 * repartent au trot) ; le même modèle servira aux chiens seuls (lot 2-3) et au geste « caresser » (lot 3). Logique pure : le rendu lit
 * `x`, `y`, `heading`, `speed`, `pose`.
 *
 * Analogie : un cerf-volant au bout d'un fil : il va où il veut, tant que le fil (la laisse, 2 m) le permet.
 */

/** Ce que les chiens savent d'un maître : position, cap (rad, 0 = nord, sens horaire), vitesse (m/s), assis, en fuite. */
export interface DogOwner {
  x: number;
  y: number;
  heading: number;
  speed: number;
  sitting: boolean;
  fleeing: boolean;
}

export const DOG_POSE = { walk: 0, sniff: 1, sit: 2 } as const;

/** Longueur de la laisse (m), écart préféré derrière et à côté du maître (m). */
export const LEASH = 2.0;
const BEHIND = 0.7, SIDE = 0.55;

export interface Dog {
  /** Identifiant du maître (graine du passant) et son emplacement dans la foule. */
  owner: number;
  slot: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Phase du trot (rad) et pose (`DOG_POSE`). */
  phase: number;
  pose: number;
  /** Taille (0,7 petit à 1,25 grand), couleur du pelage (0 à 5), côté préféré (−1 gauche, 1 droite). */
  size: number;
  coat: number;
  side: number;
  /** Flânerie : point d'intérêt (renifler) et temps restant. */
  sniffT: number;
  sniffX: number;
  sniffY: number;
  /** Graine propre du chien (tirages). */
  rng: number;
}

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number): number => ((((a - b) % TAU) + 3 * Math.PI) % TAU) - Math.PI;

function next(d: Dog): number {
  d.rng = (d.rng + 0x6d2b79f5) >>> 0;
  let t = d.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Un chien pour le maître de graine `owner`, à côté de lui. Taille et pelage tirés de la graine (le même maître a toujours le même chien). */
export function createDog(owner: number, slot: number, o: DogOwner): Dog {
  const d: Dog = { owner, slot, x: 0, y: 0, heading: o.heading, speed: 0, phase: 0, pose: DOG_POSE.walk, size: 1, coat: 0, side: 1, sniffT: 0, sniffX: 0, sniffY: 0, rng: owner ^ 0x0d06 };
  d.size = 0.7 + next(d) * 0.55;
  d.coat = Math.floor(next(d) * 6);
  d.side = next(d) < 0.5 ? -1 : 1;
  const [tx, ty] = anchor(d, o);
  d.x = tx;
  d.y = ty;
  return d;
}

/** Où le chien aime être : un peu derrière et à côté de son maître. */
function anchor(d: Dog, o: DogOwner): [number, number] {
  const fx = Math.sin(o.heading), fy = Math.cos(o.heading);
  return [o.x - fx * BEHIND + fy * SIDE * d.side, o.y - fy * BEHIND - fx * SIDE * d.side];
}

/**
 * Un pas de `dt` s : le chien va vers sa place (ou vers ce qu'il renifle), au pas, au trot ou au galop selon l'écart ; la laisse le
 * ramène s'il s'éloigne de plus de `LEASH`. Maître assis : le chien se couche à ses pieds ; en fuite : il court avec lui, sans flâner.
 */
export function stepDog(d: Dog, o: DogOwner, dt: number): void {
  let [tx, ty] = anchor(d, o);
  if (o.sitting) {
    // Assis à ses pieds, devant lui.
    tx = o.x + Math.sin(o.heading) * 0.75 + Math.cos(o.heading) * 0.2 * d.side;
    ty = o.y + Math.cos(o.heading) * 0.75 - Math.sin(o.heading) * 0.2 * d.side;
    d.sniffT = 0;
  } else if (!o.fleeing) {
    // Flânerie : de temps en temps, il s'arrête renifler un point à côté (tant que la laisse le permet).
    if (d.sniffT > 0) {
      d.sniffT -= dt;
      tx = d.sniffX;
      ty = d.sniffY;
    } else if (next(d) < dt * 0.25) {
      const a = o.heading + (next(d) - 0.5) * 2.4;
      d.sniffX = o.x + Math.sin(a) * (1 + next(d) * 0.8);
      d.sniffY = o.y + Math.cos(a) * (1 + next(d) * 0.8);
      d.sniffT = 1 + next(d) * 2.5;
    }
  } else d.sniffT = 0;
  const dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy);
  // Allure : il rattrape l'écart (au plus 6 m/s), et s'arrête net quand il y est.
  const want = dist < 0.08 ? 0 : Math.min(6, Math.max(o.speed, 0.6) * (dist > 0.6 ? 1.6 : 1) + dist * 1.5);
  d.speed += (want - d.speed) * Math.min(1, dt * 6);
  if (dist > 1e-3) {
    const step = Math.min(dist, d.speed * dt);
    d.x += (dx / dist) * step;
    d.y += (dy / dist) * step;
    if (d.speed > 0.15) d.heading += angleDiff(Math.atan2(dx, dy), d.heading) * Math.min(1, dt * 8);
  }
  // La laisse : jamais plus de `LEASH` du maître.
  const lx = d.x - o.x, ly = d.y - o.y, l = Math.hypot(lx, ly);
  if (l > LEASH) {
    d.x = o.x + (lx / l) * LEASH;
    d.y = o.y + (ly / l) * LEASH;
  }
  if (o.sitting && dist < 0.2) {
    d.pose = DOG_POSE.sit;
    d.heading += angleDiff(o.heading + Math.PI, d.heading) * Math.min(1, dt * 4);
    d.speed = 0;
  } else d.pose = d.sniffT > 0 && dist < 0.3 ? DOG_POSE.sniff : DOG_POSE.walk;
  // Trot : quatre pattes, une foulée d'environ 0,55 m × taille.
  d.phase = (d.phase + (d.speed / (0.55 * d.size)) * Math.PI * dt) % TAU;
}
