import * as THREE from "three";
import type { WorldManifest } from "../data/types";
import { T } from "./style";
import { toonGradient } from "./stylized";

/** Côté du plan d'eau (m) : au-delà du brouillard dans toutes les directions. */
const SEA_SIZE = 30000;
/** Écume : bande au large du trait de côte, de FOAM_NEAR à FOAM_FAR mètres, posée juste au-dessus de l'eau (elle disparaît sous la plage). */
const FOAM_NEAR = 3;
const FOAM_FAR = 10;

/**
 * La mer qui entoure le monde (D105) : un grand plan d'eau au niveau de la mer, sous le relief (qui plonge sous lui au-delà de la côte), et
 * une bande d'écume le long du rivage. Deux appels de dessin en tout, construits une fois.
 */
export function createSea(manifest: WorldManifest, toon: boolean): THREE.Group | null {
  const sea = manifest.sea;
  if (!sea) return null;
  const group = new THREE.Group();
  group.name = "mer";
  const [x0, y0, x1, y1] = manifest.zone;
  const plane = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE);
  plane.rotateX(-Math.PI / 2);
  plane.translate((x0 + x1) / 2, sea.z, -(y0 + y1) / 2);
  const water = new THREE.Color(T.water);
  const gradient = toon ? toonGradient() : null;
  const mat = (color: THREE.Color): THREE.Material =>
    gradient ? new THREE.MeshToonMaterial({ color, gradientMap: gradient, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(plane, mat(water));
  mesh.name = "mer";
  mesh.receiveShadow = true;
  group.add(mesh);

  const foam = foamGeometry(sea.coast, sea.z + 0.03);
  if (foam) {
    const f = new THREE.Mesh(foam, mat(water.clone().lerp(new THREE.Color("#ffffff"), 0.55)));
    f.name = "écume";
    f.receiveShadow = true;
    group.add(f);
  }
  return group;
}

/** Ruban d'écume au large de l'anneau de côte (sens trigonométrique : la mer est à droite du sens de parcours). */
export function foamGeometry(coast: readonly number[], z: number): THREE.BufferGeometry | null {
  const n = coast.length / 2;
  if (n < 3) return null;
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    const tx = coast[2 * b]! - coast[2 * a]!, ty = coast[2 * b + 1]! - coast[2 * a + 1]!;
    const L = Math.hypot(tx, ty) || 1;
    const nx = ty / L, ny = -tx / L;
    const x = coast[2 * i]!, y = coast[2 * i + 1]!;
    pos.set([x + nx * FOAM_NEAR, z, -(y + ny * FOAM_NEAR), x + nx * FOAM_FAR, z, -(y + ny * FOAM_FAR)], i * 6);
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(2 * i, 2 * i + 1, 2 * j, 2 * j, 2 * i + 1, 2 * j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Les normales peuvent pointer vers le bas selon le sens des triangles : le ruban est plat, on les impose vers le haut.
  const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}
