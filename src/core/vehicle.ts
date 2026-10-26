import type { Terrain } from "../data/terrain";
import type { Colliders } from "./collision";

/**
 * Véhicules : logique pure. Modèle « bicyclette » dynamique (deux essieux, pneus à rigidité de dérive
 * bornée par l'adhérence), qui passe au modèle géométrique à très basse vitesse où le premier est instable.
 * Repère : x est, y nord ; cap 0 = nord, sens horaire. Vitesse latérale comptée vers la droite,
 * vitesse de lacet dans le sens horaire, braquage positif à droite (symétrique du repère usuel, mêmes équations).
 */

export interface VehicleSpec {
  /** Masse totale avec le conducteur (kg). */
  mass: number;
  /** Moment d'inertie en lacet (kg·m²). */
  yawInertia: number;
  /** Distance du centre de gravité à l'essieu avant et arrière (m). */
  front: number;
  rear: number;
  /** Braquage maximal à l'arrêt (rad), réduit avec la vitesse : max / (1 + (v / steerFade)²). */
  maxSteer: number;
  steerFade: number;
  /** Vitesse de rotation du guidon ou du volant (rad/s). */
  steerRate: number;
  /** Rigidité de dérive des pneus avant et arrière (N/rad). */
  corneringFront: number;
  corneringRear: number;
  /** Coefficient d'adhérence. */
  grip: number;
  /** Puissance (W) et force de traction maximales (N) ; la traction s'annule entre driveFadeFrom et topSpeed (m/s). */
  power: number;
  maxDrive: number;
  driveFadeFrom: number;
  topSpeed: number;
  /** Force de freinage maximale (N). */
  maxBrake: number;
  /** Marche arrière : vitesse maximale (m/s) et force (N). */
  reverseSpeed: number;
  reverseForce: number;
  /** Résistance au roulement (coefficient) et traînée (½ ρ S Cx, en kg/m). */
  rolling: number;
  drag: number;
  /** Emprise au sol : cercles le long de l'axe (décalage vers l'avant depuis le centre de gravité, rayon). */
  hull: readonly (readonly [number, number])[];
  /** Restitution et frottement lors d'un choc. */
  restitution: number;
  impactFriction: number;
  /** Rayon des roues (m), pour l'animation. */
  wheelRadius: number;
  /** Penche dans les virages (deux-roues). */
  leans: boolean;
}

export const GRAVITY = 9.81;

/** Vélo de ville avec son cycliste : ≈ 250 W de pédalage, on ne pédale plus au-delà de 27 km/h. */
export const BIKE: VehicleSpec = {
  mass: 92,
  yawInertia: 22,
  front: 0.62,
  rear: 0.46,
  maxSteer: 0.6,
  steerFade: 3.6,
  steerRate: 2.4,
  corneringFront: 1100,
  corneringRear: 1300,
  grip: 0.85,
  power: 250,
  maxDrive: 260,
  driveFadeFrom: 22 / 3.6,
  topSpeed: 27 / 3.6,
  maxBrake: 620,
  reverseSpeed: 1.2,
  reverseForce: 90,
  rolling: 0.006,
  drag: 0.3,
  hull: [[0.42, 0.3], [-0.38, 0.3]],
  restitution: 0.15,
  impactFriction: 0.35,
  wheelRadius: 0.34,
  leans: true,
};

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Vitesse dans le monde (m/s). */
  vx: number;
  vy: number;
  /** Vitesse de lacet (rad/s, sens horaire). */
  yawRate: number;
  /** Braquage courant (rad, positif à droite). */
  steer: number;
  /** Tangage (rad, positif nez en haut) et inclinaison (rad, positif vers la droite). */
  pitch: number;
  lean: number;
  /** Rotation des roues (rad) et vitesse longitudinale signée (m/s). */
  wheel: number;
  speed: number;
  /** Dernier choc : vitesse d'impact (m/s), remise à zéro par l'appelant. */
  impact: number;
}

export interface DriveInput {
  /** Accélérateur 0-1. */
  throttle: number;
  /** Frein 0-1 ; à l'arrêt, il fait reculer. */
  brake: number;
  /** Direction -1 (gauche) à 1 (droite). */
  steer: number;
}

export function createVehicle(x: number, y: number, heading: number, terrain: Terrain): VehicleState {
  return { x, y, z: terrain.heightAt(x, y), heading, vx: 0, vy: 0, yawRate: 0, steer: 0, pitch: 0, lean: 0, wheel: 0, speed: 0, impact: 0 };
}

const SUBSTEPS = 2;
/** En dessous, modèle géométrique pur ; au-dessus de KIN_HIGH, modèle dynamique pur. */
const KIN_LOW = 1.5;
const KIN_HIGH = 4;
/** Vitesse (1/s) à laquelle les pneus ramènent le véhicule vers le modèle géométrique. */
const KIN_RATE = 10;

/** Force motrice disponible à la vitesse u (m/s) pour un accélérateur 0-1. */
export function driveForce(spec: VehicleSpec, u: number, throttle: number): number {
  if (throttle <= 0) return 0;
  const v = Math.max(u, 0);
  let f = Math.min(spec.maxDrive, spec.power / Math.max(v, 0.5));
  if (v > spec.driveFadeFrom) f *= Math.max(0, (spec.topSpeed - v) / (spec.topSpeed - spec.driveFadeFrom));
  return f * throttle;
}

/** Braquage maximal à la vitesse u. */
export function steerLimit(spec: VehicleSpec, u: number): number {
  return spec.maxSteer / (1 + (u / spec.steerFade) ** 2);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fait avancer le véhicule de `dt` secondes : forces, pneus, relief, puis chocs contre les obstacles. */
export function stepVehicle(s: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number, terrain: Terrain, colliders: Colliders): void {
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) integrate(s, spec, input, h, terrain);
  collide(s, spec, colliders);
  // Limites du monde (3 m de marge).
  const x = clamp(s.x, terrain.xMin + 3, terrain.xMax - 3), y = clamp(s.y, terrain.yMin + 3, terrain.yMax - 3);
  if (x !== s.x) s.vx = 0;
  if (y !== s.y) s.vy = 0;
  s.x = x;
  s.y = y;
  // Hauteur et tangage : moyenne et pente entre les deux essieux.
  const fx = Math.sin(s.heading), fy = Math.cos(s.heading);
  const zf = terrain.heightAt(s.x + fx * spec.front, s.y + fy * spec.front);
  const zr = terrain.heightAt(s.x - fx * spec.rear, s.y - fy * spec.rear);
  s.z = (zf * spec.rear + zr * spec.front) / (spec.front + spec.rear);
  s.pitch = Math.atan2(zf - zr, spec.front + spec.rear);
  s.speed = s.vx * fx + s.vy * fy;
  s.wheel += (s.speed * dt) / spec.wheelRadius;
  // Inclinaison d'un deux-roues : équilibre entre la gravité et l'accélération latérale (lissée).
  const target = spec.leans ? clamp(Math.atan2(s.speed * s.yawRate, GRAVITY), -0.75, 0.75) : 0;
  s.lean += (target - s.lean) * Math.min(1, dt * 10);
}

function integrate(s: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number, terrain: Terrain): void {
  const { mass: m, front: a, rear: b } = spec;
  const L = a + b;
  const sin = Math.sin(s.heading), cos = Math.cos(s.heading);
  // Vitesses dans le repère du véhicule : u vers l'avant, v vers la droite.
  let u = s.vx * sin + s.vy * cos;
  let v = s.vx * cos - s.vy * sin;
  let w = s.yawRate;

  // Guidon : suit la commande à vitesse limitée, borné selon la vitesse.
  const limit = steerLimit(spec, Math.abs(u));
  const wanted = clamp(input.steer, -1, 1) * limit;
  s.steer += clamp(wanted - s.steer, -spec.steerRate * dt, spec.steerRate * dt);
  s.steer = clamp(s.steer, -limit, limit);
  const d = s.steer;

  // Forces longitudinales : moteur (ou marche arrière à l'arrêt), air, pente.
  const slope = terrain.heightAt(s.x + sin * 0.5, s.y + cos * 0.5) - terrain.heightAt(s.x - sin * 0.5, s.y - cos * 0.5);
  let fx = 0, braking = 0;
  if (u < -0.3 && input.throttle > 0) braking = spec.maxBrake * input.throttle;
  else fx = driveForce(spec, u, input.throttle);
  if (input.brake > 0) {
    if (u > 0.3) braking = spec.maxBrake * input.brake;
    else if (u > -spec.reverseSpeed && input.throttle <= 0) fx -= spec.reverseForce * input.brake;
  }
  fx -= spec.drag * u * Math.abs(u);
  fx -= (m * GRAVITY * slope) / Math.sqrt(1 + slope * slope);
  // Frottements (roulement, frein) : ils freinent sans jamais inverser le sens.
  const uFree = u + (fx / m) * dt;
  const stop = ((spec.rolling * m * GRAVITY + braking) / m) * dt;
  const uLong = Math.abs(uFree) <= stop ? 0 : uFree - Math.sign(uFree) * stop;

  // Pneus : dérive, force latérale bornée par l'adhérence sur chaque essieu.
  const nf = (m * GRAVITY * b) / L, nr = (m * GRAVITY * a) / L;
  const au = Math.max(Math.abs(u), 0.5);
  const alphaF = Math.atan2(v + a * w, au) - d * (u < 0 ? -1 : 1);
  const alphaR = Math.atan2(v - b * w, au);
  const fyf = clamp(-spec.corneringFront * alphaF, -spec.grip * nf, spec.grip * nf);
  const fyr = clamp(-spec.corneringRear * alphaR, -spec.grip * nr, spec.grip * nr);
  const u1 = uLong + (-(fyf * Math.sin(d)) / m + v * w) * dt;
  v += ((fyr + fyf * Math.cos(d)) / m - u * w) * dt;
  w += ((a * fyf * Math.cos(d) - b * fyr) / spec.yawInertia) * dt;
  u = u1;

  // Basse vitesse : on tend vers le modèle géométrique (lacet = u tan δ / L, pas de dérive à l'arrière),
  // progressivement pour qu'un choc puisse encore faire pivoter le véhicule.
  const k = clamp((Math.abs(u) - KIN_LOW) / (KIN_HIGH - KIN_LOW), 0, 1);
  if (k < 1) {
    const wk = (u * Math.tan(d)) / L;
    const blend = (1 - k) * Math.min(1, dt * KIN_RATE);
    w += (wk - w) * blend;
    v += (wk * b - v) * blend;
  }

  s.heading += w * dt;
  s.yawRate = w;
  const sin2 = Math.sin(s.heading), cos2 = Math.cos(s.heading);
  s.vx = u * sin2 + v * cos2;
  s.vy = u * cos2 - v * sin2;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

/** Chocs : chaque cercle de l'emprise est repoussé hors des obstacles, avec une impulsion au point de contact. */
function collide(s: VehicleState, spec: VehicleSpec, colliders: Colliders): void {
  const inertia = spec.yawInertia;
  for (const [off, r] of spec.hull) {
    const sin = Math.sin(s.heading), cos = Math.cos(s.heading);
    const cx = s.x + sin * off, cy = s.y + cos * off;
    const res = colliders.resolve(cx, cy, r);
    if (!res.hit) continue;
    const nx = res.nx, ny = res.ny;
    s.x += res.x - cx;
    s.y += res.y - cy;
    // Point de contact relatif au centre de gravité ; vitesse de ce point (lacet horaire : ω × r = (w·ry, −w·rx)).
    const rx = sin * off - nx * r, ry = cos * off - ny * r;
    const pvx = s.vx + s.yawRate * ry, pvy = s.vy - s.yawRate * rx;
    const vn = pvx * nx + pvy * ny;
    if (vn >= 0) continue;
    // Bras de levier en sens trigonométrique ; le lacet horaire en est l'opposé.
    const rn = rx * ny - ry * nx;
    const j = (-(1 + spec.restitution) * vn) / (1 / spec.mass + (rn * rn) / inertia);
    s.vx += (j * nx) / spec.mass;
    s.vy += (j * ny) / spec.mass;
    s.yawRate -= (rn * j) / inertia;
    // Frottement contre l'obstacle, borné par la loi de Coulomb.
    const tx = -ny, ty = nx;
    const vt = pvx * tx + pvy * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (1 / spec.mass + (rt * rt) / inertia);
    jt = clamp(jt, -spec.impactFriction * j, spec.impactFriction * j);
    s.vx += (jt * tx) / spec.mass;
    s.vy += (jt * ty) / spec.mass;
    s.yawRate -= (rt * jt) / inertia;
    s.impact = Math.max(s.impact, -vn);
  }
}
