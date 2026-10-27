import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Colliders } from "../core/collision";
import { flatTerrain } from "../core/testing";
import { Fleet } from "./vehicles";

const make = (): Fleet => new Fleet(new THREE.Scene(), new Colliders(), flatTerrain());

describe("véhicules et sauvegarde", () => {
  it("seuls les véhicules déplacés (ou conduits) sont enregistrés", () => {
    const fleet = make();
    const a = fleet.add("bike", "velo-1-0", 0, 0, 0, 1);
    fleet.add("car", "voiture-5,5", 20, 0, 1, 2);
    expect(fleet.savedVehicles()).toEqual([]);
    a.state.x = 12;
    a.state.y = -3;
    const saved = fleet.savedVehicles();
    expect(saved).toEqual([{ id: "velo-1-0", kind: "bike", variant: 1, x: 12, y: -3, heading: 0 }]);
    a.state.x = 0.2;
    a.state.y = 0;
    expect(fleet.savedVehicles()).toEqual([]);
    a.ridden = true;
    expect(fleet.savedVehicles()).toHaveLength(1);
  });

  it("un véhicule retrouvé n'est pas recréé à sa place d'origine quand sa tuile se charge, et reste à enregistrer", () => {
    const first = make();
    const v = first.add("scooter", "trottinette-9-3", 5, 5, 0, 4);
    v.state.x = 40;
    v.state.y = 41;
    const saved = first.savedVehicles();

    const second = make();
    second.restore(saved);
    const again = second.add("scooter", "trottinette-9-3", 5, 5, 0, 4);
    expect(again.state.x).toBe(40);
    expect(second.vehicles).toHaveLength(1);
    // Son origine est inconnue : il est enregistré à chaque fois, même s'il n'a plus bougé depuis.
    expect(second.savedVehicles()).toHaveLength(1);
    expect(second.get("trottinette-9-3")).toBe(again);
    expect(second.get("inconnu")).toBeNull();
  });
});
