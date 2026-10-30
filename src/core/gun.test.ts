import { describe, expect, it } from "vitest";
import { GUN_ASSIST_ANGLE, Gun, MUZZLE, type ShootWorld } from "./gun";
import { Inventory, WEAPONS } from "./weapons";

const DT = 1 / 60;

interface Target { x: number; y: number; hp: number }

/** Un monde de cibles immobiles (cercles de 0,4 m) et, au besoin, un mur vertical à x = `wallX`. */
function world(targets: Target[], wallX: number | null = null): ShootWorld & { hurts: { slot: number; damage: number }[] } {
  const hurts: { slot: number; damage: number }[] = [];
  const bearing = (x: number, y: number, t: Target): number => Math.atan2(t.x - x, t.y - y);
  return {
    hurts,
    pick(x, y, heading, range, half, max, out) {
      out.length = 0;
      const list: { i: number; d: number }[] = [];
      targets.forEach((t, i) => {
        if (t.hp <= 0) return;
        const d = Math.hypot(t.x - x, t.y - y);
        const da = Math.abs(((bearing(x, y, t) - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (d <= range + 0.28 && da <= half) list.push({ i, d });
      });
      list.sort((a, b) => a.d - b.d);
      for (const e of list.slice(0, max)) out.push(e.i);
      return out.length;
    },
    position: (slot, out) => Object.assign(out, { x: targets[slot]!.x, y: targets[slot]!.y }),
    hurt(slot, damage) {
      hurts.push({ slot, damage });
      targets[slot]!.hp -= damage;
      return targets[slot]!.hp <= 0 ? 2 : 1;
    },
    rayPed(x, y, dx, dy, maxDist, out) {
      out.slot = -1;
      out.dist = maxDist;
      targets.forEach((t, i) => {
        if (t.hp <= 0) return;
        const rx = t.x - x, ry = t.y - y, along = rx * dx + ry * dy;
        const side2 = rx * rx + ry * ry - along * along;
        if (along < 0 || side2 > 0.16) return;
        const d = along - Math.sqrt(0.16 - side2);
        if (d >= 0 && d < out.dist) {
          out.dist = d;
          out.slot = i;
        }
      });
      return out.slot >= 0;
    },
    wall(...a: number[]) {
      // (ax, ay, bx, by) : mur vertical à x = wallX.
      const ax = a[0]!, bx = a[2]!;
      if (wallX === null || (ax - wallX) * (bx - wallX) > 0) return null;
      return (wallX - ax) / (bx - ax);
    },
  };
}

const armed = (id: "pistol" | "shotgun" | "rifle", rounds: number): Inventory => {
  const inv = new Inventory();
  inv.grant(id, rounds);
  inv.select(id);
  return inv;
};

describe("armes à feu (J5-3)", () => {
  it("un tir part tout de suite, touche la cible visée et la tue au bout du nombre de tirs voulu", () => {
    const w = world([{ x: 0, y: 12, hp: 100 }]);
    const inv = armed("pistol", 24);
    const g = new Gun(5);
    let hits = 0, killed = 0, fired = 0;
    for (let t = 0; t < 2; t += DT) {
      const r = g.step(DT, true, false, WEAPONS.pistol, inv, 0, 0, 0, w);
      hits += r.hits;
      killed += r.killed;
      fired += r.fired;
    }
    // 100 points de vie, 34 par balle : trois tirs.
    expect(hits).toBe(3);
    expect(killed).toBe(1);
    expect(w.hurts.map((h) => h.damage)).toEqual([34, 34, 34]);
    expect(inv.magOf("pistol")).toBe(12 - fired);
    // 4 tirs par seconde : le premier tout de suite, puis un toutes les 0,25 s.
    const g2 = new Gun(5), inv2 = armed("pistol", 24), w2 = world([]);
    let first = -1, count = 0;
    for (let k = 0; k < 60; k++) {
      const r = g2.step(DT, true, false, WEAPONS.pistol, inv2, 0, 0, 0, w2);
      if (r.fired) {
        count++;
        if (first < 0) first = k;
      }
    }
    expect(first).toBe(0);
    expect(count).toBe(4);
  });

  it("la visée assistée tourne le tir vers la cible dans le cône du regard ; hors du cône, le tir part droit devant", () => {
    const side = world([{ x: 6, y: 10, hp: 100 }]);
    const g = new Gun(5);
    const r = g.step(DT, true, false, WEAPONS.pistol, armed("pistol", 24), 0, 0, 0, side);
    expect(g.targeted).toBe(true);
    expect(g.facing).toBeCloseTo(Math.atan2(6, 10), 6);
    expect(r.fired).toBe(1);
    expect(r.hits).toBe(1);
    const out = world([{ x: 20, y: 5, hp: 100 }]);
    const g2 = new Gun(5);
    const r2 = g2.step(DT, true, false, WEAPONS.pistol, armed("pistol", 24), 0, 0, 0, out);
    expect(g2.targeted).toBe(false);
    expect(g2.facing).toBe(0);
    expect(r2.hits).toBe(0);
    expect(GUN_ASSIST_ANGLE).toBeGreaterThan(0.5);
  });

  it("un mur arrête le tir et empêche de viser ce qu'il cache ; le trait s'arrête sur le mur", () => {
    const w = world([{ x: 0, y: 10, hp: 100 }], null);
    // Mur horizontal simulé : on place un faux mur à y = 5 via un monde dédié.
    const blocked: ShootWorld = { ...w, wall: (...a: number[]) => (a[1]! < 5 && a[3]! > 5 ? (5 - a[1]!) / (a[3]! - a[1]!) : null) };
    const g = new Gun(5);
    const r = g.step(DT, true, false, WEAPONS.pistol, armed("pistol", 24), 0, 0, 0, blocked);
    expect(g.targeted).toBe(false);
    expect(r.fired).toBe(1);
    expect(r.hits).toBe(0);
    expect(r.shots[0]!.kind).toBe(1);
    expect(r.shots[0]!.y1).toBeCloseTo(5, 5);
    expect(r.shots[0]!.y0).toBeCloseTo(MUZZLE, 5);
  });

  it("une carrosserie arrête la balle et prend les dégâts ; un passant devant la voiture la prend, lui, et la voiture rien (D113)", () => {
    for (const [pedY, carY, carHit] of [[10, 5, true], [3, 6, false]] as const) {
      const w = world([{ x: 0, y: pedY, hp: 100 }]);
      const hits: number[] = [];
      const shielded: ShootWorld = {
        ...w,
        rayVehicle: (_x, y, _dx, dy, maxDist) => (dy > 0.9 && carY - 1 - y <= maxDist ? { dist: carY - 1 - y, id: 7 } : null),
        hurtVehicle: (id, damage) => hits.push(id, damage),
      };
      const g = new Gun(5);
      const r = g.step(DT, true, false, WEAPONS.pistol, armed("pistol", 24), 0, 0, 0, shielded);
      expect(r.fired).toBe(1);
      if (carHit) {
        expect(r.hits).toBe(0);
        expect(hits).toEqual([7, WEAPONS.pistol.damage]);
        expect(r.shots[0]!.y1).toBeCloseTo(carY - 1, 5);
      } else {
        expect(r.hits).toBe(1);
        expect(hits).toEqual([]);
      }
    }
  });

  it("le fusil à pompe tire huit plombs en éventail dont les dégâts s'additionnent en un seul coup et baissent avec la distance", () => {
    const near = world([{ x: 0, y: 2, hp: 1000 }]);
    const g = new Gun(9);
    const r = g.step(DT, true, false, WEAPONS.shotgun, armed("shotgun", 12), 0, 0, 0, near);
    expect(r.fxCount).toBe(8);
    expect(r.fired).toBe(1);
    // Un seul appel de dégâts pour le tir (une seule chute), de plusieurs plombs.
    expect(near.hurts).toHaveLength(1);
    expect(near.hurts[0]!.damage).toBeGreaterThan(40);
    expect(near.hurts[0]!.damage).toBeLessThanOrEqual(96.1);
    const far = world([{ x: 0, y: 14, hp: 1000 }]);
    const g2 = new Gun(9);
    g2.step(DT, true, false, WEAPONS.shotgun, armed("shotgun", 12), 0, 0, 0, far);
    // De loin : moins de plombs touchent et chacun frappe plus faiblement.
    expect((far.hurts[0]?.damage ?? 0)).toBeLessThan(near.hurts[0]!.damage);
  });

  it("le chargeur se vide, la détente claque à vide une fois par appui, le rechargement automatique prend sa durée et remplit le chargeur", () => {
    const inv = armed("pistol", 14);
    expect(inv.magOf("pistol")).toBe(12);
    expect(inv.reserveOf("pistol")).toBe(2);
    const g = new Gun(5), w = world([]);
    let fired = 0, started = 0, done = -1, t = 0;
    for (; t < 6; t += DT) {
      const r = g.step(DT, true, false, WEAPONS.pistol, inv, 0, 0, 0, w);
      fired += r.fired;
      if (r.reloadStarted) started++;
      if (r.reloadDone && done < 0) done = t;
    }
    // 12 tirs, puis rechargement de 1,2 s (2 balles de réserve), puis 2 tirs, puis à sec.
    expect(fired).toBe(14);
    expect(started).toBe(1);
    expect(done).toBeGreaterThan(3 - 1.2);
    expect(inv.magOf("pistol")).toBe(0);
    expect(inv.reserveOf("pistol")).toBe(0);
    // À sec : un claquement par appui.
    let dry = 0;
    for (let k = 0; k < 30; k++) if (g.step(DT, true, false, WEAPONS.pistol, inv, 0, 0, 0, w).dry) dry++;
    expect(dry).toBe(0);
    g.step(DT, false, false, WEAPONS.pistol, inv, 0, 0, 0, w);
    expect(g.step(DT, true, false, WEAPONS.pistol, inv, 0, 0, 0, w).dry).toBe(true);
  });

  it("on ne tire pas pendant un rechargement demandé à la main ; changer d'arme ne casse rien", () => {
    const inv = armed("rifle", 50);
    const g = new Gun(5), w = world([]);
    g.step(DT, true, false, WEAPONS.rifle, inv, 0, 0, 0, w);
    expect(inv.magOf("rifle")).toBe(29);
    const r = g.step(DT, false, true, WEAPONS.rifle, inv, 0, 0, 0, w);
    expect(r.reloadStarted).toBe(true);
    // Le rechargement du fusil d'assaut dure 1,8 s : rien ne part pendant la première seconde, puis le tir reprend avec un chargeur plein.
    let fired = 0;
    for (let k = 0; k < 60; k++) fired += g.step(DT, true, false, WEAPONS.rifle, inv, 0, 0, 0, w).fired;
    expect(fired).toBe(0);
    for (let k = 0; k < 60; k++) fired += g.step(DT, true, false, WEAPONS.rifle, inv, 0, 0, 0, w).fired;
    expect(fired).toBeGreaterThan(0);
    expect(inv.magOf("rifle")).toBeGreaterThan(20);
    g.cancel();
    expect(g.reloading).toBe(0);
    // La mêlée n'est pas gérée ici.
    expect(g.step(DT, true, false, WEAPONS.fists, inv, 0, 0, 0, w).fired).toBe(0);
  });

  it("la dispersion est reproductible pour une graine et reste dans le cône de l'arme", () => {
    const shoot = (seed: number): number[] => {
      const g = new Gun(seed), inv = armed("rifle", 200), w = world([]), out: number[] = [];
      for (let k = 0; k < 120; k++) {
        const r = g.step(DT, true, false, WEAPONS.rifle, inv, 0, 0, 0, w);
        if (r.fired) out.push(Math.atan2(r.shots[0]!.x1 - r.shots[0]!.x0, r.shots[0]!.y1 - r.shots[0]!.y0));
      }
      return out;
    };
    const a = shoot(3), b = shoot(3), c = shoot(4);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const angle of a) expect(Math.abs(angle)).toBeLessThanOrEqual(WEAPONS.rifle.spread + 1e-9);
  });
});
