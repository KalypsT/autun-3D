import { describe, expect, it } from "vitest";
import { createDog, DOG_POSE, LEASH, stepDog, type DogOwner } from "./dogs";

const walker = (t: number, speed = 1.2): DogOwner => ({ x: 0, y: speed * t, heading: 0, speed, sitting: false, fleeing: false });

describe("chien en laisse (D199)", () => {
  it("suit son maître sans jamais dépasser la longueur de la laisse, et marche à son allure", () => {
    const d = createDog(1234, 0, walker(0));
    let maxLeash = 0, moved = 0;
    for (let k = 1; k <= 60 * 30; k++) {
      const o = walker(k / 60);
      const px = d.x, py = d.y;
      stepDog(d, o, 1 / 60);
      moved += Math.hypot(d.x - px, d.y - py);
      maxLeash = Math.max(maxLeash, Math.hypot(d.x - o.x, d.y - o.y));
      expect(Number.isFinite(d.x + d.y + d.heading + d.phase)).toBe(true);
    }
    expect(maxLeash).toBeLessThanOrEqual(LEASH + 1e-6);
    // 30 s à 1,2 m/s : 36 m, un peu plus avec les détours pour renifler.
    expect(moved).toBeGreaterThan(34);
    expect(moved).toBeLessThan(60);
  });

  it("se couche aux pieds de son maître assis, et le suit en courant s'il fuit (sans renifler)", () => {
    const d = createDog(77, 0, walker(0));
    const seated: DogOwner = { x: 0, y: 0, heading: 1, speed: 0, sitting: true, fleeing: false };
    for (let k = 0; k < 60 * 5; k++) stepDog(d, seated, 1 / 60);
    expect(d.pose).toBe(DOG_POSE.sit);
    expect(Math.hypot(d.x, d.y)).toBeLessThan(1);
    let sniffed = 0;
    for (let k = 1; k <= 60 * 10; k++) {
      stepDog(d, { x: 0, y: 3.8 * (k / 60), heading: 0, speed: 3.8, sitting: false, fleeing: true }, 1 / 60);
      if (d.pose === DOG_POSE.sniff) sniffed++;
    }
    expect(sniffed).toBe(0);
    expect(d.speed).toBeGreaterThan(3);
  });

  it("un maître a toujours le même chien (taille, pelage)", () => {
    const a = createDog(99, 0, walker(0)), b = createDog(99, 5, walker(0)), c = createDog(100, 0, walker(0));
    expect([a.size, a.coat, a.side]).toEqual([b.size, b.coat, b.side]);
    expect([a.size, a.coat]).not.toEqual([c.size, c.coat]);
    expect(a.size).toBeGreaterThanOrEqual(0.7);
    expect(a.size).toBeLessThanOrEqual(1.25);
  });
});
