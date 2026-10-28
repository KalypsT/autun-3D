/**
 * Ressenti (lot rapide après J7, D90) : logique pure de la sensation de vitesse (champ de vision, tremblement de la caméra, traits de
 * vitesse) et des vibrations du téléphone. Analogie : le siège qui vibre et le paysage qui s'étire au cinéma ; rien ne change à la
 * physique, seulement à ce qu'on perçoit.
 */

/** Champ de vision au repos (degrés), comme la caméra créée par `main.ts`. */
export const BASE_FOV = 62;

/**
 * Champ de vision (degrés) selon la vitesse (m/s) : à pied, un peu plus large en courant ; au volant, il s'ouvre de plus en plus
 * lentement (+6° à 50 km/h, +10° à 90 km/h, +15° à 200 km/h), sans jamais dépasser +18°.
 */
export function speedFov(speed: number, driving: boolean): number {
  const v = Math.abs(speed);
  if (!driving) return BASE_FOV + Math.min(v * 0.8, 4);
  return BASE_FOV + 18 * (1 - Math.exp(-v / 30));
}

/** Traits de vitesse (0-1) : rien sous 100 km/h, pleins à 200 km/h. */
export function speedLines(speed: number): number {
  const kmh = Math.abs(speed) * 3.6;
  return Math.min(Math.max((kmh - 100) / 100, 0), 1);
}

/**
 * Tremblement de la caméra : un léger frémissement qui grandit avec la vitesse au volant, et une secousse à chaque choc, qui
 * s'amortit en un tiers de seconde. Somme de sinus de fréquences sans rapport simple : pas de répétition visible, et le même
 * résultat d'une partie à l'autre (pas de hasard).
 */
export class CameraShake {
  private t = 0;
  private kick = 0;
  /** Décalage de la caméra (m) : x à droite, y en haut, à ajouter à sa position. */
  readonly offset = { x: 0, y: 0 };

  /** Un choc (vitesse d'impact, m/s) : secousse proportionnelle, plafonnée. */
  impact(speed: number): void {
    this.kick = Math.max(this.kick, Math.min(speed / 12, 1) * 0.25);
  }

  /** Avance de `dt` (s) ; `speed` (m/s) au volant, 0 à pied. */
  step(dt: number, speed: number): void {
    this.t += dt;
    this.kick *= Math.exp(-dt / 0.12);
    const v = Math.abs(speed);
    const rumble = v > 12 ? Math.min(((v - 12) / 45) ** 2, 1) * 0.035 : 0;
    const t = this.t;
    const k = this.kick;
    this.offset.x = rumble * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.3) * 0.4) + k * Math.sin(t * 61.7);
    this.offset.y = rumble * (Math.sin(t * 41.9) * 0.5 + Math.sin(t * 29.7) * 0.5) + k * Math.sin(t * 53.3 + 1);
  }
}

/** Vibreur du téléphone : `navigator.vibrate`, ou rien (ordinateur, essais). */
export type Vibrate = (pattern: number | number[]) => void;

/**
 * Vibrations : chaque événement a sa durée, et un vibreur ne se relance pas plus d'une fois toutes les 60 ms (Android coupe la
 * vibration en cours à chaque appel : des appels trop serrés ne feraient qu'un bourdonnement). Une vibration plus forte que celle en
 * cours passe toujours.
 */
export class Haptics {
  enabled = true;
  private busy = 0;
  private strength = 0;

  constructor(private readonly vibrate: Vibrate | null) {}

  /** Avance l'horloge (s). */
  step(dt: number): void {
    this.busy = Math.max(0, this.busy - dt);
    if (this.busy === 0) this.strength = 0;
  }

  /** Vibre `ms` millisecondes, ou suit un motif (vibre, pause, vibre…). Rend vrai si la vibration est partie. */
  pulse(pattern: number | number[]): boolean {
    if (!this.enabled || !this.vibrate) return false;
    const total = typeof pattern === "number" ? pattern : pattern.reduce((a, b) => a + b, 0);
    const strength = typeof pattern === "number" ? pattern : Math.max(...pattern);
    if (this.busy > 0 && strength <= this.strength) return false;
    this.busy = Math.max(total / 1000, 0.06);
    this.strength = strength;
    this.vibrate(pattern);
    return true;
  }

  /** Choc du véhicule (vitesse d'impact, m/s) : de 20 ms (frôlement) à 140 ms (choc violent). */
  crash(speed: number): void {
    if (speed >= 1.2) this.pulse(Math.round(20 + Math.min(speed / 12, 1) * 120));
  }

  /** Coup de feu du joueur : bref pour le fusil d'assaut (dix par seconde), plus long pour le fusil à pompe. */
  shot(gun: "pistol" | "shotgun" | "rifle"): void {
    this.pulse(gun === "shotgun" ? 45 : gun === "pistol" ? 18 : 9);
  }

  /** Coup qui porte (corps à corps), passant heurté au volant. */
  hit(): void {
    this.pulse(25);
  }

  /** Coup reçu. */
  hurt(): void {
    this.pulse(60);
  }

  death(): void {
    this.pulse([90, 70, 180]);
  }

  arrest(): void {
    this.pulse([40, 60, 40]);
  }
}
