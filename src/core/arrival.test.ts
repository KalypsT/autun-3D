import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_VERSION } from "../data/data-version";
import {
  APPROACH, arrivalDistance, CINE, DEPART, departureDistance, DOOR_STEP, shotAt, STATION, stationHeading, stationPoint, STOP_D, TER, TRACK,
  Track, TRACK_LINE, WALK_END, WALK_HEADING,
} from "./arrival";

const data = (path: string): unknown => JSON.parse(readFileSync(`public/immuable/${DATA_VERSION}/data/${path}`, "utf8"));

/** Coordonnées (s, t) d'un point du jeu dans le repère de la gare. */
const toStation = (x: number, y: number): [number, number] => {
  const ux = Math.cos(STATION.a), uy = Math.sin(STATION.a), dx = x - STATION.o[0], dy = y - STATION.o[1];
  return [dx * ux + dy * uy, -dx * uy + dy * ux];
};

describe("arrivée à la gare (D338)", () => {
  it("le repère de la gare est celui du modèle de la gare dans les données (D228)", () => {
    const kinds = data("kinds/24_37.json") as { buildings: Record<string, { k: string; sta?: { o: [number, number]; a: number } }> };
    const station = Object.values(kinds.buildings).find((b) => b.k === "station")!;
    expect(station.sta!.o).toEqual([...STATION.o]);
    expect(station.sta!.a).toBe(STATION.a);
    const [s, t] = toStation(...stationPoint(22, 13.6));
    expect(s).toBeCloseTo(22, 6);
    expect(t).toBeCloseTo(13.6, 6);
    // Cap vers le bâtiment (−t) : le joueur regarde la gare en descendant du train.
    const h = stationHeading(0, -1), [s1, t1] = toStation(DOOR_STEP[0] + Math.sin(h), DOOR_STEP[1] + Math.cos(h));
    expect(s1 - 22).toBeCloseTo(0, 6);
    expect(t1 - 13.6).toBeCloseTo(-1, 6);
  });

  it("la voie suivie par le train est faite de sommets des rails des données", () => {
    const vertices: [number, number][] = [];
    for (const tile of ["23_36", "23_37", "24_37"]) {
      for (const r of (data(`structures/${tile}.json`) as { rails: { p: number[] }[] }).rails) {
        for (let i = 0; i < r.p.length; i += 2) vertices.push([r.p[i]!, r.p[i + 1]!]);
      }
    }
    for (const [x, y] of TRACK) expect(Math.min(...vertices.map(([a, b]) => Math.hypot(a - x, b - y)))).toBeLessThan(0.01);
  });

  it("le tracé se parcourt à l'abscisse curviligne, et la projection est l'inverse", () => {
    const line = new Track([[0, 0], [10, 0], [10, 10]]);
    expect(line.length).toBe(20);
    expect(line.at(15)).toEqual({ x: 10, y: 5, heading: 0 });
    expect(line.at(5).heading).toBeCloseTo(Math.PI / 2);
    expect(line.at(-3)).toMatchObject({ x: 0, y: 0 });
    expect(line.project(12, 4)).toBeCloseTo(14);
  });

  it("à l'arrêt, l'autorail est le long du quai 1 et sa porte arrière devant le passage du pavillon", () => {
    const c = TRACK_LINE.at(STOP_D), [s, t] = toStation(c.x, c.y);
    expect(t).toBeGreaterThan(15);
    expect(t).toBeLessThan(16.2);
    // Porte arrière (il roule vers l'est, +s) : dans le pavillon (s de 17,7 à 33,1).
    const door = TRACK_LINE.at(STOP_D + TER.door), [sd] = toStation(door.x, door.y);
    expect(sd).toBeGreaterThan(19);
    expect(sd).toBeLessThan(25);
    expect(s).toBeGreaterThan(25);
    // Tout le train tient sur le tracé, et il roule vers l'est (cap du nord-est).
    expect(STOP_D - TER.length / 2 - APPROACH).toBeGreaterThan(0);
    expect(STOP_D + TER.length / 2).toBeLessThan(TRACK_LINE.length);
    expect(Math.abs(c.heading - stationHeading(1, 0))).toBeLessThan(0.05);
  });

  it("le train freine régulièrement jusqu'à l'arrêt, sans à-coup, puis repart vers l'ouest et disparaît", () => {
    expect(arrivalDistance(0)).toBeCloseTo(STOP_D - APPROACH);
    expect(arrivalDistance(CINE.arrive)).toBe(STOP_D);
    expect(arrivalDistance(CINE.end)).toBe(STOP_D);
    let prev = arrivalDistance(0), speed = Infinity;
    for (let t = 0.1; t <= CINE.arrive + 1e-9; t += 0.1) {
      const d = arrivalDistance(t), v = (d - prev) / 0.1;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(speed + 1e-9);
      // Moins de 60 km/h en entrant en gare.
      expect(v).toBeLessThan(60 / 3.6);
      prev = d;
      speed = v;
    }
    expect(departureDistance(0)).toBe(STOP_D);
    expect(departureDistance(10)!).toBeLessThan(STOP_D);
    expect(departureDistance(Math.sqrt((2 * DEPART.gone) / DEPART.accel) + 0.1)).toBeNull();
  });

  it("le personnage descend sur le quai 1, hors de la caisse du train, et marche vers la gare", () => {
    for (const p of [DOOR_STEP, WALK_END]) {
      const [s, t] = toStation(...p);
      expect(s).toBeGreaterThan(17.7);
      expect(s).toBeLessThan(33.1);
      // Quai 1 : du mur (8,7) au bord (13,3).
      expect(t).toBeGreaterThan(8.7);
      expect(t).toBeLessThan(13.8);
    }
    const c = TRACK_LINE.at(STOP_D + TER.door);
    expect(Math.hypot(c.x - DOOR_STEP[0], c.y - DOOR_STEP[1])).toBeGreaterThan(TER.halfWidth + 0.35);
    expect(WALK_HEADING).toBeCloseTo(stationHeading(0, -1));
    expect(CINE.out + CINE.walk).toBeLessThan(CINE.end);
  });

  it("trois plans : le quai au téléobjectif, le train qui passe, la porte ; caméra jamais dans le bâtiment ni sur la voie", () => {
    expect(shotAt(2).fov).toBeLessThan(40);
    expect(shotAt(10)).not.toEqual(shotAt(2));
    expect(shotAt(CINE.out + 1)).not.toEqual(shotAt(10));
    for (const t of [0, 9, CINE.end]) {
      const [s, tt] = toStation(shotAt(t).from[0], shotAt(t).from[1]);
      // Pavillon jusqu'à t = 9,3 ; voie du quai 1 vers t = 15,5 (caisse jusqu'à 14,1).
      expect(tt).toBeGreaterThan(s > 17 && s < 34 ? 9.4 : 8.8);
      expect(tt).toBeLessThan(14);
    }
  });
});
