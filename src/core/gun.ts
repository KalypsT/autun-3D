import { type Arena } from "./melee";
import { type Inventory, type WeaponDef } from "./weapons";

/**
 * Armes à feu du joueur (J5-3, D84). Logique pure : le tir est instantané (un rayon, pas une balle qui vole), avec visée assistée, dispersion, chargeur
 * et rechargement. Le rendu (traits, éclairs, étincelles) lit `shots`.
 *
 * Analogie : un pointeur laser. On braque l'arme vers la personne la plus proche dans un large cône devant la caméra (le pouce n'a pas la précision d'une
 * souris), le rayon part, s'arrête au premier mur ou à la première personne ; un fusil à pompe lance huit rayons en éventail, plus faibles de loin.
 */

/** Ce que le tir demande au monde : les passants (`Arena`), le premier passant sur un rayon, et le premier mur (fraction 0 à 1 du segment, null sinon). */
export interface ShootWorld extends Arena {
  rayPed(x: number, y: number, dx: number, dy: number, maxDist: number, out: { slot: number; dist: number }): boolean;
  wall(ax: number, ay: number, bx: number, by: number): number | null;
}

/** Demi-angle (rad) du cône de visée assistée autour du regard de la caméra. */
export const GUN_ASSIST_ANGLE = 0.7;
/** Les armes pointent à la hauteur de la poitrine : le trait part d'un peu devant le joueur. */
export const MUZZLE = 0.55;
/** Après un tir, le personnage reste en position de tir (s). */
export const AIM_HOLD = 1.4;
/** Plancher des dégâts d'un plomb éloigné (fraction des dégâts de près). */
export const FALLOFF_MIN = 0.25;

/** Un rayon tiré à ce pas, pour le rendu : départ, arrivée, ce qui a été touché (0 rien, 1 mur, 2 personne). */
export interface Shot {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: 0 | 1 | 2;
}

export interface GunResult {
  /** Tirs partis à ce pas (une cartouche, quel que soit le nombre de plombs). */
  fired: number;
  /** Personnes touchées, dont tuées. */
  hits: number;
  killed: number;
  /** Le chargeur est vide et la réserve aussi : la détente claque dans le vide (une fois par appui). */
  dry: boolean;
  /** Un rechargement vient de commencer, de finir. */
  reloadStarted: boolean;
  reloadDone: boolean;
  /** Rayons de ce pas (valables pour `fxCount` entrées). */
  shots: Shot[];
  fxCount: number;
}

const MAX_SHOTS = 12;

export class Gun {
  /** Cap voulu (rad) : vers la cible assistée, sinon le regard ; le jeu y tourne le joueur. */
  facing = 0;
  /** Il y a une cible assistée. */
  targeted = false;
  /** Emplacement de la cible assistée (−1 sans). */
  target = -1;
  /** Secondes de rechargement restantes (0 : pas en train de recharger). */
  reloading = 0;
  /** Secousse du dernier tir : 1 au tir, retombe à 0 en 0,18 s. */
  recoil = 0;
  /** Secondes depuis le dernier tir ou le dernier appui. */
  idle = Infinity;
  readonly result: GunResult = { fired: 0, hits: 0, killed: 0, dry: false, reloadStarted: false, reloadDone: false, shots: Array.from({ length: MAX_SHOTS }, () => ({ x0: 0, y0: 0, x1: 0, y1: 0, kind: 0 as 0 | 1 | 2 })), fxCount: 0 };
  private cooldown = 0;
  private pressed = false;
  private rng: number;
  private readonly found: number[] = [];
  private readonly pos = { x: 0, y: 0 };
  private readonly hit = { slot: -1, dist: 0 };
  private readonly damage = new Map<number, { dmg: number; nx: number; ny: number }>();

  constructor(seed = 1) {
    this.rng = (seed >>> 0) || 1;
  }

  /** En position de tir (bouton tenu, ou tir récent) : pour la pose. Fondu 0 à 1. */
  get aim(): number {
    return this.idle < AIM_HOLD ? 1 : 0;
  }

  cancel(): void {
    this.reloading = 0;
    this.recoil = 0;
    this.cooldown = 0;
    this.targeted = false;
    this.target = -1;
    this.pressed = false;
  }

  /** Nombre pseudo-aléatoire de 0 à 1 (graine du tireur : la même série de tirs donne les mêmes rayons). */
  private random(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /**
   * Un pas de `dt` s. `want` : bouton tenu ; `reload` : demande de rechargement (touche) ; (x, y) : le joueur ; `look` : cap du regard de la caméra (rad) ;
   * `world` : les passants et les murs (null : rien à toucher). Renvoie `result` (réutilisé).
   */
  step(dt: number, want: boolean, reload: boolean, weapon: WeaponDef, inv: Inventory, x: number, y: number, look: number, world: ShootWorld | null): GunResult {
    const res = this.result;
    res.fired = res.hits = res.killed = res.fxCount = 0;
    res.dry = res.reloadStarted = res.reloadDone = false;
    this.recoil = Math.max(0, this.recoil - dt / 0.18);
    this.idle += dt;
    if (want) this.idle = Math.min(this.idle, 0);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.facing = look;
    this.targeted = false;
    this.target = -1;
    if (weapon.kind !== "gun") return res;
    const id = weapon.id;
    // Visée assistée : la personne la plus proche du regard dans le cône, à portée, sans mur entre elle et nous.
    if (world && (want || this.idle < AIM_HOLD) && world.pick(x, y, look, weapon.range, GUN_ASSIST_ANGLE, 4, this.found) > 0) {
      for (const slot of this.found) {
        world.position(slot, this.pos);
        const wall = world.wall(x, y, this.pos.x, this.pos.y);
        if (wall !== null && wall < 0.98) continue;
        this.target = slot;
        this.targeted = true;
        this.facing = Math.atan2(this.pos.x - x, this.pos.y - y);
        break;
      }
    }
    // Rechargement en cours.
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        inv.reload(id);
        res.reloadDone = true;
      }
      this.pressed = want;
      return res;
    }
    const wantReload = reload || (want && inv.magOf(id) === 0);
    if (wantReload && inv.canReload(id)) {
      this.reloading = weapon.reload;
      res.reloadStarted = true;
      this.pressed = want;
      return res;
    }
    if (!want) {
      this.pressed = false;
      return res;
    }
    if (this.cooldown > 0) {
      this.pressed = true;
      return res;
    }
    if (!inv.fire(id)) {
      // Rien à tirer : un claquement par appui.
      res.dry = !this.pressed;
      this.pressed = true;
      return res;
    }
    this.pressed = true;
    this.cooldown = 1 / weapon.rate;
    this.recoil = 1;
    this.shoot(weapon, x, y, world, res);
    return res;
  }

  private shoot(weapon: WeaponDef, x: number, y: number, world: ShootWorld | null, res: GunResult): void {
    res.fired = 1;
    this.damage.clear();
    const mx = x + Math.sin(this.facing) * MUZZLE, my = y + Math.cos(this.facing) * MUZZLE;
    for (let k = 0; k < weapon.pellets && res.fxCount < MAX_SHOTS; k++) {
      // Dispersion : triangulaire (plus de tirs près de l'axe qu'au bord du cône).
      const a = this.facing + (this.random() + this.random() - 1) * weapon.spread;
      const dx = Math.sin(a), dy = Math.cos(a);
      let dist = weapon.range, kind: 0 | 1 | 2 = 0;
      if (world) {
        const wall = world.wall(mx, my, mx + dx * weapon.range, my + dy * weapon.range);
        if (wall !== null) {
          dist = wall * weapon.range;
          kind = 1;
        }
        if (world.rayPed(mx, my, dx, dy, dist, this.hit)) {
          dist = this.hit.dist;
          kind = 2;
          const per = weapon.falloff ? Math.max(FALLOFF_MIN, 1 - (dist / weapon.range) * (1 - FALLOFF_MIN)) : 1;
          const e = this.damage.get(this.hit.slot);
          if (e) e.dmg += weapon.damage * per;
          else this.damage.set(this.hit.slot, { dmg: weapon.damage * per, nx: dx, ny: dy });
        }
      }
      const s = res.shots[res.fxCount++]!;
      s.x0 = mx;
      s.y0 = my;
      s.x1 = mx + dx * dist;
      s.y1 = my + dy * dist;
      s.kind = kind;
    }
    // Les plombs d'un même tir touchent ensemble : les dégâts s'additionnent avant d'être appliqués (un coup, une seule chute).
    if (world) {
      for (const [slot, e] of this.damage) {
        const r = world.hurt(slot, e.dmg, e.nx, e.ny, weapon.impulse);
        if (r > 0) res.hits++;
        if (r === 2) res.killed++;
      }
    }
  }
}
