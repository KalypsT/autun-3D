import { afterEach, describe, expect, it, vi } from "vitest";
import { connectDomoThibIn, DomoThibError, type DomoThib, type DomoThibEnvironment, type DomoThibSaves, type DomoThibSyncStorage } from "./domothib-games";
import { connectGame, openSaveStorage } from "./host";
import { SAVE_KEY, SaveStore, type SaveGame, type StorageLike } from "../core/save";
import { APPEARANCE_KEY, AppearanceStore, randomAppearance } from "../core/appearance";
import { SETTINGS_KEY } from "../core/settings";

const ORIGIN = "https://domothib.example";

const sample = (): SaveGame => ({
  version: 6,
  savedAt: 1_700_000_000_000,
  player: { x: -10.5, y: -40 },
  camera: { yaw: 0.3, pitch: 0.28 },
  riding: null,
  vehicles: [{ id: "velo-7-0", model: "velo-ville", variant: 1, x: -20, y: 14, heading: 0 }],
  clock: { hour: 17.25, date: 9 },
  waypoint: { x: 400, y: -300 },
  health: 72,
  arms: { owned: ["knife"], mag: {}, ammo: {}, current: "knife" },
  money: 250,
});

/** Faux stockage synchrone de DomoThib (contrat §4.3), sur une table en mémoire. */
function fakeSync(values: Map<string, string>, refuse?: (key: string, value: string) => DomoThibError | null): DomoThibSyncStorage {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      const error = refuse?.(key, value);
      if (error) throw error;
      values.set(key, value);
    },
    removeItem: (key) => void values.delete(key),
    keys: () => [...values.keys()].sort(),
  };
}

/** Faux `DomoThibSaves` : seul `openSync` sert au jeu ; il peut échouer les `failures` premières fois (`unavailable`). */
function fakeSaves(values = new Map<string, string>(), failures = 0): Pick<DomoThibSaves, "openSync"> & { calls: number } {
  const saves = {
    calls: 0,
    openSync: async () => {
      saves.calls++;
      if (saves.calls <= failures) throw new DomoThibError("unavailable");
      return fakeSync(values);
    },
  };
  return saves;
}

/**
 * Un faux DomoThib branché sur la vraie bibliothèque du pont par un `MessageChannel` : il répond à `domothib:ready` et garde les
 * sauvegardes du joueur, comme le serveur.
 */
function fakeDomoThib(server: Map<string, string>) {
  const channel = new MessageChannel();
  const listeners = new Set<(event: Event) => void>();
  const parent = {
    postMessage(message: unknown) {
      if ((message as { type?: string }).type !== "domothib:ready") return;
      const event = { source: parent, origin: ORIGIN, data: { type: "domothib:connect", protocol: 1, game: "autun-3d", player: { name: "Thibaud", initial: "T" }, saves: true }, ports: [channel.port2] };
      for (const l of listeners) l(event as unknown as Event);
    },
  };
  const writes: string[] = [];
  channel.port1.onmessage = (event: MessageEvent) => {
    const m = event.data as { id: number; type: string; key: string; value: string };
    if (m.type === "saves.readAll") channel.port1.postMessage({ id: m.id, ok: true, result: Object.fromEntries(server) });
    else if (m.type === "saves.write") {
      server.set(m.key, m.value);
      writes.push(m.key);
      channel.port1.postMessage({ id: m.id, ok: true });
    } else if (m.type === "saves.remove") {
      server.delete(m.key);
      channel.port1.postMessage({ id: m.id, ok: true });
    }
  };
  const env: DomoThibEnvironment = {
    parent,
    parentOrigin: ORIGIN,
    addEventListener: (type, l) => type === "message" && listeners.add(l),
    removeEventListener: (type, l) => type === "message" && listeners.delete(l),
  };
  return { env, writes, close: () => (channel.port1.close(), channel.port2.close()) };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const opened: (() => void)[] = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  vi.restoreAllMocks();
});

describe("sauvegarde dans DomoThib (D305, contrat §4.3)", () => {
  it("hors de DomoThib (saves absent) : le stockage du navigateur, comme avant", async () => {
    const local: StorageLike = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    expect(await openSaveStorage(null, () => local)).toBe(local);
    expect(await openSaveStorage(null, () => null)).toBeNull();
  });

  it("avec DomoThib : openSync() est attendu, la partie et l'apparence s'y lisent et s'y écrivent", async () => {
    const server = new Map([[SAVE_KEY, JSON.stringify(sample())]]);
    const storage = await openSaveStorage(fakeSaves(server), () => {
      throw new Error("le stockage du navigateur ne doit pas servir");
    });
    const store = new SaveStore(storage);
    expect(store.load()).toEqual(sample());
    expect(store.write({ ...sample(), health: 40 })).toBe(true);
    expect(JSON.parse(server.get(SAVE_KEY)!).health).toBe(40);
    const recipe = randomAppearance(() => 0.37);
    expect(new AppearanceStore(storage).write(recipe)).toBe(true);
    expect(new AppearanceStore(storage).load()).toEqual(recipe);
    store.clear();
    expect(server.has(SAVE_KEY)).toBe(false);
  });

  it("une valeur refusée (too_large) : l'écriture dit qu'elle a échoué, sans exception", async () => {
    const storage = fakeSync(new Map(), () => new DomoThibError("too_large"));
    expect(new SaveStore(storage).write(sample())).toBe(false);
  });

  it("serveur illisible : réessaie, puis aucun stockage (pas de repli sur le navigateur, qui ferait diverger la partie)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flaky = fakeSaves(new Map([[SAVE_KEY, JSON.stringify(sample())]]), 2);
    expect(new SaveStore(await openSaveStorage(flaky, () => null, 3, 0)).load()).toEqual(sample());
    expect(flaky.calls).toBe(3);
    const down = fakeSaves(new Map(), 10);
    const local = vi.fn(() => null);
    expect(await openSaveStorage(down, local, 3, 0)).toBeNull();
    expect(down.calls).toBe(3);
    expect(local).not.toHaveBeenCalled();
  });

  it("les clés du jeu sont acceptées par DomoThib ; les réglages de l'écran n'y vont pas", () => {
    const pattern = /^[A-Za-z0-9._:-]{1,100}$/;
    expect(SAVE_KEY).toMatch(pattern);
    expect(APPEARANCE_KEY).toMatch(pattern);
    expect(SETTINGS_KEY).not.toBe(SAVE_KEY);
  });

  it("connectGame : sans le build domothib, pas de connexion ; connexion refusée (null) : le navigateur", async () => {
    const connect = vi.fn(async (): Promise<DomoThib | null> => null);
    expect((await connectGame(false, connect)).host).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    const session = await connectGame(true, connect);
    expect(connect).toHaveBeenCalledOnce();
    expect(session.host).toBeNull();
  });

  it("avec la vraie bibliothèque du pont : la partie est lue au démarrage et chaque écriture part vers le serveur", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const server = new Map([[SAVE_KEY, JSON.stringify(sample())], ["autre", "x"]]);
    const fake = fakeDomoThib(server);
    opened.push(fake.close);
    const session = await connectGame(true, () => connectDomoThibIn(fake.env, { timeoutMs: 1000 }));
    expect(session.host).not.toBeNull();
    const store = new SaveStore(session.storage);
    expect(store.load()).toEqual(sample());
    store.write({ ...sample(), player: { x: 12, y: 34 } });
    await flush();
    expect(fake.writes).toEqual([SAVE_KEY]);
    expect(JSON.parse(server.get(SAVE_KEY)!).player).toEqual({ x: 12, y: 34 });
    store.clear();
    await flush();
    expect(server.has(SAVE_KEY)).toBe(false);
    expect(server.get("autre")).toBe("x");
  });
});
