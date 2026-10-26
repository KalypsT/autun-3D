/**
 * Places de stationnement retrouvées dans le marquage au sol : build_ground.py trace, le long des allées
 * des parkings, des traits de 4,8 m × 0,1 m tous les 2,5 m. Deux traits voisins et parallèles bordent une place.
 * Logique pure (données de tuile en entrée).
 */

export interface Stall {
  x: number;
  y: number;
  /** Cap de la place (rad, 0 = nord, sens horaire), dans l'axe des traits. */
  heading: number;
}

interface Line {
  cx: number;
  cy: number;
  /** Direction unitaire du trait. */
  dx: number;
  dy: number;
  length: number;
}

const MIN_LENGTH = 3.6;
const MAX_LENGTH = 5.3;
const MAX_WIDTH = 0.3;
const SPACING_MIN = 2.2;
const SPACING_MAX = 2.9;

/** Axe principal d'un contour (x0, y0, x1, y1, …) : centre, direction, longueur et largeur. */
function principal(ring: readonly number[]): { line: Line; width: number } | null {
  const n = ring.length / 2;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    mx += ring[2 * i]!;
    my += ring[2 * i + 1]!;
  }
  mx /= n;
  my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = ring[2 * i]! - mx, y = ring[2 * i + 1]! - my;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = ring[2 * i]! - mx, y = ring[2 * i + 1]! - my;
    const u = x * dx + y * dy, v = -x * dy + y * dx;
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
    wlo = Math.min(wlo, v);
    whi = Math.max(whi, v);
  }
  const mid = (lo + hi) / 2;
  return { line: { cx: mx + dx * mid, cy: my + dy * mid, dx, dy, length: hi - lo }, width: whi - wlo };
}

/** Places entre deux traits de marquage voisins (polygones de la couche « marks » d'une tuile). */
export function findStalls(marks: readonly (readonly (readonly number[])[])[]): Stall[] {
  const lines: Line[] = [];
  for (const poly of marks) {
    const p = poly[0] ? principal(poly[0]) : null;
    if (p && p.width < MAX_WIDTH && p.line.length > MIN_LENGTH && p.line.length < MAX_LENGTH) lines.push(p.line);
  }
  const stalls: Stall[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]!;
    // Voisin le plus proche du côté « gauche » du trait : une place par paire, sans doublon.
    let best: Line | null = null, bestGap = Infinity;
    for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      const b = lines[j]!;
      if (Math.abs(a.dx * b.dy - a.dy * b.dx) > 0.1) continue;
      const ox = b.cx - a.cx, oy = b.cy - a.cy;
      const across = -ox * a.dy + oy * a.dx, along = ox * a.dx + oy * a.dy;
      if (across < SPACING_MIN || across > SPACING_MAX || Math.abs(along) > 0.8) continue;
      if (across < bestGap) {
        bestGap = across;
        best = b;
      }
    }
    if (!best) continue;
    stalls.push({ x: (a.cx + best.cx) / 2, y: (a.cy + best.cy) / 2, heading: Math.atan2(a.dx, a.dy) });
  }
  return stalls;
}
