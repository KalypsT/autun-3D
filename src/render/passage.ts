import * as THREE from "three";
import type { HeightField, PassageSite } from "../data/types";
import { at, frameOf, passageFloor } from "../core/landmarks";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";
import { slab } from "./square";
import { buildGallery } from "./passage-gallery";
import { buildEntries, type Sinks } from "./passage-entries";

/**
 * Passage Balthus (D187, lot 1) : le sol de la galerie, la volée de la rue aux Cordiers (marches et contremarches) et les linteaux, ces tronçons où
 * le bâtiment passe au-dessus du couloir (le pavillon de la rue Demetz et le porche de la rue aux Cordiers). Les murs du couloir sont ceux des
 * bâtiments voisins, découpés dans les tuiles (tools/data/build_passage.py) ; le décor de la galerie est dans `passage-gallery.ts` (D188), les entrées viennent au lot 3.
 * Dans le maillage plein de la tuile : aucun appel de dessin de plus.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const DORMER_GLASS = C("#35505c"), FLOOR = C("#dcbfa0"), FLOOR_B = C("#cfae8c"), PAVING = C("#a39b8e"), TREAD = C("#cfc7b8"), WALL = C("#d9c9a8"), ROOF = C("#707d88"), CEILING = C("#8a7a66");
/** Sol posé juste au-dessus du tablier du passage (m). */
const LIFT = 0.02;
/** Maille du sol de la galerie (m). */
const CELL = 1;

export function buildPassage(sinks: Sinks & { glow: MeshBuilder; glass?: MeshBuilder }, s: PassageSite, terrain: HeightField): void {
  const mb = sinks.solid;
  buildGallery(mb, sinks.glow, s, sinks.glass);
  buildEntries(sinks, s);
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const P = (d: number, t: number, z: number): Vec3 => toThree(...at(f, d, t), z);
  const UP: Vec3 = [0, 1, 0];
  const N = (us: number): Vec3 => toThree(f.ux * us, f.uy * us, 0);
  const hw = s.hw;
  const [s0, s1, n] = s.st;

  const top = (d0: number, d1: number, z0: number, z1: number, col: THREE.Color): void =>
    mb.quad(P(d0, -hw, z0), P(d1, -hw, z1), P(d1, hw, z1), P(d0, hw, z0), UP, col);

  // Galerie : sol de la façade de la rue Demetz au pied de la volée, par mailles de 1 m qui suivent le relief du jeu (c'est lui qu'on foule).
  const ground = (d: number, t: number): number => terrain.heightAt(...at(f, d, t)) + LIFT;
  const nt = Math.round((2 * hw) / CELL), ns = Math.ceil(s0 / CELL);
  for (let i = 0; i < ns; i++) {
    const d0 = (i * s0) / ns, d1 = ((i + 1) * s0) / ns;
    for (let j = 0; j < nt; j++) {
      const t0 = -hw + (j * 2 * hw) / nt, t1 = -hw + ((j + 1) * 2 * hw) / nt;
      mb.quad(P(d0, t0, ground(d0, t0)), P(d1, t0, ground(d1, t0)), P(d1, t1, ground(d1, t1)), P(d0, t1, ground(d0, t1)), UP, (i + j) % 2 ? FLOOR_B : FLOOR);
    }
  }
  // Volée : n marches, chacune monte de sa contremarche à sa dalle.
  const zg = passageFloor(s, s0);
  const run = (s1 - s0) / n, rise = (s.zc - zg) / n;
  for (let k = 0; k < n; k++) {
    const d0 = s0 + k * run, d1 = d0 + run, z0 = zg + k * rise, z1 = z0 + rise;
    mb.quad(P(d0, -hw, z0), P(d0, hw, z0), P(d0, hw, z1), P(d0, -hw, z1), N(-1), shade(TREAD, 0.82));
    top(d0, d1, z1, z1, TREAD);
  }
  // Porte cochère : palier de la rue aux Cordiers, en pavés.
  top(s1, s.L, s.zc + LIFT, s.zc + LIFT, PAVING);

  // Linteaux : dessus et façade du bâtiment, dessous en plafond. Côté rue Demetz, le pavillon a un toit en pente : une rampe qui suit les hauteurs mesurées (D193).
  const front = s.lin.filter((l) => l[1] < s.L / 2).sort((a, b) => a[0] - b[0]);
  for (const [d0, d1, z0, z1] of s.lin) {
    if (front.some((l) => l[0] === d0 && l[1] === d1)) continue;
    slab(mb, f, d0, d1, -hw, hw, z0, z1, WALL, ROOF);
    mb.quad(P(d0, -hw, z0), P(d0, hw, z0), P(d1, hw, z0), P(d1, -hw, z0), [0, -1, 0], CEILING);
  }
  if (front.length) {
    const z0 = front[0]![2], dEnd = front[front.length - 1]![1];
    const knots: [number, number][] = [[0, front[0]![3]], ...front.slice(1).map((l, i) => [(front[i]![1] + l[1]) / 2, l[3]] as [number, number]), [dEnd, front[front.length - 1]![3]]];
    mb.quad(P(0, -hw, z0), P(0, hw, z0), P(0, hw, knots[0]![1]), P(0, -hw, knots[0]![1]), N(-1), WALL);
    mb.quad(P(dEnd, -hw, z0), P(dEnd, hw, z0), P(dEnd, hw, knots[knots.length - 1]![1]), P(dEnd, -hw, knots[knots.length - 1]![1]), N(1), WALL);
    mb.quad(P(0, -hw, z0), P(0, hw, z0), P(dEnd, hw, z0), P(dEnd, -hw, z0), [0, -1, 0], CEILING);
    for (let i = 0; i + 1 < knots.length; i++) {
      const [sa, za] = knots[i]!, [sb, zb] = knots[i + 1]!;
      mb.quad(P(sa, -hw, za), P(sb, -hw, zb), P(sb, hw, zb), P(sa, hw, za), UP, ROOF);
      for (const sg of [-1, 1]) mb.quad(P(sa, sg * hw, z0), P(sb, sg * hw, z0), P(sb, sg * hw, zb), P(sa, sg * hw, za), toThree(f.vx * -sg, f.vy * -sg, 0), WALL);
    }
  }
  // Lucarnes de la façade de la rue Demetz (D193) : un volume à fenêtre sombre et toit à deux pans d'ardoise, posé sur le toit en pente.
  for (const [t, d, zr] of s.dorm ?? []) {
    const w = 0.55, dd = 1.05, zb = zr - 0.6, zt = zr + 1.15, zr2 = zt + 0.55;
    slab(mb, f, d, d + dd, t - w, t + w, zb, zt, WALL, WALL);
    mb.quad(P(d - 0.01, t - 0.3, zr + 0.1), P(d - 0.01, t + 0.3, zr + 0.1), P(d - 0.01, t + 0.3, zr + 0.95), P(d - 0.01, t - 0.3, zr + 0.95), N(-1), DORMER_GLASS);
    for (const sg of [-1, 1]) {
      mb.quad(P(d - 0.06, t + sg * (w + 0.06), zt), P(d + dd + 0.06, t + sg * (w + 0.06), zt), P(d + dd + 0.06, t, zr2), P(d - 0.06, t, zr2), toThree(f.vx * sg, f.vy * sg, 1), ROOF);
    }
    mb.tri(P(d - 0.01, t - w, zt), P(d - 0.01, t + w, zt), P(d - 0.01, t, zr2), N(-1), WALL);
  }
}
