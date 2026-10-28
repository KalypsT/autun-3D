import { describe, expect, it } from "vitest";
import { SAVE_KEY, SAVE_VERSION, SaveStore, serializeSave, type SaveGame, type StorageLike } from "../core/save";
import { gameSpawn, resolveStart } from "./start";

const zone: [number, number, number, number] = [-1520, -1812, 1480, 1188];
const saved: SaveGame = {
  version: SAVE_VERSION, savedAt: 1, player: { x: 300, y: -200 }, camera: { yaw: 1.5, pitch: 0.3 }, riding: null, vehicles: [], clock: { hour: 9, day: 12 }, waypoint: null, health: 100,
};
const storeWith = (save: SaveGame | null): SaveStore => {
  const data: Record<string, string> = save ? { [SAVE_KEY]: serializeSave(save) } : {};
  const st: StorageLike = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
  return new SaveStore(st);
};
const q = (s: string): URLSearchParams => new URLSearchParams(s);

describe("départ de la partie", () => {
  it("sans sauvegarde : le point de départ de la place", () => {
    expect(resolveStart(q(""), storeWith(null), zone)).toEqual({ x: -10, y: -40, yaw: 0, save: null, noSave: false });
  });

  it("avec une sauvegarde : on reprend là où on s'était arrêté", () => {
    const s = resolveStart(q(""), storeWith(saved), zone);
    expect([s.x, s.y, s.yaw, s.noSave]).toEqual([300, -200, 1.5, false]);
    expect(s.save).toEqual(saved);
  });

  it("un paramètre de test impose le départ et coupe la sauvegarde", () => {
    for (const p of ["at=5,6", "h=17", "ride=velo", "style=nuit", "speed=0", "day=3", "yaw=2"]) {
      const s = resolveStart(q(p), storeWith(saved), zone);
      expect(s.save).toBeNull();
      expect(s.noSave).toBe(true);
    }
    expect(resolveStart(q("at=5,6&yaw=1"), storeWith(saved), zone)).toMatchObject({ x: 5, y: 6, yaw: 1 });
  });

  it("?new ignore la sauvegarde mais continue d'enregistrer", () => {
    expect(resolveStart(q("new"), storeWith(saved), zone)).toMatchObject({ x: -10, y: -40, save: null, noSave: false });
  });

  it("une sauvegarde hors de la zone jouable est ignorée", () => {
    const far = { ...saved, player: { x: 9000, y: 0 } };
    expect(resolveStart(q(""), storeWith(far), zone).save).toBeNull();
  });

  it("?debug, ?dpr=, ?detail=, ?bench ne touchent pas à la sauvegarde", () => {
    expect(resolveStart(q("debug&dpr=1&detail=500"), storeWith(saved), zone).save).toEqual(saved);
    expect(gameSpawn(q("at=a,b")).x).toBe(-10);
  });
});
