import * as THREE from "three";
import type { NavGraph } from "../core/nav-graph";
import { NODE_FLAG, ROAD_FLAG } from "../data/nav";
import type { HeightField } from "../data/types";

/**
 * Recouvrement de contrôle de la navigation (`?nav=1`, `?nav=all` avec le graphe routier) : files, passages, coins, places, points d'intérêt et nœuds
 * dessinés en rubans posés sur le relief, dans un rayon autour du joueur. Reconstruit quand le graphe change ou quand le joueur s'éloigne de 40 m.
 * Couleurs comme `tools/data/nav_debug.py` : bleu file, rouge passage, orange passage à feux, rose traversée implicite, vert coin, jaune place, cyan chemin.
 */

const RADIUS = 220;
const REBUILD_MOVE = 40;
const TYPE_COLORS = ["#1f77b4", "#2ca02c", "#d62728", "#ff7f0e", "#e377c2", "#17becf", "#8c564b", "#bcbd22", "#9467bd", "#1f77b4"];
const TYPE_WIDTH = [0.3, 0.2, 0.5, 0.5, 0.35, 0.3, 0.35, 0.1, 0.15, 0.3];
const ROAD_COLORS = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888"];

class Ribbons {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  /** Ruban de largeur `w` le long de la ligne brisée (x, y à plat, repère du jeu), posé à `lift` m au-dessus du relief. */
  add(line: number[], w: number, color: THREE.Color, lift: number, terrain: HeightField): void {
    const pts: number[] = [];
    for (let i = 0; i + 1 < line.length; i += 2) {
      if (i > 0) {
        const dx = line[i]! - line[i - 2]!, dy = line[i + 1]! - line[i - 1]!;
        const n = Math.ceil(Math.hypot(dx, dy) / 4);
        for (let k = 1; k < n; k++) pts.push(line[i - 2]! + (dx * k) / n, line[i - 1]! + (dy * k) / n);
      }
      pts.push(line[i]!, line[i + 1]!);
    }
    let prev = -1;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = pts[i]!, y = pts[i + 1]!;
      const j = i + 2 < pts.length ? i + 2 : i, k = i > 0 ? i - 2 : i;
      let tx = pts[j]! - pts[k]!, ty = pts[j + 1]! - pts[k + 1]!;
      const n = Math.hypot(tx, ty) || 1;
      tx /= n;
      ty /= n;
      const z = terrain.heightAt(x, y) + lift;
      const base = this.pos.length / 3;
      // Repère three : x, hauteur, −y. Normale dans le plan : (−ty, tx).
      this.pos.push(x - ty * w * 0.5, z, -(y + tx * w * 0.5), x + ty * w * 0.5, z, -(y - tx * w * 0.5));
      this.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (prev >= 0) this.idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
      prev = base;
    }
  }

  mesh(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false }));
    m.frustumCulled = false;
    m.renderOrder = 5;
    return m;
  }
}

export class NavDebug {
  readonly group = new THREE.Group();
  private version = -1;
  private cx = 1e9;
  private cy = 1e9;
  /** Dernière reconstruction : nombre d'arêtes et de millisecondes (diagnostic). */
  stats = { edges: 0, ms: 0 };

  constructor(private readonly graph: NavGraph, private readonly terrain: HeightField, private readonly roads = false) {}

  update(px: number, py: number): void {
    if (this.version === this.graph.version && Math.hypot(px - this.cx, py - this.cy) < REBUILD_MOVE) return;
    this.version = this.graph.version;
    this.cx = px;
    this.cy = py;
    this.rebuild(px, py);
  }

  private rebuild(px: number, py: number): void {
    const t0 = performance.now();
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry.dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    const colors = TYPE_COLORS.map((c) => new THREE.Color(c));
    const ribbons = new Ribbons();
    const line: number[] = [];
    const dotPos: number[] = [], dotCol: number[] = [];
    const dot = (x: number, y: number, lift: number, c: THREE.Color): void => {
      dotPos.push(x, this.terrain.heightAt(x, y) + lift, -y);
      dotCol.push(c.r, c.g, c.b);
    };
    const white = new THREE.Color("#ffffff"), yellow = new THREE.Color("#ffd400"), red = new THREE.Color("#ff0000"), magenta = new THREE.Color("#ff00ff");
    let edges = 0;
    for (const l of this.graph.cells.values()) {
      const p = l.cell.ped;
      const [x0, y0, x1, y1] = l.cell.bounds;
      if (px < x0 - RADIUS || px > x1 + RADIUS || py < y0 - RADIUS || py > y1 + RADIUS) continue;
      for (let i = 0; i < p.edges; i++) {
        const ref = l.slot * 65536 + i;
        const n = this.graph.polyline(ref, line);
        if (Math.hypot(line[0]! - px, line[1]! - py) > RADIUS && Math.hypot(line[(n - 1) * 2]! - px, line[(n - 1) * 2 + 1]! - py) > RADIUS) continue;
        const typ = p.type[i]!;
        ribbons.add(line, TYPE_WIDTH[typ] ?? 0.2, colors[typ] ?? white, 0.25 + (typ >= 2 && typ <= 4 ? 0.03 : 0), this.terrain);
        edges++;
      }
      for (let i = 0; i < p.nodes; i++) {
        if (Math.hypot(p.nodeX[i]! - px, p.nodeY[i]! - py) > RADIUS) continue;
        // Les nœuds du maillage des places (que des arêtes de place) noieraient l'image : on ne les dessine pas.
        let onlyPlaza = p.adjStart[i + 1]! > p.adjStart[i]!;
        for (let k = p.adjStart[i]!; k < p.adjStart[i + 1]! && onlyPlaza; k++) onlyPlaza = p.type[p.adj[k]!] === 7;
        if (onlyPlaza) continue;
        const f = p.nodeFlags[i]!;
        dot(p.nodeX[i]!, p.nodeY[i]!, 0.5, f & 2 ? red : f & 1 ? yellow : white);
      }
      const poi = l.cell.poi;
      for (let i = 0; i < poi.count; i++) if (Math.hypot(poi.x[i]! - px, poi.y[i]! - py) <= RADIUS) dot(poi.x[i]!, poi.y[i]!, 1.2, magenta);
    }
    if (this.roads) this.addRoads(px, py, ribbons, dot, line);
    this.group.add(ribbons.mesh());
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(dotPos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(dotCol, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    this.group.add(pts);
    this.stats = { edges, ms: performance.now() - t0 };
  }

  /**
   * Graphe routier (`?nav=all`) : gris selon la classe, vert pour un sens unique (avec une flèche au milieu), turquoise pour un rond-point,
   * noir pour une arête interdite à la circulation (allée de parking, voie de bus) ; nœuds : orange feu, rouge stop, jaune cédez-le-passage, bleu clair impasse.
   */
  private addRoads(px: number, py: number, ribbons: Ribbons, dot: (x: number, y: number, lift: number, c: THREE.Color) => void, line: number[]): void {
    const road = this.graph.road;
    const oneway = new THREE.Color("#2ecc40"), ring = new THREE.Color("#00c8c8"), shut = new THREE.Color("#000000");
    const signal = new THREE.Color("#ff8800"), stop = new THREE.Color("#ff0000"), giveWay = new THREE.Color("#ffee00"), deadEnd = new THREE.Color("#66ccff");
    const mid = { x: 0, y: 0 }, arrow: number[] = [];
    for (const l of this.graph.cells.values()) {
      const [x0, y0, x1, y1] = l.cell.bounds;
      if (px < x0 - RADIUS || px > x1 + RADIUS || py < y0 - RADIUS || py > y1 + RADIUS) continue;
      const r = l.cell.road;
      for (const e of road.edgesOfSlot(l.slot)) {
        const n = road.polyline(e, line);
        if (Math.hypot(line[0]! - px, line[1]! - py) > RADIUS && Math.hypot(line[(n - 1) * 2]! - px, line[(n - 1) * 2 + 1]! - py) > RADIUS) continue;
        const flags = road.edgeFlags(e);
        const color = !road.drivable(e) ? shut : flags & ROAD_FLAG.roundabout ? ring : road.oneway(e) ? oneway : new THREE.Color(ROAD_COLORS[7 - Math.min(7, road.edgeClass(e))]);
        ribbons.add(line, 0.3, color, 0.12, this.terrain);
        const way = road.oneway(e);
        if (way && road.drivable(e)) {
          // Flèche au milieu : deux traits en V vers l'arrière du sens de circulation.
          const heading = road.pointAt(e, road.edgeLength(e) / 2, mid) + (way === 2 ? Math.PI : 0);
          for (const side of [-1, 1]) {
            const back = heading + Math.PI + side * 0.5;
            arrow.length = 0;
            arrow.push(mid.x, mid.y, mid.x + Math.sin(back) * 2.5, mid.y + Math.cos(back) * 2.5);
            ribbons.add(arrow, 0.3, oneway, 0.14, this.terrain);
          }
        }
      }
      for (let i = 0; i < r.nodes; i++) {
        if (Math.hypot(r.nodeX[i]! - px, r.nodeY[i]! - py) > RADIUS) continue;
        const f = r.nodeFlags[i]!;
        const c = f & NODE_FLAG.signal ? signal : f & NODE_FLAG.stop ? stop : f & NODE_FLAG.giveWay ? giveWay : f & NODE_FLAG.deadEnd ? deadEnd : null;
        if (c) dot(r.nodeX[i]!, r.nodeY[i]!, 1.0, c);
      }
    }
  }

  dispose(): void {
    for (const c of this.group.children) {
      (c as THREE.Mesh).geometry.dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
