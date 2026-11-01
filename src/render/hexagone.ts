import * as THREE from "three";
import type { HeightField, HexagoneModel } from "../data/types";
import { HEX_SIDES, hexagoneFootAt, hexagoneShape } from "../core/landmarks";
import { toThree, type Vec3 } from "./geometry";
import { buildFront, buildNorthEast, frameOf, type Frame } from "./hexagone-facade";
import type { LandmarkSinks } from "./landmarks";

/**
 * L'Hexagone d'Autun (D165), d'après les relevés LiDAR du lot 0 (docs/plans/hexagone.md §8) : pyramide régulière à 12 pans (pente 0,2, bac acier
 * bleu-gris) posée sur un tambour de 12 pans, au-dessus d'une couronne de six terrasses de niveaux différents (contour BD TOPO, six secteurs de
 * 35° + 60°·k ± 30° autour du sommet, acrotère, marches entre secteurs voisins) et d'une annexe haute à l'est. Lot 2 (D166) : les façades ouest et nord-est sont dessinées par
 * hexagone-facade.ts à la place des murs de leur secteur ; les autres côtés restent des murs unis.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

/** Hauteur de l'acrotère autour des terrasses et pas maximal des murs (suivre le relief). */
const PARAPET = 0.45;
const STEP = 3;

type XY = [number, number];

const dirOf = (cap: number): XY => [Math.sin((cap * Math.PI) / 180), Math.cos((cap * Math.PI) / 180)];
const capOf = (dx: number, dy: number): number => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
const up = toThree(0, 0, 1);

export function buildHexagone(sinks: LandmarkSinks, m: HexagoneModel, terrain: HeightField): void {
  const mb = sinks.solid;
  const { foot, mid } = hexagoneShape(m);
  const WALL = C(m.colors.wall), ROOF = C(m.colors.roof), DECK = C(m.colors.deck), DRUM = C(m.colors.drum), ANNEX = C(m.colors.annex);
  const ground = (x: number, y: number): number => terrain.heightAt(x, y) - 0.3;
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, col: THREE.Color): void => mb.quad(a, b, c, d, n, col);
  /** Mur vertical de (x0, y0) à (x1, y1), du bas `z0` (nombre, ou fonction du point) au haut `z1`, normale horizontale (nx, ny). */
  const wall = (p: XY, q: XY, z0: number | null, z1: number, n: XY, col: THREE.Color): void => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const k = Math.max(1, Math.ceil(len / STEP));
    for (let j = 0; j < k; j++) {
      const a: XY = [p[0] + ((q[0] - p[0]) * j) / k, p[1] + ((q[1] - p[1]) * j) / k];
      const b: XY = [p[0] + ((q[0] - p[0]) * (j + 1)) / k, p[1] + ((q[1] - p[1]) * (j + 1)) / k];
      const za = z0 ?? ground(...a), zb = z0 ?? ground(...b);
      if (z1 <= Math.min(za, zb) + 0.01) continue;
      quad(toThree(...a, za), toThree(...b, zb), toThree(...b, Math.max(z1, zb)), toThree(...a, Math.max(z1, za)), toThree(n[0], n[1], 0), col);
    }
  };

  // --- Pyramide : 12 pans plans (pente 0,2) et jupon plus raide (≈ 0,7) au bas de chacun, deux tons alternés ------------------------
  const [skirtR, skirtZ] = m.skirt;
  const slope = (m.apex - skirtZ) / skirtR, steep = (skirtZ - m.foot) / (m.apothem - skirtR);
  for (let i = 0; i < 12; i++) {
    const a = foot[i]!, b = foot[(i + 1) % 12]!, ma = mid[i]!, mb2 = mid[(i + 1) % 12]!;
    const [nx, ny] = dirOf(m.hip + 15 + 30 * i);
    const col = shade(ROOF, i % 2 ? 0.93 : 1.06);
    const nl = Math.hypot(slope, 1);
    mb.tri(toThree(...ma, skirtZ), toThree(...mb2, skirtZ), toThree(m.c[0], m.c[1], m.apex), toThree((nx * slope) / nl, (ny * slope) / nl, 1 / nl), col);
    const sl = Math.hypot(steep, 1);
    quad(toThree(...a, m.foot), toThree(...b, m.foot), toThree(...mb2, skirtZ), toThree(...ma, skirtZ), toThree((nx * steep) / sl, (ny * steep) / sl, 1 / sl), shade(col, 0.9));
  }

  // --- Niveau de chaque terrasse, et celui de l'arête du tambour qui lui fait face ----------------------------------------------------
  const deck = m.sides.map((s) => s[1]);
  const sectorOf = (cap: number): number => {
    let best = 0, d = 1e9;
    HEX_SIDES.forEach((n, k) => {
      const e = Math.abs((((cap - n) % 360) + 540) % 360 - 180);
      if (e < d) { d = e; best = k; }
    });
    return best;
  };

  // --- Tambour : de la terrasse au pied de la pyramide ------------------------------------------------------------------------------
  for (let i = 0; i < 12; i++) {
    const a = foot[i]!, b = foot[(i + 1) % 12]!;
    const k = sectorOf(m.hip + 15 + 30 * i);
    wall(a, b, deck[k]!, m.foot, dirOf(m.hip + 15 + 30 * i), DRUM);
  }

  // --- Contour extérieur : emprise BD TOPO, coupée aux limites des six secteurs (caps 35° + 60°·k ± 30°) --------------------------------
  const ring: XY[] = [];
  for (let i = 0; i < m.ring.length; i += 2) ring.push([m.ring[i]!, m.ring[i + 1]!]);
  const capTo = (p: XY): number => capOf(p[0] - m.c[0], p[1] - m.c[1]);
  // Faces dessinées à part (façade ouest, face nord-est) : leurs murs de contour ne sont pas tracés, un tablier au niveau de la terrasse comble l'écart.
  const faces: { f: Frame; s: [number, number]; z: number }[] = [];
  const addFace = (cap: number, d: number, sr: [number, number]): void => {
    faces.push({ f: frameOf(m, cap, d), s: [sr[0] - 0.5, sr[1] + 0.5], z: 0 });
  };
  if (m.front) addFace(m.front.cap, m.front.d, m.front.s);
  if (m.ne) addFace(m.ne.cap, m.ne.d, m.ne.s);
  const inFace = (p: XY): boolean => faces.some(({ f, s: sr }) => {
    const [ss, tt] = f.st(p);
    return ss > sr[0] && ss < sr[1] && tt > -4.5 && tt < 3.5;
  });
  const bounds = HEX_SIDES.map((n) => (n + 30) % 360);
  const pieces: [XY, XY][] = [];
  const crossings: Map<number, XY[]> = new Map();
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    let cuts: { t: number; b: number }[] = [];
    for (const bc of bounds) {
      const [dx, dy] = dirOf(bc), ex = q[0] - p[0], ey = q[1] - p[1];
      const det = ex * dy - ey * dx;
      if (Math.abs(det) < 1e-9) continue;
      const wx = m.c[0] - p[0], wy = m.c[1] - p[1];
      const t = (wx * dy - wy * dx) / det, u = (wx * ey - wy * ex) / det;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 0) cuts.push({ t, b: bc });
    }
    cuts = cuts.sort((x, y) => x.t - y.t);
    let prev: XY = p;
    for (const { t, b } of cuts) {
      const x: XY = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      pieces.push([prev, x]);
      crossings.set(b, [...(crossings.get(b) ?? []), x]);
      prev = x;
    }
    pieces.push([prev, q]);
  }
  const dirSign = (() => {
    let area = 0;
    ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]!; area += p[0] * q[1] - q[0] * p[1]; });
    return area > 0 ? 1 : -1;
  })();

  // --- Terrasses : dessus (quadrilatères radiaux entre le mur et le pied), mur extérieur, acrotère -----------------------------------
  for (const [p0, q0] of pieces) {
    const len = Math.hypot(q0[0] - p0[0], q0[1] - p0[1]);
    if (len < 0.05) continue;
    const k = sectorOf(capTo([(p0[0] + q0[0]) / 2, (p0[1] + q0[1]) / 2]));
    const z = deck[k]!;
    // Mur extérieur (normale sortante d'après le sens du contour) et acrotère.
    const n: XY = [(dirSign * (q0[1] - p0[1])) / len, (-dirSign * (q0[0] - p0[0])) / len];
    const own = inFace([(p0[0] + q0[0]) / 2, (p0[1] + q0[1]) / 2]);
    if (!own) wall(p0, q0, null, z + PARAPET, n, WALL);
    const t = 0.3;
    const A2: XY = [p0[0] - n[0] * t, p0[1] - n[1] * t], B2: XY = [q0[0] - n[0] * t, q0[1] - n[1] * t];
    if (!own) wall(A2, B2, z, z + PARAPET, [-n[0], -n[1]], shade(WALL, 0.9));
    if (!own) quad(toThree(...p0, z + PARAPET), toThree(...q0, z + PARAPET), toThree(...B2, z + PARAPET), toThree(...A2, z + PARAPET), up, shade(WALL, 1.05));
    // Dessus : du mur au pied de la pyramide, le long des deux rayons et des sommets du pied entre eux.
    let [pa, qa] = [p0, q0];
    let ca = capTo(pa), cb = capTo(qa);
    if (((cb - ca + 540) % 360) - 180 < 0) { [pa, qa] = [qa, pa]; [ca, cb] = [cb, ca]; }
    if (Math.abs(((cb - ca + 540) % 360) - 180) < 0.05) continue;
    const span = (cb - ca + 360) % 360;
    const chain: XY[] = [hexagoneFootAt(m, ca)];
    for (let i = 0; i < 12; i++) {
      const off = (m.hip + 30 * i - ca + 360) % 360;
      if (off > 0.01 && off < span - 0.01) chain.push(foot[i]!);
    }
    chain.push(hexagoneFootAt(m, cb));
    const poly: XY[] = [pa, qa, ...chain.slice().reverse()];
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [i, j, l] of tris) mb.tri(toThree(...poly[i!]!, z), toThree(...poly[j!]!, z), toThree(...poly[l!]!, z), up, DECK);
  }

  for (const fc of faces) {
    const k = sectorOf(capOf(fc.f.n[0], fc.f.n[1]));
    const z = deck[k]!;
    quad(toThree(...fc.f.pt(fc.s[0], -4.5), z), toThree(...fc.f.pt(fc.s[1], -4.5), z), toThree(...fc.f.pt(fc.s[1], 0), z), toThree(...fc.f.pt(fc.s[0], 0), z), up, DECK);
  }
  if (m.front) buildFront(sinks, m, terrain);
  if (m.ne) buildNorthEast(sinks, m, terrain);

  // --- Marches entre secteurs voisins de niveaux différents : du pied de la pyramide au contour, le long de la limite -------------------
  bounds.forEach((bc, j) => {
    const lo = deck[j]!, hi = deck[(j + 1) % 6]!;
    const hits = crossings.get(bc);
    if (Math.abs(lo - hi) < 0.05 || !hits?.length) return;
    const V = hits.reduce((a, b2) => (Math.hypot(b2[0] - m.c[0], b2[1] - m.c[1]) > Math.hypot(a[0] - m.c[0], a[1] - m.c[1]) ? b2 : a));
    const F = hexagoneFootAt(m, bc);
    const [dx, dy] = dirOf(bc);
    // Tangente dans le sens horaire : vers le secteur j + 1 ; le mur regarde le secteur le plus bas.
    const toward = lo > hi ? 1 : -1;
    const nrm: XY = [dy * toward, -dx * toward];
    const eps = 0.02;
    wall([F[0] + nrm[0] * eps, F[1] + nrm[1] * eps], [V[0] + nrm[0] * eps, V[1] + nrm[1] * eps], Math.min(lo, hi), Math.max(lo, hi) + PARAPET, nrm, WALL);
  });

  // --- Annexe haute à l'est -----------------------------------------------------------------------------------------------------------
  if (m.annex) {
    const r: XY[] = [];
    for (let i = 0; i < m.annex.r.length; i += 2) r.push([m.annex.r[i]!, m.annex.r[i + 1]!]);
    let area = 0;
    r.forEach((p, i) => { const q = r[(i + 1) % r.length]!; area += p[0] * q[1] - q[0] * p[1]; });
    const sign = area > 0 ? 1 : -1;
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length]!;
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      wall(p, q, null, m.annex!.z, [(sign * (q[1] - p[1])) / l, (-sign * (q[0] - p[0])) / l], ANNEX);
    });
    const tris = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [i, j, l] of tris) mb.tri(toThree(...r[i!]!, m.annex.z), toThree(...r[j!]!, m.annex.z), toThree(...r[l!]!, m.annex.z), up, shade(ANNEX, 1.25));
  }
}
