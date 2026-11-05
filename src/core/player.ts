import { BUILDING_CLIMB, type Colliders, type Segment } from "./collision";
import type { HeightField } from "../data/types";
import { holdShore, onDeck, WADE_DEPTH } from "./shore";

/** Piéton : logique pure. Repère : x est, y nord, z haut ; cap 0 = nord, sens horaire (comme le soleil). */

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  /** Direction du regard du corps, radians. */
  heading: number;
  /** Vitesse horizontale (m/s). */
  speed: number;
  /** Phase de la marche (radians), pour l'animation. */
  stride: number;
  /** Vitesse verticale (m/s, positive vers le haut) et en l'air (saut ou chute). */
  vz: number;
  air: boolean;
  /** Plus haute altitude du vol en cours (m), pour la hauteur de chute. */
  peak: number;
  /** Hauteur de la dernière chute à l'atterrissage (m), remise à zéro par l'appelant. */
  landed: number;
  /** Escalade en cours, ou null. */
  climb: Climb | null;
}

/** Escalade d'une grille, d'un muret ou d'une haie : le personnage monte au pied de l'obstacle, passe par-dessus, puis se laisse retomber. */
export interface Climb {
  /** Position au pied de l'obstacle, direction de franchissement (unitaire, vers l'autre côté), altitude du sommet (m). */
  x: number;
  y: number;
  dx: number;
  dy: number;
  top: number;
  /** Phase : montée (faux) puis passage par-dessus (vrai), et temps passé dans le passage (s). */
  over: boolean;
  t: number;
}

export interface MoveInput {
  /** Avant (+1) / arrière (-1) par rapport à la caméra. */
  forward: number;
  /** Droite (+1) / gauche (-1). */
  right: number;
  /** Course : vitesse maximale au lieu de la marche. */
  run: boolean;
  /** Bouton de saut pressé à ce pas (pas tenu : un appui, un saut). */
  jump?: boolean;
  /** En visée (D205) : le corps reste tourné vers ce cap (rad) au lieu de suivre la marche ; on se déplace en pas de côté et à reculons. */
  face?: number | undefined;
}

export const PLAYER_RADIUS = 0.35;
export const WALK_SPEED = 2.0;
export const RUN_SPEED = 5.0;
const ACCEL = 14;
const FRICTION = 16;
const TURN_RATE = 12;

/** Gravité à pied (m/s²) : plus forte que la vraie (arcade), le saut est vif au lieu de flotter. */
export const FOOT_GRAVITY = 22;
/** Hauteur d'un saut (m), et des pieds repliés au sommet : on passe par-dessus ce qui est moins haut que JUMP_CLEAR (murets, haies basses). */
export const JUMP_HEIGHT = 1.1;
const TUCK = 0.3;
export const JUMP_CLEAR = JUMP_HEIGHT + TUCK;
const JUMP_SPEED = Math.sqrt(2 * FOOT_GRAVITY * JUMP_HEIGHT);
/**
 * Saut long (D218) : à plus de `LONG_JUMP_FROM` de la vitesse de course, la vitesse horizontale passe à `LONG_JUMP_SPEED` (m/s) au départ du
 * saut ; sur le plat, il porte à environ 4,7 m (3,2 m pour un saut ordinaire en courant).
 */
export const LONG_JUMP_SPEED = 7.4;
const LONG_JUMP_FROM = 0.9;
/** En l'air, on infléchit à peine sa course (m/s²). */
const AIR_ACCEL = 5;
/** Escalade : vitesse de montée (m/s), durée du passage par-dessus (s), distance franchie (m, d'un côté à l'autre de l'obstacle). */
export const CLIMB_SPEED = 2.4;
const OVER_TIME = 0.3;
const CROSS = 2 * PLAYER_RADIUS + 0.12;
/** Au sol, une descente plus raide que ce décrochement (m, plus 1,2 m par mètre parcouru) fait tomber : bord d'un quai, d'une falaise. */
const SNAP = 0.25;

export function createPlayer(x: number, y: number, terrain: HeightField, heading = 0): PlayerState {
  const z = terrain.heightAt(x, y);
  return { x, y, z, vx: 0, vy: 0, heading, speed: 0, stride: 0, vz: 0, air: false, peak: z, landed: 0, climb: null };
}

/** Repose le piéton au sol, sans vol ni escalade (après une téléportation, une descente de véhicule). */
export function groundPlayer(p: PlayerState): void {
  p.vz = 0;
  p.air = false;
  p.peak = p.z;
  p.landed = 0;
  p.climb = null;
}

function angleDelta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/** Fait avancer le piéton de `dt` secondes ; `camYaw` oriente « avant » et « droite ». */
export function stepPlayer(p: PlayerState, input: MoveInput, camYaw: number, dt: number, terrain: HeightField, colliders: Colliders): void {
  if (p.climb) {
    climbStep(p, p.climb, dt);
    return;
  }
  const mag = Math.min(Math.hypot(input.forward, input.right), 1);
  const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  // Avant = (sin, cos) ; droite = (cos, -sin).
  const dirX = input.forward * sin + input.right * cos;
  const dirY = input.forward * cos - input.right * sin;
  const len = Math.hypot(dirX, dirY);
  const top = input.run ? RUN_SPEED : WALK_SPEED;
  // En l'air, on infléchit sa course sans perdre l'élan d'un saut long (D218).
  const targetSpeed = p.air ? Math.max(mag * top, Math.hypot(p.vx, p.vy)) : mag * top;
  const tx = len > 1e-6 ? (dirX / len) * targetSpeed : 0;
  const ty = len > 1e-6 ? (dirY / len) * targetSpeed : 0;

  // Accélération vers la vitesse visée, frottement quand on lâche ; en l'air, on garde son élan et l'on ne fait que l'infléchir.
  if (!p.air || mag > 0.01) {
    const rate = p.air ? AIR_ACCEL : mag > 0.01 ? ACCEL : FRICTION;
    const dvx = tx - p.vx, dvy = ty - p.vy;
    const dv = Math.hypot(dvx, dvy);
    const maxDv = rate * dt;
    if (dv <= maxDv) {
      p.vx = tx;
      p.vy = ty;
    } else {
      p.vx += (dvx / dv) * maxDv;
      p.vy += (dvy / dv) * maxDv;
    }
  }

  // Saut, puis chute libre tant qu'on est en l'air.
  if (input.jump && !p.air) {
    p.air = true;
    p.vz = JUMP_SPEED;
    p.peak = p.z;
    // Saut long (D218) : en pleine course, l'élan porte plus loin (même hauteur : on ne franchit rien de plus haut qu'avant).
    const v = Math.hypot(p.vx, p.vy);
    if (input.run && v >= LONG_JUMP_FROM * RUN_SPEED) {
      p.vx *= LONG_JUMP_SPEED / v;
      p.vy *= LONG_JUMP_SPEED / v;
    }
  }
  let z = p.z;
  if (p.air) {
    z += p.vz * dt - 0.5 * FOOT_GRAVITY * dt * dt;
    p.vz -= FOOT_GRAVITY * dt;
  }

  let x = p.x + p.vx * dt, y = p.y + p.vy * dt;
  // En l'air, les murets, clôtures et haies plus bas que les pieds (repliés) ne gênent pas.
  const clear = p.air ? Math.max(0, z - terrain.heightAt(x, y, z)) + TUCK : 0;
  // Altitude des pieds (D215) : sur un toit, on passe le bord et les murs mitoyens pas plus hauts ; de la rue, les murs restent des murs.
  const r = colliders.resolve(x, y, PLAYER_RADIUS, clear, z);
  x = r.x;
  y = r.y;
  if (r.hit) {
    // On glisse le long de l'obstacle : on retire la part de vitesse qui entre dedans.
    const into = p.vx * r.nx + p.vy * r.ny;
    if (into < 0) {
      p.vx -= into * r.nx;
      p.vy -= into * r.ny;
    }
    // Contre une grille ou un muret qu'on pousse : un appui sur Sauter (ou l'obstacle attrapé en retombant d'un saut) fait escalader.
    const push = len > 1e-6 ? -(dirX * r.nx + dirY * r.ny) / len : 0;
    if (r.wall !== undefined && r.wall >= 0 && mag > 0.3 && push > 0.5 && (input.jump || (p.air && p.vz < 0)) && climbable(colliders.segments[r.wall]!, x, y, terrain.heightAt(x, y, p.z))) {
      startClimb(p, colliders.segments[r.wall]!, x, y, Math.max(z, p.z), terrain);
      return;
    }
  }
  // Limites du monde (3 m de marge), puis l'eau (mer, D105, et eau de la ville, D240) : on y entre jusqu'à la taille, pas plus loin.
  x = Math.min(Math.max(x, terrain.xMin + 3), terrain.xMax - 3);
  y = Math.min(Math.max(y, terrain.yMin + 3), terrain.yMax - 3);
  const shore = holdShore(terrain, p.x, p.y, x, y, WADE_DEPTH, p.z);
  if (shore.blocked) {
    if (shore.x === p.x) p.vx = 0;
    if (shore.y === p.y) p.vy = 0;
  }
  const px = p.x, py = p.y;
  p.x = shore.x;
  p.y = shore.y;
  const ground = terrain.heightAt(p.x, p.y, p.air ? z : p.z);
  if (p.air) {
    if (z <= ground) {
      // Atterrissage : la hauteur de chute part du plus haut point du vol.
      p.landed = Math.max(0, p.peak - ground);
      z = ground;
      p.air = false;
      p.vz = 0;
    } else p.peak = Math.max(p.peak, z);
  } else if (ground < p.z - SNAP - Math.hypot(p.vx, p.vy) * dt * 1.2 && !onDeck(terrain, px, py, p.z)) {
    // Le sol se dérobe (bord d'un mur, d'une falaise) : on tombe au lieu de le suivre ; pas au bout d'un pont, qui rejoint mal la chaussée.
    p.air = true;
    p.vz = 0;
    p.peak = p.z;
  } else z = ground;
  p.z = z;
  p.speed = Math.hypot(p.vx, p.vy);
  if (input.face !== undefined) p.heading += angleDelta(p.heading, input.face) * Math.min(1, TURN_RATE * 1.5 * dt);
  else if (p.speed > 0.15) {
    const target = Math.atan2(p.vx, p.vy);
    p.heading += angleDelta(p.heading, target) * Math.min(1, TURN_RATE * dt);
  }
  if (!p.air) p.stride += p.speed * dt * 2.2;
}

/** Altitude du haut d'un mur de bâtiment au point de `seg` le plus proche de (x, y) (D218). */
function wallTop(seg: Segment, x: number, y: number): number {
  const sx = seg.bx - seg.ax, sy = seg.by - seg.ay;
  const t = Math.min(Math.max(((x - seg.ax) * sx + (y - seg.ay) * sy) / (sx * sx + sy * sy), 0), 1);
  return seg.topA! + t * (seg.topB! - seg.topA!);
}

/**
 * Un mur de bâtiment s'escalade s'il ne dépasse pas de plus de `BUILDING_CLIMB` le sol (ou le toit) d'où l'on part, `base` (D218) :
 * mesuré depuis là, pas depuis les pieds en l'air (sans quoi un saut ferait attraper un mur de 3,6 m). Muret, grille : leur règle (`climb`).
 */
function climbable(seg: Segment, x: number, y: number, base: number): boolean {
  return seg.topA === undefined || wallTop(seg, x, y) - base <= BUILDING_CLIMB;
}

/** Commence l'escalade de l'obstacle `seg` touché en (x, y), à l'altitude `z`. */
function startClimb(p: PlayerState, seg: Segment, x: number, y: number, z: number, terrain: HeightField): void {
  const sx = seg.bx - seg.ax, sy = seg.by - seg.ay;
  const t = Math.min(Math.max(((x - seg.ax) * sx + (y - seg.ay) * sy) / (sx * sx + sy * sy), 0), 1);
  const ex = x - (seg.ax + t * sx), ey = y - (seg.ay + t * sy);
  const d = Math.hypot(ex, ey) || 1;
  const base = terrain.heightAt(x, y, p.z);
  // Mur de bâtiment (D218) : son haut est une altitude absolue (le long du segment) ; muret, grille : une hauteur au-dessus du sol.
  const top = seg.topA !== undefined ? wallTop(seg, x, y) : base + (seg.height ?? 0);
  p.climb = { x, y, dx: -ex / d, dy: -ey / d, top, over: false, t: 0 };
  p.x = x;
  p.y = y;
  p.z = Math.max(z, base);
  p.vx = p.vy = p.vz = 0;
  p.speed = 0;
  p.air = false;
  p.heading = Math.atan2(-ex, -ey);
}

/** Escalade : on monte au pied de l'obstacle, on passe par-dessus, puis on se laisse retomber de l'autre côté. */
function climbStep(p: PlayerState, c: Climb, dt: number): void {
  if (!c.over) {
    p.z = Math.min(c.top, p.z + CLIMB_SPEED * dt);
    if (p.z >= c.top) c.over = true;
    return;
  }
  c.t += dt;
  const k = Math.min(1, c.t / OVER_TIME);
  p.x = c.x + c.dx * CROSS * k;
  p.y = c.y + c.dy * CROSS * k;
  p.z = c.top + 0.12 * Math.sin(Math.PI * k);
  if (k < 1) return;
  p.climb = null;
  p.air = true;
  p.vz = 0;
  p.peak = p.z;
  p.vx = c.dx * 1.2;
  p.vy = c.dy * 1.2;
}

/** Dénivelé (m) qui arrête une glissade au sol : le bord d'un toit, d'un quai. */
const CLIFF = 0.6;

/** Glissade au sol après une chute (D98) : décélération (m/s², pilote qui frotte sur la chaussée, ≈ 0,7 g). */
export const SLIDE_DECEL = 7;

/** Pilote tombé : il glisse dans le sens de sa vitesse jusqu'à l'arrêt, le long des obstacles, sans tourner ni marcher. */
export function slidePlayer(p: PlayerState, dt: number, terrain: HeightField, colliders: Colliders): void {
  const v = Math.hypot(p.vx, p.vy);
  const k = v > 0 ? Math.max(v - SLIDE_DECEL * dt, 0) / v : 0;
  p.vx *= k;
  p.vy *= k;
  const r = colliders.resolve(p.x + p.vx * dt, p.y + p.vy * dt, PLAYER_RADIUS, 0, p.z);
  if (r.hit) {
    const into = p.vx * r.nx + p.vy * r.ny;
    if (into < 0) {
      p.vx -= into * r.nx;
      p.vy -= into * r.ny;
    }
  }
  const shore = holdShore(terrain, p.x, p.y, Math.min(Math.max(r.x, terrain.xMin + 3), terrain.xMax - 3), Math.min(Math.max(r.y, terrain.yMin + 3), terrain.yMax - 3), WADE_DEPTH, p.z);
  // Au bord d'un toit (D215), on s'arrête au lieu de passer d'un coup dans la rue.
  const z = terrain.heightAt(shore.x, shore.y, p.z);
  if (z < p.z - CLIFF && !onDeck(terrain, p.x, p.y, p.z)) {
    p.vx = p.vy = 0;
  } else {
    p.x = shore.x;
    p.y = shore.y;
    p.z = z;
  }
  p.speed = 0;
  p.air = false;
  p.vz = 0;
}
