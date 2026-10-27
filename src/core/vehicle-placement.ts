import { ZONE } from "../data/nav";

/**
 * Quels véhicules où (D55) : le modèle garé sur une place dépend du quartier, comme les passants (centre, résidentiel, périphérie, nature, D39).
 * Les places sont remplies une fois pour toutes quand leur tuile se construit (un véhicule garé est un obstacle et se sauvegarde : il ne peut pas
 * apparaître et disparaître avec l'heure, c'est le travail de la circulation, J3). Logique pure.
 * Analogie : le rayon d'un marchand selon la ville : citadines et scooters en centre, breaks et SUV en banlieue, camionnettes dans les zones d'activité.
 */

/** Poids d'un modèle (en %), par zone ; chaque tableau fait 100. */
type Weights = readonly (readonly [string, number])[];

const CAR_WEIGHTS: Record<number, Weights> = {
  [ZONE.centre]: [["citadine", 28], ["compacte", 22], ["berline", 12], ["break", 6], ["petit-suv", 12], ["camionnette", 8], ["vieille-voiture", 10], ["sportive", 2]],
  [ZONE.residential]: [["citadine", 18], ["compacte", 22], ["berline", 14], ["break", 12], ["petit-suv", 16], ["camionnette", 5], ["vieille-voiture", 11], ["sportive", 2]],
  [ZONE.outskirts]: [["citadine", 10], ["compacte", 14], ["berline", 12], ["break", 10], ["petit-suv", 18], ["camionnette", 24], ["vieille-voiture", 10], ["sportive", 2]],
};
CAR_WEIGHTS[ZONE.nature] = CAR_WEIGHTS[ZONE.outskirts]!;

const MOTO_WEIGHTS: Record<number, Weights> = {
  [ZONE.centre]: [["scooter-125", 55], ["moto-routiere", 33], ["moto-sportive", 12]],
  [ZONE.residential]: [["scooter-125", 40], ["moto-routiere", 45], ["moto-sportive", 15]],
  [ZONE.outskirts]: [["scooter-125", 25], ["moto-routiere", 55], ["moto-sportive", 20]],
};
MOTO_WEIGHTS[ZONE.nature] = MOTO_WEIGHTS[ZONE.outskirts]!;

const BIKE_WEIGHTS: Record<number, Weights> = {
  [ZONE.centre]: [["velo-ville", 90], ["vtt", 10]],
  [ZONE.residential]: [["velo-ville", 75], ["vtt", 25]],
  [ZONE.outskirts]: [["velo-ville", 50], ["vtt", 50]],
  [ZONE.nature]: [["velo-ville", 30], ["vtt", 70]],
};

export type PlacedFamily = "car" | "moto" | "bike";

const TABLES: Record<PlacedFamily, Record<number, Weights>> = { car: CAR_WEIGHTS, moto: MOTO_WEIGHTS, bike: BIKE_WEIGHTS };

/** Tous les modèles que le placement peut choisir (pour les tests). */
export function placedModels(): string[] {
  const out = new Set<string>();
  for (const table of Object.values(TABLES)) for (const w of Object.values(table)) for (const [id] of w) out.add(id);
  return [...out];
}

/** Modèle tiré pour `u` dans [0, 1[ : selon la famille et la zone. */
export function pickModel(family: PlacedFamily, zone: number, u: number): string {
  const weights = TABLES[family][zone] ?? TABLES[family][ZONE.outskirts]!;
  let total = 0;
  for (const [, w] of weights) total += w;
  let t = Math.min(Math.max(u, 0), 0.999999) * total;
  for (const [id, w] of weights) {
    if (t < w) return id;
    t -= w;
  }
  return weights[weights.length - 1]![0];
}

/**
 * Zone d'une place de stationnement ou d'un parking à vélos, sans le graphe de navigation (qui se charge à son rythme, après ou avant la tuile) :
 * d'après le nombre de bâtiments de sa tuile (250 m de côté) et la distance à la mairie (le centre du repère). Le centre : au moins 90 bâtiments
 * à moins de 500 m ; résidentiel : au moins 25 ; périphérie : au moins 3 ; nature : le reste.
 */
export function parkingZone(x: number, y: number, tileBuildings: number): number {
  if (tileBuildings < 3) return ZONE.nature;
  if (tileBuildings >= 90 && Math.hypot(x, y) < 500) return ZONE.centre;
  return tileBuildings >= 25 ? ZONE.residential : ZONE.outskirts;
}
