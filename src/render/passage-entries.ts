import * as THREE from "three";
import type { PassageSite } from "../data/types";
import { at, frameOf, PASSAGE_DOG, PASSAGE_SLAB } from "../core/landmarks";
import { toThree, type MeshBuilder, type UvMeshBuilder, type Vec3 } from "./geometry";
import type { SignAtlas } from "./sign-atlas";
import { slab } from "./square";
import { PASSAGE_GATE } from "../core/passage-gate";

/**
 * Passage Balthus, lot 3 (D189) : les deux entrées et la statue du chien.
 * - Chaque bout du couloir reçoit un arc segmentaire en pierre : le remplissage entre l'arc et le linteau, les piédroits, l'archivolte. Rue Demetz (photo 3) :
 *   grand arc en plein cintre surbaissé ; rue aux Cordiers (photo 1) : arc surbaissé, plaque bleue « PASSAGE BALTHUS » sur le piédroit gauche.
 * - Le chien (photos 5 et 6) : un briard assis en bronze sur un socle de pierre, plaque lue sur la photo (obstacle de 55 cm de rayon).
 * Dans le maillage plein de la tuile : aucun appel de dessin de plus.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const IRON = C("#23272b"), STONE_D = C("#d8c9a6"), STONE_C = C("#c9b997"), BAND = C("#e6dcc0"), BRONZE = C("#34423a"), BRONZE_L = C("#46564a"), PLINTH = C("#d9d3c4"), PLAQUE = C("#c8c2b2"), BLUE = C("#1f4a9a"), WHITE = C("#f4efe4");

export interface Sinks { solid: MeshBuilder; names: UvMeshBuilder; atlas: SignAtlas }

/** Arc segmentaire de la face d'une entrée : `d` plan de la façade, `out` sens vers la rue (+1 rue aux Cordiers, −1 rue Demetz), `top` sommet de l'arc (dessous du linteau), `rise` flèche. */
function arch(sinks: Sinks, s: PassageSite, d: number, out: 1 | -1, top: number, rise: number, floor: number, stone: THREE.Color): void {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const P = (t: number, z: number): Vec3 => toThree(...at(f, d, t), z);
  const nrm: Vec3 = toThree(f.ux * out, f.uy * out, 0);
  const hw = s.hw, R = (hw * hw + rise * rise) / (2 * rise), zc = top - R;
  const za = (t: number): number => zc + Math.sqrt(Math.max(0, R * R - t * t));
  const N = 12, pier = 0.45;
  for (let i = 0; i < N; i++) {
    const t0 = -hw + (2 * hw * i) / N, t1 = -hw + (2 * hw * (i + 1)) / N;
    // Remplissage au-dessus de l'arc, jusqu'au linteau.
    sinks.solid.quad(P(t0, za(t0)), P(t1, za(t1)), P(t1, top), P(t0, top), nrm, stone);
    // Archivolte : bande plus claire qui suit la courbe, juste sous le remplissage.
    sinks.solid.quad(P(t0, za(t0) - 0.28), P(t1, za(t1) - 0.28), P(t1, za(t1)), P(t0, za(t0)), nrm, BAND);
  }
  // Piédroits : deux bandes de pierre sur les bords de l'ouverture, du sol à la naissance de l'arc.
  const spring = za(hw) - 0.28;
  for (const sg of [-1, 1]) sinks.solid.quad(P(sg * hw, floor), P(sg * (hw - pier), floor), P(sg * (hw - pier), spring), P(sg * hw, spring), nrm, stone);
}

/** Plaque bleue à lettres blanches sur la façade (deux lignes de l'atlas). */
function plaque(sinks: Sinks, s: PassageSite, d: number, out: 1 | -1, t: number, z: number): void {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const P = (tt: number, zz: number): Vec3 => toThree(...at(f, d + out * 0.03, tt), zz);
  const nrm: Vec3 = toThree(f.ux * out, f.uy * out, 0);
  const w = 0.42, h = 0.26;
  sinks.solid.quad(P(t - w / 2, z), P(t + w / 2, z), P(t + w / 2, z + h), P(t - w / 2, z + h), nrm, BLUE);
  // Sur la façade vue de la rue aux Cordiers, la gauche est le côté t négatif ; les abscisses de l'atlas croissent à droite de la caméra.
  const lh = 0.075;
  [["PASSAGE", 0.13], ["BALTHUS", 0.03]].forEach(([text, dz]) => {
    const r = sinks.atlas.get(text as string, "#ffffff", false), lw = lh * 6.4;
    const a = P(t + (out === 1 ? lw / 2 : -lw / 2), z + (dz as number) + 0.0), b = P(t - (out === 1 ? lw / 2 : -lw / 2), z + (dz as number));
    const a2 = P(t + (out === 1 ? lw / 2 : -lw / 2), z + (dz as number) + lh), b2 = P(t - (out === 1 ? lw / 2 : -lw / 2), z + (dz as number) + lh);
    const o = new THREE.Vector3(...nrm).multiplyScalar(0.004).toArray() as Vec3;
    const sh = (p: Vec3): Vec3 => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    sinks.names.quad(sh(a), sh(b), sh(b2), sh(a2), nrm, [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], WHITE);
  });
}

/** Le chien en bronze sur son socle, tourné vers la rue Demetz (on le voit de face en venant de la rue aux Cordiers, comme sur les photos). */
function dog(sinks: Sinks, s: PassageSite, zg: number): void {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const [cx, cy] = at(f, PASSAGE_DOG.s, PASSAGE_DOG.t);
  const g = frameOf(cx, cy, s.a + Math.PI, 1, 1); // repère du chien : s vers l'avant (rue Demetz)
  const box = (d0: number, d1: number, t0: number, t1: number, z0: number, z1: number, col: THREE.Color): void => slab(sinks.solid, g, d0, d1, t0, t1, z0, z1, col, col);
  // Socle : base, fût, corniche.
  box(-0.5, 0.5, -0.5, 0.5, zg, zg + 0.18, PLINTH);
  box(-0.38, 0.38, -0.38, 0.38, zg + 0.18, zg + 1.0, PLINTH);
  box(-0.46, 0.46, -0.46, 0.46, zg + 1.0, zg + 1.12, PLINTH);
  // Plaque sur la face avant (vers la rue Demetz) : fond clair et trois lignes.
  const P = (ss: number, tt: number, zz: number): Vec3 => toThree(...at(g, ss, tt), zz);
  const nrm: Vec3 = toThree(g.ux, g.uy, 0);
  sinks.solid.quad(P(0.39, 0.27, zg + 0.45), P(0.39, -0.27, zg + 0.45), P(0.39, -0.27, zg + 0.82), P(0.39, 0.27, zg + 0.82), nrm, PLAQUE);
  ["OEUVRE DE P. LATOUCHE", "1922 PARIS 1956", "BRIARD"].forEach((text, i) => {
    const r = sinks.atlas.get(text, "#2b2b2b", false), lh = 0.07, lw = lh * 6.4, z = zg + 0.72 - i * 0.1;
    sinks.names.quad(P(0.395, lw / 2, z), P(0.395, -lw / 2, z), P(0.395, -lw / 2, z + lh), P(0.395, lw / 2, z + lh), nrm, [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], WHITE);
  });
  // Chien assis : base, arrière-train, poitrail, tête, oreilles, museau, pattes avant, queue.
  const z0 = zg + 1.12;
  box(-0.36, 0.3, -0.3, 0.3, z0, z0 + 0.1, BRONZE_L);
  box(-0.3, 0.14, -0.28, 0.28, z0 + 0.1, z0 + 0.55, BRONZE);
  box(-0.12, 0.2, -0.22, 0.22, z0 + 0.3, z0 + 0.95, BRONZE);
  box(0.0, 0.3, -0.17, 0.17, z0 + 0.62, z0 + 0.95, BRONZE_L);
  box(0.12, 0.34, -0.2, 0.2, z0 + 0.88, z0 + 1.1, BRONZE);
  box(0.28, 0.4, -0.08, 0.08, z0 + 0.9, z0 + 0.98, BRONZE_L);
  box(0.04, 0.2, -0.26, -0.18, z0 + 0.72, z0 + 1.0, BRONZE);
  box(0.04, 0.2, 0.18, 0.26, z0 + 0.72, z0 + 1.0, BRONZE);
  box(0.18, 0.3, -0.16, -0.04, z0 + 0.1, z0 + 0.6, BRONZE_L);
  box(0.18, 0.3, 0.04, 0.16, z0 + 0.1, z0 + 0.6, BRONZE_L);
}

/** Imposte en éventail au-dessus d'une grille (photo 4) : des rayons de fer du haut de la grille à l'archivolte, et une bande qui suit l'arc. Fixe : elle se voit grille ouverte. */
function fan(sinks: Sinks, s: PassageSite, plane: number, out: 1 | -1, top: number, rise: number, zbar: number): void {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const P = (t: number, z: number, o = 0): Vec3 => toThree(...at(f, plane + o, t), z);
  const hw = s.hw, R = (hw * hw + rise * rise) / (2 * rise), zc = top - R;
  const za = (t: number): number => zc + Math.sqrt(Math.max(0, R * R - t * t)) - 0.3;
  const bar = (t0: number, z0: number, t1: number, z1: number, w: number): void => {
    const L = Math.hypot(t1 - t0, z1 - z0), nt = -(z1 - z0) / L * w / 2, nz = (t1 - t0) / L * w / 2;
    for (const sgn of [1, -1]) {
      const n: Vec3 = toThree(f.ux * out * sgn, f.uy * out * sgn, 0);
      sinks.solid.quad(P(t0 - nt, z0 - nz), P(t1 - nt, z1 - nz), P(t1 + nt, z1 + nz), P(t0 + nt, z0 + nz), n, IRON);
    }
  };
  const N = 12;
  for (let k = 0; k <= N; k++) {
    const t = -hw + (2 * hw * k) / N;
    if (za(t) > zbar + 0.08) bar(0, zbar, t * 0.98, za(t * 0.98), 0.03);
  }
  for (let k = 0; k < N; k++) {
    const t0 = -hw + (2 * hw * k) / N, t1 = -hw + (2 * hw * (k + 1)) / N;
    if (za(t0) > zbar + 0.08 && za(t1) > zbar + 0.08) bar(t0, za(t0), t1, za(t1), 0.05);
  }
}

/** Fronton de la façade de la rue Demetz (photo 3) : corniche, triangle de pierre à cadre mouluré, tympan plus sombre, œil-de-bœuf. */
function pediment(sinks: Sinks, s: PassageSite, base: number): void {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const hw = s.hw + 0.4, depth = 0.14;
  const P = (t: number, z: number, o = 0): Vec3 => toThree(...at(f, -(depth + o), t), z);
  const n: Vec3 = toThree(-f.ux, -f.uy, 0);
  // Corniche : bloc qui déborde de la façade.
  slab(sinks.solid, f, -depth, 0, -hw, hw, base, base + 0.3, BAND, BAND);
  const zb = base + 0.3, apex = zb + 1.35, w = hw - 0.2;
  sinks.solid.tri(P(-w, zb), P(w, zb), P(0, apex), n, STONE_D);
  // Tympan (en retrait), cadre mouluré le long des deux rampants.
  sinks.solid.tri(P(-w + 0.4, zb + 0.08, 0.02), P(w - 0.4, zb + 0.08, 0.02), P(0, apex - 0.5, 0.02), n, STONE_C);
  for (const sg of [-1, 1]) sinks.solid.quad(P(sg * w, zb, 0.03), P(sg * 0.0, apex, 0.03), P(sg * 0.0, apex - 0.24, 0.03), P(sg * (w - 0.45), zb, 0.03), n, BAND);
  // Œil-de-bœuf : octogone sombre dans un cadre clair.
  const cz = zb + 0.52;
  for (const [r, col, o] of [[0.3, BAND, 0.04], [0.22, C("#2e3d44"), 0.05]] as const) {
    for (let i = 0; i < 8; i++) {
      const a0 = (i * Math.PI) / 4, a1 = a0 + Math.PI / 4;
      sinks.solid.tri(P(0, cz, o), P(Math.cos(a0) * r, cz + Math.sin(a0) * r, o), P(Math.cos(a1) * r, cz + Math.sin(a1) * r, o), n, col);
    }
  }
}

export function buildEntries(sinks: Sinks, s: PassageSite): void {
  const zg = s.zf + PASSAGE_SLAB;
  // Rue Demetz : le linteau le plus bas côté rue ; arc à plein cintre surbaissé de 1,4 m.
  const lo = s.lin.filter((l) => l[0] < 1)[0]!, hi = s.lin.reduce((a, l) => (l[1] > a[1] ? l : a), s.lin[0]!);
  arch(sinks, s, 0, -1, lo[2], 1.4, zg, STONE_D);
  arch(sinks, s, hi[1], 1, hi[2], 0.9, s.zc, STONE_C);
  plaque(sinks, s, hi[1], 1, -(s.hw - 0.22), s.zc + 1.9);
  // Impostes en éventail au-dessus des grilles (D192), fronton de la rue Demetz.
  const G = PASSAGE_GATE;
  fan(sinks, s, G.planes[0], -1, lo[2], 1.4, G.floors[0] + 0.05 + G.height);
  fan(sinks, s, G.planes[1], 1, hi[2], 0.9, G.floors[1] + 0.05 + G.height);
  pediment(sinks, s, lo[3]);
  dog(sinks, s, zg);
}
