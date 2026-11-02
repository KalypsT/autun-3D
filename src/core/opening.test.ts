import { describe, expect, it } from "vitest";
import { isOpen, openingTable, scheduleOf, SCHEDULES } from "./opening";

const MON = 0, WED = 2, SUN = 6;

describe("heures d'ouverture (D200)", () => {
  it("une boulangerie ouvre tôt, et le dimanche matin seulement", () => {
    const b = scheduleOf("bakery");
    expect(isOpen(b, WED, 7.5)).toBe(true);
    expect(isOpen(b, WED, 20)).toBe(false);
    expect(isOpen(b, SUN, 9)).toBe(true);
    expect(isOpen(b, SUN, 15)).toBe(false);
  });

  it("une boutique est fermée le dimanche et le lundi matin, ouverte l'après-midi", () => {
    const s = scheduleOf("clothes");
    expect(isOpen(s, SUN, 15)).toBe(false);
    expect(isOpen(s, MON, 10)).toBe(false);
    expect(isOpen(s, MON, 15)).toBe(true);
    expect(isOpen(s, WED, 10)).toBe(true);
    expect(isOpen(s, WED, 19.5)).toBe(false);
  });

  it("un bar reste ouvert après minuit (la plage déborde sur le lendemain)", () => {
    const b = scheduleOf("bar");
    expect(isOpen(b, WED, 23.5)).toBe(true);
    expect(isOpen(b, 3, 0.5)).toBe(true);
    expect(isOpen(b, 3, 2)).toBe(false);
  });

  it("restaurant : midi et soir, fermé le lundi ; pharmacie : coupure de midi", () => {
    const r = scheduleOf("restaurant"), p = scheduleOf("pharmacy");
    expect(isOpen(r, WED, 12.5)).toBe(true);
    expect(isOpen(r, WED, 16)).toBe(false);
    expect(isOpen(r, WED, 20)).toBe(true);
    expect(isOpen(r, MON, 20)).toBe(false);
    expect(isOpen(p, WED, 13)).toBe(false);
    expect(isOpen(p, WED, 15)).toBe(true);
  });

  it("genres inconnus : boutique ; table pour le nuanceur", () => {
    expect(scheduleOf("antiques")).toBe(scheduleOf(null));
    const t = openingTable(WED, 10);
    expect(t.length).toBe(SCHEDULES.length);
    expect(t[scheduleOf("vacant")]).toBe(0);
    expect(t[scheduleOf("hospital")]).toBe(1);
    expect(SCHEDULES.length).toBeLessThanOrEqual(12);
  });
});
