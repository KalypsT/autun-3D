import * as THREE from "three";
import { box, marker, merge, paint, sharedMaterial, tube, type VehicleModel } from "./vehicle-model";

/**
 * Vélo de ville aux couleurs de l'affiche : cadre, guidon et panier, deux roues.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Quatre maillages : cadre, direction (fourche, guidon, panier), roue avant, roue arrière.
 */

const FRAME_COLORS = ["#2a6f7e", "#d9472b", "#1f3a52", "#3f7d4e", "#efe3c8"];
const WHEEL_R = 0.34;
const REAR_Z = 0.46;
const FRONT_Z = -0.62;
/** Haut du tube de direction : axe du guidon. */
const HEAD = new THREE.Vector3(0, 0.92, -0.45);
/** Inclinaison de l'axe de direction (rad, haut vers l'arrière). */
const STEER_AXIS = 0.25;

/** Roue centrée sur son axe (axe x) : pneu, jante claire, moyeu. */
function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.TorusGeometry(WHEEL_R - 0.03, 0.03, 5, 22);
  tyre.rotateY(Math.PI / 2);
  const rim = new THREE.TorusGeometry(WHEEL_R - 0.07, 0.012, 4, 22);
  rim.rotateY(Math.PI / 2);
  const parts = [paint(tyre, "#24242a"), paint(rim, "#d8d2c4")];
  // Rayons suggérés par trois barres croisées : la rotation se voit.
  for (let i = 0; i < 3; i++) {
    const s = new THREE.BoxGeometry(0.012, 2 * (WHEEL_R - 0.07), 0.012);
    s.rotateX((i * Math.PI) / 3);
    parts.push(paint(s, "#b9b3a6"));
  }
  const hub = new THREE.CylinderGeometry(0.03, 0.03, 0.09, 6);
  hub.rotateZ(Math.PI / 2);
  parts.push(paint(hub, "#8a8478"));
  return merge(parts);
}

let wheelGeo: THREE.BufferGeometry | null = null;


export function createBikeModel(variant: number): VehicleModel {
  const color = FRAME_COLORS[Math.abs(variant) % FRAME_COLORS.length]!;
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const rear = v(0, WHEEL_R, REAR_Z), bb = v(0, 0.3, 0.05), seatTop = v(0, 0.82, 0.18), headLow = v(0, 0.72, -0.5);
  const frameGeo = merge([
    tube(bb, seatTop, 0.022, color),
    tube(seatTop.clone().setY(0.78), HEAD.clone().setY(0.86), 0.02, color),
    tube(bb, headLow, 0.024, color),
    tube(rear.clone().setX(0.05), bb, 0.014, color),
    tube(rear.clone().setX(-0.05), bb, 0.014, color),
    tube(rear.clone().setX(0.05), seatTop.clone().setY(0.76), 0.012, color),
    tube(rear.clone().setX(-0.05), seatTop.clone().setY(0.76), 0.012, color),
    tube(headLow, HEAD, 0.028, color),
    // Selle, pédalier, garde-boue arrière, porte-bagages.
    box(0.15, 0.05, 0.26, 0, 0.88, 0.2, "#3a2a20"),
    tube(v(0, 0.82, 0.18), v(0, 0.87, 0.19), 0.012, "#8a8478"),
    box(0.04, 0.12, 0.12, 0.07, 0.3, 0.05, "#3a3a40"),
    box(0.16, 0.02, 0.36, 0, 0.72, 0.42, "#2c2c33"),
  ]);
  // Pédalier : manivelles et pédales tournent autour du boîtier, centrées sur lui.
  const crankGeo = merge([
    tube(v(0.07, 0, 0), v(0.07, -0.17, 0), 0.012, "#8a8478"),
    tube(v(-0.07, 0, 0), v(-0.07, 0.17, 0), 0.012, "#8a8478"),
    box(0.1, 0.02, 0.05, 0.13, -0.17, 0, "#24242a"),
    box(0.1, 0.02, 0.05, -0.13, 0.17, 0, "#24242a"),
  ]);
  // Direction : pivote autour de l'axe du tube de direction ; géométrie exprimée depuis HEAD.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const steerGeo = merge([
    tube(v(0.05, -0.2, -0.05), front.clone().setX(0.05), 0.014, color),
    tube(v(-0.05, -0.2, -0.05), front.clone().setX(-0.05), 0.014, color),
    tube(v(0, 0, 0), v(0, 0.1, 0.05), 0.018, "#8a8478"),
    tube(v(-0.28, 0.12, 0.1), v(0.28, 0.12, 0.1), 0.014, "#8a8478"),
    box(0.05, 0.04, 0.11, 0.26, 0.12, 0.12, "#24242a"),
    box(0.05, 0.04, 0.11, -0.26, 0.12, 0.12, "#24242a"),
    // Panier moutarde devant le guidon.
    box(0.34, 0.2, 0.26, 0, -0.05, -0.24, "#f1b24a"),
    box(0.3, 0.02, 0.22, 0, 0.055, -0.24, "#c98a2a"),
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
  const frame = mesh(frameGeo);
  const steer = new THREE.Group();
  steer.position.copy(HEAD);
  // Axe de direction incliné vers l'arrière : rotation totale = Rx(a) · Ry(braquage) · Rx(−a).
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
  const crank = mesh(crankGeo);
  crank.position.copy(bb);
  group.add(frame, steer, rw, crank);
  // Appuis du conducteur : poignées au bout du guidon, plante du pied sur le dessus des pédales.
  const anchors = {
    gripL: marker(steerMesh, -0.26, 0.12, 0.12), gripR: marker(steerMesh, 0.26, 0.12, 0.12),
    footL: marker(crank, -0.13, 0.17 + 0.01, 0), footR: marker(crank, 0.13, -0.17 + 0.01, 0),
  };

  return {
    group,
    seat: v(0, 0.88, 0.22),
    pose: "pedal",
    anchors,
    setCrank(angle) {
      // Vers l'avant, la pédale du bas recule : rotation négative autour de l'axe x.
      crank.rotation.x = -angle;
    },
    update(s) {
      group.position.set(s.x, s.z, -s.y);
      group.rotation.set(s.pitch, -s.heading, -s.lean);
      steerMesh.rotation.y = -s.steer;
      fw.rotation.x = -s.wheel;
      rw.rotation.x = -s.wheel;
    },
    dispose() {
      crankGeo.dispose();
      frameGeo.dispose();
      steerGeo.dispose();
    },
  };
}
