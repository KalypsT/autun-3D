import { describe, expect, it } from "vitest";
import { CROWD_CHOICES, DEFAULT_SETTINGS, effectiveSettings, parseSettings } from "./settings";

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
