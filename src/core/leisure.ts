import type { Deck, Equip } from "../data/types";
import { DeckAxis } from "./bridges";

/**
 * Équipements du plan d'eau du Vallon (D247) : la part commune au rendu et aux collisions. Les modules du skatepark et le pump track sont des
 * tabliers (`Decks`) : on y monte à pied ou à vélo ; leurs flancs sont des murs à hauteur (on ne passe pas sous un module, on enjambe son bord bas).
 */

/** Demi-longueur et demi-largeur d'un équipement posé (m), d'après sa sorte. */
export function equipSize(e: Equip): [number, number] {
  switch (e.k) {
    case "play_small": case "play_big": return [(e.l ?? 3) / 2, (e.w ?? 2) / 2];
    case "springer": return [0.45, 0.2];
    case "bench": return [0.85, 0.3];
    case "picnic": return [0.95, 0.8];
    case "fitness": return [1.3, 0.35];
    case "board": return [0.6, 0.08];
    case "stone": return [(e.l ?? 0.6) / 2, (e.w ?? 0.45) / 2];
    default: return [0, 0];
  }
}

/** Contour (anneau x, y) d'un équipement posé, tourné de `a`. */
export function equipRing(e: Equip, grow = 0): number[] {
  const [hl, hw] = equipSize(e);
  const ux = Math.cos(e.a ?? 0), uy = Math.sin(e.a ?? 0), vx = -uy, vy = ux;
  const out: number[] = [];
  for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    out.push(e.x! + ux * (hl + grow) * s + vx * (hw + grow) * t, e.y! + uy * (hl + grow) * s + vy * (hw + grow) * t);
  }
  return out;
}

/** Hauteur d'obstacle d'un équipement : on enjambe une table ou un banc, pas une structure de jeux. Absent : pas d'obstacle. */
export const EQUIP_TOP: Partial<Record<Equip["k"], number>> = { springer: 0.9, bench: 0.9, picnic: 0.8, fitness: 2.2, board: 2.0, rail: 0.5 };

/**
 * Flancs d'un module de skatepark : contour du tablier, avec à chaque sommet l'altitude du dessus (pour `Colliders.addRing` : on passe
 * par-dessus un flanc plus bas que les pieds + WALL_STEP, on bute sur la face arrière d'un quarter ou le côté d'un bloc).
 */
export function skateSides(d: Deck): { ring: number[]; tops: number[] } {
  const axis = new DeckAxis(d);
  const hw = d.w / 2;
  const left: [number, number, number][] = [], right: [number, number, number][] = [];
  for (const s of axis.cum) {
    const a = axis.at(s);
    left.push([a.x - a.ty * hw, a.y + a.tx * hw, a.z]);
    right.push([a.x + a.ty * hw, a.y - a.tx * hw, a.z]);
  }
  const pts = [...right, ...left.reverse()];
  return { ring: pts.flatMap(([x, y]) => [x, y]), tops: pts.map((p) => p[2]) };
}
