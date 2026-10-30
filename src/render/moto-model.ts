import * as THREE from "three";
import { box, fender, marker, merge, paint, podLoft, sharedMaterial, tiltedBox, tube, xDisc, zDisc, type VehicleModel } from "./vehicle-model";

/**
 * Motos aux couleurs de l'affiche (refaites en D108) : la routière (Bibracte Druide) est une classique, réservoir en goutte, moteur à ailettes,
 * deux silencieux chromés, phare rond et roues à rayons ; la sportive (Bibracte Celte R) a un carénage intégral, une double optique, une bulle,
 * une coque arrière effilée, un silencieux relevé et des jantes coulées.
 * Repère local : avant vers −z, haut +y, origine au centre de gravité (au sol).
 * Quatre maillages : cadre (avec le carénage de la sportive, fixé au cadre), direction (fourche, guidon, phare de la routière), roue avant, roue arrière.
 */

const WHEEL_R = 0.31;
const FRONT_Z = -0.7;
const REAR_Z = 0.72;
/** Haut de la colonne de direction et angle de chasse (rad, haut vers l'arrière). */
const HEAD = new THREE.Vector3(0, 0.98, -0.5);
const STEER_AXIS = 0.42;

/** Style : « roadster » (classique) ou « sport » (carénage, guidons bas, pneu arrière large, selle reculée). */
export type MotoStyle = "roadster" | "sport";

const CHROME = "#cfc8b8";
const DARK = "#2c2c33";
const STEEL = "#7a7f86";
const SADDLE = "#3a2a20";
const LIGHT = "#f5ecd2";
const AMBER = "#f1a03a";
const RED = "#e0442c";
const PLATE = "#f1e6c8";

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Tube léger (cinq pans, sans bouchons : ses bouts sont cachés dans les pièces qu'il relie). */
const tb = (a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): THREE.BufferGeometry => tube(a, b, r, color, 5, false);

const wheelCache = new Map<string, THREE.BufferGeometry>();
/**
 * Roue dont le pneu a la section donnée : à rayons (routière, huit rayons chromés et tambour) ou coulée (sportive, trois branches sombres,
 * jante soulignée d'ocre et disque de frein). Les rayons ou les branches font voir la rotation.
 */
function wheelGeometry(section: number, cast: boolean): THREE.BufferGeometry {
  const tyre = new THREE.TorusGeometry(WHEEL_R - section, section, 5, 16);
  tyre.rotateY(Math.PI / 2);
  const rimR = WHEEL_R - section * 2 + 0.005;
  const rim = new THREE.TorusGeometry(rimR, 0.014, 3, 16);
  rim.rotateY(Math.PI / 2);
  const parts = [paint(tyre, "#24242a"), paint(rim, cast ? "#d9a441" : CHROME)];
  if (cast) {
    for (let i = 0; i < 3; i++) {
      const s = new THREE.BoxGeometry(0.03, rimR, 0.045);
      s.translate(0, rimR / 2, 0);
      s.rotateX((i * Math.PI * 2) / 3);
      parts.push(paint(s, "#2e3035"));
    }
    parts.push(xDisc(0.06, 0.1, 0, 0, 0, "#2e3035", 8), xDisc(0.15, 0.012, 0.05, 0, 0, "#a8abb0", 14));
  } else {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.BoxGeometry(0.008, rimR * 2, 0.008);
      s.rotateX((i * Math.PI) / 4);
      parts.push(paint(s, "#b9b3a6"));
    }
    parts.push(xDisc(0.075, 0.1, 0, 0, 0, STEEL, 10), xDisc(0.035, 0.12, 0, 0, 0, CHROME, 6));
  }
  return merge(parts);
}

function wheelFor(section: number, cast: boolean): THREE.BufferGeometry {
  const key = `${section}-${cast}`;
  let g = wheelCache.get(key);
  if (!g) wheelCache.set(key, (g = wheelGeometry(section, cast)));
  return g;
}

/** Cadre commun : épine, berceau, bras oscillant, amortisseurs, repose-pieds. */
function chassis(color: string, sport: boolean): THREE.BufferGeometry[] {
  const pegY = sport ? 0.46 : 0.36, pegZ = sport ? 0.3 : 0.12;
  return [
    tb(HEAD, v(0, 0.62, -0.25), 0.03, DARK),
    tb(v(0, 0.95, 0.05), v(0, 0.55, 0.2), 0.03, DARK),
    tb(v(0.1, WHEEL_R, REAR_Z), v(0.1, 0.45, 0.15), 0.025, sport ? "#9a9ea5" : DARK),
    tb(v(-0.1, WHEEL_R, REAR_Z), v(-0.1, 0.45, 0.15), 0.025, sport ? "#9a9ea5" : DARK),
    // Amortisseurs : tige chromée et ressort de la couleur de la moto.
    ...[-1, 1].flatMap((s) => [
      tb(v(s * 0.12, 0.38, 0.6), v(s * 0.12, 0.85, 0.45), 0.014, CHROME),
      tb(v(s * 0.12, 0.5, 0.56), v(s * 0.12, 0.76, 0.48), 0.03, sport ? "#d9a441" : color),
    ]),
    box(0.56, 0.03, 0.06, 0, pegY, pegZ, DARK),
    // Béquille latérale, repliée à gauche.
    tb(v(-0.14, 0.34, 0.08), v(-0.2, 0.3, 0.32), 0.012, DARK),
  ];
}

/** Routière : réservoir en goutte, selle plate, caches latéraux, moteur à ailettes, deux silencieux, garde-boue arrière, feu rond. */
function roadsterFrame(color: string): THREE.BufferGeometry[] {
  const fins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) fins.push(box(i % 2 ? 0.24 : 0.3, 0.03, i % 2 ? 0.16 : 0.2, 0, 0.6 + i * 0.045, -0.2, i % 2 ? "#5b5f66" : "#9a9ea5"));
  return [
    podLoft([
      { z: -0.5, y: 0.97, w: 0.08, h: 0.06 },
      { z: -0.4, y: 0.99, w: 0.16, h: 0.11 },
      { z: -0.18, y: 1.0, w: 0.18, h: 0.12 },
      { z: 0.0, y: 0.96, w: 0.13, h: 0.09 },
      { z: 0.06, y: 0.93, w: 0.07, h: 0.05 },
    ], color),
    // Écussons crème et genouillères sur les flancs du réservoir, bouchon chromé.
    box(0.372, 0.06, 0.14, 0, 1.0, -0.22, "#efe3c8"),
    box(0.3, 0.07, 0.1, 0, 0.93, -0.02, DARK),
    box(0.06, 0.02, 0.06, 0, 1.12, -0.26, CHROME),
    podLoft([
      { z: 0.02, y: 0.89, w: 0.09, h: 0.035 },
      { z: 0.14, y: 0.9, w: 0.15, h: 0.05 },
      { z: 0.52, y: 0.9, w: 0.14, h: 0.05 },
      { z: 0.68, y: 0.88, w: 0.09, h: 0.035 },
    ], SADDLE),
    // Poignée du passager.
    tb(v(0.13, 0.9, 0.42), v(0.1, 0.9, 0.74), 0.012, CHROME),
    tb(v(-0.13, 0.9, 0.42), v(-0.1, 0.9, 0.74), 0.012, CHROME),
    tb(v(-0.1, 0.9, 0.74), v(0.1, 0.9, 0.74), 0.012, CHROME),
    podLoft([{ z: 0.1, y: 0.72, w: 0.14, h: 0.1 }, { z: 0.4, y: 0.74, w: 0.13, h: 0.09 }], color),
    // Moteur : carter, cylindre à ailettes, culasse.
    podLoft([
      { z: -0.3, y: 0.46, w: 0.12, h: 0.12 },
      { z: -0.15, y: 0.44, w: 0.16, h: 0.15 },
      { z: 0.15, y: 0.44, w: 0.15, h: 0.13 },
      { z: 0.26, y: 0.47, w: 0.1, h: 0.09 },
    ], "#6f737a"),
    ...fins,
    box(0.22, 0.05, 0.16, 0, 0.84, -0.2, STEEL),
    // Deux échappements chromés.
    ...[-1, 1].flatMap((s) => [
      tb(v(s * 0.1, 0.64, -0.32), v(s * 0.16, 0.36, -0.12), 0.026, CHROME),
      tb(v(s * 0.16, 0.36, -0.12), v(s * 0.19, 0.37, 0.28), 0.026, CHROME),
      podLoft([
        { z: 0.24, y: 0.37, w: 0.035, h: 0.035, x: s * 0.19 },
        { z: 0.36, y: 0.39, w: 0.058, h: 0.058, x: s * 0.2 },
        { z: 0.86, y: 0.47, w: 0.058, h: 0.058, x: s * 0.21 },
      ], CHROME),
      zDisc(0.04, 0.012, s * 0.21, 0.47, 0.866, DARK, 8),
    ]),
    fender(WHEEL_R, REAR_Z, WHEEL_R + 0.04, 1.15, 2.65, 0.15, 0.02, color),
    // Feu arrière rond, clignotants, plaque.
    zDisc(0.05, 0.05, 0, 0.62, 0.99, RED),
    ...[-1, 1].map((s) => zDisc(0.025, 0.05, s * 0.12, 0.6, 0.97, AMBER, 8)),
    tiltedBox(0.18, 0.11, 0.01, 0, 0.5, 1.01, -0.3, PLATE),
  ];
}

/** Sportive : carénage intégral (nez à double optique, bulle, flancs, sabot), réservoir, selle étroite, coque arrière effilée, silencieux relevé. */
function sportFrame(color: string): THREE.BufferGeometry[] {
  const accent = "#efe3c8";
  return [
    // Nez de carénage, fixé au cadre.
    podLoft([
      { z: -0.98, y: 0.86, w: 0.05, h: 0.05 },
      { z: -0.88, y: 0.87, w: 0.15, h: 0.12 },
      { z: -0.64, y: 0.86, w: 0.22, h: 0.19 },
      { z: -0.46, y: 0.8, w: 0.23, h: 0.25 },
    ], color),
    ...[-1, 1].flatMap((s) => [
      rolled(0.1, 0.045, 0.04, s * 0.075, 0.86, -0.925, s * 0.25, LIGHT),
      box(0.03, 0.03, 0.03, s * 0.2, 0.84, -0.66, AMBER),
      // Rétroviseurs sur le carénage.
      tb(v(s * 0.2, 0.96, -0.6), v(s * 0.25, 1.0, -0.57), 0.01, DARK),
      box(0.09, 0.05, 0.04, s * 0.27, 1.0, -0.56, DARK),
    ]),
    box(0.06, 0.04, 0.04, 0, 0.8, -0.95, DARK),
    tiltedBox(0.3, 0.24, 0.02, 0, 1.06, -0.64, 0.85, "#3a4d63"),
    // Flancs de carénage et sabot, avec une bande crème.
    podLoft([
      { z: -0.46, y: 0.62, w: 0.22, h: 0.26 },
      { z: -0.1, y: 0.58, w: 0.21, h: 0.23 },
      { z: 0.12, y: 0.55, w: 0.15, h: 0.15 },
    ], color),
    box(0.432, 0.05, 0.42, 0, 0.68, -0.25, accent),
    podLoft([{ z: -0.4, y: 0.32, w: 0.15, h: 0.07 }, { z: 0.12, y: 0.3, w: 0.12, h: 0.06 }], DARK),
    // Réservoir, selle étroite, coque arrière effilée.
    podLoft([
      { z: -0.44, y: 0.97, w: 0.1, h: 0.08 },
      { z: -0.3, y: 1.01, w: 0.18, h: 0.12 },
      { z: -0.05, y: 1.0, w: 0.17, h: 0.11 },
      { z: 0.1, y: 0.92, w: 0.1, h: 0.06 },
    ], color),
    podLoft([{ z: 0.08, y: 0.84, w: 0.1, h: 0.035 }, { z: 0.42, y: 0.855, w: 0.12, h: 0.035 }], SADDLE),
    podLoft([
      { z: 0.3, y: 0.85, w: 0.14, h: 0.07 },
      { z: 0.6, y: 0.92, w: 0.12, h: 0.08 },
      { z: 0.96, y: 1.0, w: 0.03, h: 0.03 },
    ], color),
    box(0.12, 0.03, 0.03, 0, 0.96, 0.86, RED),
    // Support de plaque et clignotants sous la coque.
    tb(v(0, 0.86, 0.7), v(0, 0.66, 0.93), 0.012, DARK),
    tiltedBox(0.17, 0.1, 0.01, 0, 0.62, 0.95, -0.2, PLATE),
    ...[-1, 1].map((s) => box(0.04, 0.025, 0.03, s * 0.1, 0.7, 0.92, AMBER)),
    // Cadre périmétrique en aluminium (visible sous la selle), silencieux relevé à droite.
    ...[-1, 1].map((s) => tb(v(s * 0.13, 0.88, -0.45), v(s * 0.13, 0.62, 0.12), 0.03, "#9a9ea5")),
    tb(v(0.1, 0.35, -0.2), v(0.15, 0.42, 0.3), 0.03, "#8f939a"),
    podLoft([
      { z: 0.32, y: 0.47, w: 0.05, h: 0.05, x: 0.17 },
      { z: 0.42, y: 0.52, w: 0.07, h: 0.07, x: 0.18 },
      { z: 0.76, y: 0.66, w: 0.07, h: 0.07, x: 0.19 },
    ], "#8f939a"),
    zDisc(0.05, 0.012, 0.19, 0.66, 0.766, DARK, 8),
  ];
}

/** Boîte tournée autour de l'axe z (phares en amande). */
function rolled(w: number, h: number, d: number, x: number, y: number, z: number, roll: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateZ(roll);
  g.translate(x, y, z);
  return paint(g, color);
}

export function createMotoModel(color: string, style: MotoStyle = "roadster"): VehicleModel {
  const sport = style === "sport";
  const frameGeo = merge([...chassis(color, sport), ...(sport ? sportFrame(color) : roadsterFrame(color))]);
  // Direction exprimée depuis le haut de la colonne.
  const front = v(0, WHEEL_R, FRONT_Z).sub(HEAD);
  const fork = (s: number, t: number): THREE.Vector3 => v(s * 0.09, 0, 0).lerp(front.clone().setX(s * 0.09), t);
  const steerGeo = merge([
    // Fourche : tubes et fourreaux (fourche inversée dorée sur la sportive).
    ...[-1, 1].flatMap((s) => [
      tb(fork(s, 0), fork(s, 0.55), sport ? 0.034 : 0.026, sport ? DARK : CHROME),
      tb(fork(s, 0.55), fork(s, 1), sport ? 0.026 : 0.034, sport ? "#d9a441" : "#4a4c52"),
    ]),
    box(0.26, 0.05, 0.08, 0, -0.06, -0.03, DARK),
    tb(v(0, 0, 0), v(0, 0.12, 0.06), 0.025, DARK),
    ...(sport
      ? [
          // Demi-guidons bas, poignées.
          tb(v(0.07, 0.03, 0.02), v(0.21, -0.04, 0.16), 0.017, CHROME),
          tb(v(-0.07, 0.03, 0.02), v(-0.21, -0.04, 0.16), 0.017, CHROME),
          box(0.07, 0.05, 0.1, 0.22, -0.04, 0.18, "#24242a"),
          box(0.07, 0.05, 0.1, -0.22, -0.04, 0.18, "#24242a"),
          box(0.04, 0.03, 0.04, 0.09, 0.05, 0.04, DARK),
        ]
      : [
          tb(v(-0.36, 0.13, 0.08), v(0.36, 0.13, 0.08), 0.017, CHROME),
          box(0.06, 0.05, 0.12, 0.34, 0.13, 0.1, "#24242a"),
          box(0.06, 0.05, 0.12, -0.34, 0.13, 0.1, "#24242a"),
          // Leviers, rétroviseurs ronds, deux compteurs.
          ...[-1, 1].flatMap((s) => [
            box(0.16, 0.012, 0.025, s * 0.27, 0.13, 0.0, CHROME),
            tb(v(s * 0.26, 0.14, 0.06), v(s * 0.3, 0.22, 0.04), 0.008, CHROME),
            zDisc(0.045, 0.02, s * 0.3, 0.25, 0.04, DARK, 8),
            box(0.075, 0.035, 0.075, s * 0.05, 0.07, 0.0, DARK),
            box(0.06, 0.006, 0.06, s * 0.05, 0.09, 0.0, "#efe3c8"),
          ]),
          // Phare rond : coquille chromée, verre ; clignotants de chaque côté.
          zDisc(0.11, 0.13, 0, -0.07, -0.15, CHROME, 12),
          zDisc(0.095, 0.02, 0, -0.07, -0.222, LIGHT, 12),
          ...[-1, 1].flatMap((s) => [tb(v(s * 0.08, -0.1, -0.1), v(s * 0.17, -0.1, -0.12), 0.008, DARK), zDisc(0.025, 0.05, s * 0.18, -0.1, -0.13, AMBER, 8)]),
        ]),
    // Garde-boue avant.
    fender(front.y, front.z, WHEEL_R + 0.035, sport ? 0.6 : 0.35, sport ? 1.9 : 2.2, 0.13, 0.018, color),
  ]);
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
  const fw = mesh(wheelFor(0.055, sport));
  fw.position.copy(front);
  steerMesh.add(fw);
  steer.add(steerMesh);
  const rw = mesh(wheelFor(sport ? 0.075 : 0.055, sport));
  rw.position.set(0, WHEEL_R, REAR_Z);
  group.add(mesh(frameGeo), steer, rw);
  // Poignées dans les mains, plante des pieds sur le repose-pieds.
  const anchors = {
    gripL: sport ? marker(steerMesh, -0.22, -0.04, 0.18) : marker(steerMesh, -0.34, 0.13, 0.1),
    gripR: sport ? marker(steerMesh, 0.22, -0.04, 0.18) : marker(steerMesh, 0.34, 0.13, 0.1),
    footL: marker(group, -0.26, sport ? 0.475 : 0.375, sport ? 0.3 : 0.12), footR: marker(group, 0.26, sport ? 0.475 : 0.375, sport ? 0.3 : 0.12),
  };

  return {
    group,
    seat: sport ? v(0, 0.88, 0.3) : v(0, 0.93, 0.22),
    pose: sport ? "tuck" : "seat",
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
