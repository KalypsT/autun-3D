import type { Arcade, Building, BuildingKind, BuildingKindId, Carport, CathedralModel, CurtainSite, BandstandSite, Deck, Furniture, GateModel, HexagoneModel, HouseModel, JanusSite, JanusWall, RoundaboutSite, Site, StoreModel, Tree, Wall } from "../data/types";
import { gateCircles } from "./school-gate";
import { vallonPropCircles } from "./vallon-props";
import type { DeckSector } from "./decks";
import { inTheatre, theatreDecks, theatreSectors } from "./theatre";

/** Gabarits « boîte » : leur façade d'habitation est remplacée (bardage, quais, vitrage d'entrée). */
export const BOX_KINDS: ReadonlySet<BuildingKindId> = new Set(["retail", "industrial", "annex", "sports", "greenhouse", "canopy"]);
/** Pente gardée par chaque gabarit (1 : toit généré tel quel, 0 : toit plat). */
const ROOF_SCALE: Partial<Record<BuildingKindId, number>> = { retail: 0, canopy: 0, industrial: 0.28, sports: 0.35, greenhouse: 0.6 };
/** Acrotère (relevé du mur au-dessus d'un toit plat). */
export const PARAPET = 0.8;

/**
 * Bâtiment remis à la forme de son gabarit : les grandes surfaces ont un toit plat et un acrotère, les hangars et les gymnases un toit
 * à faible pente. Les pans gardent leur découpage : on écrase leur hauteur au-dessus de l'égout (z' = égout + k·(z − égout)), ce qui
 * garde des pans plans et des murs qui les rejoignent. Renvoie le bâtiment tel quel pour les autres types.
 */
export function reshapeBuilding(b: Building, kind: BuildingKindId | undefined, roof?: [number, number, number, number]): Building {
  // Plan de toit mesuré au LiDAR (D143 ; annexes du lycée, D148) : prioritaire sur la pente du gabarit.
  if (roof && (kind === "retail" || kind === "school")) return plannedRoof(b, roof);
  const k = kind === undefined ? undefined : ROOF_SCALE[kind];
  if (k === undefined || k === 1) return b;
  const e0 = b.eave;
  const squash = (z: number): number => (z <= e0 ? z : e0 + k * (z - e0));
  const parapet = k === 0 && kind !== "canopy" ? PARAPET : 0;
  const tops = (t: number[]): number[] => t.map((z) => Math.max(squash(z), e0) + parapet);
  return {
    ...b,
    top: tops(b.top),
    holeTop: b.holeTop.map(tops),
    faces: b.faces.map((f) => {
      const [a, bb, c] = f.p;
      const out = { ...f, p: [k * a, k * bb, e0 + k * (c - e0)] as [number, number, number] };
      if (f.z) out.z = f.z.map(squash);
      return out;
    }),
    // Les raccords entre pans et les cheminées n'ont plus de sens sur un toit écrasé.
    steps: [],
    chim: k === 0 ? [] : b.chim,
    ridge: squash(b.ridge),
    roofKind: k === 0 ? "flat" : b.roofKind,
  };
}

/**
 * Grande surface au toit plat mesuré au LiDAR (D143) : un seul plan z = a·x + b·y + c (qui peut pencher de quelques pour cent), et des
 * murs qui montent de `par` mètres au-dessus de lui en chaque sommet (acrotère). `eave` est le point le plus bas du plan sur le contour.
 */
function plannedRoof(b: Building, [ra, rb, rc, par]: [number, number, number, number]): Building {
  const at = (x: number, y: number): number => ra * x + rb * y + rc;
  const tops = (ring: number[]): number[] => ring.length ? Array.from({ length: ring.length / 2 }, (_, i) => at(ring[2 * i]!, ring[2 * i + 1]!) + par) : [];
  const top = tops(b.ring);
  const eave = Math.min(...top) - par;
  const faces = b.faces.map((f) => {
    const out = { ...f, p: [ra, rb, rc] as [number, number, number] };
    delete out.z;
    return out;
  });
  return { ...b, top, holeTop: b.holes.map(tops), faces, steps: [], chim: [], eave, ridge: Math.max(...top) - par, roofKind: "flat" };
}

/** Repère d'un auvent ou d'un rectangle orienté : centre, axe du grand côté (ux, uy), axe du petit (vx, vy), demi-côtés. */
export interface Frame {
  x: number;
  y: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  hl: number;
  hw: number;
}

export function frameOf(x: number, y: number, a: number, l: number, w: number): Frame {
  return { x, y, ux: Math.cos(a), uy: Math.sin(a), vx: -Math.sin(a), vy: Math.cos(a), hl: l / 2, hw: w / 2 };
}

/** Point du repère : `s` le long du grand côté, `t` le long du petit, depuis le centre. */
export function at(f: Frame, s: number, t: number): [number, number] {
  return [f.x + f.ux * s + f.vx * t, f.y + f.uy * s + f.vy * t];
}

export interface FuelLayout {
  frame: Frame;
  /** Poteaux de l'auvent (x, y). */
  posts: [number, number][];
  /** Îlots de pompes : centre (x, y), dans l'axe du petit côté de l'auvent. */
  islands: [number, number][];
  /** Totem des prix, au bord de l'emprise. */
  totem: [number, number];
}

/** Disposition d'une station-service : poteaux tous les 6 m environ sur l'axe, un îlot de pompes entre deux poteaux, totem en bout. */
export function fuelLayout(site: Extract<Site, { t: "fuel" }>): FuelLayout {
  const frame = frameOf(site.x, site.y, site.a, Math.max(site.l, 6), Math.max(site.w, 4));
  const n = Math.max(2, Math.round(frame.hl / 3) + 1);
  const posts: [number, number][] = [];
  const islands: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const s = -frame.hl + 1 + ((2 * frame.hl - 2) * i) / (n - 1);
    posts.push(at(frame, s, 0));
    if (i < n - 1) islands.push(at(frame, s + (frame.hl - 1) / (n - 1), 0));
  }
  return { frame, posts, islands, totem: at(frame, frame.hl + 3, frame.hw + 1.5) };
}

/** Obstacles des gabarits : cercles (x, y, rayon) des poteaux d'auvent, des pompes et des totems. */
export function landmarkCircles(kinds: { buildings: Record<string, BuildingKind>; sites: Site[] } | undefined, buildings: readonly Building[]): [number, number, number][] {
  if (!kinds) return [];
  const out: [number, number, number][] = [];
  const roofs = new Set<string>();
  for (const s of kinds.sites) {
    if (s.t !== "fuel") continue;
    if (s.roof) roofs.add(s.roof);
    const lay = fuelLayout(s);
    for (const [x, y] of lay.posts) out.push([x, y, 0.3]);
    for (const [x, y] of lay.islands) out.push([x, y, 0.7]);
    out.push([lay.totem[0], lay.totem[1], 0.5]);
  }
  // Théâtre romain (D136) : poteaux d'éclairage et arbustes taillés.
  for (const s of kinds.sites) {
    if (s.t !== "theatre") continue;
    for (const [x, y] of s.poles ?? []) out.push([x, y, 0.2]);
    for (const [x, y] of s.shrubs ?? []) out.push([x, y, 0.7]);
  }
  // Fontaine d'après photo (D131) : son bassin.
  for (const s of kinds.sites) if (s.t === "fountain") out.push([s.x, s.y, s.rb + 0.2]);
  // Rond-point d'après photo (D142) : le tronc de l'arbre du centre (l'îlot, à bordure basse, se traverse).
  for (const s of kinds.sites) if (s.t === "roundabout") out.push([s.tree.x, s.tree.y, TRUNK_R]);
  // Rideaux de tilleuls de la place du Champ de Mars (D155) : leurs troncs.
  for (const s of kinds.sites) if (s.t === "curtain") for (const [x, y] of curtainTrunks(s)) out.push([x, y, 0.25]);
  // Lycée (D149) : troncs des arbres taillés en rideau derrière la grille.
  for (const k of Object.values(kinds.buildings)) for (const [x, y] of k.college?.grille?.trees ?? []) out.push([x, y, 0.3]);
  // Maison d'après photo (D140) : le poteau de l'entrée couverte.
  for (const b of buildings) {
    const h = kinds.buildings[b.id]?.house;
    if (h) out.push([...housePost(h), 0.12]);
    for (const q of kinds.buildings[b.id]?.hex?.props ?? []) {
      const r = HEX_PROP_RADIUS[q.k];
      if (r) out.push([q.x, q.y, r]);
    }
    const st = kinds.buildings[b.id]?.store;
    if (st) out.push(...storeCircles(b, st));
    // Entrée du collège du Vallon (D174) : poteaux, pilier, lampadaires.
    const vg = kinds.buildings[b.id]?.vallon?.gate;
    if (vg) out.push(...gateCircles(vg));
    const vm = kinds.buildings[b.id]?.vallon;
    if (vm?.props) out.push(...vallonPropCircles(vm));
  }
  // Auvents sans site (rare) : un poteau à chaque coin.
  for (const b of buildings) {
    if (kinds.buildings[b.id]?.k !== "canopy" || roofs.has(b.id)) continue;
    for (let i = 0; i < b.ring.length; i += 2) out.push([b.ring[i]!, b.ring[i + 1]!, 0.3]);
  }
  return out;
}

/** Repère d'une arête du contour (sommet e vers e + 1) : origine, tangente, normale sortante (contour direct) et longueur. */
export interface EdgeFrame {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  len: number;
}

export function edgeFrame(ring: readonly number[], e: number): EdgeFrame {
  const n = ring.length / 2;
  const i = e % n, j = (i + 1) % n;
  const x = ring[2 * i]!, y = ring[2 * i + 1]!;
  const dx = ring[2 * j]! - x, dy = ring[2 * j + 1]! - y;
  const len = Math.hypot(dx, dy) || 1;
  return { x, y, tx: dx / len, ty: dy / len, nx: dy / len, ny: -dx / len, len };
}

/** Disposition d'un abri solaire (D144) : coins du rectangle, altitude du dessus en un point, poteaux le long du bord haut. */
export interface CarportShape {
  corners: [number, number][];
  zAt: (x: number, y: number) => number;
  posts: [number, number][];
  /** Épaisseur de la dalle de panneaux. */
  thick: number;
}

export function carportShape([cx, cy, ang, L, W, a, b, c]: Carport): CarportShape {
  const r = (ang * Math.PI) / 180, ux = Math.cos(r), uy = Math.sin(r), vx = -uy, vy = ux;
  const pt = (s: number, t: number): [number, number] => [cx + ux * s + vx * t, cy + uy * s + vy * t];
  const zAt = (x: number, y: number): number => a * x + b * y + c;
  // Le bord haut est le long côté (t = ±W/2) où le plan est le plus haut ; les poteaux y sont, à 1,5 m du bord (une file piétonne longe ce bord).
  const side = zAt(...pt(0, W / 2)) >= zAt(...pt(0, -W / 2)) ? 1 : -1;
  const n = Math.max(2, Math.ceil(L / 7) + 1);
  const posts = Array.from({ length: n }, (_, i) => pt(-L / 2 + 0.8 + ((L - 1.6) * i) / (n - 1), side * (W / 2 - 1.5)));
  return { corners: [pt(-L / 2, -W / 2), pt(L / 2, -W / 2), pt(L / 2, W / 2), pt(-L / 2, W / 2)], zAt, posts, thick: 0.18 };
}

/** Obstacles d'un magasin d'après photo (D143, D144) : sas et casier du Lidl, portique et poteaux de l'auvent du Bricomarché, poteaux de l'auvent du
 *  But, poteaux des abris solaires, angles des pavillons de la Jardinerie. Le store du Drive (une file piétonne passe dessous), les tondeuses
 *  et les potelets se traversent ou se longent. */
export function storeCircles(b: Building, st: StoreModel): [number, number, number][] {
  const out: [number, number, number][] = [];
  const at = (f: EdgeFrame, s: number, off: number): [number, number] => [f.x + f.tx * s + f.nx * off, f.y + f.ty * s + f.ny * off];
  const f = edgeFrame(b.ring, st.e);
  for (const cp of st.carports ?? []) for (const [x, y] of carportShape(cp).posts) out.push([x, y, 0.3]);
  // Galeries marchandes (D145) : poteaux de l'auvent vitré, tour de jeux des aires de jeux.
  for (const [x, y] of arcadePosts(b, st.arcade)) out.push([x, y, ARCADE_POST_R]);
  for (const p of st.play ?? []) out.push(...playCircles(p));
  if (st.style === "gifi" && st.door) for (const s of [st.door[0] - st.door[1] / 2 - 0.4, st.door[0] + st.door[1] / 2 + 0.4]) out.push([...at(f, s, GIFI_CANOPY_D - 0.2), 0.2]);
  if (st.style === "lidl") {
    if (st.door) {
      const [c, w] = st.door;
      for (const s of [c - w / 2 + 0.7, c, c + w / 2 - 0.7]) out.push([...at(f, s, 0.8), 0.75]);
    }
    if (st.side) {
      const fs = edgeFrame(b.ring, st.side.e);
      out.push([...at(fs, st.side.locker[0], 0.3), 0.65]);
    }
  } else if (st.style === "bricomarche") {
    if (st.door) for (const s of [st.door[0] - st.door[1] / 2, st.door[0] + st.door[1] / 2]) out.push([...at(f, s, BRICO_PORTAL_O), 0.4]);
    if (st.canopy) for (const s of canopyPosts(st.canopy)) out.push([...at(f, s, st.canopy[2] - 0.25), 0.2]);
  } else if (st.style === "but") {
    if (st.canopy) for (const s of [st.canopy[0] + 0.4, st.canopy[1] - 0.4]) out.push([...at(f, s, st.canopy[2] - 0.2), 0.2]);
  } else if (st.style === "jardinerie") {
    for (const [e, s0, s1] of st.pavilions ?? []) {
      const fp = edgeFrame(b.ring, e);
      for (const s of [s0 + 0.5, s1 - 0.5]) out.push([...at(fp, s, PAVILION_DEPTH - 0.4), 0.45]);
    }
  }
  return out;
}

/** Rayon des poteaux de l'auvent vitré des galeries (m, obstacle) ; profondeur de l'auvent d'entrée du GiFi (m). */
export const ARCADE_POST_R = 0.2;
export const GIFI_CANOPY_D = 2.6;

/** Poteaux de l'auvent vitré d'une galerie (D145) : tous les 6 m au plus, aux deux bouts de chaque tronçon, le long du bord avant. */
export function arcadePosts(b: Building, a: Arcade | undefined): [number, number][] {
  const out: [number, number][] = [];
  for (const [e, s0, s1] of a?.runs ?? []) {
    const f = edgeFrame(b.ring, e);
    const n = Math.max(1, Math.ceil((s1 - s0 - 0.6) / 6));
    for (let i = 0; i <= n; i++) {
      const s = s0 + 0.3 + ((s1 - s0 - 0.6) * i) / n, o = a!.o[1] - 0.2;
      out.push([f.x + f.tx * s + f.nx * o, f.y + f.ty * s + f.ny * o]);
    }
  }
  return out;
}

/** Aire de jeux d'un parking (D145) : centre (x, y), angle (degrés) ; repère local (u le long de l'angle, v à sa gauche) : tapis de 9 × 7 m, tour du toboggan, trampoline, banc (à l'écart du chemin qui traverse l'îlot : à plus de 3 m de toute file piétonne). */
export interface PlayLayout {
  frame: { x: number; y: number; ux: number; uy: number; vx: number; vy: number };
  mat: [number, number];
  tower: [number, number];
  slide: [number, number, number];
  trampoline: [number, number, number];
  bench: [number, number];
}

export function playLayout([x, y, ang]: [number, number, number]): PlayLayout {
  const r = (ang * Math.PI) / 180, ux = Math.cos(r), uy = Math.sin(r);
  return { frame: { x, y, ux, uy, vx: -uy, vy: ux }, mat: [9, 7], tower: [-2.3, -0.9], slide: [-2.3 + 0.7, -0.9, 3.4], trampoline: [2.1, 1.7, 0.9], bench: [-3.4, 2.7] };
}

/** Point du repère d'une aire de jeux en coordonnées du monde. */
export function playPoint(l: PlayLayout, u: number, v: number): [number, number] {
  const f = l.frame;
  return [f.x + f.ux * u + f.vx * v, f.y + f.uy * u + f.vy * v];
}

/** Obstacles d'une aire de jeux : la tour du toboggan et le banc ; le tapis, le toboggan (bas) et le trampoline enterré se traversent. */
export function playCircles(p: [number, number, number]): [number, number, number][] {
  const l = playLayout(p);
  return [[...playPoint(l, ...l.tower), 0.9], [...playPoint(l, ...l.bench), 0.6]];
}

/** Distance du portique d'entrée du Bricomarché au mur (m) et saillie des pavillons vitrés de la Jardinerie (m). */
export const BRICO_PORTAL_O = 2.3;
export const PAVILION_DEPTH = 2.4;

/** Abscisses des poteaux d'un auvent [s0, s1, profondeur] : tous les 6 m au plus, aux deux bouts. */
export function canopyPosts([s0, s1]: [number, number, number]): number[] {
  const n = Math.max(1, Math.ceil((s1 - s0 - 0.6) / 6));
  return Array.from({ length: n + 1 }, (_, i) => s0 + 0.3 + ((s1 - s0 - 0.6) * i) / n);
}

/** Arbres de la tuile hors des bassins des fontaines d'après photo (D131) : un arbre de la carte poussait au milieu de la fontaine Saint-Lazare. */
export function treesOutsideMonuments(kinds: { sites: Site[]; buildings?: Record<string, BuildingKind> } | undefined, trees: readonly Tree[]): Tree[] {
  // Arbres taillés en rideau derrière la grille du lycée (D149) : le modèle les dessine, leurs troncs restent des obstacles (`landmarkCircles`).
  const pleached = new Set(Object.values(kinds?.buildings ?? {}).flatMap((b) => (b.college?.grille?.trees ?? []).map(([x, y]) => `${x},${y}`)));
  if (pleached.size) trees = trees.filter(([x, y]) => !pleached.has(`${x},${y}`));
  const basins = (kinds?.sites ?? []).flatMap((s) => (s.t === "fountain" ? [[s.x, s.y, s.rb + 0.6] as const] : []));
  // Théâtre romain (D133) : rien ne pousse dans la cavea, l'orchestre ni sur la scène (les arbres du sommet restent).
  const theatres = (kinds?.sites ?? []).filter((s) => s.t === "theatre");
  // Temple de Janus (D139) : les « arbres » de 20 m posés sur ses murs étaient les murs eux-mêmes vus par le LiDAR.
  const temples = (kinds?.sites ?? []).filter((s): s is JanusSite => s.t === "janus");
  // Îlot de rond-point (D142) : le relevé avait posé trois arbres de 13 m dans la couronne du cèdre ; l'arbre du site les remplace.
  const islands = (kinds?.sites ?? []).filter((s): s is RoundaboutSite => s.t === "roundabout");
  // Rideaux de tilleuls (D155) : le modèle dessine leurs couronnes et leurs troncs (obstacles : `landmarkCircles`).
  const curtains = (kinds?.sites ?? []).filter((s): s is CurtainSite => s.t === "curtain");
  if (!basins.length && !theatres.length && !temples.length && !islands.length && !curtains.length) return [...trees];
  return trees.filter(([x, y]) => basins.every(([bx, by, r]) => Math.hypot(x - bx, y - by) > r) && theatres.every((t) => !inTheatre(t, x, y))
    && temples.every((t) => !inJanus(t, x, y, 1)) && islands.every((s) => !inRoundabout(s, x, y, 0.5)) && curtains.every((s) => !inCurtain(s, x, y, 0.3)));
}

/** Troncs d'un rideau de tilleuls (D155) : files de troncs tous les `pitch` m le long du grand côté. */
export function curtainTrunks(s: CurtainSite): [number, number][] {
  const f = frameOf(s.c[0], s.c[1], s.a, s.l, s.w);
  const n = Math.max(1, Math.round(s.l / s.pitch));
  const out: [number, number][] = [];
  for (const r of s.rows) for (let i = 0; i < n; i++) out.push(at(f, -s.l / 2 + (s.l * (i + 0.5)) / n, r * s.w));
  return out;
}

/** Dans le rectangle d'un rideau de tilleuls (élargi de `margin`) ? */
export function inCurtain(s: CurtainSite, x: number, y: number, margin = 0): boolean {
  const dx = x - s.c[0], dy = y - s.c[1];
  return Math.abs(dx * Math.cos(s.a) + dy * Math.sin(s.a)) < s.l / 2 + margin && Math.abs(-dx * Math.sin(s.a) + dy * Math.cos(s.a)) < s.w / 2 + margin;
}

/** Sommets de l'octogone du kiosque, à `r` m du centre (D155). */
export function bandstandRing(s: BandstandSite, r = s.r): [number, number][] {
  return Array.from({ length: s.nv }, (_, i) => [s.c[0] + r * Math.cos(s.ph + (2 * Math.PI * i) / s.nv), s.c[1] + r * Math.sin(s.ph + (2 * Math.PI * i) / s.nv)]);
}

/** Rayon du tronc de l'arbre d'un îlot de rond-point (obstacle). */
export const TRUNK_R = 0.45;

/** Dans l'îlot du rond-point (bordure comprise, élargi de `margin`) ? */
export function inRoundabout(s: RoundaboutSite, x: number, y: number, margin = 0): boolean {
  return Math.hypot(x - s.c[0], y - s.c[1]) < s.r + s.curb / 2 + margin;
}

/** Mobilier de la tuile, sauf celui qu'un monument remplace (la fontaine Saint-Lazare, D131) ou retire (lampadaire d'un îlot, D142). */
export function furnitureOutsideMonuments(kinds: { sites: Site[] } | undefined, furniture: readonly Furniture[]): Furniture[] {
  const gone = new Set((kinds?.sites ?? []).flatMap((s) => (s.t === "fountain" ? [s.id] : s.t === "roundabout" ? s.drop : [])));
  return gone.size ? furniture.filter((f) => !gone.has(f.id)) : [...furniture];
}

/** Murs et clôtures de la tuile, sauf ceux qu'un monument remplace (le mur OpenStreetMap fermé du temple de Janus, D139). */
export function wallsOutsideMonuments(kinds: { sites: Site[]; buildings?: Record<string, BuildingKind> } | undefined, walls: readonly Wall[]): Wall[] {
  const gone = new Set([...(kinds?.sites ?? []).flatMap((s) => (s.t === "janus" ? [s.wall] : [])),
    // Grille d'honneur du lycée (D149) : elle remplace la clôture et les murs de parcelle du même tracé.
    ...Object.values(kinds?.buildings ?? {}).flatMap((b) => b.college?.grille?.walls ?? [])]);
  return gone.size ? walls.filter((w) => !gone.has(w.id)) : [...walls];
}

// --- Temple de Janus (D139) ---------------------------------------------------------------------------------------------------------

/** Mur debout du temple : repère local (s le long du mur, depuis le coin extérieur commun ; t en travers, de tA à tB), de d0 à d1. */
export interface JanusSlab {
  f: Frame;
  d0: number;
  d1: number;
  tA: number;
  tB: number;
  wall: JanusWall;
}

/** Les deux murs debout : `S` le long de s ; `W` le long de t, à partir de la face intérieure de `S` (le coin appartient à `S`). */
export function janusSlabs(s: JanusSite): JanusSlab[] {
  const [Ls, Lt] = s.L, [twS, twW] = s.tw;
  return [
    { f: frameOf(s.o[0], s.o[1], s.a, 1, 1), d0: 0, d1: Ls, tA: 0, tB: twS, wall: s.S },
    { f: frameOf(s.o[0], s.o[1], s.a + Math.PI / 2, 1, 1), d0: twS, d1: Lt, tA: -twW, tB: 0, wall: s.W },
  ];
}

/** Dans le carré de la cella (élargi de `margin`) ? */
export function inJanus(s: JanusSite, x: number, y: number, margin = 0): boolean {
  const dx = x - s.o[0], dy = y - s.o[1], c = Math.cos(s.a), n = Math.sin(s.a);
  const ls = dx * c + dy * n, lt = -dx * n + dy * c;
  return ls > -margin && ls < s.L[0] + margin && lt > -margin && lt < s.L[1] + margin;
}

/** Morceaux pleins des murs du temple, entre les arches traversantes : obstacles (on passe par les arches). */
export function janusRings(s: JanusSite): number[][] {
  const out: number[][] = [];
  for (const sl of janusSlabs(s)) {
    const cuts = [sl.d0, ...sl.wall.arches.flatMap(([c, w]) => [c - w / 2, c + w / 2]), sl.d1].filter((v) => v >= sl.d0 && v <= sl.d1).sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]!, b = cuts[i + 1]!, m = (a + b) / 2;
      if (b - a < 0.05 || sl.wall.arches.some(([c, w]) => Math.abs(m - c) < w / 2)) continue;
      out.push([at(sl.f, a, sl.tA), at(sl.f, b, sl.tA), at(sl.f, b, sl.tB), at(sl.f, a, sl.tB)].flat());
    }
  }
  return out;
}

// --- Maison d'après photo (D140) ------------------------------------------------------------------------------------------------------

/** Repère de la maison : origine `o`, s selon l'angle `a`, t de son côté (`sg`). */
export function houseFrame(m: HouseModel): Frame {
  const c = Math.cos(m.a), n = Math.sin(m.a);
  return { x: m.o[0], y: m.o[1], ux: c, uy: n, vx: -n * m.sg, vy: c * m.sg, hl: 1, hw: 1 };
}

/** Un mur du L : de `a` à `b` en (s, t), normale extérieure `n`. */
export interface HouseEdge {
  a: [number, number];
  b: [number, number];
  n: [number, number];
  len: number;
}

/**
 * Les six murs du L, dans l'ordre des ouvertures de `manual.json` : 0 le long du corps (t0), 1 le bout de l'aile côté s1, 2 le bout de
 * l'aile (tw), 3 le côté de l'aile (sw), 4 le mur du corps entre l'aile et le bout (t1), 5 le bout du corps (s0).
 */
export function houseEdges(m: HouseModel): HouseEdge[] {
  const [[s0, s1, t0, t1], [sw, , , tw]] = m.walls;
  const pts: [number, number][] = [[s0, t0], [s1, t0], [s1, tw], [sw, tw], [sw, t1], [s0, t1]];
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { a, b, len, n: [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] };
  });
}

/** Contour des murs en (s, t), avec le renfoncement de l'entrée couverte au coin (sw, tw). */
export function houseOutline(m: HouseModel): [number, number][] {
  const [[s0, s1, t0, t1], [sw, , , tw]] = m.walls;
  const [pw, pd] = m.porch;
  return [[s0, t0], [s1, t0], [s1, tw], [sw + pw, tw], [sw + pw, tw - pd], [sw, tw - pd], [sw, t1], [s0, t1]];
}

/** Obstacle de la maison (à la place du contour BD TOPO, décalé) : ses murs mesurés ; on entre sous l'auvent jusqu'à la porte. */
export function houseRing(m: HouseModel): number[] {
  const f = houseFrame(m);
  return houseOutline(m).flatMap(([s, t]) => at(f, s, t));
}

/** Poteau de l'entrée couverte (x, y). */
export function housePost(m: HouseModel): [number, number] {
  const [, [sw, , , tw]] = m.walls;
  return at(houseFrame(m), sw + 0.12, tw - 0.12);
}

/** Les auvents n'ont pas de murs (on passe dessous) ; un bâtiment masqué est remplacé par un monument (D95). */
export function isOpen(kinds: { buildings: Record<string, BuildingKind> } | undefined, id: string): boolean {
  const k = kinds?.buildings[id]?.k;
  return k === "canopy" || k === "hidden";
}

/** Ouverture d'un mur : de s0 à s1 le long du mur, du bas `zb` jusqu'à la naissance de l'arc `spring` (arc en plein cintre au-dessus). */
export interface Opening {
  s0: number;
  s1: number;
  zb: number;
  spring: number;
}

export interface GateLayout {
  frame: Frame;
  /** Rue au centre (altitude absolue) ; les hauteurs du modèle sont au-dessus. */
  g: number;
  /** Hauteur totale au-dessus de la rue. */
  height: number;
  /** Arches (zb < 0 : passages) et arcades conservées de la galerie (zb = appui). */
  openings: Opening[];
  /** Piles au niveau du sol (s0, s1), obstacles. */
  piers: [number, number][];
  m: GateModel;
  /** Galerie conservée : étendue, murs à arcades (t0, t1), abscisses des pilastres ; null si elle a disparu. */
  gallery: { s0: number; s1: number; walls: [number, number][]; pilasters: number[] } | null;
}

/** Haut du corps en s (profil du modèle, linéaire entre ses points ; au droit d'une marche, le plus haut). */
export function gateTop(m: GateModel, s: number): number {
  const p = m.top;
  let best = -Infinity;
  for (let i = 0; i + 1 < p.length; i++) {
    const [s0, z0] = p[i]!, [s1, z1] = p[i + 1]!;
    if (s < s0 - 1e-6 || s > s1 + 1e-6) continue;
    best = Math.max(best, s1 - s0 < 1e-6 ? Math.max(z0, z1) : z0 + ((z1 - z0) * (s - s0)) / (s1 - s0));
  }
  return best === -Infinity ? m.attic : best;
}

/**
 * Modèle par défaut d'une porte sans lecture de photo (D95) : disposition de la porte d'Arroux mise à l'échelle de la longueur (deux grandes
 * arches de 4,3 m, deux petites de 2,2 m), galerie complète de dix arcades, hauteurs en fractions de la hauteur mesurée au LiDAR.
 */
function defaultGateModel(site: Extract<Site, { t: "gate" }>, ground: number): GateModel {
  const H = Math.min(Math.max((site.top ?? ground + 12) - ground, 7), 20);
  const k = site.l / 18.7, half = site.l / 2;
  const widths = [0.9, 2.2, 1.4, 4.3].map((v) => v * k);
  const mid = site.l - 2 * widths.reduce((a, b) => a + b, 0);
  const seq = [...widths, mid, ...[...widths].reverse()];
  const edges = [-half];
  for (const w of seq) edges.push(edges[edges.length - 1]! + w);
  const piers: [number, number][] = [], arches: [number, number, number][] = [];
  const springs = [0.36 * H - 1.1 * k, 0.58 * H - 2.15 * k];
  for (let i = 0; i < seq.length; i++) {
    if (i % 2 === 0) piers.push([edges[i]!, edges[i + 1]!]);
    else arches.push([edges[i]!, edges[i + 1]!, i === 1 || i === 7 ? springs[0]! : springs[1]!]);
  }
  const pitch = (site.l - 1.2) / 10;
  return {
    c: [site.x, site.y], w: site.w, g: ground, street: [ground, ground], body: H, piers, arches, band: 0.5 * k,
    cornice: [0.63 * H, 0.68 * H], attic: 0.7 * H,
    gal: { s: Array.from({ length: 11 }, (_, i) => -half + 0.6 + pitch * i), open: pitch * 0.62, crown: 0.92 * H, ent: [0.93 * H, H], keep: [0, 9], t: [[-site.w / 2, site.w / 2]] },
    top: [[-half, 0.7 * H], [half, 0.7 * H]], rubble: [],
  };
}

/**
 * Disposition d'une porte romaine d'Autun : le modèle lu sur photo et mesuré (`gm`, D137), sinon le modèle par défaut (D95). Deux grandes
 * arches au centre (voitures), deux petites aux bouts (piétons), corniche, attique, galerie à arcades sur pilastres, entablement.
 */
export function gateLayout(site: Extract<Site, { t: "gate" }>, ground: number): GateLayout {
  const m = site.gm ?? defaultGateModel(site, ground);
  const frame = frameOf(m.c[0], m.c[1], site.a, m.l ?? site.l, m.w);
  const openings: Opening[] = m.arches.map(([s0, s1, spring]) => ({ s0, s1, zb: -1, spring }));
  const [i0, i1] = m.gal.keep;
  let gallery: GateLayout["gallery"] = null;
  if (i1 >= i0) {
    const pil = m.gal.s.slice(i0, i1 + 2);
    for (let i = i0; i <= i1; i++) {
      const c = (m.gal.s[i]! + m.gal.s[i + 1]!) / 2, r = m.gal.open / 2;
      openings.push({ s0: c - r, s1: c + r, zb: m.attic, spring: m.gal.crown - r });
    }
    gallery = { s0: Math.min(...pil), s1: Math.max(...pil), walls: m.gal.t, pilasters: pil };
  }
  const height = Math.max(gallery ? m.gal.ent[1] : 0, m.block?.[2] ?? 0, m.roof?.[1] ?? 0, m.tower?.[4] ?? 0, ...m.top.map((p) => p[1]));
  return { frame, g: site.gm ? m.g : ground, height, openings, piers: m.piers, m, gallery };
}

/** Contours des obstacles des monuments : piles des portes romaines (on passe sous les arches) et leur tour, murs du temple de Janus. */
export function landmarkRings(kinds: { sites: Site[] } | undefined, ground: (x: number, y: number) => number): number[][] {
  const out: number[][] = [];
  for (const s of kinds?.sites ?? []) {
    if (s.t === "janus") out.push(...janusRings(s));
    // Kiosque à musique (D155) : le contour BD TOPO (le toit déborde du socle de 50 cm), comme avant ; on n'y monte pas.
    if (s.t === "bandstand") out.push(bandstandRing(s).flat());
    if (s.t !== "gate") continue;
    const lay = gateLayout(s, ground(s.x, s.y));
    const f = lay.frame;
    for (const [s0, s1] of lay.piers) {
      const pts = [at(f, s0, -f.hw), at(f, s1, -f.hw), at(f, s1, f.hw), at(f, s0, f.hw)];
      out.push(pts.flat());
    }
    // Tour de moellons à un bout (Saint-André, D138), qui déborde des faces.
    if (lay.m.tower) {
      const [s0, s1, t0, t1] = lay.m.tower;
      out.push([at(f, s0, t0), at(f, s1, t0), at(f, s1, t1), at(f, s0, t1)].flat());
    }
  }
  return out;
}

// --- Porche praticable de la cathédrale (D132) -----------------------------------------------------------------------------------------

/**
 * Disposition du porche (repère de la cathédrale, s vers le chevet, t vers l'est-nord-est) : murs de 1 m, salle entre iA et iB, grand arc de
 * largeur `Wo` en façade, voûte de naissance zV ; parvis zA, palier zP, seuil zD (mesurés) ; trois marches devant la façade de sE à p0 sur
 * toute sa largeur (tE0 à tE1, tours comprises) ; volée intérieure de sR0 à sR1, puis le palier des portes jusqu'au mur ouest de la nef (n0).
 */
export function porchLayout(m: CathedralModel) {
  const [p0, n0, pA, pB, pe] = m.porch;
  const [w0, w1] = m.towers;
  const [zA, zP, zD] = m.entry;
  const TH = 1.0, iA = pA + TH, iB = pB - TH, Rv = (iB - iA) / 2;
  return {
    p0, n0, pA, pB, pc: (pA + pB) / 2, TH, iA, iB, Rv, zV: Math.min(zD + 7.5, pe - 0.8 - Rv), Wo: Math.min(7.5, iB - iA - 1.5),
    zA, zP, zD, sE: p0 - 1.6, sR0: p0 + TH + 0.2, sR1: n0 - 1.5, tE0: pA - w0, tE1: pB + w1, w0, w1,
  };
}

/** Tabliers invisibles du porche : les marches de la façade (du parvis au palier) et la volée intérieure jusqu'au seuil des portes. */
export function porchDecks(m: CathedralModel): Deck[] {
  const L = porchLayout(m);
  const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
  const axis = (t: number, pts: [number, number][]): number[] => pts.flatMap(([s, z]) => [...at(f, s, t), z]);
  const deck = (id: number, w: number, p: number[]): Deck => ({ id, k: "foot", w, p, st: "light", sp: [], pc: [] });
  return [
    deck(-132001, L.tE1 - L.tE0, axis((L.tE0 + L.tE1) / 2, [[L.sE, L.zA], [L.p0, L.zP]])),
    deck(-132002, L.iB - L.iA, axis(L.pc, [[L.p0, L.zP], [L.sR0, L.zP], [L.sR1, L.zD], [L.n0 + 0.2, L.zD]])),
  ];
}

/** Tabliers des monuments d'une tuile (porche de la cathédrale ; escaliers et scène du théâtre romain, D133). */
export function landmarkDecks(kinds: { buildings: Record<string, BuildingKind>; sites?: Site[] } | undefined): Deck[] {
  return [
    ...Object.values(kinds?.buildings ?? {}).flatMap((k) => (k.cath?.entry ? porchDecks(k.cath) : [])),
    ...(kinds?.sites ?? []).flatMap((s) => (s.t === "theatre" ? theatreDecks(s) : [])),
  ];
}

/** Tabliers en secteurs d'anneau (gradins, précinction et massifs du théâtre romain, D133). */
export function landmarkSectors(kinds: { sites?: Site[] } | undefined): DeckSector[] {
  return (kinds?.sites ?? []).flatMap((s) => (s.t === "theatre" ? theatreSectors(s) : []));
}

/**
 * Obstacles de la cathédrale (lignes) : l'emprise, sauf devant le porche (marches et grand arc), plus les tours, les piles de l'arc, les
 * murs de la salle du porche et les portes fermées, et les grilles de part et d'autre de la volée (on passe entre elles).
 */
export function cathedralWalls(b: Building, m: CathedralModel): { lines: number[][]; grilles: number[][] } {
  const L = porchLayout(m);
  const f = frameOf(m.c[0], m.c[1], m.a, 1, 1);
  const ca = Math.cos(m.a), sa = Math.sin(m.a);
  const st = (x: number, y: number): [number, number] => [(x - m.c[0]) * ca + (y - m.c[1]) * sa, -(x - m.c[0]) * sa + (y - m.c[1]) * ca];
  const line = (pts: [number, number][]): number[] => pts.flatMap(([s, t]) => at(f, s, t));
  const rect = (s0: number, s1: number, t0: number, t1: number): number[] => line([[s0, t0], [s1, t0], [s1, t1], [s0, t1], [s0, t0]]);
  const lines: number[][] = [];
  const r = b.ring, n = r.length / 2;
  let run: number[] = [];
  for (let i = 0; i <= n; i++) {
    const j = i % n, k = (i + 1) % n;
    const [ms, mt] = st((r[2 * j]! + r[2 * k]!) / 2, (r[2 * j + 1]! + r[2 * k + 1]!) / 2);
    const open = i === n || (ms < L.p0 + 0.5 && mt > L.tE0 - 1 && mt < L.tE1 + 1);
    if (!open) {
      if (!run.length) run.push(r[2 * j]!, r[2 * j + 1]!);
      run.push(r[2 * k]!, r[2 * k + 1]!);
    } else if (run.length) {
      lines.push(run);
      run = [];
    }
  }
  if (run.length) lines.push(run);
  const { p0, n0, pA, pB, pc, TH, iA, iB, Wo, w0, w1 } = L;
  lines.push(rect(p0, p0 + w0, pA - w0, pA), rect(p0, p0 + w1, pB, pB + w1));
  lines.push(rect(p0, p0 + TH, pA, pc - Wo / 2), rect(p0, p0 + TH, pc + Wo / 2, pB));
  lines.push(line([[p0 + TH, iA], [n0, iA], [n0, iB], [p0 + TH, iB]]));
  const sg = p0 + TH + 0.15;
  const grilles = [line([[sg, iA], [sg, pc - 1.6]]), line([[sg, pc + 1.6], [sg, iB]])];
  return { lines, grilles };
}

// --- L'Hexagone (D165) ------------------------------------------------------------------------------------------------------------

/** Rayon d'obstacle du mobilier du parvis de l'Hexagone (D168) ; les arceaux à vélos se franchissent. */
export const HEX_PROP_RADIUS: Readonly<Record<string, number>> = { sphere: 1.4, column: 0.9, lamp: 0.15, flag: 0.1, planter: 1.5, rack: 0 };

/** Normales des six côtés de la couronne de l'Hexagone (caps, degrés). */
export const HEX_SIDES = [35, 95, 155, 215, 275, 335] as const;

export interface HexagoneShape {
  /** Les 12 sommets du pied de la pyramide, le premier au cap `hip`. */
  foot: [number, number][];
  /** Les 12 sommets de la rupture de pente (haut du jupon). */
  mid: [number, number][];
}

const dir = (cap: number): [number, number] => [Math.sin((cap * Math.PI) / 180), Math.cos((cap * Math.PI) / 180)];

/** Pied et rupture de pente de la pyramide à 12 pans de l'Hexagone. */
export function hexagoneShape(m: HexagoneModel): HexagoneShape {
  const ring = (apothem: number): [number, number][] => {
    const R = apothem / Math.cos(Math.PI / 12);
    return Array.from({ length: 12 }, (_, i) => {
      const [dx, dy] = dir(m.hip + 30 * i);
      return [m.c[0] + R * dx, m.c[1] + R * dy] as [number, number];
    });
  };
  return { foot: ring(m.apothem), mid: ring(m.skirt[0]) };
}

/** Point du pied de la pyramide dans la direction `cap` (cap depuis le sommet). */
export function hexagoneFootAt(m: HexagoneModel, cap: number): [number, number] {
  const face = m.hip + 15;
  const off = ((((cap - face) % 30) + 45) % 30) - 15;
  const r = m.apothem / Math.cos((off * Math.PI) / 180);
  const [dx, dy] = dir(cap);
  return [m.c[0] + r * dx, m.c[1] + r * dy];
}
