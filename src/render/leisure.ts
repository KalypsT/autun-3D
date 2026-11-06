import * as THREE from "three";
import type { Deck, Equip, HeightField } from "../data/types";
import { DeckAxis } from "../core/bridges";
import { equipSize } from "../core/leisure";
import { hash01, MeshBuilder, toThree, type Vec3 } from "./geometry";
import { block, face, quad } from "./piers";
import { T } from "./style";

/**
 * Équipements du plan d'eau du Vallon (D247) : modules du skatepark et pump track (tabliers `skate` et `pump`), jeux, tables, agrès, panneaux,
 * grillage, ganivelle, pierres du gué. Couleurs d'après les photos de l'utilisateur ; formes simplifiées.
 */
const C = (hex: string): THREE.Color => new THREE.Color(hex);
const CONCRETE = C("#d3d0c8");
const CONCRETE_SIDE = C("#b9b5ac");
const COPING = C("#9aa0a4");
const ASPHALT = C("#5d6264");
const MOUND = C("#7f9a52");
const WOOD = C("#8a6845");
const WOOD_DARK = C("#6b4f33");
const STEEL = C("#8f969a");
const DARK = C("#3a3d3e");

type Pt = { x: number; y: number; z: number; tx: number; ty: number };
const edge = (a: Pt, hw: number, k: number): [number, number] => [a.x - a.ty * hw * k, a.y + a.tx * hw * k];

/** Module de skatepark : dessus en béton clair, flancs pleins jusqu'au sol, rebord en acier en haut d'un quarter. */
export function buildSkate(mb: MeshBuilder, d: Deck, ground: HeightField): void {
  const axis = new DeckAxis(d);
  const hw = d.w / 2;
  const pts = axis.cum.map((s) => axis.at(s));
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const [al, bl, ar, br] = [edge(a, hw, 1), edge(b, hw, 1), edge(a, hw, -1), edge(b, hw, -1)];
    quad(mb, toThree(al[0], al[1], a.z), toThree(bl[0], bl[1], b.z), toThree(br[0], br[1], b.z), toThree(ar[0], ar[1], a.z), [0, 1, 0], CONCRETE);
    for (const k of [1, -1]) {
      const [p, q] = k === 1 ? [al, bl] : [ar, br];
      quad(mb, toThree(p[0], p[1], ground.heightAt(p[0], p[1]) - 0.1), toThree(q[0], q[1], ground.heightAt(q[0], q[1]) - 0.1), toThree(q[0], q[1], b.z), toThree(p[0], p[1], a.z),
        toThree(-a.ty * k, a.tx * k, 0), CONCRETE_SIDE);
    }
  }
  // Faces des bouts plus hautes que le sol (arrière d'un quarter, bouts d'un bloc).
  for (const [a, k] of [[pts[0]!, -1], [pts[pts.length - 1]!, 1]] as const) {
    const l = edge(a, hw, 1), r = edge(a, hw, -1);
    if (a.z - ground.heightAt(a.x, a.y) < 0.05) continue;
    quad(mb, toThree(l[0], l[1], ground.heightAt(l[0], l[1]) - 0.1), toThree(r[0], r[1], ground.heightAt(r[0], r[1]) - 0.1), toThree(r[0], r[1], a.z), toThree(l[0], l[1], a.z),
      toThree(a.tx * k, a.ty * k, 0), CONCRETE_SIDE);
  }
  // Rebord : là où la rampe d'un quarter atteint sa plate-forme (le plus haut point avant le dernier).
  if (pts.length > 4) {
    const top = pts[pts.length - 2]!;
    const l = edge(top, hw, 1);
    block(mb, (l[0] + edge(top, hw, -1)[0]) / 2, (l[1] + edge(top, hw, -1)[1]) / 2, -top.ty, top.tx, hw, 0.04, top.z - 0.02, top.z + 0.04, COPING);
  }
}

/** Piste de pump track : enrobé sur des bosses de terre, flancs enherbés jusqu'au relief. */
export function buildPump(mb: MeshBuilder, d: Deck, ground: HeightField): void {
  const axis = new DeckAxis(d);
  const hw = d.w / 2;
  const pts = axis.cum.map((s) => axis.at(s));
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const [al, bl, ar, br] = [edge(a, hw, 1), edge(b, hw, 1), edge(a, hw, -1), edge(b, hw, -1)];
    quad(mb, toThree(al[0], al[1], a.z), toThree(bl[0], bl[1], b.z), toThree(br[0], br[1], b.z), toThree(ar[0], ar[1], a.z), [0, 1, 0], ASPHALT);
    for (const k of [1, -1]) {
      const [p, q] = k === 1 ? [al, bl] : [ar, br];
      // Flanc légèrement évasé (30 cm au pied), de l'enrobé au relief.
      const [po, qo] = [edge(a, hw + 0.3, k), edge(b, hw + 0.3, k)];
      quad(mb, toThree(p[0], p[1], a.z - 0.01), toThree(q[0], q[1], b.z - 0.01), toThree(qo[0], qo[1], ground.heightAt(qo[0], qo[1]) - 0.1), toThree(po[0], po[1], ground.heightAt(po[0], po[1]) - 0.1),
        toThree(-a.ty * k, a.tx * k, 0.3), MOUND);
    }
  }
}

/** Dessus d'un tablier de pump track ou de skatepark (pour `buildDeck`). */
export function buildLeisureDeck(mb: MeshBuilder, d: Deck, ground: HeightField): void {
  if (d.st === "skate") buildSkate(mb, d, ground);
  else buildPump(mb, d, ground);
}

/** Toit à deux pans au-dessus d'une plate-forme : faîtage le long de u. */
function roof(mb: MeshBuilder, cx: number, cy: number, ux: number, uy: number, hl: number, hw: number, z: number, rise: number, col: THREE.Color): void {
  const vx = -uy, vy = ux;
  const p = (s: number, t: number, h: number): Vec3 => toThree(cx + ux * s + vx * t, cy + uy * s + vy * t, z + h);
  for (const k of [1, -1]) quad(mb, p(-hl, k * hw, 0), p(hl, k * hw, 0), p(hl, 0, rise), p(-hl, 0, rise), toThree(vx * k, vy * k, 1), col);
  for (const k of [1, -1]) face(mb, p(k * hl, hw, 0), p(k * hl, -hw, 0), p(k * hl, 0, rise), toThree(ux * k, uy * k, 0), col.clone().multiplyScalar(0.85));
}

/** Toboggan : goulotte inclinée de (x0, y0, z0) à (x1, y1, z1), largeur 0,55 m, rebords. */
function slide(mb: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: THREE.Color): void {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, vx = -uy, vy = ux, hw = 0.28;
  const p = (s: number, t: number, h: number): Vec3 => {
    const k = Math.min(1, Math.max(0, s / L));
    return toThree(x0 + ux * s + vx * t, y0 + uy * s + vy * t, z0 + (z1 - z0) * k + h);
  };
  quad(mb, p(0, -hw, 0), p(L, -hw, 0), p(L, hw, 0), p(0, hw, 0), [0, 1, 0], col);
  quad(mb, p(0, -hw, -0.08), p(L, -hw, -0.08), p(L, hw, -0.08), p(0, hw, -0.08), [0, -1, 0], col.clone().multiplyScalar(0.7));
  for (const k of [1, -1]) {
    quad(mb, p(0, k * hw, -0.08), p(L, k * hw, -0.08), p(L, k * hw, 0.18), p(0, k * hw, 0.18), toThree(vx * k, vy * k, 0), col.clone().multiplyScalar(0.9));
  }
}

/** Tour de jeux : quatre poteaux, plate-forme, garde-corps pleins, toit. Renvoie le centre et la hauteur de la plate-forme. */
function tower(mb: MeshBuilder, x: number, y: number, ux: number, uy: number, h: number, z: number, post: THREE.Color, panel: THREE.Color, roofCol: THREE.Color): void {
  const vx = -uy, vy = ux, s = 0.65;
  for (const [a, b] of [[-s, -s], [s, -s], [s, s], [-s, s]] as const) block(mb, x + ux * a + vx * b, y + uy * a + vy * b, ux, uy, 0.05, 0.05, z, z + h + 1.5, post);
  block(mb, x, y, ux, uy, s + 0.05, s + 0.05, z + h - 0.06, z + h, WOOD);
  for (const k of [1, -1]) block(mb, x + vx * s * k, y + vy * s * k, ux, uy, s - 0.1, 0.03, z + h + 0.15, z + h + 0.75, panel);
  roof(mb, x, y, ux, uy, s + 0.2, s + 0.25, z + h + 1.5, 0.55, roofCol);
}

function buildEquipItem(mb: MeshBuilder, e: Equip, ground: HeightField): void {
  const x = e.x!, y = e.y!, a = e.a ?? 0;
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const z = ground.heightAt(x, y);
  const [hl, hw] = equipSize(e);
  switch (e.k) {
    case "play_small": {
      // Photo : petite tour au toit en arc orange, toboggan bleu, mur d'escalade gris, sur sol souple rouge.
      tower(mb, x, y, ux, uy, 1.0, z, C("#e5c43a"), C("#e5c43a"), C("#e0703a"));
      slide(mb, x + ux * 0.7, y + uy * 0.7, z + 1.0, x + ux * hl * 1.25, y + uy * hl * 1.25, z + 0.2, C("#3fa7c9"));
      const wx = x - ux * 0.75, wy = y - uy * 0.75;
      quad(mb, toThree(wx + vx * 0.6, wy + vy * 0.6, z + 1.0), toThree(wx - vx * 0.6, wy - vy * 0.6, z + 1.0), toThree(wx - vx * 0.6 - ux * 1.3, wy - vy * 0.6 - uy * 1.3, z),
        toThree(wx + vx * 0.6 - ux * 1.3, wy + vy * 0.6 - uy * 1.3, z), toThree(-ux, -uy, 1), C("#7d7f80"));
      break;
    }
    case "play_big": {
      // Photo : deux tours aux toits rose et orange, passerelle, deux toboggans orange, panneaux jaunes.
      const d = hl * 0.45;
      tower(mb, x - ux * d, y - uy * d, ux, uy, 1.2, z, DARK, C("#f0b52e"), C("#d9677a"));
      tower(mb, x + ux * d, y + uy * d, ux, uy, 1.4, z, DARK, C("#f0b52e"), C("#ef8a2f"));
      block(mb, x, y, ux, uy, d - 0.7, 0.45, z + 1.25, z + 1.32, WOOD);
      for (const k of [1, -1]) block(mb, x + vx * 0.45 * k, y + vy * 0.45 * k, ux, uy, d - 0.7, 0.03, z + 1.4, z + 2.0, C("#f0b52e"));
      slide(mb, x - ux * d - vx * 0.7, y - uy * d - vy * 0.7, z + 1.2, x - ux * d - vx * 3.2, y - uy * d - vy * 3.2, z + 0.25, C("#f0902e"));
      slide(mb, x + ux * (d + 0.7), y + uy * (d + 0.7), z + 1.4, x + ux * hl * 1.15, y + uy * hl * 1.15, z + 0.25, C("#f0902e"));
      break;
    }
    case "springer": {
      const col = C(e.c ?? "#e8873a");
      block(mb, x, y, ux, uy, 0.12, 0.12, z, z + 0.35, DARK);
      block(mb, x, y, ux, uy, 0.42, 0.15, z + 0.35, z + 0.6, col);
      block(mb, x + ux * 0.32, y + uy * 0.32, ux, uy, 0.1, 0.12, z + 0.6, z + 0.95, col);
      block(mb, x + ux * 0.2, y + uy * 0.2, vx, vy, 0.2, 0.025, z + 0.82, z + 0.86, STEEL);
      break;
    }
    case "bench":
      block(mb, x, y, ux, uy, 0.8, 0.22, z + 0.4, z + 0.46, WOOD);
      block(mb, x - vx * 0.2, y - vy * 0.2, ux, uy, 0.8, 0.03, z + 0.5, z + 0.88, WOOD);
      for (const s of [-0.65, 0.65]) block(mb, x + ux * s, y + uy * s, ux, uy, 0.04, 0.2, z, z + 0.4, WOOD_DARK);
      break;
    case "picnic":
      block(mb, x, y, ux, uy, 0.95, 0.38, z + 0.72, z + 0.78, WOOD);
      for (const k of [1, -1]) block(mb, x + vx * 0.65 * k, y + vy * 0.65 * k, ux, uy, 0.95, 0.14, z + 0.42, z + 0.47, WOOD);
      for (const s of [-0.7, 0.7]) block(mb, x + ux * s, y + uy * s, ux, uy, 0.05, 0.75, z, z + 0.42, WOOD_DARK);
      for (const s of [-0.7, 0.7]) block(mb, x + ux * s, y + uy * s, ux, uy, 0.05, 0.08, z, z + 0.72, WOOD_DARK);
      break;
    case "fitness":
      // Agrès générique : trois poteaux de bois, barres de traction à trois hauteurs, barres parallèles.
      for (const s of [-1.2, 0, 1.2]) block(mb, x + ux * s, y + uy * s, ux, uy, 0.07, 0.07, z, z + 2.3, WOOD);
      block(mb, x - ux * 0.6, y - uy * 0.6, ux, uy, 0.6, 0.025, z + 2.1, z + 2.15, STEEL);
      block(mb, x + ux * 0.6, y + uy * 0.6, ux, uy, 0.6, 0.025, z + 1.75, z + 1.8, STEEL);
      for (const k of [1, -1]) block(mb, x + vx * 0.25 * k + ux * 0.6, y + vy * 0.25 * k + uy * 0.6, ux, uy, 0.6, 0.025, z + 1.05, z + 1.1, STEEL);
      break;
    case "board": {
      for (const s of [-0.5, 0.5]) block(mb, x + ux * s, y + uy * s, ux, uy, 0.05, 0.05, z, z + 1.9, WOOD_DARK);
      block(mb, x, y, ux, uy, 0.6, 0.04, z + 1.0, z + 1.85, WOOD);
      const f = (s: number, h: number): Vec3 => toThree(x + ux * s + vx * 0.045, y + uy * s + vy * 0.045, z + h);
      quad(mb, f(-0.52, 1.07), f(0.52, 1.07), f(0.52, 1.78), f(-0.52, 1.78), toThree(vx, vy, 0), C("#e9e2c8"));
      break;
    }
    case "stone": {
      const g = C(["#9a968c", "#8e8a80", "#a7a297"][Math.floor(hash01(`${x},${y}`) * 3)]!);
      block(mb, x, y, ux, uy, hl, hw, z - 0.1, z + 0.12, g);
      break;
    }
    default: break;
  }
}

/** Tracés : barre de glisse, grillage gris (fils verticaux et lisses), ganivelle (lattes de châtaignier liées par deux fils), rigole. */
function buildEquipLine(mb: MeshBuilder, e: Equip, ground: HeightField): void {
  const p = e.p!;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i]!, ay = p[i + 1]!, bx = p[i + 2]!, by = p[i + 3]!;
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 0.05) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L, vx = -uy, vy = ux;
    if (e.k === "rail") {
      const za = ground.heightAt(ax, ay), zb = ground.heightAt(bx, by), h = e.h ?? 0.35;
      for (const [x, y, z] of [[ax, ay, za], [bx, by, zb]] as const) block(mb, x, y, ux, uy, 0.04, 0.04, z, z + h, STEEL);
      block(mb, (ax + bx) / 2, (ay + by) / 2, ux, uy, L / 2 + 0.2, 0.03, (za + zb) / 2 + h, (za + zb) / 2 + h + 0.06, STEEL);
      continue;
    }
    if (e.k === "brook") {
      const hw = (e.w ?? 1.2) / 2;
      // Au-dessus du stabilisé du chemin (4 cm) : l'eau passe entre les pierres du gué.
      const za = ground.heightAt(ax, ay) + 0.06, zb = ground.heightAt(bx, by) + 0.06;
      quad(mb, toThree(ax + vx * hw, ay + vy * hw, za), toThree(bx + vx * hw, by + vy * hw, zb), toThree(bx - vx * hw, by - vy * hw, zb), toThree(ax - vx * hw, ay - vy * hw, za), [0, 1, 0], C(T.water));
      continue;
    }
    const h = e.h ?? 1.1;
    const ganivelle = e.k === "ganivelle";
    const step = ganivelle ? 0.11 : 0.12;
    const posts = ganivelle ? 2.0 : 2.5;
    // Poteaux.
    for (let s = 0; s <= L + 1e-6; s += posts) {
      const x = ax + ux * Math.min(s, L), y = ay + uy * Math.min(s, L), z = ground.heightAt(x, y);
      block(mb, x, y, ux, uy, 0.04, 0.04, z - 0.1, z + h + 0.05, ganivelle ? WOOD_DARK : C("#6e7477"));
    }
    // Lattes ou fils verticaux, dessinés des deux côtés.
    for (let s = step / 2, n = 0; s < L; s += step, n++) {
      const x = ax + ux * s, y = ay + uy * s, z = ground.heightAt(x, y);
      const top = z + h - (ganivelle ? 0.08 * hash01(`${e.n}:${i}:${n}`) : 0);
      const w = ganivelle ? 0.025 : 0.006;
      const col = ganivelle ? C(["#8b6a48", "#9c7a54", "#7a5c3e", "#a88a66"][n % 4]!) : C("#80878a");
      const a0: Vec3 = toThree(x - ux * w, y - uy * w, z - 0.05), a1: Vec3 = toThree(x + ux * w, y + uy * w, z - 0.05);
      const b1: Vec3 = toThree(x + ux * w, y + uy * w, top), b0: Vec3 = toThree(x - ux * w, y - uy * w, top);
      quad(mb, a0, a1, b1, b0, toThree(vx, vy, 0), col);
      quad(mb, a0, a1, b1, b0, toThree(-vx, -vy, 0), col);
    }
    // Lisses (grillage) ou fils (ganivelle).
    const za = ground.heightAt(ax, ay), zb = ground.heightAt(bx, by);
    for (const hh of ganivelle ? [0.25, h - 0.2] : [0.05, h / 2, h]) {
      const t = ganivelle ? 0.012 : 0.025;
      for (const k of [1, -1]) {
        quad(mb, toThree(ax, ay, za + hh - t), toThree(bx, by, zb + hh - t), toThree(bx, by, zb + hh + t), toThree(ax, ay, za + hh + t), toThree(vx * k, vy * k, 0),
          ganivelle ? DARK : C("#6e7477"));
      }
    }
  }
}

/** Tous les équipements d'une tuile. */
export function buildEquip(mb: MeshBuilder, items: readonly Equip[], ground: HeightField): void {
  for (const e of items) {
    if (e.p) buildEquipLine(mb, e, ground);
    else buildEquipItem(mb, e, ground);
  }
}
