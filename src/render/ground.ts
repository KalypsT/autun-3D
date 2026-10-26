import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import { hash01, MeshBuilder } from "./geometry";
import { T } from "./style";

/** Index de la couleur du thème (T.ground : asphalte, pavés, gravier, herbe, trottoir, dallage) et hauteur au-dessus du relief. */
const LAYERS: Record<string, { color: number | "water" | "pitch"; lift: number; tint?: number }> = {
  road_asphalt: { color: 0, lift: 0.045 },
  road_sett: { color: 1, lift: 0.045 },
  road_gravel: { color: 2, lift: 0.045 },
  road_paving: { color: 5, lift: 0.045 },
  plaza_paving: { color: 5, lift: 0.035 },
  plaza_sett: { color: 1, lift: 0.035 },
  plaza_gravel: { color: 2, lift: 0.035 },
  plaza_asphalt: { color: 0, lift: 0.035, tint: 1.12 },
  walk: { color: 4, lift: 0.15 },
  lawn: { color: 3, lift: 0.03, tint: 1.12 },
  pitch: { color: "pitch", lift: 0.035 },
  water: { color: "water", lift: 0.01 },
};
const MARK_LIFT = 0.08;
const MAX_EDGE = 5;
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
export function buildGround(layers: Record<string, number[][][]>, bounds: readonly number[], terrain: Terrain): MeshBuilder {
  const mb = new MeshBuilder();
  const eps = 0.02;
  const onEdge = (x: number, y: number): boolean => Math.abs(x - bounds[0]!) < eps || Math.abs(x - bounds[2]!) < eps || Math.abs(y - bounds[1]!) < eps || Math.abs(y - bounds[3]!) < eps;

  const normalAt = (x: number, y: number): [number, number, number] => {
    const e = 1;
    const gx = (terrain.heightAt(x + e, y) - terrain.heightAt(x - e, y)) / (2 * e), gy = (terrain.heightAt(x, y + e) - terrain.heightAt(x, y - e)) / (2 * e);
    const l = Math.hypot(gx, gy, 1);
    return [-gx / l, 1 / l, gy / l];
  };

  const emit = (a: P, b: P, c: P, lift: number, color: THREE.Color, depth: number): void => {
    const longest = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
    if (longest > MAX_EDGE && depth < 6) {
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
      emit(p, m, r, lift, color, depth + 1);
      emit(m, q, r, lift, color, depth + 1);
      return;
    }
    const v = (p: P): [number, number, number] => [p[0], terrain.heightAt(p[0], p[1]) + lift, -p[1]];
    const na = normalAt(a[0], a[1]);
    mb.tri(v(a), v(b), v(c), na, color);
  };

  const fill = (polys: number[][][], lift: number, color: THREE.Color, jitter: boolean): void => {
    for (const poly of polys) {
      const ring = (r: number[]): THREE.Vector2[] => {
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i < r.length; i += 2) pts.push(new THREE.Vector2(r[i], r[i + 1]));
        return pts;
      };
      const contour = ring(poly[0]!);
      const holes = poly.slice(1).map(ring);
      const verts = [...contour, ...holes.flat()];
      const col = jitter ? color.clone().multiplyScalar(0.97 + hash01(`${poly[0]![0]},${poly[0]![1]}`) * 0.06) : color;
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
        const a = verts[i!]!, b = verts[j!]!, c = verts[k!]!;
        emit([a.x, a.y], [b.x, b.y], [c.x, c.y], lift, col, 0);
      }
    }
  };

  for (const [name, spec] of Object.entries(LAYERS)) {
    const polys = layers[name];
    if (!polys) continue;
    const hex = spec.color === "water" ? T.water : spec.color === "pitch" ? T.pitch : T.ground[spec.color]!;
    const color = new THREE.Color(hex).multiplyScalar(spec.tint ?? 1);
    fill(polys, spec.lift, color, true);
    if (name === "walk") curbs(mb, polys, terrain, color, onEdge);
  }
  if (layers["marks"]) fill(layers["marks"], MARK_LIFT, new THREE.Color(T.trim), false);
  return mb;
}

/** Bordures : une face verticale sur le contour des trottoirs, sauf sur les bords de tuile. */
function curbs(mb: MeshBuilder, polys: number[][][], terrain: Terrain, top: THREE.Color, onEdge: (x: number, y: number) => boolean): void {
  const face = top.clone().multiplyScalar(0.8);
  const lip = top.clone().multiplyScalar(1.1);
  const H = LAYERS["walk"]!.lift;
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
        // Découpe les longs côtés pour suivre le relief.
        const steps = Math.max(1, Math.ceil(len / MAX_EDGE));
        const nx = (sign * (y2 - y1)) / len, ny = (sign * -(x2 - x1)) / len;
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const ax = x1 + (x2 - x1) * t0, ay = y1 + (y2 - y1) * t0, bx = x1 + (x2 - x1) * t1, by = y1 + (y2 - y1) * t1;
          const za = terrain.heightAt(ax, ay), zb = terrain.heightAt(bx, by);
          const pa: [number, number, number] = [ax, za + CURB_FOOT, -ay], pb: [number, number, number] = [bx, zb + CURB_FOOT, -by];
          const ta: [number, number, number] = [ax, za + H, -ay], tb: [number, number, number] = [bx, zb + H, -by];
          mb.quad(pa, pb, tb, ta, [nx, 0, -ny], face);
          // Liseré clair sur l'arête haute.
          const l0 = 0.03;
          mb.quad([ax, za + H - l0, -ay], [bx, zb + H - l0, -by], tb, ta, [nx, 0, -ny], lip);
        }
      }
    });
  }
}
