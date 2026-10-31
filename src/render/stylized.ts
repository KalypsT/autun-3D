import * as THREE from "three";
import type { Building, BuildingKind, FacadeFiche, HeightField, RoofMaterial, TileData } from "../data/types";
import { planFacadesSteps, type Placement } from "./facades";
import { finish, MeshBuilder, toThree, UvMeshBuilder, type Steps, type Vec3 } from "./geometry";
import { buildGroundSteps } from "./ground";
import { buildStairs } from "./stairs";
import { SignAtlas } from "./sign-atlas";
import { canvasTexture, rng } from "./canvas";
import { buildFurniture, buildWalls, fenceMaterial } from "./props";
import { doorDims } from "./facade-specs";
import { idKey, pick, roofColor, T, wallColor } from "./style";
import { reshapeBuilding, treesOutsideMonuments, wallsOutsideMonuments } from "../core/landmarks";
import { buildDevanture } from "./devanture";
import { buildLandmarks, buildSitesGround, drawsWalls, landmarkRoofColor, landmarkWallColor, replacesFacade } from "./landmarks";
import { buildStructures, buildWater } from "./structures";

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
export function toonGradient(): THREE.DataTexture {
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
  readonly glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  /** Taches de lumière des lampadaires : translucides, sans écriture de profondeur ; l'atmosphère règle l'opacité. */
  readonly haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
  readonly signAtlas = new SignAtlas();
  readonly signMat = this.lit({ map: this.signAtlas.texture, transparent: true, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  readonly groundMat = this.lit({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  readonly fenceMat = fenceMaterial();
  readonly trunkMat = this.lit({ color: T.trunk });
  readonly crownMat = this.lit({ flatShading: true });
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const darker = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

/** Mur : un dégradé sombre sur le premier mètre (ombre portée au pied), puis un aplat. */
function wall(mb: MeshBuilder, ring: number[], tops: number[], terrain: HeightField, color: THREE.Color): void {
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
let signText: { mb: UvMeshBuilder; atlas: SignAtlas } | null = null;

/** Vitre : dégradé bleuté ; une partie des fenêtres (tirées au hasard) reçoit en plus une couche chaude qui s'allume à la tombée de la nuit. */
function glass(mb: MeshBuilder, p: Placement, s0: number, s1: number, z0: number, z1: number, off: number, litShare = 0.62): void {
  panel(mb, p, s0, s1, z0, z1, off, C(T.glass[0]), C(T.glass[1]));
  if (!glowTarget) return;
  const h = idKey(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
  if (h < litShare) {
    const [lo, hi] = pick(WARM, h * 13, 6);
    panel(glowTarget, p, s0, s1, z0, z1, off + 0.006, C(lo), C(hi));
  }
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
  const text = parts[1] ?? "";
  panel(mb, p, -wm / 2, wm / 2, 0, 0.55, 0, col);
  panel(mb, p, -wm / 2 + 0.05, wm / 2 - 0.05, 0.07, 0.48, 0.015, darker(col, 0.75), col.clone().multiplyScalar(1.08));
  // Lettres suggérées par des barres claires de longueurs variées.
  const letters = C(T.trim);
  let s = -wm / 2 + 0.2;
  const end = wm / 2 - 0.2;
  const key = idKey(parts[1] ?? "");
  for (let i = 0; s < end - 0.1; i++) {
    const len = Math.min(0.12 + ((key * (i + 3) * 17) % 1) * 0.28, end - s);
    if (!text) panel(mb, p, s, s + len, 0.18, 0.37, 0.03, letters);
    s += len + 0.1;
  }
  if (text && signText) {
    // Le nom : un quad texturé centré sur l'enseigne (case de l'atlas de noms, rapport 6,4).
    const h = Math.min(0.34, (wm - 0.3) / 6.4);
    const w = h * 6.4;
    const r = signText.atlas.get(text, T.trim);
    const at = (sx: number, z: number): Vec3 => toThree(p.x + p.tx * sx + p.nx * 0.035, p.y + p.ty * sx + p.ny * 0.035, p.z + z);
    signText.mb.quad(at(-w / 2, 0.275 - h / 2), at(w / 2, 0.275 - h / 2), at(w / 2, 0.275 + h / 2), at(-w / 2, 0.275 + h / 2), toThree(p.nx, p.ny, 0),
      [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], C("#ffffff"));
  }
}

/**
 * Sol libre devant une façade (trottoir ou place, jamais la chaussée) : les terrasses de café ne s'installent que là.
 * Index par cases de 8 m des polygones de trottoirs et de places de la tuile.
 */
function freeGround(layers: Record<string, number[][][]>): (x: number, y: number) => boolean {
  const CELL = 8;
  const cells = new Map<number, number[][][]>();
  const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);
  for (const [name, polys] of Object.entries(layers)) {
    if (name !== "walk" && !name.startsWith("plaza_")) continue;
    for (const poly of polys) {
      const r = poly[0]!;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]!); x1 = Math.max(x1, r[i]!); y0 = Math.min(y0, r[i + 1]!); y1 = Math.max(y1, r[i + 1]!);
      }
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
          const list = cells.get(key(i, j)) ?? [];
          list.push(poly);
          cells.set(key(i, j), list);
        }
      }
    }
  }
  const inRing = (x: number, y: number, r: readonly number[]): boolean => {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPoly = (x: number, y: number, poly: number[][]): boolean => inRing(x, y, poly[0]!) && !poly.slice(1).some((h) => inRing(x, y, h));
  return (x, y) => (cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []).some((p) => inPoly(x, y, p));
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
    // Le feuillage commence en haut du tronc (au-dessus des rues : 4 m au moins, cf. tools/data/roadside.py).
    const ch = Math.max(h - trunk, 1.8);
    m.makeScale(1, trunk + ch * 0.25, 1).setPosition(x, z, -y);
    trunks.setMatrixAt(i, m);
    m.makeScale(rad, ch * 0.42, rad).setPosition(x, z + trunk + ch * 0.42, -y);
    crowns.setMatrixAt(2 * i, m);
    m.makeScale(rad * 0.62, ch * 0.3, rad * 0.62).setPosition(x + rad * 0.12, z + trunk + ch * 0.86, -y);
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

/** Maillages d'une tuile dans le style « conte » : murs en aplats, fenêtres et volets en volumes simples, toits propres. */
export function buildTileStyled(res: StyleResources, tile: TileData, terrain: HeightField): TileMeshes {
  return finish(buildTileSteps(res, tile, terrain));
}

/** Bâtiments et éléments de façade traités entre deux points d'arrêt. */
const BUILDINGS_PER_STEP = 6;
const PLACEMENTS_PER_STEP = 12;

/** Comme `buildTileStyled`, découpé en tranches de quelques millisecondes (cf. `TileManager`). */
export function* buildTileSteps(res: StyleResources, tile: TileData, terrain: HeightField): Steps<TileMeshes> {
  const skip = new URLSearchParams(location.search).get("skip") ?? "";
  const fiches = new Map(tile.fiches.map((f) => [f.id, f]));
  const kinds = tile.kinds;
  const kindOf = (id: string): BuildingKind | undefined => kinds?.buildings[id];
  // Bâtiments remis à la forme de leur gabarit (toits plats des grandes surfaces, pentes faibles des hangars).
  const buildings = tile.buildings.map((b) => reshapeBuilding(b, kindOf(b.id)?.k));
  const plan = yield* planFacadesSteps(buildings.filter((b) => !replacesFacade(kindOf(b.id))), fiches, terrain, freeGround(tile.ground ?? {}));
  const walls = new MeshBuilder(), roofs = new UvMeshBuilder(), detail = skip.includes("misc") ? new MeshBuilder() : plan.misc, glow = new MeshBuilder();
  const names = new UvMeshBuilder();
  // Les éléments de façade écrivent les vitres et les enseignes dans ces cibles ; une seule tuile se construit à la fois.
  const target = (): void => {
    glowTarget = glow;
    signText = { mb: names, atlas: res.signAtlas };
  };

  let count = 0;
  const wallColors = new Map<string, THREE.Color>();
  for (const b of buildings) {
    const f: FacadeFiche | undefined = fiches.get(b.id);
    const key = idKey(b.id);
    const kind = kindOf(b.id);
    // Caché (remplacé par un monument), abri à chariots (dessiné ouvert par les gabarits) ou monument modélisé (hôtel de ville, D123 ;
    // cathédrale, D127 ; église Saint-André, D138 ; maison, D140) : ni murs ni toit génériques.
    if (kind?.k === "hidden" || kind?.k === "cart" || kind?.hall || kind?.cath || kind?.chap || kind?.house) continue;
    // Fiche remplie d'après photo (D141) : son enduit ; sinon la palette de l'époque.
    const wc = landmarkWallColor(kind, b.id) ?? (f?.status === "observed" ? C(f.materials.wall.color) : wallColor(f?.era ?? "xix", key));
    wallColors.set(b.id, wc);
    if (drawsWalls(kind)) {
      if (!skip.includes("wall")) wall(walls, b.ring, b.top, terrain, wc);
      b.holes.forEach((hole, i) => wall(walls, hole, b.holeTop[i]!, terrain, wc));
    }
    const rm: RoofMaterial = f?.materials.roof ?? "tuile_plate";
    const rc = landmarkRoofColor(kind) ?? roofColor(rm, key);
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
    if (++count % BUILDINGS_PER_STEP === 0) yield;
  }

  // Ponts, voies ferrées, quais (D93) ; l'eau est dessinée avec le sol.
  const st = skip.includes("structures") ? undefined : tile.structures;
  if (st) {
    buildStructures(detail, st, tile.bounds, terrain, terrain.ground ?? terrain, (x, y) => terrain.railAt?.(x, y) ?? terrain.heightAt(x, y));
    yield;
  }

  // Gabarits : grandes surfaces, hangars, services publics, églises, stations-service, cimetières.
  target();
  if (!skip.includes("kinds")) {
    buildLandmarks({ solid: detail, glow, names, atlas: res.signAtlas }, { buildings, ...(kinds ? { kinds } : {}) }, fiches, terrain,
      (b) => wallColors.get(b.id) ?? C(T.walls.xix[0]!));
  }
  yield;

  // Éléments de façade en volumes simples.
  const sizes = new Map<string, number>();
  for (const r of plan.requests) sizes.set(r.key, r.wm);
  for (const r of plan.signRequests) sizes.set(r.key, r.wm);
  count = 0;
  for (const p of skip.includes("place") ? [] : plan.placements) {
    target();
    const parts = p.key.split("|");
    switch (parts[0]) {
      case "win": windowGeometry(detail, p, parts); break;
      case "door": doorGeometry(detail, p, parts); break;
      case "shop": shopGeometry(detail, p, parts); break;
      case "railing": railingGeometry(detail, p); break;
      case "sign": signGeometry(detail, p, parts, sizes.get(p.key) ?? 2); break;
      case "dev": {
        // Devanture d'après photo (D141) : la fiche la décrit.
        const fi = fiches.get(parts[1] ?? "");
        if (fi?.ground.devanture) buildDevanture(detail, glowTarget, signText, p, fi.ground.devanture, fi.ground.shopfront?.color ?? "#7f93c0");
        break;
      }
      default: break;
    }
    // Une enseigne dessine son nom dans l'atlas (texte sur canevas) : coûteux, on rend la main après chacune.
    if (parts[0] === "sign" || parts[0] === "dev" || ++count % PLACEMENTS_PER_STEP === 0) yield;
  }

  const fence = new UvMeshBuilder(), posts = new MeshBuilder();
  yield;
  if (!skip.includes("walls")) buildWalls({ solid: detail, solidColor: C("#d9c9a6"), hedgeColor: C(T.trees[2] ?? "#5aa874"), cap: detail, fence, posts }, wallsOutsideMonuments(kinds, tile.walls), terrain);
  yield;
  // Les escaliers remplacés par le perron d'un monument modélisé (hôtel de ville, D125) ne sont plus dessinés sur le relief.
  const perrons = new Set(Object.values(kinds?.buildings ?? {}).map((k) => k.hall?.stairs));
  if (!skip.includes("stairs")) buildStairs(detail, (tile.stairs ?? []).filter((z) => !perrons.has(z.id)), terrain, C("#e6d9b8"), C("#bba98a"));
  const halo = new MeshBuilder();
  target();
  // Le mobilier remplacé par un monument d'après photo (fontaine Saint-Lazare, D131) n'est pas dessiné.
  const replaced = new Set((kinds?.sites ?? []).flatMap((s) => (s.t === "fountain" ? [s.id] : [])));
  if (!skip.includes("furn")) buildFurniture(detail, tile.furniture.filter((f) => !replaced.has(f.id)), terrain, glow, halo);
  yield;

  const group = new THREE.Group();
  let draws = 0, triangles = 0;
  const put = (name: string, geometry: THREE.BufferGeometry, tris: number, mat: THREE.Material): void => {
    const m = new THREE.Mesh(geometry, mat);
    m.name = name;
    m.castShadow = name !== "grilles" && name !== "vitres" && name !== "halos" && name !== "sol" && name !== "enseignes";
    m.receiveShadow = true;
    group.add(m);
    draws++;
    triangles += tris;
  };
  const add = (name: string, mb: { build(): THREE.BufferGeometry; triangleCount: number }, mat: THREE.Material): void => {
    if (mb.triangleCount > 0) put(name, mb.build(), mb.triangleCount, mat);
  };
  add("toits", roofs, res.roofMat);
  // Murs, façades, murets, poteaux et mobilier partagent une matière : un seul maillage, assemblé par blocs.
  const solid = walls.triangleCount + detail.triangleCount + posts.triangleCount;
  if (solid > 0) put("bati", yield* walls.buildSteps([detail, posts]), solid, res.wallMat);
  if (glow.triangleCount > 0) put("vitres", yield* glow.buildSteps(), glow.triangleCount, res.glowMat);
  res.signAtlas.flush();
  yield;
  add("enseignes", names, res.signMat);
  add("halos", halo, res.haloMat);
  yield;
  // L'eau des ouvrages (surfaces complètes, multipolygones compris) remplace la couche d'eau de la tuile.
  const layers = st ? Object.fromEntries(Object.entries(tile.ground ?? {}).filter(([k]) => k !== "water")) : tile.ground ?? {};
  const ground = yield* buildGroundSteps(layers, tile.bounds, terrain);
  buildSitesGround(ground, kinds, terrain.ground ?? terrain);
  if (st) buildWater(ground, st, tile.bounds, terrain.ground ?? terrain);
  if (ground.triangleCount > 0) put("sol", yield* ground.buildSteps(), ground.triangleCount, res.groundMat);
  add("grilles", fence, res.fenceMat);
  const trees = treesOutsideMonuments(kinds, tile.trees);
  if (trees.length) {
    yield;
    group.add(treesStyled(res, trees));
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
