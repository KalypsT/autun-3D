import { describe, expect, it } from "vitest";
import { NavGraph } from "./nav-graph";
import { MASK_ZONE } from "./pedestrians";
import { CACHE_RESPAWN, CACHE_ROUNDS, CACHES, DROP_LIFE, PICKUP_REACH, Pickups } from "./pickups";
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
    const p = new Pickups([{ weapon: "pistol", x: 0, y: 0, label: "a" }, { weapon: "knife", x: 10, y: 0, label: "b" }]);
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
    const p = new Pickups([]);
    const a = p.drop(5, 5, "pistol", 12);
    const b = p.drop(6, 6, "rifle", 30);
    expect(p.list).toHaveLength(2);
    expect(p.take(a, new Inventory())).toBe(true);
    p.update(0.1);
    expect(p.list).toEqual([b]);
    p.update(DROP_LIFE + 1);
    expect(p.list).toHaveLength(0);
  });
});
