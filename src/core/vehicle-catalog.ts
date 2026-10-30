import type { DamageProfile } from "./damage";
import { BIKE, CAR, MOTO, SCOOTER, type VehicleSpec } from "./vehicle";
import { COMPACT, FOOD_TRUCK, JEEP, LOG_TRUCK, MTB, TRAIN_LOCO, OLD_CAR, POLICE_CAR, SCOOTER_125, SEDAN, SPORT_CAR, SPORT_MOTO, SUV, VAN, WAGON } from "./vehicle-specs";

/**
 * Catalogue de véhicules (D50) : logique pure, sans rendu. Une entrée (`VehicleDef`) réunit ce qui fait un modèle de véhicule :
 * son nom, sa famille, sa fiche physique et sa palette. Le dessin (`src/game/vehicles.ts`) associe un modèle 3D à chaque identifiant.
 * Analogie : un classeur de fiches. Le jeu (placement, conduite), puis la circulation (J3) et la police (J4) y piochent
 * sans rien savoir des véhicules en particulier ; ajouter un modèle, c'est ajouter une fiche.
 */

/**
 * Famille : ce qui est commun à plusieurs modèles pour l'interface et la conduite (pictogramme, libellés, distance pour monter,
 * caméra de poursuite, traces de pneus). Une moto de course et une moto de ville sont de la même famille.
 */
export type VehicleFamily = "bike" | "kickscooter" | "car" | "moto";

export interface FamilyInfo {
  icon: string;
  /** Libellé de l'accélérateur et du klaxon. */
  gas: string;
  horn: string;
  /** Portée du klaxon ou de la sonnette (m) : passants et pigeons devant sursautent jusque-là. */
  hornRange: number;
  /** Distance (m) à laquelle on peut monter. */
  reach: number;
  /** Côté de la descente : décalage latéral (m) vers la gauche. */
  dismount: number;
  camera: { distance: number; perSpeed: number; height: number };
  /** Traces de pneus : demi-voie (0 pour un deux-roues) et largeur de bande (m). */
  tyre: { track: number; width: number };
}

export const FAMILIES: Record<VehicleFamily, FamilyInfo> = {
  bike: { icon: "🚲", gas: "Pédaler", horn: "Sonnette", hornRange: 15, reach: 2.2, dismount: 0.75, camera: { distance: 3.9, perSpeed: 0.15, height: 0.2 }, tyre: { track: 0, width: 0.05 } },
  kickscooter: { icon: "🛴", gas: "Accélérer", horn: "Sonnette", hornRange: 15, reach: 2.2, dismount: 0.75, camera: { distance: 3.9, perSpeed: 0.15, height: 0.2 }, tyre: { track: 0, width: 0.06 } },
  car: { icon: "🚗", gas: "Accélérer", horn: "Klaxon", hornRange: 35, reach: 3.0, dismount: 1.45, camera: { distance: 6.2, perSpeed: 0.06, height: 0.55 }, tyre: { track: 0.74, width: 0.2 } },
  moto: { icon: "🏍️", gas: "Accélérer", horn: "Klaxon", hornRange: 28, reach: 2.2, dismount: 0.75, camera: { distance: 4.6, perSpeed: 0.07, height: 0.35 }, tyre: { track: 0, width: 0.12 } },
};

export interface VehicleDef {
  /** Identifiant stable (enregistré dans les sauvegardes : ne jamais le changer). */
  id: string;
  family: VehicleFamily;
  /** Nom du type de véhicule (galerie, menus). */
  name: string;
  /**
   * Marque et modèle (fictifs, clins d'œil à Autun, D107), affichés quelques secondes quand on monte dedans, à la manière de GTA 3.
   * Éduen (les Éduens, peuple gaulois d'Autun) : voitures et scooters populaires ; Augusta (Augustodunum) : haut de gamme ; Couhard (la pierre de Couhard) :
   * utilitaires ; Bibracte (l'oppidum du mont Beuvray) : vélos et motos ; Trott'Autun : le service de trottinettes en libre-service.
   */
  badge?: { make: string; model: string };
  spec: VehicleSpec;
  /** Pictogramme propre au modèle, s'il diffère de celui de sa famille (le scooter est un 🛵, pas une moto). */
  icon?: string;
  /** Gabarit hors tout (m) : le modèle dessiné le respecte (test pour les voitures), la coque le recouvre à peu près. */
  size: { length: number; width: number; height: number };
  /** Couleurs de peinture possibles ; l'exemplaire en prend une selon son numéro de variante. */
  palette: readonly string[];
  /** Solidité face aux chocs et aux balles (D109) : 1 pour une voiture ordinaire (défaut), plus pour un utilitaire ou la gendarmerie. */
  toughness?: number;
  /** Exemplaire unique (D114) : jamais dans la circulation ni sur les places ordinaires ; il a sa place fixe (`src/core/uniques.ts`). */
  unique?: boolean;
  /**
   * Locomotive du petit train (D118) : dessinée avec ses wagons par le train (`src/game/tourist-train.ts`), pas par le générateur de carrosserie ;
   * pas de place fixe (le train tourne sur son circuit), jamais enregistrée (une partie le remet sur son circuit).
   */
  train?: boolean;
}

export const CATALOG: readonly VehicleDef[] = [
  { id: "velo-ville", family: "bike", name: "Vélo de ville", badge: { make: "Bibracte", model: "Promenade" }, toughness: 0.6, spec: BIKE, size: { length: 1.83, width: 0.58, height: 1.09 }, palette: ["#2a6f7e", "#d9472b", "#1f3a52", "#3f7d4e", "#efe3c8", "#9fb8a6", "#d98a8a"] },
  { id: "vtt", family: "bike", name: "VTT", badge: { make: "Bibracte", model: "Beuvray" }, toughness: 0.7, spec: MTB, size: { length: 1.78, width: 0.69, height: 1.07 }, palette: ["#d9472b", "#1b1d22", "#3f7d4e", "#f1b24a", "#2d6fb8", "#8a8f96"] },
  { id: "trottinette", family: "kickscooter", name: "Trottinette", badge: { make: "Trott'Autun", model: "Libre-service" }, toughness: 0.5, spec: SCOOTER, size: { length: 1.17, width: 0.51, height: 1.15 }, palette: ["#2a6f7e", "#3f7d4e", "#d9472b"] },
  { id: "citadine", family: "car", name: "Citadine", badge: { make: "Éduen", model: "Moineau" }, spec: CAR, size: { length: 3.98, width: 1.74, height: 1.42 }, palette: ["#d9472b", "#f1b24a", "#5aa0b4", "#9cc25b", "#efe3c8", "#d98a8a", "#2a6f7e"] },
  { id: "compacte", family: "car", name: "Compacte", badge: { make: "Éduen", model: "Arroux" }, spec: COMPACT, size: { length: 4.25, width: 1.8, height: 1.46 }, palette: ["#2a6f7e", "#c23a2a", "#8a8f96", "#1f3a52", "#e8e4da", "#3f7d4e"] },
  { id: "berline", family: "car", name: "Berline", badge: { make: "Augusta", model: "Préfète" }, spec: SEDAN, size: { length: 4.75, width: 1.85, height: 1.45 }, palette: ["#1d2530", "#8a8f96", "#7a2e2e", "#1f3a52", "#c8c2b4", "#3a4a5a"] },
  { id: "break", family: "car", name: "Break", badge: { make: "Augusta", model: "Morvandelle" }, spec: WAGON, size: { length: 4.8, width: 1.85, height: 1.5 }, palette: ["#5d6b4f", "#b8a48a", "#efe3c8", "#4b5d73", "#8a8f96", "#6e4a33"] },
  { id: "petit-suv", family: "car", name: "Petit SUV", badge: { make: "Éduen", model: "Morvan" }, toughness: 1.15, spec: SUV, size: { length: 4.25, width: 1.8, height: 1.6 }, palette: ["#c4562f", "#2f6a5a", "#d6d2c8", "#3a7ca5", "#8a8f96", "#e0a43a"] },
  { id: "camionnette", family: "car", name: "Camionnette", badge: { make: "Couhard", model: "Mulet" }, toughness: 1.3, spec: VAN, size: { length: 4.9, width: 1.95, height: 1.95 }, palette: ["#e8e4da", "#e8e4da", "#e8e4da", "#8a8f96", "#c23a2a", "#2a6f7e", "#f1b24a"] },
  { id: "vieille-voiture", family: "car", name: "Vieille voiture", badge: { make: "Éduen", model: "Pétrolette" }, toughness: 0.9, spec: OLD_CAR, size: { length: 4.1, width: 1.68, height: 1.4 }, palette: ["#9fb8a6", "#c9b98a", "#8fa8c4", "#a6553b", "#e3d6b8", "#7d6a8a"] },
  { id: "sportive", family: "car", name: "Sportive", badge: { make: "Augusta", model: "Janus" }, toughness: 0.85, spec: SPORT_CAR, size: { length: 4.45, width: 1.88, height: 1.25 }, palette: ["#d9472b", "#f1b24a", "#e8e4da", "#1b1d22", "#2d6fb8", "#3f7d4e"] },
  // Gendarmerie (J4, D72) : jamais garée ni dans la circulation ordinaire tirée par quartier ; la police la fait naître (patrouilles, renforts).
  { id: "gendarmerie", family: "car", name: "Gendarmerie", badge: { make: "Éduen", model: "Arroux Gendarmerie" }, icon: "🚓", toughness: 1.4, spec: POLICE_CAR, size: { length: 4.25, width: 1.8, height: 1.58 }, palette: ["#1f3466"] },
  // Véhicules uniques (D114) : un seul exemplaire, à sa place (`src/core/uniques.ts`).
  { id: "jeep-militaire", family: "car", name: "Jeep militaire", unique: true, badge: { make: "Couhard", model: "Sentinelle" }, toughness: 1.6, spec: JEEP, size: { length: 4.08, width: 1.84, height: 1.88 }, palette: ["#5b6b3f"] },
  { id: "pizza-du-vallon", family: "car", name: "Camion pizza", unique: true, badge: { make: "Couhard", model: "Pizza du Vallon" }, toughness: 1.5, spec: FOOD_TRUCK, size: { length: 6, width: 3.1, height: 3.62 }, palette: ["#7cc43a"] },
  { id: "rotisserie-champ-de-mars", family: "car", name: "Rôtisserie", unique: true, badge: { make: "Couhard", model: "Rôtisserie du Champ de Mars" }, toughness: 1.5, spec: FOOD_TRUCK, size: { length: 6, width: 3.1, height: 2.9 }, palette: ["#ece6da"] },
  { id: "petit-train", family: "car", name: "Petit train", unique: true, train: true, badge: { make: "Couhard", model: "Petit Train d'Autun" }, toughness: 2, spec: TRAIN_LOCO, size: { length: 4.4, width: 1.9, height: 2.6 }, palette: ["#2f6b4f"] },
  { id: "grumier-morvan", family: "car", name: "Grumier", unique: true, badge: { make: "Couhard", model: "Grumier du Morvan" }, toughness: 2.4, spec: LOG_TRUCK, size: { length: 9.2, width: 2.5, height: 3.33 }, palette: ["#a8322a"] },
  { id: "scooter-125", family: "moto", name: "Scooter 125", badge: { make: "Éduen", model: "Zéphyr 125" }, icon: "🛵", toughness: 0.6, spec: SCOOTER_125, size: { length: 1.92, width: 0.72, height: 1.26 }, palette: ["#efe3c8", "#9fb8a6", "#d9472b", "#8a8f96", "#1f3a52", "#f1b24a", "#8fa8c4"] },
  { id: "moto-routiere", family: "moto", name: "Moto routière", badge: { make: "Bibracte", model: "Druide" }, toughness: 0.7, spec: MOTO, size: { length: 2.09, width: 0.74, height: 1.28 }, palette: ["#7a2e2e", "#1f3a52", "#1b1d22", "#3f7d4e", "#c9b98a", "#d9472b"] },
  { id: "moto-sportive", family: "moto", name: "Moto sportive", badge: { make: "Bibracte", model: "Celte R" }, toughness: 0.65, spec: SPORT_MOTO, size: { length: 2.04, width: 0.63, height: 1.15 }, palette: ["#d9472b", "#f1b24a", "#2d6fb8", "#1b1d22", "#3f7d4e"] },
];

/** Dégâts d'un modèle (D109) : sa solidité, et s'il peut brûler (voitures et motos ; un vélo ou une trottinette se casse). */
export function damageProfile(def: VehicleDef): DamageProfile {
  return { toughness: def.toughness ?? 1, burns: def.family === "car" || def.family === "moto" };
}

const byId = new Map(CATALOG.map((d) => [d.id, d]));

export function vehicleDef(id: string): VehicleDef | undefined {
  return byId.get(id);
}

/** Couleur de peinture d'une variante (le numéro est ramené dans la palette, quel que soit son signe). */
export function paletteColor(def: VehicleDef, variant: number): string {
  return def.palette[Math.abs(Math.trunc(variant)) % def.palette.length]!;
}

/** Modèle des anciennes sauvegardes (version 1 : un seul modèle par type) et des anciens paramètres `?ride=`. */
export const LEGACY_MODELS: Readonly<Record<string, string>> = {
  bike: "velo-ville", scooter: "trottinette", car: "citadine", moto: "moto-routiere",
  velo: "velo-ville", voiture: "citadine",
};

/**
 * Anomalies d'une entrée, vides si elle est valable : toute nouvelle entrée doit passer par là (test sur tout le catalogue).
 * La coque (`hull`) est obligatoire, les passants la lisent pour les chocs (D44).
 */
export function defProblems(d: VehicleDef): string[] {
  const s = d.spec, out: string[] = [];
  if (!/^[a-z0-9-]+$/.test(d.id)) out.push("identifiant");
  if (d.palette.length === 0 || d.palette.some((c) => !/^#[0-9a-f]{6}$/i.test(c))) out.push("palette");
  if (!(s.mass > 0 && s.yawInertia > 0 && s.front > 0 && s.rear > 0 && s.wheelRadius > 0 && s.grip > 0)) out.push("fiche");
  if (!(s.topSpeed > s.driveFadeFrom && s.driveFadeFrom > 0 && s.power > 0 && s.maxDrive > 0 && s.maxBrake > 0)) out.push("vitesses");
  const { length, width, height } = d.size;
  if (!(length > 0.5 && width > 0.3 && height > 0.5 && width < length)) out.push("gabarit");
  if (s.hull.length === 0 || s.hull.some(([off, r]) => !Number.isFinite(off) || !(r > 0))) out.push("coque");
  // La coque recouvre à peu près la longueur et la largeur du véhicule (les passants s'y heurtent).
  const ends = s.hull.flatMap(([off, r]) => [off - r, off + r]);
  const hullLength = Math.max(...ends) - Math.min(...ends), hullWidth = 2 * Math.max(...s.hull.map(([, r]) => r));
  if (hullLength < 0.75 * length || hullLength > 1.2 * length || hullWidth < 0.5 * width || hullWidth > 1.3 * width) out.push("coque et gabarit");
  if (s.leans === (d.family === "car")) out.push("inclinaison (deux-roues seulement)");
  if (s.handbrake !== (d.family === "car")) out.push("frein à main (voiture seulement)");
  return out;
}
