import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { Building, FacadeFiche, RoofMaterial, TileData } from "../data/types";
import { planFacades, type Placement } from "./facades";
import { MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import { buildGround } from "./ground";
import { canvasTexture, rng } from "./canvas";
import { buildFurniture, buildWalls, fenceMaterial } from "./props";
import { doorDims } from "./facade-specs";
import { idKey, pick, roofColor, T, wallColor } from "./style";

const SKIRT = 0.4;
const CHIMNEY = new THREE.Color("#a07a62");
const FOOT = 1.2;

export interface TileStats {
  triangles: number;
  windows: number;
  doors: number;
  shops: number;
  balconies: number;
  draws: number;
}

export interface TileMeshes {
  group: THREE.Group;
  stats: TileStats;
}

function dispose(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}

export function disposeTile(t: TileMeshes): void {
  dispose(t.group);
}


export function planeUV(a: number, bb: number, x: number, y: number, size: number): [number, number] {
  const g = Math.hypot(a, bb);
  if (g < 1e-3) return [x / size, y / size];
  const hx = -bb / g, hy = a / g;
  return [(x * hx + y * hy) / size, (((x * a + y * bb) / g) * Math.sqrt(1 + g * g)) / size];
}

export function chimney(mb: MeshBuilder, cx: number, cy: number, sx: number, sy: number, z0: number, z1: number): void {
  const hx = Math.max(sx, 0.5) / 2, hy = Math.max(sy, 0.5) / 2;
  const p = (x: number, y: number, z: number): Vec3 => toThree(cx + x, cy + y, z);
  const c = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i]!, [bx, by] = c[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, by - ay);
    mb.quad(p(ax, ay, z0 - 0.2), p(bx, by, z0 - 0.2), p(bx, by, z1), p(ax, ay, z1), toThree((by - ay) / len, -(bx - ax) / len, 0), CHIMNEY);
  }
  mb.quad(p(-hx, -hy, z1), p(hx, -hy, z1), p(hx, hy, z1), p(-hx, hy, z1), [0, 1, 0], new THREE.Color("#5c4e44"));
}

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

let gradientMap: THREE.DataTexture | null = null;
/** Trois paliers de lumière pour l'ombrage « affiche ». */
function toonGradient(): THREE.DataTexture {
  if (!gradientMap) {
    gradientMap = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
    gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

/** Matières partagées de la direction artistique « conte ». */
export class StyleResources {
  private readonly gradient = T.toon ? toonGradient() : null;
  private lit<P extends object>(p: P): THREE.Material {
    return this.gradient ? new THREE.MeshToonMaterial({ ...p, gradientMap: this.gradient }) : new THREE.MeshLambertMaterial(p);
  }
  readonly wallMat = this.lit({ vertexColors: true });
  readonly roofMat = this.lit({ vertexColors: true, map: roofTexture(), side: THREE.DoubleSide, shadowSide: THREE.BackSide });
  /** Vitres allumées (nuit) : sans éclairage. */
  readonly glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  /** Taches de lumière des lampadaires (nuit) : translucides, sans écriture de profondeur. */
  readonly haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false });
  readonly groundMat = this.lit({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  readonly fenceMat = fenceMaterial();
  readonly trunkMat = this.lit({ color: T.trunk });
  readonly crownMat = this.lit({ flatShading: true });
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

const WARM: [string, string][] = [["#ff9d3c", "#ffe08a"], ["#ffb04a", "#fff0b0"], ["#f08a3a", "#ffd27a"]];
let glowTarget: MeshBuilder | null = null;

/** Vitre : dégradé bleuté le jour ; la nuit, la plupart sont allumées (aplats chauds sans éclairage). */
function glass(mb: MeshBuilder, p: Placement, s0: number, s1: number, z0: number, z1: number, off: number, litShare = 0.62): void {
  if (T.night && glowTarget) {
    const h = idKey(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
    if (h < litShare) {
      const [lo, hi] = pick(WARM, h * 13, 6);
      panel(glowTarget, p, s0, s1, z0, z1, off, C(lo), C(hi));
      return;
    }
  }
  panel(mb, p, s0, s1, z0, z1, off, C(T.glass[0]), C(T.glass[1]));
}

const SUR = { stone: 0.14, plaster_band: 0.1, none: 0 } as const;

function windowGeometry(mb: MeshBuilder, p: Placement, parts: string[]): void {
  const [, style, size, surround, , sill, shutter, , frameHex] = parts as [string, string, string, keyof typeof SUR, string, string, string, string, string];
  const [w, h] = size.split("x").map(Number) as [number, number];
  const sur = SUR[surround];
  const pad = sill === "1" ? 0.16 : 0.02;
  const frame = C(frameHex ?? T.trim);
  const trim = C(T.trim);
  if (sur > 0) panel(mb, p, -(w / 2 + sur), w / 2 + sur, pad - 0.01, pad + h + sur, 0.02, trim);
  panel(mb, p, -w / 2, w / 2, pad, pad + h, 0.03, frame);
  const gi = Math.min(0.06, w * 0.12);
  glass(mb, p, -w / 2 + gi, w / 2 - gi, pad + gi, pad + h - gi, 0.045);
  const bar = 0.035;
  if (style === "panes_6" || style === "panes_4" || style === "panes_2" || style === "french_window") {
    panel(mb, p, -bar / 2, bar / 2, pad + gi, pad + h - gi, 0.06, frame);
    if (style === "panes_6") for (const f of [1 / 3, 2 / 3]) panel(mb, p, -w / 2 + gi, w / 2 - gi, pad + h * f - bar / 2, pad + h * f + bar / 2, 0.06, frame);
    else if (style === "panes_4") panel(mb, p, -w / 2 + gi, w / 2 - gi, pad + h * 0.5 - bar / 2, pad + h * 0.5 + bar / 2, 0.06, frame);
  }
  if (sill === "1") panel(mb, p, -(w / 2 + sur + 0.05), w / 2 + sur + 0.05, 0, 0.1, 0.06, darker(trim, 0.92));
  if (shutter === "battant" || shutter === "persienne") {
    const col = C(pick(T.shutters, idKey(parts[7] ?? ""), 2));
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
  const col = style === "garage" ? C("#9aa0a2") : C(pick(T.doors, idKey(parts[2] ?? ""), 3));
  const trim = C(T.trim);
  if (style !== "garage") panel(mb, p, -(d.w / 2 + d.sur), d.w / 2 + d.sur, 0, d.h + d.sur, 0.03, trim);
  panel(mb, p, -d.w / 2, d.w / 2, 0.02, d.h, 0.045, darker(col, 0.8), col);
  if (style === "glazed") glass(mb, p, -d.w / 2 + 0.12, d.w / 2 - 0.12, d.h * 0.35, d.h - 0.12, 0.06);
  if (style === "carriage") panel(mb, p, -d.w / 2 + 0.1, d.w / 2 - 0.1, d.h * 0.7, d.h - 0.1, 0.06, darker(col, 0.7), darker(col, 0.9));
  if (style !== "garage") panel(mb, p, -(d.w / 2 + d.sur + 0.06), d.w / 2 + d.sur + 0.06, -0.02, 0.1, 0.07, darker(trim, 0.85));
}

function shopGeometry(mb: MeshBuilder, p: Placement, parts: string[]): void {
  const hm = Number(parts[3]);
  const door = parts[4] === "door";
  const w = door ? 1.2 : 1.4;
  const col = C(pick(T.shops, idKey(parts[1] ?? ""), 4));
  panel(mb, p, -w / 2, w / 2, 0, hm, 0.05, col);
  const bulk = door ? 0.15 : 0.55;
  glass(mb, p, -w / 2 + 0.07, w / 2 - 0.07, bulk, hm - 0.08, 0.07, 0.9);
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
  const col = C(pick(T.shops, idKey(parts[2] ?? ""), 4));
  panel(mb, p, -wm / 2, wm / 2, 0, 0.55, 0, col);
  panel(mb, p, -wm / 2 + 0.05, wm / 2 - 0.05, 0.07, 0.48, 0.015, darker(col, 0.75), col.clone().multiplyScalar(1.08));
  // Lettres suggérées par des barres claires de longueurs variées.
  const letters = C(T.trim);
  let s = -wm / 2 + 0.2;
  const end = wm / 2 - 0.2;
  const key = idKey(parts[1] ?? "");
  for (let i = 0; s < end - 0.1; i++) {
    const len = Math.min(0.12 + ((key * (i + 3) * 17) % 1) * 0.28, end - s);
    panel(mb, p, s, s + len, 0.18, 0.37, 0.03, letters);
    s += len + 0.1;
  }
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
    color.set(pick(T.trees, key, 5));
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

/** Ajoute les triangles de `src` à `dst` (pas de spread : les tableaux dépassent la limite d'arguments). */
function append(dst: MeshBuilder, src: MeshBuilder): void {
  for (const k of ["positions", "normals", "colors"] as const) {
    const d = dst[k], v = src[k];
    for (let i = 0; i < v.length; i++) d.push(v[i]!);
  }
}

/** Maillages d'une tuile dans le style « conte » : murs en aplats, fenêtres et volets en volumes simples, toits propres. */
export function buildTileStyled(res: StyleResources, tile: TileData, terrain: Terrain): TileMeshes {
  const fiches = new Map(tile.fiches.map((f) => [f.id, f]));
  const plan = planFacades(tile.buildings, fiches, terrain);
  const walls = new MeshBuilder(), roofs = new UvMeshBuilder(), detail = plan.misc, glow = new MeshBuilder();
  glowTarget = glow;

  for (const b of tile.buildings) {
    const f: FacadeFiche | undefined = fiches.get(b.id);
    const key = idKey(b.id);
    const wc = wallColor(f?.era ?? "xix", key);
    wall(walls, b.ring, b.top, terrain, wc);
    b.holes.forEach((hole, i) => wall(walls, hole, b.holeTop[i]!, terrain, wc));
    const rm: RoofMaterial = f?.materials.roof ?? "tuile_plate";
    const rc = roofColor(rm, key);
    roofFaces(roofs, b, rc);
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

  const fence = new UvMeshBuilder(), posts = new MeshBuilder();
  buildWalls({ solid: detail, solidColor: C("#d9c9a6"), cap: detail, fence, posts }, tile.walls, terrain);
  const halo = new MeshBuilder();
  buildFurniture(detail, tile.furniture, terrain, T.night ? glow : null, T.night ? halo : null);
  append(detail, posts);

  const group = new THREE.Group();
  let draws = 0, triangles = 0;
  const add = (name: string, mb: { build(): THREE.BufferGeometry; triangleCount: number }, mat: THREE.Material): void => {
    if (mb.triangleCount === 0) return;
    const m = new THREE.Mesh(mb.build(), mat);
    m.name = name;
    m.castShadow = name !== "grilles" && name !== "vitres" && name !== "halos" && name !== "sol";
    m.receiveShadow = true;
    group.add(m);
    draws++;
    triangles += mb.triangleCount;
  };
  add("toits", roofs, res.roofMat);
  // Murs, façades, murets et mobilier partagent une matière : un seul maillage.
  append(walls, detail);
  add("bati", walls, res.wallMat);
  add("vitres", glow, res.glowMat);
  add("halos", halo, res.haloMat);
  add("sol", buildGround(tile.ground ?? {}, tile.bounds, terrain), res.groundMat);
  add("grilles", fence, res.fenceMat);
  if (tile.trees.length) {
    group.add(treesStyled(res, tile.trees));
    draws += 2;
  }
  return { group, stats: { triangles, ...plan.stats, draws } };
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
