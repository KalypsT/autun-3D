/**
 * Sons (étape J7, D89) : logique pure, sans Web Audio. Ce module décide *quoi* jouer et *comment fort* ; `src/audio/` fabrique les sons.
 * Analogie : la partition et le chef d'orchestre (ici) d'un côté, les instruments (`src/audio/`) de l'autre.
 * Repère du jeu : x est, y nord, cap 0 = nord, sens horaire (comme `vehicle.ts`).
 */

// --- Moteurs ---------------------------------------------------------------------------------------------------------------

/** Façon dont un véhicule fait du bruit : moteur thermique (boîte manuelle ou variateur), électrique, ou pédales. */
export type EngineKind = "combustion" | "electric" | "pedal";

export interface EngineProfile {
  kind: EngineKind;
  /** Cylindres : la fréquence d'allumage vaut régime / 60 × cylindres / 2 (quatre temps). */
  cylinders: number;
  /** Ralenti et zone rouge (tr/min). */
  idle: number;
  redline: number;
  /** Rapports de boîte (0 : variateur, scooter). */
  gears: number;
  /** Diesel : plus de claquement, moins de tours. */
  diesel: boolean;
  /** Brillance du son (0 sourd à 1 aigu) et irrégularité (0 lisse à 1 « patate », bicylindre, vieille voiture). */
  bright: number;
  rough: number;
  /** Pétarades au lever de pied à haut régime (sportives). */
  pops: boolean;
}

const car = (o: Partial<EngineProfile>): EngineProfile => ({ kind: "combustion", cylinders: 4, idle: 800, redline: 6200, gears: 5, diesel: false, bright: 0.45, rough: 0.15, pops: false, ...o });

/** Profil sonore de chaque modèle du catalogue (identifiants de `vehicle-catalog.ts`) ; un modèle inconnu prend celui de sa famille. */
export const ENGINE_PROFILES: Readonly<Record<string, EngineProfile>> = {
  "velo-ville": { ...car({}), kind: "pedal", cylinders: 0, idle: 0, redline: 120, gears: 0 },
  vtt: { ...car({}), kind: "pedal", cylinders: 0, idle: 0, redline: 120, gears: 0 },
  trottinette: { ...car({}), kind: "electric", cylinders: 0, idle: 0, redline: 6000, gears: 0, bright: 0.7 },
  citadine: car({ cylinders: 3, idle: 850, redline: 6300, rough: 0.3, bright: 0.5 }),
  compacte: car({}),
  berline: car({ redline: 6000, bright: 0.35, rough: 0.1, gears: 6 }),
  break: car({ diesel: true, idle: 780, redline: 4600, bright: 0.3, gears: 6 }),
  "petit-suv": car({ cylinders: 3, redline: 6000, rough: 0.28 }),
  camionnette: car({ diesel: true, idle: 750, redline: 4300, bright: 0.25, rough: 0.25 }),
  "vieille-voiture": car({ idle: 700, redline: 5200, gears: 4, bright: 0.3, rough: 0.55 }),
  sportive: car({ cylinders: 6, idle: 950, redline: 7800, gears: 6, bright: 0.8, rough: 0.08, pops: true }),
  gendarmerie: car({ redline: 6200, bright: 0.45 }),
  // Jeep militaire (D114) : vieux diesel rugueux, peu de rapports.
  "jeep-militaire": car({ diesel: true, idle: 720, redline: 4400, gears: 4, bright: 0.28, rough: 0.5 }),
  "scooter-125": car({ cylinders: 1, idle: 1600, redline: 9000, gears: 0, bright: 0.65, rough: 0.35 }),
  "moto-routiere": car({ cylinders: 2, idle: 1100, redline: 9500, gears: 6, bright: 0.5, rough: 0.6 }),
  "moto-sportive": car({ cylinders: 4, idle: 1300, redline: 13500, gears: 6, bright: 0.9, rough: 0.05, pops: true }),
};

const FAMILY_PROFILE: Readonly<Record<string, string>> = { bike: "velo-ville", kickscooter: "trottinette", car: "compacte", moto: "moto-routiere" };

export function engineProfile(id: string, family: string): EngineProfile {
  return ENGINE_PROFILES[id] ?? ENGINE_PROFILES[FAMILY_PROFILE[family] ?? "compacte"]!;
}

/** Fréquence d'allumage (Hz) : la note fondamentale d'un moteur thermique. */
export function firingHz(p: EngineProfile, rpm: number): number {
  return (rpm / 60) * (p.cylinders / 2);
}

/** Durée d'un passage de rapport (s) : on coupe les gaz pendant ce temps. */
export const SHIFT_TIME = 0.22;

/**
 * Régime d'un moteur imaginaire : la physique des véhicules (`vehicle.ts`) n'a pas de boîte de vitesses, on en invente une pour le son.
 * Le dernier rapport atteint la vitesse maximale un peu sous la zone rouge ; chaque rapport inférieur en est une fraction fixe.
 * Montée de rapport d'autant plus tard qu'on accélère fort, descente quand le régime tombe.
 */
export class EngineModel {
  rpm: number;
  /** Rapport engagé (1 à `gears`), 0 au point mort à l'arrêt, −1 en marche arrière. */
  gear = 0;
  /** Charge 0-1 : ouvre le son (filtre, souffle), lissée. */
  load = 0;
  /** Temps restant du passage de rapport en cours (s). */
  shifting = 0;
  /** Vrai à l'image où un rapport passe (pour un petit bruit de boîte), remis à faux à chaque pas. */
  shifted = false;
  /** Pied levé à haut régime (pétarades des sportives). */
  overrun = false;
  /** Vitesse en haut de chaque rapport (m/s), du 1er au dernier. */
  readonly gearTop: number[] = [];

  constructor(readonly profile: EngineProfile, readonly topSpeed: number, readonly reverseSpeed = 4) {
    this.rpm = profile.idle;
    const n = profile.gears;
    const spread = n >= 6 ? 0.76 : n === 5 ? 0.72 : 0.66;
    for (let g = 0; g < n; g++) this.gearTop.push(topSpeed * 1.06 * spread ** (n - 1 - g));
  }

  /** Régime qu'aurait le moteur dans un rapport à cette vitesse (m/s). */
  rpmInGear(gear: number, speed: number): number {
    return (Math.abs(speed) / this.gearTop[gear - 1]!) * this.profile.redline;
  }

  /** Un pas : vitesse longitudinale signée (m/s), accélérateur 0-1. */
  step(dt: number, speed: number, throttle: number): void {
    const p = this.profile, v = Math.abs(speed);
    this.shifted = false;
    throttle = clamp(throttle, 0, 1);
    let target: number;
    if (p.kind === "pedal") {
      // Cadence de pédalage (tr/min) : elle suit la vitesse, nulle en roue libre.
      target = throttle > 0.05 ? 50 + (v / Math.max(this.topSpeed, 1)) * 60 : 0;
      this.gear = 0;
    } else if (p.kind === "electric") {
      target = (v / Math.max(this.topSpeed, 1)) * p.redline;
      this.gear = 0;
    } else if (p.gears === 0) {
      // Variateur (scooter) : le régime monte d'un coup avec la poignée et reste à peu près constant pendant que la vitesse grimpe.
      const held = p.idle + (0.5 + 0.35 * (v / this.topSpeed)) * (p.redline - p.idle) * Math.sqrt(throttle);
      target = Math.max(held, p.idle + (v / this.topSpeed) * (p.redline - p.idle) * 0.9);
      this.gear = v > 0.3 ? 1 : 0;
    } else if (speed < -0.3) {
      this.gear = -1;
      target = p.idle + (v / Math.max(this.reverseSpeed, 0.5)) * 0.45 * p.redline;
    } else {
      const n = p.gears;
      if (this.gear <= 0) this.gear = 1;
      // Seuils de passage : tard quand on accélère fort, tôt quand on roule tranquille.
      const up = p.redline * (0.42 + 0.48 * throttle);
      const down = p.redline * (0.24 + 0.2 * throttle);
      if (this.shifting <= 0) {
        if (this.gear < n && this.rpmInGear(this.gear, v) > up) {
          this.gear++;
          this.shifting = SHIFT_TIME;
          this.shifted = true;
        } else if (this.gear > 1 && this.rpmInGear(this.gear, v) < down && this.rpmInGear(this.gear - 1, v) < up * 0.95) {
          this.gear--;
          this.shifting = SHIFT_TIME * 0.7;
          this.shifted = true;
        }
      }
      const coupled = this.rpmInGear(this.gear, v);
      // Embrayage qui patine en 1re : le moteur monte quand on accélère à l'arrêt, sans attendre la vitesse.
      const slip = this.gear === 1 ? p.idle + throttle * (0.38 * p.redline - p.idle) * clamp(1 - v / (this.gearTop[0]! * 0.35), 0, 1) : 0;
      target = Math.max(coupled, slip, p.idle);
      if (v < 0.3 && throttle < 0.05) this.gear = 0;
    }
    if (this.gear === 0 && p.kind === "combustion" && p.gears > 0) target = p.idle + throttle * (0.7 * p.redline - p.idle);
    this.shifting = Math.max(0, this.shifting - dt);
    target = Math.min(target, p.redline * 1.02);
    // Le moteur monte plus vite qu'il ne redescend ; pendant un passage de rapport, il plonge vers le nouveau régime.
    const rate = this.shifting > 0 ? 14 : target > this.rpm ? 7 : 4;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
    const wantLoad = this.shifting > 0 ? 0 : throttle;
    this.load += (wantLoad - this.load) * Math.min(1, dt * 10);
    this.overrun = p.pops && throttle < 0.05 && this.rpm > 0.55 * p.redline && v > 5;
  }
}

// --- Espace : distance, stéréo, Doppler ------------------------------------------------------------------------------------

/**
 * Gain selon la distance (m) : plein jusqu'à `ref`, puis en 1/d (comme dans la rue), et fondu à zéro avant `max` pour qu'une voix
 * puisse s'éteindre sans à-coup.
 */
export function distanceGain(d: number, ref: number, max: number): number {
  if (d >= max) return 0;
  const g = d <= ref ? 1 : ref / d;
  const fadeFrom = max * 0.7;
  if (d <= fadeFrom) return g;
  const u = (d - fadeFrom) / (max - fadeFrom);
  return g * (1 - u * u * (3 - 2 * u));
}

/** Coupure des aigus selon la distance (Hz) : l'air et les façades étouffent les sons lointains. */
export function distanceCutoff(d: number): number {
  return clamp(18000 / (1 + d / 25), 500, 18000);
}

/**
 * Place d'une source à l'écoute : `pan` (−1 gauche à 1 droite) et `behind` (0 devant ou de côté, 1 juste derrière), pour une
 * caméra qui regarde vers `yaw`. Le panoramique est borné : les deux oreilles entendent toujours un peu.
 */
export function stereo(lx: number, ly: number, yaw: number, x: number, y: number, out: { pan: number; behind: number }): { pan: number; behind: number } {
  const dx = x - lx, dy = y - ly;
  if (dx * dx + dy * dy < 1e-6) {
    out.pan = 0;
    out.behind = 0;
    return out;
  }
  const rel = Math.atan2(dx, dy) - yaw;
  out.pan = Math.sin(rel) * 0.85;
  out.behind = Math.max(0, -Math.cos(rel));
  return out;
}

/** Vitesse du son (m/s). */
export const SOUND_SPEED = 343;

/**
 * Effet Doppler : facteur de hauteur d'une source (vitesse sx, sy) entendue par un auditeur (vitesse lx, ly), séparés de (dx, dy)
 * (source moins auditeur). Plus aigu quand ils se rapprochent, plus grave quand ils s'éloignent ; borné pour rester musical.
 */
export function doppler(dx: number, dy: number, svx: number, svy: number, lvx: number, lvy: number): number {
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return 1;
  // Vitesse radiale relative, positive quand la source s'éloigne.
  const vr = ((svx - lvx) * dx + (svy - lvy) * dy) / d;
  return clamp(SOUND_SPEED / (SOUND_SPEED + vr), 0.8, 1.25);
}

/**
 * Attribution des voix : `slots` contient l'identifiant joué par chaque voix (null : libre). Les `wanted` (déjà triés du plus fort au
 * moins fort, au plus `slots.length`) gardent leur voix s'ils en avaient une ; les autres prennent les voix libérées. Une voiture qui
 * reste parmi les plus fortes ne change jamais de voix (pas de saut dans le son).
 */
export function assignVoices(slots: (number | null)[], wanted: readonly number[]): void {
  const keep = new Set(wanted.slice(0, slots.length));
  for (let i = 0; i < slots.length; i++) if (slots[i] !== null && !keep.has(slots[i]!)) slots[i] = null;
  const held = new Set(slots);
  for (const id of keep) {
    if (held.has(id)) continue;
    const free = slots.indexOf(null);
    if (free < 0) break;
    slots[free] = id;
  }
}

// --- Temps : cloches, pas, ambiance ----------------------------------------------------------------------------------------

/** Cloches de la cathédrale Saint-Lazare (`public/data/map/places.json`) : elles sonnent les heures. */
export const CATHEDRAL = { x: 36.6, y: -571.5 } as const;
/** Les cloches se taisent la nuit : première et dernière heure sonnées. */
export const BELLS_FROM = 7;
export const BELLS_UNTIL = 21;

/**
 * Coups à sonner quand l'horloge passe de `prev` à `hour` (heures de 0 à 24) : le nombre de l'heure (1 à 12) au passage d'une heure
 * pleine entre 7 h et 21 h, avec une volée à midi ; rien sinon. Un saut (reprise après une arrestation, la mort) ne sonne pas.
 */
export function bellStrikes(prev: number, hour: number): { strikes: number; peal: boolean } | null {
  let step = hour - prev;
  if (step < 0) step += 24;
  if (step <= 0 || step > 0.25) return null;
  const h = Math.floor(hour) % 24;
  // Passage d'une heure pleine : la partie entière a changé (ou on vient de passer minuit).
  if (Math.floor(prev) % 24 === h) return null;
  if (h < BELLS_FROM || h > BELLS_UNTIL) return null;
  return { strikes: h % 12 === 0 ? 12 : h % 12, peal: h === 12 };
}

/**
 * Pas : vrai si la phase de marche (0 à 2π, `player-model.ts`) a passé un appui (π/2 ou 3π/2 : la jambe tendue devant) entre deux images.
 */
export function stepCrossed(prev: number, phase: number): boolean {
  const TAU = Math.PI * 2;
  let d = phase - prev;
  if (d < 0) d += TAU;
  if (d <= 0 || d > Math.PI) return false;
  for (const at of [Math.PI / 2, (3 * Math.PI) / 2]) {
    let u = at - prev;
    if (u <= 0) u += TAU;
    if (u <= d) return true;
  }
  return false;
}

export interface Ambience {
  /** Chants d'oiseaux 0-1 : chœur de l'aube, plus rares le jour, aucun la nuit, moitié moins hors de la belle saison. */
  birds: number;
  /** Grillons 0-1 : nuits d'été seulement. */
  crickets: number;
  /** Hulottes : nuit seulement (0-1, une probabilité relative). */
  owls: number;
  /** Rumeur de la ville 0-1 : suit l'activité de la journée. */
  city: number;
}

/** Ambiance selon l'heure (0-24) et le jour de l'année (1-365). */
export function ambience(hour: number, day: number): Ambience {
  const h = ((hour % 24) + 24) % 24;
  const bump = (from: number, peak0: number, peak1: number, to: number): number =>
    h <= from || h >= to ? 0 : h < peak0 ? (h - from) / (peak0 - from) : h <= peak1 ? 1 : (to - h) / (to - peak1);
  const summer = day >= 120 && day <= 270;
  const season = day >= 75 && day <= 300 ? 1 : 0.5;
  const birds = Math.max(bump(4.5, 6.5, 8, 10), 0.35 * bump(8, 9.5, 16.5, 18), 0.5 * bump(16.5, 18, 19.5, 21)) * season;
  const night = h >= 21.5 || h < 5 ? 1 : h >= 20.5 ? h - 20.5 : h < 6 ? 6 - h : 0;
  const crickets = summer ? Math.min(1, night) : 0;
  const owls = Math.min(1, night);
  const city = 0.2 + 0.8 * Math.max(bump(5.5, 8, 19, 23), 0);
  return { birds, crickets, owls, city };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
