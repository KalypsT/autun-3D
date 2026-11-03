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
  /** Vitesse (m/s) au moment du choc, d'où part le fondu vers la pose de choc (D209) ; absente : debout. */
  poseV?: Float32Array;
  /** Variante de la pose au sol (D209, `lyingPose`) ; absente : tirée de l'emplacement. */
  poseVar?: Uint8Array;
  /** Arme tenue (J5-5) : 0 aucune, 1 un pistolet (la pièce `weaponPistol`, ajoutée au masque du personnage). */
  held?: Uint8Array;
  /** Tête tournée (rad, D198 : on regarde un klaxon, une fontaine) ; absent ou 0 : droit devant. */
  look?: Float32Array;
  recipes: Recipe[];
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
}

/**
 * Regard dans une lunette (D207) : direction (unitaire, repère de la scène : x, z), cosinus du demi-angle du champ (un peu élargi) et grossissement.
 * Les personnages dans ce champ gardent le détail complet jusqu'à `NEAR_DISTANCE × zoom`.
 */
export interface CrowdScope {
  dirX: number;
  dirZ: number;
  cos: number;
  zoom: number;
}

/** Une façon de dessiner une foule. Les trois approches comparées à l'étape P ont cette même interface. */
export interface CrowdRenderer {
  readonly name: string;
  /** Anime et affiche l'état courant, vu depuis la caméra en (camX, camZ). */
  update(state: CrowdState, camX: number, camZ: number, scope?: CrowdScope | null): void;
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
