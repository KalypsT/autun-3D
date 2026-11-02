import { describe, expect, it } from "vitest";
import { activeFeasts, calendarAt, calendarLabel, dateFromDoy, dateFromParams, newGameDate, rescaleDate, seasonDoy } from "./calendar";

const P = (q: string): URLSearchParams => new URLSearchParams(q);

describe("calendrier du jeu", () => {
  it("semaine et saisons de 7 jours : lundi 0, été à partir du 7e jour, l'année fait 28 jours", () => {
    expect(calendarAt(0, 10)).toMatchObject({ weekday: 0, season: 0, dayInSeason: 0 });
    expect(calendarAt(6, 10)).toMatchObject({ weekday: 6, season: 0, dayInSeason: 6 });
    expect(calendarAt(7, 10)).toMatchObject({ weekday: 0, season: 1, dayInSeason: 0 });
    expect(calendarAt(23, 10)).toMatchObject({ weekday: 2, season: 3, dayInSeason: 2 });
    expect(calendarAt(28, 10)).toMatchObject({ season: 0, dayInSeason: 0 });
  });

  it("saisons de 14 jours", () => {
    const c = { length: 14 as const, frozen: null };
    expect(calendarAt(13, 0, c)).toMatchObject({ season: 0, dayInSeason: 13, weekday: 6 });
    expect(calendarAt(14, 0, c)).toMatchObject({ season: 1, dayInSeason: 0, weekday: 0 });
  });

  it("jour astronomique : printemps au 20 mars, été vers le 21 juin, hiver vers le 21 décembre, et il avance avec l'heure", () => {
    expect(seasonDoy(0, 0)).toBeCloseTo(79);
    expect(seasonDoy(1, 0)).toBeCloseTo(170.25);
    expect(seasonDoy(3, 0)).toBeCloseTo(352.75);
    expect(seasonDoy(3, 0.5)).toBeCloseTo(33.375);
    expect(calendarAt(7, 12).doy).toBeGreaterThan(calendarAt(7, 0).doy);
    expect(calendarAt(7, 12).t).toBeCloseTo(0.5 / 7);
    for (let d = 0; d < 60; d++) for (const h of [0, 13.7, 23.99]) {
      const c = calendarAt(d, h);
      expect(c.doy).toBeGreaterThanOrEqual(1);
      expect(c.doy).toBeLessThan(366);
      expect(c.t).toBeLessThan(1);
    }
  });

  it("saison figée : saison et soleil fixes (milieu de la saison), la semaine tourne", () => {
    const c = { length: 7 as const, frozen: 3 as const };
    expect(calendarAt(8, 9, c)).toMatchObject({ season: 3, weekday: 1, t: 0.5 });
    expect(calendarAt(30, 21, c).doy).toBe(calendarAt(8, 9, c).doy);
  });

  it("texte sous l'horloge", () => {
    expect(calendarLabel(calendarAt(9, 10))).toBe("Mer. · Été, 3e jour");
    expect(calendarLabel(calendarAt(7, 10))).toBe("Lun. · Été, 1er jour");
    expect(calendarLabel(calendarAt(27, 10))).toBe("Dim. · Hiver, 7e jour");
  });

  it("fêtes, aux jours et aux heures du plan", () => {
    expect(activeFeasts(7, 19)).toEqual(["fete-musique"]); // été, 1er jour, 19 h
    expect(activeFeasts(8, 0.5)).toEqual(["fete-musique"]); // déborde jusqu'à 1 h
    expect(activeFeasts(8, 1.5)).toEqual([]);
    expect(activeFeasts(9, 23)).toEqual(["14-juillet"]);
    expect(activeFeasts(9, 12)).toEqual([]);
    expect(activeFeasts(20, 3)).toEqual(["illuminations"]); // automne, 7e jour
    expect(activeFeasts(21, 15)).toEqual(["illuminations", "marche-noel"]);
    expect(activeFeasts(22, 15)).toEqual(["illuminations", "marche-noel", "noel"]);
    expect(activeFeasts(23, 15)).toEqual(["illuminations"]);
    expect(activeFeasts(24, 15)).toEqual([]);
    // L'année suivante, les mêmes fêtes reviennent.
    expect(activeFeasts(28 + 9, 23)).toEqual(["14-juillet"]);
  });

  it("fêtes avec des saisons de 14 jours : une seule journée pour le 14 juillet, illuminations plus longues", () => {
    const c = { length: 14 as const, frozen: null };
    const days = (id: string): number[] => [...Array(56).keys()].filter((d) => activeFeasts(d, 23, c).includes(id as never));
    expect(days("14-juillet")).toEqual([18]);
    expect(days("illuminations").length).toBeGreaterThan(4);
    expect(days("illuminations")[0]).toBe(40);
  });

  it("nouvelle partie : été, 1er jour, un lundi", () => {
    for (const L of [7, 14] as const) expect(calendarAt(newGameDate(L), 16, { length: L, frozen: null })).toMatchObject({ season: 1, dayInSeason: 0, weekday: 0 });
  });

  it("ancienne date (jour de l'année) : un lundi de la bonne saison", () => {
    for (let doy = 1; doy <= 365; doy += 7) for (const L of [7, 14] as const) {
      const d = dateFromDoy(doy, L);
      expect(d % 7).toBe(0);
      const s = Math.floor(((doy - 79 + 365) % 365) / 91.25);
      expect(Math.floor(d / L)).toBe(s);
    }
    // 14 jours : la fin de la saison donne le 2e lundi.
    expect(dateFromDoy(160, 14)).toBe(7);
  });

  it("changer la durée des saisons garde la saison et le jour de la semaine", () => {
    for (let d = 0; d < 56; d++) {
      const r = rescaleDate(d, 7, 14);
      expect(r % 7).toBe(d % 7);
      expect(Math.floor(r / 14) % 4).toBe(Math.floor(d / 7) % 4);
      const back = rescaleDate(r, 14, 7);
      expect(back % 7).toBe(d % 7);
      expect(Math.floor(back / 7) % 4).toBe(Math.floor(d / 7) % 4);
    }
    expect(rescaleDate(10, 7, 7)).toBe(10);
  });

  it("paramètres d'URL : ?date=, ?day=, ?season=, ?weekday=", () => {
    expect(dateFromParams(P(""), 7)).toBe(7);
    expect(dateFromParams(P("date=40"), 7)).toBe(40);
    expect(dateFromParams(P("day=30"), 7)).toBe(21);
    expect(dateFromParams(P("season=hiver"), 7)).toBe(21);
    expect(dateFromParams(P("season=automne&weekday=3"), 7)).toBe(16);
    expect(dateFromParams(P("date=30&season=printemps"), 7)).toBe(28);
    expect(dateFromParams(P("weekday=7"), 7)).toBe(13);
    expect(dateFromParams(P("weekday=9&date=x"), 7)).toBe(7);
  });
});
