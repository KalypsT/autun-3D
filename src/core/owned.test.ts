import { describe, expect, it } from "vitest";
import { GENDARMERIE, INSURANCE_HOURS, MAX_OWNED, OwnedVehicles, parseOwned, VEHICLE_PRICES } from "./owned";
import { vehicleDef } from "./vehicle-catalog";

describe("véhicules achetés (D323)", () => {
  it("six au plus, identifiants stables, prêts à être livrés", () => {
    const g = new OwnedVehicles();
    for (let i = 0; i < MAX_OWNED; i++) expect(g.buy("citadine", 2, "osm:node/1")?.id).toBe(`achat-${i + 1}`);
    expect(g.buy("vtt", 0, "osm:node/2")).toBeNull();
    expect(g.get("achat-3")?.status).toBe("ready");
    g.delivered("achat-3");
    expect(g.get("achat-3")?.status).toBe("ok");
  });

  it("détruit : l'assurance le rend une heure de jeu plus tard ; confisqué : la fourrière, puis livré à la gendarmerie", () => {
    const g = new OwnedVehicles();
    const o = g.buy("berline", 1, "osm:node/1")!;
    g.delivered(o.id);
    g.wreck(o.id, 100);
    expect(o.status).toBe("wreck");
    g.update(100 + INSURANCE_HOURS - 0.1);
    expect(o.status).toBe("wreck");
    g.update(100 + INSURANCE_HOURS);
    expect(o.status).toBe("ready");
    expect(o.deliver).toBe("osm:node/1");
    g.delivered(o.id);
    g.impound(o.id);
    expect(o.status).toBe("impound");
    g.release(o.id);
    expect(o).toMatchObject({ status: "ready", deliver: GENDARMERIE });
  });

  it("sauvegarde : aller-retour ; modèles inconnus, identifiants douteux et doublons écartés", () => {
    const g = new OwnedVehicles();
    g.buy("sportive", 3, "osm:node/9");
    const back = parseOwned(JSON.parse(JSON.stringify(g.toSave())))!;
    expect(back).toEqual(g.toSave());
    expect(parseOwned([{ id: "achat-1", model: "supercar", variant: 0, deliver: "x", status: "ok" }, { id: "x", model: "vtt", variant: 0, deliver: "x", status: "ok" },
      { id: "achat-2", model: "vtt", variant: 0, deliver: "x", status: "ok" }, { id: "achat-2", model: "vtt", variant: 0, deliver: "x", status: "ok" }])).toEqual([
      { id: "achat-2", model: "vtt", variant: 0, deliver: "x", status: "ok" }]);
    expect(parseOwned("x")).toBeNull();
  });

  it("chaque véhicule à vendre existe au catalogue, n'est ni unique, ni de police, ni de service", () => {
    for (const id of Object.keys(VEHICLE_PRICES)) {
      const d = vehicleDef(id);
      expect(d, id).toBeTruthy();
      expect(!!(d!.unique || d!.police || d!.service || d!.train), id).toBe(false);
    }
  });
});
