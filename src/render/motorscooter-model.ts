import * as THREE from "three";
import { box, fender, marker, merge, paint, podLoft, sharedMaterial, tube, xDisc, zDisc, type VehicleModel } from "./vehicle-model";

/**
 * Scooter de 125 cm³ aux couleurs de l'affiche (Éduen Zéphyr 125, refait en D108) : tablier galbé devant les jambes, plancher plat à bandes de caoutchouc,
 * coque arrière bombée sous la selle, top-case, couvre-guidon avec le phare, rétroviseurs ronds, petites roues en alliage.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Quatre maillages : caisse (tablier, plancher, coque, selle, top-case), direction (colonne, guidon, phare, fourche, garde-boue), roue avant, roue arrière.
 */

const WHEEL_R = 0.25;
const FRONT_Z = -0.62;
const REAR_Z = 0.68;
/** Haut de la colonne de direction (axe du guidon) et inclinaison de l'axe (rad, haut vers l'arrière). */
const HEAD = new THREE.Vector3(0, 0.98, -0.38);
const STEER_AXIS = 0.3;

const CHROME = "#cfc8b8";
const DARK = "#2c2c33";
const LIGHT = "#f5ecd2";
const AMBER = "#f1a03a";

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Tube léger (cinq pans, sans bouchons : ses bouts sont cachés dans les pièces qu'il relie). */
const tb = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): THREE.BufferGeometry => tube(a, b, r, color, 5, false);

let wheelGeo: THREE.BufferGeometry | null = null;
/** Pneu, jante en alliage à cinq branches (la rotation se voit), moyeu. */
function wheelGeometry(): THREE.BufferGeometry {
  const parts = [xDisc(WHEEL_R, 0.11, 0, 0, 0, "#24242a", 14), xDisc(WHEEL_R * 0.66, 0.114, 0, 0, 0, "#3a3b40", 12)];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.BoxGeometry(0.118, WHEEL_R * 0.62, 0.035);
    s.translate(0, WHEEL_R * 0.31, 0);
    s.rotateX((i * Math.PI * 2) / 5);
    parts.push(paint(s, "#c9ccd0"));
  }
  parts.push(xDisc(0.045, 0.12, 0, 0, 0, "#c9ccd0", 8));
  return merge(parts);
}

export function createMotorScooterModel(color: string): VehicleModel {
  // Tablier : une coque ovale courte, inclinée vers l'arrière, autour du bas de la colonne.
  const apron = podLoft([
    { z: -0.06, y: 0, w: 0.15, h: 0.24 },
    { z: -0.02, y: 0, w: 0.2, h: 0.31 },
    { z: 0.05, y: 0, w: 0.19, h: 0.3 },
  ], color);
  apron.rotateX(0.18);
  apron.translate(0, 0.6, -0.42);
  const bodyGeo = merge([
    apron,
    // Cravate du klaxon, clignotants en haut du tablier.
    box(0.09, 0.2, 0.02, 0, 0.62, -0.5, DARK),
    box(0.1, 0.012, 0.024, 0, 0.7, -0.5, CHROME),
    ...[-1, 1].map((s) => box(0.06, 0.035, 0.04, s * 0.15, 0.86, -0.46, AMBER)),
    // Plancher plat et ses bandes de caoutchouc, flancs du plancher.
    box(0.4, 0.05, 0.55, 0, 0.27, -0.08, DARK),
    ...[-0.09, 0, 0.09].map((x) => box(0.03, 0.012, 0.48, x, 0.3, -0.08, "#46464e")),
    podLoft([{ z: -0.36, y: 0.32, w: 0.2, h: 0.07 }, { z: 0.2, y: 0.32, w: 0.21, h: 0.07 }], color),
    // Coque arrière bombée sous la selle.
    podLoft([
      { z: 0.05, y: 0.42, w: 0.14, h: 0.12 },
      { z: 0.32, y: 0.5, w: 0.2, h: 0.22 },
      { z: 0.72, y: 0.53, w: 0.21, h: 0.22 },
      { z: 0.95, y: 0.6, w: 0.1, h: 0.1 },
    ], color),
    // Selle à deux niveaux, poignée du passager, porte-bagages et top-case.
    podLoft([
      { z: 0.1, y: 0.73, w: 0.12, h: 0.04 },
      { z: 0.3, y: 0.74, w: 0.16, h: 0.05 },
      { z: 0.55, y: 0.77, w: 0.15, h: 0.05 },
      { z: 0.74, y: 0.77, w: 0.12, h: 0.045 },
    ], "#3a2a20"),
    tb(v(-0.13, 0.82, 0.78), v(0.13, 0.82, 0.78), 0.015, DARK),
    box(0.3, 0.025, 0.24, 0, 0.82, 0.86, DARK),
    podLoft([
      { z: 0.72, y: 0.95, w: 0.17, h: 0.11 },
      { z: 0.98, y: 0.96, w: 0.19, h: 0.13 },
    ], "#3a3b40"),
    box(0.2, 0.025, 0.02, 0, 0.97, 0.99, "#e0442c"),
    // Feu arrière large, clignotants, plaque, pot d'échappement noir à embout chromé.
    box(0.2, 0.06, 0.03, 0, 0.62, 0.96, "#e0442c"),
    ...[-1, 1].map((s) => box(0.05, 0.035, 0.03, s * 0.15, 0.62, 0.93, AMBER)),
    box(0.17, 0.11, 0.012, 0, 0.47, 1.0, "#f1e6c8"),
    tb(v(0.17, 0.3, 0.45), v(0.19, 0.3, 0.6), 0.03, DARK),
    podLoft([{ z: 0.58, y: 0.31, w: 0.055, h: 0.055, x: 0.19 }, { z: 0.92, y: 0.33, w: 0.06, h: 0.06, x: 0.2 }], DARK),
    zDisc(0.035, 0.02, 0.2, 0.33, 0.93, CHROME, 8),
    // Garde-boue arrière.
    fender(WHEEL_R, REAR_Z, WHEEL_R + 0.04, 1.4, 2.5, 0.16, 0.02, color),
  ]);
  // Direction exprimée depuis le haut de la colonne.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const steerGeo = merge([
    tb(v(0.06, -0.3, 0.02), front.clone().setX(0.06), 0.022, DARK),
    tb(v(-0.06, -0.3, 0.02), front.clone().setX(-0.06), 0.022, DARK),
    // Guidon et poignées.
    tb(v(-0.33, 0.02, 0.08), v(0.33, 0.02, 0.08), 0.017, DARK),
    box(0.07, 0.05, 0.13, 0.32, 0.02, 0.1, "#24242a"),
    box(0.07, 0.05, 0.13, -0.32, 0.02, 0.1, "#24242a"),
    // Couvre-guidon arrondi avec le phare, compteur.
    podLoft([
      { z: -0.16, y: 0.0, w: 0.1, h: 0.06 },
      { z: -0.1, y: 0.02, w: 0.2, h: 0.08 },
      { z: 0.08, y: 0.03, w: 0.18, h: 0.07 },
    ], color),
    box(0.16, 0.07, 0.03, 0, 0.01, -0.165, LIGHT),
    box(0.14, 0.01, 0.1, 0, 0.1, 0.02, DARK),
    box(0.1, 0.012, 0.07, 0, 0.106, 0.02, "#5aa0b4"),
    // Rétroviseurs ronds sur tiges.
    ...[-1, 1].flatMap((s) => [tb(v(s * 0.2, 0.08, 0.04), v(s * 0.3, 0.22, 0.0), 0.008, CHROME), zDisc(0.05, 0.02, s * 0.31, 0.24, 0.0, DARK, 8)]),
    // Garde-boue avant arrondi.
    fender(front.y, front.z, WHEEL_R + 0.03, 0.3, 2.2, 0.17, 0.025, color),
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
