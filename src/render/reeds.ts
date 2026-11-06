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

/** Herbes hautes : pas de la grille de touffes (m) et couleurs (herbe d'été, un peu sèche). */
const GRASS_STEP = 1.7;
const GRASS = ["#6f9a4e", "#86a35a", "#9aa65e", "#b3a868", "#7f9d52"].map((c) => new THREE.Color(c));

function inRing(x: number, y: number, r: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if (r[i + 1]! > y !== r[j + 1]! > y && x < ((r[j]! - r[i]!) * (y - r[i + 1]!)) / (r[j + 1]! - r[i + 1]!) + r[i]!) inside = !inside;
  }
  return inside;
}

/** Nombre de touffes d'herbes hautes dans des polygones (anneau extérieur puis trous), pour les tests et le budget. */
export function tallGrassPoints(polys: readonly number[][][]): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (const poly of polys) {
    const outer = poly[0]!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      x0 = Math.min(x0, outer[i]!); x1 = Math.max(x1, outer[i]!); y0 = Math.min(y0, outer[i + 1]!); y1 = Math.max(y1, outer[i + 1]!);
    }
    for (let gx = Math.floor(x0 / GRASS_STEP); gx * GRASS_STEP < x1; gx++) {
      for (let gy = Math.floor(y0 / GRASS_STEP); gy * GRASS_STEP < y1; gy++) {
        const key = `g${gx},${gy}`;
        const x = (gx + hash01(key, 1)) * GRASS_STEP, y = (gy + hash01(key, 2)) * GRASS_STEP;
        if (!inRing(x, y, outer) || poly.slice(1).some((h) => inRing(x, y, h))) continue;
        out.push([x, y, key]);
      }
    }
  }
  return out;
}

/**
 * Herbes hautes du sud du plan d'eau (D249, « sauvage avec modération ») : touffes de quatre à cinq lames de 0,45 à 0,8 m, semées sur une
 * grille jittée de 1,7 m dans les polygones `tall` des ouvrages (entre l'eau et le chemin, jamais sur le chemin).
 */
export function buildTallGrass(mb: MeshBuilder, polys: readonly number[][][], terrain: HeightField): void {
  for (const [x, y, key] of tallGrassPoints(polys)) {
    const z = terrain.heightAt(x, y) - 0.03;
    const tall = 0.45 + hash01(key, 3) * 0.35;
    const blades = 4 + Math.floor(hash01(key, 4) * 2);
    for (let b = 0; b < blades; b++) {
      const r = hash01(key, 10 + b);
      const ang = r * Math.PI * 2;
      blade(mb, x + Math.cos(ang) * 0.12, y + Math.sin(ang) * 0.12, z, tall * (0.7 + hash01(key, 30 + b) * 0.3), ang, 0.12 + r * 0.25, 0.06, GRASS[Math.floor(r * GRASS.length)]!);
    }
  }
}
