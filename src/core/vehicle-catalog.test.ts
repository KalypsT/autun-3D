import { describe, expect, it } from "vitest";
import { BIKE, CAR, MOTO, SCOOTER } from "./vehicle";
import { CATALOG, defProblems, FAMILIES, LEGACY_MODELS, paletteColor, vehicleDef } from "./vehicle-catalog";

describe("catalogue de véhicules", () => {
  it("identifiants uniques, et chaque entrée est valable (fiche, vitesses, coque, palette)", () => {
    expect(new Set(CATALOG.map((d) => d.id)).size).toBe(CATALOG.length);
    for (const d of CATALOG) expect([d.id, defProblems(d)]).toEqual([d.id, []]);
  });

  it("les quatre premiers modèles gardent exactement les fiches d'avant le catalogue", () => {
    expect(vehicleDef("velo-ville")!.spec).toBe(BIKE);
    expect(vehicleDef("trottinette")!.spec).toBe(SCOOTER);
    expect(vehicleDef("citadine")!.spec).toBe(CAR);
    expect(vehicleDef("moto-routiere")!.spec).toBe(MOTO);
  });

  it("chaque famille a ses réglages d'interface, et chaque entrée une famille connue", () => {
    for (const d of CATALOG) expect(FAMILIES[d.family]).toBeDefined();
    expect(Object.keys(FAMILIES).sort()).toEqual(["bike", "car", "kickscooter", "moto"]);
  });

  it("une entrée sans coque ou aux vitesses incohérentes est refusée", () => {
    const d = vehicleDef("citadine")!;
    expect(defProblems({ ...d, spec: { ...CAR, hull: [] } })).toContain("coque");
    expect(defProblems({ ...d, spec: { ...CAR, topSpeed: 10 } })).toContain("vitesses");
    expect(defProblems({ ...d, palette: [] })).toContain("palette");
    expect(defProblems({ ...d, family: "moto" })).toContain("inclinaison (deux-roues seulement)");
  });

  it("chaque véhicule a une marque et un nom de modèle, jamais deux fois le même (affichés en montant, D107, D108)", () => {
    expect(CATALOG.every((d) => d.badge && d.badge.make.length > 0 && d.badge.model.length > 0)).toBe(true);
    expect(new Set(CATALOG.map((d) => `${d.badge!.make} ${d.badge!.model}`)).size).toBe(CATALOG.length);
  });

  it("la couleur d'une variante reste dans la palette, quel que soit le numéro", () => {
    const d = vehicleDef("citadine")!;
    for (const v of [0, 1, 6, 7, 15, -3, 2.7]) expect(d.palette).toContain(paletteColor(d, v));
    expect(paletteColor(d, 0)).toBe(paletteColor(d, 7));
  });

  it("les anciens noms (types de la version 1, ?ride=) pointent des modèles qui existent", () => {
    for (const id of Object.values(LEGACY_MODELS)) expect(vehicleDef(id)).toBeDefined();
  });
});
