import * as THREE from "three";
import type { Furniture, HeightField, Wall } from "../data/types";
import { hash01, MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import { canvasTexture } from "./canvas";

const THICK = 0.3;

/** Prisme vertical sur un contour anti-horaire (repère données) : côtés et dessus. */
function extrude(mb: MeshBuilder, pts: [number, number][], z0: number, z1: number, color: THREE.Color): void {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % n]!;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    mb.quad(toThree(x1, y1, z0), toThree(x2, y2, z0), toThree(x2, y2, z1), toThree(x1, y1, z1), toThree((y2 - y1) / len, -(x2 - x1) / len, 0), color);
  }
  for (let i = 1; i + 1 < n; i++) mb.tri(toThree(pts[0]![0], pts[0]![1], z1), toThree(pts[i]![0], pts[i]![1], z1), toThree(pts[i + 1]![0], pts[i + 1]![1], z1), [0, 1, 0], color);
}

function box(mb: MeshBuilder, cx: number, cy: number, hx: number, hy: number, rot: number, z0: number, z1: number, color: THREE.Color): void {
  const c = Math.cos(rot), s = Math.sin(rot);
  const p = (x: number, y: number): [number, number] => [cx + x * c - y * s, cy + x * s + y * c];
  extrude(mb, [p(-hx, -hy), p(hx, -hy), p(hx, hy), p(-hx, hy)], z0, z1, color);
}

function cylinder(mb: MeshBuilder, cx: number, cy: number, r: number, z0: number, z1: number, color: THREE.Color, seg = 7): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < seg; i++) pts.push([cx + r * Math.cos((i / seg) * Math.PI * 2), cy + r * Math.sin((i / seg) * Math.PI * 2)]);
  extrude(mb, pts, z0, z1, color);
}

const LAMP_LIT = new THREE.Color("#ffd27a");
const LAMP_HALO = new THREE.Color("#ffb24a");

/** Disque posé à plat (tache de lumière). */
function disc(mb: MeshBuilder, cx: number, cy: number, z: number, r: number, color: THREE.Color, seg = 14): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    mb.tri(toThree(cx, cy, z), toThree(cx + r * Math.cos(a0), cy + r * Math.sin(a0), z), toThree(cx + r * Math.cos(a1), cy + r * Math.sin(a1), z), [0, 1, 0], color);
  }
}

const COLORS = {
  wood: new THREE.Color("#7a5a3a"), iron: new THREE.Color("#2f3433"), green: new THREE.Color("#3d5a43"), steel: new THREE.Color("#8d9296"), bollard: new THREE.Color("#5a3a2c"), bollardCap: new THREE.Color("#ece8de"),
  yellow: new THREE.Color("#e8b923"), stone: new THREE.Color("#b6ad9c"), sanisette: new THREE.Color("#9aa09c"), water: new THREE.Color("#6f8f9a"),
};

/** Mobilier urbain simplifié, posé sur le sol. */
/** `glow` reçoit les lanternes allumées (nuit), `halo` les taches de lumière au sol. */
export function buildFurniture(mb: MeshBuilder, items: readonly Furniture[], terrain: HeightField, glow: MeshBuilder | null = null, halo: MeshBuilder | null = null): number {
  let n = 0;
  for (const f of items) {
    const z = terrain.heightAt(f.x, f.y);
    const rot = f.rot ?? hash01(String(f.id), 1) * Math.PI;
    switch (f.kind) {
      case "bench":
        box(mb, f.x, f.y, 0.8, 0.22, rot, z + 0.4, z + 0.46, COLORS.wood);
        box(mb, f.x - Math.sin(rot) * -0.2, f.y + Math.cos(rot) * -0.2, 0.8, 0.03, rot, z + 0.5, z + 0.88, COLORS.wood);
        for (const sx of [-0.65, 0.65]) box(mb, f.x + Math.cos(rot) * sx, f.y + Math.sin(rot) * sx, 0.03, 0.2, rot, z, z + 0.4, COLORS.iron);
        break;
      case "waste_basket": cylinder(mb, f.x, f.y, 0.2, z, z + 0.85, COLORS.green); break;
      // Potelet du centre-ville (photos 2, 4, 5 : fût marron, tête blanche).
      case "bollard": cylinder(mb, f.x, f.y, 0.08, z, z + 0.78, COLORS.bollard); cylinder(mb, f.x, f.y, 0.1, z + 0.78, z + 0.88, COLORS.bollardCap); break;
      case "post_box": box(mb, f.x, f.y, 0.22, 0.17, rot, z, z + 1.2, COLORS.yellow); break;
      case "toilets": box(mb, f.x, f.y, 0.9, 0.9, rot, z, z + 2.5, COLORS.sanisette); break;
      case "drinking_water": cylinder(mb, f.x, f.y, 0.1, z, z + 1.0, COLORS.steel); break;
      case "public_bookcase": box(mb, f.x, f.y, 0.4, 0.2, rot, z, z + 1.9, COLORS.wood); break;
      case "memorial": box(mb, f.x, f.y, 0.35, 0.25, rot, z, z + 1.9, COLORS.stone); break;
      case "fountain":
        cylinder(mb, f.x, f.y, 1.3, z, z + 0.55, COLORS.stone, 12);
        cylinder(mb, f.x, f.y, 0.2, z, z + 1.4, COLORS.stone, 8);
        break;
      case "traffic_signals": {
        // Mât au bord de la chaussée, potence vers la route, feu à l'extrémité (rot : direction du mât vers la chaussée).
        const dx = Math.cos(rot), dy = Math.sin(rot);
        cylinder(mb, f.x, f.y, 0.06, z, z + 4.3, COLORS.iron, 6);
        box(mb, f.x + dx * 1.0, f.y + dy * 1.0, 1.0, 0.04, rot, z + 4.15, z + 4.22, COLORS.iron);
        const hx = f.x + dx * 1.9, hy = f.y + dy * 1.9;
        box(mb, hx, hy, 0.14, 0.14, rot, z + 3.5, z + 4.2, COLORS.iron);
        for (const [k, col] of [[0, "#d9472b"], [1, "#f1b24a"], [2, "#3fa56a"]] as const) {
          for (const sgn of [-1, 1]) {
            box(mb, hx + Math.cos(rot + Math.PI / 2) * sgn * 0.145, hy + Math.sin(rot + Math.PI / 2) * sgn * 0.145, 0.07, 0.01, rot, z + 3.6 + k * 0.23, z + 3.77 + k * 0.23, new THREE.Color(col));
          }
        }
        break;
      }
      case "street_lamp": {
        // Mât fin, crosse vers la chaussée (sens aléatoire faute de donnée), lanterne.
        cylinder(mb, f.x, f.y, 0.06, z, z + 4.4, COLORS.iron, 6);
        const ax = f.x + Math.cos(rot) * 0.5, ay = f.y + Math.sin(rot) * 0.5;
        box(mb, f.x + Math.cos(rot) * 0.25, f.y + Math.sin(rot) * 0.25, 0.25, 0.03, rot, z + 4.35, z + 4.42, COLORS.iron);
        box(mb, ax, ay, 0.16, 0.16, rot, z + 4.12, z + 4.38, COLORS.steel);
        if (glow) box(glow, ax, ay, 0.17, 0.17, rot, z + 4.115, z + 4.385, LAMP_LIT);
        box(mb, ax, ay, 0.2, 0.2, rot, z + 4.38, z + 4.45, COLORS.iron);
        if (halo) disc(halo, ax, ay, z + 0.2, 3.4, LAMP_HALO);
        break;
      }
      default: continue;
    }
    n++;
  }
  return n;
}

let fenceTexture: THREE.CanvasTexture | null = null;
/** Barreaudage : barreaux sombres entre une lisse haute et une lisse basse, sur fond transparent. */
function fenceMap(): THREE.CanvasTexture {
  if (fenceTexture) return fenceTexture;
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#262b29";
  for (let i = 0; i < 8; i++) g.fillRect(i * 16 + 6, 0, 5, 128);
  g.fillRect(0, 4, 128, 7);
  g.fillRect(0, 108, 128, 7);
  fenceTexture = canvasTexture(cv, { srgb: true, repeat: true });
  fenceTexture.wrapT = THREE.ClampToEdgeWrapping;
  return fenceTexture;
}

export function fenceMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: fenceMap(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2 });
}

export interface WallSinks {
  /** Murs pleins (texturés comme les façades). */
  solid: MeshBuilder;
  /** Couleur des haies. */
  hedgeColor: THREE.Color;
  solidColor: THREE.Color;
  cap: MeshBuilder;
  fence: UvMeshBuilder;
  posts: MeshBuilder;
}

/** Murs, murets et grilles : les pleins en volume, les grilles en barreaux (texture à transparence) avec piliers. */
export function buildWalls(sinks: WallSinks, walls: readonly Wall[], terrain: HeightField): void {
  for (const w of walls) {
    const open = w.kind === "fence" || w.kind === "gate";
    const hedge = w.kind === "hedge", rampart = w.kind === "rampart";
    const base = hedge ? sinks.hedgeColor : sinks.solidColor;
    const color = base.clone().multiplyScalar(0.9 + hash01(String(w.id), 2) * 0.15);
    const thick = hedge ? 0.8 : rampart ? 1.3 : THICK;
    let s = 0;
    for (let i = 0; i + 3 < w.pts.length; i += 2) {
      const x1 = w.pts[i]!, y1 = w.pts[i + 1]!, x2 = w.pts[i + 2]!, y2 = w.pts[i + 3]!;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.05) continue;
      const tx = (x2 - x1) / len, ty = (y2 - y1) / len;
      const nx = ty, ny = -tx;
      const zb1 = terrain.heightAt(x1, y1) - 0.2, zb2 = terrain.heightAt(x2, y2) - 0.2;
      const zt1 = zb1 + 0.2 + w.height, zt2 = zb2 + 0.2 + w.height;
      if (open) {
        const h = w.height;
        sinks.fence.quad(
          toThree(x1, y1, zb1 + 0.2), toThree(x2, y2, zb2 + 0.2), toThree(x2, y2, zb2 + 0.2 + h), toThree(x1, y1, zb1 + 0.2 + h), toThree(nx, ny, 0),
          [s / 1.28, 0], [(s + len) / 1.28, 0], [(s + len) / 1.28, 1], [s / 1.28, 1], new THREE.Color(1, 1, 1),
        );
        // Piliers tous les 3 m environ.
        const posts = Math.max(1, Math.round(len / 3));
        for (let k = 0; k <= posts; k++) {
          const t = k / posts;
          const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
          box(sinks.posts, px, py, 0.06, 0.06, Math.atan2(ty, tx), terrain.heightAt(px, py) - 0.1, terrain.heightAt(px, py) + 0.15 + h, COLORS.iron);
        }
      } else {
        const hw = thick / 2;
        const a1: [number, number] = [x1 + nx * hw, y1 + ny * hw], a2: [number, number] = [x2 + nx * hw, y2 + ny * hw];
        const b1: [number, number] = [x1 - nx * hw, y1 - ny * hw], b2: [number, number] = [x2 - nx * hw, y2 - ny * hw];
        const side = (p: [number, number], q: [number, number], n: Vec3): void =>
          sinks.solid.quad(toThree(p[0], p[1], zb1), toThree(q[0], q[1], zb2), toThree(q[0], q[1], zt2), toThree(p[0], p[1], zt1), n, color);
        side(a1, a2, toThree(nx, ny, 0));
        side(b2, b1, toThree(-nx, -ny, 0));
        sinks.cap.quad(toThree(a1[0], a1[1], zt1), toThree(a2[0], a2[1], zt2), toThree(b2[0], b2[1], zt2), toThree(b1[0], b1[1], zt1), [0, 1, 0], hedge ? color.clone().multiplyScalar(1.15) : COLORS.stone);
      }
      s += len;
    }
  }
}
