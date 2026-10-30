import * as THREE from "three";
import { box, fender, marker, merge, podLoft, sharedMaterial, tube, xDisc, zDisc, type VehicleModel } from "./vehicle-model";

/**
 * Trottinette électrique de location (Trott'Autun, refaite en D108) : plateau bas arrondi avec batterie dessous et tapis antidérapant,
 * colonne épaisse à la livrée du service (bande crème, plaque à code), phare sur la colonne, écran au guidon, garde-boue, béquille, petites roues pleines.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Quatre maillages : plateau, direction (colonne, guidon), roue avant, roue arrière.
 */

const WHEEL_R = 0.11;
const FRONT_Z = -0.45;
const REAR_Z = 0.45;
/** Pied de la colonne (axe de direction) et son inclinaison vers l'arrière. */
const HEAD = new THREE.Vector3(0, 0.2, -0.43);
const STEER_AXIS = 0.12;

const DARK = "#2c2c33";
const CREAM = "#efe3c8";

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Tube léger (cinq pans, sans bouchons : ses bouts sont cachés dans les pièces qu'il relie). */
const tb = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): THREE.BufferGeometry => tube(a, b, r, color, 5, false);

let wheelGeo: THREE.BufferGeometry | null = null;
/** Roue pleine : pneu, moyeu clair, et une barre claire (la rotation se voit). */
function wheelGeometry(): THREE.BufferGeometry {
  return merge([
    xDisc(WHEEL_R, 0.05, 0, 0, 0, "#24242a", 14),
    xDisc(WHEEL_R * 0.6, 0.055, 0, 0, 0, "#b9b3a6", 10),
    box(0.058, WHEEL_R * 1.1, 0.02, 0, 0, 0, CREAM),
  ]);
}

export function createKickScooterModel(color: string): VehicleModel {
  const deckGeo = merge([
    // Plateau arrondi (batterie de la couleur du service dessous), tapis antidérapant.
    podLoft([
      { z: -0.32, y: 0.12, w: 0.06, h: 0.04 },
      { z: -0.26, y: 0.12, w: 0.09, h: 0.045 },
      { z: 0.3, y: 0.12, w: 0.09, h: 0.045 },
      { z: 0.36, y: 0.13, w: 0.06, h: 0.035 },
    ], color),
    box(0.15, 0.012, 0.54, 0, 0.165, 0.02, "#46464e"),
    box(0.186, 0.02, 0.5, 0, 0.12, 0.02, CREAM),
    // Garde-boue arrière (frein au pied), feu arrière, cou du plateau vers la colonne, bras arrière.
    fender(WHEEL_R, REAR_Z, WHEEL_R + 0.02, 1.2, 2.9, 0.08, 0.015, DARK),
    box(0.06, 0.03, 0.02, 0, 0.17, REAR_Z + 0.13, "#e0442c"),
    tb(v(0, 0.13, -0.3), HEAD, 0.034, color),
    tb(v(0.03, WHEEL_R, REAR_Z), v(0.03, 0.13, REAR_Z - 0.12), 0.012, DARK),
    tb(v(-0.03, WHEEL_R, REAR_Z), v(-0.03, 0.13, REAR_Z - 0.12), 0.012, DARK),
    // Béquille repliée à gauche.
    tb(v(-0.08, 0.1, -0.05), v(-0.1, 0.05, 0.12), 0.009, DARK),
  ]);
  // Direction exprimée depuis le pied de la colonne.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const steerGeo = merge([
    tb(v(0, 0, 0), v(0, 0.9, 0), 0.03, color),
    // Livrée : bande crème et plaque à code sur la colonne, phare en haut.
    tb(v(0, 0.36, 0), v(0, 0.46, 0), 0.032, CREAM),
    box(0.07, 0.09, 0.012, 0, 0.6, -0.032, CREAM),
    box(0.05, 0.06, 0.014, 0, 0.6, -0.034, DARK),
    zDisc(0.03, 0.04, 0, 0.8, -0.04, "#f5ecd2", 8),
    // Guidon, poignées, écran, sonnette, levier de frein.
    tb(v(-0.24, 0.9, 0), v(0.24, 0.9, 0), 0.016, DARK),
    box(0.05, 0.04, 0.05, 0.23, 0.9, 0, "#24242a"),
    box(0.05, 0.04, 0.05, -0.23, 0.9, 0, "#24242a"),
    box(0.09, 0.03, 0.06, 0, 0.93, 0.0, DARK),
    box(0.07, 0.006, 0.045, 0, 0.947, 0.004, "#5aa0b4"),
    box(0.03, 0.025, 0.03, -0.13, 0.92, 0.0, "#cfc8b8"),
    box(0.1, 0.01, 0.02, 0.17, 0.9, 0.04, DARK),
    // Fourche et garde-boue avant.
    tb(v(0.03, 0, 0), front.clone().setX(0.03), 0.012, DARK),
    tb(v(-0.03, 0, 0), front.clone().setX(-0.03), 0.012, DARK),
    fender(front.y, front.z, WHEEL_R + 0.02, 0.4, 2.0, 0.07, 0.012, color),
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
