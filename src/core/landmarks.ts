import type { Building, BuildingKind, BuildingKindId, Site, Tree } from "../data/types";

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
export function reshapeBuilding(b: Building, kind: BuildingKindId | undefined): Building {
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
  // Fontaine d'après photo (D131) : son bassin.
  for (const s of kinds.sites) if (s.t === "fountain") out.push([s.x, s.y, s.rb + 0.2]);
  // Auvents sans site (rare) : un poteau à chaque coin.
  for (const b of buildings) {
    if (kinds.buildings[b.id]?.k !== "canopy" || roofs.has(b.id)) continue;
    for (let i = 0; i < b.ring.length; i += 2) out.push([b.ring[i]!, b.ring[i + 1]!, 0.3]);
  }
  return out;
}

/** Arbres de la tuile hors des bassins des fontaines d'après photo (D131) : un arbre de la carte poussait au milieu de la fontaine Saint-Lazare. */
export function treesOutsideMonuments(kinds: { sites: Site[] } | undefined, trees: readonly Tree[]): Tree[] {
  const basins = (kinds?.sites ?? []).flatMap((s) => (s.t === "fountain" ? [[s.x, s.y, s.rb + 0.6] as const] : []));
  return basins.length ? trees.filter(([x, y]) => basins.every(([bx, by, r]) => Math.hypot(x - bx, y - by) > r)) : [...trees];
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
  /** Hauteur totale au-dessus du sol. */
  height: number;
  openings: Opening[];
  /** Piles au niveau du sol (s0, s1), obstacles. */
  piers: [number, number][];
  /** Corniches : (bas, haut) au-dessus du sol. */
  cornices: [number, number][];
  /** Pilastres de la galerie (abscisses) et leurs bas et haut. */
  pilasters: number[];
  gallery: [number, number];
}

/**
 * Disposition d'une porte romaine d'Autun (D95) : deux grandes arches au centre (voitures), deux petites aux bouts (piétons), corniche,
 * galerie de dix arcades à pilastres, corniche haute. Largeurs de la porte d'Arroux (18,7 m), mises à l'échelle de la longueur ; hauteurs en
 * fractions de la hauteur mesurée au LiDAR.
 */
export function gateLayout(site: Extract<Site, { t: "gate" }>, ground: number): GateLayout {
  const frame = frameOf(site.x, site.y, site.a, site.l, site.w);
  const H = Math.min(Math.max((site.top ?? ground + 12) - ground, 7), 20);
  const k = site.l / 18.7;
  const outer = 0.9 * k, small = 2.2 * k, mid = 1.4 * k, big = 4.3 * k;
  const half = site.l / 2;
  const openings: Opening[] = [];
  const piers: [number, number][] = [];
  const bigTop = 0.58 * H, smallTop = 0.36 * H;
  for (const side of [-1, 1]) {
    const e0 = side * half, e1 = side * (half - outer), e2 = side * (half - outer - small), e3 = side * (half - outer - small - mid);
    const e4 = side * (half - outer - small - mid - big);
    const lo = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
    const [s0, s1] = lo(e1, e2), [b0, b1] = lo(e3, e4);
    openings.push({ s0, s1, zb: -0.5, spring: smallTop - small / 2 }, { s0: b0, s1: b1, zb: -0.5, spring: bigTop - big / 2 });
    piers.push(lo(e0, e1), lo(e2, e3));
  }
  piers.push([-(half - outer - small - mid - big), half - outer - small - mid - big]);
  const sill = 0.7 * H, galTop = 0.92 * H;
  const pitch = (site.l - 1.2) / 10, aw = pitch * 0.62;
  const pilasters: number[] = [];
  for (let i = 0; i < 10; i++) {
    const c = -half + 0.6 + pitch * (i + 0.5);
    openings.push({ s0: c - aw / 2, s1: c + aw / 2, zb: sill, spring: galTop - aw / 2 });
    pilasters.push(-half + 0.6 + pitch * i);
  }
  pilasters.push(half - 0.6);
  return { frame, height: H, openings, piers, cornices: [[0.63 * H, 0.68 * H], [0.93 * H, 0.98 * H]], pilasters, gallery: [sill, galTop] };
}

/** Contours des obstacles des monuments : piles des portes romaines (on passe sous les arches). */
export function landmarkRings(kinds: { sites: Site[] } | undefined, ground: (x: number, y: number) => number): number[][] {
  const out: number[][] = [];
  for (const s of kinds?.sites ?? []) {
    if (s.t !== "gate") continue;
    const lay = gateLayout(s, ground(s.x, s.y));
    const f = lay.frame;
    for (const [s0, s1] of lay.piers) {
      const pts = [at(f, s0, -f.hw), at(f, s1, -f.hw), at(f, s1, f.hw), at(f, s0, f.hw)];
      out.push(pts.flat());
    }
  }
  return out;
}
