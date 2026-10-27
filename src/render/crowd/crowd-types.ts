import type { Recipe } from "../../core/character";

/** Distance (m) en deçà de laquelle un personnage est dessiné en détail complet (niveau 0), et projette son ombre. */
export const NEAR_DISTANCE = 28;

/**
 * État d'une foule, en tableaux (rapide à parcourir, sans objets) et en coordonnées de la scène three :
 * x, hauteur y, z ; cap `yaw` (rotation autour de y), phase de marche (rad) et vitesse (m/s).
 */
export interface CrowdState {
  /** Capacité : nombre d'emplacements (un par personnage possible). */
  count: number;
  /** Emplacements occupés (1) ou libres (0) ; absent = tous occupés. Les passants naissent et disparaissent (J2) : un emplacement libre n'est pas dessiné. */
  alive?: Uint8Array;
  /** Pose spéciale d'un passant heurté (0 : marche ; 1 : trébuche ; 2 : tombe, au sol, se relève : `HIT_POSE`), temps écoulé depuis le choc (s) et sens de la chute. */
  pose?: Uint8Array;
  poseT?: Float32Array;
  poseSide?: Int8Array;
  recipes: Recipe[];
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
}

/** Une façon de dessiner une foule. Les trois approches comparées à l'étape P ont cette même interface. */
export interface CrowdRenderer {
  readonly name: string;
  /** Anime et affiche l'état courant, vu depuis la caméra en (camX, camZ). */
  update(state: CrowdState, camX: number, camZ: number): void;
  /** Habille l'emplacement i d'une nouvelle recette (les passants naissent et disparaissent). */
  assign?(i: number, recipe: Recipe): void;
  /** Ombres portées des personnages proches. */
  setShadows(on: boolean): void;
  /** Personnages dessinés en détail complet / en détail réduit à la dernière mise à jour. */
  lodCounts(): { near: number; far: number };
  dispose(): void;
}

export function createCrowdState(recipes: Recipe[]): CrowdState {
  const n = recipes.length;
  return {
    count: n, recipes,
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    yaw: new Float32Array(n), phase: new Float32Array(n), speed: new Float32Array(n),
  };
}
