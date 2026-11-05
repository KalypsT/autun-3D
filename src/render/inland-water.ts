import * as THREE from "three";
import type { Waters } from "../core/waters";
import { T } from "./style";
import { toonGradient } from "./stylized";

/** L'eau lointaine passe sous l'eau des tuiles détaillées (posée 6 cm au-dessus du niveau) : pas de scintillement là où les deux se recouvrent. */
const BELOW = 0.04;

/** Triangles d'un morceau d'eau (anneau extérieur puis trous, aplatis) à l'altitude de sa surface ; positions Three (x, z, −y). */
export function waterPieceTriangles(rings: readonly (readonly number[])[], level: (x: number, y: number) => number, lift = -BELOW): number[] {
  const toV = (r: readonly number[]): THREE.Vector2[] => {
    const v: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < r.length; i += 2) v.push(new THREE.Vector2(r[i]!, r[i + 1]!));
    return v;
  };
  const outer = toV(rings[0] ?? []);
  if (outer.length < 3) return [];
  const holes = rings.slice(1).map(toV).filter((h) => h.length >= 3);
  const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
  const pts = [outer, ...holes].flat();
  const out: number[] = [];
  for (const f of faces) {
    // triangulateShape rend les triangles dans le sens du contour ; la face visible est vers le haut (y Three), d'où l'ordre a, c, b.
    for (const k of [f[0]!, f[2]!, f[1]!]) {
      const p = pts[k]!;
      out.push(p.x, level(p.x, p.y) + lift, -p.y);
    }
  }
  return out;
}

/**
 * L'eau de la ville vue de loin (D240) : au-delà des tuiles détaillées, les plans d'eau n'étaient pas dessinés (on voyait le pré). Un seul
 * maillage pour toute la ville, construit une fois, à plat au niveau de chaque plan d'eau ; un appel de dessin.
 */
export function createInlandWater(waters: Waters, toon: boolean): THREE.Mesh | null {
  if (waters.empty) return null;
  const pos: number[] = [];
  for (const p of waters.all) pos.push(...waterPieceTriangles(p.rings, p.level));
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const color = new THREE.Color(T.water);
  const gradient = toon ? toonGradient() : null;
  const mat = gradient ? new THREE.MeshToonMaterial({ color, gradientMap: gradient, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "eau lointaine";
  mesh.receiveShadow = true;
  return mesh;
}
