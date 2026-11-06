import type { Deck, Equip } from "../data/types";
import type { Pit } from "../data/terrain";
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
    case "court": case "bowl": return [(e.l ?? 10) / 2, (e.w ?? 10) / 2];
    case "bivvy": return [1.25, 1.05];
    case "rodpod": return [0.45, 0.3];
    // Le siège seul (0,6 m) : les jambes avancent au-dessus du sol ou de l'eau ; assis au bord d'un ponton, il laisse le passage libre.
    case "angler": return [0.3, 0.3];
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
export const EQUIP_TOP: Partial<Record<Equip["k"], number>> = { springer: 0.9, bench: 0.9, picnic: 0.8, fitness: 2.2, board: 2.0, rail: 0.5, bivvy: 1.3, rodpod: 0.6, angler: 1.1 };

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

/**
 * Profondeur du bowl (D248) sous son rebord en (x, y) (m, 0 dehors) : rectangle arrondi `l` × `w` (coins de rayon `r`), parois en quart de
 * cercle de rayon égal à la profondeur `h` (verticales au rebord, à plat au fond). Même formule que `bowl_depth` (build_vallon_leisure.py),
 * qui creuse le relief.
 */
export function bowlDepth(b: Equip, x: number, y: number): number {
  const D = b.h ?? 1.5;
  const din = -bowlSdf(b, x, y);
  if (din <= 0) return 0;
  return din >= D ? D : D - (D - Math.sqrt(Math.max(0, D * D - (D - din) ** 2)));
}

/** Altitude du plan de l'aire de glisse (relief aplani, `pl`) en (x, y). */
export function planeAt(e: Equip, x: number, y: number): number {
  const [a, b, c] = e.pl ?? [0, 0, 0];
  return a * x + b * y + c;
}

/** Distance signée au rebord du bowl (m) : négative dedans, positive dehors. */
export function bowlSdf(b: Equip, x: number, y: number): number {
  const a = b.a ?? 0, dx = x - b.x!, dy = y - b.y!;
  const s = dx * Math.cos(a) + dy * Math.sin(a), t = -dx * Math.sin(a) + dy * Math.cos(a);
  const r = b.r ?? 2;
  const qx = Math.abs(s) - ((b.l ?? 8) / 2 - r), qy = Math.abs(t) - ((b.w ?? 8) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Creux d'affichage d'un bowl (D248) : relief affiché abaissé de `PIT_DROP` m jusqu'à `PIT_MARGIN` m hors du rebord. */
export const PIT_DROP = 4;
export const PIT_MARGIN = 0.6;
/** Pourtour en béton du bowl (m au-delà du rebord), qui cache le relief affiché abaissé (même valeur que build_vallon_leisure.py). */
export const BOWL_APRON = 4.2;

export function bowlPit(b: Equip): Pit {
  const ext = Math.hypot(b.l ?? 8, b.w ?? 8) / 2 + PIT_MARGIN + 0.1;
  const floor = (x: number, y: number): number => planeAt(b, x, y) - (b.h ?? 1.5) - PIT_DROP;
  return {
    x0: b.x! - ext, y0: b.y! - ext, x1: b.x! + ext, y1: b.y! + ext,
    cap: (x, y) => (bowlSdf(b, x, y) < PIT_MARGIN ? floor(x, y) : Infinity),
  };
}
