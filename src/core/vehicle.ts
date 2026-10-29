import type { Colliders } from "./collision";
import type { HeightField } from "../data/types";

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
  /**
   * Braquage géométrique permis à haute vitesse, en part de l'adhérence (une voiture a en plus la dérive de ses pneus avant, D97) : au-delà de 1,
   * les pneus avant arrivent à leur limite (voiture) ; sous 1, jamais (deux-roues).
   */
  steerGrip: number;
  /** Frein à main (bloque l'arrière, pour faire pivoter la voiture). */
  handbrake: boolean;
  /**
   * Aide au contre-braquage 0-1 : part de la dérive de la caisse que les roues avant suivent d'elles-mêmes quand l'arrière glisse
   * (le volant « revient » dans la glisse, comme celui d'une vraie voiture qu'on laisse filer entre les mains). 0 : aucune aide.
   */
  driftAssist: number;
  /** Antipatinage : part de l'adhérence de l'essieu moteur que la motricité peut prendre en virage (0,98 : aucun, la roue motrice ne garde presque rien pour tourner) ; en ligne droite, toujours 0,98. */
  traction: number;
  /**
   * Adhérence des pneus arrière rapportée à celle des avant (équilibre du châssis) : un peu plus de 1, la voiture sous-vire à la limite et reste
   * stable ; à 1, elle est neutre et l'arrière décroche au moindre écart.
   */
  rearGrip: number;
  /** Dérive maximale des pneus arrière (rad), l'angle de la glisse : au-delà, la stabilisation la ramène (pas de tête-à-queue), sauf frein à main tiré. Infinity : aucune aide. */
  maxDrift: number;
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
  driftAssist: 0,
  traction: 0.98,
  rearGrip: 1,
  maxDrift: Infinity,
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
  driftAssist: 0,
  traction: 0.98,
  rearGrip: 1,
  maxDrift: Infinity,
};

/**
 * Petite citadine à traction avant, avec ABS (on peut freiner en tournant) et frein à main (pour la faire pivoter), avec son conducteur : 1 250 kg, 66 kW (90 ch) dont ≈ 56 kW aux roues, 0 à 100 km/h en ≈ 12 s,
 * freinage ≈ 0,9 g, pneus de tourisme. Centre de gravité vers l'avant (moteur).
 * Conduite (D97) : un peu plus d'adhérence à l'arrière (sous-vire à la limite), glisse au frein à main ou en freinant fort en virage, aidée au
 * contre-braquage et bornée à ≈ 35° ; les autres voitures du catalogue en héritent.
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
  driftAssist: 0.4,
  traction: 0.95,
  rearGrip: 1.12,
  maxDrift: 0.6,
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
  driftAssist: 0,
  traction: 0.98,
  rearGrip: 1,
  maxDrift: Infinity,
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

export function createVehicle(x: number, y: number, heading: number, terrain: HeightField): VehicleState {
  return { x, y, z: terrain.heightAt(x, y), heading, vx: 0, vy: 0, yawRate: 0, steer: 0, pitch: 0, lean: 0, wheel: 0, speed: 0, impact: 0, brakeLevel: 0, accel: 0, lockedFront: false, lockedRear: false, skid: 0 };
}

const SUBSTEPS = 2;
/** Plafond des sous-pas (au-delà, la vitesse dépasse tout ce que le jeu permet). */
const MAX_SUBSTEPS = 12;
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
/** Voiture : dérive des pneus arrière (rad) en dessous de laquelle on ne parle pas de glisse (virage ordinaire), sans aide ni contre-braquage en plus. */
const DRIFT_DEAD = 0.08;
/** Pneu qui roule mais dépasse sa limite : l'adhérence redescend vers cette part de son maximum (décrochage net, pas brutal). */
const SLIP_GRIP = 0.9;
/** ABS en courbe : part au plus de l'adhérence avant gardée pour tourner quand on freine en braquant. */
const CORNER_BRAKE_FRONT = 0.6;
/** Motricité permise en ligne droite, en part de l'adhérence de l'essieu moteur. */
const TRACTION_FULL = 0.98;
/**
 * Stabilisation : elle commence à cette part de la dérive maximale ; elle fait alors tourner la caisse moins vite que la trajectoire, de quoi
 * réduire la dérive de STAB_RATE (rad/s) par part de dépassement, et rejoint ce lacet à STAB_BLEND (1/s).
 */
const STAB_FROM = 0.7;
const STAB_RATE = 1.2;
const STAB_BLEND = 10;

/** Plus petit rayon de la coque (m). */
function smallestRadius(spec: VehicleSpec): number {
  let r = Infinity;
  for (const [, c] of spec.hull) r = Math.min(r, c);
  return r;
}

/** Nombre de sous-pas d'un pas de `dt` secondes à la vitesse `speed` (m/s) : au moins deux, assez pour avancer de moins que le plus petit rayon de la coque. */
export function collisionSteps(spec: VehicleSpec, speed: number, dt: number): number {
  return Math.min(MAX_SUBSTEPS, Math.max(SUBSTEPS, Math.ceil((speed * dt) / (0.9 * smallestRadius(spec)))));
}

/** Accélérateur tout ou rien (clavier, pédale tactile) : temps pour l'enfoncer à fond, et pour le relâcher. */
const THROTTLE_RAMP = 0.35;
const THROTTLE_RELEASE = 0.1;

/** Accélérateur dosé du joueur en voiture : `level` suit la commande 0-1 en THROTTLE_RAMP à la montée (un coup de gaz ne fait pas décrocher l'arrière d'un coup), vite à la descente. */
export function rampThrottle(level: number, wanted: number, dt: number): number {
  return wanted > level ? Math.min(wanted, level + dt / THROTTLE_RAMP) : Math.max(wanted, level - dt / THROTTLE_RELEASE);
}

/** Force motrice disponible à la vitesse u (m/s) pour un accélérateur 0-1. */
export function driveForce(spec: VehicleSpec, u: number, throttle: number): number {
  if (throttle <= 0) return 0;
  const v = Math.max(u, 0);
  let f = Math.min(spec.maxDrive, spec.power / Math.max(v, 0.5));
  if (v > spec.driveFadeFrom) f *= Math.max(0, (spec.topSpeed - v) / (spec.topSpeed - spec.driveFadeFrom));
  return f * throttle;
}

/**
 * Gradient de sous-virage (rad par m/s²) : braquage en plus de la géométrie, par unité d'accélération latérale,
 * parce que les pneus avant dérivent plus que les arrière (K = m / L · (b / Cf − a / Cr)) ; jamais négatif.
 */
export function understeer(spec: VehicleSpec): number {
  const L = spec.front + spec.rear;
  return Math.max(0, (spec.mass / L) * (spec.rear / spec.corneringFront - spec.front / spec.corneringRear));
}

/** Braquage maximal à la vitesse u, sans la dérive des pneus (v² δ / L ≈ accélération latérale) : celui qu'un conducteur prévoit pour une courbe. */
export function steerLimitNoSlip(spec: VehicleSpec, u: number): number {
  const low = spec.maxSteer / (1 + (u / spec.steerFade) ** 2);
  const L = spec.front + spec.rear;
  return Math.min(low, (spec.steerGrip * spec.grip * GRAVITY * L) / Math.max(u * u, 1e-3));
}

/**
 * Braquage maximal à la vitesse u. À haute vitesse, pas plus que ce que les pneus peuvent tenir : la géométrie (v² δ / L), plus,
 * pour une voiture, la dérive des pneus avant à cette accélération (sans elle, la citadine ne prenait que 0,43 g à 130 km/h).
 * Un deux-roues garde le braquage géométrique.
 */
export function steerLimit(spec: VehicleSpec, u: number): number {
  const geo = steerLimitNoSlip(spec, u);
  if (spec.leans) return geo;
  const low = spec.maxSteer / (1 + (u / spec.steerFade) ** 2);
  return Math.min(low, geo + spec.grip * GRAVITY * understeer(spec));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fait avancer le véhicule de `dt` secondes : forces, pneus, relief, puis chocs contre les obstacles. */
export function stepVehicle(s: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number, terrain: HeightField, colliders: Colliders, extra: Colliders | null = null): void {
  // Chocs à chaque sous-pas, et assez de sous-pas pour qu'on n'avance jamais de plus que le plus petit rayon de la coque entre deux
  // tests : sinon un mur fin passe entre deux positions (moto à 250 km/h : 68 % de traversées, D50).
  const n = collisionSteps(spec, Math.hypot(s.vx, s.vy), dt);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    integrate(s, spec, input, h, terrain);
    collide(s, spec, colliders);
    // Obstacles propres à certains véhicules (escaliers pour une voiture).
    if (extra) collide(s, spec, extra);
  }
  // Limites du monde (3 m de marge).
  const x = clamp(s.x, terrain.xMin + 3, terrain.xMax - 3), y = clamp(s.y, terrain.yMin + 3, terrain.yMax - 3);
  if (x !== s.x) s.vx = 0;
  if (y !== s.y) s.vy = 0;
  s.x = x;
  s.y = y;
  // Hauteur et tangage : moyenne et pente entre les deux essieux.
  const fx = Math.sin(s.heading), fy = Math.cos(s.heading);
  // L'altitude actuelle départage le tablier d'un pont et la route qui passe dessous (D93).
  const zf = terrain.heightAt(s.x + fx * spec.front, s.y + fy * spec.front, s.z);
  const zr = terrain.heightAt(s.x - fx * spec.rear, s.y - fy * spec.rear, s.z);
  s.z = (zf * spec.rear + zr * spec.front) / (spec.front + spec.rear);
  s.pitch = Math.atan2(zf - zr, spec.front + spec.rear);
  s.speed = s.vx * fx + s.vy * fy;
  s.wheel += (s.speed * dt) / spec.wheelRadius;
  // Inclinaison d'un deux-roues : équilibre entre la gravité et l'accélération latérale (lissée).
  const lateral = s.speed * s.yawRate;
  const target = spec.leans ? clamp(Math.atan2(lateral, GRAVITY), -0.75, 0.75) : clamp(-lateral * spec.bodyRoll, -0.08, 0.08);
  s.lean += (target - s.lean) * Math.min(1, dt * 10);
}

function integrate(s: VehicleState, spec: VehicleSpec, input: DriveInput, dt: number, terrain: HeightField): void {
  const { mass: m, front: a, rear: b } = spec;
  const L = a + b;
  const sin = Math.sin(s.heading), cos = Math.cos(s.heading);
  // Vitesses dans le repère du véhicule : u vers l'avant, v vers la droite.
  let u = s.vx * sin + s.vy * cos;
  let v = s.vx * cos - s.vy * sin;
  let w = s.yawRate;
  const u0 = u, v0 = v;
  const pull = spec.handbrake && (input.handbrake ?? 0) > 0;

  // Glisse d'une voiture : dérive des pneus arrière au-delà d'un virage ordinaire (négative quand l'arrière part à gauche, dans un virage
  // à droite), nulle au pas. Celle de l'arrière, pas celle de la caisse : au pas, braquée à fond, la caisse « dérive » de 20° sans glisser.
  const kd = clamp((Math.abs(u) - KIN_LOW) / (KIN_HIGH - KIN_LOW), 0, 1);
  const rearSlip = !spec.leans && u > 0.5 ? Math.atan2(v - b * w, u) : 0;
  const drift = Math.sign(rearSlip) * Math.max(Math.abs(rearSlip) - DRIFT_DEAD, 0) * kd;

  // Guidon : suit la commande à vitesse limitée (plein braquage en STEER_TIME au plus), borné selon la vitesse.
  // Contre-braquage : du côté de la glisse, on peut braquer en plus de toute la dérive (les roues dans l'axe du mouvement),
  // et l'aide en fait d'elle-même une part ; le guidon tourne alors plus vite.
  const limit = steerLimit(spec, Math.abs(u));
  const cmd = clamp(input.steer, -1, 1);
  const assist = spec.driftAssist * drift;
  const wanted = cmd * (cmd * drift > 0 ? limit + Math.abs(drift) - Math.abs(assist) : limit) + assist;
  const rate = Math.min(spec.steerRate * (1 + 2 * Math.abs(drift)), Math.max((limit + Math.abs(drift)) / STEER_TIME, 0.05));
  s.steer += clamp(wanted - s.steer, -rate * dt, rate * dt);
  s.steer = clamp(s.steer, -limit + Math.min(drift, 0), limit + Math.max(drift, 0));
  const d = s.steer;

  // Pression de freinage : monte tant que la pédale est enfoncée, retombe vite.
  const target = input.brake > 0 && u > 0.3 ? input.brake : 0;
  s.brakeLevel += target > s.brakeLevel ? Math.min(target - s.brakeLevel, dt / BRAKE_RAMP) : Math.max(target - s.brakeLevel, -dt / BRAKE_RELEASE);

  // Charges des essieux, avec le report dû à l'accélération (freinage : l'avant s'écrase, l'arrière s'allège).
  const transfer = (m * s.accel * spec.cgHeight) / L;
  const nf = Math.max((m * GRAVITY * b) / L - transfer, 0.08 * m * GRAVITY);
  const nr = Math.max((m * GRAVITY * a) / L + transfer, 0.08 * m * GRAVITY);
  const gripF = spec.grip * nf, gripR = spec.grip * spec.rearGrip * nr;

  // Moteur (ou marche arrière à l'arrêt), borné par la motricité de l'essieu moteur (et l'antipatinage).
  const driveGrip = spec.driveAxle === "front" ? gripF : gripR;
  let drive = 0, brakeF = 0, brakeR = 0, friction = spec.rolling * m * GRAVITY;
  if (u < -0.3 && input.throttle > 0) {
    // Accélérer en reculant : on freine d'abord.
    brakeF = spec.maxBrake * input.throttle * spec.brakeFront;
    brakeR = spec.maxBrake * input.throttle * (1 - spec.brakeFront);
  } else {
    // Antipatinage : en ligne droite, toute la motricité ; dès que l'essieu moteur tient la voiture en virage (la moitié de son adhérence
    // en latéral), il n'en laisse que `traction`, pour garder de quoi tourner.
    const front = spec.driveAxle === "front";
    const slip = Math.atan2(front ? v + a * w : v - b * w, Math.max(Math.abs(u), 0.5)) - (front ? d : 0);
    const demand = Math.min(1, (2 * Math.abs(slip) * (front ? spec.corneringFront : spec.corneringRear)) / Math.max(driveGrip, 1));
    drive = Math.min(driveForce(spec, u, input.throttle), (TRACTION_FULL - (TRACTION_FULL - Math.min(spec.traction, TRACTION_FULL)) * demand) * driveGrip);
  }
  if (input.brake > 0 && u <= 0.3 && u > -spec.reverseSpeed && input.throttle <= 0) drive -= spec.reverseForce * input.brake;
  if (input.throttle <= 0 && u > 0.3) friction += spec.engineBrake;
  if (s.brakeLevel > 0) {
    brakeF = spec.maxBrake * s.brakeLevel * spec.brakeFront;
    brakeR = spec.maxBrake * s.brakeLevel * (1 - spec.brakeFront);
  }
  if (spec.abs) {
    brakeF = Math.min(brakeF, 0.95 * gripF);
    brakeR = Math.min(brakeR, 0.95 * gripR);
    // Voiture : l'ABS en courbe garde aux pneus ce qu'ils tiennent déjà en latéral (sinon, en freinant fort dans un virage, l'arrière délesté
    // n'a plus de quoi tenir et la voiture part en travers) ; à l'avant, au plus CORNER_BRAKE_FRONT de l'adhérence, pour freiner encore.
    if (!spec.leans) {
      const au0 = Math.max(Math.abs(u), 0.5);
      const heldF = Math.min(CORNER_BRAKE_FRONT * gripF, spec.corneringFront * Math.abs(Math.atan2(v + a * w, au0) - d));
      const heldR = Math.min(gripR, spec.corneringRear * Math.abs(Math.atan2(v - b * w, au0)));
      brakeF = Math.min(brakeF, Math.sqrt(gripF * gripF - heldF * heldF));
      brakeR = Math.min(brakeR, Math.sqrt(gripR * gripR - heldR * heldR));
    }
  }
  // Une roue freinée au-delà de son adhérence se bloque ; elle glisse alors dans le sens de son mouvement.
  // Le frein à main bloque l'arrière d'un coup (à l'arrêt, il retient le véhicule).
  if (pull) brakeR = Math.max(brakeR, 2 * gripR);
  const fast = Math.abs(u) > LOCK_MIN;
  s.lockedFront = fast && brakeF > gripF;
  s.lockedRear = fast && brakeR > gripR;
  const driveF = spec.driveAxle === "front" ? drive : 0, driveR = spec.driveAxle === "rear" ? drive : 0;

  // Forces dans le repère du véhicule ; frottements (freins des roues qui tournent, roulement, frein moteur) à part.
  const slope = terrain.heightAt(s.x + sin * 0.5, s.y + cos * 0.5, s.z) - terrain.heightAt(s.x - sin * 0.5, s.y - cos * 0.5, s.z);
  let fx = -spec.drag * u * Math.abs(u) - (m * GRAVITY * slope) / Math.sqrt(1 + slope * slope);
  let fyFront: number, fyRear: number, skid = 0;
  const au = Math.max(Math.abs(u), 0.5);
  /** Force latérale d'un pneu qui roule, bornée à `lat` ; une voiture au-delà de sa limite perd un peu d'adhérence (jusqu'à SLIP_GRIP à trois fois la dérive de pointe). */
  const tyre = (c: number, alpha: number, lat: number): number => {
    const f = -c * alpha;
    if (Math.abs(f) <= lat) return f;
    const over = spec.leans || lat <= 0 ? 0 : Math.min(1, (Math.abs(f) / lat - 1) / 2);
    return Math.sign(f) * lat * (1 - (1 - SLIP_GRIP) * over);
  };
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
    const fyw = tyre(spec.corneringFront, alpha, lat);
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
    fyRear = tyre(spec.corneringRear, alpha, lat);
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

  // Voiture qui glisse trop (arcade) : au-delà de STAB_FROM de la dérive maximale, le lacet est ramené vers celui de la trajectoire (jamais
  // au-delà : la caisse ne repart pas dans l'autre sens), moins de quoi réduire la dérive. Muette quand on tire le frein à main
  // (demi-tour voulu) et quand la voiture part de travers ou à reculons.
  if (Number.isFinite(spec.maxDrift) && !pull && u > LOCK_MIN && u0 > LOCK_MIN) {
    const slip = Math.atan2(v - b * w, u);
    const over = (Math.abs(slip) - STAB_FROM * spec.maxDrift) / ((1 - STAB_FROM) * spec.maxDrift);
    if (over > 0 && Math.abs(slip) < Math.PI / 2) {
      // Lacet de la trajectoire : celui de la caisse plus la variation, sur ce pas, de l'angle entre la vitesse et la caisse.
      const path = w + (Math.atan2(v, u) - Math.atan2(v0, u0)) / dt;
      const target = path + Math.sign(slip) * STAB_RATE * Math.min(over, 2);
      if ((target - w) * Math.sign(slip) > 0) w += (target - w) * Math.min(1, dt * STAB_BLEND * Math.min(over, 1));
    }
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
