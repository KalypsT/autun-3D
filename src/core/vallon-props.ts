import type { VallonModel } from "../data/types";

/**
 * Abords de l'entrée ouest du collège du Vallon (D175, lot 4) : constantes et obstacles ; le dessin est dans `render/vallon-props.ts`.
 */

/** Hauteur de chaque marche (m), profondeur d'un giron, nombre de marches, profondeur du palier. */
export const STEP = { rise: 0.17, tread: 0.42, count: 3, landing: 0.9 } as const;
/** Haie taillée : épaisseur et hauteur (m). */
export const HEDGE = { width: 0.9, height: 1.15 } as const;

/** Point de la scène (x, y) du point (u, v) du repère tourné du bâtiment. */
export function vallonPoint(m: Pick<VallonModel, "o" | "rot">, u: number, v: number): [number, number] {
  const a = (m.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  return [m.o[0] + u * ca - v * sa, m.o[1] + u * sa + v * ca];
}

/** Obstacles ronds des abords (x, y, rayon) : rochers, bacs, tronc du bouleau, haie (un cercle par mètre). */
export function vallonPropCircles(m: VallonModel): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const p of m.props ?? []) {
    if (p.k === "rock") out.push([...vallonPoint(m, p.u, p.v), (p.r ?? 0.6) * 0.9]);
    else if (p.k === "pot") out.push([...vallonPoint(m, p.u, p.v), 0.35]);
    else if (p.k === "birch") out.push([...vallonPoint(m, p.u, p.v), 0.2]);
    else if (p.k === "hedge") for (let s = 0.5; s < (p.w ?? 0); s += 1) out.push([...vallonPoint(m, p.u, p.v + s), HEDGE.width * 0.6]);
  }
  return out;
}
