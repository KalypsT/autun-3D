/**
 * Catalogue des armes et inventaire du joueur (J5, D80). Logique pure.
 *
 * Analogie : une ceinture à outils. Les poings sont toujours accrochés (on ne les perd jamais) ; le reste se trouve ou se ramasse, et on le perd
 * à la mort ou à l'arrestation. Chaque outil a sa portée, sa force et son rythme ; l'inventaire ne sait que lequel est dans la main.
 *
 * Les valeurs viennent du cadrage de D80 (à régler en jouant) : un passant a 100 points de vie.
 */

export type WeaponId = "fists" | "knife" | "bat" | "pistol" | "smg" | "shotgun" | "rifle" | "lmg" | "sniper" | "grenade" | "smoke";
export type WeaponKind = "melee" | "gun" | "throw";
/** Geste du coup : coup de poing (alterné gauche et droite), coup de couteau (estoc), coup de batte (balayage). */
export type AttackStyle = "punch" | "stab" | "swing";
export type GunId = "pistol" | "smg" | "shotgun" | "rifle" | "lmg" | "sniper";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Pictogramme du HUD. */
  icon: string;
  kind: WeaponKind;
  /** Geste de la mêlée ; pour une arme à feu, `aim` (la pose de visée est celle de `character-attack.ts`). */
  style: AttackStyle | "aim";
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
  /** Armes à feu : durée du rechargement (s), dispersion (demi-angle, rad) et dégâts qui baissent avec la distance (fusil à pompe). */
  reload: number;
  spread: number;
  falloff: boolean;
  /** Armes à feu (D206, D207) : dispersion à la hanche (demi-angle, rad ; 0 : celle de visée × `HIP_SPREAD` de `gun.ts`) et grossissement de la lunette (0 : pas de lunette, la visée se fait à l'épaule). */
  hipSpread: number;
  scope: number;
  /** Pièce du kit de personnage (`character-kit.ts`) tenue dans la main droite ; null : les poings. */
  part: string | null;
  /** Arme lourde (mitrailleuse, D325) : on marche au pas en la portant, sans courir ni sprinter. */
  heavy?: boolean;
}

/** Impulsion (m/s) d'un coup qui fait tomber (au-dessus du seuil de chute de `PedSim`, 3,5 m/s). */
export const KNOCKDOWN_IMPULSE = 4.4;

const melee = (w: Omit<WeaponDef, "kind" | "mag" | "pellets" | "reload" | "spread" | "falloff" | "hipSpread" | "scope">): WeaponDef => ({ ...w, kind: "melee", mag: 0, pellets: 1, reload: 0, spread: 0, falloff: false, hipSpread: 0, scope: 0 });
const gun = (w: Omit<WeaponDef, "kind" | "style" | "hitAt" | "maxTargets" | "knockdown" | "hipSpread" | "scope"> & { hipSpread?: number; scope?: number }): WeaponDef => ({ hipSpread: 0, scope: 0, ...w, kind: "gun", style: "aim", hitAt: 0, maxTargets: 1, knockdown: false });

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: melee({ id: "fists", name: "Poings", icon: "👊", style: "punch", range: 1.2, damage: 12, rate: 2.5, hitAt: 0.45, maxTargets: 1, impulse: 1.4, knockdown: false, part: null }),
  knife: melee({ id: "knife", name: "Couteau", icon: "🔪", style: "stab", range: 1.4, damage: 40, rate: 2, hitAt: 0.45, maxTargets: 1, impulse: 1.6, knockdown: false, part: "weaponKnife" }),
  bat: melee({ id: "bat", name: "Batte", icon: "🏏", style: "swing", range: 1.8, damage: 30, rate: 1.2, hitAt: 0.5, maxTargets: 2, impulse: 2.6, knockdown: true, part: "weaponBat" }),
  pistol: gun({ id: "pistol", name: "Pistolet", icon: "🔫", range: 35, damage: 34, rate: 4, impulse: 1.6, mag: 12, pellets: 1, reload: 1.2, spread: 0.02, falloff: false, part: "weaponPistol" }),
  shotgun: gun({ id: "shotgun", name: "Fusil à pompe", icon: "💥", range: 15, damage: 12, rate: 1, impulse: 2.4, mag: 6, pellets: 8, reload: 2.2, spread: 0.09, falloff: true, part: "weaponShotgun" }),
  rifle: gun({ id: "rifle", name: "Fusil d'assaut", icon: "🎯", range: 60, damage: 22, rate: 10, impulse: 1.4, mag: 30, pellets: 1, reload: 1.8, spread: 0.035, falloff: false, part: "weaponRifle" }),
  // Pistolet-mitrailleur (D325) : tire vite, peu précis, courte portée ; vendu chez James.
  smg: gun({ id: "smg", name: "Pistolet-mitrailleur", icon: "🔫", range: 25, damage: 16, rate: 14, impulse: 1.2, mag: 32, pellets: 1, reload: 1.5, spread: 0.05, falloff: false, part: "weaponSmg" }),
  // Mitrailleuse légère (D325) : bande de 100, longue à recharger, lourde (on marche au pas) ; vendue au Surplus Éduen.
  lmg: gun({ id: "lmg", name: "Mitrailleuse", icon: "🎯", range: 70, damage: 26, rate: 11, impulse: 1.8, mag: 100, pellets: 1, reload: 4.5, spread: 0.045, falloff: false, part: "weaponLmg", heavy: true }),
  // Grenade (D326) : on la lance ; le souffle est celui des véhicules qui explosent (`EXPLOSION`). Comptée en réserve, dix au plus.
  grenade: { id: "grenade", name: "Grenade", icon: "💣", kind: "throw", style: "punch", range: 0, damage: 0, rate: 1.2, hitAt: 0.55, maxTargets: 0, impulse: 0, knockdown: false,
    mag: 0, pellets: 0, reload: 0, spread: 0, falloff: false, hipSpread: 0, scope: 0, part: "weaponGrenade" },
  // Fumigène (D327) : se lance comme une grenade ; un nuage qui cache le joueur à la police.
  smoke: { id: "smoke", name: "Fumigène", icon: "💨", kind: "throw", style: "punch", range: 0, damage: 0, rate: 1.2, hitAt: 0.55, maxTargets: 0, impulse: 0, knockdown: false,
    mag: 0, pellets: 0, reload: 0, spread: 0, falloff: false, hipSpread: 0, scope: 0, part: "weaponGrenade" },
  // Fusil de précision (T3, D207) : un tir tue (120 points), à 150 m (au-delà, le brouillard cache tout) ; lunette ×5 ; presque rien à la hanche.
  sniper: gun({ id: "sniper", name: "Fusil de précision", icon: "🔭", range: 150, damage: 120, rate: 0.8, impulse: 3, mag: 5, pellets: 1, reload: 2.6, spread: 0.003, hipSpread: 0.1, falloff: false, part: "weaponSniper", scope: 5 }),
};

/** Ordre de la molette : les poings d'abord, puis du plus court au plus long. */
export const WEAPON_ORDER: readonly WeaponId[] = ["fists", "knife", "bat", "pistol", "smg", "shotgun", "rifle", "lmg", "sniper", "grenade", "smoke"];

/** Grenades portées au plus (D326). */
export const GRENADE_MAX = 10;

/** Réserve au plus : six chargeurs pour une arme à feu, dix grenades. */
export const reserveCap = (w: WeaponDef): number => (w.kind === "throw" ? GRENADE_MAX : w.mag * 6);

/** Durée d'un coup de mêlée (s) : de son départ à la possibilité d'enchaîner. */
export const strikeTime = (w: WeaponDef): number => 1 / w.rate;

/** Les poings sont toujours là ; le reste se ramasse. Armes à feu : `mag` balles dans le chargeur, `ammo` en réserve (J5-3). */
export class Inventory {
  private readonly owned = new Set<WeaponId>(["fists"]);
  readonly ammo: Partial<Record<WeaponId, number>> = {};
  readonly mag: Partial<Record<WeaponId, number>> = {};
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

  /**
   * Ajoute une arme et, pour une arme à feu, `rounds` balles : une arme neuve est chargée d'abord (au plus un chargeur), le reste va en réserve.
   * Renvoie vrai si c'est une nouvelle arme.
   */
  grant(id: WeaponId, rounds = 0): boolean {
    const fresh = !this.owned.has(id);
    this.owned.add(id);
    const def = WEAPONS[id];
    if (def.kind === "gun" && rounds > 0) {
      let left = rounds;
      if (fresh || (this.mag[id] ?? 0) === 0) {
        const load = Math.min(def.mag - (this.mag[id] ?? 0), left);
        this.mag[id] = (this.mag[id] ?? 0) + load;
        left -= load;
      }
      if (left > 0) this.ammo[id] = Math.min(reserveCap(def), (this.ammo[id] ?? 0) + left);
    } else if (def.kind === "gun" && fresh) {
      this.mag[id] = 0;
    } else if (def.kind === "throw") {
      this.ammo[id] = Math.min(reserveCap(def), (this.ammo[id] ?? 0) + Math.max(0, rounds));
    }
    return fresh;
  }

  /** Balles dans le chargeur, en réserve. */
  magOf(id: WeaponId): number {
    return this.mag[id] ?? 0;
  }

  reserveOf(id: WeaponId): number {
    return this.ammo[id] ?? 0;
  }

  /** Un tir : une balle du chargeur. Renvoie faux si le chargeur est vide. */
  fire(id: WeaponId): boolean {
    const m = this.mag[id] ?? 0;
    if (m <= 0) return false;
    this.mag[id] = m - 1;
    return true;
  }

  /** Lance une grenade (D326) : une de moins ; la dernière partie, l'arme quitte la ceinture et les poings reviennent en main. */
  throwOne(id: WeaponId): boolean {
    const n = this.ammo[id] ?? 0;
    if (WEAPONS[id].kind !== "throw" || n <= 0) return false;
    this.ammo[id] = n - 1;
    if (n - 1 <= 0) {
      delete this.ammo[id];
      this.owned.delete(id);
      this.index = 0;
    }
    return true;
  }

  /** Peut-on recharger (chargeur pas plein, balles en réserve) ? */
  canReload(id: WeaponId): boolean {
    return WEAPONS[id].kind === "gun" && (this.mag[id] ?? 0) < WEAPONS[id].mag && (this.ammo[id] ?? 0) > 0;
  }

  /** Remplit le chargeur depuis la réserve. Renvoie le nombre de balles chargées. */
  reload(id: WeaponId): number {
    if (!this.canReload(id)) return 0;
    const n = Math.min(WEAPONS[id].mag - (this.mag[id] ?? 0), this.ammo[id] ?? 0);
    this.mag[id] = (this.mag[id] ?? 0) + n;
    this.ammo[id] = (this.ammo[id] ?? 0) - n;
    return n;
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

  /** Mort ou arrestation : on ne garde que les poings (et plus aucune balle). */
  loseAll(): void {
    this.owned.clear();
    this.owned.add("fists");
    for (const k of Object.keys(this.ammo)) delete this.ammo[k as WeaponId];
    for (const k of Object.keys(this.mag)) delete this.mag[k as WeaponId];
    this.index = 0;
  }

  /** État à enregistrer (sauvegarde version 4) : armes possédées (sans les poings), balles, arme en main. */
  toSave(): SavedArms {
    return {
      owned: WEAPON_ORDER.filter((id) => id !== "fists" && this.owned.has(id)),
      mag: { ...this.mag },
      ammo: { ...this.ammo },
      current: WEAPON_ORDER[this.index]!,
    };
  }

  /** Reprend un état enregistré (déjà validé par `parseSave`). */
  restore(a: SavedArms): void {
    this.loseAll();
    for (const id of a.owned) {
      this.owned.add(id);
      if (WEAPONS[id].kind === "gun") {
        this.mag[id] = Math.min(a.mag[id] ?? 0, WEAPONS[id].mag);
        this.ammo[id] = a.ammo[id] ?? 0;
      } else if (WEAPONS[id].kind === "throw") this.ammo[id] = Math.min(a.ammo[id] ?? 0, reserveCap(WEAPONS[id]));
    }
    this.select(a.current);
  }
}

/** Armes enregistrées dans la sauvegarde (version 4). */
export interface SavedArms {
  owned: WeaponId[];
  mag: Partial<Record<WeaponId, number>>;
  ammo: Partial<Record<WeaponId, number>>;
  current: WeaponId;
}
