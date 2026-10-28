import { describe, expect, it } from "vitest";
import { DEATH_HOURS, Health, HOSPITAL_SPAWN, MAX_HEALTH, REGEN_CAP, REGEN_DELAY } from "./health";
import { loadRealWorld } from "./testing";
import { buildColliders } from "./world";

const run = (h: Health, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) h.update(1 / 60);
};

describe("santé du joueur", () => {
  it("commence pleine, prend des dégâts, meurt une seule fois", () => {
    const h = new Health();
    expect(h.hp).toBe(MAX_HEALTH);
    expect(h.damage(30)).toBe(false);
    expect(h.hp).toBe(70);
    expect(h.takeHurt()).toBe(30);
    expect(h.takeHurt()).toBe(0);
    expect(h.damage(500)).toBe(true);
    expect(h.dead).toBe(true);
    expect(h.hp).toBe(0);
    expect(h.takeDeath()).toBe(true);
    expect(h.takeDeath()).toBe(false);
    // Un mort ne prend plus de dégâts, ne se soigne pas, ne se régénère pas.
    expect(h.damage(10)).toBe(false);
    h.heal(50);
    run(h, 30);
    expect(h.hp).toBe(0);
  });

  it("un pas de temps négatif ne retire rien", () => {
    const h = new Health(30);
    h.update(-3);
    h.update(NaN);
    expect(h.hp).toBe(30);
  });

  it("ignore les dégâts négatifs, nuls ou non numériques", () => {
    const h = new Health();
    h.damage(-5);
    h.damage(0);
    h.damage(NaN);
    expect(h.hp).toBe(MAX_HEALTH);
  });

  it("se régénère après un délai, jusqu'à mi-hauteur seulement", () => {
    const h = new Health();
    h.damage(90);
    run(h, REGEN_DELAY - 0.5);
    expect(h.hp).toBe(10);
    run(h, 1);
    expect(h.hp).toBeGreaterThan(10);
    run(h, 60);
    expect(h.hp).toBe(REGEN_CAP);
    // Un nouveau dégât relance le délai.
    h.damage(10);
    run(h, REGEN_DELAY - 0.5);
    expect(h.hp).toBe(REGEN_CAP - 10);
    // Au-dessus du repère, rien ne bouge ; `heal` va jusqu'au bout.
    h.heal(500);
    expect(h.hp).toBe(MAX_HEALTH);
    h.damage(10);
    run(h, 30);
    expect(h.hp).toBe(90);
  });

  it("`set` impose les points de vie (0 tue), `restore` rend tout", () => {
    const h = new Health(0);
    expect(h.takeDeath()).toBe(true);
    h.set(40);
    expect(h.hp).toBe(40);
    expect(h.takeDeath()).toBe(false);
    h.set(0);
    expect(h.takeDeath()).toBe(true);
    h.restore();
    expect(h.hp).toBe(MAX_HEALTH);
    expect(h.dead).toBe(false);
    expect(new Health(-20).hp).toBe(0);
    expect(new Health(900).hp).toBe(MAX_HEALTH);
  });

  it("la reprise à l'hôpital est dans la zone, hors des obstacles, avec 2 m de dégagement", () => {
    const { terrain, tile } = loadRealWorld();
    const colliders = buildColliders(tile);
    expect(HOSPITAL_SPAWN.x).toBeGreaterThan(terrain.xMin + 30);
    expect(HOSPITAL_SPAWN.x).toBeLessThan(terrain.xMax - 30);
    expect(HOSPITAL_SPAWN.y).toBeGreaterThan(terrain.yMin + 30);
    expect(HOSPITAL_SPAWN.y).toBeLessThan(terrain.yMax - 30);
    let blocked = 0;
    for (let a = 0; a < 2 * Math.PI; a += 0.4) if (colliders.resolve(HOSPITAL_SPAWN.x + Math.cos(a) * 2, HOSPITAL_SPAWN.y + Math.sin(a) * 2, 0.35).hit) blocked++;
    expect(colliders.resolve(HOSPITAL_SPAWN.x, HOSPITAL_SPAWN.y, 0.35).hit).toBe(false);
    expect(blocked).toBe(0);
    expect(DEATH_HOURS).toBeGreaterThan(0);
  });
});
