import { BIKE, CAR, MOTO, SCOOTER, type VehicleSpec } from "./vehicle";

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
  /** Distance (m) à laquelle on peut monter. */
  reach: number;
  /** Côté de la descente : décalage latéral (m) vers la gauche. */
  dismount: number;
  camera: { distance: number; perSpeed: number; height: number };
  /** Traces de pneus : demi-voie (0 pour un deux-roues) et largeur de bande (m). */
  tyre: { track: number; width: number };
}

export const FAMILIES: Record<VehicleFamily, FamilyInfo> = {
  bike: { icon: "🚲", gas: "Pédaler", horn: "Sonnette", reach: 2.2, dismount: 0.75, camera: { distance: 3.9, perSpeed: 0.15, height: 0.2 }, tyre: { track: 0, width: 0.05 } },
  kickscooter: { icon: "🛴", gas: "Accélérer", horn: "Sonnette", reach: 2.2, dismount: 0.75, camera: { distance: 3.9, perSpeed: 0.15, height: 0.2 }, tyre: { track: 0, width: 0.06 } },
  car: { icon: "🚗", gas: "Accélérer", horn: "Klaxon", reach: 3.0, dismount: 1.45, camera: { distance: 6.2, perSpeed: 0.06, height: 0.55 }, tyre: { track: 0.74, width: 0.2 } },
  moto: { icon: "🏍️", gas: "Accélérer", horn: "Klaxon", reach: 2.2, dismount: 0.75, camera: { distance: 4.6, perSpeed: 0.07, height: 0.35 }, tyre: { track: 0, width: 0.12 } },
};

export interface VehicleDef {
  /** Identifiant stable (enregistré dans les sauvegardes : ne jamais le changer). */
  id: string;
  family: VehicleFamily;
  /** Nom affiché. */
  name: string;
  spec: VehicleSpec;
  /** Couleurs de peinture possibles ; l'exemplaire en prend une selon son numéro de variante. */
  palette: readonly string[];
}

export const CATALOG: readonly VehicleDef[] = [
  { id: "velo-ville", family: "bike", name: "Vélo de ville", spec: BIKE, palette: ["#2a6f7e", "#d9472b", "#1f3a52", "#3f7d4e", "#efe3c8"] },
  { id: "trottinette", family: "kickscooter", name: "Trottinette", spec: SCOOTER, palette: ["#2a6f7e", "#f1b24a", "#d9472b", "#3f7d4e"] },
  { id: "citadine", family: "car", name: "Citadine", spec: CAR, palette: ["#d9472b", "#2a6f7e", "#f1b24a", "#efe3c8", "#1f3a52", "#3f7d4e", "#b8a48a"] },
  { id: "moto-routiere", family: "moto", name: "Moto routière", spec: MOTO, palette: ["#d9472b", "#1f3a52", "#2a6f7e", "#f1b24a", "#3f7d4e"] },
];

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
  if (s.hull.length === 0 || s.hull.some(([off, r]) => !Number.isFinite(off) || !(r > 0))) out.push("coque");
  if (s.leans === (d.family === "car")) out.push("inclinaison (deux-roues seulement)");
  if (s.handbrake !== (d.family === "car")) out.push("frein à main (voiture seulement)");
  return out;
}
