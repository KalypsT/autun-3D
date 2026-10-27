import { BIKE, CAR, MOTO, type VehicleSpec } from "./vehicle";

/**
 * Fiches physiques des voitures du catalogue (D53), à partir de la citadine (`CAR`) : seuls les champs qui changent sont écrits.
 * Valeurs d'ordre de grandeur réaliste, masse avec le conducteur : rigidité de dérive proportionnelle à la masse (≈ 56 et 64 N/rad par kg),
 * freinage en force (≈ 0,85 à 1,2 g), inertie de lacet = masse × (0,46 × empattement)², traînée = ½ ρ S Cx.
 * La coque recouvre le gabarit : trois cercles de (largeur / 2 − 3 cm) du nez à la queue.
 */

/** Plafond de vitesse (m/s) : les vitesses réelles de la sportive (240 km/h) et de la moto sportive (250) ne servent à rien dans un anneau de 3 km (D50). À relever avec la commune entière (étape C). */
export const SPEED_CAP = { car: 200 / 3.6, moto: 210 / 3.6 } as const;

/**
 * Fiche plafonnée : si la vitesse réelle dépasse le plafond, la traction s'éteint progressivement sur les 6 % de vitesse sous le plafond
 * (un limiteur, pas un mur) ; l'accélération et le reste de la fiche ne changent pas.
 */
export function limited(spec: VehicleSpec, cap: number): VehicleSpec {
  return spec.topSpeed <= cap ? spec : { ...spec, topSpeed: cap, driveFadeFrom: Math.min(spec.driveFadeFrom, cap * 0.94) };
}

const kmh = (v: number): number => v / 3.6;

/** VTT avec son cycliste : 94 kg, ≈ 250 W de pédalage, gros pneus crantés (roulement plus fort, grip 0,9), freins à disque, roues de 29 pouces ; ne dépasse pas 26 km/h sur le plat. */
export const MTB: VehicleSpec = {
  ...BIKE, mass: 94, yawInertia: 24, front: 0.64, rear: 0.48, steerRate: 2.6,
  corneringFront: 1200, corneringRear: 1400, grip: 0.9, driveFadeFrom: kmh(21), topSpeed: kmh(26),
  maxBrake: 700, rolling: 0.011, drag: 0.34, hull: [[0.45, 0.3], [-0.4, 0.3]], wheelRadius: 0.35,
};

/**
 * Scooter de 125 cm³ avec son pilote : 235 kg, 10 kW (≈ 7,5 kW à la roue), 0 à 50 km/h en ≈ 4,5 s, 100 km/h, freinage ≈ 0,9 g,
 * petites roues (grip 0,95), seule la roue arrière est motrice, il penche dans les virages.
 */
export const SCOOTER_125: VehicleSpec = {
  ...MOTO, mass: 235, yawInertia: 51, front: 0.62, rear: 0.68, maxSteer: 0.65, steerFade: 5,
  corneringFront: 6600, corneringRear: 7500, grip: 0.95, power: 7500, maxDrive: 950, driveFadeFrom: kmh(92), topSpeed: kmh(100),
  maxBrake: 2100, brakeFront: 0.6, reverseForce: 120, rolling: 0.013, drag: 0.33, hull: [[0.6, 0.28], [-0.55, 0.28]], wheelRadius: 0.25, engineBrake: 100, cgHeight: 0.62,
};

/**
 * Moto sportive (600 cm³) avec son pilote : 275 kg, 85 kW (≈ 76 kW à la roue), 0 à 100 km/h en ≈ 3,5 s, 250 km/h réels, plafonnée à 210 km/h ;
 * pneus larges (grip 1,1), freinage ≈ 1,1 g, position basse (aérodynamique) ; la chute n'est pas modélisée.
 */
export const SPORT_MOTO: VehicleSpec = limited({
  ...MOTO, mass: 275, yawInertia: 68, front: 0.68, rear: 0.72, maxSteer: 0.5, steerFade: 6.5, grip: 1.1,
  corneringFront: 12000, corneringRear: 13500, power: 76000, maxDrive: 4000, driveFadeFrom: kmh(235), topSpeed: kmh(250),
  maxBrake: 3100, brakeFront: 0.75, drag: 0.22, hull: [[0.62, 0.32], [-0.6, 0.32]], wheelRadius: 0.31, engineBrake: 300, cgHeight: 0.62,
}, SPEED_CAP.moto);

/** Compacte à hayon (classe Golf) : 1 350 kg, 85 kW dont 72 aux roues, 0 à 100 km/h en ≈ 10 s, 195 km/h. */
export const COMPACT: VehicleSpec = {
  ...CAR, mass: 1350, yawInertia: 1991, front: 1.1, rear: 1.54,
  corneringFront: 76000, corneringRear: 86000, power: 72000, maxDrive: 5560, driveFadeFrom: kmh(180), topSpeed: kmh(195),
  maxBrake: 14000, reverseForce: 3800, drag: 0.41, hull: [[1.08, 0.87], [-0.17, 0.89], [-1.43, 0.87]], wheelRadius: 0.31, engineBrake: 380,
};

/** Berline tricorps : 1 650 kg, 110 kW dont 94 aux roues, 0 à 100 km/h en ≈ 9 s, 215 km/h (plafonnée). */
export const SEDAN: VehicleSpec = limited({
  ...CAR, mass: 1650, yawInertia: 2777, front: 1.15, rear: 1.67, steerFade: 15,
  corneringFront: 92000, corneringRear: 105000, power: 94000, maxDrive: 6470, driveFadeFrom: kmh(195), topSpeed: kmh(215),
  maxBrake: 17000, reverseForce: 4600, drag: 0.36, hull: [[1.18, 0.9], [-0.29, 0.92], [-1.77, 0.9]], wheelRadius: 0.32, bodyRoll: 0.014, engineBrake: 420, cgHeight: 0.54, brakeFront: 0.78,
}, SPEED_CAP.car);

/** Break : la berline allongée et alourdie, 1 750 kg, 205 km/h (plafonnée), plus de roulis. */
export const WAGON: VehicleSpec = limited({
  ...CAR, mass: 1750, yawInertia: 2945, front: 1.12, rear: 1.7, steerFade: 15,
  corneringFront: 98000, corneringRear: 112000, power: 94000, maxDrive: 6900, driveFadeFrom: kmh(190), topSpeed: kmh(205),
  maxBrake: 17800, reverseForce: 4800, drag: 0.39, hull: [[1.15, 0.9], [-0.35, 0.92], [-1.85, 0.9]], wheelRadius: 0.32, bodyRoll: 0.016, engineBrake: 430, cgHeight: 0.57, brakeFront: 0.78,
}, SPEED_CAP.car);

/** Petit SUV : 1 450 kg, 72 kW aux roues, 180 km/h, haut sur roues (centre de gravité à 0,65 m, plus de roulis), moins de prise que la compacte. */
export const SUV: VehicleSpec = {
  ...CAR, mass: 1450, yawInertia: 2106, front: 1.1, rear: 1.52, grip: 0.92,
  corneringFront: 76000, corneringRear: 88000, power: 72000, maxDrive: 5400, driveFadeFrom: kmh(165), topSpeed: kmh(180),
  maxBrake: 14000, reverseForce: 4000, drag: 0.53, hull: [[1.11, 0.87], [-0.15, 0.89], [-1.4, 0.87]], wheelRadius: 0.34, bodyRoll: 0.022, engineBrake: 400, cgHeight: 0.65, brakeFront: 0.78,
};

/** Camionnette : 2 100 kg à vide chargée du conducteur, 64 kW aux roues, 145 km/h, grande surface frontale, haute (0,85 m), freinage ≈ 0,8 g, direction plus lente. */
export const VAN: VehicleSpec = {
  ...CAR, mass: 2100, yawInertia: 3999, front: 1.3, rear: 1.7, maxSteer: 0.58, steerFade: 12, steerRate: 1.6, grip: 0.9,
  corneringFront: 95000, corneringRear: 110000, power: 64000, maxDrive: 6800, driveFadeFrom: kmh(130), topSpeed: kmh(145),
  maxBrake: 17000, reverseForce: 5200, drag: 0.63, hull: [[1.26, 0.94], [-0.25, 0.96], [-1.76, 0.94]], wheelRadius: 0.33, bodyRoll: 0.026, engineBrake: 500, cgHeight: 0.85, brakeFront: 0.75, steerGrip: 1.3,
};

/**
 * Vieille voiture : 1 100 kg, 46 kW aux roues, 160 km/h, pneus usés (adhérence 0,8, roulement plus fort), freins fatigués (≈ 0,83 g) et **pas d'ABS** :
 * freinée à fond, les roues avant se bloquent, comme avant D29 ; suspension molle.
 */
export const OLD_CAR: VehicleSpec = {
  ...CAR, mass: 1100, yawInertia: 1514, front: 1.05, rear: 1.5, grip: 0.8,
  corneringFront: 48000, corneringRear: 55000, power: 46000, maxDrive: 4100, driveFadeFrom: kmh(148), topSpeed: kmh(160),
  maxBrake: 9000, reverseForce: 2900, rolling: 0.016, drag: 0.43, hull: [[1.02, 0.81], [-0.22, 0.83], [-1.46, 0.81]], wheelRadius: 0.29, bodyRoll: 0.02, engineBrake: 300, abs: false, steerGrip: 1.3,
};

/**
 * Sportive à propulsion : 1 450 kg, 190 kW aux roues, 0 à 100 km/h en ≈ 5 s, 240 km/h réels, plafonnée à 200 km/h ; pneus larges (adhérence 1,15),
 * centre de gravité bas (0,45 m), roue arrière motrice (elle peut décrocher en sortie de virage).
 */
export const SPORT_CAR: VehicleSpec = limited({
  ...CAR, mass: 1450, yawInertia: 2074, front: 1.28, rear: 1.32, maxSteer: 0.55, steerFade: 16, steerRate: 2, grip: 1.15,
  corneringFront: 108000, corneringRear: 125000, power: 190000, maxDrive: 8800, driveFadeFrom: kmh(225), topSpeed: kmh(240),
  maxBrake: 17000, reverseForce: 3900, drag: 0.38, hull: [[1.29, 0.91], [-0.02, 0.93], [-1.34, 0.91]], wheelRadius: 0.33, bodyRoll: 0.008, engineBrake: 450, driveAxle: "rear", cgHeight: 0.45, brakeFront: 0.66,
}, SPEED_CAP.car);
