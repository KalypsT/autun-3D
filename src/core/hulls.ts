/**
 * Relevés de hauteur des bâtiments spéciaux (D302, plan `docs/plans/toits-monuments.md`) : monuments, bâtiments à modèle dédié et sites
 * (portes romaines, temple de Janus, Couhard, kiosque…). Leur toit dessiné ne suit pas les pans BD TOPO : on relève, case par case
 * (0,5 ou 1 m), la hauteur de ce que dessine le rendu (`src/render/hull-build.ts`, fichiers `public/data/hulls/<tuile>.json`). Ce relevé
 * donne le haut de leurs murs (on les survole au lieu de buter contre un mur invisible) et une surface où se poser (`Roofs`).
 * Logique pure : aucune dépendance au rendu.
 */
import { pointInRing } from "./ring";

/** Relevé tel qu'il est enregistré : coin (x, y) de la première case, côté `s`, `nx` × `ny` cases, hauteurs en décimètres (base64, Int16). */
export interface HullData {
  /** Bâtiment (identifiant BD TOPO) ou site (`hullSiteKey`). */
  k: string;
  x: number;
  y: number;
  s: number;
  nx: number;
  ny: number;
  z: string;
}

/** Case sans rien de dessiné dans le relevé enregistré. */
export const HULL_EMPTY = -32768;
/** Saut de hauteur (m) entre deux cases voisines au-delà duquel un mur les sépare (clocher, flèche, pignon dressé sur un toit plat). */
export const HULL_STEP = 1.2;
/**
 * Un ressaut n'arrête que qui est à moins de … m sous le toit le plus bas qu'il borde (voiture ou piéton sur ce toit, ou qui y arrive en
 * vol) ; dessous (dans la rue, sous une voûte), il est ignoré.
 */
export const HULL_STEP_BELOW = 1;

/** Un relevé prêt à servir : hauteurs absolues (NaN : vide), emprise (contours extérieurs, trous) où il compte comme toit. */
export interface Hull {
  readonly hull: true;
  readonly key: string;
  readonly x0: number;
  readonly y0: number;
  readonly s: number;
  readonly nx: number;
  readonly ny: number;
  readonly z: Float32Array;
  readonly outer: readonly (readonly number[])[];
  readonly holes: readonly (readonly number[])[];
  /** Boîte englobante (comme `RoofPlane`, pour la grille des toits). */
  readonly x1: number;
  readonly y1: number;
  /** Plus haute case. */
  readonly top: number;
  /** Case entièrement dans l'emprise (1), à vérifier point par point (2), pas encore vue (0) : évite les tests de contour (`hullPlane`). */
  readonly inner: Uint8Array;
}

/** Clé du relevé d'un site : son type et le premier sommet de son premier contour d'obstacle (au mètre). */
export function hullSiteKey(t: string, rings: readonly (readonly number[])[]): string {
  const r = rings[0]!;
  return `site:${t}:${Math.round(r[0]!)}:${Math.round(r[1]!)}`;
}

export function encodeHeights(z: Float32Array): string {
  const q = new Int16Array(z.length);
  for (let i = 0; i < z.length; i++) q[i] = Number.isNaN(z[i]!) ? HULL_EMPTY : Math.max(-32767, Math.min(32767, Math.round(z[i]! * 10)));
  const bytes = new Uint8Array(q.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function decodeHeights(b64: string, n: number): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(n * 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) z[i] = q[i] === HULL_EMPTY ? NaN : q[i]! / 10;
  return z;
}

/** Le relevé enregistré, avec l'emprise où il compte (contours d'obstacle du bâtiment ou du site). */
export function makeHull(d: HullData, outer: readonly (readonly number[])[], holes: readonly (readonly number[])[]): Hull {
  const z = decodeHeights(d.z, d.nx * d.ny);
  let top = -Infinity;
  for (const v of z) if (v > top) top = v;
  return { hull: true, key: d.k, x0: d.x, y0: d.y, s: d.s, nx: d.nx, ny: d.ny, z, outer, holes, x1: d.x + d.nx * d.s, y1: d.y + d.ny * d.s, top, inner: new Uint8Array(d.nx * d.ny) };
}

/** Le point est-il dans l'emprise (un contour extérieur, hors des trous) ? */
export function inArea(x: number, y: number, outer: readonly (readonly number[])[], holes: readonly (readonly number[])[]): boolean {
  return outer.some((r) => pointInRing(x, y, r)) && !holes.some((r) => pointInRing(x, y, r));
}

/** Hauteur de la case (i, j), NaN hors du relevé ou vide. */
export function hullCell(h: Hull, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= h.nx || j >= h.ny) return NaN;
  return h.z[j * h.nx + i]!;
}

/**
 * Surface du relevé sous le point : le plan de sa case (hauteur au centre, pente tirée des cases voisines qui ne sont pas de l'autre côté
 * d'un saut, `HULL_STEP`), seulement dans l'emprise. Null : hors de l'emprise, ou rien de dessiné là.
 */
export function hullPlane(h: Hull, x: number, y: number): { a: number; b: number; c: number } | null {
  if (x < h.x0 || y < h.y0 || x >= h.x1 || y >= h.y1) return null;
  const i = Math.floor((x - h.x0) / h.s), j = Math.floor((y - h.y0) / h.s);
  const z0 = hullCell(h, i, j);
  if (Number.isNaN(z0)) return null;
  const k = j * h.nx + i;
  if (h.inner[k] === 0) {
    // Ses quatre coins et son centre dans l'emprise : la case y est entière (aux contours près, plus fins qu'une case).
    const x0 = h.x0 + i * h.s, y0 = h.y0 + j * h.s, s = h.s;
    const all = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]].every(([u, v]) => inArea(x0 + u! * s, y0 + v! * s, h.outer, h.holes));
    h.inner[k] = all ? 1 : 2;
  }
  if (h.inner[k] === 2 && !inArea(x, y, h.outer, h.holes)) return null;
  const near = (v: number): boolean => !Number.isNaN(v) && Math.abs(v - z0) <= HULL_STEP;
  const slope = (lo: number, hi: number): number => {
    const l = near(lo), r = near(hi);
    if (l && r) return (hi - lo) / (2 * h.s);
    if (r) return (hi - z0) / h.s;
    if (l) return (z0 - lo) / h.s;
    return 0;
  };
  const a = slope(hullCell(h, i - 1, j), hullCell(h, i + 1, j));
  const b = slope(hullCell(h, i, j - 1), hullCell(h, i, j + 1));
  const cx = h.x0 + (i + 0.5) * h.s, cy = h.y0 + (j + 0.5) * h.s;
  return { a, b, c: z0 - a * cx - b * cy };
}

/** Plus haute case à moins de `r` m du point (haut d'un mur au bord du relevé) ; NaN s'il n'y en a pas. */
export function hullTopNear(h: Hull, x: number, y: number, r: number): number {
  const i0 = Math.floor((x - r - h.x0) / h.s), i1 = Math.floor((x + r - h.x0) / h.s);
  const j0 = Math.floor((y - r - h.y0) / h.s), j1 = Math.floor((y + r - h.y0) / h.s);
  let best = NaN;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const v = hullCell(h, i, j);
      if (!Number.isNaN(v) && (Number.isNaN(best) || v > best)) best = v;
    }
  }
  return best;
}

/**
 * Ressauts du relevé : le long des côtés de cases où la hauteur saute de plus de `HULL_STEP` (pied d'un clocher, d'une flèche, d'un pignon
 * dressé sur un toit plat), dans l'emprise, au haut de la plus haute case ; les côtés voisins de même haut sont fusionnés.
 * (x1, y1, x2, y2, haut, haut de la plus basse case). Une case vide (rien de dessiné : on tombe au sol) ne fait pas de ressaut.
 */
export function hullSteps(h: Hull): [number, number, number, number, number, number][] {
  const out: [number, number, number, number, number, number][] = [];
  // Seulement dans l'emprise (milieu du côté) : au bord, ce sont les murs du contour ; dehors, un auvent ou une corniche dessinés ne font pas
  // de mur sur le trottoir.
  const jump = (p: number, q: number, mx: number, my: number): [number, number] | null =>
    Number.isNaN(p) || Number.isNaN(q) || Math.abs(p - q) <= HULL_STEP || !inArea(mx, my, h.outer, h.holes) ? null : [Math.max(p, q), Math.min(p, q)];
  type Run = { a: number; b: number; top: number; low: number };
  const scan = (count: number, at: (k: number) => [number, number] | null, emit: (r: Run) => void): void => {
    let run: Run | null = null;
    for (let k = 0; k <= count; k++) {
      const t = k < count ? at(k) : null;
      if (run && (!t || Math.abs(t[0] - run.top) > 0.2)) {
        emit(run);
        run = null;
      }
      if (t) run = run ? { a: run.a, b: k + 1, top: Math.max(run.top, t[0]), low: Math.min(run.low, t[1]) } : { a: k, b: k + 1, top: t[0], low: t[1] };
    }
  };
  // Côtés verticaux (entre i−1 et i), puis horizontaux (entre j−1 et j), fusionnés le long de leur ligne.
  for (let i = 1; i < h.nx; i++) {
    const x = h.x0 + i * h.s;
    scan(h.ny, (j) => jump(hullCell(h, i - 1, j), hullCell(h, i, j), x, h.y0 + (j + 0.5) * h.s), (r) => out.push([x, h.y0 + r.a * h.s, x, h.y0 + r.b * h.s, r.top, r.low]));
  }
  for (let j = 1; j < h.ny; j++) {
    const y = h.y0 + j * h.s;
    scan(h.nx, (i) => jump(hullCell(h, i, j - 1), hullCell(h, i, j), h.x0 + (i + 0.5) * h.s, y), (r) => out.push([h.x0 + r.a * h.s, y, h.x0 + r.b * h.s, y, r.top, r.low]));
  }
  return out;
}

/**
 * Murs d'un contour (fermé ou non) avec leur haut tiré du relevé : découpés au pas des cases, le haut de chaque point est la plus haute case
 * voisine (à 1,5 case), et les pièces alignées de haut presque linéaire sont refondues. Sans case voisine : le haut du relevé.
 */
export function hullWalls(h: Hull, pts: readonly number[], closed: boolean): [number, number, number, number, number, number][] {
  const n = pts.length / 2;
  const P: [number, number, number][] = [];
  const r = h.s * 1.5;
  const top = (x: number, y: number): number => {
    const v = hullTopNear(h, x, y, r);
    return Number.isNaN(v) ? h.top : v;
  };
  const last = closed ? n : n - 1;
  for (let k = 0; k < last; k++) {
    const ax = pts[2 * k]!, ay = pts[2 * k + 1]!, bx = pts[(2 * (k + 1)) % (2 * n)]!, by = pts[(2 * (k + 1) + 1) % (2 * n)]!;
    const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / h.s));
    for (let q = 0; q < m; q++) {
      const x = ax + ((bx - ax) * q) / m, y = ay + ((by - ay) * q) / m;
      P.push([x, y, top(x, y)]);
    }
  }
  if (closed) P.push([P[0]![0], P[0]![1], P[0]![2]]);
  else P.push([pts[2 * (n - 1)]!, pts[2 * (n - 1) + 1]!, top(pts[2 * (n - 1)]!, pts[2 * (n - 1) + 1]!)]);
  const out: [number, number, number, number, number, number][] = [];
  let a = 0;
  while (a < P.length - 1) {
    let b = a + 1;
    // On prolonge tant que les points du milieu sont alignés et suivent la droite des hauts (à 20 cm près).
    while (b + 1 < P.length && fits(P, a, b + 1)) b++;
    out.push([P[a]![0], P[a]![1], P[b]![0], P[b]![1], P[a]![2], P[b]![2]]);
    a = b;
  }
  return out;
}

function fits(P: readonly [number, number, number][], a: number, b: number): boolean {
  const [ax, ay, az] = P[a]!, [bx, by, bz] = P[b]!;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1e-9) return true;
  for (let k = a + 1; k < b; k++) {
    const [x, y, z] = P[k]!;
    const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len);
    const off = Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / len;
    if (off > 0.05 || Math.abs(az + t * (bz - az) - z) > 0.2) return false;
  }
  return true;
}
