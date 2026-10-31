import type { Building, BuildingKind, BuildingKindId, CathedralModel, Deck, Site, Tree } from "../data/types";
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
  // Théâtre romain (D136) : poteaux d'éclairage et arbustes taillés.
  for (const s of kinds.sites) {
    if (s.t !== "theatre") continue;
    for (const [x, y] of s.poles ?? []) out.push([x, y, 0.2]);
    for (const [x, y] of s.shrubs ?? []) out.push([x, y, 0.7]);
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
  // Théâtre romain (D133) : rien ne pousse dans la cavea, l'orchestre ni sur la scène (les arbres du sommet restent).
  const theatres = (kinds?.sites ?? []).filter((s) => s.t === "theatre");
  if (!basins.length && !theatres.length) return [...trees];
  return trees.filter(([x, y]) => basins.every(([bx, by, r]) => Math.hypot(x - bx, y - by) > r) && theatres.every((t) => !inTheatre(t, x, y)));
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
