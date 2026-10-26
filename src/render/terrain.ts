import * as THREE from "three";
import type { Terrain } from "../data/terrain";
import type { GroundMeta } from "../data/types";

/** Maillage du relief (une maille tous les `step` mètres) habillé de la carte des sols. */
export function buildTerrain(terrain: Terrain, groundMeta: GroundMeta, groundImage: HTMLImageElement, step = 2): THREE.Mesh {
  const nx = Math.floor((terrain.xMax - terrain.xMin) / step) + 1;
  const ny = Math.floor((terrain.yMax - terrain.yMin) / step) + 1;
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  const gw = groundMeta.cols * groundMeta.res;
  const gh = groundMeta.rows * groundMeta.res;
  const gy0 = groundMeta.y1 - gh;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = terrain.xMin + i * step;
      const y = terrain.yMin + j * step;
      const k = j * nx + i;
      pos[3 * k] = x;
      pos[3 * k + 1] = terrain.heightAt(x, y);
      pos[3 * k + 2] = -y;
      uv[2 * k] = (x - groundMeta.x0) / gw;
      uv[2 * k + 1] = (y - gy0) / gh;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();

  const tex = new THREE.Texture(groundImage);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}
