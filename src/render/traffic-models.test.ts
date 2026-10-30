import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createVehicle, type VehicleState } from "../core/vehicle";
import { CATALOG } from "../core/vehicle-catalog";
import { CAR_BODIES, createCarModel } from "./car-model";
import { bodyOnlyGeometry, TrafficModels, type TrafficItem } from "./traffic-models";

const flat = { heightAt: () => 0, xMin: -1e4, xMax: 1e4, yMin: -1e4, yMax: 1e4 };
// Les véhicules uniques (D114) ne roulent jamais dans la circulation.
const cars = CATALOG.filter((d) => d.family === "car" && !d.unique);

function stateAt(x: number, y: number, heading: number): VehicleState {
  const s = createVehicle(x, y, heading, flat);
  s.pitch = 0.04;
  s.lean = -0.03;
  s.steer = 0.2;
  s.wheel = 1.3;
  s.z = 2;
  return s;
}

const itemOf = (id: string, s: VehicleState, color = "#c0392b"): TrafficItem => ({ model: id, x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: s.pitch, lean: s.lean, steer: s.steer, wheel: s.wheel, color });

function max(a: THREE.Matrix4, b: THREE.Matrix4): number {
  let m = 0;
  for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(a.elements[i]! - b.elements[i]!));
  return m;
}

describe("voitures qui roulent, par instances (J3-5)", () => {
  it("place la caisse et les quatre roues exactement comme le modèle articulé (position, braquage, rotation, roulis), pour toutes les voitures", () => {
    for (const def of cars) {
      const s = stateAt(120.5, -43.25, 0.7);
      const articulated = createCarModel(def.id, "#c0392b");
      articulated.update(s);
      articulated.group.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      articulated.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      // Ordre de construction : caisse (peinture), détails, puis quatre roues.
      expect(meshes).toHaveLength(6);
      const models = new TrafficModels();
      models.set([itemOf(def.id, s)]);
      const slot = (models as unknown as { slots: Map<string, { mesh: THREE.InstancedMesh }> }).slots.get(def.id)!;
      const m = new THREE.Matrix4();
      slot.mesh.getMatrixAt(0, m);
      expect(max(m, meshes[0]!.matrixWorld)).toBeLessThan(1e-4);
      const wheels = (models as unknown as { wheels: THREE.InstancedMesh }).wheels;
      const p = CAR_BODIES[def.id]!;
      const scale = new THREE.Matrix4().makeScale(p.tyreWidth, p.wheelRadius, p.wheelRadius);
      for (let k = 0; k < 4; k++) {
        wheels.getMatrixAt(k, m);
        const expected = meshes[2 + k]!.matrixWorld.clone().multiply(scale);
        expect([def.id, k, max(m, expected) < 1e-4]).toEqual([def.id, k, true]);
      }
      models.dispose();
      articulated.dispose();
    }
  });

  it("dessine 24 voitures de tous les modèles avec un maillage par modèle et un de roues le jour, plus les feux la nuit, contre 144 pour des modèles articulés", () => {
    const models = new TrafficModels();
    models.prepare(cars.map((c) => c.id));
    const items: TrafficItem[] = [];
    for (let i = 0; i < 24; i++) items.push(itemOf(cars[i % cars.length]!.id, stateAt(i * 9, (i % 5) * 4, i * 0.3), i % 2 ? "#2e7d32" : "#f5f5f5"));
    models.set(items);
    expect(models.instances).toBe(24);
    expect(models.drawn).toBe(cars.length + 1);
    models.setNight(1);
    expect(models.drawn).toBe(cars.length + 2);
    // Avec les ombres : deux fois plus d'appels de dessin, jamais plus de (modèles + roues) × 2 + feux.
    expect((models.drawn - 1) * 2 + 1).toBeLessThanOrEqual(21);
    const visible: THREE.Object3D[] = [];
    models.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.visible) visible.push(o);
    });
    expect(visible).toHaveLength(models.drawn);
    // Un modèle absent ne coûte rien.
    models.set(items.filter((c) => c.model === "citadine"));
    expect(models.drawn).toBe(3);
    models.set([]);
    expect(models.drawn).toBe(0);
    models.dispose();
  });

  it("gyrophares (J4) : un seul maillage pour toutes les voitures de police en poursuite, sans ombre, posé sur la barre du toit, qui clignote ; rien sans poursuite", () => {
    const models = new TrafficModels();
    models.prepare(["gendarmerie", "citadine"]);
    const beacons = (models as unknown as { beacons: THREE.InstancedMesh }).beacons;
    const s = stateAt(10, 20, 0.4);
    models.set([itemOf("gendarmerie", s), itemOf("citadine", stateAt(30, 20, 0))]);
    expect(beacons.visible).toBe(false);
    const quiet = models.drawn;
    const patrols = [0, 1, 2].map((k) => ({ ...itemOf("gendarmerie", stateAt(10 + k * 8, 20, 0.4)), beacon: 0 }));
    models.set([...patrols, itemOf("citadine", stateAt(30, 20, 0))]);
    expect(beacons.visible).toBe(true);
    expect(beacons.castShadow).toBe(false);
    expect(beacons.count).toBe(6);
    // Trois voitures de police allumées : un maillage de plus, pas trois.
    expect(models.drawn).toBe(quiet + 1);
    // Les feux sont au-dessus du toit de la voiture.
    const m = new THREE.Matrix4(), pos = new THREE.Vector3();
    beacons.getMatrixAt(0, m);
    pos.setFromMatrixPosition(m);
    expect(pos.y - s.z).toBeGreaterThan(CAR_BODIES.gendarmerie!.height);
    expect(pos.y - s.z).toBeLessThan(CAR_BODIES.gendarmerie!.height + 0.12);
    // Clignotement : l'un puis l'autre feu, quatre fois par seconde.
    const c0 = new THREE.Color(), c1 = new THREE.Color();
    beacons.getColorAt(0, c0);
    models.set([{ ...patrols[0]!, beacon: 0.3 }]);
    beacons.getColorAt(0, c1);
    expect(c0.equals(c1)).toBe(false);
    models.dispose();
  });

  it("les feux sont éteints le jour (opacité nulle, invisibles) et suivent la nuit", () => {
    const models = new TrafficModels();
    const lamps = (models as unknown as { lampMaterial: THREE.MeshBasicMaterial }).lampMaterial;
    expect(lamps.visible).toBe(false);
    models.setNight(0);
    expect(lamps.visible).toBe(false);
    models.setNight(0.6);
    expect(lamps.visible).toBe(true);
    expect(lamps.opacity).toBeCloseTo(0.6);
    models.dispose();
  });

  it("une voiture instanciée coûte moins de triangles qu'articulée (roues à 12 facettes au lieu de 14), et la caisse seule moins qu'au repos garé", () => {
    let instanced = 0, articulated = 0;
    for (const def of cars) {
      const body = bodyOnlyGeometry(def.id);
      expect(body.getAttribute("color")).toBeDefined();
      instanced += body.getAttribute("position").count / 3;
      const a = createCarModel(def.id, "#ffffff");
      a.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) articulated += mesh.geometry.getAttribute("position").count / 3;
      });
      a.dispose();
    }
    expect(instanced).toBeLessThan(articulated);
  });

  it("ne dépasse pas ses capacités : au plus 64 exemplaires d'un modèle, au plus 128 voitures", () => {
    const models = new TrafficModels();
    const items: TrafficItem[] = [];
    for (let i = 0; i < 300; i++) items.push(itemOf(cars[i % 3]!.id, stateAt(i, 0, 0)));
    models.set(items);
    expect(models.instances).toBeLessThanOrEqual(128);
    expect(models.instances).toBeGreaterThan(100);
    models.dispose();
  });
});
