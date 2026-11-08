import * as THREE from "three";
import { box, merge, paint, podLoft, ringLoft, type Ring } from "./vehicle-model";

/**
 * Carrosserie sculptée (D272) : pour un modèle qu'on veut reconnaître d'après photos, la caisse n'est plus faite de quelques octogones mais d'un profil
 * relevé point par point (dessus du capot et de la ceinture, bas de caisse, largeur en plan, toit), d'où sortent une trentaine de sections arrondies,
 * avec les passages de roue vraiment découpés. Phares, feux, vitres, lignes de portes, grilles se posent ensuite **sur** cette surface comme des
 * décalcomanies : chaque point du dessin est projeté sur la caisse (un rayon tiré vers elle) et soulevé de quelques millimètres le long de sa normale.
 * Analogie : un carrossier qui modèle d'abord la forme en terre, puis colle les pièces sur la terre ; elles en suivent la courbure et ne débordent jamais.
 *
 * Repère : celui des autres voitures (avant vers −z, haut +y, x vers la droite). Les dessins se donnent en `s`, la distance depuis le nez (m), et pour
 * le côté droit seulement : la moitié gauche en est le miroir.
 */

/** Point d'une courbe de profil : [s, valeur]. */
export type Key = readonly [number, number];

/** Point d'un dessin : position approchée (x, y, s) et direction du rayon qui le pose sur la caisse (vers elle). */
export interface Guide {
  x: number;
  y: number;
  s: number;
  dir: THREE.Vector3;
}

export interface Sculpt {
  /** Dessus du bas de caisse (bord du capot, ceinture, haut du hayon), bas de caisse et demi-largeur en plan, le long de s. */
  top: readonly Key[];
  bottom: readonly Key[];
  width: readonly Key[];
  /** Habitacle (paré de peinture ; les vitres sont des décalcomanies) : [s, haut du toit, demi-largeur du toit]. Le premier et le dernier sont les pieds du pare-brise et de la lunette. */
  cabin: readonly (readonly [number, number, number])[];
  /**
   * Vitrage de l'habitacle, par tronçon (de s0 à s1) : le pare-brise et la lunette couvrent le dessus de l'habitacle ; les vitres de flanc, le bas
   * de ses flancs ; `black` : la partie du flanc en noir brillant (custode où se cache la poignée arrière). Le reste est en peinture (toit, montants).
   * Les vitres sont les faces mêmes de l'habitacle, pas des pièces posées dessus : leurs bords suivent les sections.
   */
  windows: {
    shield: readonly [number, number];
    rear: readonly [number, number];
    side: readonly [number, number];
    black?: readonly [number, number];
    /** Toit vitré (noir) sur ce tronçon. */
    roof?: readonly [number, number];
    /** Encadrement des vitres (l'arrondi du toit, au-dessus des vitres de flanc) en noir brillant plutôt qu'en peinture. */
    blackFrame?: boolean;
  };
  /** Rayon des passages de roue. */
  arch: number;
  /** Phares et feux (centre, côté droit) : [x, y, s] ; pour l'éclairage de nuit et la circulation. */
  lamps: { head: readonly [number, number, number]; tail: readonly [number, number, number] };
  /** Pièces peintes en plus (rétroviseurs, becquet). */
  paint?: (k: SculptKit) => THREE.BufferGeometry[];
  /** Décalcomanies et pièces de couleurs fixes. */
  details: (k: SculptKit, glass: string) => THREE.BufferGeometry[];
}

/** Mesures de la voiture utiles à la sculpture : longueur, distances du centre de gravité aux essieux, roues. */
export interface SculptFrame {
  length: number;
  noseZ: number;
  front: number;
  rear: number;
  wheelRadius: number;
}

/** Valeur d'une courbe de profil en s (linéaire entre les points, constante au-delà). */
export function keyAt(keys: readonly Key[], s: number): number {
  if (s <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [s1, v1] = keys[i]!, [s0, v0] = keys[i - 1]!;
    if (s <= s1) return v0 + ((v1 - v0) * (s - s0)) / Math.max(1e-6, s1 - s0);
  }
  return keys[keys.length - 1]![1];
}

/**
 * Section du bas de caisse (moitié droite, du dessous au dessus) : u, fraction de la demi-largeur ; v, fraction de la hauteur. Flanc plein jusqu'à mi-hauteur,
 * qui rentre doucement vers l'épaule, épaule arrondie, dessus presque plat : la forme d'une caisse moderne vue de face. Convexe.
 */
const LOWER: readonly (readonly [number, number])[] = [
  [0.5, 0], [0.88, 0.03], [0.99, 0.25], [1, 0.5], [0.965, 0.82], [0.9, 0.975], [0.55, 1],
];

/** Pied de l'habitacle sur l'épaule : fraction de la demi-largeur (à peu près le bord du dessus de la section). */
const CABIN_FOOT = 0.885;

/** Écart (m) entre le bout du nez (s = 0) et la caisse : les plaques et grilles posées au bout ne dépassent pas le hors-tout. */
const NOSE_GAP = 0.022;

function lowerRing(z: number, y0: number, y1: number, w: number): Ring {
  const h = y1 - y0, right = LOWER.map(([u, v]) => new THREE.Vector3(u * w, y0 + v * h, z));
  const left = [...LOWER].reverse().map(([u, v]) => new THREE.Vector3(-u * w, y0 + v * h, z));
  return [...right, ...left];
}

function cabinRing(z: number, yb: number, yt: number, wb: number, wt: number): Ring {
  const k = THREE.MathUtils.clamp((yt - yb) / 0.3, 0, 1);
  const right = [
    new THREE.Vector3(wb, yb - 0.02, z),
    new THREE.Vector3(wt + (wb - wt) * 0.15, yt - 0.07 * k, z),
    new THREE.Vector3(wt - 0.05 * k, yt - 0.018 * k, z),
    new THREE.Vector3(wt * 0.6, yt, z),
  ];
  const left = [...right].reverse().map((p) => new THREE.Vector3(-p.x, p.y, p.z));
  return [...right, ...left];
}

/** Outils pour dessiner sur la caisse. */
export class SculptKit {
  readonly frame: SculptFrame;
  private readonly sculpt: Sculpt;
  private readonly target: THREE.Mesh;
  private readonly ray = new THREE.Raycaster();

  constructor(sculpt: Sculpt, frame: SculptFrame, target: THREE.Mesh) {
    this.sculpt = sculpt;
    this.frame = frame;
    this.target = target;
  }

  z(s: number): number {
    return this.frame.noseZ + NOSE_GAP + s;
  }

  top(s: number): number {
    return keyAt(this.sculpt.top, s);
  }

  width(s: number): number {
    return keyAt(this.sculpt.width, s);
  }

  /** Ligne de ceinture : pied des vitres. */
  belt(s: number): number {
    return this.top(s) - 0.012;
  }

  /** Bord de la vitre de flanc droite en s : son pied (sur la ceinture), son haut (sous l'arrondi du toit) et le bord du toit. */
  cabinEdge(s: number): { base: THREE.Vector3; top: THREE.Vector3; roof: THREE.Vector3 } {
    const rings = cabinRings(this.sculpt, this.frame), keys = this.sculpt.cabin;
    let i = 0;
    while (i + 2 < keys.length && s > keys[i + 1]![0]) i++;
    const t = THREE.MathUtils.clamp((s - keys[i]![0]) / (keys[i + 1]![0] - keys[i]![0]), 0, 1);
    const at = (k: number): THREE.Vector3 => rings[i]![k]!.clone().lerp(rings[i + 1]![k]!, t);
    return { base: at(0), top: at(1), roof: at(2) };
  }

  /** Point posé sur la caisse (et soulevé de `lift` le long de la normale), avec cette normale. */
  project(g: Guide, lift: number): { p: THREE.Vector3; n: THREE.Vector3 } {
    const d = g.dir.clone().normalize(), at = new THREE.Vector3(g.x, g.y, this.z(g.s));
    this.ray.set(at.clone().addScaledVector(d, -2.5), d);
    this.ray.far = 5;
    const hit = this.ray.intersectObject(this.target, false)[0];
    if (!hit?.face) return { p: at, n: d.clone().negate() };
    const n = hit.face.normal.clone();
    return { p: hit.point.clone().addScaledVector(n, lift), n };
  }

  /**
   * Décalcomanie : une grille de points (rangées de même longueur), chacun posé sur la caisse ; les faces regardent vers l'extérieur.
   * `both` : aussi sa copie en miroir sur le côté gauche. `split` : points intercalés entre deux colonnes (la pièce épouse mieux les arêtes de la caisse).
   */
  decal(rows: readonly (readonly Guide[])[], color: string, lift = 0.008, both = true, split = 0): THREE.BufferGeometry {
    const fine = split > 0 ? rows.map((r) => r.flatMap((g, i) => (i + 1 < r.length ? Array.from({ length: split + 1 }, (_, j) => lerpGuide(g, r[i + 1]!, j / (split + 1))) : [g]))) : rows;
    const pts = fine.map((r) => r.map((g) => this.project(g, lift)));
    const pos: number[] = [], nor: number[] = [];
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    const tri = (a: { p: THREE.Vector3; n: THREE.Vector3 }, b: { p: THREE.Vector3; n: THREE.Vector3 }, c: { p: THREE.Vector3; n: THREE.Vector3 }): void => {
      n.copy(ab.subVectors(b.p, a.p)).cross(ac.subVectors(c.p, a.p));
      if (n.lengthSq() < 1e-12) return;
      if (n.dot(a.n.clone().add(b.n).add(c.n)) < 0) [b, c] = [c, b];
      n.copy(ab.subVectors(b.p, a.p)).cross(ac.subVectors(c.p, a.p)).normalize();
      for (const v of [a, b, c]) {
        pos.push(v.p.x, v.p.y, v.p.z);
        nor.push(n.x, n.y, n.z);
      }
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let j = 0; j + 1 < pts[i]!.length; j++) {
        const a = pts[i]![j]!, b = pts[i]![j + 1]!, c = pts[i + 1]![j + 1]!, d = pts[i + 1]![j]!;
        tri(a, b, c);
        tri(a, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
    paint(g, color);
    return both ? merge([g, mirrored(g)]) : g;
  }

  /** Bande le long d'une ligne dessinée sur le flanc droit ([s, y] successifs), de demi-largeur `half`, posée de côté. */
  sideLine(points: readonly (readonly [number, number])[], half: number, color: string, lift = 0.008, both = true): THREE.BufferGeometry {
    const top: Guide[] = [], bottom: Guide[] = [];
    points.forEach(([s, y], i) => {
      const [sa, ya] = points[Math.max(0, i - 1)]!, [sb, yb] = points[Math.min(points.length - 1, i + 1)]!;
      const ts = sb - sa, ty = yb - ya, l = Math.hypot(ts, ty) || 1;
      // Normale à la ligne dans le plan du flanc.
      const ns = -ty / l, ny = ts / l;
      top.push({ x: 1, y: y + ny * half, s: s + ns * half, dir: SIDE });
      bottom.push({ x: 1, y: y - ny * half, s: s - ns * half, dir: SIDE });
    });
    return this.decal([top, bottom], color, lift, both);
  }

  /** Rectangle vu de face (`dir` : FRONT) ou de l'arrière (REAR) : x0..x1, y0..y1, au-dessus de s. */
  plate(x0: number, x1: number, y0: number, y1: number, s: number, dir: THREE.Vector3, color: string, lift: number, cols = 1, both = false): THREE.BufferGeometry {
    const row = (y: number): Guide[] => Array.from({ length: cols + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / cols, y, s, dir }));
    return this.decal([row(y1), row(y0)], color, lift, both);
  }
}

function lerpGuide(a: Guide, b: Guide, t: number): Guide {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s + (b.s - a.s) * t, dir: a.dir.clone().lerp(b.dir, t).normalize() };
}

/** Directions des rayons : vers l'arrière (on dessine sur l'avant), vers l'avant (sur l'arrière), vers la gauche (sur le flanc droit), vers le bas (sur le dessus). */
export const FRONT = new THREE.Vector3(0, 0, 1);
export const REAR = new THREE.Vector3(0, 0, -1);
export const SIDE = new THREE.Vector3(-1, 0, 0);
export const DOWN = new THREE.Vector3(0, -1, 0);
/** Rayon qui tourne de l'avant (φ = 0) vers le flanc droit (φ = 90°) : pour les phares qui s'enroulent autour du coin. */
export const frontTurn = (deg: number): THREE.Vector3 => new THREE.Vector3(-Math.sin(THREE.MathUtils.degToRad(deg)), 0, Math.cos(THREE.MathUtils.degToRad(deg)));
/** De même à l'arrière : de la face arrière (0) vers le flanc droit (90°). */
export const rearTurn = (deg: number): THREE.Vector3 => new THREE.Vector3(-Math.sin(THREE.MathUtils.degToRad(deg)), 0, -Math.cos(THREE.MathUtils.degToRad(deg)));

/** Copie en miroir (x → −x), faces retournées pour rester tournées vers l'extérieur. */
function mirrored(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  const pos = m.getAttribute("position") as THREE.BufferAttribute, nor = m.getAttribute("normal") as THREE.BufferAttribute, col = m.getAttribute("color") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    nor.setX(i, -nor.getX(i));
  }
  // Ordre des sommets inversé dans chaque triangle.
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, nor, col]) {
      const t = [a.getX(i + 1), a.getY(i + 1), a.getZ(i + 1)];
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, t[0]!, t[1]!, t[2]!);
    }
  }
  return m;
}

/** Les abscisses des sections : celles des courbes de profil, plus de quoi découper chaque passage de roue en arc. */
function stations(sc: Sculpt, f: SculptFrame, axles: readonly number[]): number[] {
  const end = f.length - 2 * NOSE_GAP;
  // Les points des profils, sauf au-dessus des roues où les sections de l'arc suffisent ; au moins 4 cm entre deux sections (les bouts exceptés).
  const zone = sc.arch * 1.06 + 0.03;
  const keys = [...new Set([...sc.top, ...sc.bottom, ...sc.width].map(([s]) => s))].filter((s) => axles.every((a) => Math.abs(s - a) > zone)).sort((a, b) => a - b);
  const kept: number[] = [];
  for (const s of keys) if (!kept.length || s > kept[kept.length - 1]! + 0.04 || s >= end - 0.03) kept.push(s);
  for (const a of axles) for (const t of [-1.06, -1, -0.7, 0, 0.7, 1, 1.06]) kept.push(a + t * sc.arch);
  return kept.filter((s) => s >= 0 && s <= end).sort((a, b) => a - b);
}

/** Bas de caisse et habitacle (en peinture, sans les pièces) : la forme sur laquelle on dessine. */
function shell(sc: Sculpt, f: SculptFrame, color: string): { lower: THREE.BufferGeometry; cabin: THREE.BufferGeometry } {
  // Essieux en s : le centre de gravité est à z = 0, l'essieu avant à −front, l'arrière à +rear.
  const axles = [-f.front, f.rear].map((z) => z - f.noseZ - NOSE_GAP);
  const z = (s: number): number => f.noseZ + NOSE_GAP + s;
  const lower = ringLoft(stations(sc, f, axles).map((s) => {
    let y0 = keyAt(sc.bottom, s);
    // Passage de roue : le bas de caisse remonte en arc au-dessus de chaque roue (centre à la hauteur du moyeu).
    for (const a of axles) {
      const d = Math.abs(s - a);
      if (d <= sc.arch + 1e-6) y0 = Math.max(y0, f.wheelRadius + Math.sqrt(Math.max(0, sc.arch * sc.arch - d * d)));
    }
    return lowerRing(z(s), y0, keyAt(sc.top, s), keyAt(sc.width, s));
  }), color);
  const cabin = ringLoft(cabinRings(sc, f), color);
  return { lower, cabin };
}

function cabinRings(sc: Sculpt, f: SculptFrame): Ring[] {
  return sc.cabin.map(([s, yt, wt]) => {
    const yb = keyAt(sc.top, s) - 0.012, wb = keyAt(sc.width, s) * CABIN_FOOT;
    return cabinRing(f.noseZ + NOSE_GAP + s, yb, Math.max(yb, yt), wb, Math.min(wb, wt));
  });
}

/**
 * Habitacle en trois lots de faces : peinture (toit, montants), verre (pare-brise, lunette, vitres de flanc) et noir (custode), selon le tronçon
 * et la bande de la section (0 : flanc vitré, 1 : arrondi du toit, 2 et 3 : dessus). Mêmes faces que la forme : rien ne dépasse ni ne disparaît.
 */
function cabinFaces(sc: Sculpt, f: SculptFrame): { paint: number[]; glass: number[]; black: number[] } {
  const rings = cabinRings(sc, f), out = { paint: [] as number[], glass: [] as number[], black: [] as number[] };
  const inRange = (s: number, r?: readonly [number, number]): boolean => !!r && s >= r[0] && s <= r[1];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!, b = rings[i + 1]!, mid = (sc.cabin[i]![0] + sc.cabin[i + 1]![0]) / 2;
    const inside = new THREE.Vector3();
    for (const p of [...a, ...b]) inside.add(p);
    inside.divideScalar(a.length + b.length);
    const W = sc.windows, top = inRange(mid, W.shield) || inRange(mid, W.rear) || inRange(mid, W.roof);
    // Le bas de l'anneau (de la base gauche à la base droite) est caché dans la caisse : pas de face.
    for (let k = 0; k + 1 < a.length; k++) {
      const band = Math.min(k, a.length - 2 - k);
      const lot = band === 0
        ? (inRange(mid, W.side) ? out.glass : inRange(mid, W.black) ? out.black : out.paint)
        : band === 1 ? (W.blackFrame ? out.black : out.paint) : top ? out.glass : out.paint;
      for (const [u, v, w] of [[a[k]!, a[k + 1]!, b[k + 1]!], [a[k]!, b[k + 1]!, b[k]!]] as const) {
        n.copy(ab.subVectors(v, u)).cross(ac.subVectors(w, u));
        if (n.lengthSq() < 1e-12) continue;
        c.copy(u).add(v).add(w).divideScalar(3).sub(inside);
        lot.push(...(n.dot(c) < 0 ? [u, w, v] : [u, v, w]).flatMap((p) => [p.x, p.y, p.z]));
      }
    }
  }
  return out;
}

/** Triangles bruts (positions) en géométrie d'une couleur, normales par face. */
function faces(pos: number[], color: string): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return paint(g, color);
}

function kitFor(sc: Sculpt, f: SculptFrame): SculptKit {
  const { lower, cabin } = shell(sc, f, "#ffffff");
  const target = new THREE.Mesh(merge([lower, cabin]), new THREE.MeshBasicMaterial());
  target.updateMatrixWorld(true);
  return new SculptKit(sc, f, target);
}

/** Peinture d'une caisse sculptée : bas de caisse, habitacle, pièces peintes. */
export function sculptPaintGeometry(sc: Sculpt, f: SculptFrame, color: string): THREE.BufferGeometry {
  const { lower, cabin } = shell(sc, f, color);
  cabin.dispose();
  const extra = sc.paint ? sc.paint(kitFor(sc, f)).map((g) => paint(g, color)) : [];
  return merge([lower, faces(cabinFaces(sc, f).paint, color), ...extra]);
}

/** Détails d'une caisse sculptée (vitres, phares, feux, grilles, lignes…), plus un dessous sombre qui ferme les passages de roue. */
export function sculptDetailGeometry(sc: Sculpt, f: SculptFrame, glass: string): THREE.BufferGeometry {
  const k = kitFor(sc, f);
  const w = keyAt(sc.width, f.length / 2) - 0.22;
  const under = box(2 * w, 0.58, f.length - 0.7, 0, 0.42, f.noseZ + f.length / 2, "#1d1f24");
  const cab = cabinFaces(sc, f);
  return merge([under, faces(cab.glass, glass), faces(cab.black, "#141519"), ...sc.details(k, glass)]);
}

/** Phares et feux d'une caisse sculptée, dans le repère du véhicule (deux de chaque). */
export function sculptLamps(sc: Sculpt, f: SculptFrame): { head: [number, number, number][]; tail: [number, number, number][] } {
  const z = (s: number): number => f.noseZ + NOSE_GAP + s;
  const [hx, hy, hs] = sc.lamps.head, [tx, ty, ts] = sc.lamps.tail;
  return { head: [[hx, hy, z(hs)], [-hx, hy, z(hs)]], tail: [[tx, ty, z(ts)], [-tx, ty, z(ts)]] };
}

/** Petite pièce arrondie, re-exportée pour les dessins (rétroviseurs). */
export { podLoft };
