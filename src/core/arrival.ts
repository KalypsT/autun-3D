/**
 * Arrivée à la gare d'une nouvelle partie (D338) : l'autorail TER qui entre en gare le long du quai 1, le personnage qui en descend, et les
 * plans de la cinématique. Logique pure (aucun objet three.js) : positions dans le repère du jeu (x à l'est, y au nord, mètres).
 *
 * Repère de la gare (D228, `kinds/24_37.json`, modèle `station`) : origine au coin ouest de la façade sur le parvis, s le long de la façade
 * (de l'ouest vers l'est), t vers les voies. Quai 1 de t = 8,7 (mur) à t = 13,3 (bord), voie du quai 1 vers t = 15,5 ; pavillon central de
 * s = 17,7 à 33,1 (passage vers le parvis).
 */

export const STATION = { o: [-464.87, 494.08] as const, a: 0.65151 };

/** Point du repère de la gare (s le long de la façade, t vers les voies) dans le repère du jeu. */
export function stationPoint(s: number, t: number): [number, number] {
  const ux = Math.cos(STATION.a), uy = Math.sin(STATION.a);
  return [STATION.o[0] + ux * s - uy * t, STATION.o[1] + uy * s + ux * t];
}

/** Cap (rad, 0 = nord, sens horaire) d'une direction (ds, dt) du repère de la gare. */
export function stationHeading(ds: number, dt: number): number {
  const ux = Math.cos(STATION.a), uy = Math.sin(STATION.a);
  return Math.atan2(ux * ds - uy * dt, uy * ds + ux * dt);
}

/**
 * Voie du quai 1, d'ouest en est (rails des données, `structures/23_36`, `23_37`, `24_37` : s ≈ −197 à 176). Le train y avance vers l'est,
 * s'arrête devant le pavillon et repart vers l'ouest (Autun est un terminus pour les TER).
 */
export const TRACK: readonly (readonly [number, number])[] = [
  [-628.74, 384.64], [-607.75, 399.99], [-574.3, 426.83], [-563.25, 435.69], [-519.58, 470.4],
  [-469.14, 510.19], [-447.67, 527.07], [-407.69, 559.07], [-396.91, 567.91], [-336.57, 616.88],
];

/** Point d'une polyligne à une distance donnée depuis son début, avec le cap de son segment. */
export interface TrackPoint {
  x: number;
  y: number;
  heading: number;
}

/** Polyligne parcourue à l'abscisse curviligne : position, cap, projection d'un point. */
export class Track {
  readonly length: number;
  private readonly cum: number[] = [0];

  constructor(private readonly pts: readonly (readonly [number, number])[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    this.length = this.cum[this.cum.length - 1]!;
  }

  /** Point à la distance `d` (bornée au tracé). */
  at(d: number, out: TrackPoint = { x: 0, y: 0, heading: 0 }): TrackPoint {
    const dd = Math.min(Math.max(d, 0), this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < dd) i++;
    const a = this.pts[i - 1]!, b = this.pts[i]!, l = this.cum[i]! - this.cum[i - 1]!;
    const k = l > 0 ? (dd - this.cum[i - 1]!) / l : 0;
    out.x = a[0] + (b[0] - a[0]) * k;
    out.y = a[1] + (b[1] - a[1]) * k;
    out.heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
    return out;
  }

  /** Distance le long du tracé du point le plus proche de (x, y). */
  project(x: number, y: number): number {
    let best = Infinity, bestD = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1]!, b = this.pts[i]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const k = l2 > 0 ? Math.min(Math.max(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0), 1) : 0;
      const px = a[0] + dx * k, py = a[1] + dy * k, e = Math.hypot(x - px, y - py);
      if (e < best) {
        best = e;
        bestD = this.cum[i - 1]! + Math.sqrt(l2) * k;
      }
    }
    return bestD;
  }
}

/** Autorail TER : une voiture, longueur, demi-largeur, hauteur du plancher et du toit au-dessus du rail, porte arrière (depuis le centre, m). */
export const TER = { length: 28.9, halfWidth: 1.45, floor: 1.15, roof: 3.85, door: -9.3 } as const;

/** Déroulé de la cinématique (s) : arrivée du train, porte, le personnage descend et marche, fin. */
export const CINE = { arrive: 18, door: 18.6, out: 19.6, walk: 3.2, end: 26.5 } as const;
/** Distance d'approche (m) : le train paraît à cette distance de son arrêt et freine régulièrement jusqu'à lui (≈ 56 km/h au début). */
export const APPROACH = 140;
/** Le train repart ce temps (s) après la fin de la cinématique ; il accélère (m/s²) et disparaît à cette distance de son arrêt (m). */
export const DEPART = { after: 30, accel: 0.55, gone: 240 } as const;

/** Centre du train à l'arrêt : sa porte arrière devant le passage du pavillon (s ≈ 22). */
const STOP_S = 22 - TER.door;

export const TRACK_LINE = new Track(TRACK);
/** Distance le long de la voie du centre du train à l'arrêt. */
export const STOP_D = TRACK_LINE.project(...stationPoint(STOP_S, 15.6));

/** Distance le long de la voie du centre du train à l'instant `t` de la cinématique (freinage régulier jusqu'à l'arrêt). */
export function arrivalDistance(t: number): number {
  const left = Math.max(CINE.arrive - Math.max(t, 0), 0);
  const a = (2 * APPROACH) / (CINE.arrive * CINE.arrive);
  return STOP_D - 0.5 * a * left * left;
}

/** Distance du centre du train `t` secondes après son départ (il recule vers l'ouest), ou null une fois parti. */
export function departureDistance(t: number): number | null {
  const back = 0.5 * DEPART.accel * Math.max(t, 0) ** 2;
  return back > DEPART.gone ? null : STOP_D - back;
}

/** Le personnage : il paraît sur le quai devant la porte, marche vers le pavillon (−t), et la main lui revient là. */
export const DOOR_STEP = stationPoint(22, 13.6);
export const WALK_END = stationPoint(22, 10.6);
/** Cap de la marche (vers le bâtiment) ; c'est aussi le cap de départ du joueur. */
export const WALK_HEADING = stationHeading(0, -1);

/** Un plan : caméra (position, hauteur au-dessus du sol), point regardé ou avant du train (`train` : à cette hauteur), champ de vision (°). */
export interface Shot {
  from: [number, number, number];
  look: [number, number, number] | { train: number };
  fov: number;
}

/**
 * Plans de la cinématique : (1) depuis le bout est du quai, au téléobjectif, le train qui approche ; (2) au ras du quai, le train qui
 * passe et s'arrête, suivi par la caméra ; (3) face à la porte : le personnage descend et marche vers la gare.
 */
export function shotAt(t: number): Shot {
  if (t < 8) return { from: [...stationPoint(62, 13.4), 1.75], look: { train: 2.2 }, fov: 30 };
  if (t < CINE.door) return { from: [...stationPoint(6, 12.6), 0.9], look: { train: 1.8 }, fov: 55 };
  return { from: [...stationPoint(31, 11.4), 1.6], look: [...stationPoint(21.5, 13.2), 1.2], fov: 50 };
}
