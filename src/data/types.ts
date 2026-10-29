/** Formats des fichiers produits par tools/data (public/data). Coordonnées locales en mètres :
 *  x vers l'est, y vers le nord, z vers le haut, relatif à l'altitude de référence du terrain. */

/** Ce que le jeu demande au relief : l'altitude en un point et les limites du monde jouable. */
export interface HeightField {
  /**
   * Altitude de la surface : relief, ou tablier de pont et quai quand il y en a (D93). `zHint`, l'altitude actuelle de qui demande,
   * départage deux niveaux (le pont et la route qui passe dessous) ; sans lui, la surface la plus haute.
   */
  heightAt(x: number, y: number, zHint?: number): number;
  /** Relief nu, sans les tabliers (dessin du sol, de l'eau, des piles) ; absent : c'est le même. */
  readonly ground?: HeightField;
  /** Altitude des rails : tablier ferroviaire ou relief ; absent : `heightAt`. */
  railAt?(x: number, y: number): number;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** Niveau de la mer qui entoure le monde (z local, D105) ; absent : pas de mer. */
  readonly seaLevel?: number | undefined;
}

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
  /** Orientation (rad, repère données) quand elle est connue : crosse des lampadaires vers la chaussée. */
  rot?: number;
}

export interface Props {
  walls: Wall[];
  furniture: Furniture[];
}

/** x, y, z du sol, hauteur, rayon de couronne, hauteur du tronc. */
export type Tree = [number, number, number, number, number, number];

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
  /** Nombre de silhouettes dans lod/<id>.json (0 : pas de fichier). */
  lod: number;
  bytes: number;
}

export interface WorldManifest {
  origin: [number, number];
  originZ: number;
  tileSize: number;
  /** Taille de la grille mondiale (en tuiles) : toute la commune ; seules les tuiles de `tiles` existent. */
  cols: number;
  rows: number;
  /** Coin sud-ouest de la grille mondiale (repère local) : la tuile (col, ligne) commence à gridOrigin + (col, ligne) × tileSize. */
  gridOrigin: [number, number];
  /** Emprise locale des tuiles qui existent : x0, y0, x1, y1 (limites du monde jouable). */
  zone: [number, number, number, number];
  tiles: TileInfo[];
  /** Phase (mètres, modulo 1) du bord ouest et du bord nord de la grille fine du relief et des sols. */
  lattice: [number, number];
  /** Côté (en pixels de 1 m) d'un bloc fin de relief ou de sols. */
  blockSize: number;
  /** Relief de toute la zone, à gros pas (terrain/coarse.bin). */
  coarse: TerrainMeta;
  /** Sols grossiers par super-tuile de `tiles` × `tiles` tuiles, `res` mètres par pixel, `size` pixels de côté. */
  super: { tiles: number; res: number; size: number; cells: { id: string; x0: number; y1: number }[] };
  /** Mer qui entoure le monde (tools/data/build_coast.py, D105) : niveau (z local) et trait de côte (x0, y0, x1, y1…, anneau ouvert). */
  sea?: { z: number; coast: number[] };
}

/** Contenu détaillé d'une tuile de 250 m (fichier tiles/<col>_<row>.json). */
/** Talus du relief à dessiner en escalier (corrections manuelles, tools/data/manual.json). */
export interface StairsZone {
  id: string;
  /** Emprise locale : x0, y0, x1, y1. */
  bbox: [number, number, number, number];
  /** Altitude du bas de l'escalier et hauteur d'une marche. */
  base: number;
  riser: number;
}

// --- Types de bâtiments et sites (kinds/<tuile>.json, tools/data/build_kinds.py, D92) ------------------

export type BuildingKindId =
  | "retail" | "industrial" | "annex" | "sports" | "greenhouse" | "canopy" | "station" | "school" | "townhall" | "civic" | "post" | "hospital"
  | "care" | "culture" | "church" | "chapel" | "hidden";

/** Volumes d'une cathédrale mesurés au LiDAR (D95) : repère (centre, angle de l'axe, chevet vers les s positifs), abscisses, hauteurs. */
export interface CathedralSpec {
  c: [number, number];
  a: number;
  /** Décalage du faîtage de la nef en travers de l'axe. */
  t0: number;
  west: number;
  cross: number;
  east: number;
  /** Faîtage de la nef, au-dessus du sol (m). */
  ridge: number;
  /** Haut de la tour de croisée, pointe de la flèche, haut des tours de façade (altitudes absolues). */
  body: number;
  tip: number;
  towers: number;
  /** Sol de référence (altitude). */
  g: number;
}

export interface BuildingKind {
  k: BuildingKindId;
  /** Texte de l'enseigne ou de l'inscription (bâtiment principal d'un site). */
  n?: string;
  /** Couleur du panneau et des lettres de l'enseigne. */
  c?: string;
  tc?: string;
  /** 1 : bâtiment principal de son site (inscription, drapeaux). */
  main?: 1;
  /** Clocher : x, y, côté, z du haut de la tour, z de la pointe. */
  tower?: [number, number, number, number, number];
  /** Cathédrale : volumes mesurés (le gabarit remplace le clocher générique). */
  mon?: CathedralSpec;
}

export type PitchSport = "soccer" | "rugby" | "tennis" | "basketball" | "handball" | "multi" | "athletics" | "other";

export type Site =
  /** Station-service : auvent l × w centré en (x, y), grand côté orienté de `a` radians ; `roof` : bâtiment-auvent existant. */
  | { t: "fuel"; x: number; y: number; a: number; l: number; w: number; n?: string; c?: string; roof?: string }
  /** Terrain de sport : contour et rectangle orienté le plus petit (centre, angle du grand côté, longueur, largeur). */
  | { t: "pitch"; s: PitchSport; r: number[]; box: [number, number, number, number, number] }
  | { t: "track"; r: number[] }
  | { t: "cemetery"; r: number[] }
  /** Porte romaine (D95) : centre, angle du grand côté, longueur, épaisseur, haut mesuré (altitude) ; `st` : disposition (Arroux, Saint-André). */
  | { t: "gate"; st: "arroux" | "andre"; n: string; x: number; y: number; a: number; l: number; w: number; top?: number };

export interface TileKinds {
  v: number;
  buildings: Record<string, BuildingKind>;
  sites: Site[];
}

// --- Ponts, eau, voies ferrées (structures/<tuile>.json, tools/data/build_structures.py, D93) ------------------

export interface Deck {
  id: number;
  k: "road" | "foot" | "rail";
  /** Largeur du tablier (m). */
  w: number;
  /** Axe : x, y, z du dessus du tablier, par sommet. */
  p: number[];
  /** Style : voûtes en pierre, tablier droit, passerelle légère. */
  st: "stone" | "beam" | "light";
  /** Abscisses des piles le long de l'axe. */
  sp: number[];
  /** Tronçons de parapet infranchissables [s0, s1] (coupés au-dessus d'une voie). */
  pc: [number, number][];
  n?: string;
}

export interface Platform {
  /** Contour du quai (anneau aplati) et hauteur au-dessus du relief. */
  r: number[];
  h: number;
}

export interface TileStructures {
  v: number;
  decks: Deck[];
  /** Polygones d'eau découpés à la tuile : anneau extérieur puis trous. */
  water: number[][][];
  streams: { p: number[]; w: number }[];
  weirs: { p: number[] }[];
  /** Voies ferrées ; `s` : 1 pour une voie de service. */
  rails: { p: number[]; s: number }[];
  platforms: Platform[];
  /** Passages à niveau : x, y, angle de la voie ferrée. */
  crossings: [number, number, number][];
}

export interface TileData {
  /** Emprise locale de la tuile : x0, y0, x1, y1. */
  bounds: [number, number, number, number];
  /** Ponts, eau et voies ferrées (absent : aucun). */
  structures?: TileStructures;
  /** Types de bâtiments et sites remarquables (absent : aucun). */
  kinds?: TileKinds;
  /** Sols en vecteurs : couche -> polygones -> anneaux (extérieur puis trous), coordonnées aplaties. */
  ground: Record<string, number[][][]>;
  stairs?: StairsZone[];
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

/** Ce qui est chargé une fois pour toutes au démarrage : le plan du monde et le relief à gros pas. Le reste se charge par tuile. */
export interface WorldBase {
  manifest: WorldManifest;
  terrain: import("./terrain").TiledTerrain;
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
