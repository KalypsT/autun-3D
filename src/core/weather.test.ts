import { describe, expect, it } from "vitest";
import type { Season } from "./calendar";
import { Colliders } from "./collision";
import { crowdTarget } from "./crowd-density";
import { flatTerrain } from "./testing";
import { trafficTarget } from "./traffic-density";
import { CAR, createVehicle, setSurfaceGrip, stepVehicle } from "./vehicle";
import { crowdWeather, dayEpisodes, fixedWeather, surfaceGrip, trafficWeather, walkWeather, WEATHER_TABLE, weatherAt, weatherParam, type WeatherKind } from "./weather";

const seasonOf7 = (d: number): Season => (Math.floor(d / 7) % 4) as Season;

describe("météo : tirage", () => {
  it("épisodes de 2 à 4 heures (la brume et l'orage peuvent être écourtés), qui couvrent la journée sans trou", () => {
    for (let d = 0; d < 200; d++) {
      const eps = dayEpisodes(d, seasonOf7(d));
      expect(eps[0]!.start).toBe(0);
      expect(eps[eps.length - 1]!.end).toBeCloseTo(24);
      for (let i = 0; i < eps.length; i++) {
        const e = eps[i]!;
        if (i > 0) expect(e.start).toBeCloseTo(eps[i - 1]!.end);
        const len = e.end - e.start;
        expect(len).toBeGreaterThan(e.kind === "brume" || e.kind === "orage" ? 0.4 : 1.99);
        expect(len).toBeLessThan(6.01);
        expect(e.fade).toBeGreaterThanOrEqual(1 / 3);
        expect(e.fade).toBeLessThanOrEqual(2 / 3);
      }
    }
  });

  it("la même date donne la même météo (rien à enregistrer)", () => {
    expect(dayEpisodes(42, 2)).toEqual(dayEpisodes(42, 2));
    expect(weatherAt(42, 15.3, seasonOf7)).toEqual(weatherAt(42, 15.3, seasonOf7));
  });

  it("orage seulement le soir, brume seulement le matin, pas de neige au printemps ni en été", () => {
    for (let d = 0; d < 800; d++) {
      const s = seasonOf7(d);
      for (const e of dayEpisodes(d, s)) {
        if (e.kind === "orage") expect(e.start >= 15.5 && e.end <= 24).toBe(true);
        if (e.kind === "brume") expect(e.start >= 4.5 && e.end <= 10.5).toBe(true);
        if (e.kind === "neige") expect(s).toBe(3);
        expect(Object.keys(WEATHER_TABLE[s]!)).toContain(e.kind);
      }
    }
  });

  it("parts sur une longue période, proches du tableau (en heures)", () => {
    const hours: Record<number, Partial<Record<WeatherKind, number>>> = { 0: {}, 1: {}, 2: {}, 3: {} };
    for (let d = 0; d < 4000; d++) {
      const s = seasonOf7(d);
      for (const e of dayEpisodes(d, s)) hours[s]![e.kind] = (hours[s]![e.kind] ?? 0) + e.end - e.start;
    }
    const share = (s: number, k: WeatherKind): number => (hours[s]![k] ?? 0) / Object.values(hours[s]!).reduce((a, b) => a + b, 0);
    expect(share(1, "beau")).toBeGreaterThan(0.6);
    expect(share(1, "pluie")).toBeLessThan(0.1);
    expect(share(2, "pluie")).toBeGreaterThan(0.18);
    expect(share(2, "pluie")).toBeLessThan(0.35);
    expect(share(3, "neige")).toBeGreaterThan(0.1);
    expect(share(1, "orage")).toBeGreaterThan(0.02);
    expect(share(2, "brume")).toBeGreaterThan(0.02);
  });

  it("jamais deux jours de pluie complets d'affilée", () => {
    const allRain = (d: number): boolean => dayEpisodes(d, 2).every((e) => e.kind === "pluie");
    for (let d = 1; d < 3000; d++) expect(allRain(d) && allRain(d - 1)).toBe(false);
  });
});

describe("météo : état continu", () => {
  it("valeurs entre 0 et 1, sans saut d'une minute à l'autre (minuit compris)", () => {
    for (let d = 1; d < 30; d++) {
      let prev = weatherAt(d, 0, seasonOf7);
      for (let m = 1; m < 24 * 60; m += 1) {
        const w = weatherAt(d, m / 60, seasonOf7);
        for (const k of ["cloud", "rain", "fog", "snowfall", "snow", "wet", "storm"] as const) {
          expect(w[k]).toBeGreaterThanOrEqual(0);
          expect(w[k]).toBeLessThanOrEqual(1);
          expect(Math.abs(w[k] - prev[k])).toBeLessThan(0.12);
        }
        prev = w;
      }
      const next = weatherAt(d + 1, 0, seasonOf7), last = weatherAt(d, 23.999, seasonOf7);
      expect(Math.abs(next.cloud - last.cloud)).toBeLessThan(0.05);
    }
  }, 60000);

  it("le sol reste mouillé après la pluie, puis sèche ; la neige tient plus longtemps", () => {
    // On cherche une fin de pluie et une fin de neige dans les premières semaines.
    let checkedRain = false, checkedSnow = false;
    for (let d = 1; d < 400 && !(checkedRain && checkedSnow); d++) {
      const eps = dayEpisodes(d, seasonOf7(d));
      for (let i = 0; i + 1 < eps.length; i++) {
        const e = eps[i]!, n = eps[i + 1]!;
        if (e.end > 20 || n.kind === e.kind || n.end - n.start < 2.5) continue;
        if (!checkedRain && e.kind === "pluie" && n.kind === "beau") {
          const after = weatherAt(d, e.end + 1, seasonOf7);
          expect(after.rain).toBe(0);
          expect(after.wet).toBeGreaterThan(0.1);
          expect(weatherAt(d, e.end + 2.4, seasonOf7).wet).toBe(0);
          checkedRain = true;
        }
        if (!checkedSnow && e.kind === "neige" && e.end - e.start > 1.5 && n.kind !== "neige") {
          const after = weatherAt(d, e.end + 2, seasonOf7);
          expect(after.snowfall).toBe(0);
          expect(after.snow).toBeGreaterThan(0.2);
          checkedSnow = true;
        }
      }
    }
    expect(checkedRain && checkedSnow).toBe(true);
  });

  it("les nuages arrivent avant la pluie", () => {
    let seen = false;
    for (let d = 1; d < 200 && !seen; d++) {
      const eps = dayEpisodes(d, seasonOf7(d));
      for (let i = 1; i < eps.length; i++) {
        const a = eps[i - 1]!, b = eps[i]!;
        if (a.kind !== "beau" || b.kind !== "pluie") continue;
        const w = weatherAt(d, b.start + b.fade, seasonOf7);
        expect(w.cloud).toBeGreaterThan(0.6);
        expect(w.rain).toBeLessThan(0.1);
        seen = true;
        break;
      }
    }
    expect(seen).toBe(true);
  });

  it("météo imposée et paramètre d'URL", () => {
    expect(fixedWeather("pluie")).toMatchObject({ kind: "pluie", wet: 1, snow: 0 });
    expect(fixedWeather("neige").snow).toBe(1);
    expect(fixedWeather("beau")).toMatchObject({ rain: 0, wet: 0, storm: 0 });
    expect(weatherParam(new URLSearchParams("weather=orage"))).toBe("orage");
    expect(weatherParam(new URLSearchParams("weather=grele"))).toBeNull();
    expect(weatherParam(new URLSearchParams(""))).toBeNull();
  });
});

describe("météo : effets sur le jeu", () => {
  it("adhérence : sec 1, mouillé 0,8, neige 0,6", () => {
    expect(surfaceGrip({ wet: 0, snow: 0 })).toBe(1);
    expect(surfaceGrip({ wet: 1, snow: 0 })).toBeCloseTo(0.8);
    expect(surfaceGrip({ wet: 1, snow: 1 })).toBeCloseTo(0.6);
  });

  it("passants : pluie 0,45, orage 0,3, neige 0,6, brume 0,9 ; ils pressent le pas sous la pluie", () => {
    const f = (k: WeatherKind): number => crowdWeather(fixedWeather(k));
    expect(f("beau")).toBe(1);
    expect(f("pluie")).toBeCloseTo(1 - 0.55 * 0.75);
    expect(f("orage")).toBeCloseTo(0.3);
    expect(f("neige")).toBeCloseTo(0.68);
    expect(f("brume")).toBeCloseTo(0.9);
    expect(walkWeather({ rain: 1 })).toBeCloseTo(1.2);
  });

  it("circulation : moins dense et plus prudente sous la pluie", () => {
    expect(trafficWeather({ rain: 0, snow: 0 })).toEqual({ density: 1, caution: 1 });
    expect(trafficWeather({ rain: 1, snow: 0 })).toEqual({ density: 0.8, caution: 0.9 });
  });
});

describe("météo : branchements", () => {
  it("le nombre de passants et de voitures visé suit la météo", () => {
    expect(crowdTarget(100, 12, 0, 0, 0.45)).toBeLessThan(crowdTarget(100, 12, 0, 0) * 0.5);
    expect(crowdTarget(100, 12, 0, 0, 1)).toBe(crowdTarget(100, 12, 0, 0));
    expect(trafficTarget(20, 12, 0, 0, 0.8)).toBeLessThan(trafficTarget(20, 12, 0, 0));
  });

  it("sur sol mouillé ou enneigé, une voiture freine plus long ; le réglage revient au sec", () => {
    const flat = flatTerrain(), none = new Colliders();
    const stop = (grip: number): number => {
      setSurfaceGrip(grip);
      const s = createVehicle(0, -90, 0, flat);
      s.vy = 20;
      s.speed = 20;
      let t = 0;
      while (s.speed > 0.05 && t < 20) {
        stepVehicle(s, CAR, { throttle: 0, brake: 1, steer: 0 }, 1 / 60, flat, none);
        t += 1 / 60;
      }
      return s.y + 90;
    };
    try {
      const dry = stop(1), wet = stop(0.8), snow = stop(0.6);
      expect(wet).toBeGreaterThan(dry * 1.1);
      expect(snow).toBeGreaterThan(wet * 1.1);
    } finally {
      setSurfaceGrip(1);
    }
  });
});
