/**
 * Dégâts des véhicules (D109) : logique pure, sans rendu. Chaque véhicule a une santé (100 points) et quatre zones (avant, arrière, gauche, droite)
 * qui ne servent qu'à l'aspect. Analogie : un carnet de santé, avec un état général et des bleus localisés.
 *
 * Les chocs (vitesse d'impact au-delà de 12 km/h), les balles et les explosions retirent des points ; la santé fixe le palier : intact, fumée blanche,
 * fumée noire, en feu. Un véhicule en feu finit, au bout de quelques secondes, selon `END_MODE` : il explose (jeu normal), ou il tombe en panne et
 * reste une épave fumante (aiguillage prévu pour un futur mode enfant, sans violence). Un vélo ou une trottinette ne brûle pas : il est cassé.
 * La puissance baisse avec le palier (la direction n'est jamais touchée : pénible au pouce sur téléphone).
 */

export type Zone = "front" | "rear" | "left" | "right";
export const ZONES: readonly Zone[] = ["front", "rear", "left", "right"];

/** Palier : intact, fumée blanche, fumée noire, en feu, puis fin (épave brûlée ou en panne, ou deux-roues sans moteur cassé). */
export type DamageTier = "ok" | "smoke" | "heavy" | "fire" | "wrecked";

/** Fin d'un véhicule détruit : l'aiguillage unique entre le jeu normal et un futur mode sans violence. */
export type EndMode = "explosion" | "breakdown";
export const END_MODE: { current: EndMode } = { current: "explosion" };

export const DAMAGE = {
  max: 100,
  /** Vitesse d'impact (m/s) en dessous de laquelle un choc n'abîme rien (≈ 12 km/h). */
  threshold: 3.3,
  /** Points retirés : scale × (impact − threshold)^power, divisé par la solidité du modèle. Un mur à 50 km/h de face : ≈ 35 points ; à 90 km/h : le feu. */
  scale: 1.0,
  power: 1.5,
  /** Une réception de saut abîme moitié moins qu'un choc de même vitesse (les pneus et la suspension encaissent). */
  landing: 0.5,
  /** Seuils de santé des paliers. */
  smoke: 60,
  heavy: 30,
  fire: 10,
  /** Durée (s) entre le départ du feu et l'explosion (ou la panne). */
  burn: 5,
  /** Puissance restante à chaque palier. */
  powerLeft: { ok: 1, smoke: 0.85, heavy: 0.6, fire: 0.6, wrecked: 0 } as Record<DamageTier, number>,
  /** Écrasement d'une zone : part des points d'un choc qui s'y inscrit (le reste se répartit sur les voisines), et points pour l'écraser tout à fait. */
  zoneShare: 0.7,
  zoneFull: 45,
} as const;

/** Ce qu'il faut savoir d'un modèle : sa solidité (1 : une voiture ordinaire) et s'il peut brûler (un moteur, un réservoir). */
export interface DamageProfile {
  toughness: number;
  burns: boolean;
}

/** Points retirés par un choc de cette vitesse d'impact (m/s), pour un modèle de cette solidité. */
export function impactPoints(speed: number, toughness: number): number {
  if (!(speed > DAMAGE.threshold)) return 0;
  return (DAMAGE.scale * (speed - DAMAGE.threshold) ** DAMAGE.power) / toughness;
}

/** Zone touchée par un choc venu de cet angle (0 devant, π/2 à droite, ±π derrière). */
export function zoneOf(angle: number): Zone {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle));
  if (Math.abs(a) <= Math.PI / 4) return "front";
  if (Math.abs(a) >= (3 * Math.PI) / 4) return "rear";
  return a > 0 ? "right" : "left";
}

/** Palier d'une santé donnée (sans compter la fin, qui est un état et pas un niveau de santé). */
export function tierOf(health: number): DamageTier {
  if (health > DAMAGE.smoke) return "ok";
  if (health > DAMAGE.heavy) return "smoke";
  if (health > DAMAGE.fire) return "heavy";
  return "fire";
}

/** Événements d'un pas, pour le jeu (sons, effets, infractions) : changement de palier, départ du feu, explosion, panne. */
export type DamageEvent = { kind: "tier"; tier: DamageTier } | { kind: "explode" } | { kind: "breakdown" };

export class VehicleDamage {
  health: number = DAMAGE.max;
  /** Écrasement de chaque zone, 0 (intacte) à 1 (écrasée). */
  readonly zones: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0 };
  /** Temps passé en feu (s) ; −1 tant qu'il n'y a pas de feu. */
  burning = -1;
  /** Fin atteinte : épave brûlée (« explosion ») ou en panne (« breakdown »), ou null tant que le véhicule roule. */
  end: EndMode | null = null;
  /** Augmente à chaque changement (points retirés, réparation, reprise) : le dessin ne se refait que quand il bouge. */
  version = 0;
  private tierSeen: DamageTier = "ok";
  private readonly pending: DamageEvent[] = [];

  constructor(readonly profile: DamageProfile) {}

  get tier(): DamageTier {
    return this.end ? "wrecked" : tierOf(this.health);
  }

  /** Part de la puissance du moteur qui reste (1 : intact, 0 : épave). */
  get power(): number {
    return DAMAGE.powerLeft[this.tier];
  }

  /** On peut encore s'en servir (monter, rouler). */
  get usable(): boolean {
    return this.end === null;
  }

  /** Choc de cette vitesse d'impact (m/s), venu de cet angle (NaN : réception de saut, sous le véhicule). Renvoie les points retirés. */
  hit(speed: number, angle: number): number {
    const landing = Number.isNaN(angle);
    const points = impactPoints(speed, this.profile.toughness) * (landing ? DAMAGE.landing : 1);
    this.damage(points, angle);
    return points;
  }

  /** Retire des points (balle, explosion, choc), inscrits dans la zone de l'angle donné (NaN : répartis sur l'avant et l'arrière). */
  damage(points: number, angle = NaN): void {
    if (!(points > 0) || this.end) return;
    this.version++;
    this.health = Math.max(0, this.health - points);
    const add = (z: Zone, p: number): void => {
      this.zones[z] = Math.min(1, this.zones[z] + p / DAMAGE.zoneFull);
    };
    if (Number.isNaN(angle)) {
      add("front", points / 2);
      add("rear", points / 2);
    } else {
      const z = zoneOf(angle);
      add(z, points * DAMAGE.zoneShare);
      // Le reste sur les deux zones voisines (un choc de face plisse aussi les ailes).
      const rest = (points * (1 - DAMAGE.zoneShare)) / 2;
      const [a, b] = z === "front" || z === "rear" ? (["left", "right"] as const) : (["front", "rear"] as const);
      add(a, rest);
      add(b, rest);
    }
    this.check();
  }

  /** Avance le temps : le feu brûle, puis le véhicule explose ou tombe en panne. */
  update(dt: number): void {
    if (this.burning < 0 || this.end) return;
    this.burning += dt;
    if (this.burning >= DAMAGE.burn) this.finish();
  }

  /** Remet le véhicule à neuf (garage). */
  repair(): void {
    this.health = DAMAGE.max;
    for (const z of ZONES) this.zones[z] = 0;
    this.burning = -1;
    this.end = null;
    this.tierSeen = "ok";
    this.pending.length = 0;
    this.version++;
  }

  /** Reprend un état enregistré (sauvegarde). */
  restore(health: number, zones: Partial<Record<Zone, number>>, end: EndMode | null): void {
    this.repair();
    this.health = Math.min(DAMAGE.max, Math.max(0, health));
    for (const z of ZONES) this.zones[z] = Math.min(1, Math.max(0, zones[z] ?? 0));
    this.end = end;
    this.tierSeen = tierOf(this.health);
    // Enregistré en feu : le feu reprend à son début (ou c'est une panne, là où rien ne brûle).
    if (!end && this.tierSeen === "fire") {
      if (this.burns) this.burning = 0;
      else this.end = "breakdown";
    }
  }

  /** Ce véhicule prend feu en fin de vie (moteur et réservoir, et pas en mode sans violence). */
  private get burns(): boolean {
    return this.profile.burns && END_MODE.current === "explosion";
  }

  /** Événements depuis le dernier appel (le jeu les lit à chaque image). */
  takeEvents(): DamageEvent[] {
    return this.pending.splice(0);
  }

  private check(): void {
    const tier = tierOf(this.health);
    if (tier === this.tierSeen) return;
    this.tierSeen = tier;
    // Sans moteur ni réservoir (vélo, trottinette), ou en mode sans violence : pas de feu, la fin tout de suite.
    if (tier === "fire" && !this.burns) {
      this.finish();
      return;
    }
    this.pending.push({ kind: "tier", tier });
    if (tier === "fire") this.burning = 0;
  }

  private finish(): void {
    this.burning = -1;
    this.end = this.burns ? "explosion" : "breakdown";
    this.pending.push(this.end === "explosion" ? { kind: "explode" } : { kind: "breakdown" });
  }
}
