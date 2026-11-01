/**
 * Mobilier urbain cassable (D160) : un véhicule assez lourd et assez rapide arrache un lampadaire, un feu, une poubelle, une boîte aux lettres, un potelet
 * ou une borne à eau au lieu de s'y écraser comme contre un mur. Logique pure. Analogie : une quille de bowling contre une boule — la boule ralentit un peu,
 * la quille part ; une trottinette, elle, rebondit.
 */

export interface BreakSpec {
  /** Rayon de collision (m) du mobilier. */
  radius: number;
  /** Vitesse de choc (m/s) à partir de laquelle il cède ; en dessous, il reste un obstacle plein (on le frôle sans le casser). */
  threshold: number;
  /** Masse effective (kg) qui freine le véhicule quand il cède. */
  mass: number;
}

/** Nature du mobilier (étiquette OpenStreetMap) → ses réglages. Les bancs, fontaines, mémoriaux, toilettes et arbres restent des obstacles pleins. */
export const BREAKABLE: Readonly<Record<string, BreakSpec>> = {
  street_lamp: { radius: 0.2, threshold: 6, mass: 250 },
  traffic_signals: { radius: 0.2, threshold: 6.5, mass: 300 },
  waste_basket: { radius: 0.25, threshold: 3, mass: 40 },
  post_box: { radius: 0.3, threshold: 5, mass: 180 },
  bollard: { radius: 0.15, threshold: 4, mass: 60 },
  drinking_water: { radius: 0.25, threshold: 4, mass: 80 },
};

/**
 * Mobilier que seules les voitures du joueur heurtent (D160) : les feux, qui n'étaient pas des obstacles. Pour la circulation et les passants, ils restent
 * traversables (la circulation s'y coinçait : mesuré par le test d'interblocage de la place).
 */
export const CAR_ONLY: ReadonlySet<string> = new Set(["traffic_signals"]);

/** Masse minimale (kg) d'un véhicule qui arrache du mobilier : un vélo, une trottinette ou une moto s'y heurtent et tombent. */
export const BREAK_MIN_MASS = 500;

/** Part des dégâts de choc (en vitesse d'impact) qui reste quand le véhicule arrache le mobilier : 0,63^1,5 ≈ la moitié des points. */
export const BREAK_IMPACT_KEEP = 0.63;

/** Le mobilier de cette nature peut être cassé. */
export function isBreakable(kind: string): boolean {
  return kind in BREAKABLE;
}

/** Vrai si un véhicule de cette masse (kg), au contact à cette vitesse normale (m/s), arrache ce mobilier. */
export function breaks(spec: BreakSpec, vehicleMass: number, closingSpeed: number): boolean {
  return vehicleMass >= BREAK_MIN_MASS && closingSpeed >= spec.threshold;
}

/** Part de la vitesse qui reste au véhicule après avoir arraché le mobilier (conservation de la quantité de mouvement) : 84 % pour une voiture et un lampadaire. */
export function speedKept(spec: BreakSpec, vehicleMass: number): number {
  return vehicleMass / (vehicleMass + spec.mass);
}
