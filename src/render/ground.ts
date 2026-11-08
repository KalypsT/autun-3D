import * as THREE from "three";
import { finish, hash01, MeshBuilder, type Steps } from "./geometry";
import { T } from "./style";
import type { HeightField } from "../data/types";

/** Index de la couleur du thème (T.ground : asphalte, pavés, gravier, herbe, trottoir, dallage) et hauteur au-dessus du relief. */
const LAYERS: Record<string, { color: number | "water" | "pitch" | `paving${number}`; lift: number; tint?: number }> = {
  road_asphalt: { color: 0, lift: 0.045 },
  road_sett: { color: 1, lift: 0.045 },
  road_gravel: { color: 2, lift: 0.045 },
  road_paving: { color: 5, lift: 0.045 },
  plaza_paving: { color: 5, lift: 0.035 },
  plaza_sett: { color: 1, lift: 0.035 },
  plaza_gravel: { color: 2, lift: 0.035 },
  plaza_asphalt: { color: 0, lift: 0.035, tint: 1.12 },
  // Rues piétonnes du centre (D156) : pavés de granit, pavés de béton, béton clair ; caniveau par-dessus.
  plaza_granite: { color: "paving0", lift: 0.035 },
  plaza_pavers: { color: "paving1", lift: 0.035 },
  plaza_concrete: { color: "paving2", lift: 0.035 },
  gutter: { color: "paving3", lift: 0.05 },
  // Parvis de l'Hexagone (D167) : fond clair et filets, brique rose, ardoise ; les motifs se posent sans se recouvrir, un peu plus haut que les autres places (le relief bosse autour du socle de la sphère et perçait la dalle).
  plaza_brick: { color: "paving4", lift: 0.072 },
  plaza_slate: { color: "paving5", lift: 0.072 },
  plaza_filet: { color: "paving6", lift: 0.065 },
  // Chemin du tour du plan d'eau du Vallon (D244) : stabilisé clair, au-dessus de la pelouse.
  path_gravel: { color: "paving7", lift: 0.04 },
  // Cale de mise à l'eau de la base nautique (D246) : béton clair posé sur la rampe du relief, jusque sous l'eau.
  slipway: { color: "paving2", lift: 0.05 },
  // Quai de la darse (D246) : enrobé, au niveau de l'eau.
  quay: { color: 0, lift: 0.04, tint: 1.08 },
  // Équipements du plan d'eau du Vallon (D247) : dalle du skatepark (béton gris, sur le relief nu : les modules la recouvrent), gravillons et
  // sol souple rouge de l'aire de jeux.
  skate: { color: "paving2", lift: 0.06, tint: 0.92 },
  play_gravel: { color: 2, lift: 0.032, tint: 1.08 },
  play_mat: { color: "paving4", lift: 0.05 },
  // Terrils des Télots (D269) : schiste brûlé rose saumon et schiste noir posés sur le relief nu, sentier en lacets de terre rose tassée.
  schist_black: { color: "paving9", lift: 0.03 },
  schist_red: { color: "paving8", lift: 0.033 },
  path_schist: { color: "paving10", lift: 0.045 },
  // Golf municipal (D288) : fairways tondus en bandes, greens, départs, bunkers ; sur le relief nu, comme les pelouses.
  golf_fairway: { color: "paving11", lift: 0.032 },
  golf_fairway2: { color: "paving12", lift: 0.032 },
  golf_bunker: { color: "paving15", lift: 0.036 },
  golf_tee: { color: "paving14", lift: 0.04 },
  golf_green: { color: "paving13", lift: 0.042 },
  // Terrasse du club-house (D289) : pavés autobloquants rouge brique.
  golf_terrace: { color: "paving4", lift: 0.06 },
  // Allée de gravier derrière les tapis du practice (D290).
  golf_path: { color: "paving7", lift: 0.04 },
  walk: { color: 4, lift: 0.15 },
  lawn: { color: 3, lift: 0.03, tint: 1.12 },
  pitch: { color: "pitch", lift: 0.035 },
  water: { color: "water", lift: 0.01 },
};
const MARK_LIFT = 0.08;
const MARK_YELLOW = "#e8c12f";
/** Bleu des places PMR (D236), posé sous les traits blancs. */
const MARK_BLUE = "#2f6db5";
const MAX_EDGE = 5;
/** Côté maximal des triangles des sols de terril (D269). */
const STEEP_EDGE = 1.5;
const CURB_FOOT = 0.0;

type P = [number, number];

function area(ring: readonly number[]): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[2 * i]! * ring[2 * j + 1]! - ring[2 * j]! * ring[2 * i + 1]!;
  }
  return a / 2;
}

/** Sols vectoriels d'une tuile : chaussées, places, trottoirs (avec bordure), marquages. Un seul maillage. */
export function buildGround(layers: Record<string, number[][][]>, bounds: readonly number[], terrain: HeightField): MeshBuilder {
  return finish(buildGroundSteps(layers, bounds, terrain));
}

/** Comme `buildGround`, en rendant la main après chaque polygone. */
export function* buildGroundSteps(layers: Record<string, number[][][]>, bounds: readonly number[], terrain: HeightField): Steps<MeshBuilder> {
  const mb = new MeshBuilder();
  // Pelouses, eau et terrains restent sur le relief nu ; chaussées, trottoirs et places suivent les tabliers de pont (D93).
  const bare = terrain.ground ?? terrain;
  const eps = 0.02;
  const onEdge = (x: number, y: number): boolean => Math.abs(x - bounds[0]!) < eps || Math.abs(x - bounds[2]!) < eps || Math.abs(y - bounds[1]!) < eps || Math.abs(y - bounds[3]!) < eps;

  for (const [name, spec] of Object.entries(LAYERS)) {
    const polys = layers[name];
    if (!polys) continue;
    const hex = spec.color === "water" ? T.water : spec.color === "pitch" ? T.pitch : typeof spec.color === "string" ? T.paving[Number(spec.color.slice(6))]! : T.ground[spec.color]!;
    const color = new THREE.Color(hex).multiplyScalar(spec.tint ?? 1);
    for (const poly of polys) {
      // Terrils (D269) : pentes à 35° et talus des lacets, le sol suit le relief à 1,5 m près (sinon il passe dessous par endroits).
      const steep = name.startsWith("schist") || name === "path_schist";
      yield* fillOnTerrainSteps(mb, poly, spec.lift, color, name === "lawn" || name === "water" || name === "pitch" || name === "skate" || name.startsWith("golf_") || steep ? bare : terrain, true, steep ? STEEP_EDGE : MAX_EDGE);
      yield;
      if (name === "walk") {
        curbs(mb, [poly], terrain, color, onEdge);
        yield;
      }
    }
  }
  // Fond bleu des places PMR (D236), juste sous les traits blancs.
  const blue = new THREE.Color(MARK_BLUE);
  for (const poly of layers["marks_blue"] ?? []) {
    yield* fillOnTerrainSteps(mb, poly, MARK_LIFT - 0.01, blue, terrain, false);
    yield;
  }
  const marks = new THREE.Color(T.trim);
  for (const poly of layers["marks"] ?? []) {
    yield* fillOnTerrainSteps(mb, poly, MARK_LIFT, marks, terrain, false);
    yield;
  }
  // Marques jaunes (D230 : zigzag des arrêts de bus de la gare routière).
  const yellow = new THREE.Color(MARK_YELLOW);
  for (const poly of layers["marks_yellow"] ?? []) {
    yield* fillOnTerrainSteps(mb, poly, MARK_LIFT, yellow, terrain, false);
    yield;
  }
  return mb;
}

/** Côté le plus court en dessous duquel on ne recoupe plus un triangle à cheval sur le bord d'un tablier (m). */
const FINE = 0.3;
/** Écart d'altitude au-dessus duquel un point est « sur le tablier » plutôt que sur le relief (m). */
const ON_DECK = 0.25;

/**
 * Altitude où poser le sol des rues et son niveau : 0 sur le relief, 1 sur un tablier ou un quai, 2 sous un tablier qui enjambe une
 * autre voie (rien à poser, D93). Sans `paveAt` (relief nu, tests), tout est au niveau 0 et suit `heightAt`.
 */
export function paver(terrain: HeightField): { z: (x: number, y: number) => number; level: (x: number, y: number) => number; split: boolean } {
  const pave = terrain.paveAt;
  if (!pave) return { z: (x, y) => terrain.heightAt(x, y), level: () => 0, split: false };
  const bare = terrain.ground ?? terrain;
  const z = (x: number, y: number): number => pave.call(terrain, x, y);
  return {
    z,
    level: (x, y) => {
      const h = z(x, y);
      return Number.isNaN(h) ? 2 : h - bare.heightAt(x, y) > ON_DECK ? 1 : 0;
    },
    split: true,
  };
}

/**
 * Polygone (anneau extérieur puis trous, coordonnées aplaties) posé sur le relief à `lift` mètres au-dessus : triangulé, puis les
 * triangles trop grands sont recoupés pour que leurs sommets épousent le relief. `jitter` nuance légèrement la teinte par polygone.
 * Sur un pont (D93), le sol suit le tablier ; un triangle à cheval sur le bord du tablier est recoupé jusqu'à quelques décimètres, et
 * les morceaux qui iraient du tablier au relief (la rampe ou le mur qu'on voyait sous les ponts) sont laissés vides, comme ceux qui
 * tombent sous un tablier enjambant une autre voie.
 */
export function fillOnTerrain(mb: MeshBuilder, poly: number[][], lift: number, color: THREE.Color, terrain: HeightField, jitter = false, maxEdge = MAX_EDGE): void {
  finish(fillOnTerrainSteps(mb, poly, lift, color, terrain, jitter, maxEdge));
}

/**
 * Triangles examinés (posés, recoupés ou écartés) entre deux points d'arrêt de `fillOnTerrainSteps` (D284) : un grand polygone recoupé
 * finement sous un pont (chaussée de 5 150 m² sous la voie ferrée, tuile 23_36) prenait 68 ms d'un bloc sur PC, ≈ 90 ms sur le téléphone.
 */
const FILL_WORK_PER_STEP = 100;

/** Comme `fillOnTerrain`, en rendant la main tous les `FILL_WORK_PER_STEP` triangles examinés. */
export function* fillOnTerrainSteps(mb: MeshBuilder, poly: number[][], lift: number, color: THREE.Color, terrain: HeightField, jitter = false, maxEdge = MAX_EDGE): Steps<void> {
  const pv = paver(terrain);
  const bare = terrain.ground ?? terrain;
  const normalAt = (x: number, y: number, level: number): [number, number, number] => {
    const e = 1;
    const f = level === 1 ? terrain : bare;
    const gx = (f.heightAt(x + e, y) - f.heightAt(x - e, y)) / (2 * e), gy = (f.heightAt(x, y + e) - f.heightAt(x, y - e)) / (2 * e);
    const l = Math.hypot(gx, gy, 1);
    return [-gx / l, 1 / l, gy / l];
  };
  // Altitudes (sol dessiné, relief nu) de chaque point examiné, une seule fois : les sommets et milieux sont partagés entre morceaux voisins,
  // et sous un pont qui enjambe une voie chaque altitude coûte cher (`Decks.carve`, D284).
  const memo = new Map<number, Map<number, [number, number]>>();
  const sample = (x: number, y: number): [number, number] => {
    let row = memo.get(x);
    if (!row) memo.set(x, (row = new Map()));
    let v = row.get(y);
    if (!v) row.set(y, (v = [pv.z(x, y), bare.heightAt(x, y)]));
    return v;
  };
  const zOf = (x: number, y: number): number => (pv.split ? sample(x, y)[0] : pv.z(x, y));
  const levelOf = (v: [number, number]): number => (Number.isNaN(v[0]) ? 2 : v[0] - v[1] > ON_DECK ? 1 : 0);
  // Triangles à poser ou à recouper, en profondeur d'abord (pile explicite plutôt que récursion : on peut rendre la main au milieu d'un triangle).
  const stack: [P, P, P, number][] = [];
  const emit = (a: P, b: P, c: P, col: THREE.Color, depth: number): void => {
    const longest = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
    // Niveaux aux sommets et aux milieux des côtés : un triangle qui touche un tablier est recoupé finement.
    let mixed = false, level = 0;
    if (pv.split) {
      const pts: P[] = [a, b, c, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2]];
      const samples = pts.map((p) => sample(p[0], p[1]));
      const levels = samples.map(levelOf);
      level = levels[0]!;
      if (levels.every((l) => l === 2)) return;
      // Niveaux différents : à recouper seulement si l'on passe sous un tablier ou si l'écart d'altitude est réel (pas au ras d'une culée).
      if (levels.some((l) => l !== level)) {
        const lifts = samples.map((v) => v[0] - v[1]);
        mixed = levels.includes(2) || Math.max(...lifts) - Math.min(...lifts) > 2 * ON_DECK;
      }
    }
    if ((longest > maxEdge && depth < (maxEdge < MAX_EDGE ? 14 : 6)) || (mixed && longest > FINE && depth < 16)) {
      // Coupe le plus long côté en deux : les sommets épousent le relief.
      const pts = [a, b, c];
      let k = 0, best = 0;
      for (let i = 0; i < 3; i++) {
        const p = pts[i]!, q = pts[(i + 1) % 3]!;
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d > best) {
          best = d;
          k = i;
        }
      }
      const p = pts[k]!, q = pts[(k + 1) % 3]!, r = pts[(k + 2) % 3]!;
      const m: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      // Le second morceau sous le premier : même ordre que la récursion.
      stack.push([m, q, r, depth + 1], [p, m, r, depth + 1]);
      return;
    }
    const za = zOf(a[0], a[1]), zb = zOf(b[0], b[1]), zc = zOf(c[0], c[1]);
    if (mixed && (Number.isNaN(za + zb + zc) || Math.max(za, zb, zc) - Math.min(za, zb, zc) > 2 * ON_DECK)) return;
    mb.tri([a[0], za + lift, -a[1]], [b[0], zb + lift, -b[1]], [c[0], zc + lift, -c[1]], normalAt(a[0], a[1], level), col);
  };
  const ring = (r: number[]): THREE.Vector2[] => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < r.length; i += 2) pts.push(new THREE.Vector2(r[i], r[i + 1]));
    return pts;
  };
  const contour = ring(poly[0]!);
  if (contour.length < 3) return;
  const holes = poly.slice(1).map(ring);
  const verts = [...contour, ...holes.flat()];
  const col = jitter ? color.clone().multiplyScalar(0.97 + hash01(`${poly[0]![0]},${poly[0]![1]}`) * 0.06) : color;
  let work = 0;
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    const a = verts[i!]!, b = verts[j!]!, c = verts[k!]!;
    stack.push([[a.x, a.y], [b.x, b.y], [c.x, c.y], 0]);
    while (stack.length > 0) {
      const [p, q, r, depth] = stack.pop()!;
      emit(p, q, r, col, depth);
      if (++work >= FILL_WORK_PER_STEP) {
        work = 0;
        yield;
      }
    }
  }
}

/** Bordures : une face verticale sur le contour des trottoirs, sauf sur les bords de tuile. */
function curbs(mb: MeshBuilder, polys: number[][][], terrain: HeightField, top: THREE.Color, onEdge: (x: number, y: number) => boolean): void {
  const face = top.clone().multiplyScalar(0.8);
  const lip = top.clone().multiplyScalar(1.1);
  const H = LAYERS["walk"]!.lift;
  const pv = paver(terrain);
  for (const poly of polys) {
    poly.forEach((ring, ri) => {
      const s = area(ring) > 0 ? 1 : -1;
      const sign = ri === 0 ? s : -s;
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x1 = ring[2 * i]!, y1 = ring[2 * i + 1]!, x2 = ring[2 * j]!, y2 = ring[2 * j + 1]!;
        if (onEdge(x1, y1) && onEdge(x2, y2) && (Math.abs(x1 - x2) < 0.02 || Math.abs(y1 - y2) < 0.02)) continue;
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 0.05) continue;
        // Découpe les longs côtés pour suivre le relief ; au bord d'un tablier, recoupe finement et laisse vide ce qui irait du tablier
        // au relief ou passerait sous un tablier qui enjambe une voie (comme `fillOnTerrain`).
        const nx = (sign * (y2 - y1)) / len, ny = (sign * -(x2 - x1)) / len;
        const piece = (ax: number, ay: number, bx: number, by: number, depth: number): void => {
          const l = Math.hypot(bx - ax, by - ay);
          if (l > MAX_EDGE && depth < 8) {
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            piece(ax, ay, mx, my, depth + 1);
            piece(mx, my, bx, by, depth + 1);
            return;
          }
          let mixed = false;
          if (pv.split) {
            const la = pv.level(ax, ay), lb = pv.level(bx, by), lm = pv.level((ax + bx) / 2, (ay + by) / 2);
            mixed = la !== lb || la !== lm;
            if (!mixed && la === 2) return;
            if (mixed && l > FINE && depth < 16) {
              const mx = (ax + bx) / 2, my = (ay + by) / 2;
              piece(ax, ay, mx, my, depth + 1);
              piece(mx, my, bx, by, depth + 1);
              return;
            }
          }
          const za = pv.z(ax, ay), zb = pv.z(bx, by);
          if (mixed && (Number.isNaN(za + zb) || Math.abs(za - zb) > 2 * ON_DECK)) return;
          const pa: [number, number, number] = [ax, za + CURB_FOOT, -ay], pb: [number, number, number] = [bx, zb + CURB_FOOT, -by];
          const ta: [number, number, number] = [ax, za + H, -ay], tb: [number, number, number] = [bx, zb + H, -by];
          mb.quad(pa, pb, tb, ta, [nx, 0, -ny], face);
          // Liseré clair sur l'arête haute.
          const l0 = 0.03;
          mb.quad([ax, za + H - l0, -ay], [bx, zb + H - l0, -by], tb, ta, [nx, 0, -ny], lip);
        };
        piece(x1, y1, x2, y2, 0);
      }
    });
  }
}
