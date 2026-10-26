import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { Building, FacadeFiche, RoofMaterial, TileData } from "../data/types";
import { chimney, planeUV, type TileMeshes } from "./buildings";
import { planFacades, type Placement } from "./facades";
import { MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import { canvasTexture, rng } from "./paint";
import { buildFurniture, buildWalls, fenceMaterial } from "./props";
import { doorDims } from "./sprites";
import { DOORS, GLASS, idKey, pick, roofColor, SHOPS, SHUTTERS, TREES, TRIM, wallColor } from "./style";

const SKIRT = 0.4;
const FOOT = 1.2;

let roofMap: THREE.CanvasTexture | null = null;
/** Rangées de tuiles en traits doux : assez peu contrastées pour ne pas scintiller de loin. */
function roofTexture(): THREE.CanvasTexture {
  if (roofMap) return roofMap;
  const N = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, N, N);
  const rand = rng(5);
  const rows = 8, h = N / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle = "rgba(60,30,20,0.16)";
    g.fillRect(0, r * h + h - 3, N, 3);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(0, r * h, N, 2);
    const off = (r % 2) * 8;
    for (let x = off; x < N; x += 16) {
      g.fillStyle = "rgba(60,30,20,0.10)";
      g.fillRect(x, r * h, 2, h - 3);
      if (rand() < 0.25) {
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(x + 2, r * h + 1, 14, h - 4);
      }
    }
  }
  roofMap = canvasTexture(cv, { srgb: true, repeat: true });
  return roofMap;
}

/** Matières partagées de la direction artistique « conte ». */
export class StyleResources {
  readonly wallMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly detailMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTexture(), side: THREE.DoubleSide, shadowSide: THREE.BackSide });
  readonly fenceMat = fenceMaterial();
  readonly trunkMat = new THREE.MeshLambertMaterial({ color: "#6b5440" });
  readonly crownMat = new THREE.MeshLambertMaterial({ flatShading: true });
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const darker = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

/** Mur : un dégradé sombre sur le premier mètre (ombre portée au pied), puis un aplat. */
function wall(mb: MeshBuilder, ring: number[], tops: number[], terrain: Terrain, color: THREE.Color): void {
  const n = ring.length / 2;
  const foot = darker(color, 0.7);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = ring[2 * i]!, y1 = ring[2 * i + 1]!, x2 = ring[2 * j]!, y2 = ring[2 * j + 1]!;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-3) continue;
    const zb1 = terrain.heightAt(x1, y1) - SKIRT, zb2 = terrain.heightAt(x2, y2) - SKIRT;
    const zt1 = Math.max(tops[i]!, zb1), zt2 = Math.max(tops[j]!, zb2);
    if (zt1 <= zb1 + 0.05 && zt2 <= zb2 + 0.05) continue;
    const nrm = toThree((y2 - y1) / len, -(x2 - x1) / len, 0);
    const m1 = Math.min(zb1 + FOOT, zt1), m2 = Math.min(zb2 + FOOT, zt2);
    mb.quadGradient(toThree(x1, y1, zb1), toThree(x2, y2, zb2), toThree(x2, y2, m2), toThree(x1, y1, m1), nrm, foot, color);
    if (zt1 > m1 + 0.01 || zt2 > m2 + 0.01) mb.quad(toThree(x1, y1, m1), toThree(x2, y2, m2), toThree(x2, y2, zt2), toThree(x1, y1, zt1), nrm, color);
  }
}

/** Panneau vertical dans le repère du mur : `s` le long du mur depuis le milieu du sprite, `z` depuis son bas, `off` vers l'extérieur. */
function panel(mb: MeshBuilder, p: Placement, s0: number, s1: number, z0: number, z1: number, off: number, low: THREE.Color, high: THREE.Color = low): void {
  const at = (s: number, z: number): Vec3 => toThree(p.x + p.tx * s + p.nx * off, p.y + p.ty * s + p.ny * off, p.z + z);
  const n = toThree(p.nx, p.ny, 0);
  if (low === high) mb.quad(at(s0, z0), at(s1, z0), at(s1, z1), at(s0, z1), n, low);
  else mb.quadGradient(at(s0, z0), at(s1, z0), at(s1, z1), at(s0, z1), n, low, high);
}

const SUR = { stone: 0.14, plaster_band: 0.1, none: 0 } as const;

function windowGeometry(mb: MeshBuilder, p: Placement, parts: string[]): void {
  const [, style, size, surround, , sill, shutter, , frameHex] = parts as [string, string, string, keyof typeof SUR, string, string, string, string, string];
  const [w, h] = size.split("x").map(Number) as [number, number];
  const sur = SUR[surround];
  const pad = sill === "1" ? 0.16 : 0.02;
  const frame = C(frameHex ?? TRIM);
  const trim = C(TRIM);
  if (sur > 0) panel(mb, p, -(w / 2 + sur), w / 2 + sur, pad - 0.01, pad + h + sur, 0.02, trim);
  panel(mb, p, -w / 2, w / 2, pad, pad + h, 0.03, frame);
  const gi = Math.min(0.06, w * 0.12);
  panel(mb, p, -w / 2 + gi, w / 2 - gi, pad + gi, pad + h - gi, 0.045, C(GLASS[0]), C(GLASS[1]));
  const bar = 0.035;
  if (style === "panes_6" || style === "panes_4" || style === "panes_2" || style === "french_window") {
    panel(mb, p, -bar / 2, bar / 2, pad + gi, pad + h - gi, 0.06, frame);
    if (style === "panes_6") for (const f of [1 / 3, 2 / 3]) panel(mb, p, -w / 2 + gi, w / 2 - gi, pad + h * f - bar / 2, pad + h * f + bar / 2, 0.06, frame);
    else if (style === "panes_4") panel(mb, p, -w / 2 + gi, w / 2 - gi, pad + h * 0.5 - bar / 2, pad + h * 0.5 + bar / 2, 0.06, frame);
  }
  if (sill === "1") panel(mb, p, -(w / 2 + sur + 0.05), w / 2 + sur + 0.05, 0, 0.1, 0.06, darker(trim, 0.92));
  if (shutter === "battant" || shutter === "persienne") {
    const col = C(pick(SHUTTERS, idKey(parts[7] ?? ""), 2));
    const edge = w / 2 + sur;
    for (const side of [-1, 1]) {
      const a = side * edge, b = side * (edge + w / 2);
      panel(mb, p, Math.min(a, b), Math.max(a, b), pad, pad + h + sur, 0.04, darker(col, 0.8), col);
    }
  }
}

function doorGeometry(mb: MeshBuilder, p: Placement, parts: string[]): void {
  const style = parts[1] as "simple" | "carriage" | "glazed" | "garage";
  const d = doorDims(style);
  const col = style === "garage" ? C("#9aa0a2") : C(pick(DOORS, idKey(parts[2] ?? ""), 3));
  const trim = C(TRIM);
  if (style !== "garage") panel(mb, p, -(d.w / 2 + d.sur), d.w / 2 + d.sur, 0, d.h + d.sur, 0.03, trim);
  panel(mb, p, -d.w / 2, d.w / 2, 0.02, d.h, 0.045, darker(col, 0.8), col);
  if (style === "glazed") panel(mb, p, -d.w / 2 + 0.12, d.w / 2 - 0.12, d.h * 0.35, d.h - 0.12, 0.06, C(GLASS[0]), C(GLASS[1]));
  if (style === "carriage") panel(mb, p, -d.w / 2 + 0.1, d.w / 2 - 0.1, d.h * 0.7, d.h - 0.1, 0.06, darker(col, 0.7), darker(col, 0.9));
  if (style !== "garage") panel(mb, p, -(d.w / 2 + d.sur + 0.06), d.w / 2 + d.sur + 0.06, -0.02, 0.1, 0.07, darker(trim, 0.85));
}

function shopGeometry(mb: MeshBuilder, p: Placement, parts: string[]): void {
  const hm = Number(parts[3]);
  const door = parts[4] === "door";
  const w = door ? 1.2 : 1.4;
  const col = C(pick(SHOPS, idKey(parts[1] ?? ""), 4));
  panel(mb, p, -w / 2, w / 2, 0, hm, 0.05, col);
  const bulk = door ? 0.15 : 0.55;
  panel(mb, p, -w / 2 + 0.07, w / 2 - 0.07, bulk, hm - 0.08, 0.07, C(GLASS[0]), C(GLASS[1]));
  if (!door) panel(mb, p, -w / 2 + 0.1, w / 2 - 0.1, 0.07, bulk - 0.06, 0.065, darker(col, 0.8));
  if (door) panel(mb, p, -0.03, 0.03, bulk, hm - 0.08, 0.085, col);
}

function railingGeometry(mb: MeshBuilder, p: Placement): void {
  const w = p.width ?? 1;
  const iron = C("#262a2b");
  panel(mb, p, -w / 2, w / 2, 0.88, 0.94, 0, iron);
  panel(mb, p, -w / 2, w / 2, 0.06, 0.1, 0, iron);
  const n = Math.max(2, Math.round(w / 0.4));
  for (let i = 0; i <= n; i++) {
    const s = -w / 2 + (w * i) / n;
    panel(mb, p, s - 0.015, s + 0.015, 0.06, 0.9, 0, iron);
  }
}

function signGeometry(mb: MeshBuilder, p: Placement, parts: string[], wm: number): void {
  const col = C(pick(SHOPS, idKey(parts[2] ?? ""), 4));
  panel(mb, p, -wm / 2, wm / 2, 0, 0.55, 0, col);
  panel(mb, p, -wm / 2 + 0.05, wm / 2 - 0.05, 0.07, 0.48, 0.015, darker(col, 0.75), col.clone().multiplyScalar(1.08));
}

function treesStyled(res: StyleResources, trees: TileData["trees"]): THREE.Group {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, res.trunkMat, trees.length);
  // Deux boules par arbre : une grosse et une plus petite au sommet, pour une silhouette de conte.
  const crowns = new THREE.InstancedMesh(crownGeo, res.crownMat, trees.length * 2);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  trees.forEach(([x, y, z, h, r, trunk], i) => {
    const key = idKey(`${x},${y}`);
    const rad = Math.min(r, 4.5) * (0.9 + key * 0.2);
    const ch = Math.max(h - trunk * 0.6, 1.8);
    m.makeScale(1, trunk, 1).setPosition(x, z, -y);
    trunks.setMatrixAt(i, m);
    m.makeScale(rad, ch * 0.42, rad).setPosition(x, z + trunk * 0.6 + ch * 0.38, -y);
    crowns.setMatrixAt(2 * i, m);
    m.makeScale(rad * 0.62, ch * 0.3, rad * 0.62).setPosition(x + rad * 0.12, z + trunk * 0.6 + ch * 0.82, -y);
    crowns.setMatrixAt(2 * i + 1, m);
    color.set(pick(TREES, key, 5));
    crowns.setColorAt(2 * i, color);
    crowns.setColorAt(2 * i + 1, color.clone().multiplyScalar(1.12));
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

/** Maillages d'une tuile dans le style « conte » : murs en aplats, fenêtres et volets en volumes simples, toits propres. */
export function buildTileStyled(res: StyleResources, tile: TileData, terrain: Terrain): TileMeshes {
  const fiches = new Map(tile.fiches.map((f) => [f.id, f]));
  const plan = planFacades(tile.buildings, fiches, terrain);
  const walls = new MeshBuilder(), roofs = new UvMeshBuilder(), detail = plan.misc;

  for (const b of tile.buildings) {
    const f: FacadeFiche | undefined = fiches.get(b.id);
    const key = idKey(b.id);
    const wc = wallColor(f?.era ?? "xix", key);
    wall(walls, b.ring, b.top, terrain, wc);
    b.holes.forEach((hole, i) => wall(walls, hole, b.holeTop[i]!, terrain, wc));
    const rm: RoofMaterial = f?.materials.roof ?? "tuile_plate";
    const rc = roofColor(rm, key);
    if (b.q.fallback) flatRoof(roofs, b, terrain, rc);
    else roofFaces(roofs, b, rc);
    for (const s of b.steps) {
      const [x1, y1, l1, h1, x2, y2, l2, h2] = s as [number, number, number, number, number, number, number, number];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const dz = Math.max(h1 - l1, h2 - l2);
      if (len < 1e-3 || dz > 4 || dz < 1.5) continue;
      const nrm = toThree((y2 - y1) / len, -(x2 - x1) / len, 0);
      const q: [Vec3, Vec3, Vec3, Vec3] = [toThree(x1, y1, l1), toThree(x2, y2, l2), toThree(x2, y2, h2), toThree(x1, y1, h1)];
      walls.quad(...q, nrm, wc);
      walls.quad(q[0], q[3], q[2], q[1], [-nrm[0], 0, -nrm[2]], wc);
    }
    for (const [cx, cy, sx, sy, z0, z1] of b.chim as [number, number, number, number, number, number][]) chimney(detail, cx, cy, sx, sy, z0, z1);
  }

  // Éléments de façade en volumes simples.
  const sizes = new Map<string, number>();
  for (const r of plan.requests) sizes.set(r.key, r.wm);
  for (const r of plan.signRequests) sizes.set(r.key, r.wm);
  for (const p of plan.placements) {
    const parts = p.key.split("|");
    switch (parts[0]) {
      case "win": windowGeometry(detail, p, parts); break;
      case "door": doorGeometry(detail, p, parts); break;
      case "shop": shopGeometry(detail, p, parts); break;
      case "railing": railingGeometry(detail, p); break;
      case "sign": signGeometry(detail, p, parts, sizes.get(p.key) ?? 2); break;
      default: break;
    }
  }

  const fence = new UvMeshBuilder(), posts = new MeshBuilder(), solid = new UvMeshBuilder();
  buildWalls({ solid, solidSize: 2, solidColor: C("#d9c9a6"), cap: detail, fence, posts }, tile.walls, terrain);
  buildFurniture(detail, tile.furniture, terrain);
  detail.positions.push(...posts.positions);
  detail.normals.push(...posts.normals);
  detail.colors.push(...posts.colors);

  const group = new THREE.Group();
  let draws = 0, triangles = 0;
  const add = (name: string, mb: { build(): THREE.BufferGeometry; triangleCount: number }, mat: THREE.Material): void => {
    if (mb.triangleCount === 0) return;
    const m = new THREE.Mesh(mb.build(), mat);
    m.name = name;
    m.castShadow = name !== "grilles";
    m.receiveShadow = true;
    group.add(m);
    draws++;
    triangles += mb.triangleCount;
  };
  add("murs", walls, res.wallMat);
  add("toits", roofs, res.roofMat);
  add("details", detail, res.detailMat);
  add("pleins", solid, res.detailMat);
  add("grilles", fence, res.fenceMat);
  if (tile.trees.length) {
    group.add(treesStyled(res, tile.trees));
    draws += 2;
  }
  return { group, stats: { triangles, ...plan.stats, draws }, pages: { facade: new Set(), sign: new Set() }, missed: 0 };
}

function roofFaces(rb: UvMeshBuilder, b: Building, base: THREE.Color): void {
  for (const face of b.faces) {
    const [a, bb, c] = face.p;
    const open = (coords: number[]): THREE.Vector2[] => {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < coords.length; i += 2) pts.push(new THREE.Vector2(coords[i]!, coords[i + 1]!));
      if (pts.length > 1 && pts[0]!.distanceTo(pts[pts.length - 1]!) < 1e-6) pts.pop();
      return pts;
    };
    const contour = open(face.r);
    if (contour.length < 3) continue;
    const holes = face.h.map(open);
    const verts = [...contour, ...holes.flat()];
    const tris: number[][] = [];
    if (face.t && !face.e) for (let k = 0; k + 2 < face.t.length; k += 3) tris.push([face.t[k]!, face.t[k + 1]!, face.t[k + 2]!]);
    else tris.push(...THREE.ShapeUtils.triangulateShape(contour, holes));
    const nl = Math.hypot(a, bb, 1);
    const n: Vec3 = [-a / nl, 1 / nl, bb / nl];
    // Plan idéal de la face : le style préfère des pans nets au relevé bruité du LiDAR.
    const P = (v: THREE.Vector2): Vec3 => toThree(v.x, v.y, a * v.x + bb * v.y + c);
    for (const [i, j, k] of tris) {
      const va = verts[i!]!, vb = verts[j!]!, vc = verts[k!]!;
      rb.tri(P(va), P(vb), P(vc), n, planeUV(a, bb, va.x, va.y, 1.4), planeUV(a, bb, vb.x, vb.y, 1.4), planeUV(a, bb, vc.x, vc.y, 1.4), base);
    }
  }
}

/** Toit de repli (relevé LiDAR inutilisable) : couvercle plat, entre l'égout et le faîtage. */
function flatRoof(rb: UvMeshBuilder, b: Building, terrain: Terrain, color: THREE.Color): void {
  const top = b.eave + (b.ridge - b.eave) * 0.45;
  const zb = Math.max(top, terrain.heightAt(b.ring[0]!, b.ring[1]!) + 3);
  const open = (coords: number[]): THREE.Vector2[] => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < coords.length; i += 2) pts.push(new THREE.Vector2(coords[i]!, coords[i + 1]!));
    return pts;
  };
  const contour = open(b.ring), holes = b.holes.map(open);
  const verts = [...contour, ...holes.flat()];
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    const va = verts[i!]!, vb = verts[j!]!, vc = verts[k!]!;
    rb.tri(toThree(va.x, va.y, zb), toThree(vb.x, vb.y, zb), toThree(vc.x, vc.y, zb), [0, 1, 0],
      [va.x / 1.4, va.y / 1.4], [vb.x / 1.4, vb.y / 1.4], [vc.x / 1.4, vc.y / 1.4], color);
  }
}
