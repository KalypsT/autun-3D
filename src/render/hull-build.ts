/**
 * Relevé des hauteurs dessinées des bâtiments spéciaux et des sites (D302) : on dessine les gabarits et les sites d'une tuile comme le rendu
 * (`buildLandmarks`, toits génériques des églises et chapelles), puis on garde, case par case dans l'emprise de chacun, le plus haut point
 * dessiné. Le résultat est enregistré dans `public/data/hulls/<tuile>.json` (test `hulls.test.ts` ; `npm run hulls` pour le refaire) et lu par
 * les collisions (`src/core/hulls.ts`). Seuls le bâti plein et le verre comptent (ni lumières, ni enseignes, ni feuillage).
 */
import * as THREE from "three";
import { encodeHeights, inArea, type HullData } from "../core/hulls";
import { drawsGenericRoof, reshapeBuilding } from "../core/landmarks";
import { pointInRing } from "../core/ring";
import { roofPlanes } from "../core/roofs";
import { solidShapes, type SolidShape } from "../core/world";
import type { HeightField, TileData } from "../data/types";
import { MeshBuilder, UvMeshBuilder } from "./geometry";
import { buildLandmarks, type LandmarkSinks } from "./landmarks";
import type { SignAtlas } from "./sign-atlas";

/** Côté des cases (m) : fin pour les petites emprises (piles, socles), un mètre pour les grands bâtiments. */
const FINE = 0.5;
const COARSE = 1;
/** Emprise (m², boîte englobante) au-delà de laquelle les cases font un mètre. */
const FINE_AREA = 1500;

interface Grid {
  shape: SolidShape;
  x0: number;
  y0: number;
  s: number;
  nx: number;
  ny: number;
  x1: number;
  y1: number;
  mask: Uint8Array;
  z: Float32Array;
}

function grid(shape: SolidShape): Grid {
  let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
  for (const r of shape.outer) {
    for (let i = 0; i < r.length; i += 2) {
      ax = Math.min(ax, r[i]!);
      bx = Math.max(bx, r[i]!);
      ay = Math.min(ay, r[i + 1]!);
      by = Math.max(by, r[i + 1]!);
    }
  }
  const s = (bx - ax) * (by - ay) < FINE_AREA ? FINE : COARSE;
  const x0 = Math.floor(ax / s) * s, y0 = Math.floor(ay / s) * s;
  const nx = Math.max(1, Math.ceil((bx - x0) / s)), ny = Math.max(1, Math.ceil((by - y0) / s));
  const mask = new Uint8Array(nx * ny);
  const z = new Float32Array(nx * ny).fill(NaN);
  const inside = (x: number, y: number): boolean => inArea(x, y, shape.outer, shape.holes);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + i * s, cy = y0 + j * s;
      // Une case compte si son centre ou un de ses coins est dans l'emprise : les points près du mur ont une hauteur.
      if (inside(cx + s / 2, cy + s / 2) || inside(cx, cy) || inside(cx + s, cy) || inside(cx, cy + s) || inside(cx + s, cy + s)) mask[j * nx + i] = 1;
    }
  }
  return { shape, x0, y0, s, nx, ny, x1: x0 + nx * s, y1: y0 + ny * s, mask, z };
}

function put(g: Grid, x: number, y: number, z: number): void {
  const i = Math.floor((x - g.x0) / g.s), j = Math.floor((y - g.y0) / g.s);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return;
  const k = j * g.nx + i;
  if (!g.mask[k]) return;
  if (Number.isNaN(g.z[k]!) || z > g.z[k]!) g.z[k] = z;
}

/** Triangle (x, y, z) : ses sommets, et les centres de cases qu'il couvre vu de dessus (hauteur interpolée). */
function rasterTri(g: Grid, p: readonly number[]): void {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = p as [number, number, number, number, number, number, number, number, number];
  if (Math.max(ax, bx, cx) < g.x0 || Math.min(ax, bx, cx) > g.x1 || Math.max(ay, by, cy) < g.y0 || Math.min(ay, by, cy) > g.y1) return;
  put(g, ax, ay, az);
  put(g, bx, by, bz);
  put(g, cx, cy, cz);
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(det) < 1e-9) return;
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - g.x0) / g.s - 0.5)), i1 = Math.min(g.nx - 1, Math.ceil((Math.max(ax, bx, cx) - g.x0) / g.s - 0.5));
  const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - g.y0) / g.s - 0.5)), j1 = Math.min(g.ny - 1, Math.ceil((Math.max(ay, by, cy) - g.y0) / g.s - 0.5));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = g.x0 + (i + 0.5) * g.s, y = g.y0 + (j + 0.5) * g.s;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      put(g, x, y, l1 * az + l2 * bz + l3 * cz);
    }
  }
}

/** Relevés des bâtiments spéciaux et des sites d'une tuile (avec ses types de bâtiments), dans l'ordre de `solidShapes`. */
export function buildHulls(tile: Pick<TileData, "buildings" | "kinds" | "fiches">, terrain: HeightField): HullData[] {
  const shapes = solidShapes(tile, (x, y) => terrain.heightAt(x, y));
  if (!shapes.length || !tile.kinds) return [];
  const grids = shapes.map(grid);
  const kinds = tile.kinds;
  const buildings = tile.buildings.map((b) => reshapeBuilding(b, kinds.buildings[b.id]?.k, kinds.buildings[b.id]?.roof));
  // Ce que dessinent les gabarits et les sites.
  const sinks: LandmarkSinks = {
    solid: new MeshBuilder(), glow: new MeshBuilder(true), glass: new MeshBuilder(), names: new UvMeshBuilder(), leaves: new MeshBuilder(), halo: new MeshBuilder(true),
    atlas: { get: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }) } as unknown as SignAtlas,
  };
  buildLandmarks(sinks, { buildings, kinds }, new Map(tile.fiches.map((f) => [f.id, f])), terrain, () => new THREE.Color());
  const tri: number[] = new Array<number>(9);
  for (const mb of [sinks.solid, sinks.glass!]) {
    const p = mb.positions;
    for (let t = 0; t + 8 < p.length; t += 9) {
      // Repère three.js (x, z, −y) vers le repère du jeu.
      for (let v = 0; v < 3; v++) {
        tri[3 * v] = p[t + 3 * v]!;
        tri[3 * v + 1] = -p[t + 3 * v + 2]!;
        tri[3 * v + 2] = p[t + 3 * v + 1]!;
      }
      for (const g of grids) rasterTri(g, tri);
    }
  }
  // Toits génériques des églises et chapelles (dessinés avec les toits de la ville, pas par les gabarits).
  const byId = new Map(buildings.map((b) => [b.id, b]));
  for (const g of grids) {
    const b = byId.get(g.shape.key);
    if (!b || !drawsGenericRoof(kinds.buildings[b.id])) continue;
    for (const f of roofPlanes(b)) {
      for (let i = 0; i < f.ring.length; i += 2) put(g, f.ring[i]!, f.ring[i + 1]!, f.a * f.ring[i]! + f.b * f.ring[i + 1]! + f.c);
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const x = g.x0 + (i + 0.5) * g.s, y = g.y0 + (j + 0.5) * g.s;
          if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1 || !pointInRing(x, y, f.ring) || f.holes.some((h) => pointInRing(x, y, h))) continue;
          put(g, x, y, f.a * x + f.b * y + f.c);
        }
      }
    }
  }
  const out: HullData[] = [];
  for (const g of grids) {
    if (!g.z.some((v) => !Number.isNaN(v))) continue;
    out.push({ k: g.shape.key, x: round(g.x0), y: round(g.y0), s: g.s, nx: g.nx, ny: g.ny, z: encodeHeights(g.z) });
  }
  return out;
}

const round = (v: number): number => Math.round(v * 1000) / 1000;
