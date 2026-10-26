/** Formats des fichiers produits par tools/data (public/data). Coordonnées locales en mètres :
 *  x vers l'est, y vers le nord, z vers le haut, relatif à l'altitude de référence du terrain. */

export interface TerrainMeta {
  cols: number;
  rows: number;
  res: number;
  /** Bord ouest de la grille. */
  x0: number;
  /** Bord sud. */
  y0: number;
  /** Bord nord. */
  y1: number;
  /** z de la valeur 0. */
  base: number;
  /** Mètres par unité de la valeur stockée. */
  unit: number;
  zmin: number;
  zmax: number;
}

export interface RoofFace {
  /** Plan z = a·x + b·y + c. */
  p: [number, number, number];
  /** Contour extérieur : x0, y0, x1, y1… (fermé : le dernier point répète le premier). */
  r: number[];
  h: number[][];
  /** Triangles (indices dans les sommets ouverts du contour puis des trous) ; absent si le calcul a échoué. */
  t?: number[];
  /** Sommets intérieurs supplémentaires x, y… (toit maillé), indexés après ceux du contour et des trous. */
  e?: number[];
  /** Altitude de chaque sommet quand elle diffère du plan (plafonnée sur la mesure LiDAR) ; absent sinon. */
  z?: number[];
}

export interface BuildingInfo {
  levels: number | null;
  height: number | null;
  walls: string | null;
  roof: string | null;
  year: number | null;
  use: string | null;
  use2: string | null;
  nature: string | null;
}

export interface Building {
  id: string;
  rnb: string | null;
  bd: BuildingInfo;
  ground: number;
  roofColor: string | null;
  /** Anneau extérieur ouvert, sens trigonométrique, nœuds de pignon inclus. */
  ring: number[];
  /** Haut du mur à chaque sommet de `ring`. */
  top: number[];
  holes: number[][];
  holeTop: number[][];
  faces: RoofFace[];
  /** Murs de raccord entre faces : x1, y1, zbas1, zhaut1, x2, y2, zbas2, zhaut2. */
  steps: number[][];
  /** Cheminées : cx, cy, largeur, profondeur, zbase, zhaut. */
  chim: number[][];
  roofKind: "flat" | "shed" | "gable" | "hip" | "complex";
  eave: number;
  ridge: number;
  q: { n: number; planes: number; fallback?: boolean };
}

export type StreetKind = "residential" | "tertiary" | "secondary" | "unclassified" | "service" | "living_street" | "pedestrian" | "footway" | "path" | "steps";

export interface Street {
  id: number;
  name: string | null;
  kind: StreetKind;
  motor: boolean;
  /** 1 : sens des points ; -1 : sens inverse ; 0 : double sens. */
  oneway: -1 | 0 | 1;
  surface: string | null;
  width: number;
  widthSource: "bdtopo" | "type";
  maxspeed: number | null;
  lanes: number | null;
  tunnel: boolean;
  calming: string | null;
  nodes: number[];
  pts: number[];
}

export interface Wall {
  id: number;
  kind: string;
  height: number;
  measured: number;
  pts: number[];
}

export interface Furniture {
  kind: string;
  x: number;
  y: number;
  name: string | null;
  id: number;
}

export interface Props {
  walls: Wall[];
  furniture: Furniture[];
}

/** x, y, z du sol, hauteur, rayon de couronne, hauteur du tronc. */
export type Tree = [number, number, number, number, number, number];

export interface GroundMeta {
  cols: number;
  rows: number;
  res: number;
  x0: number;
  y1: number;
}

export interface TileInfo {
  id: string;
  col: number;
  row: number;
  /** Emprise locale : x0, y0, x1, y1. */
  bounds: [number, number, number, number];
  buildings: number;
  trees: number;
  walls: number;
  furniture: number;
  bytes: number;
}

export interface WorldManifest {
  origin: [number, number];
  originZ: number;
  tileSize: number;
  cols: number;
  rows: number;
  /** Emprise locale de la zone : x0, y0, x1, y1. */
  zone: [number, number, number, number];
  tiles: TileInfo[];
}

/** Contenu détaillé d'une tuile de 250 m (fichier tiles/<col>_<row>.json). */
export interface TileData {
  /** Emprise locale de la tuile : x0, y0, x1, y1. */
  bounds: [number, number, number, number];
  /** Sols en vecteurs : couche -> polygones -> anneaux (extérieur puis trous), coordonnées aplaties. */
  ground: Record<string, number[][][]>;
  buildings: Building[];
  fiches: FacadeFiche[];
  trees: Tree[];
  walls: Wall[];
  furniture: Furniture[];
}

/** Silhouette d'un bâtiment pour les tuiles lointaines. */
export interface LodBuilding {
  /** Contour simplifié : x0, y0, x1, y1… */
  r: number[];
  /** Altitude d'égout et de faîtage. */
  e: number;
  g: number;
  /** Couleurs de mur et de toit. */
  w: string;
  t: string;
  m: RoofMaterial;
  /** Époque et clé de hachage de l'identifiant (CRC-32), pour que silhouette et détail aient la même couleur. */
  a: Era;
  k: number;
}

/** Ce qui est chargé une fois pour toutes au démarrage. */
export interface WorldBase {
  manifest: WorldManifest;
  terrain: import("./terrain").Terrain;
  streets: Street[];
  groundMeta: GroundMeta;
  groundA: HTMLImageElement;
  groundB: HTMLImageElement;
  lod: Record<string, LodBuilding[]>;
}

// --- Fiches façade (docs/facade-fiche.schema.json) ---------------------------------------

export type Era = "medieval" | "classical" | "xix" | "interwar" | "postwar" | "contemporary";
export type WindowStyle = "panes_6" | "panes_4" | "panes_2" | "french_window" | "picture" | "small";
export type RoofMaterial = "tuile_plate" | "tuile_mecanique" | "ardoise" | "zinc" | "terrasse";

export interface FacadeWindow {
  style: WindowStyle;
  width: number;
  height: number;
  surround: "stone" | "plaster_band" | "none";
  sill: boolean;
  lintel: "flat" | "segmental" | "arched" | "none";
  frameColor: string;
}

export interface WallRun {
  /** Indices de sommets dans `ring` (ou dans `holes[hole]`) : la série va de a à b en suivant l'anneau. */
  a: number;
  b: number;
  hole?: number;
  role: "street" | "court" | "party";
  length: number;
  eave: number;
  gable: boolean;
  datum: number;
}

export interface Shop {
  name: string | null;
  kind: string;
  wall: number;
  s: number;
  osm?: number;
}

export interface FacadeFiche {
  id: string;
  status: "estimated" | "observed";
  confidence: number;
  address?: string | null;
  monument?: { name: string; mhs?: string | null; note?: string } | null;
  era: Era;
  year?: number | null;
  levels: number;
  storeys: { ground: number; upper: number };
  materials: { wall: { kind: "plaster" | "ashlar" | "rubble" | "brick" | "concrete" | "cladding"; color: string }; roof: RoofMaterial };
  facade: {
    bayWidth: number;
    window: FacadeWindow;
    shutters: { kind: "battant" | "persienne" | "roulant" | "none"; color: string };
    balcony?: "none" | "filant" | "individuel";
    balconyLevel?: number;
    stringCourse?: boolean;
    corners?: "none" | "quoins";
    cornice: { kind: "stone_moulded" | "eaves_rafters" | "none"; height: number; projection: number };
    plinth: { height: number; color: string };
  };
  ground: {
    kind: "dwelling" | "shop" | "passage" | "monument" | "blank";
    door: { style: "simple" | "carriage" | "glazed" | "garage" | "none"; color: string };
    shopfront?: { color: string; glazing: "full" | "divided" };
    shops?: Shop[];
  };
  walls: WallRun[];
}
