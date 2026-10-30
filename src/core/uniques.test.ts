import { describe, expect, it } from "vitest";
import { onDuty, UNIQUE, UniqueKeeper, UNIQUES, type UniqueSpot, type UniqueView } from "./uniques";
import { placedModels } from "./vehicle-placement";
import { CATALOG, vehicleDef } from "./vehicle-catalog";

const evening: UniqueSpot = { id: "u", model: "jeep-militaire", x: 0, y: 0, heading: 0, hours: [17, 22] };
const night: UniqueSpot = { ...evening, hours: [22, 6] };
const view = (o: Partial<UniqueView>): UniqueView => ({ exists: true, atHome: true, usable: true, ridden: false, toVehicle: 500, toHome: 500, ...o });

describe("véhicules uniques (D114)", () => {
  it("horaires de service, y compris ceux qui passent minuit ; sans horaire, toujours là", () => {
    expect(onDuty(evening, 16.9)).toBe(false);
    expect(onDuty(evening, 17)).toBe(true);
    expect(onDuty(evening, 21.99)).toBe(true);
    expect(onDuty(evening, 22)).toBe(false);
    expect(onDuty(night, 23)).toBe(true);
    expect(onDuty(night, 3)).toBe(true);
    expect(onDuty(night, 12)).toBe(false);
    expect(onDuty({ id: "u", model: "jeep-militaire", x: 0, y: 0, heading: 0 }, 4)).toBe(true);
  });

  it("au démarrage il est là s'il est de service ; ensuite, il n'apparaît et ne disparaît que loin du joueur", () => {
    const k = new UniqueKeeper();
    expect(k.decide(evening, view({ exists: false, toHome: 10 }), 18, 0.5)).toBe("spawn");
    const k2 = new UniqueKeeper();
    expect(k2.decide(evening, view({ exists: false, toHome: 10 }), 12, 0.5)).toBeNull();
    expect(k2.decide(evening, view({ exists: false, toHome: 10 }), 18, 0.5)).toBeNull();
    expect(k2.decide(evening, view({ exists: false, toHome: 400 }), 18, 0.5)).toBe("spawn");
    expect(k2.decide(evening, view({ toVehicle: 20 }), 23, 0.5)).toBeNull();
    expect(k2.decide(evening, view({}), 23, 0.5)).toBe("despawn");
  });

  it("détruit ou laissé ailleurs, il revient à sa place au bout d'un moment loin du joueur ; pas tant qu'on le conduit ou qu'on est près", () => {
    const k = new UniqueKeeper();
    k.decide(evening, view({}), 18, 0.5);
    let t = 0;
    while (t < UNIQUE.respawn - 1) {
      expect(k.decide(evening, view({ atHome: false }), 18, 1)).toBeNull();
      t += 1;
    }
    expect(k.decide(evening, view({ atHome: false }), 18, 2)).toBe("respawn");
    // Près du joueur, le compte repart de zéro ; conduit, rien.
    expect(k.decide(evening, view({ usable: false, toVehicle: 30 }), 18, 1000)).toBeNull();
    expect(k.decide(evening, view({ usable: false }), 18, 1)).toBeNull();
    expect(k.decide(evening, view({ atHome: false, ridden: true }), 18, 1000)).toBeNull();
    // Hors service, une épave lointaine est simplement retirée.
    const k2 = new UniqueKeeper();
    k2.decide(evening, view({}), 18, 0.5);
    expect(k2.decide(evening, view({ usable: false }), 23, UNIQUE.respawn + 1)).toBe("despawn");
  });

  it("chaque véhicule unique est au catalogue, marqué unique, et jamais tiré pour les places ordinaires ni la circulation", () => {
    const placed = new Set(placedModels());
    for (const spot of UNIQUES) {
      const def = vehicleDef(spot.model);
      expect(def?.unique).toBe(true);
      expect(placed.has(spot.model)).toBe(false);
    }
    expect(new Set(UNIQUES.map((u) => u.id)).size).toBe(UNIQUES.length);
    for (const def of CATALOG.filter((d) => d.unique)) expect(UNIQUES.some((u) => u.model === def.id)).toBe(true);
  });
});
