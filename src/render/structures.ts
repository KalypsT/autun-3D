import * as THREE from "three";
import type { Deck, HeightField, TileStructures } from "../data/types";
import { DeckAxis } from "../core/bridges";
import { hash01, MeshBuilder, toThree, type Vec3 } from "./geometry";
import { fillOnTerrain } from "./ground";
import { T } from "./style";

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const STONE = C("#cbbd9c");
const CONCRETE = C("#bdb8ad");
const STEEL = C("#4f585b");
const WOOD = C("#9a7a55");
const BALLAST = C("#9b8f7f");
const SLEEPER = C("#6b5a4a");
const RAIL = C("#8d9296");
const FOAM = C("#d9eef0");

/** Rails : écartement standard, entre les axes des deux files (m). */
const GAUGE = 1.435;

/** Quad vertical entre deux points du sol (x, y) et deux paires d'altitudes, normale horizontale (nx, ny). */
function wallQuad(mb: MeshBuilder, ax: number, ay: number, az0: number, az1: number, bx: number, by: number, bz0: number, bz1: number, nx: number, ny: number, color: THREE.Color): void {
  mb.quad(toThree(ax, ay, az0), toThree(bx, by, bz0), toThree(bx, by, bz1), toThree(ax, ay, az1), toThree(nx, ny, 0), color);
}

/** Pavé droit d'axe (ux, uy), demi-côtés hl et hw, de z0 à z1 (faces latérales et dessus). */
function box(mb: MeshBuilder, cx: number, cy: number, ux: number, uy: number, hl: number, hw: number, z0: number, z1: number, color: THREE.Color): void {
  const vx = -uy, vy = ux;
  const p = (s: number, t: number): [number, number] => [cx + ux * s + vx * t, cy + uy * s + vy * t];
  const pts = [p(-hl, -hw), p(hl, -hw), p(hl, hw), p(-hl, hw)];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    wallQuad(mb, ax, ay, z0, z1, bx, by, z0, z1, (by - ay) / len, -(bx - ax) / len, color);
  }
  const [a, b, c, d] = pts as [[number, number], [number, number], [number, number], [number, number]];
  mb.quad(toThree(a[0], a[1], z1), toThree(b[0], b[1], z1), toThree(c[0], c[1], z1), toThree(d[0], d[1], z1), [0, 1, 0], color);
}

// --- Ponts ------------------------------------------------------------------------------------------------------------------------

/** Abscisses d'échantillonnage : tous les `step` mètres, plus les points imposés. */
function stations(length: number, step: number, extra: number[] = []): number[] {
  const out = new Set<number>([0, length, ...extra.filter((s) => s > 0 && s < length)]);
  for (let s = step; s < length; s += step) out.add(s);
  return [...out].sort((a, b) => a - b);
}

/** Un tablier : dessus, rives, dessous, parapets ou garde-corps, piles, voûtes pour les ponts en pierre. */
export function buildDeck(mb: MeshBuilder, d: Deck, ground: HeightField): void {
  const axis = new DeckAxis(d);
  const L = axis.length;
  if (L < 1) return;
  const hw = d.w / 2;
  const thick = d.st === "light" ? 0.35 : d.k === "rail" ? 1.2 : 0.9;
  const body = d.st === "stone" ? STONE : d.k === "rail" ? STEEL : d.st === "light" ? STEEL : CONCRETE;
  const top = d.k === "rail" ? BALLAST : d.st === "light" ? WOOD : C(T.ground[4]);
  const ss = stations(L, 2, d.sp);
  const pts = ss.map((s) => axis.at(s));
  const edge = (i: number, side: number, inset = 0): [number, number] => {
    const a = pts[i]!;
    return [a.x + a.ty * (hw - inset) * side, a.y - a.tx * (hw - inset) * side];
  };

  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const [al, bl, ar, br] = [edge(i, 1), edge(i + 1, 1), edge(i, -1), edge(i + 1, -1)];
    // Dessus (sous les chaussées et trottoirs qui s'y posent : couvre ce qu'ils laissent) et dessous.
    mb.quad(toThree(al[0], al[1], a.z + 0.01), toThree(bl[0], bl[1], b.z + 0.01), toThree(br[0], br[1], b.z + 0.01), toThree(ar[0], ar[1], a.z + 0.01), [0, 1, 0], top);
    mb.quad(toThree(al[0], al[1], a.z - thick), toThree(bl[0], bl[1], b.z - thick), toThree(br[0], br[1], b.z - thick), toThree(ar[0], ar[1], a.z - thick), [0, -1, 0], shade(body, 0.7));
    for (const side of [1, -1]) {
      const [p, q] = side === 1 ? [al, bl] : [ar, br];
      const nx = a.ty * side, ny = -a.tx * side;
      const rise = d.st === "light" ? 0 : d.k === "rail" ? 0.5 : 1.0;
      // Rive (et face extérieure du parapet plein).
      wallQuad(mb, p[0], p[1], a.z - thick, a.z + rise, q[0], q[1], b.z - thick, b.z + rise, nx, ny, body);
      if (rise > 0 && d.k !== "rail") {
        const [pi, qi] = [edge(i, side, 0.35), edge(i + 1, side, 0.35)];
        wallQuad(mb, pi[0], pi[1], a.z, a.z + rise, qi[0], qi[1], b.z, b.z + rise, -nx, -ny, shade(body, 0.92));
        mb.quad(toThree(p[0], p[1], a.z + rise), toThree(q[0], q[1], b.z + rise), toThree(qi[0], qi[1], b.z + rise), toThree(pi[0], pi[1], a.z + rise), [0, 1, 0], shade(body, 1.08));
      }
    }
  }
  if (d.st === "light") railing(mb, axis, hw);
  if (d.k === "rail") girders(mb, axis, hw);

  // Piles et voûtes.
  const bounds = [0, ...d.sp, L];
  for (const s of d.sp) {
    const a = axis.at(s);
    const zg = ground.heightAt(a.x, a.y) - 1.0;
    const zt = a.z - thick;
    if (zt - zg < 0.8) continue;
    const half = d.st === "stone" ? 1.1 : 0.6;
    box(mb, a.x, a.y, a.tx, a.ty, half, hw + 0.15, zg, zt, shade(body, 0.95));
    if (d.st === "stone") {
      // Avant-becs : prismes triangulaires de part et d'autre, face au courant.
      for (const side of [1, -1]) {
        const nx = a.ty * side, ny = -a.tx * side;
        const b0: [number, number] = [a.x - a.tx * half + nx * (hw + 0.15), a.y - a.ty * half + ny * (hw + 0.15)];
        const b1: [number, number] = [a.x + a.tx * half + nx * (hw + 0.15), a.y + a.ty * half + ny * (hw + 0.15)];
        const tip: [number, number] = [a.x + nx * (hw + 1.4), a.y + ny * (hw + 1.4)];
        const zh = Math.min(zt, zg + (zt - zg) * 0.55);
        for (const [p, q] of [[b0, tip], [tip, b1]] as const) {
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          const nn: [number, number] = [(q[1] - p[1]) / len * side, -(q[0] - p[0]) / len * side];
          wallQuad(mb, p[0], p[1], zg, zh, q[0], q[1], zg, zh, nn[0], nn[1], shade(STONE, 0.9));
        }
        mb.tri(toThree(b0[0], b0[1], zh), toThree(b1[0], b1[1], zh), toThree(tip[0], tip[1], zh + 0.6), [0, 1, 0], shade(STONE, 1.05));
      }
    }
  }
  if (d.st === "stone") {
    for (let k = 0; k + 1 < bounds.length; k++) arch(mb, axis, bounds[k]!, bounds[k + 1]!, hw, thick, ground);
  } else {
    // Culées : murs en travers sous les deux bouts, quand le tablier est au-dessus du sol.
    for (const s of [0.3, L - 0.3]) {
      const a = axis.at(s);
      const zg = ground.heightAt(a.x, a.y);
      if (a.z - thick - zg < 0.4) continue;
      const nx = a.tx * (s < L / 2 ? 1 : -1), ny = a.ty * (s < L / 2 ? 1 : -1);
      const l: [number, number] = [a.x + a.ty * hw, a.y - a.tx * hw], r: [number, number] = [a.x - a.ty * hw, a.y + a.tx * hw];
      wallQuad(mb, l[0], l[1], zg - 0.5, a.z - thick, r[0], r[1], zg - 0.5, a.z - thick, nx, ny, shade(body, 0.85));
    }
  }
}

function shade(c: THREE.Color, k: number): THREE.Color {
  return c.clone().multiplyScalar(k);
}

/**
 * Voûte en plein cintre surbaissé entre deux appuis : tympans (murs de tête) de part et d'autre, du dessous du tablier jusqu'à la courbe
 * de l'arc, et intrados. La flèche tient sous le tablier et au-dessus du sol (sinon, tympan plein jusqu'au sol).
 */
function arch(mb: MeshBuilder, axis: DeckAxis, s0: number, s1: number, hw: number, thick: number, ground: HeightField): void {
  const n = 10;
  const span = s1 - s0;
  const samples = Array.from({ length: n + 1 }, (_, k) => axis.at(s0 + (span * k) / n));
  const soffit = Math.min(...samples.map((a) => a.z)) - thick;
  const low = Math.min(...samples.map((a) => ground.heightAt(a.x, a.y)));
  const clearance = soffit - low;
  const rise = Math.min(span * 0.42, clearance * 0.85);
  const crown = soffit - 0.3;
  const spring = crown - rise;
  const curve = (u: number): number => (rise < 0.6 ? low - 1 : spring + rise * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)));
  const dark = shade(STONE, 0.75);
  for (let k = 0; k < n; k++) {
    const a = samples[k]!, b = samples[k + 1]!;
    const za = curve(k / n), zb = curve((k + 1) / n);
    for (const side of [1, -1]) {
      const pa: [number, number] = [a.x + a.ty * hw * side, a.y - a.tx * hw * side], pb: [number, number] = [b.x + b.ty * hw * side, b.y - b.tx * hw * side];
      wallQuad(mb, pa[0], pa[1], Math.min(za, a.z - thick), a.z - thick, pb[0], pb[1], Math.min(zb, b.z - thick), b.z - thick, a.ty * side, -a.tx * side, STONE);
      // Bandeau de l'arc (claveaux), légèrement en relief.
      if (rise >= 0.6) {
        const off = 0.06;
        const qa: [number, number] = [pa[0] + a.ty * off * side, pa[1] - a.tx * off * side], qb: [number, number] = [pb[0] + b.ty * off * side, pb[1] - b.tx * off * side];
        wallQuad(mb, qa[0], qa[1], za, za + 0.45, qb[0], qb[1], zb, zb + 0.45, a.ty * side, -a.tx * side, shade(STONE, 1.06));
      }
    }
    if (rise >= 0.6) {
      const l0: Vec3 = toThree(a.x + a.ty * hw, a.y - a.tx * hw, za), l1: Vec3 = toThree(b.x + b.ty * hw, b.y - b.tx * hw, zb);
      const r0: Vec3 = toThree(a.x - a.ty * hw, a.y + a.tx * hw, za), r1: Vec3 = toThree(b.x - b.ty * hw, b.y + b.tx * hw, zb);
      mb.quad(l0, l1, r1, r0, [0, -1, 0], dark);
    }
  }
}

/** Garde-corps d'une passerelle : poteaux tous les 1,5 m, main courante et lisse. */
function railing(mb: MeshBuilder, axis: DeckAxis, hw: number): void {
  for (const side of [1, -1]) {
    let prev: { x: number; y: number; z: number } | null = null;
    for (const s of stations(axis.length, 1.5)) {
      const a = axis.at(s);
      const x = a.x + a.ty * (hw - 0.05) * side, y = a.y - a.tx * (hw - 0.05) * side;
      box(mb, x, y, a.tx, a.ty, 0.03, 0.03, a.z, a.z + 1.05, STEEL);
      if (prev) {
        for (const h of [1.0, 0.5]) {
          for (const k of [1, -1]) {
            mb.quad(toThree(prev.x, prev.y, prev.z + h), toThree(x, y, a.z + h), toThree(x, y, a.z + h + 0.06), toThree(prev.x, prev.y, prev.z + h + 0.06),
              toThree(a.ty * side * k, -a.tx * side * k, 0), STEEL);
          }
        }
      }
      prev = { x, y, z: a.z };
    }
  }
}

/** Poutres latérales d'un pont-rail : âmes sombres et semelle claire. */
function girders(mb: MeshBuilder, axis: DeckAxis, hw: number): void {
  const pts = stations(axis.length, 2).map((s) => axis.at(s));
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    for (const side of [1, -1]) {
      const pa: [number, number] = [a.x + a.ty * (hw + 0.02) * side, a.y - a.tx * (hw + 0.02) * side], pb: [number, number] = [b.x + b.ty * (hw + 0.02) * side, b.y - b.tx * (hw + 0.02) * side];
      wallQuad(mb, pa[0], pa[1], a.z + 0.3, a.z + 0.55, pb[0], pb[1], b.z + 0.3, b.z + 0.55, a.ty * side, -a.tx * side, C("#7d878a"));
    }
  }
}

// --- Eau ----------------------------------------------------------------------------------------------------------------------------

function onBounds(x: number, y: number, b: readonly number[]): boolean {
  const e = 0.05;
  return Math.abs(x - b[0]!) < e || Math.abs(x - b[2]!) < e || Math.abs(y - b[1]!) < e || Math.abs(y - b[3]!) < e;
}

function inRing(x: number, y: number, r: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ruban posé sur le relief le long d'une ligne (largeur w), découpé en quads épousant le sol. */
function ribbon(mb: MeshBuilder, p: readonly number[], w: number, lift: number, color: THREE.Color, ground: HeightField): void {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i]!, ay = p[i + 1]!, bx = p[i + 2]!, by = p[i + 3]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.05) continue;
    const nx = ((by - ay) / len) * (w / 2), ny = (-(bx - ax) / len) * (w / 2);
    fillOnTerrain(mb, [[ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]], lift, color, ground);
  }
}

/** Eau : surfaces, liseré clair sur les rives, rides ; ruisseaux en rubans ; écume des seuils. Tout est posé sur le relief nu. */
export function buildWater(mb: MeshBuilder, st: TileStructures, bounds: readonly number[], ground: HeightField): void {
  const water = C(T.water);
  const ripple = water.clone().lerp(C("#ffffff"), 0.35);
  for (const poly of st.water) {
    fillOnTerrain(mb, poly, 0.06, water, ground);
    for (const ring of poly) {
      // Liseré : sur chaque côté qui n'est pas une coupure de tuile.
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[2 * i]!, ay = ring[2 * i + 1]!, bx = ring[2 * j]!, by = ring[2 * j + 1]!;
        if (onBounds(ax, ay, bounds) && onBounds(bx, by, bounds)) continue;
        ribbon(mb, [ax, ay, bx, by], 0.5, 0.075, FOAM, ground);
      }
    }
    // Rides : petits traits clairs semés sur une grille de 6 m.
    const outer = poly[0]!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      x0 = Math.min(x0, outer[i]!); x1 = Math.max(x1, outer[i]!); y0 = Math.min(y0, outer[i + 1]!); y1 = Math.max(y1, outer[i + 1]!);
    }
    for (let x = Math.ceil(x0 / 6) * 6; x < x1; x += 6) {
      for (let y = Math.ceil(y0 / 6) * 6; y < y1; y += 6) {
        const h = hash01(`${x},${y}`);
        if (h > 0.45) continue;
        const px = x + (h - 0.2) * 8, py = y + hash01(`${y},${x}`) * 4;
        if (!inRing(px, py, outer) || poly.slice(1).some((r) => inRing(px, py, r))) continue;
        const a = 0.4 + h, l = 0.7 + h * 1.5;
        ribbon(mb, [px - Math.cos(a) * l, py - Math.sin(a) * l, px + Math.cos(a) * l, py + Math.sin(a) * l], 0.12, 0.08, ripple, ground);
      }
    }
  }
  for (const s of st.streams) {
    ribbon(mb, s.p, s.w + 0.6, 0.05, C("#7f9a6a"), ground);
    ribbon(mb, s.p, s.w, 0.07, water, ground);
  }
  for (const w of st.weirs) ribbon(mb, w.p, 1.8, 0.1, FOAM, ground);
}

// --- Voies ferrées --------------------------------------------------------------------------------------------------------------------

/** Voie : ballast, une traverse par mètre, deux files de rails ; altitude du tablier ferroviaire ou du relief. */
export function buildRails(mb: MeshBuilder, st: TileStructures, railZ: (x: number, y: number) => number): void {
  for (const r of st.rails) {
    const p = r.p;
    const cum = [0];
    for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1]! + Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!));
    const L = cum[cum.length - 1]!;
    if (L < 1) continue;
    const at = (s: number): { x: number; y: number; tx: number; ty: number } => {
      let j = 1;
      while (j < cum.length - 1 && cum[j]! < s) j++;
      const s0 = cum[j - 1]!, s1 = cum[j]!;
      const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
      const ax = p[2 * (j - 1)]!, ay = p[2 * (j - 1) + 1]!, bx = p[2 * j]!, by = p[2 * j + 1]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, tx: (bx - ax) / len, ty: (by - ay) / len };
    };
    const half = r.s ? 1.3 : 1.6;
    // Une traverse par mètre ; ballast et rails par tronçons de trois traverses (les voies sont presque droites).
    const step = 1.0, group = 3;
    const samples: { x: number; y: number; z: number; tx: number; ty: number }[] = [];
    for (let s = 0; s <= L + 1e-6; s += step) {
      const a = at(Math.min(s, L));
      samples.push({ ...a, z: railZ(a.x, a.y) });
    }
    const sleeper = r.s ? shade(SLEEPER, 1.1) : SLEEPER;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i]!;
      // Traverse : dessus et deux longs côtés.
      const hl = 1.2, hw = 0.12, z0 = a.z + 0.06, z1 = a.z + 0.17;
      const px = a.ty, py = -a.tx;
      const c = (u: number, v: number): [number, number] => [a.x + px * u + a.tx * v, a.y + py * u + a.ty * v];
      const [p0, p1, p2, p3] = [c(-hl, -hw), c(hl, -hw), c(hl, hw), c(-hl, hw)];
      mb.quad(toThree(p0[0], p0[1], z1), toThree(p1[0], p1[1], z1), toThree(p2[0], p2[1], z1), toThree(p3[0], p3[1], z1), [0, 1, 0], sleeper);
      wallQuad(mb, p0[0], p0[1], z0, z1, p1[0], p1[1], z0, z1, -a.tx, -a.ty, shade(sleeper, 0.8));
      wallQuad(mb, p3[0], p3[1], z0, z1, p2[0], p2[1], z0, z1, a.tx, a.ty, shade(sleeper, 0.8));
      if (i % group !== 0 || i + 1 >= samples.length) continue;
      const b = samples[Math.min(i + group, samples.length - 1)]!;
      // Ballast et ses talus.
      const bl = (q: typeof a, side: number): Vec3 => toThree(q.x + q.ty * half * side, q.y - q.tx * half * side, q.z + 0.07);
      mb.quad(bl(a, 1), bl(b, 1), bl(b, -1), bl(a, -1), [0, 1, 0], BALLAST);
      for (const side of [1, -1]) {
        const lo = (q: typeof a): Vec3 => toThree(q.x + q.ty * (half + 0.5) * side, q.y - q.tx * (half + 0.5) * side, q.z - 0.15);
        mb.quad(bl(a, side), bl(b, side), lo(b), lo(a), toThree(a.ty * side * 0.5, -a.tx * side * 0.5, 0.86), shade(BALLAST, 0.9));
      }
      // Rails : dessus clair et deux flancs.
      for (const side of [1, -1]) {
        const off = (GAUGE / 2) * side;
        const ra: [number, number] = [a.x + a.ty * off, a.y - a.tx * off], rb: [number, number] = [b.x + b.ty * off, b.y - b.tx * off];
        const w = 0.035;
        mb.quad(toThree(ra[0] + a.ty * w, ra[1] - a.tx * w, a.z + 0.32), toThree(rb[0] + b.ty * w, rb[1] - b.tx * w, b.z + 0.32),
          toThree(rb[0] - b.ty * w, rb[1] + b.tx * w, b.z + 0.32), toThree(ra[0] - a.ty * w, ra[1] + a.tx * w, a.z + 0.32), [0, 1, 0], C("#c9cdd0"));
        for (const k of [1, -1]) {
          wallQuad(mb, ra[0] + a.ty * w * k, ra[1] - a.tx * w * k, a.z + 0.17, a.z + 0.32, rb[0] + b.ty * w * k, rb[1] - b.tx * w * k, b.z + 0.17, b.z + 0.32,
            a.ty * k, -a.tx * k, RAIL);
        }
      }
    }
  }
}

/** Quais (dalle, bordure blanche, abri) et passages à niveau (barrières levées, croix de Saint-André). */
export function buildStations(mb: MeshBuilder, st: TileStructures, surface: (x: number, y: number) => number, ground: HeightField): void {
  for (const pl of st.platforms) {
    const r = pl.r;
    const n = r.length / 2;
    if (n < 3) continue;
    let zTop = -Infinity, zLow = Infinity, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const g = ground.heightAt(r[2 * i]!, r[2 * i + 1]!);
      zTop = Math.max(zTop, g);
      zLow = Math.min(zLow, g);
      cx += r[2 * i]! / n;
      cy += r[2 * i + 1]! / n;
    }
    zTop += pl.h;
    const ccw = (() => {
      let a = 0;
      for (let i = 0; i < n; i++) a += r[2 * i]! * r[2 * ((i + 1) % n) + 1]! - r[2 * ((i + 1) % n)]! * r[2 * i + 1]!;
      return a > 0;
    })();
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[2 * i]!, ay = r[2 * i + 1]!, bx = r[2 * j]!, by = r[2 * j + 1]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const s = ccw ? 1 : -1;
      wallQuad(mb, ax, ay, zLow - 0.3, zTop, bx, by, zLow - 0.3, zTop, ((by - ay) / len) * s, (-(bx - ax) / len) * s, CONCRETE);
      // Bordure claire de 30 cm sur le dessus.
      const ix = (-(by - ay) / len) * s * 0.3, iy = ((bx - ax) / len) * s * 0.3;
      mb.quad(toThree(ax, ay, zTop + 0.01), toThree(bx, by, zTop + 0.01), toThree(bx + ix, by + iy, zTop + 0.01), toThree(ax + ix, ay + iy, zTop + 0.01), [0, 1, 0], C("#f2efe6"));
    }
    const shape = Array.from({ length: n }, (_, i) => new THREE.Vector2(r[2 * i], r[2 * i + 1]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(shape, [])) {
      const a = shape[i!]!, b = shape[j!]!, c = shape[k!]!;
      mb.tri(toThree(a.x, a.y, zTop), toThree(b.x, b.y, zTop), toThree(c.x, c.y, zTop), [0, 1, 0], C("#d8d2c4"));
    }
    // Abri de quai au milieu : quatre poteaux et un toit.
    if (inRing(cx, cy, r)) {
      let ux = 1, uy = 0, best = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = r[2 * j]! - r[2 * i]!, dy = r[2 * j + 1]! - r[2 * i + 1]!;
        const l = Math.hypot(dx, dy);
        if (l > best) [best, ux, uy] = [l, dx / l, dy / l];
      }
      for (const su of [-2.6, 2.6]) for (const sv of [-0.8, 0.8]) box(mb, cx + ux * su - uy * sv, cy + uy * su + ux * sv, ux, uy, 0.05, 0.05, zTop, zTop + 2.6, STEEL);
      box(mb, cx, cy, ux, uy, 3.2, 1.3, zTop + 2.6, zTop + 2.75, C("#3f6f8a"));
    }
  }
  for (const [x, y, a] of st.crossings) {
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    for (const k of [1, -1]) {
      const px = x + vx * 3.6 * k + ux * 3.4 * k, py = y + vy * 3.6 * k + uy * 3.4 * k;
      const zp = surface(px, py);
      box(mb, px, py, ux, uy, 0.2, 0.2, zp - 0.2, zp + 1.1, C("#e8e4da"));
      // Barrière levée : bandes rouges et blanches.
      for (let h = 0; h < 8; h++) box(mb, px, py + 0, ux, uy, 0.05, 0.05, zp + 1.1 + h * 0.5, zp + 1.6 + h * 0.5, h % 2 ? C("#f2efe6") : C("#d3313a"));
      // Croix de Saint-André sur un poteau à côté.
      const sx = px + ux * 0.9 * k, sy = py + uy * 0.9 * k;
      box(mb, sx, sy, ux, uy, 0.04, 0.04, zp, zp + 2.4, STEEL);
      for (const tilt of [1, -1]) {
        const c0x = sx - vx * 0.55 * tilt, c0y = sy - vy * 0.55 * tilt;
        const c1x = sx + vx * 0.55 * tilt, c1y = sy + vy * 0.55 * tilt;
        for (const face of [1, -1]) {
          mb.quad(toThree(c0x, c0y, zp + 2.0 - 0.06), toThree(c1x, c1y, zp + 2.8 - 0.06), toThree(c1x, c1y, zp + 2.8 + 0.06), toThree(c0x, c0y, zp + 2.0 + 0.06),
            toThree(ux * face, uy * face, 0), C("#f2efe6"));
        }
      }
    }
  }
}

/**
 * Ouvrages en volume d'une tuile (tabliers, voies, quais, passages à niveau) ; l'eau va dans le sol (`buildWater`).
 * `surface` : altitude avec tabliers ; `ground` : relief nu ; `railZ` : rails (tablier ferroviaire ou relief).
 */
export function buildStructures(mb: MeshBuilder, st: TileStructures, bounds: readonly number[], surface: HeightField, ground: HeightField,
  railZ: (x: number, y: number) => number): void {
  const seen = new Set<number>();
  for (const d of st.decks) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    // Un tablier présent dans plusieurs tuiles n'est dessiné que par celle qui contient son milieu.
    const axis = new DeckAxis(d);
    const mid = axis.at(axis.length / 2);
    if (mid.x < bounds[0]! || mid.x >= bounds[2]! || mid.y < bounds[1]! || mid.y >= bounds[3]!) continue;
    buildDeck(mb, d, ground);
  }
  buildRails(mb, st, railZ);
  buildStations(mb, st, (x, y) => surface.heightAt(x, y), ground);
}
