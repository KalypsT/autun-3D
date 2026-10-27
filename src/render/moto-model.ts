import * as THREE from "three";
import { box, marker, merge, paint, sharedMaterial, tube, type VehicleModel } from "./vehicle-model";

/**
 * Moto de style classique aux couleurs de l'affiche : réservoir peint, selle, moteur, échappement, phare rond.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Quatre maillages : cadre, direction (fourche, guidon, phare), roue avant, roue arrière.
 */

const TANK_COLORS = ["#d9472b", "#1f3a52", "#2a6f7e", "#f1b24a", "#3f7d4e"];
const WHEEL_R = 0.31;
const FRONT_Z = -0.7;
const REAR_Z = 0.72;
/** Haut de la colonne de direction et angle de chasse (rad, haut vers l'arrière). */
const HEAD = new THREE.Vector3(0, 0.98, -0.5);
const STEER_AXIS = 0.42;

let wheelGeo: THREE.BufferGeometry | null = null;
function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.TorusGeometry(WHEEL_R - 0.055, 0.055, 6, 22);
  tyre.rotateY(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(WHEEL_R - 0.1, WHEEL_R - 0.1, 0.03, 18);
  rim.rotateZ(Math.PI / 2);
  // Disque de frein et un rayon clair : la rotation se voit.
  const disc = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14);
  disc.rotateZ(Math.PI / 2);
  return merge([paint(tyre, "#24242a"), paint(rim, "#8a8478"), paint(disc, "#cfc8b8"), box(0.034, (WHEEL_R - 0.1) * 2, 0.04, 0, 0, 0, "#efe3c8")]);
}

export function createMotoModel(variant: number): VehicleModel {
  const color = TANK_COLORS[Math.abs(variant) % TANK_COLORS.length]!;
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const chrome = "#cfc8b8", dark = "#2c2c33";
  const frameGeo = merge([
    // Réservoir et sa bande claire, selle, coque arrière, feu.
    box(0.34, 0.22, 0.52, 0, 0.98, -0.2, color),
    box(0.06, 0.225, 0.5, 0, 0.985, -0.2, "#efe3c8"),
    box(0.3, 0.1, 0.6, 0, 0.9, 0.3, "#3a2a20"),
    box(0.26, 0.12, 0.3, 0, 0.88, 0.68, color),
    box(0.14, 0.06, 0.03, 0, 0.88, 0.84, "#e0442c"),
    // Moteur, cylindres, échappement.
    box(0.32, 0.34, 0.44, 0, 0.5, -0.05, "#5b5f66"),
    box(0.36, 0.2, 0.18, 0, 0.72, -0.2, "#7a7f86"),
    tube(v(0.17, 0.42, -0.2), v(0.2, 0.36, 0.25), 0.035, chrome),
    tube(v(0.2, 0.36, 0.25), v(0.22, 0.48, 0.85), 0.05, chrome),
    // Cadre, bras oscillant, amortisseurs.
    tube(HEAD, v(0, 0.62, -0.25), 0.03, dark),
    tube(v(0, 0.95, 0.05), v(0, 0.55, 0.2), 0.03, dark),
    tube(v(0.1, WHEEL_R, REAR_Z), v(0.1, 0.45, 0.15), 0.025, dark),
    tube(v(-0.1, WHEEL_R, REAR_Z), v(-0.1, 0.45, 0.15), 0.025, dark),
    tube(v(0.12, 0.38, 0.6), v(0.12, 0.85, 0.45), 0.025, color),
    tube(v(-0.12, 0.38, 0.6), v(-0.12, 0.85, 0.45), 0.025, color),
    // Repose-pieds.
    box(0.56, 0.03, 0.06, 0, 0.36, 0.12, dark),
  ]);
  // Direction exprimée depuis le haut de la colonne.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const steerGeo = merge([
    tube(v(0.09, 0, 0), front.clone().setX(0.09), 0.028, chrome),
    tube(v(-0.09, 0, 0), front.clone().setX(-0.09), 0.028, chrome),
    tube(v(-0.36, 0.13, 0.08), v(0.36, 0.13, 0.08), 0.017, chrome),
    tube(v(0, 0, 0), v(0, 0.12, 0.06), 0.025, dark),
    box(0.06, 0.05, 0.12, 0.34, 0.13, 0.1, "#24242a"),
    box(0.06, 0.05, 0.12, -0.34, 0.13, 0.1, "#24242a"),
    // Phare rond et garde-boue avant.
    box(0.2, 0.18, 0.12, 0, -0.08, -0.12, dark),
    box(0.16, 0.14, 0.02, 0, -0.08, -0.185, "#f5ecd2"),
    box(0.14, 0.03, 0.4, 0, front.y + WHEEL_R + 0.07, front.z, color),
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
  group.add(mesh(frameGeo), steer, rw);
  // Poignées dans les mains, plante des pieds sur le repose-pieds.
  const anchors = {
    gripL: marker(steerMesh, -0.34, 0.13, 0.1), gripR: marker(steerMesh, 0.34, 0.13, 0.1),
    footL: marker(group, -0.26, 0.375, 0.12), footR: marker(group, 0.26, 0.375, 0.12),
  };

  return {
    group,
    seat: v(0, 0.93, 0.22),
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
      frameGeo.dispose();
      steerGeo.dispose();
    },
  };
}
