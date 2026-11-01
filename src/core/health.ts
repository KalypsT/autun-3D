/**
 * Santé du joueur (J5-0, D80) : logique pure. Des points de vie, une régénération lente qui s'arrête à mi-chemin, une mort.
 *
 * Analogie : un réservoir à fuite. Les coups le vident ; au repos (six secondes sans coup), il se remplit goutte à goutte, mais seulement
 * jusqu'au repère de mi-hauteur : pour le remplir à fond, il faut passer par l'hôpital (reprise après une mort), par la croix verte d'une pharmacie (D159) ou, plus tard, par la caisse (J6).
 */

export const MAX_HEALTH = 100;
/** La régénération s'arrête à ce niveau (points de vie). */
export const REGEN_CAP = 50;
/** Secondes sans dégâts avant que la régénération démarre. */
export const REGEN_DELAY = 6;
/** Points de vie rendus par seconde. */
export const REGEN_RATE = 2.5;
/** Heures de jeu passées à l'hôpital après une mort. */
export const DEATH_HOURS = 3;
/** Reprise après une mort : la cour du Centre hospitalier d'Autun (site Latouche, ≈ 300 m à l'est de la mairie), dégagée sur 2 m autour (test). */
export const HOSPITAL_SPAWN = { x: 211.4, y: 216.6, heading: 0 } as const;

export class Health {
  /** Points de vie, 0 (mort) à `MAX_HEALTH`. */
  hp: number;
  /** Secondes depuis le dernier dégât. */
  sinceHurt = Infinity;
  private died = false;
  private hurt = 0;

  constructor(hp: number = MAX_HEALTH) {
    this.hp = Math.min(Math.max(hp, 0), MAX_HEALTH);
    this.died = this.hp <= 0;
  }

  get dead(): boolean {
    return this.hp <= 0;
  }

  /** Fraction de 0 à 1. */
  get fraction(): number {
    return this.hp / MAX_HEALTH;
  }

  /** Dégâts pris depuis le dernier `takeHurt` (pour le flash d'écran) ; remis à zéro à la lecture. */
  takeHurt(): number {
    const h = this.hurt;
    this.hurt = 0;
    return h;
  }

  /** Retire des points de vie. Renvoie vrai si ce coup tue. Un mort ne prend plus de dégâts. */
  damage(n: number): boolean {
    if (this.hp <= 0 || !(n > 0)) return false;
    const taken = Math.min(n, this.hp);
    this.hp -= taken;
    this.hurt += taken;
    this.sinceHurt = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.died = true;
      return true;
    }
    return false;
  }

  /** Rend des points de vie, jusqu'à `MAX_HEALTH`. */
  heal(n: number): void {
    if (this.hp <= 0 || !(n > 0)) return;
    this.hp = Math.min(MAX_HEALTH, this.hp + n);
  }

  /** Impose les points de vie (essais, reprise d'une partie). 0 tue. */
  set(hp: number): void {
    this.hp = Math.min(Math.max(hp, 0), MAX_HEALTH);
    this.sinceHurt = Infinity;
    this.died = this.hp <= 0;
  }

  /** Santé pleine, ni mort ni dégât en attente (reprise à l'hôpital). */
  restore(): void {
    this.hp = MAX_HEALTH;
    this.sinceHurt = Infinity;
    this.died = false;
    this.hurt = 0;
  }

  update(dt: number): void {
    if (this.hp <= 0 || !(dt > 0)) return;
    this.sinceHurt += dt;
    if (this.sinceHurt >= REGEN_DELAY && this.hp < REGEN_CAP) this.hp = Math.min(REGEN_CAP, this.hp + REGEN_RATE * dt);
  }

  /** Vrai une seule fois après une mort : le jeu fait alors la reprise. */
  takeDeath(): boolean {
    const d = this.died;
    this.died = false;
    return d;
  }
}

/** Chute d'un deux-roues (D98) : points de vie perdus par km/h au moment de la chute. */
export const FALL_DAMAGE_PER_KMH = 0.8;

/**
 * Blessure d'une chute à `speed` m/s, proportionnelle à la vitesse (15 km/h : 12 points, 50 : 40, 100 : 80), jamais mortelle :
 * on garde au moins un point de vie sur les `hp` qu'on avait.
 */
export function fallDamage(speed: number, hp: number): number {
  return Math.max(0, Math.min(Math.abs(speed) * 3.6 * FALL_DAMAGE_PER_KMH, hp - 1));
}

/** Sortie d'un véhicule en marche : jusqu'à cette vitesse (m/s, 8 km/h), on descend normalement ; au-delà, on saute et on tombe. */
export const BAIL_SAFE = 8 / 3.6;
/** Points de vie perdus par km/h au-delà de 8 km/h, quand on saute d'un véhicule en marche (plus doux qu'une chute de deux-roues). */
export const BAIL_DAMAGE_PER_KMH = 0.4;

/** On peut descendre sans tomber à cette vitesse (m/s, signe indifférent). */
export function canStepOut(speed: number): boolean {
  return Math.abs(speed) <= BAIL_SAFE;
}

/** Blessure d'un saut hors d'un véhicule roulant à `speed` m/s : 17 points à 50 km/h, 33 à 90, jamais mortelle (on garde au moins un point sur les `hp`). */
export function bailOutDamage(speed: number, hp: number): number {
  const over = Math.max(0, Math.abs(speed) - BAIL_SAFE) * 3.6;
  return Math.max(0, Math.min(over * BAIL_DAMAGE_PER_KMH, hp - 1));
}

/** Chute à pied : sans blessure jusqu'à SAFE_DROP (m), puis DROP_DAMAGE points par mètre ; au-delà de 15 m environ, elle tue. */
export const SAFE_DROP = 4;
export const DROP_DAMAGE = 9;

/** Blessure d'une chute à pied de `height` mètres (saut d'un mur, d'un quai, d'une falaise). */
export function dropDamage(height: number): number {
  return Math.max(0, (height - SAFE_DROP) * DROP_DAMAGE);
}
