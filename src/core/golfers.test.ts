import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GolfSite } from "../data/types";
import { GOLF_WALK, GolfRound, type Golfer } from "./golfers";
import { practiceFrame } from "./golf";

// Golfeurs du golf municipal (D291) : les groupes enchaînent les trous, au pas, et se rassemblent autour du drapeau.
const kinds = JSON.parse(readFileSync("public/data/kinds/34_34.json", "utf8")) as { sites: { t: string }[] };
const site = kinds.sites.find((q) => q.t === "golf") as GolfSite;

describe("golfeurs (D291)", () => {
  it("quatre groupes de deux à quatre joueurs, et trois joueurs au practice", () => {
    const r = new GolfRound(site);
    const out: Golfer[] = [];
    const n = r.golfers(out);
    expect(n).toBeGreaterThanOrEqual(4 * 2 + 3);
    expect(n).toBeLessThanOrEqual(r.capacity);
    expect(out.slice(n - 3).every((g) => g.speed === 0 && !g.trolley)).toBe(true);
  });

  it("on marche au pas d'un chariot, sans téléportation, et on joue tous les trous à la suite", () => {
    const r = new GolfRound(site, 1, 0);
    const out: Golfer[] = [];
    r.golfers(out);
    let px = out[0]!.x, py = out[0]!.y;
    const greens = new Set<number>();
    const flags = site.holes!.map((h) => [h[4], h[5]] as const);
    for (let t = 0; t < 4 * 3600; t += 0.5) {
      r.step(0.5);
      r.golfers(out);
      // Le premier joueur : au plus un pas de chariot de son groupe, plus le passage en cercle autour du drapeau (≤ 2 × 5 m + écart).
      expect(Math.hypot(out[0]!.x - px, out[0]!.y - py)).toBeLessThan(GOLF_WALK * 0.5 + 12);
      px = out[0]!.x;
      py = out[0]!.y;
      flags.forEach(([fx, fy], i) => {
        if (Math.hypot(out[0]!.x - fx, out[0]!.y - fy) < 6) greens.add(i);
      });
    }
    // En quatre heures, un groupe fait le tour des 14 trous (≈ 1,5 km joués, plus les retours aux départs).
    expect(greens.size).toBe(site.holes!.length);
  });

  it("au practice, les joueurs regardent le terrain", () => {
    const r = new GolfRound(site);
    const out: Golfer[] = [];
    const n = r.golfers(out);
    const { rot } = practiceFrame(site.practice!);
    for (const g of out.slice(n - 3)) {
      // Le terrain est à gauche de la ligne des tapis : direction (−sin rot, cos rot).
      expect(Math.sin(g.heading) * -Math.sin(rot) + Math.cos(g.heading) * Math.cos(rot)).toBeGreaterThan(0.99);
    }
  });
});
