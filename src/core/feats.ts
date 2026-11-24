/**
 * Sensations (plaisir de jeu, lot 1-3, D311) : logique pure des exploits en véhicule et du temps ralenti. Rien ne change à la physique :
 * on mesure ce que fait le véhicule (un saut, un dérapage) pour l'afficher, et l'on dit au jeu à quelle vitesse faire passer le temps.
 * Analogie : le ralenti du replay et l'arrêt sur image d'un film d'action, posés par-dessus la même scène.
 */

/** Gravité des véhicules (m/s²), comme `CAR_GRAVITY` (la physique en vol). */
const GRAVITY = 7.4;
/** Un saut compte (bandeau, records) à partir de cette longueur (m). */
export const JUMP_SHOW = 15;
/** Un saut plus court que cela n'est pas un saut (bosse, trottoir) : rien n'est mesuré. */
const JUMP_MIN_AIR = 0.25;
/** Ralenti : seulement si l'on prévoit un saut d'au moins `JUMP_SHOW` m, à plus de `SLOWMO_HEIGHT` m du sol, et pas plus de `SLOWMO_MAX` s. */
const SLOWMO_HEIGHT = 1.2;
const SLOWMO_MAX = 1.1;
/** Vitesse du temps pendant le ralenti. */
export const SLOWMO_SCALE = 0.35;

export interface JumpResult {
  /** Longueur (m, à l'horizontale, du décollage à la réception), hauteur au-dessus du point de décollage (m), temps en l'air (s). */
  distance: number;
  height: number;
  air: number;
}

/** Sauts d'un véhicule : décollage, ralenti pendant les grands sauts, longueur à la réception. */
export class JumpTracker {
  private flying = false;
  private x0 = 0;
  private y0 = 0;
  private z0 = 0;
  private top = 0;
  private air = 0;
  private slow = 0;
  /** Ralenti demandé (pendant un grand saut). */
  slowmo = false;

  /**
   * `airborne` : roues décollées ; (x, y, z) position ; `ground` hauteur du sol sous le véhicule ; (vx, vy, vz) vitesse (m/s) ; `dt` temps
   * réel écoulé (pour borner le ralenti). Renvoie le saut à la réception, s'il a duré assez pour en être un, sinon null.
   */
  update(airborne: boolean, x: number, y: number, z: number, ground: number, vx: number, vy: number, vz: number, dt: number, realDt = dt): JumpResult | null {
    if (airborne && !this.flying) {
      this.flying = true;
      this.x0 = x;
      this.y0 = y;
      this.z0 = z;
      this.top = z;
      this.air = 0;
      this.slow = 0;
    }
    if (!this.flying) return null;
    if (airborne) {
      this.air += dt;
      this.top = Math.max(this.top, z);
      // Atterrissage prévu : chute libre depuis la hauteur actuelle au-dessus du sol (sol supposé plat devant).
      const h = Math.max(z - ground, 0);
      const tLand = (vz + Math.sqrt(vz * vz + 2 * GRAVITY * h)) / GRAVITY;
      const done = Math.hypot(x - this.x0, y - this.y0);
      const predicted = done + Math.hypot(vx, vy) * tLand;
      const want = h > SLOWMO_HEIGHT && predicted >= JUMP_SHOW && this.slow < SLOWMO_MAX;
      if (want) this.slow += realDt;
      this.slowmo = want;
      return null;
    }
    // Réception.
    this.flying = false;
    this.slowmo = false;
    if (this.air < JUMP_MIN_AIR) return null;
    return { distance: Math.hypot(x - this.x0, y - this.y0), height: Math.max(this.top - this.z0, 0), air: this.air };
  }

  /** Saut interrompu (descente du véhicule, téléportation). */
  reset(): void {
    this.flying = false;
    this.slowmo = false;
  }
}

/** Dérapage : angle de glisse (rad) au-delà duquel on dérape, en deçà duquel on se rétablit, et vitesse minimale (m/s). */
const DRIFT_IN = 0.3;
const DRIFT_OUT = 0.16;
const DRIFT_SPEED = 8;
/** Temps rétabli (s) qui termine un dérapage (une correction brève ne le coupe pas). */
const DRIFT_END = 0.45;
/** Un dérapage compte (bandeau, records) à partir de cette longueur (m). */
export const DRIFT_SHOW = 12;

export interface DriftResult {
  /** Longueur parcourue en dérapage (m), angle le plus ouvert (rad), durée (s). */
  distance: number;
  angle: number;
  time: number;
}

/** Angle de glisse (rad, 0-π) entre le cap du véhicule et sa vitesse ; 0 à l'arrêt. Marche arrière : comparé au cap opposé. */
export function slipAngle(heading: number, vx: number, vy: number): number {
  if (Math.hypot(vx, vy) < 0.5) return 0;
  const move = Math.atan2(vx, vy);
  const d = Math.abs(((((move - heading) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return d;
}

/** Dérapages d'une voiture : longueur et angle, résultat à la fin du dérapage. */
export class DriftTracker {
  private active = false;
  private calm = 0;
  /** Dérapage en cours : longueur (m), angle maximal (rad), durée (s). */
  distance = 0;
  angle = 0;
  time = 0;

  get drifting(): boolean {
    return this.active;
  }

  /** `slip` angle de glisse (rad), `speed` vitesse (m/s), `ground` roues au sol. Renvoie le dérapage qui vient de finir, ou null. */
  update(slip: number, speed: number, ground: boolean, dt: number): DriftResult | null {
    // Un tête-à-queue (glisse de plus de 110°) n'est plus un dérapage : il l'interrompt.
    const sliding = ground && speed >= DRIFT_SPEED && slip < 1.9 && slip > (this.active ? DRIFT_OUT : DRIFT_IN);
    if (sliding) {
      if (!this.active) {
        this.active = true;
        this.distance = this.angle = this.time = 0;
      }
      this.calm = 0;
      this.distance += speed * dt;
      this.time += dt;
      this.angle = Math.max(this.angle, slip);
      return null;
    }
    if (!this.active) return null;
    this.calm += dt;
    // En l'air ou après un tête-à-queue : fini tout de suite ; sinon, après un court temps rétabli.
    if (ground && slip < 1.9 && this.calm < DRIFT_END) {
      this.distance += speed * dt;
      return null;
    }
    this.active = false;
    return { distance: this.distance, angle: this.angle, time: this.time };
  }

  reset(): void {
    this.active = false;
  }
}

/** Arrêt sur image d'un coup qui porte (s) et vitesse du temps pendant cet arrêt. */
export const HIT_STOP = 0.06;
const HIT_STOP_SCALE = 0.05;

/** Vitesse du temps du jeu : 1 en temps normal, moins pendant un arrêt sur image ou un ralenti (l'entrée et la sortie sont lissées). */
export class TimeScale {
  private stop = 0;
  private current = 1;
  /** Ralenti autorisé (réglage « Ralenti »). */
  slowmoEnabled = true;

  /** Un coup a porté : le temps se fige un instant. */
  hitStop(duration = HIT_STOP): void {
    this.stop = Math.max(this.stop, duration);
  }

  /** `realDt` : temps réel écoulé (s) ; `slowmo` : un grand saut est en cours. Renvoie la vitesse du temps pour cette image. */
  update(realDt: number, slowmo: boolean): number {
    if (this.stop > 0) {
      this.stop -= realDt;
      return HIT_STOP_SCALE;
    }
    const target = slowmo && this.slowmoEnabled ? SLOWMO_SCALE : 1;
    // Entrée franche (un quart de seconde), sortie un peu plus douce.
    const rate = target < this.current ? 10 : 6;
    this.current += (target - this.current) * Math.min(1, realDt * rate);
    if (Math.abs(this.current - target) < 0.01) this.current = target;
    return this.current;
  }
}

/** Texte d'un bandeau d'exploit : « Saut 34 m », « Dérapage 42 m », avec « record ! » si c'est le meilleur. */
export function featLabel(kind: "jump" | "drift", distance: number, record: boolean): string {
  const name = kind === "jump" ? "Saut" : "Dérapage";
  return `${name} ${Math.round(distance)} m${record ? " · record !" : ""}`;
}
