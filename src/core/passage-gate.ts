import type { Colliders } from "./collision";
import { at, frameOf } from "./landmarks";

/**
 * Grilles du passage Balthus (D190) : une à chaque entrée, ouvertes de 7 h à 20 h (horaire donné par l'utilisateur), fermées le reste du temps. Même
 * principe que la grille du collège (D174) : obstacle étiqueté, posé ou retiré selon l'heure ; en plus, une grille ne se ferme pas sur le joueur
 * qui est resté dans le couloir (elle attend qu'il sorte), sans quoi il y passerait la nuit enfermé. Logique pure ; dessin dans `render/passage-gate.ts`,
 * jeu dans `game/passage-gate.ts`.
 */

/** Axe du passage (mesuré, D187 : le même que le site `passage` de kinds/26_34.json, vérifié par un test) et abscisses des deux grilles. */
export const PASSAGE_GATE = {
  c: [-25.3, -115.7] as [number, number],
  a: -0.9837,
  L: 64.26,
  hw: 2.5,
  /** Plans des grilles (m depuis la façade de la rue Demetz) : un mètre à l'intérieur de chaque arc. */
  planes: [1.2, 63.0] as [number, number],
  /** Altitude du sol à chaque grille (galerie, palier de la rue aux Cordiers) et hauteur des grilles. */
  floors: [4.06, 6.42] as [number, number],
  height: 3.0,
  hours: [7, 20] as [number, number],
};

export const PASSAGE_GATE_TAG = "passage-gate";

/** Les grilles sont-elles ouvertes à cette heure (heure solaire) ? */
export function passageGateOpen(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= PASSAGE_GATE.hours[0] && h < PASSAGE_GATE.hours[1];
}

/** Lignes des deux grilles fermées, d'un mur à l'autre du couloir. */
export function passageGateLines(): number[][] {
  const g = PASSAGE_GATE, f = frameOf(g.c[0], g.c[1], g.a, 1, 1);
  return g.planes.map((d) => [...at(f, d, -g.hw), ...at(f, d, g.hw)]);
}

/** Le point est-il dans le couloir, entre les deux grilles ? */
export function insidePassage(x: number, y: number, g = PASSAGE_GATE): boolean {
  const dx = x - g.c[0], dy = y - g.c[1], ux = Math.cos(g.a), uy = Math.sin(g.a);
  const s = dx * ux + dy * uy, t = -dx * uy + dy * ux;
  return s > g.planes[0] - 0.5 && s < g.planes[1] + 0.5 && Math.abs(t) < g.hw + 0.3;
}

/** Pose ou retire les obstacles selon l'heure ; `occupied` : quelqu'un (le joueur) est dans le couloir, la fermeture attend. Vrai si l'état a changé. */
export function syncPassageGate(colliders: Colliders, hour: number, state: { closed: boolean | null }, occupied = false): boolean {
  const closed = !passageGateOpen(hour) && !(occupied && state.closed === false);
  if (state.closed === closed) return false;
  if (state.closed) colliders.removeTag(PASSAGE_GATE_TAG);
  if (closed) {
    colliders.currentTag = PASSAGE_GATE_TAG;
    for (const l of passageGateLines()) colliders.addPolyline(l, true, { height: PASSAGE_GATE.height, climb: false });
    colliders.currentTag = null;
  }
  state.closed = closed;
  return true;
}
