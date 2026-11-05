import type { GendarmerieModel } from "../data/types";
import { at, frameOf, type Frame } from "./landmarks";

/**
 * Gendarmerie de l'avenue André Frenaud (D238) : repère, obstacles et lignes des abords. Logique pure, partagée par le rendu
 * (`src/render/gendarmerie.ts`) et les collisions (`world.ts`).
 */

/** Repère du bâtiment principal : origine à son coin nord-ouest, s vers l'est-sud-est le long de son long côté nord, t vers la cour. */
export function gendarmerieFrame(m: GendarmerieModel): Frame {
  return frameOf(m.o[0], m.o[1], m.a, 1, 1);
}

/** Hauteur de la clôture de panneaux soudés et du portail (photos : à hauteur d'homme, un peu plus). */
export const GENDARMERIE_FENCE_H = 1.9;
/** Demi-côté du pied du pylône d'antennes (treillis), section du mât au drapeau. */
export const GENDARMERIE_MAST_FOOT = 0.6, GENDARMERIE_FLAG_POLE = 0.07;

const rect = (f: Frame, s0: number, s1: number, t0: number, t1: number): number[] => [...at(f, s0, t0), ...at(f, s1, t0), ...at(f, s1, t1), ...at(f, s0, t1)];

/** Obstacles (x, y) : chaque volume à ses murs mesurés ; le pied du pylône, le mât et la borne (D238). */
export function gendarmerieRings(m: GendarmerieModel): number[][] {
  const f = gendarmerieFrame(m);
  const out = m.blocks.map((b) => rect(f, ...b.r));
  if (m.site) {
    const [ms, mt] = m.site.mast, h = GENDARMERIE_MAST_FOOT;
    out.push(rect(f, ms - h, ms + h, mt - h, mt + h));
    for (const [s, t, r] of [[...m.site.flag, 0.12], [...m.site.borne, 0.35]] as [number, number, number][]) out.push(rect(f, s - r, s + r, t - r, t + r));
  }
  return out;
}

/** Lignes d'obstacles (x, y) : la clôture et le portail fermé de la cour ; on voit et on tire à travers, on les escalade (1,9 m). */
export function gendarmerieLines(m: GendarmerieModel): number[][] {
  if (!m.site) return [];
  const f = gendarmerieFrame(m), xy = (p: readonly [number, number][]): number[] => p.flatMap(([s, t]) => at(f, s, t));
  return [...m.site.fences.map(xy), ...m.site.gates.map((g) => xy([g.a, g.b]))];
}
