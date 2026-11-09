import type { Deck, TownHallSpec } from "../data/types";
import type { Pit } from "../data/terrain";
import type { Top } from "./collision";

/**
 * Hôtel de ville (D123 à D126, D293, D294) : disposition des escaliers, partagée par le dessin (`render/monuments.ts`), les tabliers où l'on
 * marche et les obstacles. Repère du bâtiment : `s` le long de la façade sur le Champ de Mars (de l'ouest, côté théâtre, vers l'est), `t` vers
 * l'intérieur (la place est en t < 0), altitudes absolues. Logique pure.
 */

/** Saillie des pavillons sur la façade (m) : le mur de l'avant-corps central, où s'appuie le palier du perron, est en t = −HALL_PROJ. */
export const HALL_PROJ = 0.35;

/**
 * Perron de la façade d'après les photos de l'utilisateur (D294) : volée droite entre deux murs d'échiffre, du palier mesuré (D125) au pied ;
 * les `flare` marches du bas s'élargissent de part et d'autre (de `ext[1]` à `ext[0]` au-delà de la volée), à coins arrondis, et contournent
 * les deux piédestaux des candélabres posés au bout des murs d'échiffre.
 */
export const PERRON = {
  /** Pied de la volée au-dessus du sol relevé devant la façade (`g`) : le relief y est à 0,3 à 0,5 m (D294). */
  foot: 0.45,
  /** Hauteur de marche visée (m). */
  riser: 0.16,
  /** Marches évasées du bas. */
  flare: 5,
  /** Débord de chaque côté de la volée : marche du bas, plus haute marche évasée (m). */
  ext: [3.0, 1.2] as const,
  /** Rayon des coins avant arrondis des marches évasées (m). */
  round: 0.9,
  /** Épaisseur des murs d'échiffre, hauteur du parapet au-dessus des marches (m). */
  wall: 0.45,
  parapet: 0.85,
  /** Piédestal des candélabres : côté (le long de s), profondeur (le long de t), hauteur au-dessus de la marche où il est posé (m). */
  ped: [1.0, 1.0, 1.9] as const,
} as const;

export interface PerronStep {
  /** Bord avant (t) et dessus (altitude) de la marche. */
  t: number;
  z: number;
  /** Débord de chaque côté de la volée (0 : entre les murs d'échiffre). */
  e: number;
}

export interface PerronLayout {
  s0: number;
  s1: number;
  /** Bord du palier, pied de la volée, mur de l'avant-corps (t). */
  tl: number;
  tfoot: number;
  wallT: number;
  /** Altitudes du palier et du pied. */
  zl: number;
  zFoot: number;
  rise: number;
  run: number;
  /** Marches, du bas (pied) vers le haut (la dernière touche le palier). */
  steps: PerronStep[];
  /** Début des murs d'échiffre (t, bord avant des piédestaux) et dessus de la plus haute marche évasée, où se posent les piédestaux. */
  tWe: number;
  zWe: number;
  /** Fond des marches évasées (t) : derrière les piédestaux. */
  tBack: number;
  /** Piédestaux : [s0, s1, t0, t1, bas, haut]. */
  pedestals: [number, number, number, number, number, number][];
}

/** Perron de la façade, ou null si le modèle n'en a pas. */
export function perronLayout(m: TownHallSpec): PerronLayout | null {
  if (!m.perron) return null;
  const [s0, s1, tl, tfoot, zl] = m.perron;
  const zFoot = m.g + PERRON.foot;
  const n = Math.max(1, Math.round((zl - zFoot) / PERRON.riser));
  const rise = (zl - zFoot) / n, run = (tl - tfoot) / n;
  const F = Math.min(PERRON.flare, n - 1);
  const steps: PerronStep[] = [];
  for (let j = 1; j <= n; j++) {
    const e = j <= F ? PERRON.ext[0] + ((PERRON.ext[1] - PERRON.ext[0]) * (j - 1)) / Math.max(1, F - 1) : 0;
    steps.push({ t: tfoot + (j - 1) * run, z: zFoot + j * rise, e });
  }
  const tWe = tfoot + F * run, zWe = zFoot + F * rise;
  const [pw, pd, ph] = PERRON.ped;
  const pedestals: PerronLayout["pedestals"] = [];
  // Face intérieure des piédestaux dans l'alignement de la volée (photo) : ils débordent le mur d'échiffre vers l'extérieur.
  for (const [a, b] of [[s0 - pw, s0], [s1, s1 + pw]] as const) pedestals.push([a, b, tWe, tWe + pd, zWe, zWe + ph]);
  return { s0, s1, tl, tfoot, wallT: -HALL_PROJ, zl, zFoot, rise, run, steps, tWe, zWe, tBack: tWe + pd + 0.2, pedestals };
}

/**
 * Entrée de la façade arrière, rue Jeannin (D293, photos Street View de juillet 2026) : porte vitrée cintrée dans la travée du milieu, au
 * niveau de la cour ; devant elle, un palier et deux volées droites le long du mur, qui descendent vers l'est et vers l'ouest jusqu'à la rue,
 * plus basse de 2 m que la place (relief).
 */
export const REAR = {
  /** Seuil de la porte et rue au pied des volées, au-dessus du sol devant la façade (`g`). */
  door: 0.3,
  street: -2.0,
  /** Palier : demi-largeur le long du mur, profondeur ; volées : largeur, giron. */
  half: 1.3,
  depth: 1.5,
  width: 1.3,
  run: 0.27,
  /** Travées de la façade arrière. */
  bays: 11,
} as const;

export interface RearLayout {
  /** Mur arrière : début (est) et fin (ouest), normale vers la rue. */
  a: [number, number];
  b: [number, number];
  out: [number, number];
  len: number;
  /** Abscisse de la porte le long du mur depuis `a`. */
  u: number;
  zDoor: number;
  zStreet: number;
  steps: number;
  rise: number;
}

/** Façade arrière (le côté du contour opposé à la façade) et son entrée. */
export function rearLayout(m: TownHallSpec): RearLayout {
  const r = m.ring, n = r.length / 2, i = Math.floor(n / 2);
  const a: [number, number] = [r[2 * i]!, r[2 * i + 1]!], b: [number, number] = [r[(2 * i + 2) % r.length]!, r[(2 * i + 3) % r.length]!];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out: [number, number] = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  const zDoor = m.g + REAR.door, zStreet = m.g + REAR.street;
  const steps = Math.max(1, Math.round((zDoor - zStreet) / 0.17));
  return { a, b, out, len, u: len / 2, zDoor, zStreet, steps, rise: (zDoor - zStreet) / steps };
}

/** Point (s, t) du mur arrière à `u` mètres de son début, à `off` devant lui. */
export function rearPoint(r: RearLayout, u: number, off: number): [number, number] {
  return [r.a[0] + ((r.b[0] - r.a[0]) * u) / r.len + r.out[0] * off, r.a[1] + ((r.b[1] - r.a[1]) * u) / r.len + r.out[1] * off];
}

/** Point du monde (x, y) du repère du bâtiment. */
export function hallXY(m: TownHallSpec, s: number, t: number): [number, number] {
  const c = Math.cos(m.a), sn = Math.sin(m.a);
  return [m.o[0] + c * s - sn * t, m.o[1] + sn * s + c * t];
}

/**
 * Tabliers invisibles du perron (D294), comme ceux du théâtre romain : une rampe qui suit les nez de marche entre les murs d'échiffre, puis le
 * palier jusqu'aux portes ; une rampe plus large sur les marches évasées du bas, entre les piédestaux.
 */
export function hallDecks(m: TownHallSpec): Deck[] {
  const L = perronLayout(m);
  if (!L) return [];
  const sm = (L.s0 + L.s1) / 2;
  const axis = (pts: [number, number][]): number[] => pts.flatMap(([t, z]) => [...hallXY(m, sm, t), z]);
  const deck = (id: number, w: number, p: number[]): Deck => ({ id, k: "foot", w, p, st: "light", sp: [], pc: [] });
  const lift = 0.05;
  return [
    deck(-294001, L.s1 - L.s0 - 0.1, axis([[L.tfoot - 0.2, L.zFoot + lift], [L.tl - L.run / 2, L.zl + lift], [L.wallT - 0.05, L.zl + lift]])),
    deck(-294002, L.s1 - L.s0 + 2 * (PERRON.ext[1] - 0.05), axis([[L.tfoot - 0.2, L.zFoot + lift], [L.tWe, L.zWe + lift]])),
  ];
}

export interface HallObstacle {
  /** Contour fermé (x, y aplatis). */
  ring: number[];
  top: Top;
}

/** Murs d'échiffre et piédestaux : on ne les enjambe pas (du dehors, ils font jusqu'à 5 m). */
const PERRON_WALL: Top = { height: 3, climb: false };
/** Escalier de l'entrée arrière : un bloc de pierre plein, jusqu'à 2,3 m au-dessus de la rue ; la porte est fermée. */
const REAR_STAIR: Top = { height: 2.4, climb: false };

/** Obstacles des escaliers de l'hôtel de ville (D293, D294). */
export function hallObstacles(m: TownHallSpec): HallObstacle[] {
  const out: HallObstacle[] = [];
  const ring = (pts: [number, number][]): number[] => pts.flatMap(([s, t]) => hallXY(m, s, t));
  const rect = (s0: number, s1: number, t0: number, t1: number): number[] => ring([[s0, t0], [s1, t0], [s1, t1], [s0, t1]]);
  const L = perronLayout(m);
  if (L) {
    out.push({ ring: rect(L.s0 - PERRON.wall, L.s0, L.tWe, L.wallT), top: PERRON_WALL });
    out.push({ ring: rect(L.s1, L.s1 + PERRON.wall, L.tWe, L.wallT), top: PERRON_WALL });
    for (const [s0, s1, t0, t1] of L.pedestals) out.push({ ring: rect(s0, s1, t0, t1), top: PERRON_WALL });
  }
  const r = rearLayout(m);
  const span = REAR.half + r.steps * REAR.run;
  out.push({ ring: ring([rearPoint(r, r.u - span, 0.05), rearPoint(r, r.u + span, 0.05), rearPoint(r, r.u + span, REAR.depth), rearPoint(r, r.u - span, REAR.depth)]), top: REAR_STAIR });
  return out;
}

/**
 * Creux d'affichage du perron (D294) : le relevé LiDAR forme sous le perron un talus lisse qui déborde à côté des murs d'échiffre et des
 * marches évasées (bosse contre les arcades). Sur l'emprise du perron et ses abords, le relief affiché est plafonné au niveau de la place ;
 * le sol où l'on marche ne change pas (tabliers sur la volée).
 */
export function hallPits(m: TownHallSpec): Pit[] {
  const L = perronLayout(m);
  if (!L) return [];
  const s0 = L.s0 - PERRON.ext[0] - 0.8, s1 = L.s1 + PERRON.ext[0] + 0.8, t0 = L.tfoot - 0.6, t1 = L.wallT;
  const corners = [hallXY(m, s0, t0), hallXY(m, s1, t0), hallXY(m, s1, t1), hallXY(m, s0, t1)];
  const c = Math.cos(m.a), sn = Math.sin(m.a), floor = m.g + 0.3;
  return [{
    x0: Math.min(...corners.map((p) => p[0])), y0: Math.min(...corners.map((p) => p[1])),
    x1: Math.max(...corners.map((p) => p[0])), y1: Math.max(...corners.map((p) => p[1])),
    cap: (x, y) => {
      const dx = x - m.o[0], dy = y - m.o[1], s = dx * c + dy * sn, t = -dx * sn + dy * c;
      return s >= s0 && s <= s1 && t >= t0 && t <= t1 ? floor : Infinity;
    },
  }];
}
