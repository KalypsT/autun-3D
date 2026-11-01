import * as THREE from "three";
import type { HeightField } from "../data/types";
import { GATE_LAMPS, GATE_LAYOUT, gateFrame, type SchoolGateSpec } from "../core/school-gate";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";
import { Draw } from "./hexagone-facade";
import type { LandmarkSinks } from "./landmarks";

/**
 * Entrée du collège du Vallon (D174, lot 3), d'après les photos 1 et 2 : poteaux noirs, pilier de béton à interphone et boîte aux lettres, panneau
 * « Collège le Vallon », lampadaires à tête en disque (partie fixe, cuite dans la tuile) ; vantaux du portail et du portillon (partie qui apparaît
 * quand la grille est fermée, un maillage à part que le jeu montre ou cache : `buildGateLeaves`).
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const COL = { steel: C("#24282b"), concrete: C("#cfc9b9"), board: C("#f1efe8"), grey: C("#7d8a8c"), pole: C("#4b5258"), lamp: C("#d9d6c8"), dark: C("#1e2224") };

type XY = [number, number];

function drawOf(g: SchoolGateSpec, mb: MeshBuilder, sinks: LandmarkSinks | null, terrain: HeightField): Draw {
  const f = gateFrame(g);
  const frame = { n: g.n, u: f.u, o: g.o, pt: f.pt, st: (p: XY): XY => [(p[0] - g.o[0]) * f.u[0] + (p[1] - g.o[1]) * f.u[1], (p[0] - g.o[0]) * g.n[0] + (p[1] - g.o[1]) * g.n[1]] };
  const fake = sinks ?? { solid: mb, glow: new MeshBuilder(), names: null as never, atlas: null as never };
  return new Draw(frame, fake as LandmarkSinks, terrain);
}

/** Partie fixe : poteaux, pilier, panneaux, lampadaires. */
export function buildGatePosts(sinks: LandmarkSinks, g: SchoolGateSpec, terrain: HeightField): void {
  const d = drawOf(g, sinks.solid, sinks, terrain), L = GATE_LAYOUT;
  const [e0, e1] = L.endPost, [m0, m1] = L.midPost, [p0, p1] = L.pillar;
  const gz = (s0: number, s1: number): number => Math.max(d.ground(s0, 0), d.ground(s1, 0));
  d.box(e0, e1, -0.12, 0.12, null, gz(e0, e1) + L.postHeight, COL.steel);
  d.box(m0, m1, -0.12, 0.12, null, gz(m0, m1) + L.postHeight, COL.steel);
  // Pilier de béton : interphone (face vers le pont), boîte aux lettres, chapeau.
  const zp = gz(p0, p1) + L.pillarHeight;
  d.box(p0, p1, -0.25, 0.25, null, zp, COL.concrete);
  d.box(p0 - 0.04, p1 + 0.04, -0.3, 0.3, zp, zp + 0.08, shade(COL.concrete, 1.08));
  const sm = (p0 + p1) / 2, z0 = d.ground(sm, 0.25);
  d.plate(sm - 0.1, sm + 0.1, z0 + 1.15, z0 + 1.6, 0.27, COL.dark);
  d.plate(sm - 0.05, sm + 0.05, z0 + 1.45, z0 + 1.5, 0.28, C("#a9d1e8"));
  d.box(sm - 0.14, sm + 0.14, 0.25, 0.4, z0 + 0.85, z0 + 1.05, COL.steel);
  // Panneau « Collège le Vallon » sur deux poteaux, dans le prolongement du mur à droite du pilier.
  const bs = p1 + 1.4, zb = d.ground(bs, 0) + 2.1;
  d.box(bs - 1.05, bs - 0.97, -0.05, 0.03, null, zb + 0.55, COL.steel);
  d.box(bs + 0.97, bs + 1.05, -0.05, 0.03, null, zb + 0.55, COL.steel);
  d.plate(bs - 1.05, bs + 1.05, zb, zb + 0.6, 0.06, COL.board);
  d.label(bs, zb + 0.08, 0.3, 0.07, "Collège le Vallon", "#2c3a5a");
  // Lampadaires : mât de 5,5 m et tête en disque plat (coupelle de 0,9 m).
  for (const [s, t] of GATE_LAMPS) {
    const [x, y] = gateFrame(g).pt(s, t), zg = terrain.heightAt(x, y);
    const mb = sinks.solid;
    for (let i = 0; i < 4; i++) {
      const a0 = (i * Math.PI) / 2 + Math.PI / 4, a1 = a0 + Math.PI / 2, r = 0.05;
      const P = (a: number, z: number): Vec3 => toThree(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
      mb.quad(P(a0, zg), P(a1, zg), P(a1, zg + 5.4), P(a0, zg + 5.4), toThree(Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0), COL.pole);
    }
    const n = 8, zt = zg + 5.5;
    for (let i = 0; i < n; i++) {
      const a0 = (i * 2 * Math.PI) / n, a1 = ((i + 1) * 2 * Math.PI) / n;
      mb.tri(toThree(x, y, zt + 0.12), toThree(x + Math.cos(a0) * 0.45, y + Math.sin(a0) * 0.45, zt), toThree(x + Math.cos(a1) * 0.45, y + Math.sin(a1) * 0.45, zt), toThree(0, 0, 1), shade(COL.lamp, 1.05));
      mb.tri(toThree(x, y, zt), toThree(x + Math.cos(a1) * 0.45, y + Math.sin(a1) * 0.45, zt), toThree(x + Math.cos(a0) * 0.45, y + Math.sin(a0) * 0.45, zt), toThree(0, 0, -1), shade(COL.lamp, 0.8));
    }
    sinks.glow.quad(toThree(x - 0.2, y - 0.2, zt - 0.02), toThree(x + 0.2, y - 0.2, zt - 0.02), toThree(x + 0.2, y + 0.2, zt - 0.02), toThree(x - 0.2, y + 0.2, zt - 0.02), toThree(0, 0, -1), C("#fff0c0"));
  }
}

/** Vantaux fermés : portail coulissant (barreaux noirs, deux rails) et portillon avec son panneau d'affichage gris, de chaque côté de la grille. */
export function buildGateLeaves(g: SchoolGateSpec, terrain: HeightField): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const d = drawOf(g, mb, null, terrain), L = GATE_LAYOUT;
  const leaf = (s0: number, s1: number, h: number): void => {
    const z0 = Math.min(d.ground(s0, 0), d.ground(s1, 0)) + 0.1;
    for (const t of [-0.03, 0.03]) {
      for (let s = s0 + 0.08; s < s1 - 0.04; s += 0.14) d.plate(s, s + 0.04, z0, z0 + h, t, COL.steel);
      for (const z of [0.12, h * 0.5, h - 0.12]) d.plate(s0, s1, z0 + z - 0.05, z0 + z + 0.05, t, shade(COL.steel, 1.15));
    }
  };
  leaf(L.leaf[0], L.leaf[1], L.leafHeight);
  leaf(L.wicket[0], L.wicket[1], L.leafHeight);
  // Panneau d'affichage gris sur le portillon.
  const z0 = d.ground((L.wicket[0] + L.wicket[1]) / 2, 0) + 0.1;
  d.plate(L.wicket[0] + 0.05, L.wicket[1] - 0.05, z0 + 0.8, z0 + 1.8, 0.05, COL.grey);
  d.plate(L.wicket[0] + 0.05, L.wicket[1] - 0.05, z0 + 0.8, z0 + 1.8, -0.05, COL.grey);
  // Barre d'arrêt : bras blanc et rouge derrière le portail, au milieu.
  const sb = (L.leaf[0] + L.leaf[1]) / 2;
  for (let i = 0; i < 6; i++) d.plate(sb - 1.2 + i * 0.4, sb - 1.2 + (i + 1) * 0.4, z0 + 0.95, z0 + 1.05, -0.15, i % 2 ? C("#d3313a") : C("#f2efe6"));
  return mb.build();
}
