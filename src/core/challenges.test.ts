import { describe, expect, it } from "vitest";
import { challengeGoal, Challenges, CHALLENGE_TIERS, parseChallenges, TIER_REWARDS } from "./challenges";
import { RECORD_KINDS } from "./records";

describe("défis (D319)", () => {
  it("un palier se touche une fois, dans l'ordre ; un grand exploit en franchit plusieurs d'un coup", () => {
    const c = new Challenges();
    expect(c.offer("jump", 20)).toEqual([]);
    expect(c.offer("jump", 30)).toEqual([{ kind: "jump", tier: 1, reward: 100 }]);
    expect(c.offer("jump", 30)).toEqual([]);
    expect(c.offer("jump", 120).map((h) => h.tier)).toEqual([2, 3]);
    expect(c.offer("jump", 500)).toEqual([]);
    expect(c.count).toBe(3);
  });

  it("les distances se cumulent sur la partie", () => {
    const c = new Challenges();
    for (let i = 0; i < 49; i++) expect(c.add("foot", 100)).toEqual([]);
    expect(c.add("foot", 100)).toEqual([{ kind: "foot", tier: 1, reward: 100 }]);
    expect(c.progress("foot")).toBe(5000);
    expect(c.offer("foot", 1e9)).toEqual([]);
    expect(c.add("vehicle", Number.NaN)).toEqual([]);
  });

  it("sauvegarde : aller-retour, lecture méfiante", () => {
    const c = new Challenges();
    c.offer("topSpeed", 60);
    c.add("vehicle", 25000);
    const back = new Challenges(parseChallenges(JSON.parse(JSON.stringify(c.toSave()))));
    expect(back.tiers.topSpeed).toBe(2);
    expect(back.tiers.vehicle).toBe(1);
    expect(back.distance.vehicle).toBe(25000);
    expect(back.offer("topSpeed", 60)).toEqual([]);
    expect(parseChallenges({ tiers: { jump: 9, drift: -2, x: 1 }, foot: "a", vehicle: -4 })).toEqual({ tiers: { jump: 3, drift: 0 }, foot: 0, vehicle: 0 });
    expect(parseChallenges(null)).toBeNull();
  });

  it("chaque record a trois paliers croissants et un but lisible", () => {
    for (const k of RECORD_KINDS) {
      const t = CHALLENGE_TIERS[k];
      expect(t[0]).toBeLessThan(t[1]);
      expect(t[1]).toBeLessThan(t[2]);
    }
    expect(TIER_REWARDS).toEqual([100, 300, 800]);
    expect(challengeGoal("topSpeed", 2)).toBe("180 km/h");
    expect(challengeGoal("stars5", 2)).toBe("1 min 30 à 5 étoiles");
    expect(challengeGoal("stars3", 1)).toBe("1 min à 3 étoiles");
    expect(challengeGoal("foot", 1)).toBe("5 km à pied");
    expect(challengeGoal("jump", 3)).toBe("saut de 100 m");
  });
});
