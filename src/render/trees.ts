import * as THREE from "three";
import type { Tree } from "../data/types";
import { hash01 } from "./geometry";

/** Arbres réels (position, hauteur, couronne du LiDAR) : deux maillages instanciés (troncs, couronnes). */
export function buildTrees(trees: readonly Tree[]): THREE.Group {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: "#5a4a3c", roughness: 1 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), trees.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  trees.forEach(([x, y, z, h, r, trunk], i) => {
    const key = `${x},${y}`;
    m.makeScale(1, trunk, 1).setPosition(x, z, -y);
    trunks.setMatrixAt(i, m);
    const ch = Math.max(h - trunk * 0.6, 1.5);
    const sx = r * (0.9 + hash01(key, 1) * 0.2);
    m.makeScale(sx, ch / 2, sx).setPosition(x, z + trunk * 0.6 + ch / 2, -y);
    crowns.setMatrixAt(i, m);
    color.setHSL(0.24 + hash01(key, 2) * 0.06, 0.38 + hash01(key, 3) * 0.12, 0.2 + hash01(key, 4) * 0.08);
    crowns.setColorAt(i, color);
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}
