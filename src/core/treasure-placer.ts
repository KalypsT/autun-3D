import type { Building, HeightField } from "../data/types";
import { BUILDING_CLIMB } from "./collision";
import { reshapeBuilding, walkableRoof, isOpen } from "./landmarks";
import { pointInRing } from "./ring";
import { roofPlanes, type RoofPlane } from "./roofs";
import type { BuildingKind } from "../data/types";

/** Un objet caché tel qu'enregistré dans `src/data/treasures.json` (généré par `npm run treasures`). */
export interface TreasureSite {
  id: string;
  /** Bâtiment dont il occupe le toit. */
  building: string;
  x: number;
  y: number;
  /** Altitude du toit sous l'objet (m). */
  z: number;
  /** 1 facile (mur bas), 2 moyen (de toit en toit), 3 difficile (saut, ou long chemin de toits). */
  level: 1 | 2 | 3;
  /** Quartier (carnet). */
  group: string;
}

/** Centre de la ville (la mairie) et rayon (m) du « centre » pour la répartition et les quartiers. */
export const CITY_CENTRE = { x: 16, y: 91, r: 700 } as const;

/** Quartier d'un point : le centre, ou le secteur nord, est, sud, ouest autour de la mairie. */
export function quarterOf(x: number, y: number): string {
  const dx = x - CITY_CENTRE.x, dy = y - CITY_CENTRE.y;
  if (Math.hypot(dx, dy) <= CITY_CENTRE.r) return "Centre";
  const a = Math.atan2(dx, dy);
  if (Math.abs(a) <= Math.PI / 4) return "Nord";
  if (Math.abs(a) >= (3 * Math.PI) / 4) return "Sud";
  return a > 0 ? "Est" : "Ouest";
}

/** Niveau d'un accès : 1 mur bas ; 2 de 2 à 4 étapes de toit en toit ; 3 un saut, ou 5 étapes et plus. 0 : inaccessible. */
export function levelOf(a: Access): 0 | 1 | 2 | 3 {
  if (a.steps <= 0) return 0;
  if (a.steps === 1) return 1;
  return a.jump || a.steps >= 5 ? 3 : 2;
}

/** Nombre d'objets à placer, par zone et par niveau (centre : 4 + 4 + 4 ; ailleurs : 6 + 6 + 6). Distance minimale entre deux objets (m). */
export const TREASURE_QUOTAS = { centre: [4, 4, 4], outside: [6, 6, 6] } as const;
export const TREASURE_SPACING = 120;

/** Hachage stable d'un identifiant : l'ordre de tirage des candidats, le même d'une génération à l'autre. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Choisit les objets : par zone et par niveau selon `TREASURE_QUOTAS`, espacés de `TREASURE_SPACING`, dans un ordre stable. */
export function pickTreasures(nodes: readonly RoofNode[], access: readonly Access[]): TreasureSite[] {
  const cands = nodes
    .map((n, i) => ({ n, level: levelOf(access[i]!), spot: roofSpot(n) }))
    .filter((c) => c.level > 0 && c.spot)
    .sort((a, b) => hash(a.n.id) - hash(b.n.id));
  const out: TreasureSite[] = [];
  const left = { centre: [...TREASURE_QUOTAS.centre], outside: [...TREASURE_QUOTAS.outside] };
  for (const c of cands) {
    const { x, y, z } = c.spot!;
    const zone = Math.hypot(x - CITY_CENTRE.x, y - CITY_CENTRE.y) <= CITY_CENTRE.r ? "centre" : "outside";
    const q = left[zone];
    if (q[c.level - 1]! <= 0) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.y - y) < TREASURE_SPACING)) continue;
    q[c.level - 1]!--;
    out.push({ id: "", building: c.n.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 100) / 100, level: c.level as 1 | 2 | 3, group: quarterOf(x, y) });
  }
  // Numérotés du nord au sud, pour un fichier lisible.
  out.sort((a, b) => b.y - a.y);
  out.forEach((t, i) => (t.id = `piece-${String(i + 1).padStart(2, "0")}`));
  return out;
}

/**
 * Placement des objets cachés sur les toits (plaisir de jeu, phase 3, lot 5, D321) : hors du jeu (générateur et test), sur les vrais
 * bâtiments. On bâtit un **graphe d'accès** entre le sol et les toits praticables, avec les règles du joueur (D218) :
 * - du sol, on grimpe sur un toit dont le mur dépasse d'au plus `CLIMB` le sol devant lui ;
 * - d'un toit, on passe sur le toit voisin (mitoyen) si son mur dépasse d'au plus `CLIMB` le toit d'où l'on part (on descend toujours) ;
 * - d'un toit, on saute sur un autre au-dessus d'une ruelle de `JUMP_GAP` au plus, s'il n'est pas plus haut (saut long, 4,7 m sur le plat).
 * La **difficulté** d'un toit est le chemin le plus court depuis le sol : 1 (mur bas), 2 ou 3 (de toit en toit), et « saut » s'il faut sauter.
 * Les marges (2,3 m au lieu de 2,5, 3 m au lieu de 4,7) gardent de la place pour un pouce imprécis.
 */

/** Hauteur de mur (m) qu'on accepte pour l'escalade : un peu sous `BUILDING_CLIMB`. */
export const CLIMB = BUILDING_CLIMB - 0.2;
/** Largeur (m) de la ruelle qu'on accepte de sauter. */
export const JUMP_GAP = 3;
/** Pas (m) du relevé le long des murs. */
const STEP = 1.5;
/** Distance (m) devant le mur où l'on regarde le sol ou le toit d'en face. */
const OUT = 0.6;

export interface RoofNode {
  id: string;
  /** Altitude du sol du bâtiment (m). */
  ground: number;
  ring: readonly number[];
  top: readonly number[];
  planes: RoofPlane[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Altitude du toit d'un bâtiment en (x, y) : le pan le plus haut qui contient le point ; null hors du toit. */
export function roofAt(n: RoofNode, x: number, y: number): number | null {
  let z: number | null = null;
  for (const p of n.planes) {
    if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1 || !pointInRing(x, y, p.ring)) continue;
    if (p.holes.some((h) => pointInRing(x, y, h))) continue;
    const v = p.a * x + p.b * y + p.c;
    if (z === null || v > z) z = v;
  }
  return z;
}

/** Les bâtiments à toit praticable, remis à la forme de leur gabarit comme pour les collisions (`addTileColliders`). */
export function roofNodes(buildings: readonly Building[], kinds: { buildings: Record<string, BuildingKind> } | undefined): RoofNode[] {
  const out: RoofNode[] = [];
  for (const b of buildings) {
    if (isOpen(kinds, b.id)) continue;
    const kind = kinds?.buildings[b.id];
    if (kind?.house || !walkableRoof(kind) || kind?.cath || kind?.edu || kind?.gend || kind?.naut || kind?.mcd || kind?.bowl || kind?.college?.mil) continue;
    const r = reshapeBuilding(b, kind?.k, kind?.roof);
    const planes = roofPlanes(r);
    if (!planes.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < r.ring.length; i += 2) {
      x0 = Math.min(x0, r.ring[i]!);
      x1 = Math.max(x1, r.ring[i]!);
      y0 = Math.min(y0, r.ring[i + 1]!);
      y1 = Math.max(y1, r.ring[i + 1]!);
    }
    out.push({ id: b.id, ground: b.ground, ring: r.ring, top: r.top, planes, x0, y0, x1, y1 });
  }
  return out;
}

/** Grille des emprises, pour trouver vite le bâtiment sous un point. */
class Grid {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly nodes: readonly RoofNode[], private readonly cell = 16) {
    nodes.forEach((n, i) => {
      for (let ix = Math.floor(n.x0 / cell); ix <= Math.floor(n.x1 / cell); ix++)
        for (let iy = Math.floor(n.y0 / cell); iy <= Math.floor(n.y1 / cell); iy++) {
          const k = ix * 100003 + iy;
          const l = this.cells.get(k);
          if (l) l.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  /** Le bâtiment dont l'emprise contient (x, y), ou -1. */
  at(x: number, y: number): number {
    for (const i of this.cells.get(Math.floor(x / this.cell) * 100003 + Math.floor(y / this.cell)) ?? []) {
      const n = this.nodes[i]!;
      if (x >= n.x0 && x <= n.x1 && y >= n.y0 && y <= n.y1 && pointInRing(x, y, n.ring)) return i;
    }
    return -1;
  }
}

/** Accès à un toit : nombre d'étapes depuis le sol (0 : inaccessible) et s'il faut un saut. */
export interface Access {
  steps: number;
  jump: boolean;
}

/**
 * Graphe d'accès de toute la ville : pour chaque bâtiment, le chemin le plus court depuis le sol (un saut compte comme deux étapes, pour
 * préférer l'escalade). `obstacle(x, y)` : vrai si un point du sol n'est pas praticable (eau, intérieur d'un bâtiment non praticable).
 */
export function accessGraph(nodes: readonly RoofNode[], terrain: HeightField, blocked: (x: number, y: number) => boolean): Access[] {
  const grid = new Grid(nodes);
  const fromGround: boolean[] = nodes.map(() => false);
  const edges: { to: number; jump: boolean }[][] = nodes.map(() => []);
  nodes.forEach((n, i) => {
    const r = n.ring, m = r.length / 2;
    // Sens de l'anneau (aire signée) : la normale extérieure en dépend.
    let area = 0;
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      area += r[k * 2]! * r[j * 2 + 1]! - r[j * 2]! * r[k * 2 + 1]!;
    }
    const sgn = area > 0 ? 1 : -1;
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      const ax = r[k * 2]!, ay = r[k * 2 + 1]!, bx = r[j * 2]!, by = r[j * 2 + 1]!;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, nx = uy * sgn, ny = -ux * sgn;
      const ta = n.top[k]!, tb = n.top[j]!;
      for (let s = STEP / 2; s < len; s += STEP) {
        const px = ax + ux * s, py = ay + uy * s, top = ta + ((tb - ta) * s) / len;
        const qx = px + nx * OUT, qy = py + ny * OUT;
        const other = grid.at(qx, qy);
        if (other === i) continue;
        if (other < 0) {
          // Sol devant le mur : on grimpe si le mur n'est pas trop haut et si l'on peut s'y tenir.
          if (!blocked(qx, qy) && top - terrain.heightAt(qx, qy) <= CLIMB) fromGround[i] = true;
          // Saut depuis ce toit vers un toit d'en face, de l'autre côté d'une ruelle.
          const zHere = roofAt(n, px - nx * OUT, py - ny * OUT);
          if (zHere === null) continue;
          for (let d = 1; d <= JUMP_GAP; d += 0.5) {
            const c = grid.at(px + nx * (d + OUT), py + ny * (d + OUT));
            if (c < 0 || c === i) continue;
            const zc = roofAt(nodes[c]!, px + nx * (d + OUT + 0.4), py + ny * (d + OUT + 0.4));
            if (zc !== null && zc <= zHere + 0.3 && zc >= zHere - 4) edges[i]!.push({ to: c, jump: true });
            break;
          }
          continue;
        }
        // Toit mitoyen : de lui vers nous si notre mur ne le dépasse pas de plus de CLIMB.
        const zo = roofAt(nodes[other]!, qx, qy);
        if (zo !== null && top - zo <= CLIMB) edges[other]!.push({ to: i, jump: false });
      }
    }
  });
  // Plus court chemin (Dijkstra simple : coûts 1 ou 2, files par coût).
  const cost = nodes.map((_, i) => (fromGround[i] ? 1 : Infinity));
  const jump = nodes.map(() => false);
  const queue: number[][] = [[], []];
  nodes.forEach((_, i) => fromGround[i] && queue[1]!.push(i));
  for (let c = 1; c < queue.length; c++) {
    for (const i of queue[c] ?? []) {
      if (cost[i] !== c) continue;
      for (const e of edges[i]!) {
        const nc = c + (e.jump ? 2 : 1);
        if (nc < cost[e.to]!) {
          cost[e.to] = nc;
          jump[e.to] = jump[i]! || e.jump;
          (queue[nc] ??= []).push(e.to);
        }
      }
    }
  }
  return nodes.map((_, i) => ({ steps: Number.isFinite(cost[i]!) ? cost[i]! : 0, jump: jump[i]! }));
}

/** Un point sur un toit pour poser l'objet : le milieu de l'emprise s'il est sur le toit, sinon le milieu du plus grand pan. */
export function roofSpot(n: RoofNode): { x: number; y: number; z: number } | null {
  const cands: [number, number][] = [[(n.x0 + n.x1) / 2, (n.y0 + n.y1) / 2]];
  const big = [...n.planes].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0];
  if (big) {
    let sx = 0, sy = 0;
    const k = big.ring.length / 2;
    for (let i = 0; i < k; i++) {
      sx += big.ring[i * 2]!;
      sy += big.ring[i * 2 + 1]!;
    }
    cands.push([sx / k, sy / k]);
  }
  for (const [x, y] of cands) {
    const z = roofAt(n, x, y);
    if (z !== null && pointInRing(x, y, n.ring)) return { x, y, z };
  }
  return null;
}
