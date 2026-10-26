import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { StairsZone } from "../data/types";
import { MeshBuilder, toThree } from "./geometry";

const CELL = 0.5;

/** Escalier à partir d'un talus du relief : colonnes de 0,5 m dont le dessus est arrondi à la marche supérieure, avec contremarches. */
export function buildStairs(mb: MeshBuilder, zones: readonly StairsZone[], terrain: Terrain, top: THREE.Color, riser: THREE.Color): void {
  for (const zone of zones) {
    const [x0, y0, x1, y1] = zone.bbox;
    const nx = Math.ceil((x1 - x0) / CELL), ny = Math.ceil((y1 - y0) / CELL);
    const h = new Float32Array(nx * ny).fill(NaN);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const z = terrain.heightAt(x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL);
        if (z - zone.base < 0.15) continue;
        h[j * nx + i] = zone.base + Math.ceil((z - zone.base) / zone.riser) * zone.riser;
      }
    }
    const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= nx || j >= ny ? zone.base : (h[j * nx + i] ?? NaN));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const z = h[j * nx + i]!;
        if (Number.isNaN(z)) continue;
        const ax = x0 + i * CELL, ay = y0 + j * CELL, bx = ax + CELL, by = ay + CELL;
        mb.quad(toThree(ax, ay, z), toThree(bx, ay, z), toThree(bx, by, z), toThree(ax, by, z), [0, 1, 0], top);
        // Contremarche vers chaque voisin plus bas (ou jusqu'au relief hors de la zone).
        const sides: [number, number, number, number, number, number, number, number][] = [
          [i, j - 1, ax, ay, bx, ay, 0, -1],
          [i + 1, j, bx, ay, bx, by, 1, 0],
          [i, j + 1, bx, by, ax, by, 0, 1],
          [i - 1, j, ax, by, ax, ay, -1, 0],
        ];
        for (const [ni, nj, px, py, qx, qy, dx, dy] of sides) {
          const zn = Number.isNaN(at(ni, nj)) ? terrain.heightAt((px + qx) / 2 + dx * 0.25, (py + qy) / 2 + dy * 0.25) - 0.1 : at(ni, nj);
          if (zn >= z - 0.02) continue;
          mb.quad(toThree(px, py, zn), toThree(qx, qy, zn), toThree(qx, qy, z), toThree(px, py, z), toThree(dx, dy, 0), riser);
        }
      }
    }
  }
}
