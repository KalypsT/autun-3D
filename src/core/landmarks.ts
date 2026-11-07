import type { Arcade, Building, BuildingKind, BuildingKindId, Carport, CathedralModel, CollegeSpec, CouhardSite, CurtainSite, BandstandSite, Deck, MemorialSite, Furniture, GateModel, HexagoneModel, HouseModel, JanusSite, PlayhouseModel, StationModel, EduenModel, McdoModel, BowlingModel, MeasuredPiece, JanusWall, PassageSite, RoundaboutSite, Site, StoreModel, Tree, Wall } from "../data/types";
import { gateCircles } from "./school-gate";
import { HOOP, hoopPole } from "./hoops";
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
  // Statue du chien du passage Balthus (D189).
  for (const s of kinds.sites) if (s.t === "passage") out.push([...passagePoint(s, PASSAGE_DOG.s, PASSAGE_DOG.t), PASSAGE_DOG.r]);
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
  // Pierre de Couhard (D222) : piquets de la clôture et panneau d'information.
  for (const s of kinds.sites) {
    if (s.t !== "couhard") continue;
    for (const [x, y] of couhardPosts(s)) out.push([x, y, 0.08]);
    const [px, py] = couhardPanel(s);
    out.push([px, py, 0.5]);
  }
  // Lycée (D149) : troncs des arbres taillés en rideau derrière la grille.
  for (const k of Object.values(kinds.buildings)) for (const [x, y] of k.college?.grille?.trees ?? []) out.push([x, y, 0.3]);
  // Lycée militaire (D260) : piles des deux portails, poteaux de la barrière levante et du panneau.
  for (const k of Object.values(kinds.buildings)) {
    const g = k.college?.mil?.gates;
    if (!g) continue;
    for (const p of [g.avenue.a, g.avenue.b]) out.push([p[0], p[1], 0.7]);
    for (const p of [g.joliet.a, g.joliet.b]) out.push([p[0], p[1], 0.45]);
    out.push([g.joliet.lift[0], g.joliet.lift[1], 0.2], [g.joliet.sign[0], g.joliet.sign[1], 0.08]);
  }
  // Jardins du Lycée militaire (D261) : ifs taillés (aux trois quarts de leur rayon : on frôle le feuillage), mât de drapeau.
  for (const k of Object.values(kinds.buildings)) {
    const gd = k.college?.mil?.garden;
    if (!gd) continue;
    for (const [x, y, r] of gd.yews) out.push([x, y, r * 0.75]);
    for (const [x, y] of gd.pleached?.trees ?? []) out.push([x, y, 0.3]);
    out.push([gd.mast[0], gd.mast[1], 0.6]);
  }
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
    // Quais de la gare (D229) : colonnes de l'abri parapluie, abri vitré.
    const sta = kinds.buildings[b.id]?.sta;
    if (sta) out.push(...stationCircles(sta));
  }
  // Paniers de basket des terrains (D176) : le poteau, derrière le panneau.
  for (const s of kinds.sites) if (s.t === "pitch") for (const h of s.hoops ?? []) out.push([...hoopPole(h), HOOP.poleRadius]);
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
  // Arbres taillés en rideau : derrière la grille du lycée Bonaparte (D149), sur le glacis du Lycée militaire (D264).
  const pleached = new Set(Object.values(kinds?.buildings ?? {}).flatMap((b) => [...(b.college?.grille?.trees ?? []), ...(b.college?.mil?.garden?.pleached?.trees ?? [])].map(([x, y]) => `${x},${y}`)));
  if (pleached.size) trees = trees.filter(([x, y]) => !pleached.has(`${x},${y}`));
  const basins = (kinds?.sites ?? []).flatMap((s) => (s.t === "fountain" ? [[s.x, s.y, s.rb + 0.6] as const] : []));
  // Théâtre romain (D133) : rien ne pousse dans la cavea, l'orchestre ni sur la scène (les arbres du sommet restent).
  const theatres = (kinds?.sites ?? []).filter((s) => s.t === "theatre");
  // Temple de Janus (D139) : les « arbres » de 20 m posés sur ses murs étaient les murs eux-mêmes vus par le LiDAR.
  const temples = (kinds?.sites ?? []).filter((s): s is JanusSite => s.t === "janus");
  // Pierre de Couhard (D222) : rien ne pousse sur la maçonnerie (le modèle dessine ses touffes).
  const pyramids = (kinds?.sites ?? []).filter((s): s is CouhardSite => s.t === "couhard");
  // Îlot de rond-point (D142) : le relevé avait posé trois arbres de 13 m dans la couronne du cèdre ; l'arbre du site les remplace.
  const islands = (kinds?.sites ?? []).filter((s): s is RoundaboutSite => s.t === "roundabout");
  // Rideaux de tilleuls (D155) : le modèle dessine leurs couronnes et leurs troncs (obstacles : `landmarkCircles`).
  const curtains = (kinds?.sites ?? []).filter((s): s is CurtainSite => s.t === "curtain");
  // Monument aux morts (D227) : le relevé avait pris le génie ailé pour un arbre de 7,9 m.
  const memorials = (kinds?.sites ?? []).filter((s): s is MemorialSite => s.t === "memorial");
  if (!basins.length && !theatres.length && !temples.length && !pyramids.length && !islands.length && !curtains.length && !memorials.length) return [...trees];
  return trees.filter(([x, y]) => basins.every(([bx, by, r]) => Math.hypot(x - bx, y - by) > r) && theatres.every((t) => !inTheatre(t, x, y))
    && temples.every((t) => !inJanus(t, x, y, 1)) && pyramids.every((p) => !inCouhard(p, x, y, 1)) && islands.every((s) => !inRoundabout(s, x, y, 0.5)) && curtains.every((s) => !inCurtain(s, x, y, 0.3))
    && memorials.every((s) => !inMemorial(s, x, y, 1)));
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

/** Sur l'esplanade du monument aux morts (degré du bas élargi de `margin`, D227) ? */
export function inMemorial(s: MemorialSite, x: number, y: number, margin = 0): boolean {
  const dx = x - s.c[0], dy = y - s.c[1];
  return Math.abs(dx * Math.cos(s.a) + dy * Math.sin(s.a)) < s.steps[0]![0] / 2 + margin && Math.abs(-dx * Math.sin(s.a) + dy * Math.cos(s.a)) < s.steps[0]![1] / 2 + margin;
}

/** Contour du degré du bas de l'esplanade du monument aux morts, élargi de `margin` (D227). */
export function memorialRing(s: MemorialSite, margin = 0): [number, number][] {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const [d, w] = s.steps[0]!;
  const hs = d / 2 + margin, ht = w / 2 + margin;
  return [at(f, -hs, -ht), at(f, hs, -ht), at(f, hs, ht), at(f, -hs, ht)];
}

/** Rayon du tronc de l'arbre d'un îlot de rond-point (obstacle). */
export const TRUNK_R = 0.45;

/** Dans l'îlot du rond-point (bordure comprise, élargi de `margin`) ? */
export function inRoundabout(s: RoundaboutSite, x: number, y: number, margin = 0): boolean {
  return Math.hypot(x - s.c[0], y - s.c[1]) < s.r + s.curb / 2 + margin;
}

/** Mobilier de la tuile, sauf celui qu'un monument remplace (la fontaine Saint-Lazare, D131) ou retire (lampadaire d'un îlot, D142). */
export function furnitureOutsideMonuments(kinds: { sites: Site[] } | undefined, furniture: readonly Furniture[]): Furniture[] {
  // Monument aux morts d'après photos (D227) : il remplace le pavé générique du point OpenStreetMap.
  const gone = new Set((kinds?.sites ?? []).flatMap((s) => (s.t === "fountain" || s.t === "memorial" ? [s.id] : s.t === "roundabout" ? s.drop : [])));
  return gone.size ? furniture.filter((f) => !gone.has(f.id)) : [...furniture];
}

/** Murs et clôtures de la tuile, sauf ceux qu'un monument remplace (le mur OpenStreetMap fermé du temple de Janus, D139). */
export function wallsOutsideMonuments(kinds: { sites: Site[]; buildings?: Record<string, BuildingKind> } | undefined, walls: readonly Wall[]): Wall[] {
  const gone = new Set([...(kinds?.sites ?? []).flatMap((s) => (s.t === "janus" ? [s.wall] : [])),
    // Grille d'honneur du lycée (D149) : elle remplace la clôture et les murs de parcelle du même tracé.
    ...Object.values(kinds?.buildings ?? {}).flatMap((b) => b.college?.grille?.walls ?? []),
    // Clôture de la gendarmerie (D238) : elle remplace les clôtures de parcelle de même tracé.
    ...Object.values(kinds?.buildings ?? {}).flatMap((b) => b.gend?.site?.walls ?? [])]);
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

// --- Pierre de Couhard (D222) ----------------------------------------------------------------------------------------------------------

/** Rayon de la section `li` (indice dans `lv`) au cap `cap` (degrés depuis le nord, sens horaire), interpolé entre secteurs. */
export function couhardRadius(s: CouhardSite, li: number, cap: number): number {
  const row = s.r[Math.min(Math.max(li, 0), s.r.length - 1)]!, n = row.length;
  const u = (((cap % 360) + 360) % 360) / (360 / n), i = Math.floor(u) % n, k = u - Math.floor(u);
  return row[i]! + (row[(i + 1) % n]! - row[i]!) * k;
}

/** Point à `r` m de l'axe au cap `cap`. */
export function couhardAt(s: CouhardSite, cap: number, r: number): [number, number] {
  const a = (cap * Math.PI) / 180;
  return [s.c[0] + r * Math.sin(a), s.c[1] + r * Math.cos(a)];
}

/** Contour du pied (élargi de `margin`), `n` sommets. */
export function couhardFoot(s: CouhardSite, margin = 0, n = 48): [number, number][] {
  return Array.from({ length: n }, (_, i) => { const cap = (360 * i) / n; return couhardAt(s, cap, couhardRadius(s, 0, cap) + margin); });
}

/** Dans le pied de la pyramide (élargi de `margin`) ? */
export function inCouhard(s: CouhardSite, x: number, y: number, margin = 0): boolean {
  const cap = (Math.atan2(x - s.c[0], y - s.c[1]) * 180) / Math.PI;
  return Math.hypot(x - s.c[0], y - s.c[1]) < couhardRadius(s, 0, cap) + margin;
}

/** Panneau d'information : au cap `panel[0]`, à `panel[1]` m au-delà de la clôture. */
export function couhardPanel(s: CouhardSite): [number, number] {
  const [cap, off] = s.panel;
  return couhardAt(s, cap, couhardRadius(s, 0, cap) + s.fence.gap + off);
}

/** Piquets de la clôture : tous les `step` m environ sur le contour du pied élargi de `gap`. */
export function couhardPosts(s: CouhardSite): [number, number][] {
  const ring = couhardFoot(s, s.fence.gap, 96);
  let len = 0;
  for (let i = 0; i < ring.length; i++) len += Math.hypot(ring[(i + 1) % ring.length]![0] - ring[i]![0], ring[(i + 1) % ring.length]![1] - ring[i]![1]);
  const n = Math.max(8, Math.round(len / s.fence.step));
  return Array.from({ length: n }, (_, i) => { const cap = (360 * i) / n; return couhardAt(s, cap, couhardRadius(s, 0, cap) + s.fence.gap); });
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

// --- Théâtre municipal (D223) ----------------------------------------------------------------------------------------------------------

/** Repère du théâtre municipal : origine au coin gauche de la façade, s le long de la façade, t vers l'intérieur. */
export function playhouseFrame(m: PlayhouseModel): Frame {
  return frameOf(m.o[0], m.o[1], m.a, 1, 1);
}

/** Contour des murs en (s, t), dans le sens trigonométrique : façade et retour des pavillons, côtés en retrait, cage de scène. */
export function playhouseOutline(m: PlayhouseModel): [number, number][] {
  return [[0, 0], [m.w, 0], [m.w, m.ts], [m.w - m.iR, m.ts], [m.w - m.iR, m.tr], [m.iL, m.tr], [m.iL, m.ts], [0, m.ts]];
}

/** Obstacle du théâtre (à la place du contour BD TOPO, plus étroit d'un mètre et qui compte le perron dans le bâtiment) : ses murs mesurés. */
export function playhouseRing(m: PlayhouseModel): number[] {
  const f = playhouseFrame(m);
  return playhouseOutline(m).flatMap(([s, t]) => at(f, s, t));
}

// --- Gare (D228) -------------------------------------------------------------------------------------------------------------------

/** Repère de la gare : origine au coin ouest de la façade des ailes sur le parvis, s le long de la façade, t vers les voies. */
export function stationFrame(m: StationModel): Frame {
  return frameOf(m.o[0], m.o[1], m.a, 1, 1);
}

/** Contour des murs en (s, t), dans le sens trigonométrique : ailes, pavillon qui déborde des deux côtés, aile en retour vers le parvis. */
export function stationOutline(m: StationModel): [number, number][] {
  const [p0, p1, q0, q1] = m.pav, [r0, rt] = m.ret;
  return [[0, 0], [p0, 0], [p0, q0], [p1, q0], [p1, 0], [r0, 0], [r0, rt], [m.l, rt], [m.l, m.d], [p1, m.d], [p1, q1], [p0, q1], [p0, m.d], [0, m.d]];
}

/** Colonnes de l'abri parapluie du quai central (D229), en (s, t) : deux files, environ tous les 4,5 m. */
export function stationShelterColumns(m: StationModel): [number, number][] {
  if (!m.quai) return [];
  const [s0, s1, t0, t1] = m.quai.sh;
  const tc = (t0 + t1) / 2, n = Math.max(2, Math.round((s1 - s0 - 3) / 4.5) + 1);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (const k of [-1, 1]) out.push([s0 + 1.5 + ((s1 - s0 - 3) * i) / (n - 1), tc + k * 1.1]);
  return out;
}

/** Petit abri vitré du quai central (D229) : longueur le long des voies, profondeur. */
export const GLASS_SHELTER: readonly [number, number] = [3.2, 1.4];

/** Abri de bus de la gare routière (D230) : longueur le long de l'axe de l'arrêt, profondeur. */
export const BUS_SHELTER: readonly [number, number] = [4.2, 1.5];

/** Point (s, t) du repère de l'arrêt de bus (D230) : u le long de l'axe du zigzag, w vers la gare. */
export function busPoint(p: NonNullable<StationModel["parvis"]>, u: number, w: number): [number, number] {
  const { o, dir } = p.bus;
  return [o[0] + dir[0] * u - dir[1] * w, o[1] + dir[1] * u + dir[0] * w];
}

/** Point (s, t) du repère de l'abri de parking (D230) : u le long du bord bas, w vers l'intérieur. */
export function carportPoint(p: NonNullable<StationModel["parvis"]>, u: number, w: number): [number, number] {
  const [s0, t0, a, side] = p.carport;
  const ux = Math.cos(a), uy = Math.sin(a), nx = side > 0 ? -uy : uy, ny = side > 0 ? ux : -ux;
  return [s0 + ux * u + nx * w, t0 + uy * u + ny * w];
}

/** Poteaux de l'abri de parking (D230), en (u, w) : deux files, environ tous les 4 m. */
export function carportPosts(p: NonNullable<StationModel["parvis"]>): [number, number][] {
  const [, , , , L, W] = p.carport;
  const n = Math.max(2, Math.round(L / 4) + 1), out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (const w of [0.5, W - 0.5]) out.push([0.4 + ((L - 0.8) * i) / (n - 1), w]);
  return out;
}

/**
 * Obstacles des quais (D229 : colonnes de l'abri parapluie, petit abri vitré) et du parvis (D230 : lampadaires, vasques, banc, abri de bus,
 * poteaux de l'abri de parking) de la gare.
 */
export function stationCircles(m: StationModel): [number, number, number][] {
  const f = stationFrame(m);
  const out: [number, number, number][] = [];
  if (m.quai) {
    out.push(...stationShelterColumns(m).map(([s, t]): [number, number, number] => [...at(f, s, t), 0.16]));
    const [gs, gt] = m.quai.glass;
    for (const k of [-1, 0, 1]) out.push([...at(f, gs + k * (GLASS_SHELTER[0] / 2 - 0.6), gt), 0.7]);
  }
  const p = m.parvis;
  if (p) {
    for (const [s, t] of p.lamps) out.push([...at(f, s, t), 0.15]);
    for (const [s, t, r] of p.planters) out.push([...at(f, s, t), r]);
    for (const k of [-1, 1]) out.push([...at(f, p.bench[0] + k * 0.8, p.bench[1]), 0.45]);
    const [bu, bw] = p.bus.shelter;
    for (const k of [-1, 0, 1]) out.push([...at(f, ...busPoint(p, bu + k * (BUS_SHELTER[0] / 2 - 0.7), bw)), 0.7]);
    for (const [u, w] of carportPosts(p)) out.push([...at(f, ...carportPoint(p, u, w)), 0.15]);
  }
  return out;
}

/** Mur blanc du parvis (D230) : polyligne (x, y) en coordonnées du monde, ou null. */
export function stationWall(m: StationModel): number[] | null {
  if (!m.parvis) return null;
  const f = stationFrame(m), [s0, s1, t] = m.parvis.wall;
  return [...at(f, s0, t), ...at(f, s1, t)];
}

/** Obstacle de la gare (à la place du contour BD TOPO, décalé d'environ 1,2 m vers les voies) : ses murs mesurés. */
export function stationRing(m: StationModel): number[] {
  const f = stationFrame(m);
  return stationOutline(m).flatMap(([s, t]) => at(f, s, t));
}

// --- Parc des expositions l'Eduen (D231) ------------------------------------------------------------------------------------------

/** Repère de l'Eduen : origine au coin ouest de la grande salle, s le long de la route de Chalon (vers le sud-est), t vers le parking. */
export function eduenFrame(m: EduenModel): Frame {
  return frameOf(m.o[0], m.o[1], m.a, 1, 1);
}

/** Un bloc plus bas que ceci au-dessus du sol est l'auvent de l'entrée (dalle sur poteaux, on passe dessous). */
export const EDUEN_CANOPY_H = 2.8;

/** Bord du hall courbe, en (s, t), décalé de `inset` vers l'intérieur (0 : l'auvent ; `rot.ov` : le mur). */
export interface EduenEdge {
  /** Angles (radians, autour du centre) du départ sur le mur de la salle et de la rencontre avec le bord nord-est. */
  a0: number;
  a1: number;
  /** Rayon du cercle et ordonnée à l'origine de la droite nord-est (t = k·s + b) pour ce décalage. */
  r: number;
  b: number;
}

export function eduenEdge(m: EduenModel, inset: number): EduenEdge {
  const { c: [cs, ct], ne: [k] } = m.rot;
  const r = m.rot.r - inset, b = m.rot.ne[1] - inset * Math.hypot(1, k);
  const a0 = Math.atan2(-Math.sqrt(Math.max(0, r * r - (m.l - cs) ** 2)), m.l - cs);
  // Rencontre de l'arc et de la droite : dichotomie sur l'angle (une seule racine entre le départ et le quart de tour).
  const f = (a: number): number => ct + r * Math.sin(a) - (k * (cs + r * Math.cos(a)) + b);
  let lo = a0, hi = Math.PI / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return { a0, a1: lo, r, b };
}

/** Points de l'arc (s, t) d'un bord, tous les 3° environ, du mur de la salle à la rencontre avec la droite nord-est. */
export function eduenArc(m: EduenModel, e: EduenEdge): [number, number][] {
  const [cs, ct] = m.rot.c;
  const n = Math.max(8, Math.ceil((e.a1 - e.a0) / ((3 * Math.PI) / 180)));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = e.a0 + ((e.a1 - e.a0) * i) / n;
    out.push([cs + e.r * Math.cos(a), ct + e.r * Math.sin(a)]);
  }
  out[0] = [m.l, out[0]![1]];
  return out;
}

/** Contour des murs du hall courbe et de l'annexe (s, t), sens trigonométrique : arc, mur nord-est, mur ouest de l'annexe, mur de la salle. */
export function eduenHallOutline(m: EduenModel): [number, number][] {
  const e = eduenEdge(m, m.rot.ov), k = m.rot.ne[0];
  return [...eduenArc(m, e), [m.l, k * m.l + e.b]];
}

/**
 * Toit-auvent du hall courbe (s, t) : arc et bord nord-est de l'auvent jusqu'au bout de l'annexe, puis l'annexe contournée ; `inset` :
 * le même contour en retrait de ce nombre de mètres (le toit plein, en deçà des brise-soleil, D232).
 */
export function eduenCanopy(m: EduenModel, inset = 0): [number, number][] {
  const e = eduenEdge(m, inset), [sA, tA] = m.rot.ann, k = m.rot.ne[0];
  return [...eduenArc(m, e), [sA, k * sA + e.b], [sA, tA], [m.l, tA]];
}

/**
 * Pieds des trois mâts à drapeaux (s, t) : relevés sur l'orthophotographie (bases de leurs ombres, D233) sur la bande verte entre l'allée de
 * service et l'avenue ; sans relevé, en ligne au-delà du bout nord-est de l'auvent (D232).
 */
export function eduenMasts(m: EduenModel): [number, number][] {
  if (m.site) return m.site.masts;
  const { c: [cs, ct], r } = m.rot, a = eduenEdge(m, 0).a1;
  return [0, 1, 2].map((i) => [cs + (r + 3 + 3 * i) * Math.cos(a) + 2, ct + (r + 3 + 3 * i) * Math.sin(a) + 1.5]);
}

/** Hauteur de la clôture verte de l'Eduen, de la haie de l'îlot, du bras de la barrière (D233). */
export const EDUEN_FENCE_H = 1.8, EDUEN_HEDGE_H = 1.3, EDUEN_BARRIER_H = 1.0;

/** Lignes d'obstacles des abords de l'Eduen (x, y), avec leur nature : clôture, haie, bras de barrière. */
export function eduenLines(m: EduenModel): { kind: "fence" | "hedge" | "barrier"; pts: number[] }[] {
  if (!m.site) return [];
  const f = eduenFrame(m), xy = (p: readonly [number, number][]): number[] => p.flatMap(([s, t]) => at(f, s, t));
  return [{ kind: "fence", pts: xy(m.site.fence) }, { kind: "hedge", pts: xy(m.site.hedge) }, { kind: "barrier", pts: xy(m.site.barrier) }];
}

/** Obstacles de l'Eduen (x, y) : la salle, ses blocs (pas l'auvent de l'entrée), le hall courbe et l'annexe à leurs murs, les mâts. */
export function eduenRings(m: EduenModel): number[][] {
  const f = eduenFrame(m);
  const rect = (s0: number, s1: number, t0: number, t1: number): number[] => [...at(f, s0, t0), ...at(f, s1, t0), ...at(f, s1, t1), ...at(f, s0, t1)];
  const out = [rect(0, m.l, 0, m.d)];
  for (const [s0, s1, t0, t1, z] of m.blocks) if (z - m.g >= EDUEN_CANOPY_H) out.push(rect(s0, s1, t0, t1));
  out.push(eduenHallOutline(m).flatMap(([s, t]) => at(f, s, t)));
  for (const [s, t] of eduenMasts(m)) out.push(rect(s - 0.1, s + 0.1, t - 0.1, t + 0.1));
  if (m.site) {
    const [s, t] = m.site.light;
    out.push(rect(s - 0.2, s + 0.2, t - 0.2, t + 0.2));
  }
  return out;
}

// --- McDonald's et bowling de la route de Chalon (D234) --------------------------------------------------------------------------

/** Repère du McDonald's : origine au coin sud-ouest du corps, s le long de la route (vers l'est-sud-est), t vers le nord-nord-est. */
export function mcdoFrame(m: McdoModel): Frame {
  return frameOf(m.o[0], m.o[1], m.a, 1, 1);
}

/** Contour (s, t) de la véranda : son bord extérieur, puis son pied contre le corps, à rebours (les points confondus sont retirés). */
export function mcdoVerandaOutline(m: McdoModel): [number, number][] {
  const pts = [...m.ver.o, ...[...m.ver.i].reverse()];
  return pts.filter((p, k) => {
    const q = pts[(k + 1) % pts.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05;
  });
}

/** Section du fût du totem, demi-largeur d'un panneau du menu le long de t et son épaisseur (D235). */
export const MCDO_TOTEM = 0.6, MCDO_MENU: readonly [number, number] = [0.8, 0.25];

/**
 * Obstacles du McDonald's (x, y) : le corps et la véranda à leurs murs mesurés (le contour BD TOPO ne couvre ni l'un ni l'autre) ; le fût
 * du totem, les poteaux du portique et les panneaux du menu (D235).
 */
export function mcdoRings(m: McdoModel): number[][] {
  const f = mcdoFrame(m);
  const rect = (s0: number, s1: number, t0: number, t1: number): number[] => [...at(f, s0, t0), ...at(f, s1, t0), ...at(f, s1, t1), ...at(f, s0, t1)];
  const out = [rect(0, m.l, 0, m.d), mcdoVerandaOutline(m).flatMap(([s, t]) => at(f, s, t))];
  if (m.site) {
    const { totem: [ts, tt], gantry: [g0, g1, gt], menus } = m.site, h = MCDO_TOTEM / 2;
    out.push(rect(ts - h, ts + h, tt - h, tt + h));
    for (const s of [g0, g1]) out.push(rect(s - 0.15, s + 0.15, gt - 0.15, gt + 0.15));
    for (const [s, t] of menus) out.push(rect(s - MCDO_MENU[1] / 2, s + MCDO_MENU[1] / 2, t - MCDO_MENU[0], t + MCDO_MENU[0]));
    // Abords (D236) : pied des parasols et des lanternes, gros pot, poteaux du panneau « DRIVE ».
    for (const [s, t] of [...(m.site.parasols ?? []), ...(m.site.lamps ?? [])]) out.push(rect(s - 0.08, s + 0.08, t - 0.08, t + 0.08));
    if (m.site.pot) out.push(rect(m.site.pot[0] - MCDO_POT, m.site.pot[0] + MCDO_POT, m.site.pot[1] - MCDO_POT, m.site.pot[1] + MCDO_POT));
    if (m.site.sign) for (const k of [-1, 1]) out.push(rect(m.site.sign[0] + k * 0.6 - 0.06, m.site.sign[0] + k * 0.6 + 0.06, m.site.sign[1] - 0.06, m.site.sign[1] + 0.06));
  }
  return out;
}

/** Demi-côté du gros pot rouge de l'entrée (D236). */
export const MCDO_POT = 0.75;
/** Hauteur des garde-corps des terrasses, de la haie de la D680 (D236). */
export const TERRACE_RAIL_H = 1.0, ROADSIDE_HEDGE_H = 1.6;

/** Lignes d'obstacles des abords (x, y) : garde-corps des terrasses (on voit et on enjambe), haie de la D680 (D236). */
export function roadsideLines(m: { mcd?: McdoModel; bowl?: BowlingModel }): { kind: "fence" | "hedge"; pts: number[] }[] {
  const out: { kind: "fence" | "hedge"; pts: number[] }[] = [];
  if (m.mcd?.site?.rails) {
    const f = mcdoFrame(m.mcd);
    for (const r of m.mcd.site.rails) out.push({ kind: "fence", pts: r.flatMap(([s, t]) => at(f, s, t)) });
  }
  const site = m.bowl?.site;
  if (m.bowl && site) {
    const f = bowlingFrame(m.bowl);
    for (const r of site.rails) out.push({ kind: "fence", pts: r.flatMap(([s, t]) => at(f, s, t)) });
    out.push({ kind: "hedge", pts: site.hedge.flatMap(([s, t]) => at(f, s, t)) });
  }
  return out;
}

/** Repère du bowling : origine au coin sud-ouest du toit de la halle, s le long de la route, t vers le parking. */
export function bowlingFrame(m: BowlingModel): Frame {
  return frameOf(m.o[0], m.o[1], m.a, 1, 1);
}

/** Pas des poteaux de la pergola le long de ses bords libres (m). */
const PERGOLA_PITCH = 3.5;

/** Poteaux (s, t) : ceux de l'auvent du pignon sud de la halle (aux deux coins), puis ceux de la pergola (sur ses bords hors de l'aile est). */
export function bowlingPosts(m: BowlingModel): [number, number][] {
  const out: [number, number][] = [];
  if (m.porch[0] > 0.5) out.push([0.35, 0.35], [m.w - 0.35, 0.35]);
  for (const [s0, s1, t0, t1] of m.pergola) {
    const ns = Math.max(1, Math.round((s1 - s0) / PERGOLA_PITCH)), nt = Math.max(1, Math.round((t1 - t0) / PERGOLA_PITCH));
    for (let i = 0; i <= ns; i++) out.push([s0 + 0.15 + ((s1 - s0 - 0.3) * i) / ns, t0 + 0.15]);
    for (let j = 1; j < nt; j++) out.push([s1 - 0.15, t0 + 0.15 + ((t1 - t0 - 0.3) * j) / nt]);
  }
  return out;
}

/** Murs de la halle (s0, s1, t0, t1) : sous le toit, en retrait de `porch` aux pignons. */
export function bowlingHallWalls(m: BowlingModel): [number, number, number, number] {
  return [0, m.w, m.porch[0], m.l - m.porch[1]];
}

/** Volumes fermés du bowling (s0, s1, t0, t1) : aile ouest, aile est, bande basse (la pergola est ouverte). */
export function bowlingBlocks(m: BowlingModel): MeasuredPiece[] {
  return [...m.wing, ...m.east, ...m.low];
}

/** Obstacles du bowling (x, y) : la halle à ses murs, les ailes et la bande basse, les poteaux de l'auvent et de la pergola. */
export function bowlingRings(m: BowlingModel): number[][] {
  const f = bowlingFrame(m);
  const rect = (s0: number, s1: number, t0: number, t1: number): number[] => [...at(f, s0, t0), ...at(f, s1, t0), ...at(f, s1, t1), ...at(f, s0, t1)];
  const out = [rect(...bowlingHallWalls(m))];
  for (const [s0, s1, t0, t1] of bowlingBlocks(m)) out.push(rect(s0, s1, t0, t1));
  for (const [s, t] of bowlingPosts(m)) out.push(rect(s - 0.1, s + 0.1, t - 0.1, t + 0.1));
  // Abords (D236) : tables de la terrasse, poteaux du panneau du bord de la route.
  if (m.site) {
    for (const [s, t] of m.site.tables) out.push(rect(s - 0.4, s + 0.4, t - 0.4, t + 0.4));
    const [ss, st] = m.site.sign;
    for (const k of [-1, 1]) out.push(rect(ss - 0.06, ss + 0.06, st + k * 0.8 - 0.06, st + k * 0.8 + 0.06));
  }
  return out;
}

/** Les auvents n'ont pas de murs (on passe dessous) ; un bâtiment masqué est remplacé par un monument (D95). */
export function isOpen(kinds: { buildings: Record<string, BuildingKind> } | undefined, id: string): boolean {
  const k = kinds?.buildings[id]?.k;
  return k === "canopy" || k === "hidden";
}

/**
 * Le rendu dessine-t-il les murs et le toit génériques du bâtiment ? Non pour un bâtiment caché, un abri à chariots (dessiné ouvert) ou un
 * monument modélisé (hôtel de ville, D123 ; cathédrale, D127 ; église Saint-André, D138 ; maison, D140 ; Hexagone, D165 ; théâtre municipal, D223 ; gare, D228 ; Eduen, D231 ; McDonald's et bowling, D234…).
 */
export function drawsGenericRoof(kind: BuildingKind | undefined): boolean {
  return !(kind?.k === "hidden" || kind?.k === "cart" || kind?.hall || kind?.college || kind?.nd || kind?.ndPart || kind?.cath || kind?.chap || kind?.house || kind?.hex || kind?.vallon || kind?.play || kind?.sta || kind?.edu || kind?.mcd || kind?.bowl || kind?.gend || kind?.naut);
}

/**
 * Toit praticable (D214) : celui que dessine le rendu générique, sauf les églises et chapelles (clochers, gabarits de monument) et les
 * auvents (pas de murs). Les autres bâtiments gardent des murs infinis.
 */
/**
 * Passage voûté du Lycée militaire (D263) : il traverse la galerie d'entrée de la façade extérieure (au point `portal`) à la cour d'honneur,
 * perpendiculairement à la galerie, sur sa largeur `pw`. Rend le contour du bâtiment et le trou de la cour coupés au passage (polylignes ouvertes),
 * les autres trous tels quels, et les deux murs du passage ; `axis` : milieu du passage dehors et dans la cour.
 */
export function militairePassage(b: Building, m: CollegeSpec): { outer: number[]; holes: number[][]; cut: number[]; sides: number[][]; axis: [number, number, number, number] } | null {
  const mil = m.mil;
  if (!mil) return null;
  const g = m.wings[mil.gallery.w]!;
  const L = Math.hypot(g.q[0] - g.p[0], g.q[1] - g.p[1]), tx = (g.q[0] - g.p[0]) / L, ty = (g.q[1] - g.p[1]) / L;
  // Vers la cour : opposé à la gauche de la galerie (la façade extérieure est à sa gauche).
  const ix = ty, iy = -tx, D = g.wl + g.wr, hw = mil.gallery.pw / 2;
  const [ox, oy] = mil.gallery.portal;
  const inner: [number, number] = [ox + ix * D, oy + iy * D];
  const cutRing = (ring: readonly number[], P: readonly [number, number]): { line: number[]; ends: [[number, number], [number, number]]; dist: number } => {
    const n = ring.length / 2;
    let best = 0, bestD = Infinity, bestU = 0;
    for (let i = 0; i < n; i++) {
      const ax = ring[2 * i]!, ay = ring[2 * i + 1]!, bx = ring[2 * ((i + 1) % n)]!, by = ring[2 * ((i + 1) % n) + 1]!;
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, u = Math.max(0, Math.min(1, ((P[0] - ax) * (bx - ax) + (P[1] - ay) * (by - ay)) / l2));
      const d = Math.hypot(ax + (bx - ax) * u - P[0], ay + (by - ay) * u - P[1]);
      if (d < bestD) [best, bestD, bestU] = [i, d, u];
    }
    const ax = ring[2 * best]!, ay = ring[2 * best + 1]!, bx = ring[2 * ((best + 1) % n)]!, by = ring[2 * ((best + 1) % n) + 1]!;
    const el = Math.hypot(bx - ax, by - ay), ex = (bx - ax) / el, ey = (by - ay) / el, cx = ax + (bx - ax) * bestU, cy = ay + (by - ay) * bestU;
    const start: [number, number] = [cx + ex * hw, cy + ey * hw], end: [number, number] = [cx - ex * hw, cy - ey * hw];
    const line = [...start];
    for (let k = 1; k <= n; k++) line.push(ring[2 * ((best + k) % n)]!, ring[2 * ((best + k) % n) + 1]!);
    line.push(...end);
    return { line, ends: [start, end], dist: bestD };
  };
  const o = cutRing(b.ring, [ox, oy]);
  const near = b.holes.map((h) => cutRing(h, inner));
  const hi = near.reduce((bi, h, i) => (h.dist < near[bi]!.dist ? i : bi), 0);
  const hc = near[hi]!;
  // Chaque bout du dehors avec le bout de la cour du même côté du passage.
  const side = (p: [number, number]): number => (p[0] - ox) * tx + (p[1] - oy) * ty;
  const [oA, oB] = side(o.ends[0]) > side(o.ends[1]) ? o.ends : [o.ends[1], o.ends[0]];
  const [hA, hB] = side(hc.ends[0]) > side(hc.ends[1]) ? hc.ends : [hc.ends[1], hc.ends[0]];
  return {
    outer: o.line,
    holes: b.holes.filter((_, i) => i !== hi),
    cut: hc.line,
    sides: [[...oA, ...hA], [...oB, ...hB]],
    axis: [ox, oy, ...inner],
  };
}

export function walkableRoof(kind: BuildingKind | undefined): boolean {
  return drawsGenericRoof(kind) && kind?.k !== "church" && kind?.k !== "chapel" && kind?.k !== "canopy" && !kind?.mon && !kind?.tower;
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
    // Pierre de Couhard (D222) : le pied (on ne gravit pas le talus).
    if (s.t === "couhard") out.push(couhardFoot(s, 0, 32).flat());
    // Kiosque à musique (D155) : le contour BD TOPO (le toit déborde du socle de 50 cm), comme avant ; on n'y monte pas.
    if (s.t === "bandstand") out.push(bandstandRing(s).flat());
    // Monument aux morts (D227) : le degré du bas de l'esplanade ; on n'y monte pas.
    if (s.t === "memorial") out.push(memorialRing(s).flat());
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

// --- Passage Balthus (D187) ---------------------------------------------------------------------------------------------------------

/** Point de l'axe du passage (s depuis la façade de la rue Demetz, t vers le nord-est). */
export function passagePoint(s: PassageSite, d: number, t = 0): [number, number] {
  return at(frameOf(s.c[0], s.c[1], s.a, 1, 1), d, t);
}

/**
 * Dalle du sol de la galerie au-dessus du relief aplani (m) : le maillage du relief, en mailles de 2 m, bombe de quelques centimètres et recouvrirait un
 * sol posé à ras ; le tablier de la galerie porte les pas à la hauteur du sol dessiné.
 */
export const PASSAGE_SLAB = 0.08;

/** Statue du chien (D189) : abscisse et côté dans la galerie, rayon du socle (obstacle). */
export const PASSAGE_DOG = { s: 16, t: -0.9, r: 0.55 };

/** Niveau du sol (altitude) à l'abscisse d : galerie plate, volée de `st[2]` marches de `st[0]` à `st[1]`, puis palier de la rue aux Cordiers. */
export function passageFloor(s: PassageSite, d: number): number {
  const [s0, s1] = s.st;
  const zg = s.zf + PASSAGE_SLAB;
  return d <= s0 ? zg : d >= s1 ? s.zc : zg + ((s.zc - zg) * (d - s0)) / (s1 - s0);
}

/**
 * Tablier invisible du passage : le seuil de la rue Demetz, la galerie, la volée et le palier jusqu'à la rue aux Cordiers (le relief du LiDAR y est un
 * talus interpolé sous le bâtiment).
 */
export function passageDecks(s: PassageSite): Deck[] {
  const f = frameOf(s.c[0], s.c[1], s.a, 1, 1);
  const zg = s.zf + PASSAGE_SLAB;
  const pts: [number, number][] = [[-0.5, s.zf - 0.35], [1.5, zg], [s.st[0], zg], [s.st[1], s.zc], [s.L + 0.4, s.zc]];
  return [{ id: -187001, k: "foot", w: 2 * s.hw - 0.1, p: pts.flatMap(([d, z]) => [...at(f, d, 0), z]), st: "light", sp: [], pc: [] }];
}

/** Tabliers des monuments d'une tuile (porche de la cathédrale ; escaliers et scène du théâtre romain, D133 ; volée du passage Balthus, D187). */
export function landmarkDecks(kinds: { buildings: Record<string, BuildingKind>; sites?: Site[] } | undefined): Deck[] {
  return [
    ...Object.values(kinds?.buildings ?? {}).flatMap((k) => (k.cath?.entry ? porchDecks(k.cath) : [])),
    ...(kinds?.sites ?? []).flatMap((s) => (s.t === "passage" ? passageDecks(s) : [])),
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
