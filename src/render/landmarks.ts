import * as THREE from "three";
import type { Building, BuildingKind, FacadeFiche, HeightField, Site, StoreModel, TileKinds } from "../data/types";
import { at, BOX_KINDS, frameOf, fuelLayout, PARAPET, type Frame } from "../core/landmarks";
import { hash01, MeshBuilder, toThree, UvMeshBuilder, type Vec3 } from "./geometry";
import { fillOnTerrain } from "./ground";
import { buildCathedral, buildCollege, buildNotreDame, buildFountain, buildSaintLazare, buildTownHall } from "./monuments";
import { buildChapel, buildGate } from "./gates";
import { buildHexagone } from "./hexagone";
import { buildVallon } from "./vallon";
import { buildVallonFacades } from "./vallon-facade";
import { buildGatePosts } from "./vallon-gate";
import { buildVallonProps } from "./vallon-props";
import { buildHouse } from "./house";
import { buildJanus } from "./janus";
import { buildRoundabout, buildRoundaboutGround } from "./roundabout";
import { buildBandstand, buildCurtain } from "./square";
import { buildStore, lidlCartShelter } from "./store";
import { buildTheatre } from "./theatre";
import type { SignAtlas } from "./sign-atlas";
import { idKey, pick, T } from "./style";

/** Où dessinent les gabarits : volumes (matière des murs), vitres allumées la nuit, lettres des enseignes. */
export interface LandmarkSinks {
  solid: MeshBuilder;
  glow: MeshBuilder;
  names: UvMeshBuilder;
  atlas: SignAtlas;
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);
const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

const CLADDING = ["#c9d3d1", "#e6e0d0", "#a9bcc0", "#d8cfb5", "#b7c3b0", "#e0d6c6"];
const STONE = C("#dccfb1");
const CONCRETE = C("#9d9a92");
const DARK = C("#33393b");
const GLASS_LO = (): THREE.Color => C(T.glass[0]);
const GLASS_HI = (): THREE.Color => C(T.glass[1]);
const WHITE = C("#f4efe4");
const FLAG = { blue: C("#1f3f8f"), white: C("#f4f1ea"), red: C("#d3313a"), eu: C("#1f3f9f") };
const STAINED: [string, string][] = [["#1f3f7f", "#c94a3a"], ["#2a4f8f", "#d9a03a"], ["#5a2f6f", "#2f6f8f"]];

/** Murs et toits des magasins d'après photo (D143, D144). */
const STORE_WALL: Record<StoreModel["style"], string> = { lidl: "#efede6", pharmacy: "#e9e6df", bricomarche: "#4a4e54", intermarche: "#34373c", but: "#ece9e2", jardinerie: "#e6dcc0", galerie: "#bd9254", gifi: "#9aa0a5", action: "#dad8d1", comptoir: "#d8d9d4", rotonde: "#f2f2ef", norauto: "#e8eaec" };
const STORE_ROOF: Record<StoreModel["style"], string> = { lidl: "#eeeeec", pharmacy: "#8d706c", bricomarche: "#c6cacc", intermarche: "#bcc0c2", but: "#cfd2d3", jardinerie: "#9aa5aa", galerie: "#b9bdbf", gifi: "#b9bec2", action: "#c6cacc", comptoir: "#c9cdcf", rotonde: "#c9cdcf", norauto: "#c9ced2" };

/** Couleur des murs d'un gabarit (null : celle de la fiche). */
export function landmarkWallColor(kind: BuildingKind | undefined, id: string): THREE.Color | null {
  if (!kind) return null;
  const key = idKey(id);
  switch (kind.k) {
    case "retail": return kind.store ? C(kind.store.wall ?? STORE_WALL[kind.store.style]) : C(kind.c ? "#ece6d8" : pick(CLADDING, key, 3));
    case "industrial": return C(pick(CLADDING, key, 1)).multiplyScalar(0.95 + key * 0.08);
    case "sports": return C("#ebe4d3");
    case "greenhouse": return C("#cfe3df");
    case "church": case "chapel": return STONE.clone().multiplyScalar(0.96 + key * 0.06);
    default: return null;
  }
}

/** Couleur des toits des gabarits « boîte » (null : celle de la fiche). */
export function landmarkRoofColor(kind: BuildingKind | undefined): THREE.Color | null {
  if (kind?.zinc) return C(kind.zinc);
  switch (kind?.k) {
    case "retail": return kind.store ? C(kind.store.roofc ?? STORE_ROOF[kind.store.style]) : C("#b8b2a6");
    case "industrial": case "sports": return C("#8fa3a8");
    case "greenhouse": return C("#d8ece8");
    case "canopy": return kind.style === "marquise" ? MARQUISE.clone() : C("#efebe3");
    default: return null;
  }
}

/** Le gabarit dessine-t-il ses propres murs (auvents : aucun) ? */
export function drawsWalls(kind: BuildingKind | undefined): boolean {
  // Pharmacie d'après photo (D143) : ses murs, dont la galerie en retrait, sont dessinés par le magasin.
  return kind?.k !== "canopy" && !kind?.store?.gallery;
}

/** La façade d'habitation (fiche) est-elle remplacée par le gabarit ? */
export function replacesFacade(kind: BuildingKind | undefined): boolean {
  return !!kind && (BOX_KINDS.has(kind.k) || kind.k === "church" || kind.k === "chapel" || kind.k === "hidden" || kind.k === "cart" || !!kind.hall || !!kind.college || !!kind.house || !!kind.hex || !!kind.vallon);
}

// --- Segments de mur ------------------------------------------------------------------------------------------------------------

/** Un côté droit du contour : origine, tangente, normale sortante, longueur, haut du mur. */
interface Seg {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  len: number;
  top: number;
  street: boolean;
  /** Sur le mur d'entrée de la fiche (D120). */
  front: boolean;
  /** Sur un autre mur de l'entrée (`frontWalls`), vitré au rez-de-chaussée. */
  glazed: boolean;
  /** Sur le mur de l'enseigne (`signWall`). */
  sign: boolean;
  /** Mur de l'enseigne : distance du début du mur au début de ce côté (pour `signAt`). */
  from: number;
}

function segments(b: Building, fiche: FacadeFiche | undefined): Seg[] {
  const n = b.ring.length / 2;
  const street = new Set<number>(), front = new Set<number>(), glazed = new Set<number>(), sign = new Map<number, number>();
  const more = new Set(fiche?.ground.frontWalls ?? []);
  fiche?.walls.forEach((w, wi) => {
    if (w.hole !== undefined || w.role !== "street") return;
    const count = (w.b - w.a + n) % n || n;
    for (let j = 0; j < count; j++) {
      street.add((w.a + j) % n);
      if (wi === fiche.ground.front) front.add((w.a + j) % n);
      if (more.has(wi)) glazed.add((w.a + j) % n);
      if (wi === fiche.ground.signWall) {
        // Longueur du mur avant ce côté.
        let from = 0;
        for (let q = 0; q < j; q++) {
          const i0 = (w.a + q) % n, i1 = (i0 + 1) % n;
          from += Math.hypot(b.ring[2 * i1]! - b.ring[2 * i0]!, b.ring[2 * i1 + 1]! - b.ring[2 * i0 + 1]!);
        }
        sign.set((w.a + j) % n, from);
      }
    }
  });
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = b.ring[2 * i]!, y1 = b.ring[2 * i + 1]!, x2 = b.ring[2 * j]!, y2 = b.ring[2 * j + 1]!;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.5) continue;
    const tx = (x2 - x1) / len, ty = (y2 - y1) / len;
    out.push({ x: x1, y: y1, tx, ty, nx: ty, ny: -tx, len, top: Math.min(b.top[i]!, b.top[j]!), street: street.has(i), front: front.has(i), glazed: glazed.has(i), sign: sign.has(i), from: sign.get(i) ?? 0 });
  }
  return out;
}

/** Le mur d'entrée : le plus long côté du mur d'entrée de la fiche (D120), sinon le plus long côté sur rue, sinon le plus long côté. */
function mainSeg(segs: Seg[]): Seg | null {
  const rank = (s: Seg): number => (s.front ? 2 : s.street ? 1 : 0);
  let best: Seg | null = null;
  for (const s of segs) if (!best || rank(s) > rank(best) || (rank(s) === rank(best) && s.len > best.len)) best = s;
  return best;
}

/** Point du mur à l'abscisse `s`, décalé de `off` vers l'extérieur. */
function onSeg(g: Seg, s: number, off = 0): [number, number] {
  return [g.x + g.tx * s + g.nx * off, g.y + g.ty * s + g.ny * off];
}

/** Rectangle plaqué sur le mur, de s0 à s1 et de z0 à z1 (altitudes absolues), à `off` du mur. */
function plate(mb: MeshBuilder, g: Seg, s0: number, s1: number, z0: number, z1: number, off: number, lo: THREE.Color, hi: THREE.Color = lo): void {
  const [ax, ay] = onSeg(g, s0, off), [bx, by] = onSeg(g, s1, off);
  const n = toThree(g.nx, g.ny, 0);
  if (lo === hi) mb.quad(toThree(ax, ay, z0), toThree(bx, by, z0), toThree(bx, by, z1), toThree(ax, ay, z1), n, lo);
  else mb.quadGradient(toThree(ax, ay, z0), toThree(bx, by, z0), toThree(bx, by, z1), toThree(ax, ay, z1), n, lo, hi);
}

/** Pavé droit : base rectangulaire (centre, axe u, demi-côtés) de z0 à z1, cinq faces. */
function block(mb: MeshBuilder, cx: number, cy: number, ux: number, uy: number, hl: number, hw: number, z0: number, z1: number, color: THREE.Color, top: THREE.Color = color): void {
  const vx = -uy, vy = ux;
  const p = (s: number, t: number): [number, number] => [cx + ux * s + vx * t, cy + uy * s + vy * t];
  const pts = [p(-hl, -hw), p(hl, -hw), p(hl, hw), p(-hl, hw)];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % 4]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    mb.quad(toThree(ax, ay, z0), toThree(bx, by, z0), toThree(bx, by, z1), toThree(ax, ay, z1), toThree((by - ay) / len, -(bx - ax) / len, 0), color);
  }
  const [a, b, c, d] = pts as [[number, number], [number, number], [number, number], [number, number]];
  mb.quad(toThree(a[0], a[1], z1), toThree(b[0], b[1], z1), toThree(c[0], c[1], z1), toThree(d[0], d[1], z1), [0, 1, 0], top);
}

/** Dessous horizontal d'un rectangle (auvents), visible d'en bas. */
function soffit(mb: MeshBuilder, pts: [number, number][], z: number, color: THREE.Color): void {
  for (let i = 1; i + 1 < pts.length; i++) mb.tri(toThree(pts[0]![0], pts[0]![1], z), toThree(pts[i]![0], pts[i]![1], z), toThree(pts[i + 1]![0], pts[i + 1]![1], z), [0, -1, 0], color);
}

/** Texte de l'atlas posé à plat sur le mur, centré en s, bas à z, de hauteur h (largeur = 6,4 h, rapport d'une case de l'atlas). */
function text(sinks: LandmarkSinks, g: Seg, s: number, z: number, h: number, off: number, label: string, color: string): void {
  const w = h * 6.4;
  const r = sinks.atlas.get(label, color);
  const [ax, ay] = onSeg(g, s - w / 2, off), [bx, by] = onSeg(g, s + w / 2, off);
  sinks.names.quad(toThree(ax, ay, z), toThree(bx, by, z), toThree(bx, by, z + h), toThree(ax, ay, z + h), toThree(g.nx, g.ny, 0),
    [r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1], WHITE);
}

/** Panneau d'enseigne avec son texte : largeur bornée par le mur, lettres aussi grandes que la case le permet. */
function signboard(sinks: LandmarkSinks, g: Seg, s: number, z: number, h: number, maxW: number, label: string, panel: THREE.Color, letters: string): void {
  // Le texte est centré dans sa case (6,4 fois plus large que haute) : le panneau suit la longueur estimée du texte.
  const textH = Math.min(h * 0.72, (maxW - 0.3) / Math.min(6.4, 0.62 * label.length + 0.4));
  const w = Math.min(maxW, textH * Math.min(6.4, 0.62 * label.length) + 0.6);
  plate(sinks.solid, g, s - w / 2, s + w / 2, z, z + h, 0.06, panel);
  text(sinks, g, s, z + (h - textH) / 2, textH, 0.08, label, letters);
}

/** Vitre (dégradé bleuté) ; une part s'allume la nuit. */
function glazing(sinks: LandmarkSinks, g: Seg, s0: number, s1: number, z0: number, z1: number, off: number, lit: number): void {
  plate(sinks.solid, g, s0, s1, z0, z1, off, GLASS_LO(), GLASS_HI());
  if (hash01(`${g.x.toFixed(1)},${g.y.toFixed(1)},${s0.toFixed(1)}`) < lit) {
    plate(sinks.glow, g, s0, s1, z0, z1, off + 0.006, C("#ffb04a"), C("#fff0b0"));
  }
}

/** Arc en plein cintre : demi-disque posé sur le mur (base en z, centre en s, rayon r). */
function arch(mb: MeshBuilder, g: Seg, s: number, z: number, r: number, off: number, color: THREE.Color, seg = 6): void {
  const n = toThree(g.nx, g.ny, 0);
  const p = (a: number): Vec3 => {
    const [x, y] = onSeg(g, s + Math.cos(a) * r, off);
    return toThree(x, y, z + Math.sin(a) * r);
  };
  const [cx, cy] = onSeg(g, s, off);
  for (let i = 0; i < seg; i++) mb.tri(toThree(cx, cy, z), p((Math.PI * i) / seg), p((Math.PI * (i + 1)) / seg), n, color);
}

/** Disque posé sur le mur (horloge, rosace). */
function roundel(mb: MeshBuilder, g: Seg, s: number, z: number, r: number, off: number, color: THREE.Color, seg = 12): void {
  const n = toThree(g.nx, g.ny, 0);
  const [cx, cy] = onSeg(g, s, off);
  for (let i = 0; i < seg; i++) {
    const a0 = (2 * Math.PI * i) / seg, a1 = (2 * Math.PI * (i + 1)) / seg;
    const [x0, y0] = onSeg(g, s + Math.cos(a0) * r, off), [x1, y1] = onSeg(g, s + Math.cos(a1) * r, off);
    mb.tri(toThree(cx, cy, z), toThree(x0, y0, z + Math.sin(a0) * r), toThree(x1, y1, z + Math.sin(a1) * r), n, color);
  }
}

// --- Gabarits « boîte » -----------------------------------------------------------------------------------------------------------

function plinth(sinks: LandmarkSinks, segs: Seg[], terrain: HeightField, h: number, color: THREE.Color): void {
  for (const g of segs) {
    const steps = Math.max(1, Math.ceil(g.len / 6));
    for (let i = 0; i < steps; i++) {
      const s0 = (g.len * i) / steps, s1 = (g.len * (i + 1)) / steps;
      const [x, y] = onSeg(g, (s0 + s1) / 2);
      const z = terrain.heightAt(x, y);
      plate(sinks.solid, g, s0, s1, z - 0.3, z + h, 0.03, color);
    }
  }
}

/** Bande en haut des murs (acrotère ou bandeau), sur tout le tour. */
function topBand(sinks: LandmarkSinks, segs: Seg[], h: number, color: THREE.Color): void {
  for (const g of segs) plate(sinks.solid, g, 0, g.len, g.top - h, g.top + 0.02, 0.04, color);
}

/** Nervures verticales du bardage, peu contrastées. */
function ribs(sinks: LandmarkSinks, segs: Seg[], terrain: HeightField, wall: THREE.Color, step: number): void {
  const rib = shade(wall, 0.9);
  for (const g of segs) {
    if (g.len < 3) continue;
    for (let s = step; s < g.len - 0.3; s += step) {
      const [x, y] = onSeg(g, s);
      plate(sinks.solid, g, s - 0.06, s + 0.06, terrain.heightAt(x, y) + 0.5, g.top - 0.05, 0.02, rib);
    }
  }
}

/** Options d'une grande surface venues de la fiche (corrections à la main d'après photo, D120 et D122). */
interface RetailOptions {
  signAt?: number;
  signZ?: number;
}

function retail(sinks: LandmarkSinks, b: Building, kind: BuildingKind, segs: Seg[], terrain: HeightField, wall: THREE.Color, opts: RetailOptions = {}): void {
  const accent = C(kind.c ?? pick(T.shops, idKey(b.id), 7));
  plinth(sinks, segs, terrain, 0.5, CONCRETE);
  topBand(sinks, segs, PARAPET + 0.25, accent.clone().lerp(wall, 0.25));
  // Acrotère vu de l'intérieur (depuis les toits voisins ou d'en haut).
  for (const g of segs) {
    const [ax, ay] = onSeg(g, 0, -0.25), [bx, by] = onSeg(g, g.len, -0.25);
    sinks.solid.quad(toThree(ax, ay, b.eave), toThree(bx, by, b.eave), toThree(bx, by, g.top), toThree(ax, ay, g.top), toThree(-g.nx, -g.ny, 0), shade(wall, 0.85));
  }
  const g = mainSeg(segs);
  if (!g || g.len < 6) return;
  const mid = g.len / 2;
  const [mx, my] = onSeg(g, mid);
  const z0 = terrain.heightAt(mx, my);
  let za = z0 + 3.5;
  if (segs.some((s) => s.glazed)) {
    // Bloc d'entrée d'après photo : sas et murs vitrés sous une marquise continue.
    za = entranceBlock(sinks, g, segs.filter((s) => s.glazed || s === g), z0);
  } else {
    const w = Math.min(14, g.len * 0.45);
    // Entrée vitrée, montants sombres.
    glazing(sinks, g, mid - w / 2, mid + w / 2, z0 + 0.05, z0 + 3.0, 0.05, 1);
    for (let s = mid - w / 2; s <= mid + w / 2 + 1e-6; s += w / Math.max(2, Math.round(w / 2.2))) plate(sinks.solid, g, s - 0.06, s + 0.06, z0, z0 + 3.05, 0.08, DARK);
    // Auvent : dalle en saillie sur deux poteaux, bandeau à la couleur de l'enseigne.
    const aw = w + 2, depth = 2.8;
    const p0 = onSeg(g, mid - aw / 2), p1 = onSeg(g, mid + aw / 2), p2 = onSeg(g, mid + aw / 2, depth), p3 = onSeg(g, mid - aw / 2, depth);
    const n = toThree(g.nx, g.ny, 0);
    sinks.solid.quad(toThree(p0[0], p0[1], za + 0.45), toThree(p1[0], p1[1], za + 0.45), toThree(p2[0], p2[1], za + 0.45), toThree(p3[0], p3[1], za + 0.45), [0, 1, 0], WHITE);
    soffit(sinks.solid, [p0, p1, p2, p3], za, WHITE);
    sinks.solid.quad(toThree(p3[0], p3[1], za), toThree(p2[0], p2[1], za), toThree(p2[0], p2[1], za + 0.45), toThree(p3[0], p3[1], za + 0.45), n, accent);
    for (const [q, t] of [[p0, p3], [p1, p2]] as const) {
      const len = Math.hypot(t[0] - q[0], t[1] - q[1]) || 1;
      sinks.solid.quad(toThree(q[0], q[1], za), toThree(t[0], t[1], za), toThree(t[0], t[1], za + 0.45), toThree(q[0], q[1], za + 0.45), toThree((t[1] - q[1]) / len, -(t[0] - q[0]) / len, 0), accent);
    }
    for (const s of [mid - aw / 2 + 0.3, mid + aw / 2 - 0.3]) {
      const [x, y] = onSeg(g, s, depth - 0.3);
      block(sinks.solid, x, y, g.tx, g.ty, 0.1, 0.1, terrain.heightAt(x, y), za, DARK);
    }
  }
  if (!kind.n) return;
  // Sur le mur de l'enseigne s'il est donné, sinon sur le plus grand mur de l'entrée (un sas étroit entre des murs vitrés).
  const marked = segs.filter((s) => s.sign && s.len >= 2);
  // Position donnée le long du mur de l'enseigne : le côté qui la contient, enseigne de 9 m au plus ; sinon au milieu du plus grand côté.
  const signAt = opts.signAt;
  const at = signAt === undefined ? undefined : marked.find((s) => signAt >= s.from && signAt <= s.from + s.len);
  const sg = at ?? (marked.length > 0 ? marked.reduce((a, b) => (b.len > a.len ? b : a)) : segs.reduce((best, s) => (s.glazed && s.len > best.len ? s : best), g));
  const sMid = at ? Math.min(Math.max(signAt! - at.from, 1), at.len - 1) : sg.len / 2;
  const sw = at ? Math.min(9, at.len * 0.7, 2 * Math.min(sMid, at.len - sMid)) : sg.len * 0.7;
  const [sx, sy] = onSeg(sg, sMid);
  const zs = terrain.heightAt(sx, sy);
  if (opts.signZ !== undefined) {
    // Enseigne basse d'après photo : lettres à la couleur de l'enseigne sur un panneau blanc, posé à signZ mètres du sol.
    signboard(sinks, sg, sMid, zs + opts.signZ, 1.4, Math.min(sw, 6.5), kind.n, C("#f6f4ee"), kind.c ?? "#1d5fa6");
    return;
  }
  const h = Math.min(3.0, Math.max(1.4, (sg.top - zs) * 0.36));
  signboard(sinks, sg, sMid, Math.max(za + 0.9, sg.top - h - 0.1), h, sw, kind.n, kind.c ? C(kind.c) : accent, kind.tc ?? "#ffffff");
}

const STEEL_LIGHT = C("#b9bec0");
const MARQUISE = C("#3d4448");
const MARQUISE_UNDER = C("#d9dcdc");

/**
 * Bloc d'entrée vitré d'une grande surface (d'après photo, E.Leclerc, D122) : vitrage sur 3,85 m (dessous de la marquise du mur voisin) avec traverse et montants anthracite sur
 * chaque mur de l'entrée, marquise anthracite continue dont le bord avant est aligné malgré les décrochements, poteaux fins, bandeau
 * anthracite au-dessus, pyramide vitrée sur le sas (`sas`, le mur d'entrée), potelets inox au bord du trottoir. Rend la hauteur du
 * dessous de la marquise.
 */
function entranceBlock(sinks: LandmarkSinks, sas: Seg, walls: Seg[], z0: number): number {
  const mb = sinks.solid;
  const zc = z0 + 3.85, thick = 0.45, depth = 3.2;
  // Les murs de l'entrée sont parallèles au sas : distance de chacun, le long de la normale, au plan du sas.
  const off = (s: Seg): number => (s.x - sas.x) * sas.nx + (s.y - sas.y) * sas.ny;
  const outer = Math.max(...walls.map(off)) + depth;
  for (const s of walls) {
    const d = outer - off(s);
    // Vitrage, traverse, montants.
    glazing(sinks, s, 0.15, s.len - 0.15, z0 + 0.05, zc, 0.05, 1);
    plate(mb, s, 0.15, s.len - 0.15, z0 + 2.45, z0 + 2.55, 0.08, DARK);
    const bays = Math.max(1, Math.round((s.len - 0.3) / 1.8));
    for (let i = 0; i <= bays; i++) {
      const t = 0.15 + ((s.len - 0.3) * i) / bays;
      plate(mb, s, t - 0.05, t + 0.05, z0, zc, 0.08, DARK);
    }
    // Bandeau anthracite au-dessus de la marquise.
    plate(mb, s, 0, s.len, zc + thick, zc + thick + 1.3, 0.04, MARQUISE);
    // Marquise : dessus, dessous, tranche avant, poteaux tous les 6 m au plus au bord avant.
    const p0 = onSeg(s, 0), p1 = onSeg(s, s.len), p2 = onSeg(s, s.len, d), p3 = onSeg(s, 0, d);
    mb.quad(toThree(p0[0], p0[1], zc + thick), toThree(p1[0], p1[1], zc + thick), toThree(p2[0], p2[1], zc + thick), toThree(p3[0], p3[1], zc + thick), [0, 1, 0], MARQUISE);
    soffit(mb, [p0, p1, p2, p3], zc, MARQUISE_UNDER);
    mb.quad(toThree(p3[0], p3[1], zc), toThree(p2[0], p2[1], zc), toThree(p2[0], p2[1], zc + thick), toThree(p3[0], p3[1], zc + thick), toThree(s.nx, s.ny, 0), MARQUISE);
    const posts = Math.max(1, Math.ceil(s.len / 6));
    for (let i = 0; i <= posts; i++) {
      const [x, y] = onSeg(s, Math.min(Math.max((s.len * i) / posts, 0.2), s.len - 0.2), d - 0.25);
      block(mb, x, y, s.tx, s.ty, 0.08, 0.08, z0 - 0.1, zc, MARQUISE);
    }
    // Potelets inox au bord du trottoir, tous les 1,8 m.
    for (let t = 0.9; t < s.len; t += 1.8) {
      const [x, y] = onSeg(s, t, d + 0.6);
      block(mb, x, y, s.tx, s.ty, 0.07, 0.07, z0 - 0.1, z0 + 0.9, STEEL_LIGHT);
    }
  }
  // Pyramide vitrée sur le sas, au-dessus de la marquise ; sa moitié arrière entre dans le mur.
  const d = outer - off(sas);
  const zb = zc + thick, apex = 4.6;
  const c = [onSeg(sas, 0.2, -1.2), onSeg(sas, sas.len - 0.2, -1.2), onSeg(sas, sas.len - 0.2, d), onSeg(sas, 0.2, d)];
  const [tx, ty] = onSeg(sas, sas.len / 2, (d - 1.2) / 2);
  const top: Vec3 = toThree(tx, ty, zb + apex);
  // Verre clair à armature grise (photo), pas le bleu-vert des vitrines.
  const glass = [C("#cfdcdf"), C("#a9bcc1")];
  for (let i = 0; i < 4; i++) {
    const a = c[i]!, bb = c[(i + 1) % 4]!;
    const ex = bb[0] - a[0], ey = bb[1] - a[1];
    const el = Math.hypot(ex, ey) || 1;
    // Normale vers l'extérieur de la pyramide : du côté opposé à son centre.
    let nx = ey / el, ny = -ex / el;
    if ((tx - a[0]) * nx + (ty - a[1]) * ny > 0) [nx, ny] = [-nx, -ny];
    const nrm = new THREE.Vector3(nx, 0.6, -ny).normalize();
    const A = new THREE.Vector3(...toThree(a[0], a[1], zb)), B = new THREE.Vector3(...toThree(bb[0], bb[1], zb)), T = new THREE.Vector3(...top);
    // Face avant dans le sens trigonométrique vue de l'extérieur (matériau à une face).
    const front = B.clone().sub(A).cross(T.clone().sub(A)).dot(nrm) > 0;
    if (front) mb.tri(A.toArray(), B.toArray(), top, [nrm.x, nrm.y, nrm.z], glass[i % 2]!);
    else mb.tri(B.toArray(), A.toArray(), top, [nrm.x, nrm.y, nrm.z], glass[i % 2]!);
  }
  return zc;
}

function industrial(sinks: LandmarkSinks, b: Building, segs: Seg[], terrain: HeightField, wall: THREE.Color): void {
  plinth(sinks, segs, terrain, 0.6, CONCRETE);
  ribs(sinks, segs, terrain, wall, 1.2);
  topBand(sinks, segs, 0.35, shade(wall, 0.8));
  const g = mainSeg(segs);
  if (!g) return;
  const h = g.top - terrain.heightAt(...onSeg(g, g.len / 2));
  // Portes sectionnelles : une ou deux selon la longueur du mur.
  const doors = g.len > 16 ? [g.len / 3, (2 * g.len) / 3] : g.len > 6 ? [g.len / 2] : [];
  const door = shade(C("#9aa3a6"), 0.95 + hash01(b.id, 3) * 0.1);
  for (const s of doors) {
    const [x, y] = onSeg(g, s);
    const z = terrain.heightAt(x, y);
    const dh = Math.min(4.5, h - 0.9);
    if (dh < 2.4) continue;
    plate(sinks.solid, g, s - 2, s + 2, z, z + dh, 0.06, shade(door, 0.85), door);
    for (let k = 1; k < 5; k++) plate(sinks.solid, g, s - 2, s + 2, z + (dh * k) / 5 - 0.03, z + (dh * k) / 5 + 0.03, 0.07, shade(door, 0.7));
    plate(sinks.solid, g, s + 2.6, s + 3.5, z, z + 2.1, 0.06, DARK);
  }
  // Bandeau de jour en haut des longs murs.
  if (h > 5) for (const s of segs) if (s.len > 12) glazing(sinks, s, s.len * 0.15, s.len * 0.85, s.top - 1.6, s.top - 0.9, 0.05, 0.25);
}

function sportsHall(sinks: LandmarkSinks, kind: BuildingKind, segs: Seg[], terrain: HeightField): void {
  plinth(sinks, segs, terrain, 0.8, C("#c6b9a0"));
  const band = C("#dce9ec");
  for (const g of segs) if (g.len > 8 && g.top - terrain.heightAt(...onSeg(g, g.len / 2)) > 5) plate(sinks.solid, g, 0.4, g.len - 0.4, g.top - 2.4, g.top - 0.5, 0.05, shade(band, 0.92), band);
  const g = mainSeg(segs);
  if (!g || g.len < 5) return;
  const mid = g.len / 2;
  const z = terrain.heightAt(...onSeg(g, mid));
  glazing(sinks, g, mid - 2, mid + 2, z + 0.05, z + 2.6, 0.06, 0.8);
  plate(sinks.solid, g, mid - 2.15, mid + 2.15, z + 2.6, z + 2.8, 0.07, DARK);
  if (kind.n && kind.main) signboard(sinks, g, mid, z + 3.1, 0.8, Math.min(g.len * 0.8, 8), kind.n, C(T.shops[1] ?? "#1f4a63"), "#ffffff");
}

function annex(sinks: LandmarkSinks, b: Building, segs: Seg[], terrain: HeightField): void {
  const g = mainSeg(segs);
  if (!g || g.len < 2.9) return;
  const mid = g.len / 2;
  const z = terrain.heightAt(...onSeg(g, mid));
  if (g.top - z < 2.5) return;
  const door = pick(["#9aa0a2", "#7a5a3a", "#b9b2a2", "#5b6b5a"], idKey(b.id), 2);
  const c = C(door);
  plate(sinks.solid, g, mid - 1.2, mid + 1.2, z, z + 2.1, 0.05, shade(c, 0.8), c);
  for (let k = 1; k < 4; k++) plate(sinks.solid, g, mid - 1.2, mid + 1.2, z + 0.52 * k - 0.02, z + 0.52 * k + 0.02, 0.06, shade(c, 0.7));
}

function greenhouse(sinks: LandmarkSinks, segs: Seg[], terrain: HeightField): void {
  const frame = C("#f2f2ee");
  for (const g of segs) {
    for (let s = 0; s <= g.len + 1e-6; s += Math.max(1, g.len / Math.max(1, Math.round(g.len / 1.5)))) {
      const z = terrain.heightAt(...onSeg(g, s));
      plate(sinks.solid, g, s - 0.04, s + 0.04, z, g.top, 0.03, frame);
    }
  }
}

function canopy(sinks: LandmarkSinks, b: Building, color: string, terrain: HeightField, site: Extract<Site, { t: "fuel" }> | undefined): void {
  // Le dessus vient des pans (toit plat) ; ici la tranche, le dessous et les poteaux.
  const accent = C(color);
  const z1 = b.eave, z0 = b.eave - 0.8;
  const pts: [number, number][] = [];
  for (let i = 0; i < b.ring.length; i += 2) pts.push([b.ring[i]!, b.ring[i + 1]!]);
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const n = toThree((y2 - y1) / len, -(x2 - x1) / len, 0);
    sinks.solid.quad(toThree(x1, y1, z0), toThree(x2, y2, z0), toThree(x2, y2, z1), toThree(x1, y1, z1), n, WHITE);
    sinks.solid.quad(toThree(x1, y1, z0 + 0.15), toThree(x2, y2, z0 + 0.15), toThree(x2, y2, z0 + 0.4), toThree(x1, y1, z0 + 0.4), n, accent);
  }
  // Dessous : triangulation du contour.
  const shape = pts.map(([x, y]) => new THREE.Vector2(x, y));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(shape, [])) {
    const a = pts[i!]!, bb = pts[j!]!, c = pts[k!]!;
    sinks.solid.tri(toThree(a[0], a[1], z0), toThree(bb[0], bb[1], z0), toThree(c[0], c[1], z0), [0, -1, 0], C("#fbf7ee"));
  }
  if (!site) for (const [x, y] of pts) block(sinks.solid, x, y, 1, 0, 0.12, 0.12, terrain.heightAt(x, y), z0, C("#d8d8d2"));
}

// --- Abris à chariots (D121) ----------------------------------------------------------------------------------------------------

const STEEL = C("#3a4043");
const SHELTER_ROOF = C("#c3cdd0");
const HAZARD = [C("#f2c230"), C("#222222")];
const TROLLEY = C("#2a4a9a");

/**
 * Abri à chariots d'après photo (E.Leclerc) : cadre d'acier anthracite (poteaux, lisses haute et basse), toit plat clair, un petit côté
 * ouvert avec bandeau jaune et noir, une rangée de chariots bleus emboîtés. Pas de vitres pleines : le verre clair laisse voir les chariots.
 */
function cartShelter(mb: MeshBuilder, b: Building, kind: BuildingKind, terrain: HeightField): void {
  // Rectangle orienté : le plus long côté du contour donne l'axe, l'étendue des sommets les dimensions.
  const n = b.ring.length / 2;
  let ux = 1, uy = 0, best = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = b.ring[2 * j]! - b.ring[2 * i]!, dy = b.ring[2 * j + 1]! - b.ring[2 * i + 1]!;
    const l = Math.hypot(dx, dy);
    if (l > best) [best, ux, uy] = [l, dx / l, dy / l];
  }
  const vx = -uy, vy = ux;
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = b.ring[2 * i]!, y = b.ring[2 * i + 1]!;
    const s = x * ux + y * uy, t = x * vx + y * vy;
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
  const cx = ux * sm + vx * tm, cy = uy * sm + vy * tm;
  const hl = (s1 - s0) / 2, hw = (t1 - t0) / 2;
  // Le côté ouvert est vers `open` : on retourne l'axe pour qu'il soit en +hl.
  if (kind.open && kind.open[0] * ux + kind.open[1] * uy < sm) [ux, uy] = [-ux, -uy];
  const vx2 = -uy, vy2 = ux;
  const at = (s: number, t: number): [number, number] => [cx + ux * s + vx2 * t, cy + uy * s + vy2 * t];
  const z = terrain.heightAt(cx, cy), H = 2.3;
  const post = (s: number, t: number): void => {
    const [x, y] = at(s, t);
    block(mb, x, y, ux, uy, 0.05, 0.05, terrain.heightAt(x, y) - 0.1, z + H, STEEL);
  };
  // Poteaux aux coins et tous les 2,8 m au plus le long des grands côtés.
  const bays = Math.max(1, Math.round((2 * hl) / 2.8));
  for (let i = 0; i <= bays; i++) for (const t of [-hw, hw]) post(-hl + (2 * hl * i) / bays, t);
  // Lisses hautes tout autour, lisses basses sur les côtés fermés (grands côtés et fond).
  for (const t of [-hw, hw]) {
    const [x, y] = at(0, t);
    block(mb, x, y, ux, uy, hl, 0.04, z + H - 0.14, z + H, STEEL);
    block(mb, x, y, ux, uy, hl, 0.03, z + 0.25, z + 0.33, STEEL);
    block(mb, x, y, ux, uy, hl, 0.02, z + 1.1, z + 1.15, STEEL);
  }
  const [bx, by] = at(-hl, 0);
  block(mb, bx, by, vx2, vy2, hw, 0.04, z + H - 0.14, z + H, STEEL);
  block(mb, bx, by, vx2, vy2, hw, 0.03, z + 0.25, z + 0.33, STEEL);
  // Bandeau jaune et noir au-dessus du côté ouvert.
  const stripes = Math.max(4, Math.round((2 * hw) / 0.3));
  for (let i = 0; i < stripes; i++) {
    const [x, y] = at(hl + 0.03, -hw + (2 * hw * (i + 0.5)) / stripes);
    block(mb, x, y, vx2, vy2, hw / stripes, 0.03, z + H - 0.3, z + H - 0.06, HAZARD[i % 2]!);
  }
  // Toit plat, débordant de 10 cm.
  const [rx, ry] = at(0, 0);
  block(mb, rx, ry, ux, uy, hl + 0.1, hw + 0.1, z + H, z + H + 0.06, SHELTER_ROOF);
  // Chariots emboîtés depuis le fond, sur les deux tiers de la longueur.
  const count = Math.floor((2 * hl * 0.66 - 0.9) / 0.32) + 1;
  for (let i = 0; i < count; i++) {
    const [x, y] = at(-hl + 0.55 + i * 0.32, 0);
    const zz = terrain.heightAt(x, y);
    block(mb, x, y, ux, uy, 0.45, 0.27, zz + 0.38, zz + 0.95, TROLLEY);
    const [hx, hy] = at(-hl + 0.55 + i * 0.32 + 0.5, 0);
    block(mb, hx, hy, ux, uy, 0.03, 0.27, zz + 0.95, zz + 1.0, C("#c9302c"));
  }
}

/**
 * Marquise le long d'une façade (d'après photo, l'entrée d'E.Leclerc, D122) : dalle anthracite de 45 cm (le dessus vient des pans),
 * dessous clair, poteaux fins tous les 6 m au plus sur les grands côtés.
 */
function marquise(mb: MeshBuilder, b: Building, terrain: HeightField): void {
  const z1 = b.eave, z0 = b.eave - 0.45;
  const pts: [number, number][] = [];
  for (let i = 0; i < b.ring.length; i += 2) pts.push([b.ring[i]!, b.ring[i + 1]!]);
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    mb.quad(toThree(x1, y1, z0), toThree(x2, y2, z0), toThree(x2, y2, z1), toThree(x1, y1, z1), toThree(uy, -ux, 0), MARQUISE);
    if (len < 6) continue;
    const posts = Math.ceil(len / 6);
    for (let k = 0; k <= posts; k++) {
      // Un peu en retrait du bord, pour que le poteau soit sous la dalle.
      const s = Math.min(Math.max((len * k) / posts, 0.3), len - 0.3);
      const x = x1 + ux * s - uy * 0.25, y = y1 + uy * s + ux * 0.25;
      block(mb, x, y, ux, uy, 0.08, 0.08, terrain.heightAt(x, y) - 0.1, z0, MARQUISE);
    }
  }
  const shape = pts.map(([x, y]) => new THREE.Vector2(x, y));
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(shape, [])) {
    const a = pts[i!]!, bb = pts[j!]!, c = pts[k!]!;
    mb.tri(toThree(a[0], a[1], z0), toThree(bb[0], bb[1], z0), toThree(c[0], c[1], z0), [0, -1, 0], MARQUISE_UNDER);
  }
}

// --- Services publics : inscription, drapeaux, horloge ------------------------------------------------------------------------------

/**
 * Mât incliné vers l'extérieur et de biais (`side` : vers la gauche ou la droite de la façade), drapeau tricolore (bleu côté mât) ou
 * européen pendu dessous : le biais le rend lisible de face comme de profil. Visible des deux côtés.
 */
function flag(mb: MeshBuilder, g: Seg, s: number, z: number, side: number, eu: boolean): void {
  const [bx, by] = onSeg(g, s, 0.05);
  // Direction horizontale du mât : moitié vers la rue, moitié le long du mur.
  const dx = g.nx * 0.7 + g.tx * side * 0.7, dy = g.ny * 0.7 + g.ty * side * 0.7;
  const L = 2.4;
  const tip: [number, number, number] = [bx + dx * L * 0.7, by + dy * L * 0.7, z + L * 0.7];
  const thick = 0.03;
  const px = -dy, py = dx;
  const q = (x: number, y: number, zz: number): Vec3 => toThree(x, y, zz);
  const pole = C("#e8e2d0");
  for (const k of [1, -1]) {
    mb.quad(q(bx - px * thick, by - py * thick, z), q(bx + px * thick, by + py * thick, z), q(tip[0] + px * thick, tip[1] + py * thick, tip[2]),
      q(tip[0] - px * thick, tip[1] - py * thick, tip[2]), toThree(-dx * 0.7 * k, -dy * 0.7 * k, 0.7 * k), pole);
  }
  const fw = 1.25, fh = 0.85;
  const stripes: [number, number, THREE.Color][] = eu ? [[0, 1, FLAG.eu]] : [[0, 1 / 3, FLAG.blue], [1 / 3, 2 / 3, FLAG.white], [2 / 3, 1, FLAG.red]];
  for (const [a0, a1, col] of stripes) {
    const d0 = 0.3 + a0 * fw, d1 = 0.3 + a1 * fw;
    const p = (d: number, zz: number): Vec3 => toThree(bx + dx * d, by + dy * d, zz);
    const top0 = z + d0, top1 = z + d1;
    for (const k of [1, -1]) mb.quad(p(d0, top0 - fh), p(d1, top1 - fh), p(d1, top1), p(d0, top0), toThree(px * k, py * k, 0), col);
  }
}

function civic(sinks: LandmarkSinks, kind: BuildingKind, fiche: FacadeFiche | undefined, segs: Seg[], terrain: HeightField): void {
  if (!kind.main) return;
  const g = mainSeg(segs);
  if (!g || g.len < 4) return;
  const mid = g.len / 2;
  const z = terrain.heightAt(...onSeg(g, mid));
  const gh = fiche?.storeys.ground ?? 3.4;
  const datum = Math.max(z, (fiche?.walls.find((w) => w.role === "street")?.datum ?? z));
  const height = g.top - datum;
  if (kind.k === "station") {
    // Côté ville et côté quais : les deux plus longs murs portent le nom et l'horloge.
    for (const w of [...segs].sort((a, b) => b.len - a.len).slice(0, 2)) {
      const m = w.len / 2;
      const zw = terrain.heightAt(...onSeg(w, m));
      if (kind.n) signboard(sinks, w, m, Math.min(zw + gh + 0.1, w.top - 1.6), 1.0, Math.min(w.len * 0.8, 10), kind.n, C("#f4efe4"), "#1f3f8f");
      if (w.top - zw > 6) {
        const cz = w.top - 0.85;
        roundel(sinks.solid, w, m, cz, 0.62, 0.06, DARK, 14);
        roundel(sinks.solid, w, m, cz, 0.52, 0.08, WHITE, 14);
        plate(sinks.solid, w, m - 0.03, m + 0.03, cz, cz + 0.42, 0.1, DARK);
        plate(sinks.solid, w, m, m + 0.32, cz - 0.03, cz + 0.03, 0.1, DARK);
      }
    }
    return;
  }
  // Un bâtiment dont la devanture est dessinée d'après photo (D159 : La Poste et la Grande Pharmacie Bonaparte) porte ses propres enseignes.
  if (kind.n && !fiche?.ground.devanture) {
    const post = kind.k === "post";
    const hosp = kind.k === "hospital" || kind.k === "care";
    const panel = post ? C(kind.c ?? "#ffcc00") : hosp ? C("#1f4a8a") : C("#f1e6c8");
    const letters = kind.tc ?? (hosp ? "#ffffff" : post ? "#003da5" : "#3a3530");
    const zs = height > gh + 1.2 ? datum + gh + 0.05 : datum + Math.min(2.6, height - 0.8);
    signboard(sinks, g, mid, zs, post ? 0.8 : 0.85, Math.min(g.len * 0.85, post ? 5 : 11), kind.n, panel, letters);
  }
  if ((kind.k === "townhall" || kind.k === "civic" || kind.k === "school") && height > gh + 1.5) {
    const zf = datum + gh + 1.05;
    flag(sinks.solid, g, mid - 0.6, zf, -1, false);
    if (kind.k !== "school") flag(sinks.solid, g, mid + 0.6, zf, 1, true);
  }
}

// --- Églises ------------------------------------------------------------------------------------------------------------------------

function church(sinks: LandmarkSinks, b: Building, kind: BuildingKind, segs: Seg[], terrain: HeightField, wall: THREE.Color): void {
  // Cathédrale d'après photo (D127) : modèle dédié, ni baies ni portail génériques.
  if (kind.cath) {
    buildSaintLazare(sinks.solid, sinks.glow, kind.cath, terrain);
    return;
  }
  // Notre-Dame d'après photo (D150) : modèle dédié ; son chevet (autre bâtiment BD TOPO) est dessiné avec elle.
  if (kind.ndPart) return;
  if (kind.nd) {
    buildNotreDame(sinks.solid, sinks.glow, kind.nd, terrain);
    return;
  }
  // Église Saint-André d'après photo (D138) : modèle dédié.
  if (kind.chap) {
    buildChapel(sinks.solid, sinks.glow, kind.chap, terrain);
    return;
  }
  const stained = pick(STAINED, idKey(b.id), 5);
  const frame = shade(STONE, 0.86);
  const longest = segs.reduce((m, s) => Math.max(m, s.len), 0);
  for (const g of segs) {
    const z = terrain.heightAt(...onSeg(g, g.len / 2));
    const h = g.top - z;
    if (h < 3.5) continue;
    if (g.len >= longest * 0.55 && g.len > 7) {
      // Longs murs : baies hautes en plein cintre, vitraux.
      const wh = Math.min(5.5, h * 0.5), ww = Math.min(1.3, wh * 0.3);
      const z0 = z + Math.min(2.6, h * 0.3);
      const n = Math.max(1, Math.floor((g.len - 2) / 4.5));
      for (let i = 0; i < n; i++) {
        const s = 1 + ((g.len - 2) * (i + 0.5)) / n;
        plate(sinks.solid, g, s - ww / 2 - 0.15, s + ww / 2 + 0.15, z0 - 0.15, z0 + wh, 0.02, frame);
        arch(sinks.solid, g, s, z0 + wh, ww / 2 + 0.15, 0.02, frame);
        plate(sinks.solid, g, s - ww / 2, s + ww / 2, z0, z0 + wh, 0.04, C(stained[0]), C(stained[1]));
        arch(sinks.solid, g, s, z0 + wh, ww / 2, 0.04, C(stained[1]));
      }
    } else if (g.len > 4 && g.street) {
      // Pignon sur rue : portail et rosace.
      const s = g.len / 2;
      const dw = Math.min(2.6, g.len * 0.35), dh = Math.min(3.6, h * 0.45);
      plate(sinks.solid, g, s - dw / 2 - 0.35, s + dw / 2 + 0.35, z, z + dh, 0.03, frame);
      arch(sinks.solid, g, s, z + dh, dw / 2 + 0.35, 0.03, frame, 8);
      plate(sinks.solid, g, s - dw / 2, s + dw / 2, z, z + dh, 0.05, C("#5a3a28"), C("#6e4a32"));
      arch(sinks.solid, g, s, z + dh, dw / 2, 0.05, C("#4a2f20"), 8);
      const rz = z + dh + dw / 2 + 1.6;
      if (rz + 1.3 < g.top) {
        roundel(sinks.solid, g, s, rz, 1.2, 0.03, frame, 16);
        roundel(sinks.solid, g, s, rz, 0.95, 0.05, C(stained[0]), 16);
      }
    }
  }
  if (kind.mon) buildCathedral(sinks.solid, kind.mon, terrain, C(T.roofs.ardoise));
  else if (kind.tower) tower(sinks, b, kind.tower, terrain, wall);
}

/** Clocher : tour carrée dans l'axe de la nef, abat-sons, flèche octogonale ou toit en pavillon. */
function tower(sinks: LandmarkSinks, b: Building, t: [number, number, number, number, number], terrain: HeightField, wall: THREE.Color): void {
  const [x, y, side, body, tip] = t;
  // Axe : celui du plus long côté du bâtiment.
  let ax = 1, ay = 0, best = 0;
  for (let i = 0; i < b.ring.length / 2; i++) {
    const j = (i + 1) % (b.ring.length / 2);
    const dx = b.ring[2 * j]! - b.ring[2 * i]!, dy = b.ring[2 * j + 1]! - b.ring[2 * i + 1]!;
    const l = Math.hypot(dx, dy);
    if (l > best) [best, ax, ay] = [l, dx / l, dy / l];
  }
  const z0 = terrain.heightAt(x, y) - 0.5;
  const h = side / 2;
  const col = shade(wall, 0.97);
  block(sinks.solid, x, y, ax, ay, h, h, z0, body, col, shade(col, 0.8));
  // Corniche et abat-sons sur chaque face.
  const faces: Seg[] = [];
  const corners: [number, number][] = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([s, u]) => [x + ax * s! - ay * u!, y + ay * s! + ax * u!]);
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i]!, [x2, y2] = corners[(i + 1) % 4]!;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const tx = (x2 - x1) / len, ty = (y2 - y1) / len;
    faces.push({ x: x1, y: y1, tx, ty, nx: ty, ny: -tx, len, top: body, street: false, front: false, glazed: false, sign: false, from: 0 });
  }
  const louver = C("#3a3634");
  const bh = Math.min(3.2, (body - z0) * 0.22);
  for (const f of faces) {
    plate(sinks.solid, f, -0.1, f.len + 0.1, body - 0.45, body, 0.12, shade(STONE, 1.03));
    const n = side > 5 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const s = (f.len * (k + 0.5)) / n, w = Math.min(0.9, f.len / (2.4 * n));
      plate(sinks.solid, f, s - w / 2, s + w / 2, body - 0.8 - bh, body - 0.8 - w / 2, 0.03, louver);
      arch(sinks.solid, f, s, body - 0.8 - w / 2, w / 2, 0.03, louver);
    }
  }
  // Flèche (au-delà de 6 m) ou toit en pavillon.
  const slate = C(T.roofs.ardoise);
  const rise = tip - body;
  if (rise < 0.8) return;
  const sides = rise > 6 ? 8 : 4;
  const r = sides === 8 ? h * 0.92 : h * 1.08;
  const apex: Vec3 = toThree(x, y, tip);
  for (let i = 0; i < sides; i++) {
    const a0 = Math.atan2(ay, ax) + Math.PI / sides + (2 * Math.PI * i) / sides, a1 = a0 + (2 * Math.PI) / sides;
    const p0: Vec3 = toThree(x + Math.cos(a0) * r, y + Math.sin(a0) * r, body), p1: Vec3 = toThree(x + Math.cos(a1) * r, y + Math.sin(a1) * r, body);
    const am = (a0 + a1) / 2;
    const slope = r / Math.max(rise, 0.1);
    const nl = Math.hypot(1, slope);
    sinks.solid.tri(p0, p1, apex, toThree(Math.cos(am) / nl, Math.sin(am) / nl, slope / nl), shade(slate, 0.92 + (i % 2) * 0.1));
  }
}

// --- Sites : station-service, terrains, cimetières ------------------------------------------------------------------------------------

function fuel(sinks: LandmarkSinks, site: Extract<Site, { t: "fuel" }>, roof: Building | undefined, terrain: HeightField): void {
  const lay = fuelLayout(site);
  const f = lay.frame;
  const accent = C(site.c ?? "#d9472b");
  const zg = terrain.heightAt(f.x, f.y);
  // Sous un auvent existant, les poteaux montent jusqu'à sa tranche.
  const zt = roof ? roof.eave + 0.8 : zg + 5.0;
  if (!site.roof) {
    // Auvent posé : dalle, tranche à bande colorée, dessous clair.
    const pts = [at(f, -f.hl, -f.hw), at(f, f.hl, -f.hw), at(f, f.hl, f.hw), at(f, -f.hl, f.hw)];
    block(sinks.solid, f.x, f.y, f.ux, f.uy, f.hl, f.hw, zt - 0.8, zt, WHITE, C("#e9e4d8"));
    soffit(sinks.solid, pts, zt - 0.8, C("#fbf7ee"));
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % 4]!;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const n = toThree((y2 - y1) / len, -(x2 - x1) / len, 0);
      sinks.solid.quad(toThree(x1, y1, zt - 0.6), toThree(x2, y2, zt - 0.6), toThree(x2, y2, zt - 0.3), toThree(x1, y1, zt - 0.3), n, accent);
    }
  }
  for (const [x, y] of lay.posts) block(sinks.solid, x, y, f.ux, f.uy, 0.15, 0.15, terrain.heightAt(x, y) - 0.2, site.roof ? zt : zt - 0.8, C("#d8d8d2"));
  for (const [x, y] of lay.islands) {
    const z = terrain.heightAt(x, y);
    block(sinks.solid, x, y, f.vx, f.vy, Math.min(2.2, f.hw * 0.7), 0.6, z - 0.2, z + 0.15, CONCRETE);
    for (const side of [-1, 1]) {
      const px = x + f.vx * side * 0.9, py = y + f.vy * side * 0.9;
      block(sinks.solid, px, py, f.ux, f.uy, 0.3, 0.4, z + 0.15, z + 1.7, WHITE);
      block(sinks.solid, px, py, f.ux, f.uy, 0.31, 0.41, z + 1.45, z + 1.75, accent);
    }
  }
  // Totem des prix.
  const [tx, ty] = lay.totem;
  const z = terrain.heightAt(tx, ty);
  block(sinks.solid, tx, ty, f.ux, f.uy, 0.75, 0.22, z - 0.2, z + 5.5, accent);
  for (const side of [1, -1]) {
    const g: Seg = { x: tx - f.ux * 0.65 * side - f.vx * 0.23 * side, y: ty - f.uy * 0.65 * side - f.vy * 0.23 * side, tx: f.ux * side, ty: f.uy * side,
      nx: f.uy * side, ny: -f.ux * side, len: 1.3, top: z + 5.5, street: true, front: false, glazed: false, sign: false, from: 0 };
    for (let k = 0; k < 3; k++) plate(sinks.solid, g, 0.15, 1.15, z + 1.6 + k * 0.75, z + 2.2 + k * 0.75, 0.01, WHITE);
    if (site.n) text(sinks, g, 0.65, z + 4.3, 0.2, 0.02, site.n, "#ffffff");
  }
}

function pointInRing(x: number, y: number, r: readonly number[]): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i]!, yi = r[2 * i + 1]!, xj = r[2 * j]!, yj = r[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rectangle orienté du repère, sous forme de polygone (un anneau) pour le sol. */
function rectPoly(f: Frame, s0: number, s1: number, t0: number, t1: number): number[][] {
  const pts = [at(f, s0, t0), at(f, s1, t0), at(f, s1, t1), at(f, s0, t1)];
  return [pts.flat()];
}

/** Lignes d'un cercle (segments épais) dans le repère du terrain. */
function circlePolys(f: Frame, r: number, w: number, seg = 20): number[][][] {
  const out: number[][][] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (2 * Math.PI * i) / seg, a1 = (2 * Math.PI * (i + 1)) / seg;
    const p = (a: number, rr: number): [number, number] => at(f, Math.cos(a) * rr, Math.sin(a) * rr);
    out.push([[...p(a0, r - w / 2), ...p(a1, r - w / 2), ...p(a1, r + w / 2), ...p(a0, r + w / 2)]]);
  }
  return out;
}

const SURFACE: Record<string, string> = {
  soccer: "#4f9a5e", rugby: "#4f9a5e", athletics: "#4f9a5e", tennis: "#3f7fa5", basketball: "#4a7f9a", handball: "#4a7f9a", multi: "#4a7f9a", other: "#7aa86a",
};

/** Ce qu'un terrain ajoute au sol : surface, bandes de tonte et lignes. Polygones pour `fillOnTerrain` (anneaux aplatis). */
export function pitchPolys(site: Extract<Site, { t: "pitch" }>): { surface: [number[][], string][]; lines: number[][][] } {
  const [cx, cy, a, l, w] = site.box;
  const f = frameOf(cx, cy, a, l, w);
  const surface: [number[][], string][] = [[[site.r], SURFACE[site.s] ?? SURFACE["other"]!]];
  const lines: number[][][] = [];
  const lw = 0.12;
  const outline = (hl: number, hw: number): void => {
    lines.push(rectPoly(f, -hl, hl, -hw, -hw + lw), rectPoly(f, -hl, hl, hw - lw, hw), rectPoly(f, -hl, -hl + lw, -hw, hw), rectPoly(f, hl - lw, hl, -hw, hw));
  };
  if (site.s === "soccer" || site.s === "rugby") {
    const hl = l / 2 - 2, hw = w / 2 - 2;
    if (hl < 10 || hw < 6) return { surface, lines };
    for (let s = -hl; s < hl; s += 10) surface.push([rectPoly(f, s, Math.min(s + 5, hl), -hw, hw), "#5aa86a"]);
    outline(hl, hw);
    lines.push(rectPoly(f, -lw / 2, lw / 2, -hw, hw));
    lines.push(...circlePolys(f, Math.min(9.15, hw * 0.5), lw));
    if (site.s === "soccer") {
      const bw = Math.min(20, hw * 0.6), bd = Math.min(16.5, hl * 0.3);
      for (const side of [-1, 1]) {
        const s0 = side * hl, s1 = side * (hl - bd);
        lines.push(rectPoly(f, Math.min(s0, s1), Math.max(s0, s1), -bw, -bw + lw), rectPoly(f, Math.min(s0, s1), Math.max(s0, s1), bw - lw, bw));
        lines.push(rectPoly(f, s1 - lw / 2, s1 + lw / 2, -bw, bw));
      }
    } else {
      for (const k of [-1, 1]) lines.push(rectPoly(f, k * hl * 0.44 - lw / 2, k * hl * 0.44 + lw / 2, -hw, hw));
    }
  } else if (site.s === "tennis") {
    const hl = Math.min(11.885, l / 2 - 1), hw = Math.min(5.485, w / 2 - 1);
    if (hl < 6 || hw < 3) return { surface, lines };
    surface.push([rectPoly(f, -hl, hl, -hw, hw), "#c8603f"]);
    outline(hl, hw);
    lines.push(rectPoly(f, -lw / 2, lw / 2, -hw - 0.9, hw + 0.9));
    const sv = Math.min(6.4, hl * 0.54), sw = hw * 0.75;
    lines.push(rectPoly(f, -sv - lw / 2, -sv + lw / 2, -sw, sw), rectPoly(f, sv - lw / 2, sv + lw / 2, -sw, sw), rectPoly(f, -sv, sv, -lw / 2, lw / 2));
    lines.push(rectPoly(f, -hl, hl, -sw, -sw + lw), rectPoly(f, -hl, hl, sw - lw, sw));
  } else if (site.s !== "other" && site.s !== "athletics") {
    const hl = Math.min(14, l / 2 - 1), hw = Math.min(7.5, w / 2 - 1);
    if (hl < 5 || hw < 3) return { surface, lines };
    surface.push([rectPoly(f, -hl, hl, -hw, hw), "#c8603f"]);
    outline(hl, hw);
    lines.push(rectPoly(f, -lw / 2, lw / 2, -hw, hw));
    lines.push(...circlePolys(f, 1.8, lw, 14));
    for (const side of [-1, 1]) lines.push(...circlePolys(frameOf(...at(f, side * (hl - 1.6), 0), a, 1, 1), 0.23, 0.05, 8));
  }
  return { surface, lines };
}

/** Tombes en rangées dans un cimetière, alignées sur son plus long côté, allées toutes les cinq rangées ; 1 200 au plus (≈ 24 000 triangles). */
function cemetery(sinks: LandmarkSinks, site: Extract<Site, { t: "cemetery" }>, terrain: HeightField): void {
  const r = site.r;
  let ax = 1, ay = 0, best = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const dx = r[j]! - r[i]!, dy = r[j + 1]! - r[i + 1]!;
    const l = Math.hypot(dx, dy);
    if (l > best) [best, ax, ay] = [l, dx / l, dy / l];
    x0 = Math.min(x0, r[i]!); y0 = Math.min(y0, r[i + 1]!); x1 = Math.max(x1, r[i]!); y1 = Math.max(y1, r[i + 1]!);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2;
  const slab = C("#b9b4aa"), stone = C("#8f8a82"), light = C("#d6d0c4");
  let count = 0;
  for (let row = 0; -R + row * 3.3 < R; row++) {
    if (row % 6 === 5) continue;
    const t = -R + row * 3.3;
    for (let s = -R; s < R; s += 1.7) {
      const x = cx + ax * s - ay * t, y = cy + ay * s + ax * t;
      if (!pointInRing(x, y, r) || !pointInRing(x + ay * 2, y - ax * 2, r)) continue;
      if (count >= 1200) return;
      const key = hash01(`${x.toFixed(1)},${y.toFixed(1)}`);
      if (key < 0.12) continue;
      const z = terrain.heightAt(x, y);
      // Dalle, puis stèle à la tête.
      block(sinks.solid, x, y, -ay, ax, 1.0, 0.45, z - 0.1, z + 0.3 + key * 0.15, key > 0.6 ? light : slab);
      const hx = x + ay * 0.85, hy = y - ax * 0.85;
      block(sinks.solid, hx, hy, ax, ay, 0.42, 0.08, z, z + 0.7 + key * 0.5, stone);
      count++;
    }
  }
}

/** Sols des sites : pistes d'athlétisme, surfaces et lignes des terrains de sport (dans le maillage des sols). */
export function buildSitesGround(mb: MeshBuilder, kinds: TileKinds | undefined, terrain: HeightField): void {
  if (!kinds) return;
  // Pistes synthétiques rouges ; terre battue rouge-brun (D133, d'après photo).
  const track = C("#c8553d"), dirt = C("#a8724f"), white = C("#f4f1ea");
  for (const s of kinds.sites) if (s.t === "track") fillOnTerrain(mb, [s.r], 0.05, s.s === "dirt" ? dirt : track, terrain);
  for (const s of kinds.sites) {
    if (s.t !== "pitch") continue;
    const { surface, lines } = pitchPolys(s);
    surface.forEach(([poly, hex], i) => fillOnTerrain(mb, poly, i === 0 ? 0.07 : 0.085, C(hex), terrain));
    for (const poly of lines) fillOnTerrain(mb, poly, 0.1, white, terrain);
  }
  // Îlots de rond-point d'après photo (D142) : pelouse et massif.
  for (const s of kinds.sites) if (s.t === "roundabout") buildRoundaboutGround(mb, s, terrain);
}

// --- Entrée ---------------------------------------------------------------------------------------------------------------------------

/** Dessine les gabarits d'une tuile (après les murs et les toits génériques) et ses sites en volume. */
export function buildLandmarks(
  sinks: LandmarkSinks, tile: { buildings: readonly Building[]; kinds?: TileKinds }, fiches: ReadonlyMap<string, FacadeFiche>, terrain: HeightField,
  wallOf: (b: Building) => THREE.Color,
): void {
  const kinds = tile.kinds;
  if (!kinds) return;
  const fuelSites = kinds.sites.filter((s): s is Extract<Site, { t: "fuel" }> => s.t === "fuel");
  for (const b of tile.buildings) {
    const kind = kinds.buildings[b.id];
    if (!kind) continue;
    const fiche = fiches.get(b.id);
    const segs = segments(b, fiche);
    const wall = wallOf(b);
    switch (kind.k) {
      case "retail": {
        const o: RetailOptions = {};
        if (fiche?.ground.signAt !== undefined) o.signAt = fiche.ground.signAt;
        if (fiche?.ground.signZ !== undefined) o.signZ = fiche.ground.signZ;
        if (kind.store) buildStore(sinks, b, kind, terrain, wall);
        else retail(sinks, b, kind, segs, terrain, wall, o);
        break;
      }
      case "industrial": industrial(sinks, b, segs, terrain, wall); break;
      case "sports": sportsHall(sinks, kind, segs, terrain); break;
      case "annex": annex(sinks, b, segs, terrain); break;
      case "greenhouse": greenhouse(sinks, segs, terrain); break;
      case "canopy": {
        const site = fuelSites.find((s) => s.roof === b.id);
        if (kind.style === "marquise") marquise(sinks.solid, b, terrain);
        else canopy(sinks, b, site?.c ?? "#d9472b", terrain, site);
        break;
      }
      case "church": case "chapel": church(sinks, b, kind, segs, terrain, wall); break;
      case "hidden": break;
      case "cart": if (kind.style === "lidl") lidlCartShelter(sinks, b, kind, terrain); else cartShelter(sinks.solid, b, kind, terrain); break;
      case "house": if (kind.house) buildHouse(sinks.solid, sinks.glow, kind.house, terrain); break;
      default:
        // Hôtel de ville d'après photo (D123) : modèle dédié, ni inscription ni drapeaux génériques.
        if (kind.hex) buildHexagone(sinks, kind.hex, terrain);
        else if (kind.vallon) { buildVallon(sinks, kind.vallon, terrain); buildVallonFacades(sinks, kind.vallon, terrain); if (kind.vallon.gate) buildGatePosts(sinks, kind.vallon.gate, terrain); if (kind.vallon.props) buildVallonProps(sinks, kind.vallon, terrain); }
        else if (kind.hall) buildTownHall(sinks.solid, sinks.glow, kind.hall, terrain, C(T.roofs.ardoise));
        else if (kind.college) buildCollege(sinks.solid, sinks.glow, kind.college, b.ring, terrain);
        else civic(sinks, kind, fiche, segs, terrain);
        break;
    }
  }
  for (const s of kinds.sites) {
    if (s.t === "fuel") fuel(sinks, s, s.roof ? tile.buildings.find((b) => b.id === s.roof) : undefined, terrain);
    else if (s.t === "cemetery") cemetery(sinks, s, terrain);
    else if (s.t === "gate") buildGate(sinks.solid, sinks.glow, s, terrain);
    else if (s.t === "fountain") buildFountain(sinks.solid, s, terrain);
    else if (s.t === "theatre") buildTheatre(sinks.solid, s, terrain);
    else if (s.t === "janus") buildJanus(sinks.solid, sinks.glow, s, terrain);
    else if (s.t === "roundabout") buildRoundabout(sinks.solid, s, terrain);
    else if (s.t === "curtain") buildCurtain(sinks.solid, s, terrain);
    else if (s.t === "bandstand") buildBandstand(sinks.solid, s, terrain);
  }
}
