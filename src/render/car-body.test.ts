import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CATALOG, vehicleDef } from "../core/vehicle-catalog";
import { bodyDetailGeometry, bodyPaintGeometry, carLayout, loft, parkedDetailGeometry } from "./car-body";
import { CAR_BODIES, ParkedCars } from "./car-model";

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

describe("voitures garées par instances", () => {
  const car = (x: number, color = "#d9472b") => ({ model: "citadine", x, y: 0, z: 0, heading: 0, pitch: 0, color });

  it("un modèle absent de la zone ne coûte rien ; un modèle présent coûte deux maillages, quel que soit le nombre d'exemplaires", () => {
    const parked = new ParkedCars(10);
    expect(parked.drawn).toBe(0);
    parked.set([car(0), car(5), car(10)]);
    expect(parked.drawn).toBe(2);
    expect(parked.group.children.every((m) => (m as THREE.InstancedMesh).count === 3)).toBe(true);
    parked.set([]);
    expect(parked.drawn).toBe(0);
    expect(parked.group.children.every((m) => !m.visible)).toBe(true);
  });

  it("au-delà de la capacité d'un modèle, les exemplaires en trop sont ignorés ; un modèle inconnu est refusé", () => {
    const parked = new ParkedCars(2);
    parked.set([car(0), car(1), car(2), car(3)]);
    expect((parked.group.children[0] as THREE.InstancedMesh).count).toBe(2);
    expect(() => parked.set([{ ...car(0), model: "char-d-assaut" }])).toThrow();
  });
});
