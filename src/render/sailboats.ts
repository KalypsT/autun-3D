import * as THREE from "three";
import type { SailRoute } from "../data/types";
import { SAIL_HULLS, SAIL_SLOTS, sailPoses } from "../core/sailing";
import { MeshBuilder, toThree, type Vec3 } from "./geometry";
import { buildBoats, face } from "./piers";

/** Dériveur à voile (coque des bateaux du lot 3, D246), proue vers +x, quille à z = 0 : mât, grand-voile, foc. */
function sailboatGeometry(hull: string): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  buildBoats(mb, [{ x: 0, y: 0, a: 0, l: 4.2, w: 1.6, k: "dinghy", c: hull, z: -0.18, m: 1 }]);
  const white = new THREE.Color("#f4f3ee"), cream = new THREE.Color("#e6e1d2");
  const sail = (a: Vec3, b: Vec3, c: Vec3, col: THREE.Color): void => {
    face(mb, a, b, c, [0, 0, 1], col);
    face(mb, a, b, c, [0, 0, -1], col);
  };
  // Mât à 0,25 × demi-longueur de la proue (comme le dériveur amarré), grand-voile jusqu'au bout de la bôme, foc jusqu'à l'étrave.
  const mx = 0.525, top = 0.32 + 5.6;
  sail(toThree(mx - 0.05, 0, 0.32 + 1.0), toThree(mx - 0.05, 0, top - 0.2), toThree(mx - 2.0, 0, 0.32 + 0.95), white);
  sail(toThree(mx + 0.05, 0, top - 0.6), toThree(2.0, 0, 0.32 + 0.4), toThree(mx + 0.3, 0, 0.32 + 1.0), cream);
  return mb.build();
}

/**
 * Voiliers du plan d'eau du Vallon (D249) : une poignée de dériveurs dont la place et le cap viennent de `sailPoses` (src/core/sailing.ts,
 * selon la saison, l'heure et le jour), sur les boucles des tuiles chargées. Cinq maillages au plus.
 */
export class Sailboats {
  readonly group = new THREE.Group();
  private readonly boats: THREE.Mesh[] = [];

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    for (let k = 0; k < SAIL_SLOTS; k++) {
      const m = new THREE.Mesh(sailboatGeometry(SAIL_HULLS[k]!), mat);
      m.castShadow = true;
      m.visible = false;
      m.rotation.order = "YXZ";
      this.boats.push(m);
      this.group.add(m);
    }
  }

  /** `t` : temps de jeu (s) ; `routes` : boucles des tuiles chargées. */
  update(t: number, hour: number, season: number, weekday: number, routes: readonly SailRoute[]): void {
    const poses = sailPoses(routes, t, season, hour, weekday);
    this.boats.forEach((m, k) => {
      const p = poses[k];
      m.visible = !!p;
      if (!p) return;
      const [x, y, z] = toThree(p.x, p.y, p.z);
      m.position.set(x, y, z);
      m.rotation.set(p.heel, p.a, 0);
    });
  }
}
