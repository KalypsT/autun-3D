/**
 * Catalogue des armes et inventaire du joueur (J5, D80). Logique pure.
 *
 * Analogie : une ceinture à outils. Les poings sont toujours accrochés (on ne les perd jamais) ; le reste se trouve ou se ramasse, et on le perd
 * à la mort ou à l'arrestation. Chaque outil a sa portée, sa force et son rythme ; l'inventaire ne sait que lequel est dans la main.
 *
 * Les valeurs viennent du cadrage de D80 (à régler en jouant) : un passant a 100 points de vie.
 */

export type WeaponId = "fists" | "knife" | "bat" | "pistol" | "shotgun" | "rifle";
export type WeaponKind = "melee" | "gun";
/** Geste du coup : coup de poing (alterné gauche et droite), coup de couteau (estoc), coup de batte (balayage). */
export type AttackStyle = "punch" | "stab" | "swing";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Pictogramme du HUD. */
  icon: string;
  kind: WeaponKind;
  style: AttackStyle;
  /** Portée (m) mesurée du centre du joueur au centre de la cible, moins le rayon du corps de celle-ci. */
  range: number;
  /** Points de vie retirés par coup (par plomb pour le fusil à pompe). */
  damage: number;
  /** Coups ou tirs par seconde. */
  rate: number;
  /** Fraction (0 à 1) de la durée du coup où il touche. */
  hitAt: number;
  /** Cibles touchées au plus par un coup (la batte balaie). */
  maxTargets: number;
  /** Impulsion donnée à la cible (m/s) : au-dessus de 3,5 elle tombe, en dessous elle trébuche. */
  impulse: number;
  /** Ce coup fait tomber la cible (impulsion `knockdown`). Pour les poings : le troisième coup d'une série. */
  knockdown: boolean;
  /** Armes à feu : balles du chargeur (0 pour la mêlée) et plombs par tir. */
  mag: number;
  pellets: number;
  /** Pièce du kit de personnage (`character-kit.ts`) tenue dans la main droite ; null : les poings. */
  part: string | null;
}

/** Impulsion (m/s) d'un coup qui fait tomber (au-dessus du seuil de chute de `PedSim`, 3,5 m/s). */
export const KNOCKDOWN_IMPULSE = 4.4;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: "fists", name: "Poings", icon: "👊", kind: "melee", style: "punch", range: 1.2, damage: 12, rate: 2.5, hitAt: 0.45, maxTargets: 1, impulse: 1.4, knockdown: false, mag: 0, pellets: 1, part: null },
  knife: { id: "knife", name: "Couteau", icon: "🔪", kind: "melee", style: "stab", range: 1.4, damage: 40, rate: 2, hitAt: 0.45, maxTargets: 1, impulse: 1.6, knockdown: false, mag: 0, pellets: 1, part: "weaponKnife" },
  bat: { id: "bat", name: "Batte", icon: "🏏", kind: "melee", style: "swing", range: 1.8, damage: 30, rate: 1.2, hitAt: 0.5, maxTargets: 2, impulse: 2.6, knockdown: true, mag: 0, pellets: 1, part: "weaponBat" },
  pistol: { id: "pistol", name: "Pistolet", icon: "🔫", kind: "gun", style: "stab", range: 35, damage: 34, rate: 4, hitAt: 0, maxTargets: 1, impulse: 1.6, knockdown: false, mag: 12, pellets: 1, part: null },
  shotgun: { id: "shotgun", name: "Fusil à pompe", icon: "🔫", kind: "gun", style: "stab", range: 15, damage: 12, rate: 1, hitAt: 0, maxTargets: 1, impulse: 2.4, knockdown: false, mag: 6, pellets: 8, part: null },
  rifle: { id: "rifle", name: "Fusil d'assaut", icon: "🔫", kind: "gun", style: "stab", range: 60, damage: 22, rate: 10, hitAt: 0, maxTargets: 1, impulse: 1.4, knockdown: false, mag: 30, pellets: 1, part: null },
};

/** Ordre de la molette : les poings d'abord, puis du plus court au plus long. */
export const WEAPON_ORDER: readonly WeaponId[] = ["fists", "knife", "bat", "pistol", "shotgun", "rifle"];

/** Durée d'un coup de mêlée (s) : de son départ à la possibilité d'enchaîner. */
export const strikeTime = (w: WeaponDef): number => 1 / w.rate;

/** Les poings sont toujours là ; le reste se ramasse. `ammo` : munitions en réserve par arme à feu (J5-3). */
export class Inventory {
  private readonly owned = new Set<WeaponId>(["fists"]);
  readonly ammo: Partial<Record<WeaponId, number>> = {};
  private index = 0;

  get current(): WeaponDef {
    return WEAPONS[WEAPON_ORDER[this.index]!];
  }

  has(id: WeaponId): boolean {
    return this.owned.has(id);
  }

  /** Armes possédées, dans l'ordre de la molette. */
  list(): WeaponDef[] {
    return WEAPON_ORDER.filter((id) => this.owned.has(id)).map((id) => WEAPONS[id]);
  }

  /** Ajoute une arme (et des munitions pour une arme à feu). Renvoie vrai si c'est une nouvelle arme. */
  grant(id: WeaponId, ammo = 0): boolean {
    const fresh = !this.owned.has(id);
    this.owned.add(id);
    if (ammo > 0) this.ammo[id] = (this.ammo[id] ?? 0) + ammo;
    return fresh;
  }

  /** Prend l'arme suivante (ou la précédente avec `-1`) parmi celles qu'on possède. */
  cycle(step: 1 | -1 = 1): WeaponDef {
    const n = WEAPON_ORDER.length;
    for (let k = 1; k <= n; k++) {
      const i = (((this.index + step * k) % n) + n) % n;
      if (this.owned.has(WEAPON_ORDER[i]!)) {
        this.index = i;
        break;
      }
    }
    return this.current;
  }

  /** Prend l'arme `id` si on la possède. */
  select(id: WeaponId): boolean {
    if (!this.owned.has(id)) return false;
    this.index = WEAPON_ORDER.indexOf(id);
    return true;
  }

  /** Mort ou arrestation : on ne garde que les poings. */
  loseAll(): void {
    this.owned.clear();
    this.owned.add("fists");
    for (const k of Object.keys(this.ammo)) delete this.ammo[k as WeaponId];
    this.index = 0;
  }
}
