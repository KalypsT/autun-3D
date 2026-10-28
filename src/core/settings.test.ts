import { describe, expect, it } from "vitest";
import { CROWD_CHOICES, DEFAULT_SETTINGS, effectiveSettings, parseSettings, TRAFFIC_CHOICES } from "./settings";

describe("réglage « Foule »", () => {
  it("vaut 100 par défaut et se limite aux choix proposés", () => {
    expect(DEFAULT_SETTINGS.crowd).toBe(100);
    expect(parseSettings({}).crowd).toBe(100);
    expect(parseSettings({ crowd: 0 }).crowd).toBe(0);
    expect(parseSettings({ crowd: 45 }).crowd).toBe(40);
    expect(parseSettings({ crowd: 1000 }).crowd).toBe(150);
    expect(parseSettings({ crowd: "beaucoup" }).crowd).toBe(100);
    expect(CROWD_CHOICES).toContain(parseSettings({ crowd: 90 }).crowd);
  });

  it("est imposé par ?peds= (0 pour couper les passants), borné à 400, sans toucher aux réglages enregistrés", () => {
    const stored = { ...DEFAULT_SETTINGS, crowd: 40 };
    const off = effectiveSettings(stored, new URLSearchParams("peds=0"));
    expect(off.values.crowd).toBe(0);
    expect(off.locked.has("crowd")).toBe(true);
    expect(effectiveSettings(stored, new URLSearchParams("peds=250")).values.crowd).toBe(250);
    expect(effectiveSettings(stored, new URLSearchParams("peds=9999")).values.crowd).toBe(400);
    const none = effectiveSettings(stored, new URLSearchParams("dpr=2"));
    expect(none.values.crowd).toBe(40);
    expect(none.locked.has("crowd")).toBe(false);
    expect(stored.crowd).toBe(40);
  });
});

describe("réglage « Circulation »", () => {
  it("vaut 20 (normale) par défaut depuis la mesure sur téléphone (D68), et se limite aux choix proposés", () => {
    expect(DEFAULT_SETTINGS.traffic).toBe(20);
    expect(parseSettings({}).traffic).toBe(20);
    expect(parseSettings({ traffic: 22 }).traffic).toBe(20);
    expect(parseSettings({ traffic: 1000 }).traffic).toBe(30);
    expect(parseSettings({ traffic: "beaucoup" }).traffic).toBe(20);
    expect(parseSettings({ traffic: 0 }).traffic).toBe(0);
    expect(TRAFFIC_CHOICES).toContain(parseSettings({ traffic: 12 }).traffic);
  });

  it("est imposé par ?traffic=N, borné à 60, sans toucher aux réglages enregistrés", () => {
    const stored = { ...DEFAULT_SETTINGS, traffic: 10 };
    const forced = effectiveSettings(stored, new URLSearchParams("traffic=14"));
    expect(forced.values.traffic).toBe(14);
    expect(forced.locked.has("traffic")).toBe(true);
    expect(effectiveSettings(stored, new URLSearchParams("traffic=999")).values.traffic).toBe(60);
    expect(effectiveSettings(stored, new URLSearchParams("traffic=0")).values.traffic).toBe(0);
    const none = effectiveSettings(stored, new URLSearchParams("dpr=2"));
    expect(none.values.traffic).toBe(10);
    expect(none.locked.has("traffic")).toBe(false);
    expect(stored.traffic).toBe(10);
  });
});
