import * as THREE from "three";
import { box, marker, merge, paint, sharedMaterial, tiltedBox, tube, type VehicleModel } from "./vehicle-model";

/**
 * Scooter de 125 cm³ aux couleurs de l'affiche, sans marque : tablier devant les jambes, plancher plat, coque arrière sous la selle, petites roues.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Quatre maillages : caisse (tablier, plancher, coque, selle), direction (colonne, guidon, phare, fourche), roue avant, roue arrière.
 */

const WHEEL_R = 0.25;
const FRONT_Z = -0.62;
const REAR_Z = 0.68;
/** Haut de la colonne de direction (axe du guidon) et inclinaison de l'axe (rad, haut vers l'arrière). */
const HEAD = new THREE.Vector3(0, 0.98, -0.38);
const STEER_AXIS = 0.3;

let wheelGeo: THREE.BufferGeometry | null = null;
function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.11, 14);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(WHEEL_R * 0.6, WHEEL_R * 0.6, 0.115, 10);
  hub.rotateZ(Math.PI / 2);
  // Une barre claire sur la jante : la rotation se voit.
  return merge([paint(tyre, "#24242a"), paint(hub, "#cfc8b8"), box(0.118, WHEEL_R * 1.1, 0.03, 0, 0, 0, "#8a8478")]);
}

export function createMotorScooterModel(color: string): VehicleModel {
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const dark = "#2c2c33", chrome = "#cfc8b8";
  const bodyGeo = merge([
    // Tablier devant les jambes (incliné vers l'arrière), plancher plat, flancs du plancher.
    tiltedBox(0.38, 0.6, 0.1, 0, 0.62, -0.42, 0.18, color),
    box(0.4, 0.05, 0.55, 0, 0.27, -0.08, dark),
    box(0.36, 0.012, 0.5, 0, 0.3, -0.08, "#46464e"),
    box(0.04, 0.17, 0.55, 0.21, 0.33, -0.08, color),
    box(0.04, 0.17, 0.55, -0.21, 0.33, -0.08, color),
    // Coque arrière sous la selle, flancs, feu arrière.
    box(0.36, 0.34, 0.7, 0, 0.5, 0.42, color),
    box(0.4, 0.22, 0.34, 0, 0.42, 0.78, color),
    box(0.16, 0.06, 0.03, 0, 0.62, 0.96, "#e0442c"),
    // Selle, repose-pieds du passager, pot d'échappement.
    box(0.32, 0.09, 0.62, 0, 0.74, 0.4, "#3a2a20"),
    box(0.3, 0.025, 0.04, 0, 0.8, 0.12, "#3a2a20"),
    tube(v(0.17, 0.3, 0.62), v(0.19, 0.28, 0.98), 0.05, chrome),
    // Garde-boue arrière.
    box(0.16, 0.03, 0.34, 0, WHEEL_R * 2 + 0.04, REAR_Z + 0.12, color),
  ]);
  // Direction exprimée depuis le haut de la colonne.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const steerGeo = merge([
    tube(v(0.06, 0, 0.02), front.clone().setX(0.06), 0.022, chrome),
    tube(v(-0.06, 0, 0.02), front.clone().setX(-0.06), 0.022, chrome),
    // Guidon avec ses poignées, rétroviseurs, bloc de phare carré.
    tube(v(-0.33, 0.02, 0.08), v(0.33, 0.02, 0.08), 0.017, chrome),
    box(0.07, 0.05, 0.13, 0.32, 0.02, 0.1, "#24242a"),
    box(0.07, 0.05, 0.13, -0.32, 0.02, 0.1, "#24242a"),
    tube(v(0.3, 0.03, 0.04), v(0.34, 0.2, 0.0), 0.008, chrome),
    tube(v(-0.3, 0.03, 0.04), v(-0.34, 0.2, 0.0), 0.008, chrome),
    box(0.1, 0.07, 0.03, 0.34, 0.22, 0.0, dark),
    box(0.1, 0.07, 0.03, -0.34, 0.22, 0.0, dark),
    box(0.3, 0.3, 0.2, 0, -0.14, -0.14, color),
    box(0.2, 0.12, 0.02, 0, -0.1, -0.255, "#f5ecd2"),
    // Garde-boue avant.
    box(0.16, 0.03, 0.42, 0, front.y + WHEEL_R + 0.06, front.z + 0.05, color),
  ]);
  wheelGeo ??= wheelGeometry();
  const mat = sharedMaterial();
  const mesh = (g: THREE.BufferGeometry): THREE.Mesh => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  };

  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  const steer = new THREE.Group();
  steer.position.copy(HEAD);
  steer.rotation.x = STEER_AXIS;
  const steerMesh = mesh(steerGeo);
  steerMesh.rotation.order = "YXZ";
  steerMesh.rotation.x = -STEER_AXIS;
  const fw = mesh(wheelGeo);
  fw.position.copy(front);
  steerMesh.add(fw);
  steer.add(steerMesh);
  const rw = mesh(wheelGeo);
  rw.position.set(0, WHEEL_R, REAR_Z);
  group.add(mesh(bodyGeo), steer, rw);
  // Poignées dans les mains, plante des pieds à plat sur le plancher.
  const anchors = {
    gripL: marker(steerMesh, -0.32, 0.02, 0.1), gripR: marker(steerMesh, 0.32, 0.02, 0.1),
    footL: marker(group, -0.15, 0.3, -0.12), footR: marker(group, 0.15, 0.3, -0.12),
  };

  return {
    group,
    seat: v(0, 0.78, 0.34),
    pose: "seat",
    anchors,
    update(s) {
      group.position.set(s.x, s.z, -s.y);
      group.rotation.set(s.pitch, -s.heading, -s.lean);
      steerMesh.rotation.y = -s.steer;
      fw.rotation.x = -s.wheel;
      rw.rotation.x = -s.wheel;
    },
    dispose() {
      bodyGeo.dispose();
      steerGeo.dispose();
    },
  };
}
