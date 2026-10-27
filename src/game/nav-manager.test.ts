import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NavManager } from "./nav-manager";

vi.mock("../data/load", () => ({
  loadJson: async (name: string): Promise<unknown> => JSON.parse(readFileSync(`public/data/${name}`, "utf8")),
}));

describe("chargement de la navigation", () => {
  it("n'ajoute jamais deux fois la même super-tuile, même quand le départ et la mise à jour la demandent ensemble", async () => {
    const m = new NavManager();
    await m.init();
    const add = vi.spyOn(m.graph, "add");
    const [x, y] = [0, -20];
    const first = m.preload(x, y);
    m.update(x, y); // demande les mêmes super-tuiles pendant que le départ les charge
    await first;
    await new Promise((r) => setTimeout(r, 50));
    expect(m.graph.cells.size).toBeGreaterThan(0);
    expect(add).toHaveBeenCalledTimes(m.graph.cells.size);
    // Une mise à jour de plus ne recharge rien.
    for (let i = 0; i < 30; i++) m.update(x, y);
    await new Promise((r) => setTimeout(r, 50));
    expect(add).toHaveBeenCalledTimes(m.graph.cells.size);
  });

  it("décharge les super-tuiles lointaines quand le joueur s'éloigne, et recharge sans doublon quand il revient", async () => {
    const m = new NavManager();
    await m.init();
    await m.preload(0, -20);
    const near = m.graph.cells.size;
    expect(near).toBeGreaterThan(0);
    // Très loin (hors du monde) : tout est déchargé, aucune erreur.
    m.update(5000, 5000);
    expect(m.graph.cells.size).toBe(0);
    m.update(0, -20);
    for (let i = 0; i < 12; i++) m.update(0, -20);
    await new Promise((r) => setTimeout(r, 80));
    expect(m.graph.cells.size).toBe(near);
  });
});
