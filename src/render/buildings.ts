import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { Building } from "../data/types";
import { hash01, MeshBuilder, toThree, type Vec3 } from "./geometry";

/** Teintes de façade provisoires (façades « estimées ») : calcaire ocre, enduits clairs, pierre grise. */
const WALL_PALETTE = ["#cdbb9a", "#d9ceb4", "#cfb9a2", "#bdb5a6", "#caa978", "#d8c4a0", "#c4b196", "#e0d6bf"].map((c) => new THREE.Color(c));
const CHIMNEY = new THREE.Color("#8a7767");
const SKIRT = 0.4;

function wallColor(b: Building): THREE.Color {
  const base = WALL_PALETTE[Math.floor(hash01(b.id) * WALL_PALETTE.length)] ?? WALL_PALETTE[0]!;
  const c = base.clone();
  c.multiplyScalar(0.92 + hash01(b.id, 7) * 0.16);
  return c;
}

/** Matériau de toit : tuile, ardoise ou zinc, d'après le code BD TOPO et la teinte de l'orthophoto. */
function roofColor(b: Building): THREE.Color {
  const hex = b.roofColor ?? "#808080";
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), bl = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
  const warm = r - bl;
  let base: string;
  if (b.roofKind === "flat") base = "#7b766f";
  else if (lum > 165 && warm < 12) base = "#9ca3a8"; // zinc ou métal clair
  else if (b.bd.roof === "20" || warm < 4) base = "#4a525c"; // ardoise
  else base = "#a45a3c"; // tuile
  const c = new THREE.Color(base);
  c.multiplyScalar(Math.min(1.2, Math.max(0.8, lum / 130)) * (0.9 + hash01(b.id, 3) * 0.2));
  return c;
}

function wallRing(mb: MeshBuilder, ring: number[], tops: number[], terrain: Terrain, color: THREE.Color): void {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = ring[2 * i]!, y1 = ring[2 * i + 1]!, x2 = ring[2 * j]!, y2 = ring[2 * j + 1]!;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const zb1 = terrain.heightAt(x1, y1) - SKIRT, zb2 = terrain.heightAt(x2, y2) - SKIRT;
    const zt1 = tops[i]!, zt2 = tops[j]!;
    if (zt1 <= zb1 + 0.05 && zt2 <= zb2 + 0.05) continue;
    const nrm = toThree(dy / len, -dx / len, 0);
    const a = toThree(x1, y1, zb1), b = toThree(x2, y2, zb2), c = toThree(x2, y2, Math.max(zt2, zb2)), d = toThree(x1, y1, Math.max(zt1, zb1));
    mb.quad(a, b, c, d, nrm, color);
  }
}

function box(mb: MeshBuilder, cx: number, cy: number, sx: number, sy: number, z0: number, z1: number, color: THREE.Color): void {
  const hx = sx / 2, hy = sy / 2;
  const p = (x: number, y: number, z: number): Vec3 => toThree(cx + x, cy + y, z);
  const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i]!;
    const [bx, by] = corners[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, by - ay);
    mb.quad(p(ax, ay, z0), p(bx, by, z0), p(bx, by, z1), p(ax, ay, z1), toThree((by - ay) / len, -(bx - ax) / len, 0), color);
  }
  mb.quad(p(-hx, -hy, z1), p(hx, -hy, z1), p(hx, hy, z1), p(-hx, hy, z1), [0, 1, 0], color);
}

function openRing(coords: number[]): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < coords.length; i += 2) pts.push(new THREE.Vector2(coords[i]!, coords[i + 1]!));
  const first = pts[0], last = pts[pts.length - 1];
  if (first && last && pts.length > 1 && first.distanceTo(last) < 1e-6) pts.pop();
  return pts;
}

export interface BuildingMeshes {
  walls: THREE.Mesh;
  roofs: THREE.Mesh;
  triangles: number;
}

export function buildBuildings(buildings: readonly Building[], terrain: Terrain): BuildingMeshes {
  const walls = new MeshBuilder();
  const roofs = new MeshBuilder();
  for (const b of buildings) {
    const wc = wallColor(b);
    const rc = roofColor(b);
    wallRing(walls, b.ring, b.top, terrain, wc);
    b.holes.forEach((hole, i) => wallRing(walls, hole, b.holeTop[i]!, terrain, wc));

    for (const f of b.faces) {
      const [a, bb, c] = f.p;
      const contour = openRing(f.r);
      const holes = f.h.map(openRing);
      if (contour.length < 3) continue;
      const verts = [...contour, ...holes.flat()];
      const tris: number[][] = [];
      if (f.t) for (let k = 0; k + 2 < f.t.length; k += 3) tris.push([f.t[k]!, f.t[k + 1]!, f.t[k + 2]!]);
      else tris.push(...THREE.ShapeUtils.triangulateShape(contour, holes));
      const nl = Math.hypot(a, bb, 1);
      const n: Vec3 = [-a / nl, 1 / nl, bb / nl];
      const vz = (v: THREE.Vector2): Vec3 => toThree(v.x, v.y, a * v.x + bb * v.y + c);
      for (const [i, j, k] of tris) roofs.tri(vz(verts[i!]!), vz(verts[j!]!), vz(verts[k!]!), n, rc);
    }

    for (const s of b.steps) {
      const [x1, y1, l1, h1, x2, y2, l2, h2] = s as [number, number, number, number, number, number, number, number];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-3) continue;
      const nrm = toThree((y2 - y1) / len, -(x2 - x1) / len, 0);
      const q: [Vec3, Vec3, Vec3, Vec3] = [toThree(x1, y1, l1), toThree(x2, y2, l2), toThree(x2, y2, h2), toThree(x1, y1, h1)];
      walls.quad(...q, nrm, wc);
      walls.quad(q[0], q[3], q[2], q[1], [-nrm[0], 0, -nrm[2]], wc);
    }
    for (const [cx, cy, sx, sy, z0, z1] of b.chim as [number, number, number, number, number, number][]) {
      box(walls, cx, cy, Math.max(sx, 0.5), Math.max(sy, 0.5), z0 - 0.2, z1, CHIMNEY);
    }
  }
  const wallMesh = new THREE.Mesh(walls.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  const roofMesh = new THREE.Mesh(roofs.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  for (const m of [wallMesh, roofMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  return { walls: wallMesh, roofs: roofMesh, triangles: walls.triangleCount + roofs.triangleCount };
}
