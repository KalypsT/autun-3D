import { loadJson } from "./load";

/**
 * Données de navigation (public/data/nav, étape J2, D40) : un fichier JSON par super-tuile de 1 km, décodé en tableaux typés.
 * Coordonnées locales du jeu (x vers l'est, y vers le nord). Le graphe piéton et le graphe routier d'une super-tuile sont autonomes ;
 * les arêtes coupées à la frontière se terminent par des nœuds « portails » dont les voisins ont les mêmes coordonnées.
 */

export const NAV_VERSION = 1;

/** Types d'arêtes piétonnes (index de `NavIndex.pedTypes`). */
export const PED = {
  lane: 0, corner: 1, crossing: 2, crossingSignal: 3, crossingImplicit: 4, path: 5, steps: 6, plaza: 7, plazaLink: 8, pedestrianStreet: 9,
} as const;
/** Drapeaux d'arêtes piétonnes. */
export const PED_FLAG = { bridge: 1, steps: 2, lit: 4, shared: 8 } as const;
/** Drapeaux de nœuds (les deux premiers bits valent pour les deux graphes). */
export const NODE_FLAG = { portal: 1, worldEnd: 2, signal: 4, stop: 8, giveWay: 16, crossing: 32, miniRoundabout: 64, deadEnd: 128 } as const;
/** Drapeaux d'arêtes routières. */
export const ROAD_FLAG = { onewayForward: 1, onewayBack: 2, bridge: 4, tunnel: 8, roundabout: 16, lit: 32, aisle: 64, bus: 128 } as const;
/** Zones de densité de population. */
export const ZONE = { centre: 0, residential: 1, outskirts: 2, nature: 3 } as const;

export interface NavIndex {
  version: number;
  /** Côté d'une super-tuile (m). */
  cell: number;
  gridOrigin: [number, number];
  stride: { ped: { n: number; e: number }; road: { n: number; e: number; s: number; r: number }; poi: number };
  poiKinds: string[];
  pedTypes: string[];
  cells: { id: string; bytes: number }[];
}

/** Graphe piéton d'une super-tuile. Les indices d'arêtes et de nœuds sont locaux à la super-tuile. */
export interface PedLayer {
  nodes: number;
  edges: number;
  nodeX: Float32Array;
  nodeY: Float32Array;
  nodeFlags: Uint8Array;
  a: Uint16Array;
  b: Uint16Array;
  type: Uint8Array;
  flags: Uint8Array;
  /** Largeur libre (m). */
  width: Float32Array;
  /** Fréquentation 0 à 255. */
  foot: Uint8Array;
  zone: Uint8Array;
  /** Longueur de la polyligne (m), recalculée sur la géométrie. */
  length: Float32Array;
  /** Identifiant de la voie OpenStreetMap ; pour un passage, celle qu'il traverse. */
  ref: Float64Array;
  /** Sommets intérieurs : arête e = geom[2·p0[e] .. 2·(p0[e] + np[e])). */
  p0: Uint32Array;
  np: Uint16Array;
  geom: Float32Array;
  /** Distance cumulée à la fin de chacun des np + 1 segments de l'arête e, à partir de `cumAt[e]`. */
  cumAt: Uint32Array;
  cum: Float32Array;
  /** Arêtes incidentes à chaque nœud (format CSR). */
  adjStart: Uint32Array;
  adj: Uint16Array;
  /** Nœuds portails : clé de coordonnées → nœud local, et l'inverse. */
  portals: Map<string, number>;
  portalKey: Map<number, string>;
}

/** Graphe routier d'une super-tuile (J3 l'utilisera ; décodé tel quel). */
export interface RoadLayer {
  nodes: number;
  edges: number;
  nodeX: Float32Array;
  nodeY: Float32Array;
  nodeFlags: Uint8Array;
  a: Uint16Array;
  b: Uint16Array;
  cls: Uint8Array;
  flags: Uint8Array;
  lanes: Uint8Array;
  /** km/h */
  speed: Uint8Array;
  width: Float32Array;
  length: Float32Array;
  gid: Float64Array;
  p0: Uint32Array;
  np: Uint16Array;
  geom: Float32Array;
  /** Approches de panneaux : nœud, arête, type (1 stop, 2 cédez-le-passage, 3 feux ; + 8 : direction inconnue). */
  signNode: Uint16Array;
  signEdge: Uint16Array;
  signKind: Uint8Array;
  /** Restrictions de virage : arête d'arrivée, arête de départ, code. */
  restrFrom: Uint16Array;
  restrTo: Uint16Array;
  restrCode: Uint8Array;
}

export interface NavPois {
  count: number;
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  /** Cap (rad, 0 = nord, sens horaire) vers la file piétonne la plus proche. */
  heading: Float32Array;
  /** Distance à cette file (m). */
  dist: Float32Array;
}

export interface NavCell {
  id: string;
  bounds: [number, number, number, number];
  ped: PedLayer;
  road: RoadLayer;
  poi: NavPois;
}

interface RawGraph { n: number[]; e: number[]; g: number[]; s?: number[]; r?: number[] }
interface RawCell { v: number; id: string; bounds: [number, number, number, number]; ped: RawGraph; road: RawGraph; poi: number[] }

const PED_N = 3, PED_E = 11, ROAD_N = 3, ROAD_E = 11, POI_S = 5;

function check(cond: boolean, id: string, what: string): void {
  if (!cond) throw new Error(`navigation ${id} : ${what}`);
}

/** Décode un fichier de super-tuile. Lève une erreur si la version ou les tailles de tableaux ne correspondent pas. */
export function decodeNavCell(raw: RawCell): NavCell {
  const id = String(raw?.id);
  check(raw?.v === NAV_VERSION, id, `version ${String(raw?.v)} inconnue`);
  const ped = decodePed(raw.ped, id);
  const road = decodeRoad(raw.road, id);
  const p = raw.poi;
  check(p.length % POI_S === 0, id, "points d'intérêt mal formés");
  const count = p.length / POI_S;
  const poi: NavPois = { count, kind: new Uint8Array(count), x: new Float32Array(count), y: new Float32Array(count), heading: new Float32Array(count), dist: new Float32Array(count) };
  for (let i = 0; i < count; i++) {
    poi.kind[i] = p[i * POI_S]!;
    poi.x[i] = p[i * POI_S + 1]!;
    poi.y[i] = p[i * POI_S + 2]!;
    poi.heading[i] = p[i * POI_S + 3]!;
    poi.dist[i] = p[i * POI_S + 4]! / 10;
  }
  return { id, bounds: raw.bounds, ped, road, poi };
}

/** Distances cumulées le long de chaque arête (np + 1 segments : nœud a, sommets intérieurs, nœud b). */
function cumulative(nodeX: Float32Array, nodeY: Float32Array, a: Uint16Array, b: Uint16Array, p0: Uint32Array, np: Uint16Array, geom: Float32Array, edges: number): { cumAt: Uint32Array; cum: Float32Array; length: Float32Array } {
  const cumAt = new Uint32Array(edges), length = new Float32Array(edges);
  let total = 0;
  for (let e = 0; e < edges; e++) {
    cumAt[e] = total;
    total += np[e]! + 1;
  }
  const cum = new Float32Array(total);
  for (let e = 0; e < edges; e++) {
    let x = nodeX[a[e]!]!, y = nodeY[a[e]!]!, s = 0;
    const at = cumAt[e]!;
    for (let k = 0; k <= np[e]!; k++) {
      const nx = k < np[e]! ? geom[(p0[e]! + k) * 2]! : nodeX[b[e]!]!, ny = k < np[e]! ? geom[(p0[e]! + k) * 2 + 1]! : nodeY[b[e]!]!;
      s += Math.hypot(nx - x, ny - y);
      cum[at + k] = s;
      x = nx;
      y = ny;
    }
    length[e] = s;
  }
  return { cumAt, cum, length };
}

function decodeNodes(n: number[], stride: number, id: string): { count: number; x: Float32Array; y: Float32Array; flags: Uint8Array } {
  check(n.length % stride === 0, id, "nœuds mal formés");
  const count = n.length / stride;
  const x = new Float32Array(count), y = new Float32Array(count), flags = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = n[i * stride]!;
    y[i] = n[i * stride + 1]!;
    flags[i] = n[i * stride + 2]!;
  }
  return { count, x, y, flags };
}

function decodePed(raw: RawGraph, id: string): PedLayer {
  const nodes = decodeNodes(raw.n, PED_N, id);
  check(raw.e.length % PED_E === 0 && raw.g.length % 2 === 0, id, "arêtes piétonnes mal formées");
  const edges = raw.e.length / PED_E;
  const a = new Uint16Array(edges), b = new Uint16Array(edges), type = new Uint8Array(edges), flags = new Uint8Array(edges), width = new Float32Array(edges);
  const foot = new Uint8Array(edges), zone = new Uint8Array(edges), ref = new Float64Array(edges), p0 = new Uint32Array(edges), np = new Uint16Array(edges);
  const e = raw.e;
  for (let i = 0; i < edges; i++) {
    const o = i * PED_E;
    a[i] = e[o]!; b[i] = e[o + 1]!; type[i] = e[o + 2]!; flags[i] = e[o + 3]!; width[i] = e[o + 4]! / 10; foot[i] = e[o + 5]!; zone[i] = e[o + 6]!;
    ref[i] = e[o + 8]!; p0[i] = e[o + 9]!; np[i] = e[o + 10]!;
    check(a[i]! < nodes.count && b[i]! < nodes.count && p0[i]! + np[i]! <= raw.g.length / 2, id, `arête piétonne ${i} hors tableaux`);
  }
  const geom = Float32Array.from(raw.g);
  const { cumAt, cum, length } = cumulative(nodes.x, nodes.y, a, b, p0, np, geom, edges);
  // Arêtes incidentes à chaque nœud.
  const adjStart = new Uint32Array(nodes.count + 1);
  for (let i = 0; i < edges; i++) {
    adjStart[a[i]! + 1]!++;
    adjStart[b[i]! + 1]!++;
  }
  for (let i = 0; i < nodes.count; i++) adjStart[i + 1]! += adjStart[i]!;
  const fill = adjStart.slice(0, nodes.count);
  const adj = new Uint16Array(adjStart[nodes.count]!);
  for (let i = 0; i < edges; i++) {
    adj[fill[a[i]!]!++] = i;
    adj[fill[b[i]!]!++] = i;
  }
  const portals = new Map<string, number>(), portalKey = new Map<number, string>();
  for (let i = 0; i < nodes.count; i++) {
    if (!(nodes.flags[i]! & 1)) continue;
    const key = `${raw.n[i * PED_N]},${raw.n[i * PED_N + 1]}`;
    portals.set(key, i);
    portalKey.set(i, key);
  }
  return { nodes: nodes.count, edges, nodeX: nodes.x, nodeY: nodes.y, nodeFlags: nodes.flags, a, b, type, flags, width, foot, zone, length, ref, p0, np, geom, cumAt, cum, adjStart, adj, portals, portalKey };
}

function decodeRoad(raw: RawGraph, id: string): RoadLayer {
  const nodes = decodeNodes(raw.n, ROAD_N, id);
  check(raw.e.length % ROAD_E === 0 && raw.g.length % 2 === 0, id, "arêtes routières mal formées");
  const edges = raw.e.length / ROAD_E;
  const a = new Uint16Array(edges), b = new Uint16Array(edges), cls = new Uint8Array(edges), flags = new Uint8Array(edges), lanes = new Uint8Array(edges);
  const speed = new Uint8Array(edges), width = new Float32Array(edges), gid = new Float64Array(edges), p0 = new Uint32Array(edges), np = new Uint16Array(edges);
  const e = raw.e;
  for (let i = 0; i < edges; i++) {
    const o = i * ROAD_E;
    a[i] = e[o]!; b[i] = e[o + 1]!; cls[i] = e[o + 2]!; flags[i] = e[o + 3]!; lanes[i] = e[o + 4]!; speed[i] = e[o + 5]!; width[i] = e[o + 6]! / 10;
    gid[i] = e[o + 8]!; p0[i] = e[o + 9]!; np[i] = e[o + 10]!;
    check(a[i]! < nodes.count && b[i]! < nodes.count && p0[i]! + np[i]! <= raw.g.length / 2, id, `arête routière ${i} hors tableaux`);
  }
  const geom = Float32Array.from(raw.g);
  const length = cumulative(nodes.x, nodes.y, a, b, p0, np, geom, edges).length;
  const s = raw.s ?? [], r = raw.r ?? [];
  check(s.length % 3 === 0 && r.length % 3 === 0, id, "panneaux ou restrictions mal formés");
  const signNode = new Uint16Array(s.length / 3), signEdge = new Uint16Array(s.length / 3), signKind = new Uint8Array(s.length / 3);
  for (let i = 0; i < signNode.length; i++) {
    signNode[i] = s[i * 3]!; signEdge[i] = s[i * 3 + 1]!; signKind[i] = s[i * 3 + 2]!;
  }
  const restrFrom = new Uint16Array(r.length / 3), restrTo = new Uint16Array(r.length / 3), restrCode = new Uint8Array(r.length / 3);
  for (let i = 0; i < restrFrom.length; i++) {
    restrFrom[i] = r[i * 3]!; restrTo[i] = r[i * 3 + 1]!; restrCode[i] = r[i * 3 + 2]!;
  }
  return { nodes: nodes.count, edges, nodeX: nodes.x, nodeY: nodes.y, nodeFlags: nodes.flags, a, b, cls, flags, lanes, speed, width, length, gid, p0, np, geom, signNode, signEdge, signKind, restrFrom, restrTo, restrCode };
}

export function loadNavIndex(): Promise<NavIndex> {
  return loadJson<NavIndex>("nav/index.json").then((i) => {
    if (i.version !== NAV_VERSION) throw new Error(`navigation : index de version ${i.version}`);
    return i;
  });
}

export function loadNavCell(id: string): Promise<NavCell> {
  return loadJson<RawCell>(`nav/${id}.json`).then(decodeNavCell);
}
