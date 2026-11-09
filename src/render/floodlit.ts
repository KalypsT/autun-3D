import type * as THREE from "three";
import { MeshBuilder, type Vec3 } from "./geometry";
import { drawProjectors, Floodlight, projectorsAlong, VeilBuilder, type FootWall } from "./floodlight";

/**
 * Éclairage par projecteurs d'un bâtiment déjà dessiné par une fonction (D297) : hôtel de ville, théâtre municipal. Trois passages de la
 * même fonction de dessin :
 * 1. relevé des murs qui partent du sol (`WallRecorder`), réduits à ceux qui regardent du côté éclairé (la façade sur la place) ;
 * 2. projecteurs posés à leur pied (`projectorsAlong`), boîtiers et taches au sol ;
 * 3. voile (`VeilBuilder`) dessiné dans le maillage allumé **avant** le bâtiment lui-même, pour que les fenêtres allumées, dessinées
 *    ensuite dans le même maillage (sans écriture de profondeur), passent par-dessus.
 * `draw(solid, glow)` dessine le bâtiment ; aux passages 1 et 3, ses vitres allumées vont dans un maillage jeté.
 */
export function floodlit(
  solid: MeshBuilder,
  glow: MeshBuilder,
  halo: MeshBuilder | null,
  draw: (solid: MeshBuilder, glow: MeshBuilder) => void,
  o: { front: Vec3; ground: (x: number, z: number) => number; step?: number; out?: number; power?: number; range?: number; grain?: number },
): number {
  const rec = new WallRecorder(o.ground);
  draw(rec, new MeshBuilder(true));
  const all = rec.merged();
  const walls = all.filter((w) => w.n[0] * o.front[0] + w.n[2] * o.front[2] > 0.7 && w.h > 3);
  const projectors = projectorsAlong(walls, o.ground, { step: o.step ?? 7, out: o.out ?? 1.2, power: o.power ?? 2, range: o.range ?? 9, avoid: all.filter((w) => !walls.includes(w)) });
  if (!projectors.length) return 0;
  drawProjectors(solid, glow, halo, projectors, o.ground);
  const fl = new Floodlight(glow, projectors, o.grain ?? 0.45);
  draw(new VeilBuilder(fl), new MeshBuilder(true));
  return fl.triangles;
}

/**
 * Relevé des murs qui partent du sol : quads verticaux dont le bas touche le sol (à 1 m près) et qui montent d'au moins 2 m. Les morceaux
 * d'un même mur (travées, trumeaux) sont fusionnés par plan et par proximité (`merged`).
 */
export class WallRecorder extends MeshBuilder {
  private readonly parts: FootWall[] = [];

  constructor(private readonly ground: (x: number, z: number) => number) {
    super();
  }

  override quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3): void {
    if (Math.abs(n[1]) > 0.2) return;
    const nl = Math.hypot(n[0], n[2]);
    const lo = [a, b, c, d].sort((p, q) => p[1] - q[1]);
    const [p, q] = [lo[0]!, lo[1]!];
    if (Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.3) return;
    if (p[1] - this.ground(p[0], p[2]) > 1 || q[1] - this.ground(q[0], q[2]) > 1) return;
    const h = Math.min(lo[2]![1], lo[3]![1]) - Math.max(p[1], q[1]);
    if (h < 2) return;
    this.parts.push({ a: p, b: q, n: [n[0] / nl, 0, n[2] / nl], h });
  }

  override tri(): void {}

  override quadGradient(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, _low: THREE.Color): void {
    this.quad(a, b, c, d, n);
  }

  /** Murs fusionnés : même orientation (à 5° près), même plan (à 40 cm près), morceaux distants de moins de 1,5 m. */
  merged(): FootWall[] {
    const groups: { n: Vec3; off: number; spans: [number, number, Vec3, Vec3, number][] }[] = [];
    for (const w of this.parts) {
      const tx = -w.n[2], tz = w.n[0];
      const off = w.a[0] * w.n[0] + w.a[2] * w.n[2];
      let g = groups.find((x) => x.n[0] * w.n[0] + x.n[2] * w.n[2] > 0.996 && Math.abs(x.off - off) < 0.4);
      if (!g) groups.push((g = { n: w.n, off, spans: [] }));
      const ka = w.a[0] * tx + w.a[2] * tz, kb = w.b[0] * tx + w.b[2] * tz;
      g.spans.push(ka < kb ? [ka, kb, w.a, w.b, w.h] : [kb, ka, w.b, w.a, w.h]);
    }
    const out: FootWall[] = [];
    for (const g of groups) {
      g.spans.sort((x, y) => x[0] - y[0]);
      let cur: [number, number, Vec3, Vec3, number] | null = null;
      for (const s of g.spans) {
        if (cur && s[0] <= cur[1] + 1.5) {
          if (s[1] > cur[1]) {
            cur[1] = s[1];
            cur[3] = s[3];
          }
          cur[4] = Math.max(cur[4], s[4]);
        } else {
          if (cur) out.push({ a: cur[2], b: cur[3], n: g.n, h: cur[4] });
          cur = [...s];
        }
      }
      if (cur) out.push({ a: cur[2], b: cur[3], n: g.n, h: cur[4] });
    }
    return out;
  }
}
