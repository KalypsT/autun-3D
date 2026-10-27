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
  /** Roulis de caisse (rad par m/s² d'accélération latérale), vers l'extérieur du virage ; 0 pour un deux-roues. */
  bodyRoll: number;
  /** Frein moteur quand on lâche l'accélérateur (N). */
  engineBrake: number;
  /** Essieu moteur : sa charge borne la motricité (patinage). */
  driveAxle: "front" | "rear";
  /** Hauteur du centre de gravité (m) : report de charge vers l'avant au freinage, vers l'arrière à l'accélération. */
  cgHeight: number;
  /** Part du freinage sur l'avant. */
  brakeFront: number;
  /**
   * Antiblocage : les freins ne bloquent jamais les roues (ABS de la voiture et de la moto, freinage dosé du cycliste),
   * on peut donc freiner en tournant ; seul le frein à main bloque l'arrière.
   */
  abs: boolean;
  /** Braquage permis à haute vitesse, en part de l'adhérence : au-delà de 1, on peut faire glisser (voiture) ; sous 1, jamais (deux-roues). */
  steerGrip: number;
  /** Frein à main (bloque l'arrière, pour faire pivoter la voiture). */
  handbrake: boolean;
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
  bodyRoll: 0,
  engineBrake: 0,
  driveAxle: "rear",
  cgHeight: 1.0,
  brakeFront: 0.6,
  abs: true,
  steerGrip: 0.9,
  handbrake: false,
};

/**
 * Trottinette électrique de location avec son conducteur : moteur ≈ 500 W bridé à 25 km/h, petites roues
 * (adhérence et roulement moins bons), freins plus faibles qu'un vélo ; on la pousse à reculons.
 */
export const SCOOTER: VehicleSpec = {
  mass: 88,
  yawInertia: 16,
  front: 0.45,
  rear: 0.45,
  maxSteer: 0.7,
  steerFade: 3.2,
  steerRate: 2.6,
  corneringFront: 850,
  corneringRear: 950,
  grip: 0.72,
  power: 500,
  maxDrive: 230,
  driveFadeFrom: 23 / 3.6,
  topSpeed: 25 / 3.6,
  maxBrake: 400,
  reverseSpeed: 1.0,
  reverseForce: 70,
  rolling: 0.012,
  drag: 0.32,
  hull: [[0.36, 0.22], [-0.36, 0.22]],
  restitution: 0.15,
  impactFriction: 0.35,
  wheelRadius: 0.11,
  leans: true,
  bodyRoll: 0,
  engineBrake: 0,
  driveAxle: "rear",
  cgHeight: 0.9,
  brakeFront: 0.5,
  abs: true,
  steerGrip: 0.9,
  handbrake: false,
};

/**
 * Petite citadine à traction avant, avec ABS (on peut freiner en tournant) et frein à main (pour la faire pivoter), avec son conducteur : 1 250 kg, 66 kW (90 ch) dont ≈ 56 kW aux roues, 0 à 100 km/h en ≈ 12 s,
 * freinage ≈ 0,9 g, pneus de tourisme. Centre de gravité vers l'avant (moteur).
 */
export const CAR: VehicleSpec = {
  mass: 1250,
  yawInertia: 1850,
  front: 1.05,
  rear: 1.55,
  maxSteer: 0.62,
  steerFade: 14,
  steerRate: 1.8,
  corneringFront: 70000,
  corneringRear: 80000,
  grip: 0.95,
  power: 56000,
  maxDrive: 5200,
  driveFadeFrom: 165 / 3.6,
  topSpeed: 175 / 3.6,
  maxBrake: 13000,
  reverseSpeed: 6,
  reverseForce: 3500,
  rolling: 0.013,
  drag: 0.39,
  hull: [[1.25, 0.82], [0, 0.85], [-1.25, 0.82]],
  restitution: 0.2,
  impactFriction: 0.3,
  wheelRadius: 0.3,
  leans: false,
  bodyRoll: 0.012,
  engineBrake: 350,
  driveAxle: "front",
  cgHeight: 0.55,
  brakeFront: 0.8,
  abs: true,
  steerGrip: 1.4,
  handbrake: true,
};

/**
 * Moto de moyenne cylindrée (permis A2) avec son pilote : 265 kg, 35 kW (≈ 32 kW à la roue), 0 à 100 km/h
 * en ≈ 5,5 s, freinage ≈ 0,9 g ; seule la roue arrière est motrice ; elle penche dans les virages.
 */
export const MOTO: VehicleSpec = {
  mass: 265,
  yawInertia: 70,
  front: 0.7,
  rear: 0.72,
  maxSteer: 0.55,
  steerFade: 6,
  steerRate: 2.2,
  corneringFront: 9000,
  corneringRear: 10500,
  grip: 1.0,
  power: 32000,
  maxDrive: 2600,
  driveFadeFrom: 160 / 3.6,
  topSpeed: 170 / 3.6,
  maxBrake: 2400,
  reverseSpeed: 1.0,
  reverseForce: 160,
  rolling: 0.012,
  drag: 0.36,
  hull: [[0.6, 0.32], [-0.55, 0.32]],
  restitution: 0.15,
  impactFriction: 0.35,
  wheelRadius: 0.31,
  leans: true,
  bodyRoll: 0,
  engineBrake: 250,
  driveAxle: "rear",
  cgHeight: 0.7,
  brakeFront: 0.7,
  abs: true,
  steerGrip: 0.9,
  handbrake: false,
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
  /** Pression de freinage 0-1 : monte progressivement tant que la pédale est enfoncée. */
  brakeLevel: number;
  /** Accélération longitudinale lissée (m/s²), pour le report de charge. */
  accel: number;
  /** Roues bloquées (elles glissent) et glissade 0-1 (pneus à la limite ou bloqués), pour l'affichage. */
  lockedFront: boolean;
  lockedRear: boolean;
  skid: number;
}

export interface DriveInput {
  /** Accélérateur 0-1. */
  throttle: number;
  /** Frein 0-1 ; à l'arrêt, il fait reculer. */
  brake: number;
  /** Direction -1 (gauche) à 1 (droite). */
  steer: number;
  /** Frein à main (0 ou 1) ; ignoré si le véhicule n'en a pas. */
  handbrake?: number;
}

export function createVehicle(x: number, y: number, heading: number, terrain: Terrain): VehicleState {
  return { x, y, z: terrain.heightAt(x, y), heading, vx: 0, vy: 0, yawRate: 0, steer: 0, pitch: 0, lean: 0, wheel: 0, speed: 0, impact: 0, brakeLevel: 0, accel: 0, lockedFront: false, lockedRear: false, skid: 0 };
}

const SUBSTEPS = 2;
/** En dessous, modèle géométrique pur ; au-dessus de KIN_HIGH, modèle dynamique pur. */
const KIN_LOW = 1.5;
const KIN_HIGH = 4;
/** Vitesse (1/s) à laquelle les pneus ramènent le véhicule vers le modèle géométrique. */
const KIN_RATE = 10;
/** Pédale de frein tactile (tout ou rien) : temps pour atteindre la pression maximale, et pour la relâcher. */
const BRAKE_RAMP = 0.7;
const BRAKE_RELEASE = 0.15;
/** Adhérence d'un pneu qui glisse, rapportée à l'adhérence maximale. */
const SLIDE_GRIP = 0.75;
/** En dessous de cette vitesse (m/s), les roues ne se bloquent plus (le véhicule s'arrête). */
const LOCK_MIN = 1.5;
/** Temps pour braquer à fond (s) : le volant ne saute pas d'un coup, même quand le braquage permis est petit. */
const STEER_TIME = 0.2;
/** Deux-roues : écart permis entre le lacet réel et celui du guidon (rad/s), et glissade latérale (m/s). */
const TWO_WHEEL_YAW = 0.2;
const TWO_WHEEL_SLIP = 0.4;

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
  const low = spec.maxSteer / (1 + (u / spec.steerFade) ** 2);
  // À haute vitesse, pas plus que ce que les pneus peuvent tenir (v² δ / L ≈ accélération latérale).
  const L = spec.front + spec.rear;
  return Math.min(low, (spec.steerGrip * spec.grip * GRAVITY * L) / Math.max(u * u, 1e-3));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fait avancer le véhicule de `dt` secondes : forces, pneus, relief, puis chocs contre les obstacles. */
export function stepVehicle(s: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number, terrain: Terrain, colliders: Colliders, extra: Colliders | null = null): void {
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) integrate(s, spec, input, h, terrain);
  collide(s, spec, colliders);
  // Obstacles propres à certains véhicules (escaliers pour une voiture).
  if (extra) collide(s, spec, extra);
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
  const lateral = s.speed * s.yawRate;
  const target = spec.leans ? clamp(Math.atan2(lateral, GRAVITY), -0.75, 0.75) : clamp(-lateral * spec.bodyRoll, -0.08, 0.08);
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
  const v0 = v;

  // Guidon : suit la commande à vitesse limitée (plein braquage en STEER_TIME au plus), borné selon la vitesse.
  const limit = steerLimit(spec, Math.abs(u));
  const wanted = clamp(input.steer, -1, 1) * limit;
  const rate = Math.min(spec.steerRate, Math.max(limit / STEER_TIME, 0.05));
  s.steer += clamp(wanted - s.steer, -rate * dt, rate * dt);
  s.steer = clamp(s.steer, -limit, limit);
  const d = s.steer;

  // Pression de freinage : monte tant que la pédale est enfoncée, retombe vite.
  const target = input.brake > 0 && u > 0.3 ? input.brake : 0;
  s.brakeLevel += target > s.brakeLevel ? Math.min(target - s.brakeLevel, dt / BRAKE_RAMP) : Math.max(target - s.brakeLevel, -dt / BRAKE_RELEASE);

  // Charges des essieux, avec le report dû à l'accélération (freinage : l'avant s'écrase, l'arrière s'allège).
  const transfer = (m * s.accel * spec.cgHeight) / L;
  const nf = Math.max((m * GRAVITY * b) / L - transfer, 0.08 * m * GRAVITY);
  const nr = Math.max((m * GRAVITY * a) / L + transfer, 0.08 * m * GRAVITY);
  const gripF = spec.grip * nf, gripR = spec.grip * nr;

  // Moteur (ou marche arrière à l'arrêt), borné par la motricité de l'essieu moteur.
  const driveGrip = spec.driveAxle === "front" ? gripF : gripR;
  let drive = 0, brakeF = 0, brakeR = 0, friction = spec.rolling * m * GRAVITY;
  if (u < -0.3 && input.throttle > 0) {
    // Accélérer en reculant : on freine d'abord.
    brakeF = spec.maxBrake * input.throttle * spec.brakeFront;
    brakeR = spec.maxBrake * input.throttle * (1 - spec.brakeFront);
  } else drive = Math.min(driveForce(spec, u, input.throttle), 0.98 * driveGrip);
  if (input.brake > 0 && u <= 0.3 && u > -spec.reverseSpeed && input.throttle <= 0) drive -= spec.reverseForce * input.brake;
  if (input.throttle <= 0 && u > 0.3) friction += spec.engineBrake;
  if (s.brakeLevel > 0) {
    brakeF = spec.maxBrake * s.brakeLevel * spec.brakeFront;
    brakeR = spec.maxBrake * s.brakeLevel * (1 - spec.brakeFront);
  }
  if (spec.abs) {
    brakeF = Math.min(brakeF, 0.95 * gripF);
    brakeR = Math.min(brakeR, 0.95 * gripR);
  }
  // Une roue freinée au-delà de son adhérence se bloque ; elle glisse alors dans le sens de son mouvement.
  // Le frein à main bloque l'arrière d'un coup (à l'arrêt, il retient le véhicule).
  const pull = spec.handbrake && (input.handbrake ?? 0) > 0;
  if (pull) brakeR = Math.max(brakeR, 2 * gripR);
  const fast = Math.abs(u) > LOCK_MIN;
  s.lockedFront = fast && brakeF > gripF;
  s.lockedRear = fast && brakeR > gripR;
  const driveF = spec.driveAxle === "front" ? drive : 0, driveR = spec.driveAxle === "rear" ? drive : 0;

  // Forces dans le repère du véhicule ; frottements (freins des roues qui tournent, roulement, frein moteur) à part.
  const slope = terrain.heightAt(s.x + sin * 0.5, s.y + cos * 0.5) - terrain.heightAt(s.x - sin * 0.5, s.y - cos * 0.5);
  let fx = -spec.drag * u * Math.abs(u) - (m * GRAVITY * slope) / Math.sqrt(1 + slope * slope);
  let fyFront: number, fyRear: number, skid = 0;
  const au = Math.max(Math.abs(u), 0.5);
  /** Glissade d'un pneu bloqué : force opposée à la vitesse du point de contact (vx avant, vy droite). */
  const slide = (n: number, cvx: number, cvy: number): [number, number] => {
    const sp = Math.hypot(cvx, cvy) || 1;
    const f = SLIDE_GRIP * spec.grip * n;
    return [(-cvx / sp) * f, (-cvy / sp) * f];
  };
  if (s.lockedFront) {
    const [sx, sy] = slide(nf, u, v + a * w);
    fx += sx;
    fyFront = sy;
    skid = 1;
  } else {
    // Pneu qui roule : la part d'adhérence prise par le freinage et la traction ne reste pas pour tourner.
    const long = Math.abs(driveF) + brakeF;
    const lat = Math.sqrt(Math.max(gripF * gripF - long * long, 0));
    const alpha = Math.atan2(v + a * w, au) - d * (u < 0 ? -1 : 1);
    const fyw = clamp(-spec.corneringFront * alpha, -lat, lat);
    fx += driveF * Math.cos(d) - fyw * Math.sin(d);
    fyFront = driveF * Math.sin(d) + fyw * Math.cos(d);
    friction += brakeF;
    skid = Math.max(skid, lat > 0 ? Math.abs(fyw) / lat : 1);
  }
  if (s.lockedRear) {
    const [sx, sy] = slide(nr, u, v - b * w);
    fx += sx;
    fyRear = sy;
    skid = 1;
  } else {
    const long = Math.abs(driveR) + brakeR;
    const lat = Math.sqrt(Math.max(gripR * gripR - long * long, 0));
    const alpha = Math.atan2(v - b * w, au);
    fyRear = clamp(-spec.corneringRear * alpha, -lat, lat);
    fx += driveR;
    friction += brakeR;
    skid = Math.max(skid, lat > 0 ? Math.abs(fyRear) / lat : 1);
  }
  s.skid = Math.abs(u) > LOCK_MIN ? clamp((skid - 0.85) / 0.15, 0, 1) : 0;

  // Frottements : ils freinent sans jamais inverser le sens.
  const uFree = u + (fx / m + v * w) * dt;
  const stop = (friction / m) * dt;
  const u1 = Math.abs(uFree) <= stop ? 0 : uFree - Math.sign(uFree) * stop;
  s.accel += ((u1 - u) / dt - v * w - s.accel) * Math.min(1, dt * 8);
  v += ((fyFront + fyRear) / m - u * w) * dt;
  w += ((a * fyFront - b * fyRear) / spec.yawInertia) * dt;
  u = u1;

  // Deux-roues : la chute n'est pas modélisée, ils ne dérapent donc pas. Leur lacet et leur dérive restent proches
  // de ce que donne le guidon (sinon, en freinant fort, l'arrière délesté les ferait pivoter sur place).
  // Une rotation venue d'un choc (déjà au-delà de la marge) s'amortit au lieu d'être coupée net.
  if (spec.leans) {
    const wk = (u * Math.tan(d)) / L, decay = 1 - Math.min(1, dt * 4);
    const yawRoom = Math.max(TWO_WHEEL_YAW, Math.abs(s.yawRate - wk) * decay);
    w = clamp(w, wk - yawRoom, wk + yawRoom);
    const slipRoom = Math.max(TWO_WHEEL_SLIP, Math.abs(v0 - wk * b) * decay);
    v = clamp(v, wk * b - slipRoom, wk * b + slipRoom);
  }

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
