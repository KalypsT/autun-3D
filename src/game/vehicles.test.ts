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

