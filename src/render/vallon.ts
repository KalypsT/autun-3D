import * as THREE from "three";
import type { HeightField, VallonModel } from "../data/types";
import { toThree, type Vec3 } from "./geometry";
import type { LandmarkSinks } from "./landmarks";

/**
 * Collège du Vallon (D172), d'après les relevés LiDAR du lot 0 (docs/plans/college-vallon.md §9) : le bâtiment principal est fait d'ailes à toit plat
 * (barre de quatre niveaux, ailes et bloc nord à deux niveaux), toutes tournées de 17,5° ; le gymnase est un hall à deux pentes entre deux bas-côtés plats ;
 * le préau est un toit de quatre voûtes. Murs unis pour l'instant (les façades viennent au lot 2) ; les collisions gardent l'emprise BD TOPO.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

/** Hauteur de l'acrotère des toits plats, et pas maximal des murs (suivre le relief). */
export const VALLON_PARAPET = 0.45;
const STEP = 3;
/** Segments d'une voûte du préau. */
const VAULT_SEGS = 6;

type XY = [number, number];

export interface VallonFrame {
  /** Point de la scène (x, y) pour (u, v). */
  pt(u: number, v: number): XY;
  /** (u, v) d'un point de la scène. */
  uv(p: XY): XY;
}

/** Repère du bâtiment : u au cap 90° − rot (72° pour 17,5°), v à 90° à sa gauche (cap 342°). */
export function vallonFrame(m: Pick<VallonModel, "o" | "rot">): VallonFrame {
  const a = (m.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  return {
    pt: (u, v) => [m.o[0] + u * ca - v * sa, m.o[1] + u * sa + v * ca],
    uv: (p) => [(p[0] - m.o[0]) * ca + (p[1] - m.o[1]) * sa, -(p[0] - m.o[0]) * sa + (p[1] - m.o[1]) * ca],
  };
}

/** Coins d'un rectangle [u0, u1, v0, v1] dans le sens trigonométrique, dans la scène. */
export function rectCorners(f: VallonFrame, r: [number, number, number, number]): XY[] {
  return [f.pt(r[0], r[2]), f.pt(r[1], r[2]), f.pt(r[1], r[3]), f.pt(r[0], r[3])];
}

/** Altitude du toit du gymnase à l'abscisse u (bande plate, ou deux pentes autour du faîtage) ; NaN hors des bandes. */
export function gymRoofZ(strips: NonNullable<VallonModel["gym"]>["strips"], u: number): number {
  for (const s of strips) {
    if (u < s.u[0] - 1e-9 || u > s.u[1] + 1e-9) continue;
    if (s.z !== undefined) return s.z;
    const [ru, rz] = s.ridge!;
    const half = u < ru ? ru - s.u[0] : s.u[1] - ru;
    return rz - ((rz - s.eave!) * Math.abs(u - ru)) / half;
  }
  return NaN;
}

/** Polygone découpé à la bande u0 ≤ u ≤ u1 (Sutherland-Hodgman, deux demi-plans). */
export function clipStrip(poly: XY[], u0: number, u1: number): XY[] {
  const clip = (pts: XY[], inside: (p: XY) => boolean, cut: (a: XY, b: XY) => XY): XY[] => {
    const out: XY[] = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      const pi = inside(p), qi = inside(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(cut(p, q));
    });
    return out;
  };
  const at = (u: number) => (a: XY, b: XY): XY => {
    const t = (u - a[0]) / (b[0] - a[0]);
    return [u, a[1] + (b[1] - a[1]) * t];
  };
  return clip(clip(poly, (p) => p[0] >= u0, at(u0)), (p) => p[0] <= u1, at(u1));
}

const area2 = (poly: XY[]): number => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]!; return a + p[0] * q[1] - q[0] * p[1]; }, 0);

export function buildVallon(sinks: LandmarkSinks, m: VallonModel, terrain: HeightField): void {
  const mb = sinks.solid;
  const f = vallonFrame(m);
  const WALL = C(m.colors.wall), ROOF = C(m.colors.roof), PARAPET = C(m.colors.parapet), VAULT = C(m.colors.vault), HALL = C(m.colors.hall);
  const up = toThree(0, 0, 1);
  const ground = (x: number, y: number): number => terrain.heightAt(x, y) - 0.3;
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, col: THREE.Color): void => mb.quad(a, b, c, d, n, col);
  const POST = C("#2f8c8e"), CEILING = C("#8c908f");
  /** Poteau carré de demi-côté `h`, du bas z0 au haut z1. */
  const box = (c: XY, h: number, z0: number, z1: number, col: THREE.Color): void => {
    const P = (dx: number, dy: number, z: number): Vec3 => toThree(c[0] + dx, c[1] + dy, z);
    quad(P(-h, -h, z0), P(h, -h, z0), P(h, -h, z1), P(-h, -h, z1), toThree(0, -1, 0), shade(col, 0.95));
    quad(P(h, -h, z0), P(h, h, z0), P(h, h, z1), P(h, -h, z1), toThree(1, 0, 0), shade(col, 0.85));
    quad(P(h, h, z0), P(-h, h, z0), P(-h, h, z1), P(h, h, z1), toThree(0, 1, 0), col);
    quad(P(-h, h, z0), P(-h, -h, z0), P(-h, -h, z1), P(-h, h, z1), toThree(-1, 0, 0), shade(col, 0.9));
    quad(P(-h, -h, z1), P(h, -h, z1), P(h, h, z1), P(-h, h, z1), toThree(0, 0, 1), shade(col, 1.08));
  };
  /** Poutre de p à q, épaisse de 0,35 m centrée sur la ligne, de z0 à z1 (deux faces, dessus et dessous). */
  const beam = (p: XY, q: XY, nn: XY, z0: number, z1: number, col: THREE.Color): void => {
    const w = 0.175, a: XY = [p[0] + nn[0] * w, p[1] + nn[1] * w], b: XY = [q[0] + nn[0] * w, q[1] + nn[1] * w];
    const a2: XY = [p[0] - nn[0] * w, p[1] - nn[1] * w], b2: XY = [q[0] - nn[0] * w, q[1] - nn[1] * w];
    quad(toThree(...a, z0), toThree(...b, z0), toThree(...b, z1), toThree(...a, z1), toThree(nn[0], nn[1], 0), col);
    quad(toThree(...b2, z0), toThree(...a2, z0), toThree(...a2, z1), toThree(...b2, z1), toThree(-nn[0], -nn[1], 0), shade(col, 0.9));
    quad(toThree(...a, z1), toThree(...b, z1), toThree(...b2, z1), toThree(...a2, z1), up, shade(col, 1.1));
    quad(toThree(...a, z0), toThree(...b, z0), toThree(...b2, z0), toThree(...a2, z0), toThree(0, 0, -1), shade(col, 0.7));
  };

  /** Mur vertical de p à q, du sol (ou de `z0`) jusqu'à `top(point)` ; normale horizontale n. */
  const wall = (p: XY, q: XY, z0: number | null, top: (x: number, y: number) => number, n: XY, col: THREE.Color): void => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const k = Math.max(1, Math.ceil(len / STEP));
    for (let j = 0; j < k; j++) {
      const a: XY = [p[0] + ((q[0] - p[0]) * j) / k, p[1] + ((q[1] - p[1]) * j) / k];
      const b: XY = [p[0] + ((q[0] - p[0]) * (j + 1)) / k, p[1] + ((q[1] - p[1]) * (j + 1)) / k];
      const za = z0 ?? ground(...a), zb = z0 ?? ground(...b);
      const ta = top(...a), tb = top(...b);
      if (ta <= za + 0.01 && tb <= zb + 0.01) continue;
      quad(toThree(...a, za), toThree(...b, zb), toThree(...b, Math.max(tb, zb)), toThree(...a, Math.max(ta, za)), toThree(n[0], n[1], 0), col);
    }
  };
  const tris = (poly: XY[], z: (p: XY) => number, n: Vec3, col: THREE.Color): void => {
    const idx = THREE.ShapeUtils.triangulateShape(poly.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [i, j, l] of idx) mb.tri(toThree(...poly[i!]!, z(poly[i!]!)), toThree(...poly[j!]!, z(poly[j!]!)), toThree(...poly[l!]!, z(poly[l!]!)), n, col);
  };
  /** Sens trigonométrique garanti, et normale extérieure de chaque côté. */
  const outward = (poly: XY[]): { poly: XY[]; n: (p: XY, q: XY) => XY } => {
    const ccw = area2(poly) > 0;
    const pts = ccw ? poly : poly.slice().reverse();
    return { poly: pts, n: (p, q) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); return [(q[1] - p[1]) / l, -(q[0] - p[0]) / l]; } };
  };

  // --- Ailes à toit plat : murs, acrotère, dessus --------------------------------------------------------------------------------------
  for (const w of m.wings ?? []) {
    const { poly, n } = outward(rectCorners(f, w.r));
    const top = w.z + VALLON_PARAPET;
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      const nn = n(p, q);
      wall(p, q, null, () => top, nn, WALL);
      // Face intérieure de l'acrotère (0,3 m d'épaisseur) et sa tranche.
      const p2: XY = [p[0] - nn[0] * 0.3, p[1] - nn[1] * 0.3], q2: XY = [q[0] - nn[0] * 0.3, q[1] - nn[1] * 0.3];
      wall(p2, q2, w.z, () => top, [-nn[0], -nn[1]], shade(PARAPET, 0.9));
      quad(toThree(...p, top), toThree(...q, top), toThree(...q2, top), toThree(...p2, top), up, shade(PARAPET, 1.05));
    });
    tris(poly, () => w.z, up, ROOF);
  }

  // --- Préau : murs jusqu'aux creux, quatre voûtes d'axe u ----------------------------------------------------------------------------
  if (m.preau) {
    const pr = m.preau;
    const { poly, n } = outward(rectCorners(f, pr.r));
    const SIDE = ["s", "e", "n", "w"] as const;
    const open = new Set(pr.open ?? []);
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      if (!open.has(SIDE[i]!)) { wall(p, q, null, () => pr.eave, n(p, q), WALL); return; }
      // Côté ouvert : poteaux bleu-vert tous les 4,5 m et poutre de rive.
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]), k = Math.max(1, Math.ceil(len / 4.5));
      for (let j = 0; j <= k; j++) {
        const c: XY = [p[0] + ((q[0] - p[0]) * j) / k, p[1] + ((q[1] - p[1]) * j) / k];
        box(c, 0.15, ground(...c), pr.eave + 0.1, POST);
      }
      beam(p, q, n(p, q), pr.eave - 0.35, pr.eave + 0.12, shade(POST, 0.85));
    });
    // Dessous des voûtes : plafond plat sombre à hauteur des creux.
    const ceil = poly.map((p) => toThree(...p, pr.eave - 0.05));
    quad(ceil[0]!, ceil[1]!, ceil[2]!, ceil[3]!, toThree(0, 0, -1), CEILING);
    const [u0, u1, v0, v1] = pr.r;
    const dv = (v1 - v0) / pr.n, sag = pr.crown - pr.eave;
    for (let k = 0; k < pr.n; k++) {
      const va = v0 + dv * k;
      const prof = (j: number): [number, number] => {
        const t = j / VAULT_SEGS;
        return [va + dv * t, pr.eave + sag * Math.sin(Math.PI * t)];
      };
      for (let j = 0; j < VAULT_SEGS; j++) {
        const [vA, zA] = prof(j), [vB, zB] = prof(j + 1);
        const mid = (j + 0.5) / VAULT_SEGS;
        const slope = (sag * Math.PI * Math.cos(Math.PI * mid)) / dv;
        const nv = 1 / Math.hypot(1, slope);
        // Normale dans le plan (v, z) ; v au cap 342°, donc (x, y) = f.pt dirigé par −sin(rot), cos(rot).
        const org = f.pt(0, 0);
        const vx = f.pt(0, 1)[0] - org[0], vy = f.pt(0, 1)[1] - org[1];
        const shadeK = 0.96 + 0.08 * Math.cos(Math.PI * mid);
        quad(toThree(...f.pt(u0, vA), zA), toThree(...f.pt(u1, vA), zA), toThree(...f.pt(u1, vB), zB), toThree(...f.pt(u0, vB), zB),
          toThree((-slope * vx * nv), (-slope * vy * nv), nv), shade(VAULT, shadeK));
      }
    }
  }

  // --- Gymnase : emprise découpée en bandes, bas-côtés plats et hall à deux pentes --------------------------------------------------------
  if (m.gym) {
    const g = m.gym;
    const ring: XY[] = [];
    for (let i = 0; i < g.ring.length; i += 2) ring.push([g.ring[i]!, g.ring[i + 1]!]);
    const { poly, n } = outward(ring);
    const uvRing = poly.map((p) => f.uv(p));
    const zOf = (x: number, y: number): number => gymRoofZ(g.strips, f.uv([x, y])[0]);
    // Murs : le haut suit le toit ; chaque côté est coupé aux limites de bande pour que le haut soit linéaire sur chaque morceau.
    const cuts = [...new Set(g.strips.flatMap((s) => [s.u[0], s.u[1], ...(s.ridge ? [s.ridge[0]] : [])]))].sort((a, b) => a - b);
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      const up0 = uvRing[i]![0], uq = uvRing[(i + 1) % poly.length]![0];
      const ts = [0, 1];
      for (const c of cuts) {
        const t = (c - up0) / (uq - up0);
        if (Number.isFinite(t) && t > 1e-6 && t < 1 - 1e-6) ts.push(t);
      }
      ts.sort((a, b) => a - b);
      for (let k = 0; k < ts.length - 1; k++) {
        const a: XY = [p[0] + (q[0] - p[0]) * ts[k]!, p[1] + (q[1] - p[1]) * ts[k]!], b: XY = [p[0] + (q[0] - p[0]) * ts[k + 1]!, p[1] + (q[1] - p[1]) * ts[k + 1]!];
        if (!Number.isFinite(zOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))) continue;
        // Haut linéaire entre a et b : on lit les deux extrémités légèrement à l'intérieur du morceau (la bande est celle du milieu).
        const eps = 1e-6;
        const ua = f.uv(a)[0], ub = f.uv(b)[0], um = (ua + ub) / 2;
        const zAt = (u: number): number => gymRoofZ(g.strips, um + (u - um) * (1 - eps));
        wall(a, b, null, (x, y) => zAt(f.uv([x, y])[0]), n(p, q), WALL);
      }
    });
    // Dessus : chaque bande ; le hall est coupé au faîtage.
    for (const s of g.strips) {
      const pieces: [number, number][] = s.ridge ? [[s.u[0], s.ridge[0]], [s.ridge[0], s.u[1]]] : [[s.u[0], s.u[1]]];
      for (const [a, b] of pieces) {
        const clipped = clipStrip(uvRing, a, b);
        if (clipped.length < 3) continue;
        const scene = clipped.map((p) => f.pt(p[0], p[1]));
        const zf = (p: XY): number => gymRoofZ(g.strips, f.uv(p)[0] + (s.ridge ? (f.uv(p)[0] < s.ridge[0] ? 1e-9 : -1e-9) : 0));
        if (s.ridge) {
          const slope = (s.ridge[1] - s.eave!) / (a === s.u[0] ? s.ridge[0] - s.u[0] : s.u[1] - s.ridge[0]);
          const side = a === s.u[0] ? -1 : 1; // pente vers les u décroissants (avant le faîtage) ou croissants
          const ux = f.pt(1, 0)[0] - f.pt(0, 0)[0], uy = f.pt(1, 0)[1] - f.pt(0, 0)[1];
          const nl = Math.hypot(slope, 1);
          tris(scene, zf, toThree((side * slope * ux) / nl, (side * slope * uy) / nl, 1 / nl), HALL);
        } else tris(scene, zf, up, ROOF);
      }
    }
    // Marches entre bandes de niveaux différents : mur de la bande la plus haute, au-dessus de la plus basse.
    for (let i = 0; i + 1 < g.strips.length; i++) {
      const A = g.strips[i]!;
      const U = A.u[1];
      const zA = gymRoofZ(g.strips, U - 1e-6), zB = gymRoofZ(g.strips, U + 1e-6);
      if (Math.abs(zA - zB) < 0.05) continue;
      const vs: number[] = [];
      uvRing.forEach((p, k) => {
        const q = uvRing[(k + 1) % uvRing.length]!;
        if ((p[0] - U) * (q[0] - U) < 0) vs.push(p[1] + ((q[1] - p[1]) * (U - p[0])) / (q[0] - p[0]));
      });
      if (vs.length < 2) continue;
      const lo = Math.min(zA, zB), hi = Math.max(zA, zB);
      const pa = f.pt(U, Math.min(...vs)), pb = f.pt(U, Math.max(...vs));
      const low = zA < zB ? 1 : -1; // le mur regarde le côté bas
      const ux = f.pt(1, 0)[0] - f.pt(0, 0)[0], uy = f.pt(1, 0)[1] - f.pt(0, 0)[1];
      wall(pa, pb, lo, () => hi, [-low * ux, -low * uy], WALL);
    }
  }
}
