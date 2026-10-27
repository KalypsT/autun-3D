import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CATALOG, vehicleDef } from "../core/vehicle-catalog";
import { bodyDetailGeometry, bodyPaintGeometry, carLayout, loft, parkedDetailGeometry } from "./car-body";
import { CAR_BODIES, carRestGeometry } from "./car-model";
import { bakeRest, ParkedModels, tintPaintOnly } from "./parked-models";
import { buildModel, restGeometryOf } from "../game/vehicles";

const triangles = (g: THREE.BufferGeometry): number => g.getAttribute("position").count / 3;

/** Volume signé (théorème de la divergence) : positif quand les faces regardent vers l'extérieur. */
function signedVolume(g: THREE.BufferGeometry): number {
  const p = g.getAttribute("position");
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

const cars = CATALOG.filter((d) => d.family === "car");

describe("générateur de carrosserie", () => {
  it("chaque voiture du catalogue a ses mesures, et chaque mesure sa voiture", () => {
    expect(cars.map((d) => d.id).sort()).toEqual(Object.keys(CAR_BODIES).sort());
  });

  it.each(cars.map((d) => d.id))("%s : le modèle respecte le gabarit du catalogue, avec les roues au sol", (id) => {
    const def = vehicleDef(id)!, p = CAR_BODIES[id]!, { front, rear } = def.spec;
    const box = new THREE.Box3();
    for (const g of [bodyPaintGeometry(p, front, rear, "#ffffff"), parkedDetailGeometry(p, front, rear)]) {
      g.computeBoundingBox();
      box.union(g.boundingBox!);
    }
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(def.size.width, 1);
    expect(size.y).toBeCloseTo(def.size.height, 1);
    expect(size.z).toBeCloseTo(def.size.length, 1);
    expect(box.min.y).toBeCloseTo(0, 1); // pneus à facettes : un à deux centimètres au-dessus du sol
    // Les essieux sont à leur place par rapport au centre de gravité de la fiche.
    const { wheels, noseZ } = carLayout(p, front, rear);
    expect(wheels[0]![1]).toBeCloseTo(-front);
    expect(wheels[2]![1]).toBeCloseTo(rear);
    expect(box.min.z).toBeCloseTo(noseZ, 2);
  });

  it.each(cars.map((d) => d.id))("%s : faces vers l'extérieur, et un nombre de triangles raisonnable", (id) => {
    const def = vehicleDef(id)!, p = CAR_BODIES[id]!, { front, rear } = def.spec;
    const paint = bodyPaintGeometry(p, front, rear, "#ffffff"), glass = bodyDetailGeometry(p, front, rear);
    expect(signedVolume(paint)).toBeGreaterThan(1);
    expect(triangles(paint)).toBeLessThan(250);
    expect(triangles(parkedDetailGeometry(p, front, rear))).toBeLessThan(700);
    expect(triangles(glass)).toBeGreaterThan(0);
  });

  it("une tranche en volume : un cube donne douze triangles et le volume attendu, vers l'extérieur", () => {
    const g = loft([{ z: -1, y0: 0, y1: 2, w0: 1, w1: 1 }, { z: 1, y0: 0, y1: 2, w0: 1, w1: 1 }], "#ffffff");
    expect(triangles(g)).toBe(12);
    expect(signedVolume(g)).toBeCloseTo(8, 5);
  });
});

describe("véhicules garés par instances", () => {
  const car = (x: number, color = "#d9472b", model = "citadine") => ({ model, x, y: 0, z: 0, heading: 0, pitch: 0, color });

  it("un modèle absent de la zone ne coûte rien ; un modèle présent coûte un maillage, quel que soit le nombre d'exemplaires", () => {
    const parked = new ParkedModels(10, carRestGeometry);
    expect(parked.drawn).toBe(0);
    parked.set([car(0), car(5), car(10)]);
    expect(parked.drawn).toBe(1);
    expect(parked.instances).toBe(3);
    expect((parked.group.children[0] as THREE.InstancedMesh).count).toBe(3);
    parked.set([car(0, "#2a6f7e", "berline"), car(5)]);
    expect(parked.drawn).toBe(2);
    parked.set([]);
    expect(parked.drawn).toBe(0);
    expect(parked.group.children.every((m) => !m.visible)).toBe(true);
  });

  it("les maillages préparés d'avance restent cachés tant qu'aucun exemplaire n'est dessiné", () => {
    const parked = new ParkedModels(10, carRestGeometry);
    parked.prepare(["citadine", "berline"]);
    expect(parked.group.children).toHaveLength(2);
    expect(parked.group.children.every((m) => !m.visible)).toBe(true);
    expect(parked.drawn).toBe(0);
    parked.set([car(0)]);
    expect(parked.group.children.filter((m) => m.visible)).toHaveLength(1);
  });

  it("au-delà de la capacité d'un modèle, les exemplaires en trop sont ignorés ; un modèle inconnu est refusé", () => {
    const parked = new ParkedModels(2, carRestGeometry);
    parked.set([car(0), car(1), car(2), car(3)]);
    expect((parked.group.children[0] as THREE.InstancedMesh).count).toBe(2);
    expect(() => parked.set([car(0, "#fff", "char-d-assaut")])).toThrow();
  });
});

describe("géométrie au repos de chaque modèle garé", () => {
  const whiteShare = (g: THREE.BufferGeometry): number => {
    const c = g.getAttribute("color");
    let white = 0;
    for (let i = 0; i < c.count; i++) if (c.getX(i) > 0.999 && c.getY(i) > 0.999 && c.getZ(i) > 0.999) white++;
    return white / c.count;
  };

  it.each(CATALOG.map((d) => d.id))("%s : une seule géométrie, avec de la peinture à teinter (sommets blancs) et des pièces de couleur propre", (id) => {
    const g = restGeometryOf(id);
    expect(triangles(g)).toBeGreaterThan(100);
    expect(triangles(g)).toBeLessThan(2500);
    expect(whiteShare(g)).toBeGreaterThan(0.05);
    expect(whiteShare(g)).toBeLessThan(0.7);
    g.computeBoundingBox();
    const def = vehicleDef(id)!, size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(Math.abs(size.z - def.size.length)).toBeLessThan(0.1);
    expect(Math.abs(size.y - def.size.height)).toBeLessThan(0.1);
  });

  it("cuire un modèle articulé donne les mêmes triangles que ses pièces, et le libère", () => {
    const model = buildModel(vehicleDef("moto-sportive")!, 0);
    let pieces = 0;
    model.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) pieces += triangles((o as THREE.Mesh).geometry); });
    expect(triangles(bakeRest(model))).toBe(pieces);
  });

  it("la teinte ne touche que la peinture : le nuanceur de Three.js contient toujours la ligne qu'on remplace", () => {
    expect(THREE.ShaderChunk["color_vertex"]).toContain("vColor.rgb *= instanceColor.rgb;");
    const shader = { vertexShader: THREE.ShaderChunk["color_vertex"] } as THREE.WebGLProgramParametersWithUniforms;
    const material = tintPaintOnly(new THREE.MeshLambertMaterial({ vertexColors: true }));
    material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).not.toContain("vColor.rgb *= instanceColor.rgb;");
    expect(shader.vertexShader).toContain("step( 0.999");
  });
});
