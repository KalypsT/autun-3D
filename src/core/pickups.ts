import { MAX_HEALTH } from "./health";
import { reserveCap, WEAPONS, type Inventory, type WeaponId } from "./weapons";

/**
 * Objets au sol (J5-3, D84 ; D159) : treize caches d'armes fixes dans la ville, qui réapparaissent, les armes lâchées (par les gendarmes tués, J5-5)
 * et, devant chaque pharmacie, une croix verte qui rend toute la santé. Logique pure. **On les ramasse en marchant dessus** (D159), sans bouton.
 *
 * Les positions sont des points de la navigation piétonne près de lieux d'Autun, dégagés sur 80 cm (test) ; les armes blanches sont près du départ,
 * les pistolets à 300 à 600 m, les fusils à pompe à 800 m et plus, le fusil d'assaut tout au bout. Il n'y a pas d'argent avant J6 : trouver une arme
 * est la seule façon d'en avoir.
 */

export interface CacheSite {
  weapon: WeaponId;
  x: number;
  y: number;
  label: string;
}

export const CACHES: readonly CacheSite[] = [
  { weapon: "bat", x: 30.8, y: -48.0, label: "Monument aux morts" },
  { weapon: "bat", x: -11.7, y: -206.7, label: "Hôtel de Chevannes" },
  { weapon: "bat", x: -206.4, y: -285.2, label: "Remparts romains" },
  { weapon: "knife", x: 0.0, y: 56.0, label: "Théâtre municipal" },
  { weapon: "knife", x: 122.8, y: -77.4, label: "Hôtel Saint-Louis" },
  { weapon: "knife", x: -474.0, y: 460.1, label: "Gare routière" },
  { weapon: "pistol", x: 421.1, y: 13.2, label: "Pseudo-Temple d'Apollon" },
  { weapon: "pistol", x: -135.6, y: 211.7, label: "Café de la Bourse" },
  { weapon: "pistol", x: 183.4, y: -494.9, label: "Parc" },
  { weapon: "pistol", x: 101.1, y: 398.4, label: "Tour de l'Horloge" },
  { weapon: "shotgun", x: 787.4, y: 294.0, label: "Théâtre romain" },
  { weapon: "shotgun", x: 542.8, y: 847.3, label: "Porte Saint-André" },
  { weapon: "rifle", x: 1197.5, y: -750.1, label: "Pyramide de Couhard" },
];

/** Balles d'une cache (armes à feu) : un chargeur plein et autant en réserve ; le fusil d'assaut deux chargeurs en réserve. */
export const CACHE_ROUNDS: Partial<Record<WeaponId, number>> = { pistol: 24, shotgun: 18, rifle: 90 };
/**
 * Croix vertes de soin (D159), une devant chaque pharmacie : points de la navigation piétonne sur le trottoir ou la place, en face de la devanture,
 * dégagés sur 50 cm (test). Ramasser une croix rend toute la santé ; elle revient après `HEAL_RESPAWN` s.
 */
export const HEAL_SITES: readonly HealSite[] = [
  { x: 60.5, y: -32.7, label: "Grande Pharmacie Bonaparte" },
  { x: 91.8, y: -66.7, label: "Pharmacie de l'Arbalète" },
  { x: -317.0, y: 464.7, label: "Pharmacie de la Gare" },
  { x: 267.0, y: 707.1, label: "Pharmacie de la Croix Blanche" },
  { x: 999.4, y: 1353.3, label: "Pharmacie de Saint-Pan" },
];

export interface HealSite {
  x: number;
  y: number;
  label: string;
}

/** Une croix de soin ramassée réapparaît après … s (plus vite qu'une cache d'arme). */
export const HEAL_RESPAWN = 120;
/** On ramasse en marchant dessus : à moins de … m. */
export const PICKUP_REACH = 1.3;
/** Une cache ramassée réapparaît après … s ; une arme lâchée disparaît après … s. */
export const CACHE_RESPAWN = 300;
export const DROP_LIFE = 180;

/** Ce que contient un objet au sol. */
export type PickupKind = "weapon" | "heal";

/** Ce que la croix de soin a besoin de connaître du joueur. */
export interface Healer {
  readonly hp: number;
  readonly dead: boolean;
  heal(n: number): void;
}

export interface Pickup {
  id: number;
  x: number;
  y: number;
  kind: PickupKind;
  /** L'arme (ou null pour une croix de soin). */
  weapon: WeaponId | null;
  rounds: number;
  label: string;
  /** Instant (horloge de `Pickups`) où elle est de nouveau disponible ; 0 : disponible. */
  readyAt: number;
  /** Arme lâchée : elle disparaît à `expires` au lieu de réapparaître. */
  dropped: boolean;
  expires: number;
}

export class Pickups {
  readonly list: Pickup[] = [];
  /** Horloge (s) : avance à chaque pas de jeu (la pause la fige). */
  time = 0;
  private nextId = 0;

  constructor(sites: readonly CacheSite[] = CACHES, heals: readonly HealSite[] = HEAL_SITES) {
    for (const c of sites) this.list.push({ id: this.nextId++, x: c.x, y: c.y, kind: "weapon", weapon: c.weapon, rounds: CACHE_ROUNDS[c.weapon] ?? 0, label: c.label, readyAt: 0, dropped: false, expires: Infinity });
    for (const h of heals) this.list.push({ id: this.nextId++, x: h.x, y: h.y, kind: "heal", weapon: null, rounds: 0, label: h.label, readyAt: 0, dropped: false, expires: Infinity });
  }

  available(p: Pickup): boolean {
    return this.time >= p.readyAt;
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.dropped && this.time >= this.list[i]!.expires) this.list.splice(i, 1);
  }

  /** Arme lâchée en (x, y) (J5-5 : le gendarme tué). */
  drop(x: number, y: number, weapon: WeaponId, rounds: number): Pickup {
    const p: Pickup = { id: this.nextId++, x, y, kind: "weapon", weapon, rounds, label: "arme lâchée", readyAt: 0, dropped: true, expires: this.time + DROP_LIFE };
    this.list.push(p);
    return p;
  }

  /** La plus proche des armes disponibles à moins de `r` de (x, y), ou null. */
  nearest(x: number, y: number, r: number): Pickup | null {
    let best: Pickup | null = null, bd = r;
    for (const p of this.list) {
      if (!this.available(p)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /**
   * Peut-on la ramasser ? Une arme : pas une arme blanche qu'on a déjà, pas des balles dont la réserve est pleine. Une croix de soin : seulement
   * si le joueur est vivant et blessé (à santé pleine elle reste là, pour plus tard).
   */
  canTake(p: Pickup, inv: Inventory, health?: Healer): boolean {
    if (!this.available(p)) return false;
    if (p.kind === "heal") return !!health && !health.dead && health.hp < MAX_HEALTH;
    const def = WEAPONS[p.weapon!];
    if (!inv.has(p.weapon!)) return true;
    return def.kind === "gun" && inv.reserveOf(p.weapon!) < reserveCap(def);
  }

  /** Ramasse : l'arme (et les balles) va dans l'inventaire, la croix rend toute la santé ; une cache ou une croix réapparaîtra, une arme lâchée disparaît. */
  take(p: Pickup, inv: Inventory, health?: Healer): boolean {
    if (!this.canTake(p, inv, health)) return false;
    if (p.kind === "heal") {
      health!.heal(MAX_HEALTH);
      p.readyAt = this.time + HEAL_RESPAWN;
      return true;
    }
    const fresh = !inv.has(p.weapon!);
    inv.grant(p.weapon!, p.rounds);
    // Une arme qu'on n'avait pas passe dans la main.
    if (fresh) inv.select(p.weapon!);
    if (p.dropped) p.expires = this.time;
    else p.readyAt = this.time + CACHE_RESPAWN;
    return true;
  }

  /** Ramasse l'objet ramassable le plus proche sous les pieds (ramassage automatique, D159) : l'objet pris, ou null. */
  collect(x: number, y: number, inv: Inventory, health?: Healer): Pickup | null {
    let best: Pickup | null = null, bd = PICKUP_REACH;
    for (const p of this.list) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd && this.canTake(p, inv, health)) {
        bd = d;
        best = p;
      }
    }
    return best && this.take(best, inv, health) ? best : null;
  }
}
