import * as THREE from "three";
import { at, frameOf } from "../core/landmarks";
import { PASSAGE_GATE } from "../core/passage-gate";
import { MeshBuilder } from "./geometry";
import { slab } from "./square";

/**
 * Grilles fermées du passage Balthus (D190) : barreaux de fer noir tous les 14 cm, deux lisses, traverse du haut à pointes, comme les grilles à pointes
 * de la photo 4. Un maillage à part que le jeu montre ou cache selon l'heure (comme `buildGateLeaves`, D174) : environ 700 triangles.
 */

const IRON = new THREE.Color("#23272b"), RAIL = new THREE.Color("#30353a");

export function buildPassageGates(): THREE.BufferGeometry {
  const g = PASSAGE_GATE, mb = new MeshBuilder();
  g.planes.forEach((d, i) => {
    const f = frameOf(g.c[0], g.c[1], g.a, 1, 1);
    // Le plan de la grille passe à l'abscisse d ; on la dessine dans un repère centré sur lui.
    const [cx, cy] = at(f, d, 0);
    const h = frameOf(cx, cy, g.a, 1, 1), z0 = g.floors[i]! + 0.05, z1 = z0 + g.height;
    const box = (t0: number, t1: number, za: number, zb: number, col: THREE.Color, depth = 0.025): void => slab(mb, h, -depth, depth, t0, t1, za, zb, col, col);
    for (let t = -g.hw + 0.07; t < g.hw - 0.03; t += 0.14) box(t - 0.012, t + 0.012, z0, z1 - 0.05, IRON, 0.012);
    for (const z of [z0 + 0.25, z0 + g.height * 0.55, z1 - 0.15]) box(-g.hw, g.hw, z - 0.04, z + 0.04, RAIL, 0.03);
    for (let t = -g.hw + 0.07; t < g.hw - 0.03; t += 0.28) box(t - 0.02, t + 0.02, z1 - 0.05, z1 + 0.12, IRON, 0.02);
    box(-g.hw, -g.hw + 0.06, z0, z1, RAIL, 0.04);
    box(g.hw - 0.06, g.hw, z0, z1, RAIL, 0.04);
  });
  return mb.build();
}
