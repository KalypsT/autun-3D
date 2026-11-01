import * as THREE from "three";
import type { HeightField, VallonModel, VallonProp } from "../data/types";
import { hash01, toThree, type Vec3 } from "./geometry";
import type { LandmarkSinks } from "./landmarks";
import { HEDGE, STEP } from "../core/vallon-props";
import { vallonFrame, type VallonFrame } from "./vallon";

/**
 * Abords de l'entrée ouest du collège du Vallon (D175, lot 4), d'après la photo 3 : volée de marches de gravier et palier devant la porte, bacs roses et rochers
 * à droite (au sud), haie taillée et bouleau pleureur à gauche (au nord). Placés en (u, v) dans le repère du bâtiment.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const COL = {
  tread: C("#bdb199"), riser: C("#a79c85"), rock: C("#8f8a7c"), pot: C("#c9487a"), soil: C("#5b4a3a"), bush: C("#4f7a43"), hedge: C("#3f6b3b"),
  bark: C("#dcd8cc"), crown: C("#9db96e"),
};

export function buildVallonProps(sinks: LandmarkSinks, m: VallonModel, terrain: HeightField): void {
  const f = vallonFrame(m), mb = sinks.solid;
  const ground = (x: number, y: number): number => terrain.heightAt(x, y);
  const up = toThree(0, 0, 1);
  const at = (u: number, v: number, z: number): Vec3 => toThree(...f.pt(u, v), z);
  /** Pavé aligné sur le repère : [u0, u1] × [v0, v1], du bas z0 au haut z1 ; la face −u (vers le dehors) reçoit `front`. */
  const slab = (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, top: THREE.Color, side: THREE.Color): void => {
    const du = f.pt(1, 0), org = f.pt(0, 0), dv = f.pt(0, 1);
    const ux = du[0] - org[0], uy = du[1] - org[1], vx = dv[0] - org[0], vy = dv[1] - org[1];
    mb.quad(at(u0, v0, z1), at(u1, v0, z1), at(u1, v1, z1), at(u0, v1, z1), up, top);
    mb.quad(at(u0, v0, z0), at(u0, v1, z0), at(u0, v1, z1), at(u0, v0, z1), toThree(-ux, -uy, 0), side);
    mb.quad(at(u1, v1, z0), at(u1, v0, z0), at(u1, v0, z1), at(u1, v1, z1), toThree(ux, uy, 0), shade(side, 0.9));
    mb.quad(at(u0, v0, z0), at(u1, v0, z0), at(u1, v0, z1), at(u0, v0, z1), toThree(-vx, -vy, 0), shade(side, 0.95));
    mb.quad(at(u1, v1, z0), at(u0, v1, z0), at(u0, v1, z1), at(u1, v1, z1), toThree(vx, vy, 0), shade(side, 0.95));
  };
  /** Cône tronqué à `n` côtés autour de (x, y) : rayon r0 en z0, r1 en z1. */
  const cone = (x: number, y: number, r0: number, r1: number, z0: number, z1: number, n: number, col: THREE.Color, cap = true): void => {
    for (let i = 0; i < n; i++) {
      const a0 = (i * 2 * Math.PI) / n, a1 = ((i + 1) * 2 * Math.PI) / n, am = (a0 + a1) / 2;
      const P = (a: number, r: number, z: number): Vec3 => toThree(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
      const k = Math.hypot(1, (r0 - r1) / Math.max(1e-6, z1 - z0));
      mb.quad(P(a0, r0, z0), P(a1, r0, z0), P(a1, r1, z1), P(a0, r1, z1), toThree(Math.cos(am) / k, Math.sin(am) / k, (r0 - r1) / Math.max(1e-6, z1 - z0) / k), shade(col, 0.92 + 0.16 * Math.abs(Math.sin(am))));
      if (cap && r1 > 0.01) mb.tri(P(a0, r1, z1), P(a1, r1, z1), toThree(x, y, z1), up, shade(col, 1.08));
    }
  };

  for (const p of m.props ?? []) {
    const [x, y] = f.pt(p.u, p.v), zg = ground(x, y);
    if (p.k === "steps") steps(p, f, zg);
    else if (p.k === "rock") rock(p, x, y, zg);
    else if (p.k === "pot") {
      cone(x, y, 0.3, 0.38, zg, zg + 0.62, 8, COL.pot);
      cone(x, y, 0.33, 0.33, zg + 0.62, zg + 0.66, 8, COL.soil);
      cone(x, y, 0.3, 0.12, zg + 0.62, zg + 1.0, 7, COL.bush);
    } else if (p.k === "hedge") {
      const w = p.w ?? 4, h = HEDGE.height, z0 = zg - 0.1;
      slab(p.u - HEDGE.width / 2, p.u + HEDGE.width / 2, p.v, p.v + w, z0, z0 + h, shade(COL.hedge, 1.15), COL.hedge);
    } else if (p.k === "birch") birch(p, x, y, zg);
  }

  function steps(p: VallonProp, fr: VallonFrame, zg: number): void {
    void fr;
    const w = p.w ?? 5, v0 = p.v - w / 2, v1 = p.v + w / 2, { rise, tread, count, landing } = STEP;
    // Le palier touche le mur ; les marches descendent vers −u. Le bas de chaque bloc est le sol, le haut son niveau.
    slab(p.u - landing, p.u, v0, v1, zg - 0.1, zg + rise * count, COL.tread, COL.riser);
    for (let i = 1; i <= count; i++) {
      const u1 = p.u - landing - (i - 1) * tread, u0 = u1 - tread;
      slab(u0, u1, v0, v1, zg - 0.1, zg + rise * (count - i), COL.tread, COL.riser);
    }
  }

  /** Rocher : icosaèdre aplati dont les sommets sont décalés au hasard (graine : position). */
  function rock(p: VallonProp, x: number, y: number, zg: number): void {
    const r = p.r ?? 0.6, t = (1 + Math.sqrt(5)) / 2;
    const base: Vec3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const V = base.map((q, i): Vec3 => {
      const l = Math.hypot(...q), j = 0.78 + 0.4 * hash01(`${x.toFixed(1)},${y.toFixed(1)},${i}`);
      return [x + (q[0] / l) * r * j, y + (q[1] / l) * r * j * 0.9, zg + 0.25 * r + (q[2] / l) * r * 0.62 * j];
    });
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (const [a, b, c] of F) {
      const A = V[a!]!, B = V[b!]!, Cc = V[c!]!;
      const cx = (A[0] + B[0] + Cc[0]) / 3 - x, cy = (A[1] + B[1] + Cc[1]) / 3 - y, cz = (A[2] + B[2] + Cc[2]) / 3 - (zg + 0.25 * r);
      const l = Math.hypot(cx, cy, cz) || 1;
      mb.tri(toThree(...[A[0], A[1], A[2]] as [number, number, number]), toThree(B[0], B[1], B[2]), toThree(Cc[0], Cc[1], Cc[2]), toThree(cx / l, cy / l, cz / l), shade(COL.rock, 0.86 + 0.28 * hash01(`${x.toFixed(1)}${a}${b}${c}`)));
    }
  }

  function birch(p: VallonProp, x: number, y: number, zg: number): void {
    const h = p.h ?? 7, z0 = zg - 0.1;
    cone(x, y, 0.13, 0.07, z0, z0 + h * 0.62, 6, COL.bark);
    // Couronne pleureuse : trois jupes en cloche de plus en plus étroites, lames pendantes aux bords.
    cone(x, y, 1.9, 1.15, z0 + h * 0.5, z0 + h * 0.82, 10, COL.crown);
    cone(x, y, 1.35, 0.7, z0 + h * 0.72, z0 + h * 0.95, 10, shade(COL.crown, 1.06));
    cone(x, y, 0.7, 0.0, z0 + h * 0.9, z0 + h, 8, shade(COL.crown, 1.12), false);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI, r = 1.95, ta = a + 0.12;
      mb.tri(toThree(x + Math.cos(a) * r, y + Math.sin(a) * r, z0 + h * 0.5), toThree(x + Math.cos(ta) * r, y + Math.sin(ta) * r, z0 + h * 0.5),
        toThree(x + Math.cos(a + 0.06) * (r + 0.1), y + Math.sin(a + 0.06) * (r + 0.1), z0 + h * 0.5 - 1.7), toThree(Math.cos(a), Math.sin(a), 0.1), shade(COL.crown, 0.95 + 0.1 * (i % 2)));
    }
  }
}
