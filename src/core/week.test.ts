import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TileData } from "../data/types";
import { findStalls } from "./parking";
import { gateOpen } from "./school-gate";
import { crowdWeek, inMarket, marketCenter, marketLevel, massPeal, schoolOpen, trafficWeek } from "./week";
import { CATHEDRAL } from "./sound-model";

const MON = 0, WED = 2, THU = 3, FRI = 4, SAT = 5, SUN = 6;

describe("rythme de la semaine (D201)", () => {
  it("marché le mercredi et le vendredi matin : installation, plein, remballage", () => {
    expect(marketLevel(MON, 9)).toBe(0);
    expect(marketLevel(WED, 4.9)).toBe(0);
    expect(marketLevel(WED, 6)).toBeCloseTo(0.5);
    expect(marketLevel(FRI, 10)).toBe(1);
    expect(marketLevel(WED, 13)).toBeCloseTo(0.5);
    expect(marketLevel(WED, 13.6)).toBe(0);
  });

  it("le marché occupe le grand parking du Champ de Mars : ses places de stationnement y sont", () => {
    const [cx, cy] = marketCenter();
    expect(inMarket(cx, cy)).toBe(true);
    expect(inMarket(0, 0)).toBe(false);
    let n = 0;
    for (const name of readdirSync("public/data/tiles")) {
      const t = JSON.parse(readFileSync(`public/data/tiles/${name}`, "utf8")) as TileData & { ground?: { marks?: number[][][] } };
      for (const s of findStalls(t.ground?.marks ?? [])) if (inMarket(s.x, s.y)) n++;
    }
    expect(n).toBeGreaterThan(60);
  });

  it("école : lundi, mardi, jeudi, vendredi ; mercredi matin ; pas le week-end ; la grille du collège suit", () => {
    expect(schoolOpen(MON, 10)).toBe(true);
    expect(schoolOpen(WED, 10)).toBe(true);
    expect(schoolOpen(WED, 15)).toBe(false);
    expect(schoolOpen(SAT, 10)).toBe(false);
    expect(schoolOpen(THU, 19)).toBe(false);
    expect(gateOpen(10, SUN)).toBe(false);
    expect(gateOpen(10)).toBe(true);
  });

  it("foule : plus dense au marché et sur le parvis à la sortie de la messe, promeneurs du dimanche ; moins de voitures le week-end", () => {
    const [cx, cy] = marketCenter();
    expect(crowdWeek(WED, 10, cx, cy, 0)).toBeGreaterThan(2);
    expect(crowdWeek(WED, 10, cx + 400, cy, 0)).toBe(1);
    expect(crowdWeek(SUN, 11.7, CATHEDRAL.x, CATHEDRAL.y, 0)).toBeGreaterThan(2);
    expect(crowdWeek(SUN, 15, 800, 800, 3)).toBeGreaterThan(2);
    expect(crowdWeek(THU, 15, 800, 800, 3)).toBe(1);
    expect(trafficWeek(SUN)).toBeLessThan(trafficWeek(SAT));
    expect(trafficWeek(MON)).toBe(1);
  });

  it("volée de la messe le dimanche à 10 h 15, une fois", () => {
    expect(massPeal(SUN, 10.2, 10.26)).toBe(true);
    expect(massPeal(SUN, 10.26, 10.3)).toBe(false);
    expect(massPeal(SAT, 10.2, 10.26)).toBe(false);
  });
});
