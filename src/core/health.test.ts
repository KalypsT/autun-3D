import { describe, expect, it } from "vitest";
import { bailOutDamage, BAIL_SAFE, canStepOut, DEATH_HOURS, fallDamage, Health, HOSPITAL_SPAWN, HOSPITALS, MAX_HEALTH, nearestHospital, REGEN_CAP, REGEN_DELAY } from "./health";
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

  it("chaque reprise à l'hôpital est dans la zone, hors des obstacles, avec 2 m de dégagement", () => {
    const { terrain, tile } = loadRealWorld();
    const colliders = buildColliders(tile);
    expect(HOSPITALS.map((h) => h.id)).toEqual(["latouche", "parpas"]);
    expect(HOSPITAL_SPAWN).toBe(HOSPITALS[0]);
    for (const h of HOSPITALS) {
      expect(h.x, h.id).toBeGreaterThan(terrain.xMin + 30);
      expect(h.x, h.id).toBeLessThan(terrain.xMax - 30);
      expect(h.y, h.id).toBeGreaterThan(terrain.yMin + 30);
      expect(h.y, h.id).toBeLessThan(terrain.yMax - 30);
      let blocked = 0;
      for (let a = 0; a < 2 * Math.PI; a += 0.4) if (colliders.resolve(h.x + Math.cos(a) * 2, h.y + Math.sin(a) * 2, 0.35).hit) blocked++;
      expect(colliders.resolve(h.x, h.y, 0.35).hit, h.id).toBe(false);
      expect(blocked, h.id).toBe(0);
    }
    expect(DEATH_HOURS).toBeGreaterThan(0);
  });

  it("on se réveille au site le plus proche à vol d'oiseau", () => {
    const [lat, par] = HOSPITALS as [(typeof HOSPITALS)[number], (typeof HOSPITALS)[number]];
    // Chaque site est son propre plus proche.
    expect(nearestHospital(lat.x, lat.y).id).toBe("latouche");
    expect(nearestHospital(par.x, par.y).id).toBe("parpas");
    // Le centre-ville (mairie, place du Champ de Mars) et l'est reviennent à Latouche, l'ouest à Parpas.
    expect(nearestHospital(0, -40).id).toBe("latouche");
    expect(nearestHospital(1758, 612).id).toBe("latouche");
    expect(nearestHospital(-600, 100).id).toBe("parpas");
    expect(nearestHospital(-1000, 400).id).toBe("parpas");
    // De part et d'autre de la médiatrice (milieu des deux sites).
    const mx = (lat.x + par.x) / 2, my = (lat.y + par.y) / 2;
    const ux = (lat.x - par.x) / Math.hypot(lat.x - par.x, lat.y - par.y), uy = (lat.y - par.y) / Math.hypot(lat.x - par.x, lat.y - par.y);
    expect(nearestHospital(mx + ux * 5, my + uy * 5).id).toBe("latouche");
    expect(nearestHospital(mx - ux * 5, my - uy * 5).id).toBe("parpas");
    // Sur la médiatrice même : Latouche (premier de la liste), de façon déterministe.
    expect(nearestHospital(mx, my).id).toBe("latouche");
    // Les deux sites sont à plus de 500 m l'un de l'autre.
    expect(Math.hypot(lat.x - par.x, lat.y - par.y)).toBeGreaterThan(500);
  });
});

describe("chute d'un deux-roues (D98)", () => {
  it("blessure proportionnelle à la vitesse, jamais mortelle", () => {
    expect(fallDamage(15 / 3.6, MAX_HEALTH)).toBeCloseTo(12);
    expect(fallDamage(50 / 3.6, MAX_HEALTH)).toBeCloseTo(40);
    expect(fallDamage(100 / 3.6, MAX_HEALTH)).toBeCloseTo(80);
    const h = new Health(30);
    h.damage(fallDamage(150 / 3.6, h.hp));
    expect(h.hp).toBe(1);
    expect(h.dead).toBe(false);
    expect(fallDamage(30 / 3.6, 1)).toBe(0);
  });
});

describe("sortie d'un véhicule en marche", () => {
  const kmh = (v: number): number => v / 3.6;
  it("descente normale jusqu'à 8 km/h, en avant comme en marche arrière", () => {
    expect(canStepOut(0)).toBe(true);
    expect(canStepOut(kmh(7.9))).toBe(true);
    expect(canStepOut(-kmh(7.9))).toBe(true);
    expect(canStepOut(kmh(8.5))).toBe(false);
    expect(canStepOut(BAIL_SAFE)).toBe(true);
  });
  it("blessure proportionnelle à la vitesse au-delà du seuil, nulle en dessous, jamais mortelle", () => {
    expect(bailOutDamage(kmh(8), 100)).toBe(0);
    expect(bailOutDamage(kmh(50), 100)).toBeCloseTo(16.8, 1);
    expect(bailOutDamage(kmh(90), 100)).toBeCloseTo(32.8, 1);
    expect(bailOutDamage(kmh(200), 20)).toBe(19);
    expect(bailOutDamage(kmh(200), 1)).toBe(0);
  });
});
