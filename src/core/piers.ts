import type { Boat, Shelter } from "../data/types";

/**
 * Pontons, bateaux et abris du plan d'eau du Vallon (D246) : la part commune au rendu et aux collisions. Les pontons eux-mêmes sont des
 * tabliers (`Decks`) : on y marche, un nageur s'y hisse (D241) ; seuls les bateaux et les poteaux des abris sont des obstacles.
 */

/** Demi-côté d'un poteau d'abri (m). */
export const SHELTER_POST = 0.09;
/** Hauteur d'obstacle d'un bateau posé ou amarré (m) : on l'enjambe en escaladant, on voit et on tire par-dessus. */
export const BOAT_TOP = 0.7;

/** Contour d'un bateau (anneau x, y fermé implicitement) : poupe carrée, proue en pointe (kayak : deux pointes). */
export function boatOutline(b: Boat): number[] {
  const ux = Math.cos(b.a), uy = Math.sin(b.a), vx = -uy, vy = ux;
  const hl = b.l / 2, hw = b.w / 2;
  const pts: [number, number][] = b.k === "kayak"
    ? [[-hl, 0], [-hl * 0.5, -hw], [hl * 0.5, -hw], [hl, 0], [hl * 0.5, hw], [-hl * 0.5, hw]]
    : [[-hl, -hw * 0.78], [hl * 0.35, -hw], [hl, 0], [hl * 0.35, hw], [-hl, hw * 0.78]];
  return pts.flatMap(([s, t]) => [b.x + ux * s + vx * t, b.y + uy * s + vy * t]);
}

/** Poteaux d'un abri : les quatre angles, à 30 cm du bord du toit (le passage dessous reste libre). */
export function shelterPosts(s: Shelter): [number, number][] {
  const ux = Math.cos(s.a), uy = Math.sin(s.a), vx = -uy, vy = ux;
  const a = s.hl - 0.3, b = s.hw - 0.3;
  const local: [number, number][] = [[-a, -b], [a, -b], [a, b], [-a, b]];
  return local.map(([p, q]) => [s.x + ux * p + vx * q, s.y + uy * p + vy * q]);
}
