import { describe, expect, it } from "vitest";
import { CALL_DELAY, ESCAPE_TIME, INSIDE_RATE, MAX_STARS, REPEAT_WINDOW, SEARCH_RADIUS, Wanted } from "./wanted";

/** Fait tourner le niveau `seconds` secondes au pas de 1/60 s, joueur en (x, y). */
function run(w: Wanted, seconds: number, x: number, y: number, seen: boolean): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) w.update(1 / 60, x, y, seen);
}

describe("niveau de recherche", () => {
  it("vu par la police : l'infraction compte tout de suite", () => {
    const w = new Wanted();
    w.report("theft", 10, 20, "police");
    expect(w.stars).toBe(1);
    expect([w.lastX, w.lastY]).toEqual([10, 20]);
    expect(w.radius).toBe(SEARCH_RADIUS[1]);
    expect(w.takeRise()).toBe(1);
    expect(w.takeRise()).toBe(0);
  });

  it("un passant téléphone : l'infraction compte après le délai, une seule fois", () => {
    const w = new Wanted();
    w.report("carjack", 0, 0, "civilian");
    w.report("carjack", 1, 0, "civilian");
    expect(w.pendingCalls).toBe(1);
    run(w, CALL_DELAY - 0.5, 0, 0, false);
    expect(w.stars).toBe(0);
    run(w, 1, 0, 0, false);
    expect(w.stars).toBe(1);
    expect(w.pendingCalls).toBe(0);
  });

  it("les passants ne signalent ni la vitesse, ni le feu rouge, ni le vol d'un véhicule garé", () => {
    const w = new Wanted();
    for (const c of ["speeding", "red_light", "theft", "ram_police", "evade"] as const) w.report(c, 0, 0, "civilian");
    expect(w.pendingCalls).toBe(0);
    run(w, CALL_DELAY + 1, 0, 0, false);
    expect(w.stars).toBe(0);
  });

  it("vitesse et feu rouge ne font qu'une étoile, même répétés", () => {
    const w = new Wanted();
    w.report("speeding", 0, 0, "police");
    w.report("red_light", 0, 0, "police");
    run(w, REPEAT_WINDOW + 1, 0, 0, true);
    w.report("speeding", 0, 0, "police");
    expect(w.stars).toBe(1);
  });

  it("renverser des passants ajoute une étoile, pas trois d'un coup", () => {
    const w = new Wanted();
    w.report("hit_ped", 0, 0, "police");
    w.report("hit_ped", 0, 0, "police");
    w.report("hit_ped", 0, 0, "police");
    expect(w.stars).toBe(1);
    run(w, REPEAT_WINDOW + 0.1, 0, 0, true);
    w.report("hit_ped", 0, 0, "police");
    expect(w.stars).toBe(2);
    run(w, REPEAT_WINDOW + 0.1, 0, 0, true);
    w.report("ram_police", 0, 0, "police");
    w.report("hit_cop", 0, 0, "police");
    expect(w.stars).toBe(MAX_STARS);
  });

  it("la fuite fait passer d'une à deux étoiles, sans toucher à trois", () => {
    const w = new Wanted();
    w.report("evade", 0, 0, "police");
    expect(w.stars).toBe(2);
    w.set(3, 0, 0);
    w.report("evade", 0, 0, "police");
    expect(w.stars).toBe(3);
  });

  it("vu par la police, on ne perd rien ; hors de vue et hors de la zone, une étoile tombe au bout du délai", () => {
    const w = new Wanted();
    w.set(2, 0, 0);
    run(w, 60, 5, 5, true);
    expect(w.stars).toBe(2);
    expect([w.lastX, w.lastY]).toEqual([5, 5]);
    const far = SEARCH_RADIUS[2] + 50;
    run(w, ESCAPE_TIME[2] - 1, far, 0, false);
    expect(w.stars).toBe(2);
    expect(w.escape).toBeGreaterThan(0.9);
    run(w, 1.5, far, 0, false);
    expect(w.stars).toBe(1);
    // La fouille continue autour du même point, plus petite.
    expect([w.lastX, w.lastY]).toEqual([5, 5]);
    expect(w.radius).toBe(SEARCH_RADIUS[1]);
    run(w, ESCAPE_TIME[1] + 0.5, far, 0, false);
    expect(w.stars).toBe(0);
    expect(w.radius).toBe(0);
  });

  it("dans la zone de recherche, la piste refroidit plus lentement", () => {
    const w = new Wanted();
    w.set(1, 0, 0);
    run(w, ESCAPE_TIME[1] + 1, 10, 0, false);
    expect(w.stars).toBe(1);
    run(w, ESCAPE_TIME[1] / INSIDE_RATE - ESCAPE_TIME[1], 10, 0, false);
    expect(w.stars).toBe(0);
  });

  it("être revu remet la fuite à zéro", () => {
    const w = new Wanted();
    w.set(1, 0, 0);
    run(w, ESCAPE_TIME[1] - 2, 500, 0, false);
    run(w, 0.1, 500, 0, true);
    expect(w.escape).toBe(0);
    run(w, ESCAPE_TIME[1] - 2, 500 + SEARCH_RADIUS[1] + 10, 0, false);
    expect(w.stars).toBe(1);
  });

  it("l'arrestation efface le niveau et les appels en attente", () => {
    const w = new Wanted();
    w.set(3, 0, 0);
    w.report("carjack", 0, 0, "civilian");
    w.clear();
    run(w, CALL_DELAY + 1, 0, 0, false);
    expect(w.stars).toBe(0);
    expect(w.seen).toBe(false);
  });

  it("`set` borne le niveau", () => {
    const w = new Wanted();
    w.set(9, 0, 0);
    expect(w.stars).toBe(MAX_STARS);
    w.set(-2, 0, 0);
    expect(w.stars).toBe(0);
  });
});
