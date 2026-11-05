import * as THREE from "three";
import { hash01, MeshBuilder, toThree, type Vec3 } from "./geometry";
import type { HeightField } from "../data/types";

/**
 * Roseaux et herbes hautes du bord du plan d'eau du Vallon (D244) : touffes de lames fines posées le long des tracés `reeds` des ouvrages
 * de la tuile (le bord de l'eau, relevé par build_vallon_path.py), de part et d'autre du bord (± `SPREAD` m : un pied dans l'eau, un sur la berge).
 * Chaque lame est un triangle long et fin, dessiné des deux côtés, penché au hasard ; quelques épis bruns au-dessus des plus hautes.
 */
const STEP = 0.3;
const SPREAD = 0.75;
const GREENS = ["#5f8a46", "#6f9a4e", "#7fa458", "#8ea65c", "#a7a865"].map((c) => new THREE.Color(c));
const DRY = new THREE.Color("#c2ad6e");
const PLUME = new THREE.Color("#7a5a3a");

export interface ReedLine {
  p: number[];
}

/** Nombre de touffes posées (pour les tests et le budget). */
export function reedTufts(lines: readonly ReedLine[]): number {
  let n = 0;
  for (const l of lines) {
    for (let i = 0; i + 3 < l.p.length; i += 2) n += Math.max(1, Math.round(Math.hypot(l.p[i + 2]! - l.p[i]!, l.p[i + 3]! - l.p[i + 1]!) / STEP));
  }
  return n;
}

function blade(mb: MeshBuilder, x: number, y: number, z: number, h: number, ang: number, lean: number, w: number, col: THREE.Color): void {
  const tx = x + Math.cos(ang) * lean, ty = y + Math.sin(ang) * lean;
  const px = -Math.sin(ang) * w, py = Math.cos(ang) * w;
  const a: Vec3 = toThree(x - px, y - py, z), b: Vec3 = toThree(x + px, y + py, z), c: Vec3 = toThree(tx, ty, z + h);
  const n: Vec3 = toThree(Math.cos(ang), Math.sin(ang), 0.3);
  mb.tri(a, b, c, n, col);
  mb.tri(b, a, c, [-n[0], n[1], -n[2]], col);
}

export function buildReeds(mb: MeshBuilder, lines: readonly ReedLine[], terrain: HeightField): void {
  for (const l of lines) {
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      const x1 = l.p[i]!, y1 = l.p[i + 1]!, x2 = l.p[i + 2]!, y2 = l.p[i + 3]!;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-3) continue;
      const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
      const n = Math.max(1, Math.round(len / STEP));
      for (let j = 0; j < n; j++) {
        const key = `${Math.round(x1 * 10)},${Math.round(y1 * 10)},${j}`;
        const t = (j + hash01(key, 1)) / n;
        const off = (hash01(key, 2) * 2 - 1) * SPREAD;
        const x = x1 + (x2 - x1) * t + nx * off, y = y1 + (y2 - y1) * t + ny * off;
        const z = terrain.heightAt(x, y) - 0.05;
        const tall = 0.9 + hash01(key, 3) * 0.75;
        const blades = 6 + Math.floor(hash01(key, 4) * 3);
        for (let b = 0; b < blades; b++) {
          const r = hash01(key, 10 + b);
          const col = (r < 0.18 ? DRY : GREENS[Math.floor(r * GREENS.length)]!).clone().multiplyScalar(0.92 + hash01(key, 20 + b) * 0.16);
          const ang = r * Math.PI * 2;
          blade(mb, x + Math.cos(ang) * 0.1, y + Math.sin(ang) * 0.1, z, tall * (0.65 + hash01(key, 30 + b) * 0.35), ang, 0.1 + r * 0.3, 0.05, col);
        }
        // Un épi brun sur une touffe sur quatre.
        if (hash01(key, 5) < 0.25) {
          const ang = hash01(key, 6) * Math.PI * 2;
          blade(mb, x, y, z + tall * 0.75, tall * 0.32, ang, 0.05, 0.05, PLUME);
        }
      }
    }
  }
}
