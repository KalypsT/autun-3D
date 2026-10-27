import * as THREE from "three";
import { vehicleDef } from "../core/vehicle-catalog";
import type { VehicleState } from "../core/vehicle";
import { bodyDetailGeometry, bodyPaintGeometry, carLayout, carWheelGeometry, parkedDetailGeometry, type CarBodyParams } from "./car-body";
import { sharedMaterial, type VehicleModel } from "./vehicle-model";

/**
 * Voitures aux couleurs de l'affiche, générées d'après leurs mesures (`car-body.ts`) : caisse en volumes simples, vitres sombres, phares crème.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Deux usages : la voiture conduite (caisse + quatre roues, celles de devant braquent) et les voitures garées,
 * dessinées par instances (un maillage de peinture teintée et un de détails par modèle présent, tous les exemplaires d'un modèle en un appel).
 */

/** Mesures de chaque voiture du catalogue (même identifiants que `src/core/vehicle-catalog.ts`). */
export const CAR_BODIES: Record<string, CarBodyParams> = {
  citadine: {
    length: 3.98, width: 1.74, height: 1.42, overhangFront: 0.72,
    clearance: 0.28, belt: 0.86, noseHeight: 0.8, tailHeight: 0.9,
    hood: 1.15, windshield: 0.5, roof: 1.2, rearGlass: 0.55, roofTaper: 0.9,
    wheelRadius: 0.3, tyreWidth: 0.2,
  },
};

function specOf(id: string): { front: number; rear: number } {
  const def = vehicleDef(id);
  if (!def) throw new Error(`voiture inconnue : ${id}`);
  return def.spec;
}

/** Pour une voiture du catalogue : mesures, distances aux essieux et agencement. */
function bodyOf(id: string): { p: CarBodyParams; front: number; rear: number } {
  const p = CAR_BODIES[id];
  if (!p) throw new Error(`pas de carrosserie pour ${id}`);
  return { p, ...specOf(id) };
}

/** Maillage d'une caisse prête à l'emploi : peinture (de la couleur donnée) et détails (verre, pare-chocs, feux…). */
export function createCarModel(id: string, color: string): VehicleModel {
  const { p, front, rear } = bodyOf(id);
  const layout = carLayout(p, front, rear);
  const bodyGeo = bodyPaintGeometry(p, front, rear, color);
  const detailGeo = bodyDetailGeometry(p, front, rear);
  const wheelGeo = carWheelGeometry(p.wheelRadius, p.tyreWidth, 14);
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
  body.add(mesh(bodyGeo), mesh(detailGeo));
  group.add(body);
  const wheels = layout.wheels.map(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, p.wheelRadius, z);
    const w = mesh(wheelGeo);
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
      detailGeo.dispose();
      wheelGeo.dispose();
    },
  };
}

interface ParkedModel {
  paint: THREE.InstancedMesh;
  detail: THREE.InstancedMesh;
  n: number;
}

/**
 * Voitures garées : deux maillages instanciés par modèle présent (peinture teintée, détails et roues), créés à la demande ;
 * un modèle absent de la zone ne coûte aucun appel de dessin.
 */
export class ParkedCars {
  readonly group = new THREE.Group();
  private readonly models = new Map<string, ParkedModel>();
  private readonly paintMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  /** `capacity` : nombre maximal d'exemplaires d'un même modèle. */
  constructor(readonly capacity: number) {}

  private model(id: string): ParkedModel {
    let m = this.models.get(id);
    if (m) return m;
    const { p, front, rear } = bodyOf(id);
    const paint = new THREE.InstancedMesh(bodyPaintGeometry(p, front, rear, "#ffffff"), this.paintMat, this.capacity);
    const detail = new THREE.InstancedMesh(parkedDetailGeometry(p, front, rear), sharedMaterial(), this.capacity);
    for (const mesh of [paint, detail]) {
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Les instances changent souvent et couvrent toute la zone : pas de tri par la caméra.
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    m = { paint, detail, n: 0 };
    this.models.set(id, m);
    return m;
  }

  /** Réécrit les instances : une par voiture garée visible (modèle, position au sol, cap, tangage, couleur). */
  set(cars: readonly { model: string; x: number; y: number; z: number; heading: number; pitch: number; color: string }[]): void {
    for (const m of this.models.values()) m.n = 0;
    for (const c of cars) {
      const m = this.model(c.model);
      if (m.n >= this.capacity) continue;
      this.euler.set(c.pitch, -c.heading, 0);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos.set(c.x, c.z, -c.y), this.quat, this.one);
      m.paint.setMatrixAt(m.n, this.matrix);
      m.detail.setMatrixAt(m.n, this.matrix);
      m.paint.setColorAt(m.n, this.color.set(c.color));
      m.n++;
    }
    for (const m of this.models.values()) {
      m.paint.count = m.detail.count = m.n;
      m.paint.visible = m.detail.visible = m.n > 0;
      m.paint.instanceMatrix.needsUpdate = m.detail.instanceMatrix.needsUpdate = true;
      if (m.paint.instanceColor) m.paint.instanceColor.needsUpdate = true;
    }
  }

  /** Nombre de maillages dessinés (deux par modèle présent), pour la mesure. */
  get drawn(): number {
    let n = 0;
    for (const m of this.models.values()) if (m.n > 0) n += 2;
    return n;
  }
}
