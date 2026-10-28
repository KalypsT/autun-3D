import { describe, expect, it } from "vitest";
import { addDays, parseSave, SAVE_KEY, SAVE_VERSION, SaveStore, serializeSave, type SaveGame, type StorageLike } from "./save";
import { DEFAULT_SETTINGS, effectiveSettings, parseSettings, SettingsStore } from "./settings";

const sample = (): SaveGame => ({
  version: 2,
  savedAt: 1_700_000_000_000,
  player: { x: -10.5, y: -40 },
  camera: { yaw: 0.3, pitch: 0.28 },
  riding: "voiture-12,34",
  vehicles: [
    { id: "voiture-12,34", model: "citadine", variant: 3, x: 5, y: 6, heading: 1.2 },
    { id: "velo-7-0", model: "velo-ville", variant: 1, x: -20, y: 14, heading: 0 },
  ],
  clock: { hour: 17.25, day: 200 },
  waypoint: { x: 400, y: -300 },
});

const fakeStorage = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};

describe("sauvegarde", () => {
  it("aller-retour sans perte", () => {
    expect(parseSave(serializeSave(sample()))).toEqual(sample());
  });

  it("refuse tout ce qui n'est pas une sauvegarde de cette version", () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave("")).toBeNull();
    expect(parseSave("{pas du json")).toBeNull();
    expect(parseSave("[1,2]")).toBeNull();
    expect(parseSave(JSON.stringify({ ...sample(), version: 3 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...sample(), version: undefined }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...sample(), player: { x: "1", y: 2 } }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...sample(), player: { x: 1e9, y: 2 } }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...sample(), clock: { hour: null, day: 3 } }))).toBeNull();
  });

  it("migre une sauvegarde de version 1 : chaque type devient son modèle d'alors, le reste est conservé", () => {
    const v1 = {
      ...sample(),
      version: 1,
      vehicles: [
        { id: "voiture-12,34", kind: "car", variant: 3, x: 5, y: 6, heading: 1.2 },
        { id: "velo-7-0", kind: "bike", variant: 1, x: -20, y: 14, heading: 0 },
        { id: "trottinette-7-3", kind: "scooter", variant: 2, x: -19, y: 14, heading: 0 },
        { id: "moto-1,2-1", kind: "moto", variant: 0, x: 1, y: 2, heading: 0.5 },
        { id: "x", kind: "tank", variant: 0, x: 0, y: 0, heading: 0 },
      ],
    };
    const p = parseSave(JSON.stringify(v1))!;
    expect(p.version).toBe(SAVE_VERSION);
    expect(p.vehicles.map((v) => [v.id, v.model, v.variant])).toEqual([
      ["voiture-12,34", "citadine", 3], ["velo-7-0", "velo-ville", 1], ["trottinette-7-3", "trottinette", 2], ["moto-1,2-1", "moto-routiere", 0],
    ]);
    expect(p.riding).toBe("voiture-12,34");
    expect(p.player).toEqual(sample().player);
    expect(p.waypoint).toEqual(sample().waypoint);
  });

  it("une sauvegarde de version 1 reste lisible après un aller-retour par le stockage (relue en version 2)", () => {
    const st = fakeStorage({ [SAVE_KEY]: JSON.stringify({ ...sample(), version: 1, vehicles: [{ id: "voiture-1,1", kind: "car", variant: 0, x: 0, y: 0, heading: 0 }], riding: null }) });
    const store = new SaveStore(st);
    const loaded = store.load()!;
    expect(store.write(loaded)).toBe(true);
    expect(store.load()).toEqual(loaded);
  });

  it("écarte les véhicules invalides et un véhicule conduit qui n'existe plus", () => {
    const s = { ...sample(), vehicles: [{ id: "x", model: "char-d-assaut", variant: 0, x: 0, y: 0, heading: 0 }, sample().vehicles[1]!] };
    const p = parseSave(JSON.stringify(s))!;
    expect(p.vehicles.map((v) => v.id)).toEqual(["velo-7-0"]);
    expect(p.riding).toBeNull();
  });

  it("ramène l'heure dans [0, 24), le jour dans [1, 365] et borne le tangage", () => {
    const p = parseSave(JSON.stringify({ ...sample(), clock: { hour: 25.5, day: 400 }, camera: { yaw: 1, pitch: 9 } }))!;
    expect(p.clock.hour).toBeCloseTo(1.5);
    expect(p.clock.day).toBe(35);
    expect(p.camera.pitch).toBe(1.5);
    expect(addDays(365, 1)).toBe(1);
    expect(addDays(1, -1)).toBe(365);
  });

  it("un repère invalide devient « pas de repère »", () => {
    expect(parseSave(JSON.stringify({ ...sample(), waypoint: { x: "a" } }))!.waypoint).toBeNull();
    expect(parseSave(JSON.stringify({ ...sample(), waypoint: undefined }))!.waypoint).toBeNull();
  });
});

describe("stockage", () => {
  it("écrit, relit et efface", () => {
    const st = fakeStorage();
    const store = new SaveStore(st);
    expect(store.load()).toBeNull();
    expect(store.write(sample())).toBe(true);
    expect(store.load()).toEqual(sample());
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("ne lève jamais d'exception : stockage absent, plein ou qui jette", () => {
    expect(new SaveStore(null).write(sample())).toBe(false);
    expect(new SaveStore(null).load()).toBeNull();
    const broken: StorageLike = { getItem: () => { throw new Error("interdit"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("interdit"); } };
    const store = new SaveStore(broken);
    expect(store.write(sample())).toBe(false);
    expect(store.load()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it("une sauvegarde abîmée dans le stockage est ignorée", () => {
    expect(new SaveStore(fakeStorage({ [SAVE_KEY]: "{\"version\":1}" })).load()).toBeNull();
  });
});

describe("réglages", () => {
  it("valeurs invalides : retour aux valeurs par défaut champ par champ ; valeurs proches : on prend le choix le plus proche", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ dpr: "x", shadows: 3000, detail: 999, sensitivity: 7, minimapNorth: "oui", crowd: 120 })).toEqual({ dpr: 2.5, shadows: 2048, detail: 400, sensitivity: 2, minimapNorth: false, crowd: 100, traffic: 20 });
    expect(parseSettings({ dpr: 2.4, minimapNorth: true }).dpr).toBe(2.5);
    expect(parseSettings({ minimapNorth: true }).minimapNorth).toBe(true);
  });

  it("les paramètres d'URL restent prioritaires et verrouillent le réglage", () => {
    const stored = { ...DEFAULT_SETTINGS, dpr: 2, detail: 200, shadows: 2048 as const };
    const free = effectiveSettings(stored, new URLSearchParams(""));
    expect(free.values).toEqual(stored);
    expect(free.locked.size).toBe(0);
    const forced = effectiveSettings(stored, new URLSearchParams("dpr=1&detail=600&shadow=0"));
    expect(forced.values).toMatchObject({ dpr: 1, detail: 600, shadows: 0 });
    expect([...forced.locked].sort()).toEqual(["detail", "dpr", "shadows"]);
    expect(effectiveSettings(stored, new URLSearchParams("shadowmap=1024")).values.shadows).toBe(1024);
    expect(effectiveSettings(stored, new URLSearchParams("dpr=abc")).locked.size).toBe(0);
  });

  it("enregistrement local et relecture", () => {
    const st = fakeStorage();
    const store = new SettingsStore(st);
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    store.write({ ...DEFAULT_SETTINGS, sensitivity: 1.4, minimapNorth: true });
    expect(new SettingsStore(st).load()).toMatchObject({ sensitivity: 1.4, minimapNorth: true });
    expect(new SettingsStore(null).write(DEFAULT_SETTINGS)).toBe(false);
  });
});
