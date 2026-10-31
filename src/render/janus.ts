import * as THREE from "three";
import type { HeightField, JanusSite, JanusWall } from "../data/types";
import { at, frameOf, janusSlabs, type JanusSlab, type Opening } from "../core/landmarks";
import { MeshBuilder } from "./geometry";
import { columns, GateDraw, openingTop } from "./gates";

/**
 * Temple de Janus d'après photo (D139), à pans nets : les deux murs debout (petit appareil beige-rose, lichen orange, trous de boulin,
 * arcs de brique gris-rose sur les ouvertures, dessus ruiné et herbu), arches traversantes en bas, niches, baies traversantes à l'étage ;
 * souches des deux murs arasés. Éclairé la nuit par en dessous, comme les portes (choix de l'utilisateur).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const WALL = C("#d4bb98"), GRASS = C("#7f8748"), BRICK = C("#bfaaa6"), HOLE = C("#5e4a3b"), LICHEN = C("#d8a043"), STUB = C("#ad9677");

/** Haut du mur en d (profil linéaire). */
export function janusTop(w: JanusWall, d: number): number {
  const p = w.top;
  if (d <= p[0]![0]) return p[0]![1];
  for (let i = 0; i + 1 < p.length; i++) {
    const [d0, z0] = p[i]!, [d1, z1] = p[i + 1]!;
    if (d <= d1) return d1 - d0 < 1e-6 ? Math.max(z0, z1) : z0 + ((z1 - z0) * (d - d0)) / (d1 - d0);
  }
  return p[p.length - 1]![1];
}

/** Petit nombre pseudo-aléatoire stable dans [0, 1). */
function rnd(k: number): number {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function slab(d: GateDraw, sl: JanusSlab, s: JanusSite, terrain: HeightField, wi: number): void {
  const f = sl.f, w = sl.wall, { tA, tB, d0, d1 } = sl;
  const Z = (h: number): number => s.g + h;
  const foot = (dd: number, t: number): number => { const [x, y] = at(f, dd, t); return terrain.heightAt(x, y) - 0.4; };
  // Dessus cassé en paliers de 1,2 m (photos) : chaque palier prend le profil mesuré en son milieu, à ±40 cm près.
  const STEP = 1.2;
  const block = (dd: number): number => Math.floor(dd / STEP);
  const top = (dd: number): number => { const k = block(dd); return Z(janusTop(w, (k + 0.5) * STEP) + (rnd(wi * 100 + k) - 0.5) * 0.8); };
  const inner = shade(WALL, 0.7);
  const open: Opening[] = [
    ...w.arches.map(([c, wd, sp]) => ({ s0: c - wd / 2, s1: c + wd / 2, zb: -1, spring: sp })),
    ...w.windows.map(([c, wd, sill, sp]) => ({ s0: c - wd / 2, s1: c + wd / 2, zb: sill, spring: sp })),
  ].filter((o) => o.s0 > d0 && o.s1 < d1);
  const steps: number[] = [];
  for (let k = block(d0) + 1; k * STEP < d1; k++) steps.push(k * STEP);
  const cuts = [d0, d1, ...open.flatMap((o) => [o.s0, o.s1]), ...steps].filter((v) => v >= d0 && v <= d1);
  const faces: [number, number][] = [[tA, -1], [tB, 1]];
  for (const [a, b] of columns(cuts, open)) {
    const m = (a + b) / 2, ta = top(a + 1e-4), tb = top(b - 1e-4);
    const holes = open.filter((o) => m > o.s0 && m < o.s1).sort((p, q) => p.zb - q.zb);
    // Pièces pleines de la colonne : du pied (ou du haut d'une ouverture) au bas de l'ouverture suivante (ou au dessus du mur).
    let base: [number, number] | null = null;
    const piece = (lo: [number, number] | null, hi: [number, number]): void => {
      for (const [t, side] of faces) {
        const la = lo ? lo[0] : foot(a, t), lb = lo ? lo[1] : foot(b, t);
        const ha = Math.min(hi[0], ta), hb = Math.min(hi[1], tb);
        if (ha - la < 1e-3 && hb - lb < 1e-3) continue;
        d.quad([a, t, la], [b, t, lb], [b, t, Math.max(hb, lb)], [a, t, Math.max(ha, la)], d.N(0, side), WALL);
      }
    };
    for (const o of holes) {
      if (o.zb > -0.5) {
        piece(base, [Z(o.zb), Z(o.zb)]);
        if (Z(o.zb) < Math.min(ta, tb)) d.quad([a, tA, Z(o.zb)], [b, tA, Z(o.zb)], [b, tB, Z(o.zb)], [a, tB, Z(o.zb)], [0, 1, 0], shade(WALL, 1.05));
      }
      const za = Z(openingTop(o, a) ?? o.spring), zb = Z(openingTop(o, b) ?? o.spring);
      if (za < ta && zb < tb) d.quad([a, tA, za], [b, tA, zb], [b, tB, zb], [a, tB, za], [0, -1, 0], inner);
      base = [za, zb];
    }
    piece(base, [ta, tb]);
    if (!base || base[0] < ta || base[1] < tb) d.quad([a, tA, ta], [b, tA, tb], [b, tB, tb], [a, tB, ta], [0, 1, 0], shade(GRASS, 0.95 + 0.1 * rnd(m)));
  }
  // Contremarches entre deux paliers du dessus.
  for (const dd of steps) {
    const za = top(dd - 1e-4), zb = top(dd + 1e-4);
    if (Math.abs(za - zb) < 0.02) continue;
    d.quad([dd, tA, Math.min(za, zb)], [dd, tB, Math.min(za, zb)], [dd, tB, Math.max(za, zb)], [dd, tA, Math.max(za, zb)], d.N(za > zb ? 1 : -1, 0), shade(WALL, 0.88));
  }
  // Piédroits des ouvertures, bouts du mur.
  for (const o of open) {
    for (const [dd, dir] of [[o.s0, 1], [o.s1, -1]] as const) {
      const z1 = Math.min(Z(o.spring), top(dd));
      const za = o.zb < 0 ? foot(dd, tA) : Z(o.zb), zb = o.zb < 0 ? foot(dd, tB) : Z(o.zb);
      if (z1 > Math.min(za, zb)) d.quad([dd, tA, za], [dd, tB, zb], [dd, tB, z1], [dd, tA, z1], d.N(dir, 0), inner);
    }
  }
  for (const [dd, dir] of [[d0, -1], [d1, 1]] as const) {
    d.quad([dd, tA, foot(dd, tA)], [dd, tB, foot(dd, tB)], [dd, tB, top(dd)], [dd, tA, top(dd)], d.N(dir, 0), shade(WALL, 0.9));
  }

  // Décor peint sur les deux faces (à 1-2 cm) : arcs de brique, niches, lichen, trous de boulin.
  const solidAt = (dd: number, z: number, margin: number): boolean =>
    dd > d0 + margin && dd < d1 - margin && z < top(dd) - margin && z > Math.max(foot(dd, tA), foot(dd, tB)) + 0.4 + margin
    && !open.some((o) => dd > o.s0 - margin - 0.45 && dd < o.s1 + margin + 0.45 && z > (o.zb < 0 ? -Infinity : Z(o.zb)) - margin && z < Z(o.spring + (o.s1 - o.s0) / 2 + 0.45) + margin)
    && !w.niches.some(([c, wd, z0, z1]) => Math.abs(dd - c) < wd / 2 + margin && z > Z(z0) - margin && z < Z(z1) + margin);
  for (const [t, side] of faces) {
    const n = d.N(0, side), off = (k: number): number => t + side * k;
    for (const o of open) {
      const r0 = (o.s1 - o.s0) / 2, r1 = r0 + 0.45, c = (o.s0 + o.s1) / 2, zc = Z(o.spring);
      for (let j = 0; j < 7; j++) {
        const a0 = (Math.PI * j) / 7, a1 = (Math.PI * (j + 1)) / 7;
        if (zc + Math.sin((a0 + a1) / 2) * r1 > Math.min(top(c + Math.cos(a0) * r1), top(c + Math.cos(a1) * r1)) - 0.1) continue;
        const p = (r: number, a: number): [number, number, number] => [c + Math.cos(a) * r, off(0.015), zc + Math.sin(a) * r];
        d.quad(p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0), n, shade(BRICK, j % 2 ? 0.94 : 1));
      }
    }
    for (const [c, wd, z0, z1] of w.niches) {
      if (c - wd / 2 < d0 || c + wd / 2 > d1) continue;
      const r = wd / 2, zs = Z(z1) - r, col = shade(WALL, 0.55);
      d.quad([c - r, off(0.012), Z(z0)], [c + r, off(0.012), Z(z0)], [c + r, off(0.012), zs], [c - r, off(0.012), zs], n, col);
      for (let j = 0; j < 6; j++) {
        const a0 = (Math.PI * j) / 6, a1 = (Math.PI * (j + 1)) / 6;
        d.mb.tri(d.P(c, off(0.012), zs), d.P(c + Math.cos(a0) * r, off(0.012), zs + Math.sin(a0) * r), d.P(c + Math.cos(a1) * r, off(0.012), zs + Math.sin(a1) * r), n, col);
      }
    }
    for (let k = 0; k < 14; k++) {
      const seed = wi * 1000 + (side > 0 ? 500 : 0) + k;
      const dd = d0 + 1 + rnd(seed) * (d1 - d0 - 2), ww = 0.8 + 1.4 * rnd(seed + 0.3), hh = 0.5 + 0.9 * rnd(seed + 0.6);
      const z = Z(1 + rnd(seed + 0.9) * 17);
      if (![[dd - ww / 2, z], [dd + ww / 2, z], [dd - ww / 2, z + hh], [dd + ww / 2, z + hh]].every(([q, zz]) => solidAt(q!, zz!, 0.05))) continue;
      d.quad([dd - ww / 2, off(0.01), z], [dd + ww / 2, off(0.01), z + 0.15], [dd + ww / 2, off(0.01), z + hh], [dd - ww / 2, off(0.01), z + hh * 0.8], n, LICHEN.clone().lerp(WALL, 0.35 * rnd(seed + 1.2)));
    }
    const [pd, pz] = s.putlog;
    for (let z = Z(1.6); z < Z(22); z += pz) {
      for (let dd = d0 + pd / 2; dd < d1; dd += pd) {
        const q = dd + ((Math.round((z - s.g) / pz) % 2) * pd) / 2;
        if (!solidAt(q, z, 0.2)) continue;
        d.quad([q - 0.08, off(0.02), z - 0.08], [q + 0.08, off(0.02), z - 0.08], [q + 0.08, off(0.02), z + 0.08], [q - 0.08, off(0.02), z + 0.08], n, HOLE);
      }
    }
  }
}

/** Temple de Janus : `glow` reçoit l'éclairage de nuit (si le site l'a). Obstacles : `janusRings` (les arches restent ouvertes). */
export function buildJanus(mb: MeshBuilder, glow: MeshBuilder | null, s: JanusSite, terrain: HeightField): void {
  const top = Math.max(...s.S.top.map((p) => p[1]), ...s.W.top.map((p) => p[1]));
  janusSlabs(s).forEach((sl, i) => slab(new GateDraw(mb, s.light ? glow : null, sl.f, s.g, top * 1.1), sl, s, terrain, i));
  // Souches des murs arasés (nord et est), au ras du terre-plein.
  const d = new GateDraw(mb, s.light ? glow : null, frameOf(s.o[0], s.o[1], s.a, 1, 1), s.g, top * 1.1);
  const [Ls, Lt] = s.L, [twS, twW] = s.tw, zt = s.g + s.low + 0.12, zb = s.g - 0.8;
  d.box(twW, Ls, Lt - twS, Lt, zb, zt, STUB, shade(STUB, 1.08));
  d.box(Ls - twW, Ls, twS, Lt - twS, zb, zt, STUB, shade(STUB, 1.08));
}
