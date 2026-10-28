import type { Colliders } from "../core/collision";
import { Gun, type GunResult, type ShootWorld } from "../core/gun";
import { ALARM_SHOT, ALARM_SHOT_FLEE, type PedSim } from "../core/pedestrians";
import { Inventory, WEAPONS } from "../core/weapons";

/**
 * Un tireur automatique (J5-6, D86) pour le banc (`?bench=1&combat=1`) et les essais sans écran : fusil d'assaut en main, il tire sans arrêt sur le passant le plus
 * proche à moins de 40 m (comme un joueur qui ne rate jamais le bouton), recharge tout seul, reçoit un chargeur plein toutes les minutes (une cache), et son tir
 * effraie les passants à 40 m comme dans le jeu. Il ne simule ni la santé ni la police : celles-ci ont leurs propres essais.
 */
export class CombatBot {
  readonly gun: Gun;
  readonly inventory = new Inventory();
  /** Cumul depuis la création : tirs, personnes touchées, tuées. */
  shots = 0;
  hits = 0;
  kills = 0;
  private clock = 0;
  private heading = 0;
  private readonly found: number[] = [];
  private readonly pos = { x: 0, y: 0 };
  private readonly world: ShootWorld;

  constructor(private readonly peds: PedSim, colliders: Colliders, seed = 5) {
    this.gun = new Gun(seed);
    this.inventory.grant("rifle", 90);
    this.inventory.select("rifle");
    this.world = {
      pick: (x, y, h, r, a, m, out) => this.pickPeds(x, y, h, r, a, m, out),
      position: (s, o) => peds.position(s, o),
      hurt: (s, d, ux, uy, i) => peds.damage(s, d, ux, uy, i),
      rayPed: (x, y, dx, dy, m, out) => peds.rayPed(x, y, dx, dy, m, out),
      wall: (ax, ay, bx, by) => colliders.raycast(ax, ay, bx, by),
    };
  }

  /** Les passants seulement : les gendarmes (emplacements réservés) ont leur propre essai, le tireur ne les vise pas. */
  private pickPeds(x: number, y: number, h: number, r: number, a: number, m: number, out: number[]): number {
    this.peds.pick(x, y, h, r, a, m + 6, out);
    for (let i = out.length - 1; i >= 0; i--) if (out[i]! >= this.peds.reservedStart) out.splice(i, 1);
    if (out.length > m) out.length = m;
    return out.length;
  }

  /** Un pas de `dt` s du tireur en (x, y). Renvoie le résultat du tir (rayons de ce pas pour le rendu). */
  step(dt: number, x: number, y: number): GunResult {
    this.clock += dt;
    if (this.clock >= 60) {
      this.clock -= 60;
      this.inventory.grant("rifle", 90);
    }
    if (this.pickPeds(x, y, 0, 40, Math.PI, 1, this.found) > 0) {
      this.peds.position(this.found[0]!, this.pos);
      this.heading = Math.atan2(this.pos.x - x, this.pos.y - y);
    }
    const r = this.gun.step(dt, true, false, WEAPONS.rifle, this.inventory, x, y, this.heading, this.world);
    if (r.fired > 0) {
      this.shots += r.fired;
      this.hits += r.hits;
      this.kills += r.killed;
      this.peds.alarm(x, y, ALARM_SHOT, ALARM_SHOT_FLEE);
    }
    return r;
  }
}
