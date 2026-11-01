import type { Colliders } from "./collision";

/**
 * Grille du collège du Vallon (D174, lot 3 de docs/plans/college-vallon.md) : à l'extrémité nord-est du pont de la rue de l'Acaron, perpendiculaire
 * à son axe (cap 66°). Fermée en dehors des heures de classe (le jeu n'a ni calendrier ni vacances, D116 : une règle d'horaire seulement), comme le
 * camion de D115 est absent hors service. Logique pure : le dessin est dans `render/vallon-gate.ts`, le jeu dans `game/school-gate.ts`.
 *
 * Repère de la grille : origine `o` à son extrémité nord-ouest (à gauche vu du pont), `s` vers la droite (sud-sud-est) jusqu'à `len`, `t` vers le pont
 * (vers l'extérieur), `n` la normale sortante (du collège vers le pont).
 */
export interface SchoolGateSpec {
  o: [number, number];
  n: [number, number];
  len: number;
}

/** Position mesurée sur l'orthophotographie et le tablier (lot 0, §9.4) : le même contour que le champ `gate` de `kinds/28_39.json`. */
export const SCHOOL_GATE: SchoolGateSpec = { o: [546.12, 1087.2], n: [-0.9146, -0.4044], len: 6.8 };

/** Disposition le long de la grille (abscisses s) et hauteurs, d'après les photos 1 et 2. */
export const GATE_LAYOUT = {
  /** Poteau noir de l'extrémité nord-ouest, portail coulissant à deux vantaux, poteau noir du milieu, portillon, pilier de béton à l'interphone. */
  endPost: [0, 0.35],
  leaf: [0.35, 4.75],
  midPost: [4.75, 5.05],
  wicket: [5.05, 6.15],
  pillar: [6.15, 6.8],
  /** Hauteur des vantaux (m), des poteaux et du pilier. */
  leafHeight: 2,
  postHeight: 2.3,
  pillarHeight: 2.4,
  /** Heures de classe (heure solaire) : la grille est ouverte de 7 h 30 à 18 h. */
  hours: [7.5, 18],
} as const;

/** Étiquette des obstacles de la grille fermée (retirés à l'ouverture). */
export const GATE_TAG = "school-gate";

/** La grille est-elle ouverte à cette heure ? */
export function gateOpen(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= GATE_LAYOUT.hours[0] && h < GATE_LAYOUT.hours[1];
}

export interface GateFrame {
  u: [number, number];
  pt(s: number, t: number): [number, number];
}

export function gateFrame(g: SchoolGateSpec = SCHOOL_GATE): GateFrame {
  const u: [number, number] = [-g.n[1], g.n[0]];
  return { u, pt: (s, t) => [g.o[0] + u[0] * s + g.n[0] * t, g.o[1] + u[1] * s + g.n[1] * t] };
}

/** Obstacles ronds fixes de l'entrée : poteaux, pilier de béton, lampadaires à tête en disque (x, y, rayon). */
export function gateCircles(g: SchoolGateSpec = SCHOOL_GATE): [number, number, number][] {
  const f = gateFrame(g), L = GATE_LAYOUT;
  const mid = (r: readonly [number, number]): number => (r[0] + r[1]) / 2;
  const out: [number, number, number][] = [
    [...f.pt(mid(L.endPost), 0), 0.22], [...f.pt(mid(L.midPost), 0), 0.22], [...f.pt(mid(L.pillar), 0), 0.38],
  ];
  for (const [s, t] of GATE_LAMPS) out.push([...f.pt(s, t), 0.15]);
  return out;
}

/** Lampadaires à tête en disque (s, t), de part et d'autre du tablier, hors de son axe. */
export const GATE_LAMPS: readonly [number, number][] = [[-0.5, 2.2], [9.4, 2.6]];

/** Ligne de la grille fermée : du poteau nord-ouest au pilier. */
export function gateLine(g: SchoolGateSpec = SCHOOL_GATE): number[] {
  const f = gateFrame(g);
  return [...f.pt(0, 0), ...f.pt(g.len, 0)];
}

/** Pose ou retire l'obstacle de la grille selon l'heure ; `state.closed` retient ce qui est en place (null : rien encore). Vrai si l'état a changé. */
export function syncGate(colliders: Colliders, hour: number, state: { closed: boolean | null }, g: SchoolGateSpec = SCHOOL_GATE): boolean {
  const closed = !gateOpen(hour);
  if (state.closed === closed) return false;
  if (state.closed) colliders.removeTag(GATE_TAG);
  if (closed) {
    colliders.currentTag = GATE_TAG;
    // Haute et ajourée : on ne l'enjambe pas, on la voit et on tire à travers.
    colliders.addPolyline(gateLine(g), true, { height: GATE_LAYOUT.leafHeight + 0.4, climb: false });
    colliders.currentTag = null;
  }
  state.closed = closed;
  return true;
}
