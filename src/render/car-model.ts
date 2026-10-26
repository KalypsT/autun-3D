import * as THREE from "three";
import type { VehicleState } from "../core/vehicle";
import { box, merge, paint, sharedMaterial, type VehicleModel } from "./vehicle-model";

/**
 * Petite citadine aux couleurs de l'affiche : caisse en volumes simples, vitres sombres, phares crème.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol), essieux à −1,05 et +1,55 m.
 * Deux usages : la voiture conduite (caisse + quatre roues, celles de devant braquent) et les voitures garées,
 * toutes dessinées en deux appels (peinture teintée par instance, détails).
 */

export const CAR_COLORS = ["#d9472b", "#2a6f7e", "#f1b24a", "#efe3c8", "#1f3a52", "#3f7d4e", "#b8a48a"];
const WHEEL_R = 0.3;
const FRONT_Z = -1.05;
const REAR_Z = 1.55;
const TRACK = 0.74;

/** Caisse peinte (en blanc : la couleur vient de l'instance ou de `paint`). */
function bodyGeometry(color: string): THREE.BufferGeometry {
  return merge([
    // Bas de caisse, capot et coffre, habitacle.
    box(1.68, 0.5, 3.9, 0, 0.55, 0.22, color),
    box(1.6, 0.08, 1.15, 0, 0.83, -1.15, color),
    box(1.5, 0.5, 1.95, 0, 1.12, 0.55, color),
    box(1.52, 0.05, 1.85, 0, 1.39, 0.55, color),
    // Ailes au-dessus des roues.
    box(1.74, 0.16, 0.95, 0, 0.72, FRONT_Z, color),
    box(1.74, 0.16, 0.95, 0, 0.72, REAR_Z, color),
  ]);
}

/** Vitres, pare-chocs, phares, poignées : couleurs fixes. */
function detailGeometry(): THREE.BufferGeometry {
  const glass = "#2b3a4c", trim = "#2c2c33";
  return merge([
    box(1.53, 0.36, 1.7, 0, 1.15, 0.6, glass),
    box(1.36, 0.36, 0.04, 0, 1.13, -0.43, "#3a4d63"),
    box(1.36, 0.32, 0.04, 0, 1.14, 1.53, glass),
    box(1.72, 0.14, 0.12, 0, 0.36, -1.71, trim),
    box(1.72, 0.14, 0.12, 0, 0.36, 2.15, trim),
    box(0.26, 0.14, 0.04, 0.58, 0.64, -1.69, "#f5ecd2"),
    box(0.26, 0.14, 0.04, -0.58, 0.64, -1.69, "#f5ecd2"),
    box(0.24, 0.12, 0.04, 0.6, 0.66, 2.18, "#e0442c"),
    box(0.24, 0.12, 0.04, -0.6, 0.66, 2.18, "#e0442c"),
    box(0.4, 0.1, 0.03, 0, 0.5, 2.18, "#f1e6c8"),
    box(1.7, 0.04, 0.12, 0, 0.98, 0.3, "#efe3c8"),
  ]);
}

function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.2, 14);
  tyre.rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.21, 10);
  cap.rotateZ(Math.PI / 2);
  // Un rayon clair : la rotation se voit.
  return merge([paint(tyre, "#24242a"), paint(cap, "#cfc8b8"), box(0.212, WHEEL_R * 1.05, 0.06, 0, 0, 0, "#8a8478")]);
}

const WHEELS: readonly [number, number][] = [[TRACK, FRONT_Z], [-TRACK, FRONT_Z], [TRACK, REAR_Z], [-TRACK, REAR_Z]];

/** Voitures garées : roues comprises, dans la même géométrie que les détails. */
function parkedDetailGeometry(): THREE.BufferGeometry {
  const parts = [detailGeometry()];
  for (const [x, z] of WHEELS) {
    const w = wheelGeometry();
    w.translate(x, WHEEL_R, z);
    parts.push(w);
  }
  return merge(parts);
}

let shared: { wheel: THREE.BufferGeometry; detail: THREE.BufferGeometry } | null = null;

export function createCarModel(variant: number): VehicleModel {
  shared ??= { wheel: wheelGeometry(), detail: detailGeometry() };
  const color = CAR_COLORS[Math.abs(variant) % CAR_COLORS.length]!;
  const bodyGeo = bodyGeometry(color);
  const mat = sharedMaterial();
  const mesh = (g: THREE.BufferGeometry): THREE.Mesh => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  // Caisse suspendue : elle prend le roulis, les roues restent au sol.
  const body = new THREE.Group();
  body.add(mesh(bodyGeo), mesh(shared.detail));
  group.add(body);
  const wheels = WHEELS.map(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const w = mesh(shared!.wheel);
    w.rotation.order = "YXZ";
    pivot.add(w);
    group.add(pivot);
    return w;
  });
  return {
    group,
    seat: new THREE.Vector3(0.38, 0.45, 0.4),
    pose: "hidden",
    update(s: VehicleState) {
      group.position.set(s.x, s.z, -s.y);
      group.rotation.set(s.pitch, -s.heading, 0);
      body.rotation.z = -s.lean;
      wheels.forEach((w, i) => {
        w.rotation.y = i < 2 ? -s.steer : 0;
        w.rotation.x = -s.wheel;
      });
    },
    dispose() {
      bodyGeo.dispose();
    },
  };
}

/** Voitures garées : deux maillages instanciés (peinture teintée, détails), un seul jeu d'appels pour toutes. */
export class ParkedCars {
  readonly group = new THREE.Group();
  private readonly paint: THREE.InstancedMesh;
  private readonly detail: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(readonly capacity: number) {
    const paintMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.paint = new THREE.InstancedMesh(bodyGeometry("#ffffff"), paintMat, capacity);
    this.detail = new THREE.InstancedMesh(parkedDetailGeometry(), sharedMaterial(), capacity);
    for (const m of [this.paint, this.detail]) {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      // Les instances changent souvent et couvrent toute la zone : pas de tri par la caméra.
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  /** Réécrit les instances : une par voiture garée visible (position au sol, cap, tangage, couleur). */
  set(cars: readonly { x: number; y: number; z: number; heading: number; pitch: number; variant: number }[]): void {
    const n = Math.min(cars.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const c = cars[i]!;
      this.euler.set(c.pitch, -c.heading, 0);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos.set(c.x, c.z, -c.y), this.quat, this.one);
      this.paint.setMatrixAt(i, this.matrix);
      this.detail.setMatrixAt(i, this.matrix);
      this.paint.setColorAt(i, this.color.set(CAR_COLORS[Math.abs(c.variant) % CAR_COLORS.length]!));
    }
    this.paint.count = this.detail.count = n;
    this.paint.instanceMatrix.needsUpdate = this.detail.instanceMatrix.needsUpdate = true;
    if (this.paint.instanceColor) this.paint.instanceColor.needsUpdate = true;
  }
}
