import { KNOCKDOWN_IMPULSE, strikeTime, type WeaponDef } from "./weapons";

/**
 * Corps à corps du joueur (J5-1, D80). Logique pure : un coup = un départ, un moment où il touche (`hitAt` de sa durée), un retour ; on peut
 * enchaîner tant que le bouton est tenu. La cible est choisie à l'aide : le coup part vers la personne la plus proche dans un large cône devant
 * (le doigt n'a pas la précision d'une souris), le corps se tourne vers elle, mais le coup ne touche que ce qui est à portée au moment où il part.
 *
 * Analogie : un boxeur qui lance son poing vers l'adversaire le plus proche, puis regarde qui est vraiment au bout.
 */

/** Ce que le combat demande aux passants (`PedSim` en est une réalisation, un double sert aux tests). */
export interface Arena {
  /**
   * Passants debout dans le cône (cap `heading`, demi-angle `halfAngle`) à moins de `range` (centre à centre moins le rayon du corps) de (x, y) ;
   * leurs emplacements, du plus proche au plus loin, au plus `max`, dans `out` (vidé d'abord). Renvoie leur nombre.
   */
  pick(x: number, y: number, heading: number, range: number, halfAngle: number, max: number, out: number[]): number;
  /** Position d'un passant. */
  position(slot: number, out: { x: number; y: number }): void;
  /** Frappe un passant : points de vie retirés, direction du coup (vecteur unitaire), impulsion (m/s). Renvoie 0 rien, 1 blessé, 2 assommé. */
  hurt(slot: number, damage: number, ux: number, uy: number, impulse: number): number;
}

/** Demi-angle (rad) du cône de visée assistée au départ du coup, et portée supplémentaire de l'aide (m). */
export const ASSIST_ANGLE = 1.15;
export const ASSIST_REACH = 1.6;
/** Demi-angle (rad) du cône d'impact au moment du coup. */
export const STRIKE_ANGLE = 0.8;
/** Un coup de poing de plus dans les 0,9 s prolonge la série ; le troisième fait tomber. */
export const COMBO_WINDOW = 0.9;
export const COMBO_FINISHER = 3;

export interface MeleeResult {
  /** Coups portés à ce pas (cibles touchées). */
  hits: number;
  /** Cibles blessées ou assommées à ce pas (`Arena.hurt` ≥ 1). */
  hurt: number;
  /** Un coup vient de partir. */
  started: boolean;
}

export class Melee {
  /** Un coup est en cours. */
  active = false;
  /** Secondes écoulées depuis le départ du coup, et durée de ce coup. */
  t = 0;
  duration = 0;
  /** Poing de la série : +1 droit, −1 gauche (alterne) ; sert aussi à retourner l'animation. */
  side: 1 | -1 = 1;
  /** Rang du coup dans la série de poings (1, 2, 3…). */
  combo = 0;
  /** Cap voulu par le coup en cours (rad) : le jeu y tourne le joueur ; null hors coup. */
  facing: number | null = null;
  /** Arme du coup en cours. */
  weapon: WeaponDef | null = null;
  private struck = false;
  private comboT = 0;
  private readonly found: number[] = [];
  private readonly pos = { x: 0, y: 0 };
  readonly result: MeleeResult = { hits: 0, hurt: 0, started: false };

  /** Progression du coup (0 à 1), 0 hors coup. */
  get progress(): number {
    return this.active && this.duration > 0 ? Math.min(1, this.t / this.duration) : 0;
  }

  /** Remet tout à zéro (mort, arrestation, changement d'arme, montée dans un véhicule). */
  cancel(): void {
    this.active = false;
    this.facing = null;
    this.weapon = null;
    this.t = 0;
    this.combo = 0;
    this.comboT = 0;
  }

  /**
   * Un pas de `dt` secondes. `want` : le bouton est tenu ; `weapon` : l'arme en main ; (x, y, heading) : le joueur. Renvoie `result` (réutilisé).
   * Les armes à feu ne sont pas gérées ici (J5-3).
   */
  step(dt: number, want: boolean, weapon: WeaponDef, x: number, y: number, heading: number, arena: Arena | null): MeleeResult {
    const res = this.result;
    res.hits = res.hurt = 0;
    res.started = false;
    if (this.active && this.weapon !== weapon) this.cancel();
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (!this.active) {
      if (!want || weapon.kind !== "melee") return res;
      this.begin(weapon, x, y, heading, arena);
      res.started = true;
    }
    this.t += dt;
    if (!this.struck && this.t >= this.duration * weapon.hitAt) {
      this.struck = true;
      this.strike(weapon, x, y, this.facing ?? heading, arena, res);
    }
    if (this.t >= this.duration) {
      this.active = false;
      this.facing = null;
    }
    return res;
  }

  private begin(weapon: WeaponDef, x: number, y: number, heading: number, arena: Arena | null): void {
    this.active = true;
    this.weapon = weapon;
    this.t = 0;
    this.duration = strikeTime(weapon);
    this.struck = false;
    if (weapon.style === "punch") {
      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.side = this.combo % 2 === 1 ? 1 : -1;
    } else {
      this.combo = 0;
      this.side = 1;
    }
    this.comboT = COMBO_WINDOW + this.duration;
    let facing = heading;
    if (arena && arena.pick(x, y, heading, weapon.range + ASSIST_REACH, ASSIST_ANGLE, 1, this.found) > 0) {
      arena.position(this.found[0]!, this.pos);
      facing = Math.atan2(this.pos.x - x, this.pos.y - y);
    }
    this.facing = facing;
  }

  private strike(weapon: WeaponDef, x: number, y: number, facing: number, arena: Arena | null, res: MeleeResult): void {
    if (!arena) return;
    const n = arena.pick(x, y, facing, weapon.range, STRIKE_ANGLE, weapon.maxTargets, this.found);
    const knock = weapon.knockdown || (weapon.style === "punch" && this.combo >= COMBO_FINISHER);
    for (let k = 0; k < n; k++) {
      const slot = this.found[k]!;
      arena.position(slot, this.pos);
      const dx = this.pos.x - x, dy = this.pos.y - y, d = Math.hypot(dx, dy) || 1;
      res.hits++;
      if (arena.hurt(slot, weapon.damage, dx / d, dy / d, knock ? Math.max(weapon.impulse, KNOCKDOWN_IMPULSE) : weapon.impulse) > 0) res.hurt++;
    }
  }
}
