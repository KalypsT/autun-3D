import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Petits outils de modélisation pour les personnages : anneaux superposés (« loft »), ellipsoïdes, boîtes, calottes.
 * Toute forme finit avec quatre attributs : position, normale, couleur (teinte de modulation, blanc par défaut) et uv (coordonnées dans
 * la forme, 0 à 1 ; −1 : sans texture, D101). Les normales sont lissées entre faces voisines tant que l'angle reste sous `CREASE` :
 * un bras est rond, l'arête d'une boîte ou d'une semelle reste nette.
 */

export type RGB = readonly [number, number, number];
export const WHITE: RGB = [1, 1, 1];

/** Anneau d'un loft : hauteur, demi-axes x et z, décalage du centre, et exposant de super-ellipse (2 : ellipse ; plus : plus carré). */
export interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
  p?: number;
  /** Poitrine : profondeur (m) de deux galbes sur la face avant (−z), de part et d'autre du milieu. */
  bust?: number;
}

/** Galbes de poitrine à l'abscisse relative xn = x / rx, sur la face avant (front : 0 sur les côtés, 1 droit devant). */
const bustLobes = (xn: number, front: number): number =>
  front ** 1.5 * (Math.exp(-(((xn - 0.33) / 0.28) ** 2)) + Math.exp(-(((xn + 0.33) / 0.28) ** 2)));

/** Angle au-delà duquel deux faces voisines gardent une arête vive (rad). */
export const CREASE = (55 * Math.PI) / 180;

/**
 * Normales lissées d'une géométrie non indexée : chaque sommet prend la moyenne des faces qui le touchent (même position au
 * centième de millimètre près) et dont l'orientation reste à moins de `crease` de la sienne. Le lissage de three arrondit les
 * positions au centimètre : trop grossier pour un œil de 1,6 cm.
 */
export function creasedNormals(geo: THREE.BufferGeometry, crease = CREASE): void {
  const p = geo.getAttribute("position").array as Float32Array;
  const faces = p.length / 9;
  const fn = new Float64Array(faces * 3);
  for (let f = 0; f < faces; f++) {
    const i = f * 9;
    const ax = p[i + 3]! - p[i]!, ay = p[i + 4]! - p[i + 1]!, az = p[i + 5]! - p[i + 2]!;
    const bx = p[i + 6]! - p[i]!, by = p[i + 7]! - p[i + 1]!, bz = p[i + 8]! - p[i + 2]!;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[f * 3] = nx / l;
    fn[f * 3 + 1] = ny / l;
    fn[f * 3 + 2] = nz / l;
  }
  const key = (v: number): string => `${Math.round(p[v * 3]! * 1e5)},${Math.round(p[v * 3 + 1]! * 1e5)},${Math.round(p[v * 3 + 2]! * 1e5)}`;
  const around = new Map<string, number[]>();
  for (let v = 0; v < faces * 3; v++) {
    const k = key(v);
    const list = around.get(k);
    if (list) list.push(Math.floor(v / 3));
    else around.set(k, [Math.floor(v / 3)]);
  }
  const cos = Math.cos(crease);
  const out = new Float32Array(p.length);
  for (let v = 0; v < faces * 3; v++) {
    const f = Math.floor(v / 3);
    let x = 0, y = 0, z = 0;
    for (const g of around.get(key(v))!) {
      if (fn[g * 3]! * fn[f * 3]! + fn[g * 3 + 1]! * fn[f * 3 + 1]! + fn[g * 3 + 2]! * fn[f * 3 + 2]! < cos) continue;
      x += fn[g * 3]!;
      y += fn[g * 3 + 1]!;
      z += fn[g * 3 + 2]!;
    }
    const l = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / l;
    out[v * 3 + 1] = y / l;
    out[v * 3 + 2] = z / l;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(out, 3));
}

/** Rend une géométrie non indexée, à normales lissées (arêtes vives au-delà de `crease`), à couleur uniforme, uv gardées (−1 si aucune). */
export function finish(g: THREE.BufferGeometry, color: RGB = WHITE, crease = CREASE): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  if (!geo.getAttribute("uv")) untextured(geo);
  geo.deleteAttribute("color");
  creasedNormals(geo, crease);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(color, i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Marque une géométrie comme sans texture (uv à −1 : le rendu lit alors un texel blanc). */
export function untextured(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 2).fill(-1), 2));
  return g;
}

/**
 * Construit une géométrie non indexée à partir d'une liste de triangles (9 valeurs par triangle) et de leurs uv (6 par triangle) ;
 * les triangles dégénérés sont écartés.
 */
function fromTriangles(tris: number[], uvs: number[], color: RGB): THREE.BufferGeometry {
  const kept: number[] = [], keptUv: number[] = [];
  for (let i = 0, f = 0; i < tris.length; i += 9, f += 6) {
    const ax = tris[i + 3]! - tris[i]!, ay = tris[i + 4]! - tris[i + 1]!, az = tris[i + 5]! - tris[i + 2]!;
    const bx = tris[i + 6]! - tris[i]!, by = tris[i + 7]! - tris[i + 1]!, bz = tris[i + 8]! - tris[i + 2]!;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz < 1e-12) continue;
    for (let k = 0; k < 9; k++) kept.push(tris[i + k]!);
    for (let k = 0; k < 6; k++) keptUv.push(uvs[f + k]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(kept), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(keptUv), 2));
  return finish(g, color);
}

/**
 * Tube elliptique par anneaux (hauteurs croissantes), normales vers l'extérieur ; fermé en bas et/ou en haut si demandé.
 * uv : u fait le tour (0 sur le côté +x, 0,25 derrière, 0,5 côté −x, 0,75 devant), v monte du premier anneau (0) au dernier (1).
 */
export function loft(rings: readonly Ring[], seg: number, opts: { capBottom?: boolean; capTop?: boolean; color?: RGB } = {}): THREE.BufferGeometry {
  // seg + 1 points par anneau : le dernier reprend le premier avec u = 1 (couture de la texture).
  const pts = (r: Ring): number[][] =>
    Array.from({ length: seg + 1 }, (_, j) => {
      const t = (j / seg) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t), e = 2 / (r.p ?? 2);
      const xn = Math.sign(c) * Math.abs(c) ** e;
      const z = (r.cz ?? 0) + r.rz * Math.sign(s) * Math.abs(s) ** e - (r.bust ? r.bust * bustLobes(xn, Math.max(0, -s)) : 0);
      return [(r.cx ?? 0) + r.rx * xn, r.y, z];
    });
  const rows = rings.map(pts);
  const y0 = rings[0]!.y, span = rings[rings.length - 1]!.y - y0 || 1;
  const tris: number[] = [], uvs: number[] = [];
  // Un sommet : [anneau, rang dans l'anneau] ; le centre d'un fond : [anneau, −1 − rang].
  const vert = (i: number, j: number): void => {
    const p = j < 0 ? [rings[i]!.cx ?? 0, rings[i]!.y, rings[i]!.cz ?? 0] : rows[i]![j]!;
    tris.push(p[0]!, p[1]!, p[2]!);
    uvs.push(j < 0 ? (-1 - j + 0.5) / seg : j / seg, (rings[i]!.y - y0) / span);
  };
  const tri = (a: [number, number], b: [number, number], c: [number, number]): void => {
    vert(...a);
    vert(...b);
    vert(...c);
  };
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < seg; j++) {
      tri([i, j], [i + 1, j + 1], [i, j + 1]);
      tri([i, j], [i + 1, j], [i + 1, j + 1]);
    }
  }
  const last = rings.length - 1;
  if (opts.capBottom) for (let j = 0; j < seg; j++) tri([0, -1 - j], [0, j], [0, j + 1]);
  if (opts.capTop) for (let j = 0; j < seg; j++) tri([last, -1 - j], [last, j + 1], [last, j]);
  return fromTriangles(tris, uvs, opts.color ?? WHITE);
}

export function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number, w = 8, h = 6, color: RGB = WHITE): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return finish(g, color);
}

/** Ellipsoïde déformé point par point : `f` reçoit les coordonnées relatives au centre et les modifie (mâchoire, crâne…). */
export function shapedEllipsoid(
  x: number, y: number, z: number, rx: number, ry: number, rz: number, w: number, h: number,
  f: (p: THREE.Vector3) => void, color: RGB = WHITE,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    f(v);
    pos.setXYZ(i, v.x + x, v.y + y, v.z + z);
  }
  return finish(g, color);
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: RGB = WHITE): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return finish(g, color);
}

/** Applique une rotation (rad, autour de x, y, z) puis une translation à une géométrie (normales comprises). */
export function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, "YXZ"))));
  return g;
}

/**
 * Calotte d'ellipsoïde : pour chaque longitude φ, on va du pôle (θ = lo(φ)) jusqu'à θ = hi(φ). Sert aux cheveux, chapeaux, barbe.
 * Les normales sont orientées vers l'extérieur d'après le centre de l'ellipsoïde.
 */
export function cap(
  cx: number, cy: number, cz: number, rx: number, ry: number, rz: number,
  lo: (phi: number) => number, hi: (phi: number) => number,
  phiFrom: number, phiTo: number, steps: number, rings: number, color: RGB = WHITE,
): THREE.BufferGeometry {
  const at = (phi: number, t: number): number[] => {
    const theta = lo(phi) + (hi(phi) - lo(phi)) * t;
    return [cx + rx * Math.sin(theta) * Math.cos(phi), cy + ry * Math.cos(theta), cz + rz * Math.sin(theta) * Math.sin(phi), (phi - phiFrom) / (phiTo - phiFrom), t];
  };
  const tris: number[] = [], uvs: number[] = [];
  // Un point porte ses uv en 4e et 5e valeurs : u le long de la lisière (φ), v du pôle (0) à la lisière (1).
  const push = (a: number[], b: number[], c: number[]): void => {
    // Orientation : la normale du triangle doit s'éloigner du centre.
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!, vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0]! + b[0]! + c[0]!) / 3 - cx, my = (a[1]! + b[1]! + c[1]!) / 3 - cy, mz = (a[2]! + b[2]! + c[2]!) / 3 - cz;
    const flip = nx * mx + ny * my + nz * mz < 0;
    const [p, q] = flip ? [c, b] : [b, c];
    tris.push(a[0]!, a[1]!, a[2]!, p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!);
    uvs.push(a[3]!, a[4]!, p[3]!, p[4]!, q[3]!, q[4]!);
  };
  for (let i = 0; i < steps; i++) {
    const p0 = phiFrom + ((phiTo - phiFrom) * i) / steps, p1 = phiFrom + ((phiTo - phiFrom) * (i + 1)) / steps;
    for (let k = 0; k < rings; k++) {
      const t0 = k / rings, t1 = (k + 1) / rings;
      push(at(p0, t0), at(p1, t0), at(p1, t1));
      push(at(p0, t0), at(p1, t1), at(p0, t1));
    }
  }
  return fromTriangles(tris, uvs, color);
}

/** Interpole le rayon d'un profil (hauteur décroissante ou croissante) à la hauteur y. */
export function radiusAt(profile: readonly (readonly [number, number])[], y: number): number {
  const sorted = [...profile].sort((a, b) => a[0] - b[0]);
  if (y <= sorted[0]![0]) return sorted[0]![1];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const [y0, r0] = sorted[i]!, [y1, r1] = sorted[i + 1]!;
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return sorted[sorted.length - 1]![1];
}

/** Morceau d'un profil de membre entre deux hauteurs (rayons interpolés aux coupes). */
export function sliceProfile(profile: readonly (readonly [number, number])[], y0: number, y1: number): [number, number][] {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  const inner = profile.filter(([y]) => y > lo && y < hi).map(([y, r]) => [y, r] as [number, number]);
  return [[lo, radiusAt(profile, lo)], ...inner, [hi, radiusAt(profile, hi)]].sort((a, b) => a[0]! - b[0]!) as [number, number][];
}

export const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
};

/** Nombre de triangles d'une géométrie non indexée. */
export const triangleCount = (g: THREE.BufferGeometry): number => g.getAttribute("position").count / 3;
