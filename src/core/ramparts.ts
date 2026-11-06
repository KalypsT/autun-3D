import type { RampartTower, Wall } from "../data/types";
import type { Pit } from "../data/terrain";

/**
 * Remparts à profil mesuré (lot 1, docs/plans/remparts.md) : tools/data/build_ramparts.py écrit pour chaque sommet de la polyligne le sommet du
 * mur (`top`) et le sol de chaque côté (`gl` à gauche du sens de la polyligne, `gr` à droite), en altitudes absolues du repère du jeu.
 */

/** Épaisseur dessinée (m), la même que `THICK` de build_ramparts.py (le relief y est écrêté à partir des faces). */
export const RAMPART_THICK = 2.0;
/** Plafond du facteur d'onglet aux angles (un angle très aigu ne projette pas la face au loin). */
const MITER_MAX = 2;

export type ProfiledWall = Wall & { top: number[]; gl: number[]; gr: number[] };

export function isProfiled(w: Wall): w is ProfiledWall {
  return w.kind === "rampart" && w.top !== undefined && w.gl !== undefined && w.gr !== undefined && w.top.length * 2 === w.pts.length;
}

/** Faces du mur : polylignes décalées de la demi-épaisseur à gauche et à droite, avec onglet aux sommets. */
export function rampartSides(w: Wall): { left: number[]; right: number[] } {
  const hw = RAMPART_THICK / 2;
  return { left: offsetLine(w.pts, hw).pts, right: offsetLine(w.pts, -hw).pts };
}

/** Contour fermé du mur (face gauche, puis face droite à rebours) : l'obstacle des collisions, bouts compris. */
export function rampartOutline(w: Wall): number[] {
  const { left, right } = rampartSides(w);
  const out = [...left];
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(right[i]!, right[i + 1]!);
  out.push(left[0]!, left[1]!);
  return out;
}

/** Écart de sol (m) d'un côté à l'autre au-delà duquel le mur a un côté haut : creux d'affichage et bande fine. */
const SEAM_DIFF = 1.0;
/** Largeur du creux au-delà de la face haute (m) : la diagonale d'une maille du relief proche (2,5 m), pour qu'aucun triangle affiché ne relie le haut au bas à travers la face. */
const PIT_PAD = 3.6;
/** Largeur de la bande fine au-delà de la face haute (m) : le creux, plus une diagonale de maille où le relief affiché remonte. */
const COVER_WIDTH = PIT_PAD + 3.6;

/** Décale une polyligne de `dist` m à gauche (onglet aux sommets) ; rend les points et les normales gauches unitaires par sommet. */
function offsetLine(p: readonly number[], dist: number): { pts: number[]; nrm: number[] } {
  const n = p.length / 2;
  const seg = (i: number): [number, number] => {
    const dx = p[2 * i + 2]! - p[2 * i]!, dy = p[2 * i + 3]! - p[2 * i + 1]!;
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const pts: number[] = [], nrm: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = seg(Math.max(0, i - 1)), b = seg(Math.min(n - 2, i));
    let nx = a[0] + b[0], ny = a[1] + b[1];
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) [nx, ny] = b;
    else {
      nx /= l;
      ny /= l;
    }
    const k = dist * Math.min(MITER_MAX, 1 / Math.max(1e-3, nx * b[0] + ny * b[1]));
    pts.push(p[2 * i]! + nx * k, p[2 * i + 1]! + ny * k);
    nrm.push(nx, ny);
  }
  return { pts, nrm };
}

/** Morceaux d'un rempart dont un côté est plus haut que l'autre d'au moins SEAM_DIFF : axe, côté haut (1 : gauche, −1 : droite), sol bas. */
export function rampartSeams(w: ProfiledWall): { axis: number[]; side: 1 | -1; low: number[] }[] {
  const out: { axis: number[]; side: 1 | -1; low: number[] }[] = [];
  let cur: { axis: number[]; side: 1 | -1; low: number[] } | null = null;
  for (let i = 0; i < w.top.length; i++) {
    const d = w.gl[i]! - w.gr[i]!;
    const side: 1 | -1 | 0 = Math.abs(d) < SEAM_DIFF ? 0 : d > 0 ? 1 : -1;
    if (side === 0 || (cur && cur.side !== side)) {
      if (cur && cur.axis.length >= 4) out.push(cur);
      cur = null;
    }
    if (side === 0) continue;
    if (!cur) {
      cur = { axis: [], side, low: [] };
      // Le morceau part du sommet précédent (le segment de transition est couvert lui aussi).
      if (i > 0) {
        cur.axis.push(w.pts[2 * i - 2]!, w.pts[2 * i - 1]!);
        cur.low.push(Math.min(w.gl[i - 1]!, w.gr[i - 1]!));
      }
    }
    cur.axis.push(w.pts[2 * i]!, w.pts[2 * i + 1]!);
    cur.low.push(Math.min(w.gl[i]!, w.gr[i]!));
  }
  if (cur && cur.axis.length >= 4) out.push(cur);
  return out;
}

/**
 * Creux d'affichage d'un rempart (D250). Le relief proche est affiché par carreaux de 2,5 m : là où un côté du mur est bien plus haut que
 * l'autre (mur de soutènement), un triangle relierait le haut au bas à travers la face, et percerait le parement. Du côté haut, sous le mur et
 * jusqu'à PIT_PAD m au-delà de la face, le relief affiché est abaissé au sol bas ; une bande de relief fin (`cover`), au vrai relief, recouvre
 * ce côté. La marche, les véhicules et les sols suivent toujours le vrai relief.
 */
export function rampartPits(walls: readonly Wall[]): Pit[] {
  const hw = RAMPART_THICK / 2;
  const out: Pit[] = [];
  for (const w of walls) {
    if (!isProfiled(w)) continue;
    for (const s of rampartSeams(w)) {
      const a = s.axis, m = a.length / 2;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < m; i++) {
        x0 = Math.min(x0, a[2 * i]!); x1 = Math.max(x1, a[2 * i]!);
        y0 = Math.min(y0, a[2 * i + 1]!); y1 = Math.max(y1, a[2 * i + 1]!);
      }
      const r = hw + COVER_WIDTH + 1;
      const face = offsetLine(a, s.side * hw);
      const nrm = face.nrm.map((v) => v * s.side);
      out.push({
        x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r,
        cap: (x, y) => {
          let z = Infinity;
          for (let i = 0; i + 1 < m; i++) {
            const ax = a[2 * i]!, ay = a[2 * i + 1]!, dx = a[2 * i + 2]! - ax, dy = a[2 * i + 3]! - ay;
            const l2 = dx * dx + dy * dy;
            if (l2 < 1e-6) continue;
            const t = ((x - ax) * dx + (y - ay) * dy) / l2;
            if (t < -0.02 || t > 1.02) continue;
            const d = (s.side * ((x - ax) * -dy + (y - ay) * dx)) / Math.sqrt(l2);
            if (d < -(hw + 0.3) || d > hw + PIT_PAD) continue;
            const tc = Math.min(1, Math.max(0, t));
            z = Math.min(z, s.low[i]! + tc * (s.low[i + 1]! - s.low[i]!) - 0.3);
          }
          return z;
        },
        cover: [{ pts: face.pts, nrm, width: COVER_WIDTH }],
      });
    }
  }
  return out;
}

/** Pas d'arc d'une tour ronde (segments sur le demi-tour). */
export const TOWER_SEGMENTS = 14;

/**
 * Arc extérieur d'une tour ronde (D254) : points du cercle (centre x, y, rayon r) qui sont devant la face du mur (à 20 cm près, pour
 * entrer dans le mur), de la gauche à la droite vue de dehors ; avec la normale (radiale) de chacun.
 */
export function towerArc(t: RampartTower): { pts: number[]; nrm: number[] } {
  const r = t.r ?? 3.5, nx = t.nx ?? 0, ny = t.ny ?? 1;
  const tx = -ny, ty = nx;
  // Avancée du centre devant la face : le cercle en sort de r + d.
  const d = (t.x - (t.fx ?? t.x)) * nx + (t.y - (t.fy ?? t.y)) * ny;
  const lim = Math.acos(Math.min(1, Math.max(-1, -(d + 0.2) / r)));
  const pts: number[] = [], nrm: number[] = [];
  for (let k = 0; k <= TOWER_SEGMENTS; k++) {
    const a = -lim + (2 * lim * k) / TOWER_SEGMENTS;
    const cx = Math.cos(a) * nx + Math.sin(a) * tx, cy = Math.cos(a) * ny + Math.sin(a) * ty;
    pts.push(t.x + r * cx, t.y + r * cy);
    nrm.push(cx, cy);
  }
  return { pts, nrm };
}

/** Sommets de l'octogone de la tour des Ursulines, agrandi de `grow` m d'apothème. */
export function octagon(t: RampartTower, grow = 0): number[] {
  const R = ((t.apo ?? 5) + grow) / Math.cos(Math.PI / 8), rot = t.rot ?? 0, out: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = rot + Math.PI / 8 + (i * Math.PI) / 4;
    out.push(t.x + R * Math.sin(a), t.y + R * Math.cos(a));
  }
  return out;
}

/** Contour fermé d'une tour pour les collisions : l'arc et sa corde (tour ronde), l'octogone du pied (Ursulines). */
export function towerOutline(t: RampartTower): number[] {
  const p = t.k === "ursulines" ? octagon(t, 0.45) : towerArc(t).pts;
  return [...p, p[0]!, p[1]!];
}
