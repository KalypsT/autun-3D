import * as THREE from "three";
import { HOOP, hoopDir, hoopPole } from "../core/hoops";
import type { HeightField } from "../data/types";
import { toThree, type MeshBuilder, type Vec3 } from "./geometry";

/** Paniers de basket (D176) : poteau d'acier, potence, panneau blanc à cadre sombre, anneau orange et filet. */
const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);
const COL = { pole: C("#3e4448"), board: C("#ecebe6"), frame: C("#2c3033"), ring: C("#e0662b"), net: C("#f2efe6") };

export function buildHoops(mb: MeshBuilder, hoops: readonly [number, number, number][], terrain: HeightField): void {
  for (const h of hoops) {
    const [dx, dy] = hoopDir(h[2]), [px, py] = hoopPole(h);
    const zg = terrain.heightAt(px, py), zb = terrain.heightAt(h[0], h[1]);
    // Largeur du panneau le long de la perpendiculaire (−dy, dx).
    const wx = -dy, wy = dx;
    const P = (x: number, y: number, z: number): Vec3 => toThree(x, y, z);
    // Poteau carré de 0,12 m jusqu'à la potence.
    const r = 0.06, top = zb + HOOP.boardBottom + 0.5;
    const corners: [number, number][] = [[-r, -r], [r, -r], [r, r], [-r, r]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!, b = corners[(i + 1) % 4]!;
      const n = toThree((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
      mb.quad(P(px + a[0], py + a[1], zg - 0.1), P(px + b[0], py + b[1], zg - 0.1), P(px + b[0], py + b[1], top), P(px + a[0], py + a[1], top), n, shade(COL.pole, 0.9 + 0.1 * (i % 2)));
    }
    mb.quad(P(px - r, py - r, top), P(px + r, py - r, top), P(px + r, py + r, top), P(px - r, py + r, top), toThree(0, 0, 1), shade(COL.pole, 1.1));
    // Potence : barre horizontale du poteau au panneau, à la hauteur du bas du panneau.
    const za = zb + HOOP.boardBottom + 0.3;
    for (const k of [-0.05, 0.05]) {
      mb.quad(P(px + wx * k, py + wy * k, za - 0.05), P(h[0] + wx * k, h[1] + wy * k, za - 0.05), P(h[0] + wx * k, h[1] + wy * k, za + 0.05), P(px + wx * k, py + wy * k, za + 0.05), toThree(wx, wy, 0), COL.pole);
    }
    // Panneau : plaque blanche cerclée de sombre, vue des deux côtés (face avant vers le terrain).
    const hw = HOOP.boardWidth / 2, z0 = zb + HOOP.boardBottom, z1 = zb + HOOP.boardTop;
    mb.quad(P(h[0] - wx * hw, h[1] - wy * hw, z0), P(h[0] + wx * hw, h[1] + wy * hw, z0), P(h[0] + wx * hw, h[1] + wy * hw, z1), P(h[0] - wx * hw, h[1] - wy * hw, z1), toThree(dx, dy, 0), COL.board);
    mb.quad(P(h[0] + wx * hw, h[1] + wy * hw, z0), P(h[0] - wx * hw, h[1] - wy * hw, z0), P(h[0] - wx * hw, h[1] - wy * hw, z1), P(h[0] + wx * hw, h[1] + wy * hw, z1), toThree(-dx, -dy, 0), shade(COL.frame, 1.2));
    // Cadre sombre en haut et en bas.
    for (const [za2, zb2] of [[z0, z0 + 0.05], [z1 - 0.05, z1]] as const) {
      mb.quad(P(h[0] - wx * hw, h[1] - wy * hw, za2), P(h[0] + wx * hw, h[1] + wy * hw, za2), P(h[0] + wx * hw, h[1] + wy * hw, zb2), P(h[0] - wx * hw, h[1] - wy * hw, zb2), toThree(dx, dy, 0), COL.frame);
    }
    // Anneau (octogone orange) à 3,05 m, débordant de 0,45 m devant le panneau ; filet en cône blanc dessous.
    const cx = h[0] + dx * HOOP.ringOffset, cy = h[1] + dy * HOOP.ringOffset, zr = zb + HOOP.rim, n = 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i * 2 * Math.PI) / n, a1 = ((i + 1) * 2 * Math.PI) / n;
      const ri = HOOP.ring - 0.025, ro = HOOP.ring + 0.025;
      mb.quad(P(cx + Math.cos(a0) * ri, cy + Math.sin(a0) * ri, zr), P(cx + Math.cos(a1) * ri, cy + Math.sin(a1) * ri, zr), P(cx + Math.cos(a1) * ro, cy + Math.sin(a1) * ro, zr), P(cx + Math.cos(a0) * ro, cy + Math.sin(a0) * ro, zr), toThree(0, 0, 1), COL.ring);
      const rn = HOOP.ring * 0.55;
      mb.quad(P(cx + Math.cos(a0) * HOOP.ring, cy + Math.sin(a0) * HOOP.ring, zr), P(cx + Math.cos(a1) * HOOP.ring, cy + Math.sin(a1) * HOOP.ring, zr), P(cx + Math.cos(a1) * rn, cy + Math.sin(a1) * rn, zr - 0.4), P(cx + Math.cos(a0) * rn, cy + Math.sin(a0) * rn, zr - 0.4),
        toThree(Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0.2), shade(COL.net, 0.95));
    }
  }
}
