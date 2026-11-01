import * as THREE from "three";
import type { HeightField, Terrace } from "../data/types";
import { hash01, MeshBuilder, toThree, type Vec3 } from "./geometry";

/** Devanture : milieu du bas de la vitrine sur le mur, tangente et normale sortante, largeur, haut des vitrines, bas de l'enseigne. */
export interface Front {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  width: number;
  /** Haut des vitrines et haut de l'enseigne (altitudes). */
  zTop: number;
  zSign: number;
  key: string;
}

/** Commerces qui ont toujours un store ; les autres en ont un une fois sur trois. */
const AWNING = new Set(["restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "bakery", "pastry", "butcher", "deli", "greengrocer", "florist", "cheese", "wine", "confectionery"]);
/** Commerces qui sortent une terrasse quand le trottoir le permet. */
const TERRACE = new Set(["restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream"]);

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const CREAM = C("#f4ecd8");

function point(f: Front, s: number, off: number): [number, number] {
  return [f.x + f.tx * s + f.nx * off, f.y + f.ty * s + f.ny * off];
}

/** Pavé droit d'axe u (ux, uy), demi-côtés hl (le long de u) et hw. */
function box(mb: MeshBuilder, cx: number, cy: number, ux: number, uy: number, hl: number, hw: number, z0: number, z1: number, color: THREE.Color): void {
  const vx = -uy, vy = ux;
  const p = (s: number, t: number): [number, number] => [cx + ux * s + vx * t, cy + uy * s + vy * t];
  const pts = [p(-hl, -hw), p(hl, -hw), p(hl, hw), p(-hl, hw)];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    mb.quad(toThree(ax, ay, z0), toThree(bx, by, z0), toThree(bx, by, z1), toThree(ax, ay, z1), toThree((by - ay) / len, -(bx - ax) / len, 0), color);
  }
  const [a, b, c, d] = pts as [[number, number], [number, number], [number, number], [number, number]];
  mb.quad(toThree(a[0], a[1], z1), toThree(b[0], b[1], z1), toThree(c[0], c[1], z1), toThree(d[0], d[1], z1), [0, 1, 0], color);
}

/** Store banne : toile rayée inclinée au-dessus des vitrines, lambrequin sur le devant, dessous visible. */
export function awning(mb: MeshBuilder, f: Front, color: THREE.Color): void {
  const w = f.width + 0.3, depth = 1.35, drop = 0.75;
  const z0 = f.zTop + 0.08;
  const n = Math.max(2, Math.round(w / 0.45));
  const slope = drop / depth;
  const nl = Math.hypot(1, slope);
  const up: Vec3 = toThree((f.nx * slope) / nl, (f.ny * slope) / nl, 1 / nl);
  const down: Vec3 = [-up[0], -up[1], -up[2]];
  for (let i = 0; i < n; i++) {
    const s0 = -w / 2 + (w * i) / n, s1 = -w / 2 + (w * (i + 1)) / n;
    const col = i % 2 === 0 ? color : CREAM;
    const [ax, ay] = point(f, s0, 0.08), [bx, by] = point(f, s1, 0.08), [cx, cy] = point(f, s1, depth), [dx, dy] = point(f, s0, depth);
    const q: [Vec3, Vec3, Vec3, Vec3] = [toThree(ax, ay, z0), toThree(bx, by, z0), toThree(cx, cy, z0 - drop), toThree(dx, dy, z0 - drop)];
    mb.quad(...q, up, col);
    mb.quad(...q, down, col.clone().multiplyScalar(0.8));
    // Lambrequin.
    const nOut = toThree(f.nx, f.ny, 0);
    mb.quad(toThree(dx, dy, z0 - drop - 0.25), toThree(cx, cy, z0 - drop - 0.25), toThree(cx, cy, z0 - drop), toThree(dx, dy, z0 - drop), nOut, col);
    mb.quad(toThree(dx, dy, z0 - drop - 0.25), toThree(cx, cy, z0 - drop - 0.25), toThree(cx, cy, z0 - drop), toThree(dx, dy, z0 - drop), [-nOut[0], 0, -nOut[2]], col);
  }
}

const CROSS_BODY = C("#1d6a37"), CROSS_FACE = C("#3fd16f"), CROSS_IRON = C("#3a3a3a");

/**
 * Croix verte de pharmacie en drapeau (D159) : une croix grecque aux bras égaux de côté `size`, dans le plan perpendiculaire au mur, comme
 * l'enseigne lumineuse à diodes de la photo : corps vert sombre épais de 0,22 m, face vert vif encadrée de sombre, bras de fer vers le mur.
 * (cx, cy) : pied de la potence sur le mur ; (nx, ny) : normale sortante ; `zc` : altitude du centre. `face` reçoit en plus les
 * faces vives (maillage lumineux de la nuit), s'il y en a un.
 */
export function crossFlag(mb: MeshBuilder, cx: number, cy: number, nx: number, ny: number, zc: number, size: number, face?: MeshBuilder | null): void {
  const h = size / 2, arm = size * 0.165, off = size * 1.0, th = 0.11;
  const x = cx + nx * off, y = cy + ny * off;
  // Corps : deux barres.
  box(mb, x, y, nx, ny, arm, th, zc - h, zc + h, CROSS_BODY);
  box(mb, x, y, nx, ny, h, th, zc - arm, zc + arm, CROSS_BODY);
  // Faces vives, un peu plus épaisses que le corps : un cadre sombre reste visible autour.
  const f = 0.03, tf = th + 0.004;
  for (const target of face ? [mb, face] : [mb]) {
    box(target, x, y, nx, ny, arm - f, tf, zc - h + f, zc + h - f, CROSS_FACE);
    box(target, x, y, nx, ny, h - f, tf, zc - arm + f, zc + arm - f, CROSS_FACE);
  }
  // Potence : une barre de fer du mur à la croix.
  box(mb, cx + nx * (off - h) * 0.5, cy + ny * (off - h) * 0.5, nx, ny, Math.max(0.05, (off - h) * 0.5), 0.025, zc - 0.03, zc + 0.03, CROSS_IRON);
}

/** Croix verte de pharmacie en drapeau, à gauche de la devanture (D159 : 0,85 m, comme celle de la Grande Pharmacie Bonaparte sur photo). */
export function pharmacyCross(mb: MeshBuilder, f: Front): void {
  const [x, y] = point(f, -f.width / 2 - 0.45, 0);
  crossFlag(mb, x, y, f.nx, f.ny, f.zSign + 0.5, 0.85);
}

/** « Carotte » rouge du bureau de tabac : losange vertical en drapeau. */
export function tobaccoSign(mb: MeshBuilder, f: Front, color: THREE.Color = C("#d32f2f")): void {
  const red = color;
  const zc = f.zSign + 0.5;
  const [cx, cy] = point(f, -f.width / 2 - 0.45, 0.7);
  const P = (d: number, z: number, side: number): Vec3 => toThree(cx + f.nx * d + f.tx * side * 0.07, cy + f.ny * d + f.ty * side * 0.07, z);
  const top = 0.55, half = 0.24;
  for (const side of [-1, 1]) {
    const n: Vec3 = toThree(f.tx * side, f.ty * side, 0);
    mb.tri(P(0, zc + top, side), P(half, zc, side), P(-half, zc, side), n, red);
    mb.tri(P(0, zc - top, side), P(-half, zc, side), P(half, zc, side), n, red);
  }
  const edges: [number, number, number, number][] = [[0, top, half, 0], [half, 0, 0, -top], [0, -top, -half, 0], [-half, 0, 0, top]];
  for (const [d0, z0, d1, z1] of edges) {
    const n: Vec3 = toThree(f.nx * (z1 - z0), f.ny * (z1 - z0), -(d1 - d0));
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    mb.quad(P(d0, zc + z0, -1), P(d1, zc + z1, -1), P(d1, zc + z1, 1), P(d0, zc + z0, 1), [n[0] / l, n[1] / l, n[2] / l], red.clone().multiplyScalar(0.85));
  }
  const [bx, by] = point(f, -f.width / 2 - 0.45, 0.2);
  box(mb, bx, by, f.nx, f.ny, 0.25, 0.03, zc + 0.3, zc + 0.36, C("#3a3a3a"));
}

/** Terrasse : tables rondes, chaises et parasols devant la devanture, seulement sur trottoir ou place (`free`). */
export function terrace(mb: MeshBuilder, f: Front, terrain: HeightField, free: (x: number, y: number) => boolean, color: THREE.Color, depths: number[] = [1.9, 3.3], lift = 0, parasols = true): number {
  const metal = C("#3d4446"), top = C("#e8e2d4"), chair = C("#7a5a3a");
  let n = 0;
  for (const d of depths) {
    for (let s = -f.width / 2 + 0.6; s <= f.width / 2 - 0.4 && n < 8; s += 1.7) {
      const [x, y] = point(f, s, d);
      // Le trottoir doit continuer derrière la table (place pour passer) et entre la table et la façade.
      if (!free(x, y) || !free(...point(f, s, d + 1.1)) || !free(...point(f, s, 0.8))) continue;
      const z = terrain.heightAt(x, y) + 0.15 + lift;
      box(mb, x, y, f.tx, f.ty, 0.04, 0.04, z, z + 0.72, metal);
      box(mb, x, y, f.tx, f.ty, 0.33, 0.33, z + 0.72, z + 0.76, top);
      for (const side of [-1, 1]) {
        const [cx, cy] = [x + f.tx * side * 0.6, y + f.ty * side * 0.6];
        box(mb, cx, cy, f.tx, f.ty, 0.2, 0.2, z, z + 0.45, chair);
        const [bx, by] = [cx + f.tx * side * 0.18, cy + f.ty * side * 0.18];
        box(mb, bx, by, f.tx, f.ty, 0.03, 0.2, z + 0.45, z + 0.9, chair);
      }
      if (parasols && hash01(f.key, n) < 0.6) parasol(mb, x, y, z, n % 2 === 0 ? color : CREAM);
      n++;
    }
  }
  return n;
}

function parasol(mb: MeshBuilder, x: number, y: number, z: number, color: THREE.Color): void {
  box(mb, x, y, 1, 0, 0.03, 0.03, z + 0.76, z + 2.35, C("#d8d2c2"));
  const r = 1.05, seg = 8, apex: Vec3 = toThree(x, y, z + 2.5), zb = z + 2.1;
  for (let i = 0; i < seg; i++) {
    const a0 = (2 * Math.PI * i) / seg, a1 = (2 * Math.PI * (i + 1)) / seg;
    const p0: Vec3 = toThree(x + Math.cos(a0) * r, y + Math.sin(a0) * r, zb), p1: Vec3 = toThree(x + Math.cos(a1) * r, y + Math.sin(a1) * r, zb);
    const am = (a0 + a1) / 2;
    const col = i % 2 === 0 ? color : color.clone().multiplyScalar(0.88);
    mb.tri(p0, p1, apex, toThree(Math.cos(am) * 0.36, Math.sin(am) * 0.36, 0.93), col);
    mb.tri(p0, p1, apex, toThree(-Math.cos(am) * 0.36, -Math.sin(am) * 0.36, -0.93), col.clone().multiplyScalar(0.75));
  }
}

/**
 * Terrasse d'après photo (D157) : estrade de dalles claires (L'Augusto, photo 13) bordée de bacs ou de tonneaux plantés, ou terrasse fermée de panneaux gris
 * ajourés (Le Central, photo 14) ; tables, chaises et parasols de la couleur lue. Seulement sur sol libre (`free`) : si les coins de l'emprise n'y sont pas,
 * on retombe sur la terrasse générique.
 */
export function styledTerrace(mb: MeshBuilder, f: Front, terrain: HeightField, free: (x: number, y: number) => boolean, t: Terrace): boolean {
  const depth = t.depth ?? 2.6;
  // Les coins sont rentrés de 0,3 m : le contour du trottoir passe souvent au ras des bouts du mur (D178).
  const hw = Math.max(0.1, f.width / 2 - 0.3);
  // Seul le bord extérieur doit être libre : une bande de 1 m au pied de la façade n'est parfois pas classée trottoir (« walk ») dans les données.
  const corners: [number, number][] = [point(f, -hw, depth - 0.1), point(f, 0, depth - 0.1), point(f, hw, depth - 0.1)];
  if (!t.unchecked && !corners.every(([x, y]) => free(x, y))) return false;
  const mid = point(f, 0, depth / 2 + 0.2);
  const z0 = terrain.heightAt(mid[0], mid[1]) + 0.15;
  const lift = t.platform ? 0.1 : 0;
  if (t.platform) box(mb, mid[0], mid[1], f.tx, f.ty, f.width / 2, (depth - 0.4) / 2, z0 - 0.02, z0 + lift, C(t.platform));
  // Bord extérieur : tonneaux plantés ou panneau ajouré.
  const edge = depth - 0.15;
  if (t.planters === "barrel") {
    const n = Math.max(2, Math.round(f.width / 0.9));
    for (let i = 0; i < n; i++) {
      const [x, y] = point(f, -f.width / 2 + ((i + 0.5) * f.width) / n, edge);
      box(mb, x, y, f.tx, f.ty, 0.26, 0.26, z0 + lift, z0 + lift + 0.55, C("#6b4a2e"));
      box(mb, x, y, f.tx, f.ty, 0.22, 0.22, z0 + lift + 0.55, z0 + lift + 0.85, C(i % 2 ? "#4f8a4a" : "#6a9a46"));
    }
  } else if (t.screen) {
    const [x, y] = point(f, 0, edge);
    box(mb, x, y, f.tx, f.ty, f.width / 2, 0.04, z0, z0 + 1.1, C(t.screen));
    for (let i = 0; i <= 2; i++) {
      const [px, py] = point(f, -f.width / 2 + (f.width * i) / 2, edge);
      box(mb, px, py, f.tx, f.ty, 0.14, 0.14, z0, z0 + 1.35, shadeOf(C(t.screen), 0.8));
    }
  } else if (t.planters === "fence") {
    // Barrière de fer ajourée (montants tous les 1,4 m, lisses haute et basse, croisillons pleins) et quelques bacs gris plantés derrière (D178).
    const col = C(t.edge ?? "#2f4a3a"), n = Math.max(2, Math.round(f.width / 1.4));
    const [x, y] = point(f, 0, edge);
    box(mb, x, y, f.tx, f.ty, f.width / 2, 0.02, z0 + lift + 0.12, z0 + lift + 0.17, col);
    box(mb, x, y, f.tx, f.ty, f.width / 2, 0.02, z0 + lift + 0.9, z0 + lift + 0.95, col);
    for (let i = 0; i <= n; i++) {
      const [px, py] = point(f, -f.width / 2 + (f.width * i) / n, edge);
      box(mb, px, py, f.tx, f.ty, 0.03, 0.03, z0 + lift, z0 + lift + 1.0, col);
      if (i < n) {
        const [cx, cy] = point(f, -f.width / 2 + (f.width * (i + 0.5)) / n, edge);
        box(mb, cx, cy, f.tx, f.ty, 0.015, 0.015, z0 + lift + 0.17, z0 + lift + 0.9, shadeOf(col, 1.15));
      }
    }
    for (let i = 0; i < Math.floor(f.width / 3); i++) {
      const [px, py] = point(f, -f.width / 2 + 0.9 + i * 3, edge - 0.45);
      box(mb, px, py, f.tx, f.ty, 0.38, 0.22, z0 + lift, z0 + lift + 0.45, C("#6f7478"));
      box(mb, px, py, f.tx, f.ty, 0.3, 0.16, z0 + lift + 0.45, z0 + lift + 0.95, C(i % 2 ? "#4f8a4a" : "#6a9a46"));
    }
  } else if (t.planters === "boxes") {
    // Rangée de bacs sombres sur pieds, plantés d'arbustes (pyramides vertes) et de fleurs : devant la façade, au bord extérieur de l'emprise (D178).
    const col = C(t.edge ?? "#2b2f31"), n = Math.max(2, Math.round(f.width / 1.25));
    for (let i = 0; i < n; i++) {
      const [x, y] = point(f, -f.width / 2 + ((i + 0.5) * f.width) / n, edge);
      box(mb, x, y, f.tx, f.ty, 0.5, 0.2, z0 + lift + 0.4, z0 + lift + 0.7, col);
      box(mb, x, y, f.tx, f.ty, 0.02, 0.02, z0 + lift, z0 + lift + 0.4, col);
      box(mb, x, y, f.tx, f.ty, 0.46, 0.17, z0 + lift + 0.7, z0 + lift + 0.82, C(i % 3 === 0 ? "#c8505a" : i % 3 === 1 ? "#4f8a4a" : "#f0eadd"));
      if (i % 2 === 0) {
        box(mb, x, y, f.tx, f.ty, 0.22, 0.22, z0 + lift + 0.82, z0 + lift + 1.5, C("#48783f"));
        box(mb, x, y, f.tx, f.ty, 0.13, 0.13, z0 + lift + 1.5, z0 + lift + 1.9, C("#5d8c46"));
      }
    }
  }
  if (t.tables === false) return true;
  const parasol = C(t.parasol && t.parasol !== "none" ? t.parasol : "#8a2a2a");
  // Tables et chaises sur l'estrade, à 1,0 et 2,0 m de la façade.
  // Une seule rangée quand la terrasse est peu profonde (bacs au bord, D178).
  terrace(mb, { ...f, key: f.key + "|t" }, terrain, () => true, parasol, depth < 2 ? [depth - 0.75] : [0.95 + 0.3, depth - 0.8], lift, t.parasol !== "none");
  return true;
}

function shadeOf(c: THREE.Color, k: number): THREE.Color {
  return c.clone().multiplyScalar(k);
}

/** Ce qu'ajoute une devanture selon le commerce : store, terrasse, croix de pharmacie, carotte de tabac. */
export function shopfrontExtras(mb: MeshBuilder, f: Front, kind: string | null, color: THREE.Color, terrain: HeightField, free: (x: number, y: number) => boolean, terr?: Terrace | undefined): void {
  if (terr) {
    awning(mb, f, C(terr.awning ?? "#a8242c"));
    if (styledTerrace(mb, f, terrain, free, terr)) return;
  }
  if (kind === "pharmacy" || kind === "chemist") pharmacyCross(mb, f);
  else if (kind === "tobacco" || kind === "newsagent" || kind === "e-cigarette") tobaccoSign(mb, f);
  if ((kind && AWNING.has(kind)) || (kind !== "pharmacy" && hash01(f.key, 77) < 0.3)) awning(mb, f, color);
  if (kind && TERRACE.has(kind)) terrace(mb, f, terrain, free, color);
}
