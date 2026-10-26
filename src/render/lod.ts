import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { LodBuilding } from "../data/types";
import { MeshBuilder, toThree } from "./geometry";

const WALL_SHADE = 0.92;

/** Silhouettes des bâtiments d'une tuile lointaine : prismes à toit plat, un seul maillage. */
export function buildLodTile(buildings: readonly LodBuilding[], terrain: Terrain): THREE.Mesh | null {
  const mb = new MeshBuilder();
  const wall = new THREE.Color(), roof = new THREE.Color();
  for (const b of buildings) {
    const n = b.r.length / 2;
    if (n < 3) continue;
    wall.set(b.w).multiplyScalar(WALL_SHADE);
    roof.set(b.t);
    // Faîtage plat à mi-pente : de loin, le volume compte plus que la forme du toit.
    const top = b.e + (b.g - b.e) * (b.m === "terrasse" ? 0 : 0.4);
    const bottom: number[] = [];
    for (let i = 0; i < n; i++) bottom.push(terrain.heightAt(b.r[2 * i]!, b.r[2 * i + 1]!) - 0.6);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = b.r[2 * i]!, y1 = b.r[2 * i + 1]!, x2 = b.r[2 * j]!, y2 = b.r[2 * j + 1]!;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-3) continue;
      mb.quad(toThree(x1, y1, bottom[i]!), toThree(x2, y2, bottom[j]!), toThree(x2, y2, top), toThree(x1, y1, top), toThree((y2 - y1) / len, -(x2 - x1) / len, 0), wall);
    }
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(b.r[2 * i], b.r[2 * i + 1]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const a = contour[i!]!, bb = contour[j!]!, c = contour[k!]!;
      mb.tri(toThree(a.x, a.y, top), toThree(bb.x, bb.y, top), toThree(c.x, c.y, top), [0, 1, 0], roof);
    }
  }
  if (mb.triangleCount === 0) return null;
  const mesh = new THREE.Mesh(mb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}
