import * as THREE from "three";
import { box, fender, marker, merge, paint, podLoft, sharedMaterial, tube, xDisc, zDisc, type VehicleModel } from "./vehicle-model";

/**
 * Vélos aux couleurs de l'affiche (refaits en D108) : le vélo de ville (Bibracte Promenade) a un cadre ouvert, des garde-boue, un carter de chaîne,
 * un porte-bagages, un panier en osier, un guidon relevé et une selle à ressorts ; le VTT (Bibracte Beuvray) a un cadre plongeant à gros tube diagonal,
 * une fourche suspendue, un cintre plat, des pneus à crampons, des freins à disque et un bidon.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Cinq maillages : cadre, direction (fourche, guidon, panier), pédalier, roue avant, roue arrière.
 */

/** Ce qui distingue les vélos : rayon de roue, section du pneu, demi-largeur du guidon, et le genre (ville ou VTT). */
export interface BikeStyle {
  wheelR: number;
  tyre: number;
  bar: number;
  kind: "city" | "mtb";
}
export const CITY_BIKE: BikeStyle = { wheelR: 0.34, tyre: 0.03, bar: 0.28, kind: "city" };
export const MOUNTAIN_BIKE: BikeStyle = { wheelR: 0.35, tyre: 0.045, bar: 0.34, kind: "mtb" };

const REAR_Z = 0.46;
const FRONT_Z = -0.62;
/** Haut du tube de direction : axe du guidon. */
const HEAD = new THREE.Vector3(0, 0.92, -0.45);
/** Inclinaison de l'axe de direction (rad, haut vers l'arrière). */
const STEER_AXIS = 0.25;

const METAL = "#8a8478";
const DARK = "#2c2c33";
const SADDLE = "#3a2a20";

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Tube léger (cinq pans, sans bouchons : ses bouts sont cachés dans les pièces qu'il relie). */
const tb = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): THREE.BufferGeometry => tube(a, b, r, color, 5, false);

/** Roue centrée sur son axe (axe x) : pneu (à crampons pour le VTT), jante claire, rayons croisés (la rotation se voit), moyeu. */
function wheelGeometry(style: BikeStyle): THREE.BufferGeometry {
  const R = style.wheelR, mtb = style.kind === "mtb";
  const tyre = new THREE.TorusGeometry(R - style.tyre, style.tyre, 4, 16);
  tyre.rotateY(Math.PI / 2);
  const rimR = R - 0.07 - (style.tyre - 0.03);
  const rim = new THREE.TorusGeometry(rimR, 0.012, 3, 16);
  rim.rotateY(Math.PI / 2);
  const parts = [paint(tyre, "#24242a"), paint(rim, mtb ? "#3a3b40" : "#d8d2c4")];
  const spokes = mtb ? 3 : 4;
  for (let i = 0; i < spokes; i++) {
    const s = new THREE.BoxGeometry(0.01, 2 * rimR, 0.008);
    s.rotateX((i * Math.PI) / spokes);
    parts.push(paint(s, "#b9b3a6"));
  }
  if (mtb) {
    // Crampons : de petits pavés tout autour de la bande de roulement.
    for (let i = 0; i < 10; i++) {
      const k = new THREE.BoxGeometry(style.tyre * 1.7, 0.025, 0.035);
      k.translate(0, R - 0.006, 0);
      k.rotateX((i * Math.PI * 2) / 10);
      parts.push(paint(k, "#1c1c20"));
    }
  }
  parts.push(xDisc(0.03, 0.09, 0, 0, 0, METAL, 6));
  return merge(parts);
}

/** Vélo de ville : cadre ouvert (deux tubes cintrés), carter de chaîne, garde-boue, porte-bagages, selle à ressorts, béquille, feu arrière. */
function cityFrame(color: string, style: BikeStyle): THREE.BufferGeometry[] {
  const R = style.wheelR, bb = v(0, 0.3, 0.05), seatTop = v(0, 0.82, 0.18), headLow = v(0, 0.7, -0.49);
  const rear = v(0, R, REAR_Z);
  return [
    tb(headLow, HEAD, 0.028, color),
    tb(headLow, v(0, 0.45, -0.3), 0.026, color),
    tb(v(0, 0.45, -0.3), v(0, 0.32, -0.1), 0.026, color),
    tb(v(0, 0.32, -0.1), bb, 0.026, color),
    tb(v(0, 0.82, -0.47), v(0, 0.56, -0.27), 0.02, color),
    tb(v(0, 0.56, -0.27), v(0, 0.44, 0.0), 0.02, color),
    tb(v(0, 0.44, 0.0), v(0, 0.46, 0.1), 0.02, color),
    tb(bb, seatTop, 0.022, color),
    tb(rear.clone().setX(0.05), bb, 0.014, color),
    tb(rear.clone().setX(-0.05), bb, 0.014, color),
    tb(rear.clone().setX(0.05), seatTop.clone().setY(0.76), 0.012, color),
    tb(rear.clone().setX(-0.05), seatTop.clone().setY(0.76), 0.012, color),
    // Carter de chaîne, plateau.
    podLoft([{ z: -0.04, y: 0.3, w: 0.012, h: 0.1, x: 0.08 }, { z: 0.48, y: R, w: 0.012, h: 0.05, x: 0.08 }], color),
    xDisc(0.1, 0.01, 0.065, 0.3, 0.05, DARK, 12),
    // Garde-boue arrière, porte-bagages, feu arrière.
    fender(R, REAR_Z, R + 0.03, 0.9, 3.0, 0.065, 0.012, color),
    box(0.15, 0.015, 0.34, 0, 0.73, 0.44, METAL),
    ...[-1, 1].flatMap((s) => [tb(v(s * 0.06, R, REAR_Z), v(s * 0.06, 0.72, 0.56), 0.009, METAL), tb(v(s * 0.06, 0.72, 0.3), v(s * 0.05, 0.78, 0.18), 0.009, METAL)]),
    zDisc(0.03, 0.03, 0, 0.7, 0.63, "#e0442c", 8),
    // Selle large à ressorts.
    podLoft([
      { z: 0.08, y: 0.87, w: 0.05, h: 0.025 },
      { z: 0.22, y: 0.875, w: 0.12, h: 0.035 },
      { z: 0.3, y: 0.87, w: 0.12, h: 0.03 },
    ], SADDLE),
    tb(v(0, 0.82, 0.18), v(0, 0.85, 0.2), 0.014, METAL),
    ...[-1, 1].map((s) => tb(v(s * 0.06, 0.83, 0.27), v(s * 0.06, 0.85, 0.27), 0.015, METAL)),
    // Béquille repliée à gauche.
    tb(v(-0.05, 0.28, 0.12), v(-0.07, 0.24, 0.38), 0.01, DARK),
  ];
}

/** VTT : cadre plongeant à gros tube diagonal (bande crème), tige de selle, selle étroite, bidon, disque arrière. */
function mtbFrame(color: string, style: BikeStyle): THREE.BufferGeometry[] {
  const R = style.wheelR, bb = v(0, 0.3, 0.05), seatTop = v(0, 0.74, 0.15), headLow = v(0, 0.72, -0.49);
  const rear = v(0, R, REAR_Z);
  const diag = (t: number): THREE.Vector3 => headLow.clone().lerp(bb, t);
  return [
    tb(headLow, HEAD, 0.032, color),
    tb(v(0, 0.87, -0.45), v(0, 0.71, 0.13), 0.026, color),
    tb(headLow, bb, 0.036, color),
    tb(diag(0.2), diag(0.32), 0.038, "#efe3c8"),
    tb(bb, seatTop, 0.026, color),
    tb(seatTop, v(0, 0.85, 0.2), 0.015, DARK),
    tb(rear.clone().setX(0.05), bb, 0.016, color),
    tb(rear.clone().setX(-0.05), bb, 0.016, color),
    tb(rear.clone().setX(0.05), v(0.02, 0.72, 0.14), 0.013, color),
    tb(rear.clone().setX(-0.05), v(-0.02, 0.72, 0.14), 0.013, color),
    // Selle étroite.
    podLoft([
      { z: 0.08, y: 0.87, w: 0.035, h: 0.02 },
      { z: 0.24, y: 0.88, w: 0.075, h: 0.025 },
      { z: 0.3, y: 0.875, w: 0.07, h: 0.02 },
    ], DARK),
    // Bidon le long du tube diagonal, disque de frein et étrier arrière, plateau.
    tb(diag(0.42).add(v(0, 0.07, 0.04)), diag(0.7).add(v(0, 0.07, 0.04)), 0.033, "#f1b24a"),
    tb(diag(0.38).add(v(0, 0.07, 0.04)), diag(0.42).add(v(0, 0.07, 0.04)), 0.02, DARK),
    xDisc(0.08, 0.006, -0.065, R, REAR_Z, "#b9bcc1", 12),
    box(0.03, 0.05, 0.06, -0.07, R + 0.08, REAR_Z - 0.04, DARK),
    xDisc(0.09, 0.01, 0.065, 0.3, 0.05, DARK, 12),
  ];
}

const wheelCache = new Map<BikeStyle, THREE.BufferGeometry>();

export function createBikeModel(color: string, style: BikeStyle = CITY_BIKE): VehicleModel {
  const WHEEL_R = style.wheelR, city = style.kind === "city";
  const bb = v(0, 0.3, 0.05);
  const frameGeo = merge(city ? cityFrame(color, style) : mtbFrame(color, style));
  // Pédalier : manivelles et pédales tournent autour du boîtier, centrées sur lui.
  const crankGeo = merge([
    tb(v(0.07, 0, 0), v(0.07, -0.17, 0), 0.012, METAL),
    tb(v(-0.07, 0, 0), v(-0.07, 0.17, 0), 0.012, METAL),
    box(0.1, 0.02, 0.05, 0.13, -0.17, 0, "#24242a"),
    box(0.1, 0.02, 0.05, -0.13, 0.17, 0, "#24242a"),
  ]);
  // Direction : pivote autour de l'axe du tube de direction ; géométrie exprimée depuis HEAD.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const bar = style.bar;
  const steerGeo = merge([
    tb(v(0, 0, 0), v(0, 0.1, 0.05), 0.018, METAL),
    box(0.05, 0.04, 0.11, bar - 0.02, 0.12, 0.12, "#24242a"),
    box(0.05, 0.04, 0.11, -(bar - 0.02), 0.12, 0.12, "#24242a"),
    ...(city
      ? [
          tb(v(0.05, -0.2, -0.05), front.clone().setX(0.05), 0.014, color),
          tb(v(-0.05, -0.2, -0.05), front.clone().setX(-0.05), 0.014, color),
          // Guidon relevé, recourbé vers le cycliste ; sonnette.
          ...[-1, 1].flatMap((s) => [tb(v(0, 0.1, 0.05), v(s * 0.14, 0.13, 0.03), 0.014, METAL), tb(v(s * 0.14, 0.13, 0.03), v(s * bar, 0.12, 0.14), 0.014, METAL)]),
          box(0.035, 0.035, 0.035, 0.12, 0.15, 0.04, "#cfc8b8"),
          // Panier en osier devant le guidon (moutarde, tressage plus sombre), phare sous le panier.
          box(0.34, 0.2, 0.26, 0, -0.05, -0.24, "#f1b24a"),
          ...[-0.1, -0.03, 0.04].map((y) => box(0.345, 0.018, 0.265, 0, y, -0.24, "#c98a2a")),
          box(0.3, 0.02, 0.22, 0, 0.055, -0.24, "#c98a2a"),
          zDisc(0.035, 0.05, 0, -0.2, -0.12, "#f5ecd2", 8),
          // Garde-boue avant.
          fender(front.y, front.z, WHEEL_R + 0.03, 0.25, 2.1, 0.065, 0.012, color),
        ]
      : [
          // Fourche suspendue : plongeurs clairs, fourreaux épais, té ; cintre plat et large ; disque avant.
          ...[-1, 1].flatMap((s) => [
            tb(v(s * 0.055, -0.05, -0.02), v(s * 0.055, -0.3, -0.11), 0.02, "#c9ccd0"),
            tb(v(s * 0.055, -0.28, -0.1), front.clone().setX(s * 0.055), 0.03, DARK),
          ]),
          box(0.15, 0.04, 0.06, 0, -0.05, -0.02, DARK),
          tb(v(-bar, 0.12, 0.11), v(bar, 0.12, 0.11), 0.016, DARK),
          xDisc(0.08, 0.006, -0.07, front.y, front.z, "#b9bcc1", 12),
        ]),
  ]);
  let wheelGeo = wheelCache.get(style);
  if (!wheelGeo) wheelCache.set(style, (wheelGeo = wheelGeometry(style)));
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
    gripL: marker(steerMesh, -(bar - 0.02), 0.12, 0.12), gripR: marker(steerMesh, bar - 0.02, 0.12, 0.12),
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
