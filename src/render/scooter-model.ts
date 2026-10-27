import * as THREE from "three";
import { box, marker, merge, paint, sharedMaterial, tube, type VehicleModel } from "./vehicle-model";

/**
 * Trottinette électrique de location : plateau bas, colonne de direction, guidon, petites roues pleines.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Quatre maillages : plateau, direction (colonne, guidon), roue avant, roue arrière.
 */

const STEM_COLORS = ["#2a6f7e", "#f1b24a", "#d9472b", "#3f7d4e"];
const WHEEL_R = 0.11;
const FRONT_Z = -0.45;
const REAR_Z = 0.45;
/** Pied de la colonne (axe de direction) et son inclinaison vers l'arrière. */
const HEAD = new THREE.Vector3(0, 0.2, -0.43);
const STEER_AXIS = 0.12;

let wheelGeo: THREE.BufferGeometry | null = null;
function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.05, 14);
  tyre.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.055, 10);
  hub.rotateZ(Math.PI / 2);
  // Une barre claire sur la jante : la rotation se voit.
  return merge([paint(tyre, "#24242a"), paint(hub, "#b9b3a6"), box(0.058, WHEEL_R * 1.1, 0.02, 0, 0, 0, "#efe3c8")]);
}

export function createScooterModel(variant: number): VehicleModel {
  const color = STEM_COLORS[Math.abs(variant) % STEM_COLORS.length]!;
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const deckGeo = merge([
    box(0.17, 0.05, 0.66, 0, 0.13, 0.02, "#2c2c33"),
    box(0.15, 0.012, 0.6, 0, 0.16, 0.02, "#46464e"),
    // Garde-boue et feu arrière, cou du plateau vers la colonne.
    box(0.08, 0.02, 0.2, 0, WHEEL_R * 2 + 0.01, REAR_Z + 0.02, color),
    box(0.06, 0.03, 0.02, 0, 0.17, REAR_Z + 0.12, "#e0442c"),
    tube(v(0, 0.14, -0.3), HEAD, 0.03, "#2c2c33"),
    tube(v(0.03, WHEEL_R, REAR_Z), v(0.03, 0.13, REAR_Z - 0.12), 0.012, "#2c2c33"),
    tube(v(-0.03, WHEEL_R, REAR_Z), v(-0.03, 0.13, REAR_Z - 0.12), 0.012, "#2c2c33"),
  ]);
  // Direction exprimée depuis le pied de la colonne.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const steerGeo = merge([
    tube(v(0, 0, 0), v(0, 0.9, 0), 0.025, color),
    tube(v(-0.24, 0.9, 0), v(0.24, 0.9, 0), 0.016, "#2c2c33"),
    box(0.05, 0.04, 0.05, 0.23, 0.9, 0, "#24242a"),
    box(0.05, 0.04, 0.05, -0.23, 0.9, 0, "#24242a"),
    box(0.07, 0.05, 0.04, 0, 0.78, -0.03, "#efe3c8"),
    tube(v(0.03, 0, 0), front.clone().setX(0.03), 0.012, "#2c2c33"),
    tube(v(-0.03, 0, 0), front.clone().setX(-0.03), 0.012, "#2c2c33"),
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
  group.add(mesh(deckGeo), steer, rw);
  // Poignées dans les mains ; pieds l'un derrière l'autre sur le plateau (le gauche devant).
  const anchors = {
    gripL: marker(steerMesh, -0.23, 0.9, 0), gripR: marker(steerMesh, 0.23, 0.9, 0),
    footL: marker(group, -0.04, 0.166, -0.14), footR: marker(group, 0.04, 0.166, 0.16),
  };

  return {
    group,
    seat: v(0, 0.165, 0.08),
    pose: "stand",
    anchors,
    update(s) {
      group.position.set(s.x, s.z, -s.y);
      group.rotation.set(s.pitch, -s.heading, -s.lean);
      steerMesh.rotation.y = -s.steer;
      fw.rotation.x = -s.wheel;
      rw.rotation.x = -s.wheel;
    },
    dispose() {
      deckGeo.dispose();
      steerGeo.dispose();
    },
  };
}
