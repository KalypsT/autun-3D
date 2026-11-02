import * as THREE from "three";
import { MeshBuilder, toThree } from "./geometry";

/**
 * Illuminations de Noël (D202) : des guirlandes d'ampoules tendues entre les lampadaires qui se font face dans le centre, et un sapin
 * illuminé sur la place du Champ de Mars. Un maillage pour les ampoules (sans éclairage, qui brille la nuit), un pour les câbles et le
 * sapin (éclairés) : deux appels de dessin, seulement pendant les illuminations.
 */

const BULBS = ["#ffd27a", "#ff6a5a", "#7ad0ff", "#ffe8b0", "#9aff8a"].map((c) => new THREE.Color(c));

export interface LampPoint {
  x: number;
  y: number;
  z: number;
}

/** Paires de lampadaires à relier : chaque lampadaire au plus proche voisin entre 7 et 18 m (au plus une guirlande par lampadaire). */
export function garlandPairs(lamps: readonly LampPoint[]): [LampPoint, LampPoint][] {
  const used = new Set<number>(), out: [LampPoint, LampPoint][] = [];
  for (let i = 0; i < lamps.length; i++) {
    if (used.has(i)) continue;
    let best = -1, bd = Infinity;
    for (let j = 0; j < lamps.length; j++) {
      if (j === i || used.has(j)) continue;
      const d = Math.hypot(lamps[j]!.x - lamps[i]!.x, lamps[j]!.y - lamps[i]!.y);
      if (d >= 7 && d <= 18 && d < bd) [best, bd] = [j, d];
    }
    if (best < 0) continue;
    used.add(i).add(best);
    out.push([lamps[i]!, lamps[best]!]);
  }
  return out;
}

function cube(mb: MeshBuilder, x: number, y: number, z: number, r: number, c: THREE.Color): void {
  const P = (sx: number, sy: number, sz: number): [number, number, number] => toThree(x + sx * r, y + sy * r, z + sz * r);
  for (const s of [-1, 1]) {
    mb.quad(P(s, -1, -1), P(s, 1, -1), P(s, 1, 1), P(s, -1, 1), toThree(s, 0, 0), c);
    mb.quad(P(-1, s, -1), P(1, s, -1), P(1, s, 1), P(-1, s, 1), toThree(0, s, 0), c);
    mb.quad(P(-1, -1, s), P(1, -1, s), P(1, 1, s), P(-1, 1, s), toThree(0, 0, s), c);
  }
}

/** Ampoules et câbles des guirlandes : chaînette entre deux lampadaires, à 5,6 m, qui pend de 1,2 m ; une ampoule tous les 60 cm. */
export function buildGarlands(pairs: readonly [LampPoint, LampPoint][], bulbs: MeshBuilder, cable: MeshBuilder): void {
  const dark = new THREE.Color("#2a2420");
  for (const [a, b] of pairs) {
    const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(4, Math.round(len / 0.6));
    const za = a.z + 5.6, zb = b.z + 5.6;
    let prev: [number, number, number] | null = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, sag = 1.2 * 4 * t * (1 - t);
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = za + (zb - za) * t - sag;
      if (k > 0 && k < n) cube(bulbs, x, y, z - 0.06, 0.05, BULBS[(((k + Math.round(a.x)) % BULBS.length) + BULBS.length) % BULBS.length]!);
      if (prev) cube(cable, (x + prev[0]) / 2, (y + prev[1]) / 2, (z + prev[2]) / 2, 0.015, dark);
      prev = [x, y, z];
    }
  }
}

/** Sapin de la place : trois étages de cônes à facettes (9 m), étoile, et une spirale d'ampoules. */
export function buildFirTree(x: number, y: number, z: number, bulbs: MeshBuilder, solid: MeshBuilder): void {
  const green = new THREE.Color("#1f5a3a"), dark = new THREE.Color("#174a30"), trunk = new THREE.Color("#5a3a26");
  const seg = 10;
  const tiers: [number, number, number][] = [[1.0, 4.2, 3.0], [3.6, 6.8, 2.3], [6.0, 9.0, 1.5]];
  cube(solid, x, y, z + 0.5, 0.35, trunk);
  for (const [z0, z1, r] of tiers) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = toThree(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z + z0), p1 = toThree(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z + z0), top = toThree(x, y, z + z1);
      solid.tri(p0, p1, top, toThree(Math.cos(am) * 0.8, Math.sin(am) * 0.8, 0.5), i % 2 ? green : dark);
    }
  }
  cube(bulbs, x, y, z + 9.2, 0.3, new THREE.Color("#ffe27a"));
  for (let k = 0; k < 70; k++) {
    const t = k / 70, h = 1.2 + t * 7.4, a = t * Math.PI * 2 * 5;
    // Rayon du cône à cette hauteur (le plus large des étages qui la couvrent), un peu au-dehors.
    let r = 0;
    for (const [z0, z1, rr] of tiers) if (h >= z0 && h <= z1) r = Math.max(r, rr * (1 - (h - z0) / (z1 - z0)));
    cube(bulbs, x + Math.cos(a) * (r + 0.08), y + Math.sin(a) * (r + 0.08), z + h, 0.07, BULBS[k % BULBS.length]!);
  }
}

export class FeastLights {
  readonly bulbs: THREE.Mesh;
  readonly solid: THREE.Mesh;
  private readonly bulbMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });

  constructor(scene: THREE.Scene, lamps: readonly LampPoint[], tree: LampPoint) {
    const b = new MeshBuilder(), s = new MeshBuilder();
    buildGarlands(garlandPairs(lamps), b, s);
    buildFirTree(tree.x, tree.y, tree.z, b, s);
    this.bulbs = new THREE.Mesh(b.build(), this.bulbMat);
    this.solid = new THREE.Mesh(s.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.solid.castShadow = true;
    this.bulbs.name = "illuminations";
    this.solid.name = "sapin";
    for (const m of [this.bulbs, this.solid]) {
      m.visible = false;
      scene.add(m);
    }
  }

  /** `on` : illuminations en cours ; `night` (0 à 1) : les ampoules brillent à la tombée de la nuit (le jour, éteintes). */
  update(on: boolean, night: number): void {
    this.solid.visible = on;
    this.bulbs.visible = on;
    const c = 0.35 + 0.65 * night;
    this.bulbMat.color.setRGB(c, c, c);
  }

  dispose(): void {
    for (const m of [this.bulbs, this.solid]) {
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
