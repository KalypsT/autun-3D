import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Colliders } from "../core/collision";
import { flatTerrain } from "../core/testing";
import { CATALOG } from "../core/vehicle-catalog";
import { buildModel, chaseOf, Fleet, MODEL_BUILDERS } from "./vehicles";
import { vehicleDef } from "../core/vehicle-catalog";

const make = (): Fleet => new Fleet(new THREE.Scene(), new Colliders(), flatTerrain());

describe("véhicules et sauvegarde", () => {
  it("seuls les véhicules déplacés (ou conduits) sont enregistrés", () => {
    const fleet = make();
    const a = fleet.add("velo-ville", "velo-1-0", 0, 0, 0, 1);
    fleet.add("citadine", "voiture-5,5", 20, 0, 1, 2);
    expect(fleet.savedVehicles()).toEqual([]);
    a.state.x = 12;
    a.state.y = -3;
    const saved = fleet.savedVehicles();
    expect(saved).toEqual([{ id: "velo-1-0", model: "velo-ville", variant: 1, x: 12, y: -3, heading: 0 }]);
    a.state.x = 0.2;
    a.state.y = 0;
    expect(fleet.savedVehicles()).toEqual([]);
    a.ridden = true;
    expect(fleet.savedVehicles()).toHaveLength(1);
  });

  it("un véhicule retrouvé n'est pas recréé à sa place d'origine quand sa tuile se charge, et reste à enregistrer", () => {
    const first = make();
    const v = first.add("trottinette", "trottinette-9-3", 5, 5, 0, 4);
    v.state.x = 40;
    v.state.y = 41;
    const saved = first.savedVehicles();

    const second = make();
    second.restore(saved);
    const again = second.add("trottinette", "trottinette-9-3", 5, 5, 0, 4);
    expect(again.state.x).toBe(40);
    expect(second.vehicles).toHaveLength(1);
    // Son origine est inconnue : il est enregistré à chaque fois, même s'il n'a plus bougé depuis.
    expect(second.savedVehicles()).toHaveLength(1);
    expect(second.get("trottinette-9-3")).toBe(again);
    expect(second.get("inconnu")).toBeNull();
  });
});

describe("catalogue et dessin", () => {
  it("chaque modèle du catalogue a son dessin, de chaque couleur de sa palette", () => {
    expect(Object.keys(MODEL_BUILDERS).sort()).toEqual(CATALOG.map((d) => d.id).sort());
    for (const d of CATALOG) {
      for (let variant = 0; variant < d.palette.length; variant++) {
        const m = buildModel(d, variant);
        expect(m.group.children.length).toBeGreaterThan(0);
        m.dispose();
      }
    }
  });

  it("un modèle inconnu est refusé, et une voiture garée n'a pas de modèle articulé avant qu'on y monte", () => {
    const fleet = make();
    expect(() => fleet.add("char-d-assaut", "x", 0, 0, 0, 0)).toThrow();
    const car = fleet.add("citadine", "voiture-1,1", 0, 0, 0, 3);
    expect(car.model).toBeNull();
    expect(car.family).toBe("car");
    expect(fleet.take(car)).toBe(car.model);
  });
});

describe("caméra de poursuite par modèle", () => {
  it("la citadine garde celle de sa famille ; une camionnette est plus loin et plus haut, une sportive plus près et plus basse", () => {
    const cam = (id: string) => chaseOf({ def: vehicleDef(id)! });
    const base = cam("citadine");
    expect(base).toEqual({ distance: 6.2, perSpeed: 0.06, height: 0.55 });
    expect(cam("camionnette").distance).toBeGreaterThan(base.distance + 1);
    expect(cam("camionnette").height).toBeGreaterThan(base.height);
    expect(cam("sportive").height).toBeLessThan(base.height);
    expect(cam("moto-routiere")).toEqual(chaseOf({ def: vehicleDef("moto-routiere")! }));
  });
});

describe("véhicules garés selon le quartier (D55)", () => {
  /** Un parking de `n` places côte à côte : deux traits de 4,8 m tous les 2,5 m. */
  const lot = (n: number, x0: number): number[][][] =>
    Array.from({ length: n + 1 }, (_, i) => [[x0 + i * 2.5 - 0.05, 0, x0 + i * 2.5 + 0.05, 0, x0 + i * 2.5 + 0.05, 4.8, x0 + i * 2.5 - 0.05, 4.8]]);
  const tile = (buildings: number, x0: number, id = "t") => ({ id, buildings, furniture: [], stairs: [], marks: lot(600, x0) });
  const models = (fleet: Fleet, prefix: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const v of fleet.vehicles) if (v.id.startsWith(prefix)) out[v.def.id] = (out[v.def.id] ?? 0) + 1;
    return out;
  };

  it("un grand parking de centre-ville mêle les huit modèles de voiture, avec peu de sportives", () => {
    const fleet = make();
    fleet.addFromTile(tile(200, 0));
    const cars = models(fleet, "voiture-");
    const total = Object.values(cars).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(120);
    expect(Object.keys(cars).length).toBeGreaterThanOrEqual(7);
    expect((cars["sportive"] ?? 0) / total).toBeLessThan(0.06);
    expect(Object.keys(cars).every((id) => CATALOG.find((d) => d.id === id)?.family === "car")).toBe(true);
    expect(Object.keys(models(fleet, "moto-")).every((id) => CATALOG.find((d) => d.id === id)?.family === "moto")).toBe(true);
  });

  it("le même parking en périphérie a plus de camionnettes qu'en centre-ville ; la tuile qui se recharge ne change rien", () => {
    const centre = make(), outskirts = make();
    centre.addFromTile(tile(200, 0));
    outskirts.addFromTile(tile(10, 0));
    expect(models(outskirts, "voiture-")["camionnette"]!).toBeGreaterThan(models(centre, "voiture-")["camionnette"]!);
    const before = centre.vehicles.length;
    centre.addFromTile(tile(200, 0));
    expect(centre.vehicles).toHaveLength(before);
  });

  it("un modèle garé reste le même véhicule dans la sauvegarde (identifiant et modèle)", () => {
    const fleet = make();
    fleet.addFromTile(tile(10, 0));
    const van = fleet.vehicles.find((v) => v.def.id === "camionnette")!;
    van.state.x += 30;
    const saved = fleet.savedVehicles().find((v) => v.id === van.id)!;
    expect(saved.model).toBe("camionnette");
    const again = make();
    again.restore([saved]);
    again.addFromTile(tile(200, 0));
    expect(again.get(van.id)!.def.id).toBe("camionnette");
  });
});

describe("modèle articulé seulement à la conduite", () => {
  it("un vélo garé est une instance : il reçoit son modèle quand on le prend, le perd quand on le pose", () => {
    const scene = new THREE.Scene();
    const fleet = new Fleet(scene, new Colliders(), flatTerrain());
    const bike = fleet.add("velo-ville", "velo-1-0", 0, 0, 0, 2);
    const before = scene.children.length;
    expect(bike.model).toBeNull();
    const model = fleet.take(bike);
    expect(bike.model).toBe(model);
    expect(scene.children.length).toBe(before + 1);
    fleet.park(bike);
    expect(bike.model).toBeNull();
    expect(scene.children.length).toBe(before);
  });

  it("les véhicules proches sont dessinés en un maillage par modèle, ceux qu'on conduit n'y sont plus, les lointains non plus", () => {
    const fleet = new Fleet(new THREE.Scene(), new Colliders(), flatTerrain());
    fleet.add("citadine", "c1", 0, 0, 0, 0);
    fleet.add("citadine", "c2", 5, 0, 0, 1);
    fleet.add("berline", "b1", 10, 0, 0, 0);
    fleet.add("moto-sportive", "m1", 15, 0, 0, 0);
    const far = fleet.add("scooter-125", "s-far", 90, 0, 0, 0);
    fleet.cull(0, 0);
    expect(fleet.stats).toMatchObject({ total: 5, drawn: 5, meshes: 4 });
    fleet.take(fleet.get("c1")!);
    fleet.cull(0, 0);
    expect(fleet.stats).toMatchObject({ drawn: 4, meshes: 4 });
    far.state.x = 400;
    fleet.park(far);
    fleet.cull(0, 0);
    expect(fleet.stats).toMatchObject({ drawn: 3, meshes: 3 });
  });
});

