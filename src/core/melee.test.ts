import { describe, expect, it } from "vitest";
import { Melee, type Arena } from "./melee";
import { WEAPONS } from "./weapons";

/** Des cibles immobiles : (x, y), debout ; `hurt` consigne les coups. */
function arena(targets: { x: number; y: number }[]): Arena & { log: { slot: number; damage: number; impulse: number }[]; down: Set<number> } {
  const log: { slot: number; damage: number; impulse: number }[] = [];
  const down = new Set<number>();
  return {
    log,
    down,
    pick(x, y, heading, range, half, max, out) {
      out.length = 0;
      const list: { i: number; d: number }[] = [];
      targets.forEach((t, i) => {
        if (down.has(i)) return;
        const dx = t.x - x, dy = t.y - y, d = Math.hypot(dx, dy);
        const da = Math.abs(((Math.atan2(dx, dy) - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (d <= range + 0.28 && (d < 0.4 || da <= half)) list.push({ i, d });
      });
      list.sort((a, b) => a.d - b.d);
      for (const e of list.slice(0, max)) out.push(e.i);
      return out.length;
    },
    position: (slot, out) => Object.assign(out, targets[slot]),
    hurt(slot, damage, _ux, _uy, impulse) {
      log.push({ slot, damage, impulse });
      return 1;
    },
  };
}

const DT = 1 / 60;
function swing(m: Melee, weapon = WEAPONS.fists, a: Arena | null, held = true, seconds = 1): { hits: number; started: number } {
  let hits = 0, started = 0;
  for (let t = 0; t < seconds; t += DT) {
    const r = m.step(DT, held, weapon, 0, 0, 0, a);
    hits += r.hits;
    started += r.started ? 1 : 0;
  }
  return { hits, started };
}

describe("corps à corps du joueur (J5-1)", () => {
  it("un coup de poing touche au moment de la frappe, pas avant, et une seule fois", () => {
    const a = arena([{ x: 0, y: 1 }]);
    const m = new Melee();
    let hitAt = -1;
    for (let k = 0; k < 60; k++) {
      const r = m.step(DT, k === 0, WEAPONS.fists, 0, 0, 0, a);
      if (r.hits > 0 && hitAt < 0) hitAt = (k + 1) * DT;
    }
    expect(a.log.length).toBe(1);
    expect(a.log[0]!.damage).toBe(12);
    expect(hitAt).toBeGreaterThan(0.4 * WEAPONS.fists.hitAt);
    expect(hitAt).toBeLessThan(0.4 * WEAPONS.fists.hitAt + 0.5);
    expect(m.active).toBe(false);
  });

  it("rien à portée : le coup part dans le vide ; hors du cône : rien non plus", () => {
    const m = new Melee();
    const far = arena([{ x: 0, y: 3 }]);
    expect(swing(m, WEAPONS.fists, far).hits).toBe(0);
    const behind = arena([{ x: 0, y: -1 }]);
    const m2 = new Melee();
    expect(swing(m2, WEAPONS.fists, behind).hits).toBe(0);
  });

  it("la visée assistée tourne le coup vers la cible la plus proche dans un large cône, mais le coup ne touche que ce qui est à portée", () => {
    const side = arena([{ x: 1, y: 0.6 }]);
    const m = new Melee();
    m.step(DT, true, WEAPONS.fists, 0, 0, 0, side);
    expect(m.facing).toBeCloseTo(Math.atan2(1, 0.6), 6);
    const m2 = new Melee();
    const out = arena([{ x: 0, y: 2.5 }]);
    m2.step(DT, true, WEAPONS.fists, 0, 0, 0, out);
    // À 2,5 m : dans l'aide (1,2 + 1,6), le corps se tourne, mais le poing n'arrive pas.
    expect(m2.facing).toBeCloseTo(0, 6);
    expect(swing(m2, WEAPONS.fists, out).hits).toBe(0);
    // Hors de l'aide : aucun changement de cap.
    const m3 = new Melee();
    m3.step(DT, true, WEAPONS.fists, 0, 0, 1, arena([{ x: 0, y: 6 }]));
    expect(m3.facing).toBe(1);
  });

  it("les poings alternent et le troisième coup de la série fait tomber ; la série retombe après une pause", () => {
    const a = arena([{ x: 0, y: 0.9 }]);
    const m = new Melee();
    const sides: number[] = [];
    for (let t = 0; t < 1.3; t += DT) {
      const r = m.step(DT, true, WEAPONS.fists, 0, 0, 0, a);
      if (r.started) sides.push(m.side);
    }
    expect(sides.slice(0, 4)).toEqual([1, -1, 1, -1]);
    expect(a.log.length).toBeGreaterThanOrEqual(3);
    expect(a.log[0]!.impulse).toBeLessThan(3.5);
    expect(a.log[1]!.impulse).toBeLessThan(3.5);
    expect(a.log[2]!.impulse).toBeGreaterThan(3.5);
    // Une pause plus longue que la fenêtre : on repart de zéro.
    for (let t = 0; t < 2; t += DT) m.step(DT, false, WEAPONS.fists, 0, 0, 0, a);
    expect(m.combo).toBe(0);
    m.step(DT, true, WEAPONS.fists, 0, 0, 0, a);
    expect(m.combo).toBe(1);
  });

  it("le couteau frappe plus fort et plus loin ; la batte balaie deux cibles et fait tomber", () => {
    const a = arena([{ x: 0, y: 1.5 }]);
    expect(swing(new Melee(), WEAPONS.fists, a, true, 0.5).hits).toBe(0);
    const k = arena([{ x: 0, y: 1.5 }]);
    expect(swing(new Melee(), WEAPONS.knife, k, true, 0.5).hits).toBe(1);
    expect(k.log[0]!.damage).toBe(40);
    const b = arena([{ x: 0, y: 1.6 }, { x: 0.5, y: 1.2 }, { x: -0.4, y: 1.7 }]);
    expect(swing(new Melee(), WEAPONS.bat, b, true, 1).hits).toBe(2);
    expect(b.log.every((e) => e.impulse > 3.5)).toBe(true);
    expect(b.log.every((e) => e.damage === 30)).toBe(true);
  });

  it("tenir le bouton enchaîne au rythme de l'arme, le lâcher laisse finir le coup puis s'arrête", () => {
    const a = arena([]);
    const m = new Melee();
    const { started } = swing(m, WEAPONS.knife, a, true, 2.05);
    // 2 coups par seconde : 4 coups en un peu plus de 2 s.
    expect(started).toBe(5 - 1);
    const m2 = new Melee();
    m2.step(DT, true, WEAPONS.knife, 0, 0, 0, a);
    for (let k = 0; k < 90; k++) m2.step(DT, false, WEAPONS.knife, 0, 0, 0, a);
    expect(m2.active).toBe(false);
  });

  it("les armes à feu ne se jouent pas ici ; changer d'arme annule le coup en cours", () => {
    const m = new Melee();
    expect(m.step(DT, true, WEAPONS.pistol, 0, 0, 0, null).started).toBe(false);
    m.step(DT, true, WEAPONS.knife, 0, 0, 0, null);
    expect(m.active).toBe(true);
    m.step(DT, false, WEAPONS.bat, 0, 0, 0, null);
    expect(m.active).toBe(false);
  });
});
