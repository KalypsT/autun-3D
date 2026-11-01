import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NavGraph } from "./nav-graph";
import { MASK_ZONE } from "./pedestrians";
import { Health, HOSPITALS, MAX_HEALTH } from "./health";
import { CACHE_RESPAWN, CACHE_ROUNDS, CACHES, DROP_LIFE, HEAL_RESPAWN, HEAL_SITES, PICKUP_REACH, Pickups } from "./pickups";
import { loadRealNav, loadRealWorld } from "./testing";
import { Inventory, reserveCap, WEAPONS } from "./weapons";
import { buildColliders } from "./world";

describe("armes au sol (J5-3)", () => {
  it("les caches sont dans la zone, sur un trottoir ou une file piétonne, dégagées sur 80 cm, et couvrent toutes les armes de mêlée et à feu", () => {
    const { terrain, tile } = loadRealWorld();
    const { cells } = loadRealNav();
    const colliders = buildColliders(tile);
    const nav = new NavGraph();
    for (const c of cells) nav.add(c);
    const bad: string[] = [];
    for (const c of CACHES) {
      if (c.x < terrain.xMin + 30 || c.x > terrain.xMax - 30 || c.y < terrain.yMin + 30 || c.y > terrain.yMax - 30) bad.push(`${c.label}: hors zone`);
      if (!nav.nearest(c.x, c.y, 3, MASK_ZONE)) bad.push(`${c.label}: pas de file piétonne`);
      for (let a = 0; a < 6.3; a += 0.8) if (colliders.resolve(c.x + Math.cos(a) * 0.8, c.y + Math.sin(a) * 0.8, 0.3).hit) bad.push(`${c.label}: obstacle`);
      if (colliders.resolve(c.x, c.y, 0.3).hit) bad.push(`${c.label}: dans un obstacle`);
    }
    expect(bad).toEqual([]);
    const kinds = new Set(CACHES.map((c) => c.weapon));
    for (const w of ["knife", "bat", "pistol", "shotgun", "rifle"] as const) expect(kinds.has(w)).toBe(true);
    // Les armes blanches sont près du départ (place du Champ de Mars), le fusil d'assaut tout au bout.
    const d = (c: (typeof CACHES)[number]): number => Math.hypot(c.x + 10, c.y + 40);
    expect(Math.min(...CACHES.filter((c) => c.weapon === "bat").map(d))).toBeLessThan(100);
    expect(Math.min(...CACHES.filter((c) => c.weapon === "rifle").map(d))).toBeGreaterThan(1000);
    expect(new Set(CACHES.map((c) => `${c.x},${c.y}`)).size).toBe(CACHES.length);
  });

  it("ramasser : l'arme et ses balles vont dans l'inventaire, la cache réapparaît après 5 minutes, pas deux fois la même arme blanche", () => {
    const p = new Pickups([{ weapon: "pistol", x: 0, y: 0, label: "a" }, { weapon: "knife", x: 10, y: 0, label: "b" }], []);
    const inv = new Inventory();
    expect(p.nearest(1, 0, PICKUP_REACH)).toBe(p.list[0]);
    expect(p.nearest(5, 0, PICKUP_REACH)).toBeNull();
    expect(p.take(p.list[0]!, inv)).toBe(true);
    expect(inv.has("pistol")).toBe(true);
    expect(inv.magOf("pistol")).toBe(12);
    expect(inv.reserveOf("pistol")).toBe(CACHE_ROUNDS.pistol! - 12);
    // Prise : plus disponible.
    expect(p.nearest(0, 0, 5)).toBeNull();
    expect(p.take(p.list[0]!, inv)).toBe(false);
    p.update(CACHE_RESPAWN - 1);
    expect(p.available(p.list[0]!)).toBe(false);
    p.update(2);
    expect(p.available(p.list[0]!)).toBe(true);
    // Les balles se ramassent encore tant que la réserve n'est pas pleine, jamais une arme blanche qu'on a déjà.
    expect(p.take(p.list[0]!, inv)).toBe(true);
    expect(inv.reserveOf("pistol")).toBe(Math.min(reserveCap(WEAPONS.pistol), CACHE_ROUNDS.pistol! - 12 + CACHE_ROUNDS.pistol!));
    expect(p.take(p.list[1]!, inv)).toBe(true);
    p.update(CACHE_RESPAWN + 1);
    expect(p.canTake(p.list[1]!, inv)).toBe(false);
    // Réserve pleine : rien à ramasser.
    inv.grant("pistol", 1000);
    p.update(CACHE_RESPAWN + 1);
    expect(p.canTake(p.list[0]!, inv)).toBe(false);
  });

  it("une arme lâchée disparaît quand on la ramasse, ou d'elle-même après trois minutes", () => {
    const p = new Pickups([], []);
    const a = p.drop(5, 5, "pistol", 12);
    const b = p.drop(6, 6, "rifle", 30);
    expect(p.list).toHaveLength(2);
    expect(p.take(a, new Inventory())).toBe(true);
    p.update(0.1);
    expect(p.list).toEqual([b]);
    p.update(DROP_LIFE + 1);
    expect(p.list).toHaveLength(0);
  });

  it("ramassage automatique : on prend l'arme en marchant dessus, la nouvelle arme passe dans la main, pas deux fois la même arme blanche", () => {
    const p = new Pickups([{ weapon: "bat", x: 0, y: 0, label: "a" }, { weapon: "pistol", x: 20, y: 0, label: "b" }], []);
    const inv = new Inventory();
    expect(p.collect(PICKUP_REACH + 0.5, 0, inv)).toBeNull();
    expect(p.collect(0.5, 0, inv)).toBe(p.list[0]);
    expect(inv.has("bat")).toBe(true);
    expect(inv.current.id).toBe("bat");
    // Elle réapparaît : on l'a déjà, on ne la reprend pas en passant dessus.
    p.update(CACHE_RESPAWN + 1);
    expect(p.collect(0, 0, inv)).toBeNull();
    // Une arme à feu dont la réserve est pleine reste au sol.
    inv.grant("pistol", 1000);
    expect(p.collect(20, 0, inv)).toBeNull();
    expect(p.available(p.list[1]!)).toBe(true);
  });
});

describe("croix de pharmacie (D159)", () => {
  const sites = [{ x: 0, y: 0, label: "p" }];

  it("rend toute la santé au contact, puis revient après deux minutes", () => {
    const p = new Pickups([], sites);
    const inv = new Inventory();
    const h = new Health(30);
    expect(p.collect(0.4, 0.2, inv, h)).toBe(p.list[0]);
    expect(h.hp).toBe(MAX_HEALTH);
    expect(p.available(p.list[0]!)).toBe(false);
    h.damage(40);
    expect(p.collect(0, 0, inv, h)).toBeNull();
    p.update(HEAL_RESPAWN - 1);
    expect(p.collect(0, 0, inv, h)).toBeNull();
    p.update(2);
    expect(p.collect(0, 0, inv, h)).toBe(p.list[0]);
    expect(h.hp).toBe(MAX_HEALTH);
  });

  it("à santé pleine ou sans joueur vivant, elle reste là", () => {
    const p = new Pickups([], sites);
    const inv = new Inventory();
    expect(p.collect(0, 0, inv, new Health())).toBeNull();
    expect(p.available(p.list[0]!)).toBe(true);
    expect(p.collect(0, 0, inv)).toBeNull();
    const dead = new Health(0);
    expect(p.collect(0, 0, inv, dead)).toBeNull();
    expect(dead.hp).toBe(0);
  });

  it("une par pharmacie, sur le trottoir ou la place, dégagée sur 50 cm, à 8 m au plus de la porte", () => {
    const { tile } = loadRealWorld();
    const { cells } = loadRealNav();
    const colliders = buildColliders(tile);
    const nav = new NavGraph();
    for (const c of cells) nav.add(c);
    const bad: string[] = [];
    for (const c of HEAL_SITES) {
      // La cour de Latouche est hors de la navigation piétonne : seules les croix des pharmacies et du site de Parpas doivent s'y trouver.
      if (!c.label.includes("Latouche") && !nav.nearest(c.x, c.y, 1.5, MASK_ZONE)) bad.push(`${c.label}: pas de file piétonne`);
      if (colliders.resolve(c.x, c.y, 0.3).hit) bad.push(`${c.label}: dans un obstacle`);
      for (let a = 0; a < 6.3; a += 0.8) if (colliders.resolve(c.x + Math.cos(a) * 0.5, c.y + Math.sin(a) * 0.5, 0.3).hit) bad.push(`${c.label}: obstacle`);
    }
    expect(bad).toEqual([]);
    expect(HEAL_SITES).toHaveLength(7);
    expect(new Set(HEAL_SITES.map((c) => `${c.x},${c.y}`)).size).toBe(HEAL_SITES.length);
    // Chaque croix est près du lieu « pharmacie » de la carte (la porte est à moins de 8 m du point d'OpenStreetMap, sauf Saint-Pan).
    const places = JSON.parse(readFileSync("public/data/map/places.json", "utf8")) as { places: { cat: string; name: string; x: number; y: number }[] };
    for (const c of HEAL_SITES.filter((h) => !h.label.startsWith("Centre hospitalier"))) {
      const near = places.places.filter((q) => q.cat === "pharmacie").some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 12);
      expect(near, c.label).toBe(true);
    }
  });
});

describe("croix de soin du Centre hospitalier (D161)", () => {
  it("chaque site en a une à 4-10 m de son point de réveil, et elle soigne", () => {
    for (const h of HOSPITALS) {
      const cross = HEAL_SITES.find((c) => c.label === `Centre hospitalier, site ${h.name}`);
      expect(cross, h.name).toBeDefined();
      const d = Math.hypot(cross!.x - h.x, cross!.y - h.y);
      expect(d, h.name).toBeGreaterThan(4);
      expect(d, h.name).toBeLessThan(10);
      // On se réveille à pleine santé : la croix ne se ramasse pas tout de suite, mais soigne un blessé qui revient.
      const pk = new Pickups([], [cross!]);
      const hp = new Health();
      const inv = new Inventory();
      expect(pk.collect(cross!.x, cross!.y, inv, hp)).toBeNull();
      hp.damage(70);
      expect(pk.collect(cross!.x, cross!.y, inv, hp)).not.toBeNull();
      expect(hp.hp).toBe(MAX_HEALTH);
    }
  });
});
