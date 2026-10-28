import * as THREE from "three";
import { vehicleDef } from "../core/vehicle-catalog";
import type { VehicleState } from "../core/vehicle";
import { bodyDetailGeometry, bodyPaintGeometry, carLayout, carWheelGeometry, parkedDetailGeometry, type CarBodyParams } from "./car-body";
import { merge, sharedMaterial, type VehicleModel } from "./vehicle-model";

/**
 * Voitures aux couleurs de l'affiche, générées d'après leurs mesures (`car-body.ts`) : caisse en volumes simples, vitres sombres, phares crème.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Deux usages : la voiture conduite (caisse + quatre roues, celles de devant braquent) et les voitures garées,
 * dessinées par instances (`parked-models.ts`, une géométrie au repos par modèle, tous les exemplaires d'un modèle en un seul maillage).
 */

/** Mesures de chaque voiture du catalogue (même identifiants que `src/core/vehicle-catalog.ts`). */
export const CAR_BODIES: Record<string, CarBodyParams> = {
  citadine: {
    length: 3.98, width: 1.74, height: 1.42, overhangFront: 0.72,
    clearance: 0.28, belt: 0.86, noseHeight: 0.8, tailHeight: 0.9,
    hood: 1.15, windshield: 0.5, roof: 1.2, rearGlass: 0.55, roofTaper: 0.9,
    wheelRadius: 0.3, tyreWidth: 0.2,
  },
  compacte: {
    length: 4.25, width: 1.8, height: 1.46, overhangFront: 0.85,
    clearance: 0.27, belt: 0.9, noseHeight: 0.82, tailHeight: 0.95,
    hood: 1.25, windshield: 0.55, roof: 1.2, rearGlass: 0.75, roofTaper: 0.9,
    wheelRadius: 0.31, tyreWidth: 0.2,
  },
  berline: {
    length: 4.75, width: 1.85, height: 1.45, overhangFront: 0.93,
    clearance: 0.25, belt: 0.92, noseHeight: 0.8, tailHeight: 0.98,
    hood: 1.45, windshield: 0.75, roof: 1.1, rearGlass: 0.6, roofTaper: 0.88,
    wheelRadius: 0.32, tyreWidth: 0.21,
  },
  break: {
    length: 4.8, width: 1.85, height: 1.5, overhangFront: 0.93,
    clearance: 0.25, belt: 0.93, noseHeight: 0.8, tailHeight: 0.98,
    hood: 1.4, windshield: 0.7, roof: 1.9, rearGlass: 0.35, roofTaper: 0.9,
    wheelRadius: 0.32, tyreWidth: 0.21,
  },
  "petit-suv": {
    length: 4.25, width: 1.8, height: 1.6, overhangFront: 0.88,
    clearance: 0.2, belt: 1.0, noseHeight: 0.92, tailHeight: 1.06,
    hood: 1.1, windshield: 0.6, roof: 1.35, rearGlass: 0.6, roofTaper: 0.92,
    wheelRadius: 0.34, tyreWidth: 0.22,
  },
  camionnette: {
    length: 4.9, width: 1.95, height: 1.95, overhangFront: 0.9,
    clearance: 0.26, belt: 1.05, noseHeight: 0.95, tailHeight: 1.9,
    hood: 1.0, windshield: 0.75, roof: 1.1, rearGlass: 0, roofTaper: 0.94,
    wheelRadius: 0.33, tyreWidth: 0.22, cargo: true,
  },
  "vieille-voiture": {
    length: 4.1, width: 1.68, height: 1.4, overhangFront: 0.78,
    clearance: 0.24, belt: 0.86, noseHeight: 0.78, tailHeight: 0.92,
    hood: 1.2, windshield: 0.5, roof: 1.3, rearGlass: 0.35, roofTaper: 0.92,
    wheelRadius: 0.29, tyreWidth: 0.17, glass: "#3a4a5a",
  },
  // Gendarmerie (J4, D72) : la caisse de la compacte, bleu nuit, bandes claires sur les flancs, barre de gyrophares sur le toit.
  gendarmerie: {
    length: 4.25, width: 1.8, height: 1.46, overhangFront: 0.85,
    clearance: 0.27, belt: 0.9, noseHeight: 0.82, tailHeight: 0.95,
    hood: 1.25, windshield: 0.55, roof: 1.2, rearGlass: 0.75, roofTaper: 0.9,
    wheelRadius: 0.31, tyreWidth: 0.2,
    livery: { stripe: "#eef1f4", accent: "#4a8fd8", lightBar: true },
  },
  sportive: {
    length: 4.45, width: 1.88, height: 1.25, overhangFront: 0.92,
    clearance: 0.12, belt: 0.78, noseHeight: 0.6, tailHeight: 0.84,
    hood: 1.55, windshield: 0.85, roof: 0.75, rearGlass: 0.7, roofTaper: 0.84,
    wheelRadius: 0.33, tyreWidth: 0.26, glass: "#1b2733",
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

/** Géométrie au repos d'une voiture garée : caisse (peinture blanche), détails et roues dans une seule géométrie. */
export function carRestGeometry(id: string): THREE.BufferGeometry {
  const { p, front, rear } = bodyOf(id);
  return merge([bodyPaintGeometry(p, front, rear, "#ffffff"), parkedDetailGeometry(p, front, rear)]);
}
