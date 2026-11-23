import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFile, MAX_PARALLEL } from "./load";

const answer = (status: number): Response => new Response(status === 200 ? "ok" : null, { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Lance `fetchFile` en faisant avancer le temps des nouveaux essais. */
async function run(responses: (number | "network")[]): Promise<{ result: string; calls: number; caches: (string | undefined)[] }> {
  vi.useFakeTimers();
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift() ?? 200;
    if (next === "network") throw new TypeError("Failed to fetch");
    return answer(next);
  });
  vi.stubGlobal("fetch", fetch);
  const pending = fetchFile("/autun-3d/immuable/x/data/ground/25_33_a.png", "ground/25_33_a.png").then(
    async (res) => res.text(),
    (e: unknown) => (e as Error).message,
  );
  await vi.runAllTimersAsync();
  return { result: await pending, calls: fetch.mock.calls.length, caches: fetch.mock.calls.map(([, init]) => init?.cache) };
}

describe("lecture des données par fetch, images comprises (D306)", () => {
  it("réussite du premier coup", async () => {
    expect(await run([200])).toMatchObject({ result: "ok", calls: 1 });
  });

  it("erreur passagère (réseau, 5xx, 429) : nouvel essai", async () => {
    expect(await run(["network", 502, 200])).toMatchObject({ result: "ok", calls: 3 });
    expect(await run([429, 200])).toMatchObject({ result: "ok", calls: 2 });
  });

  it("refus (401, 403, 404) : pas de nouvel essai, le code est dans le message", async () => {
    expect(await run([403, 200])).toMatchObject({ result: "ground/25_33_a.png : 403", calls: 1 });
    expect(await run([404])).toMatchObject({ result: "ground/25_33_a.png : 404", calls: 1 });
  });

  it("quatre échecs passagers : abandon, avec la dernière cause", async () => {
    expect(await run([500, 503, 500, 500, 200])).toMatchObject({ result: "ground/25_33_a.png : 500", calls: 4 });
    expect((await run(["network", "network", "network", "network"])).result).toBe("ground/25_33_a.png : réseau (Failed to fetch)");
  });

  it("D308 : le premier essai peut venir du cache du navigateur, les suivants vont jusqu'au serveur (une erreur gardée en cache n'est pas relue)", async () => {
    expect((await run([500, 200])).caches).toEqual([undefined, "reload"]);
    expect((await run(["network", 502, 200])).caches).toEqual([undefined, "reload", "reload"]);
    expect((await run([200])).caches).toEqual([undefined]);
  });

  it("D307 : jamais plus de MAX_PARALLEL requêtes à la fois, même pour une rafale de 80 images ; toutes aboutissent", async () => {
    let inFlight = 0, peak = 0;
    const open: (() => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => open.push(() => {
        inFlight--;
        resolve(answer(200));
      }));
    }));
    let done = false;
    const all = Promise.all(Array.from({ length: 80 }, (_, i) => fetchFile(`/x/${i}.png`, `${i}.png`))).finally(() => (done = true));
    while (!done) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      open.splice(0).forEach((finish) => finish());
    }
    expect((await all).every((r) => r.ok)).toBe(true);
    expect(MAX_PARALLEL).toBe(6);
    expect(peak).toBe(MAX_PARALLEL);
  });

  it("D307 : une requête qui échoue rend sa place (pas de blocage après des erreurs)", async () => {
    for (let i = 0; i < MAX_PARALLEL * 2; i++) expect((await run([404])).calls).toBe(1);
    expect(await run([500, 500, 500, 500])).toMatchObject({ result: "ground/25_33_a.png : 500", calls: 4 });
    expect(await run([200])).toMatchObject({ result: "ok", calls: 1 });
  });
});
