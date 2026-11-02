import { describe, expect, it } from "vitest";
import { Fireworks, LAKE } from "./fireworks";
import { crowdFeast, MUSIC_SPOTS } from "./week";

describe("feu d'artifice du 14 juillet (D202)", () => {
  it("rien hors du spectacle ; pendant, des fusées éclatent au-dessus du lac, les étincelles retombent et s'éteignent", () => {
    expect(Fireworks.rate(22.9)).toBe(0);
    expect(Fireworks.rate(23.95)).toBeGreaterThan(Fireworks.rate(23.1));
    const fw = new Fireworks(1, 2400, 300);
    const bursts: number[][] = [];
    for (let k = 0; k < 60 * 20; k++) fw.step(1 / 60, 23.5, (x, y, z) => bursts.push([x, y, z]));
    expect(bursts.length).toBeGreaterThan(10);
    for (const [x, y, z] of bursts) {
      expect(Math.abs(x! - LAKE.x)).toBeLessThanOrEqual(LAKE.spread / 2);
      expect(Math.abs(y! - LAKE.y)).toBeLessThanOrEqual(LAKE.spread / 2);
      expect(z).toBeGreaterThan(350);
    }
    expect(fw.particles.length).toBeGreaterThan(100);
    expect(fw.particles.length).toBeLessThanOrEqual(2400);
    for (let k = 0; k < 60 * 10; k++) fw.step(1 / 60, 0.5);
    expect(fw.particles.length + fw.rockets.length).toBe(0);
  });

  it("foule des fêtes : autour des musiciens, au bord du lac le 14 juillet", () => {
    const s = MUSIC_SPOTS[0]!;
    expect(crowdFeast(["fete-musique"], s.x, s.y, LAKE)).toBeGreaterThan(2);
    expect(crowdFeast([], s.x, s.y, LAKE)).toBe(1);
    expect(crowdFeast(["14-juillet"], LAKE.x + 250, LAKE.y, LAKE)).toBeGreaterThan(2.5);
    expect(crowdFeast(["14-juillet"], 0, 0, LAKE)).toBe(1);
  });
});
