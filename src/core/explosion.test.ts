import { describe, expect, it } from "vitest";
import { VehicleDamage } from "./damage";
import { blastShare, EXPLOSION, wreckStage } from "./explosion";
import { CRIMES } from "./wanted";

describe("explosion (D111)", () => {
  it("le souffle frappe de toute sa force tout près, puis faiblit jusqu'à rien à sa portée", () => {
    expect(blastShare(0)).toBe(1);
    expect(blastShare(EXPLOSION.full)).toBe(1);
    expect(blastShare(5)).toBeGreaterThan(0);
    expect(blastShare(5)).toBeLessThan(blastShare(4));
    expect(blastShare(EXPLOSION.radius)).toBe(0);
    expect(blastShare(50)).toBe(0);
  });

  it("à pied, on meurt tout près, on est blessé à quelques mètres, on n'a rien à dix mètres ; un passant tout près meurt", () => {
    expect(EXPLOSION.player * blastShare(2)).toBeGreaterThanOrEqual(100);
    const at5 = EXPLOSION.player * blastShare(5);
    expect(at5).toBeGreaterThan(10);
    expect(at5).toBeLessThan(100);
    expect(EXPLOSION.player * blastShare(10)).toBe(0);
    expect(EXPLOSION.ped * blastShare(EXPLOSION.full)).toBeGreaterThanOrEqual(100);
  });

  it("une voiture voisine déjà bien abîmée prend feu à son tour ; une voiture neuve garée à côté est seulement touchée", () => {
    const fresh = new VehicleDamage({ toughness: 1, burns: true });
    fresh.damage(EXPLOSION.vehicle * blastShare(2), 0);
    expect(fresh.burning).toBe(-1);
    expect(fresh.tier).not.toBe("ok");
    const worn = new VehicleDamage({ toughness: 1, burns: true });
    worn.damage(40);
    worn.damage(EXPLOSION.vehicle * blastShare(2), 0);
    expect(worn.burning).toBe(0);
  });

  it("l'épave brûle, puis fume, puis refroidit ; le temps depuis la fin avance avec `update`", () => {
    const d = new VehicleDamage({ toughness: 1, burns: true });
    d.damage(95);
    for (let t = 0; t < 6; t += 0.1) d.update(0.1);
    expect(d.end).toBe("explosion");
    expect(wreckStage(d.sinceEnd)).toBe("fire");
    for (let t = 0; t < EXPLOSION.fire; t += 0.5) d.update(0.5);
    expect(wreckStage(d.sinceEnd)).toBe("smoke");
    for (let t = 0; t < EXPLOSION.smoke; t += 1) d.update(1);
    expect(wreckStage(d.sinceEnd)).toBe("cold");
    d.repair();
    expect(d.sinceEnd).toBe(0);
  });

  it("une explosion en public est une infraction signalée par les passants, au moins deux étoiles", () => {
    expect(CRIMES.explosion.min).toBe(2);
    expect(CRIMES.explosion.civilians).toBe(true);
  });
});
