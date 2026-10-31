import type { Deck, TheatreSite } from "../data/types";
import type { DeckSector } from "./decks";
import type { Top } from "./collision";

/**
 * Théâtre romain (D133) : disposition tirée des mesures (tools/data/build_monuments.py, modèle `theatre`). Repère polaire : centre `c`, axe
 * `a` vers le fond de la cavea, angle `u` relatif à l'axe. Tout ce qui est dessiné est aussi la surface où l'on marche (tabliers invisibles
 * alignés sur les marches, D93) : `surface` donne l'altitude dessinée en tout point, le rendu et les obstacles s'en servent.
 */

export interface TheatreRow {
  r0: number;
  r1: number;
  z: number;
}

/** Volée d'un escalier rayonnant : de r0 (altitude z0) à r1 (z1) en `steps` marches. */
export interface LanePiece {
  r0: number;
  r1: number;
  z0: number;
  z1: number;
  steps: number;
}

export interface TheatreLane {
  u: number;
  /** Largeur (m). */
  w: number;
  pieces: LanePiece[];
}

/** Massif ou coin de gradins : angles, profil (rayon, altitude du dessus), en paliers (ruines) ou en pente continue (coins du haut). */
export interface TheatreBlock {
  u0: number;
  u1: number;
  prof: [number, number][];
  stepped: boolean;
  /** Pas des paliers (m). */
  step: number;
  /** Ruine au bout de la cavea (dessinée sans gradins). */
  ruin: boolean;
}

export interface TheatreLayout {
  s: TheatreSite;
  cx: number;
  cy: number;
  rows: TheatreRow[];
  rise: number;
  zpod: number;
  rw0: number;
  zp: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  rest: [number, number];
  lanesLow: TheatreLane[];
  lanesUp: TheatreLane[];
  blocks: TheatreBlock[];
  stage: StageLayout;
}

export interface StageLayout {
  /** Coin du côté de l'orchestre, vecteur le long de ce côté (unité), vers l'intérieur (unité). */
  ox: number;
  oy: number;
  ex: number;
  ey: number;
  nx: number;
  ny: number;
  width: number;
  depth: number;
  zt: number;
  /** Profondeur des marches et leur nombre. */
  sd: number;
  steps: number;
}

const HALF = Math.PI / 2;

export function stageLayout(s: TheatreSite, zo: number): StageLayout {
  const q = s.stage;
  const [x0, y0, x1, y1, x2, y2] = [q[0]!, q[1]!, q[2]!, q[3]!, q[4]!, q[5]!];
  const width = Math.hypot(x1 - x0, y1 - y0);
  const ex = (x1 - x0) / width, ey = (y1 - y0) / width;
  let nx = -ey, ny = ex;
  if ((x2 - x1) * nx + (y2 - y1) * ny < 0) { nx = -nx; ny = -ny; }
  const depth = (x2 - x1) * nx + (y2 - y1) * ny;
  const zt = q[8]!, sd = q[9]!;
  return { ox: x0, oy: y0, ex, ey, nx, ny, width, depth, zt, sd, steps: Math.max(2, Math.round((zt - zo) / 0.19)) };
}

export function theatreLayout(s: TheatreSite): TheatreLayout {
  const [n, rw0, r1, zf, zl] = s.rows;
  const rise = (zl - zf) / (n - 1);
  const d = (r1 - rw0) / n;
  const rows: TheatreRow[] = Array.from({ length: n }, (_, k) => ({ r0: rw0 + k * d, r1: rw0 + (k + 1) * d, z: zf + k * rise }));
  const zpod = zf - rise;
  const zp = s.pr[2];
  const [r2, r3, r4] = s.up;
  // Escaliers du bas : demi-marches entre les rangs ; celui de l'axe traverse le podium jusqu'à l'orchestre (photo de drone).
  const lanesLow = s.lanes[0].map((u): TheatreLane => {
    const rowsPiece: LanePiece = { r0: rw0, r1, z0: zpod, z1: zl, steps: 2 * n };
    if (Math.abs(u) > 0.1) return { u, w: 1.2, pieces: [rowsPiece] };
    const foot = s.ro - 1.2;
    return { u, w: 2.0, pieces: [{ r0: foot, r1: rw0, z0: s.zo, z1: zpod, steps: Math.max(2, Math.round((zpod - s.zo) / 0.36)) }, rowsPiece] };
  });
  const lane = s.lanes[2];
  const lanesUp = s.lanes[1].map(([u, z]): TheatreLane => ({ u, w: lane, pieces: [{ r0: r2, r1: r4, z0: zp, z1: z, steps: Math.max(4, Math.round((r4 - r2) / 0.75)) }] }));
  const blocks: TheatreBlock[] = [];
  const trim = lane / 2 / r3;
  for (const [u0, u1, ruin, prof] of s.cun) {
    const a0 = u0 <= -HALF + 1e-3 ? -HALF : u0 + trim, a1 = u1 >= HALF - 1e-3 ? HALF : u1 - trim;
    if (ruin) {
      const step = (r4 - r2) / (prof.length - 1);
      blocks.push({ u0: a0, u1: a1, prof: prof.map((z, i) => [r2 + i * step, z]), stepped: true, step, ruin: true });
    } else {
      blocks.push({ u0: a0, u1: a1, prof: [[r2, prof[0]!], [r3, prof[1]!], [r4, prof[2]!]], stepped: false, step: 0, ruin: false });
    }
  }
  for (const [u0, u1, prof] of s.ends) {
    const step = (r2 - s.ro) / (prof.length - 1);
    blocks.push({ u0, u1, prof: prof.map((z, i) => [s.ro + i * step, z]), stepped: true, step, ruin: true });
  }
  return {
    s, cx: s.c[0], cy: s.c[1], rows, rise, zpod, rw0, zp, r1, r2, r3, r4, rest: s.rest, lanesLow, lanesUp, blocks, stage: stageLayout(s, s.zo),
  };
}

/** Bornes du massif en rayon. */
export function blockSpan(b: TheatreBlock): [number, number] {
  const p = b.prof;
  return b.stepped ? [p[0]![0] - 0, p[p.length - 1]![0]] : [p[0]![0], p[p.length - 1]![0]];
}

/** Dessus du massif au rayon R : palier le plus proche (ruines), ou interpolation (coins du haut). */
export function blockTop(b: TheatreBlock, R: number): number {
  const p = b.prof;
  if (b.stepped) {
    const i = Math.min(p.length - 1, Math.max(0, Math.round((R - p[0]![0]) / b.step)));
    return p[i]![1];
  }
  for (let i = 0; i + 1 < p.length; i++) {
    const [ra, za] = p[i]!, [rb, zb] = p[i + 1]!;
    if (R <= rb || i + 2 === p.length) return za + ((zb - za) * Math.min(1, Math.max(0, (R - ra) / (rb - ra))));
  }
  return p[0]![1];
}

/** Paliers d'un massif en ruine : rayons et altitude de chacun. */
export function terraces(b: TheatreBlock): [number, number, number][] {
  const p = b.prof, h = b.step / 2, rin = p[0]![0], rout = p[p.length - 1]![0];
  return p.map(([r, z]) => [Math.max(rin, r - h), Math.min(rout, r + h), z]);
}

/** Demi-largeur angulaire d'un escalier au rayon R. */
export const laneHalf = (l: TheatreLane, R: number): number => l.w / 2 / Math.max(R, 1);

/** Altitude de la rampe d'une volée (passe par le milieu des contremarches : à une demi-marche près des marches dessinées). */
export function laneZ(l: TheatreLane, R: number): number | null {
  for (const p of l.pieces) {
    if (R < p.r0 || R > p.r1) continue;
    const h = (p.z1 - p.z0) / p.steps;
    return p.z0 + h / 2 + ((p.z1 - p.z0) * (R - p.r0)) / (p.r1 - p.r0);
  }
  return null;
}

/** Altitude du dessus de la marche dessinée au rayon R (marche i : de r0 + i·t à r0 + (i+1)·t, à z0 + (i+1)·h). */
export function laneStepZ(l: TheatreLane, R: number): number | null {
  for (const p of l.pieces) {
    if (R < p.r0 || R > p.r1) continue;
    const t = (p.r1 - p.r0) / p.steps, h = (p.z1 - p.z0) / p.steps;
    const i = Math.min(p.steps - 1, Math.floor((R - p.r0) / t));
    return p.z0 + (i + 1) * h;
  }
  return null;
}

export function polar(L: TheatreLayout, x: number, y: number): [number, number] {
  const dx = x - L.cx, dy = y - L.cy;
  let u = Math.atan2(dy, dx) - L.s.a;
  u -= 2 * Math.PI * Math.round(u / (2 * Math.PI));
  return [Math.hypot(dx, dy), u];
}

export function xyOf(L: TheatreLayout, R: number, u: number): [number, number] {
  return [L.cx + R * Math.cos(L.s.a + u), L.cy + R * Math.sin(L.s.a + u)];
}

/** Escalier qui passe en (R, u), s'il y en a un. */
export function laneAt(L: TheatreLayout, R: number, u: number): TheatreLane | null {
  for (const l of R < L.r1 + 0.01 ? L.lanesLow : L.lanesUp) {
    if (Math.abs(u - l.u) <= laneHalf(l, R) && laneZ(l, R) !== null) return l;
  }
  return null;
}

/** Altitude dessinée (marches comprises) en (R, u) ; null hors du monument (le relief). */
export function designedZ(L: TheatreLayout, R: number, u: number): number | null {
  if (Math.abs(u) > HALF) return null;
  const lane = laneAt(L, R, u);
  if (lane) return laneStepZ(lane, R);
  const inRest = u >= L.rest[0] && u <= L.rest[1];
  if (inRest && R >= L.s.ro && R < L.rw0) return L.zpod;
  if (inRest && R >= L.rw0 && R < L.r1) {
    const row = L.rows[Math.min(L.rows.length - 1, Math.floor((R - L.rw0) / (L.rows[0]!.r1 - L.rows[0]!.r0)))]!;
    return row.z;
  }
  if (inRest && R >= L.r1 && R < L.r2) return L.zp;
  for (const b of L.blocks) {
    const [r0, r1] = blockSpan(b);
    if (u >= b.u0 && u <= b.u1 && R >= r0 && R <= r1) return blockTop(b, R);
  }
  return null;
}

const sectorOf = (L: TheatreLayout, id: string, u0: number, u1: number, r0: number, r1: number, z0: number, z1: number): DeckSector => ({
  id, cx: L.cx, cy: L.cy, a: L.s.a + (u0 + u1) / 2, h: (u1 - u0) / 2, r0, r1, z0, z1,
});

/** Intervalles de [u0, u1] hors des escaliers `lanes` au rayon R. */
export function splitByLanes(lanes: readonly TheatreLane[], u0: number, u1: number, R: number): [number, number][] {
  const cuts = lanes.filter((l) => l.u > u0 && l.u < u1).map((l) => [l.u - laneHalf(l, R), l.u + laneHalf(l, R)] as const).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let a = u0;
  for (const [c0, c1] of cuts) {
    if (c0 > a) out.push([a, c0]);
    a = Math.max(a, c1);
  }
  if (u1 > a) out.push([a, u1]);
  return out;
}

/** Tabliers en secteurs : podium, rangs, précinction, dessus des coins et des massifs. */
export function theatreSectors(s: TheatreSite): DeckSector[] {
  const L = theatreLayout(s);
  const out: DeckSector[] = [];
  const central = L.lanesLow.filter((l) => l.pieces.length > 1);
  splitByLanes(central, L.rest[0], L.rest[1], (s.ro + L.rw0) / 2).forEach(([a, b], i) => out.push(sectorOf(L, `th:p${i}`, a, b, s.ro, L.rw0, L.zpod, L.zpod)));
  L.rows.forEach((row, k) => {
    splitByLanes(L.lanesLow, L.rest[0], L.rest[1], (row.r0 + row.r1) / 2).forEach(([a, b], i) => out.push(sectorOf(L, `th:r${k}:${i}`, a, b, row.r0, row.r1, row.z, row.z)));
  });
  out.push(sectorOf(L, "th:pr", L.rest[0], L.rest[1], L.r1, L.r2, L.zp, L.zp));
  L.blocks.forEach((b, i) => {
    if (b.stepped) terraces(b).forEach(([r0, r1, z], j) => out.push(sectorOf(L, `th:b${i}:${j}`, b.u0, b.u1, r0, r1, z, z)));
    else for (let j = 0; j + 1 < b.prof.length; j++) out.push(sectorOf(L, `th:b${i}:${j}`, b.u0, b.u1, b.prof[j]![0], b.prof[j + 1]![0], b.prof[j]![1], b.prof[j + 1]![1]));
  });
  return out;
}

/** Tabliers en rampe : escaliers rayonnants, marches et plateau de la scène moderne. */
export function theatreDecks(s: TheatreSite): Deck[] {
  const L = theatreLayout(s);
  const deck = (id: number, w: number, p: number[]): Deck => ({ id, k: "foot", w, p, st: "light", sp: [], pc: [] });
  const out: Deck[] = [];
  [...L.lanesLow, ...L.lanesUp].forEach((l, i) => {
    const p: number[] = [];
    for (const piece of l.pieces) {
      for (const R of [piece.r0, piece.r1]) p.push(...xyOf(L, R, l.u), laneZ(l, Math.min(Math.max(R, piece.r0 + 1e-6), piece.r1 - 1e-6))!);
    }
    out.push(deck(-133000 - i, l.w, p));
  });
  const g = L.stage;
  const mid = (t: number): [number, number] => [g.ox + g.ex * g.width / 2 + g.nx * t, g.oy + g.ey * g.width / 2 + g.ny * t];
  const h = (g.zt - s.zo) / g.steps;
  out.push(deck(-133100, g.width, [...mid(0), s.zo + h / 2, ...mid(g.sd), g.zt]));
  out.push(deck(-133101, g.width, [...mid(g.sd), g.zt, ...mid(g.depth), g.zt]));
  return out;
}

/** Obstacle : ligne (x, y aplatis), hauteur, bas (on voit et l'on tire par-dessus). */
export interface TheatreWall {
  pts: number[];
  top: Top;
  low: boolean;
}

/** Dénivelé au-delà duquel un bord est un obstacle (en dessous : une marche qu'on franchit, D93). */
const DROP = 1.0;

/**
 * Obstacles : le podium (sauf l'escalier de l'axe), les bords des massifs et des coins plus hauts de plus d'1 m que ce qui les jouxte
 * (escaliers, précinction, relief), les barrières des côtés de la scène. On escalade ce qui fait moins de 2,5 m (D106).
 */
export function theatreWalls(s: TheatreSite, ground: (x: number, y: number) => number): TheatreWall[] {
  const L = theatreLayout(s);
  const out: TheatreWall[] = [];
  const outside = (R: number, u: number): number => {
    const z = designedZ(L, R, u);
    return z ?? ground(...xyOf(L, R, u));
  };
  // Bord : points (R, u) le long du bord, dessus intérieur, et point extérieur pour chacun.
  const edge = (pts: [number, number][], inner: (R: number, u: number) => number, out_: (R: number, u: number) => [number, number]): void => {
    let run: number[] = [], hmax = 0;
    const flush = (): void => {
      if (run.length >= 4) out.push({ pts: run, top: { height: hmax, climb: hmax <= 2.5 }, low: false });
      run = []; hmax = 0;
    };
    for (const [R, u] of pts) {
      const o = out_(R, u);
      const dz = Math.abs(inner(R, u) - outside(o[0], o[1]));
      if (dz > DROP) {
        run.push(...xyOf(L, R, u));
        hmax = Math.max(hmax, dz);
      } else flush();
    }
    flush();
  };
  const arc = (R: number, u0: number, u1: number): [number, number][] => {
    const n = Math.max(2, Math.ceil(((u1 - u0) * R) / 1.0));
    return Array.from({ length: n + 1 }, (_, i) => [R, u0 + ((u1 - u0) * i) / n] as [number, number]);
  };
  const ray = (u: number, r0: number, r1: number): [number, number][] => {
    const n = Math.max(2, Math.ceil(r1 - r0));
    return Array.from({ length: n + 1 }, (_, i) => [r0 + ((r1 - r0) * i) / n, u] as [number, number]);
  };
  const EPS = 0.35;
  for (const b of L.blocks) {
    const [r0, r1] = blockSpan(b);
    const top = (R: number): number => blockTop(b, Math.min(r1, Math.max(r0, R)));
    const du = (R: number): number => EPS / R;
    edge(ray(b.u0, r0, r1), (R) => top(R), (R, u) => [R, u - du(R)]);
    edge(ray(b.u1, r0, r1), (R) => top(R), (R, u) => [R, u + du(R)]);
    edge(arc(r0, b.u0, b.u1), () => top(r0), (R, u) => [R - EPS, u]);
    edge(arc(r1, b.u0, b.u1), () => top(r1), (R, u) => [R + EPS, u]);
    if (b.stepped) {
      const t = terraces(b);
      for (let i = 0; i + 1 < t.length; i++) {
        const dz = Math.abs(t[i + 1]![2] - t[i]![2]);
        if (dz > DROP) out.push({ pts: arc(t[i]![1], b.u0, b.u1).flatMap(([R, u]) => xyOf(L, R, u)), top: { height: dz, climb: dz <= 2.5 }, low: false });
      }
    }
  }
  // Podium : on voit par-dessus ; l'escalier de l'axe y passe.
  const central = L.lanesLow.filter((l) => l.pieces.length > 1);
  for (const [a, b] of splitByLanes(central, L.rest[0], L.rest[1], s.ro)) {
    out.push({ pts: arc(s.ro, a, b).flatMap(([R, u]) => xyOf(L, R, u)), top: { height: L.zpod - s.zo, climb: true }, low: true });
  }
  // Barrières le long des deux côtés de la scène (photos).
  const g = L.stage;
  const at = (e: number, t: number): [number, number] => [g.ox + g.ex * e + g.nx * t, g.oy + g.ey * e + g.ny * t];
  for (const e of [0.15, g.width - 0.15]) out.push({ pts: [...at(e, 0.3), ...at(e, g.depth - 0.3)], top: { height: 1.1, climb: true }, low: true });
  return out;
}

/** L'arbre (x, y) pousse-t-il dans le théâtre (cavea jusqu'à la lisière, orchestre, scène) ? */
export function inTheatre(s: TheatreSite, x: number, y: number): boolean {
  const L = theatreLayout(s);
  const [R, u] = polar(L, x, y);
  if (R < L.r4 && Math.abs(u) <= HALF + 0.05) return true;
  const g = L.stage;
  const e = (x - g.ox) * g.ex + (y - g.oy) * g.ey, t = (x - g.ox) * g.nx + (y - g.oy) * g.ny;
  return e > -1 && e < g.width + 1 && t > -1 && t < g.depth + 1;
}
