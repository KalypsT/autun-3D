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
  | "care" | "culture" | "church" | "chapel" | "hidden" | "cart";

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

/**
 * Cathédrale modélisée d'après photo (D127), volumes mesurés au LiDAR (tools/data/build_monuments.py). Repère de `mon` : centre `c`, `s` le long
 * de la nef vers le chevet (angle `a`), `t` en travers vers l'est-nord-est ; altitudes absolues (locales).
 */
export interface CathedralModel {
  c: [number, number];
  a: number;
  /** Axe de la nef (t du faîtage). */
  t0: number;
  g: number;
  /** Entrée (D132) : parvis devant la façade, palier sous le porche, seuil des portes (altitudes). */
  entry: [number, number, number];
  /** Porche : s0, s1, t0, t1, égout, faîtage. */
  porch: [number, number, number, number, number, number];
  /** Tours du porche : côté de la tour ouest, de la tour est, haut du corps, pointe (d'après photo). */
  towers: [number, number, number, number];
  /** Nef : s0, s1 (croisée), t0, t1, égout, faîtage. */
  nave: [number, number, number, number, number, number];
  /** Bas-côtés ouest et est : t du mur extérieur, haut contre la nef, haut au mur extérieur. */
  aisles: [number, number, number][];
  /** Chapelles par travée : s0, s1, puis t extérieur et haut à l'ouest et à l'est (haut 0 : pas de chapelle). */
  chapels: [number, number, number, number, number, number][];
  /** Transept : s0, s1, t des pignons ouest et est, égout, faîtage. */
  transept: [number, number, number, number, number, number];
  /** Bloc carré au bout du bras ouest : t du mur qui le sépare du bras, égout, pointe du toit. */
  block: [number, number, number];
  /** Tour de croisée : s du centre, côté, haut du corps, pointe de la flèche, rayon de la flèche au pied (D129). */
  tower: [number, number, number, number, number];
  /** Flèche (D129) : haut des clochetons d'angle (altitude), hauteur des gâbles au pied de la flèche (photo). */
  spire: [number, number];
  /** Chœur : s du centre de l'abside, t0, t1, égout, faîtage. */
  choir: [number, number, number, number, number];
  /** Bas-côtés du chœur, comme `aisles`. */
  choirAisles: [number, number, number][];
  /** Abside : rayon, égout, nombre de pans. */
  apse: [number, number, number];
  /** Tourelle du chevet (D128) : s, t, côté, pointe mesurée. */
  turret: [number, number, number, number];
}

/**
 * Hôtel de ville modélisé d'après photo (D123), volumes mesurés au LiDAR (tools/data/build_monuments.py). Repère : origine `o` au coin de la
 * façade principale, `s` le long de la façade (angle `a`), `t` vers l'intérieur ; altitudes absolues (locales).
 */
export interface TownHallSpec {
  o: [number, number];
  a: number;
  /** Longueur de la façade, profondeur du corps principal. */
  l: number;
  d: number;
  /** Contour et cour en (s, t), même sens, le sommet k de la cour en face du coin k ; le côté 0 est la façade. */
  ring: number[];
  court: number[];
  /** Sol devant la façade, corniche et faîtage du corps principal. */
  g: number;
  eave: number;
  ridge: number;
  /** Ailes basses autour de la cour : égout, faîtage (sur leur ligne médiane). */
  wingEave: number;
  wingRidge: number;
  /** Nombre de travées de la façade. */
  bays: number;
  /** Pavillons : base s0, s1 ; plateau du toit s0, s1, t0, t1 ; haut (altitude). */
  pav: [number, number, number, number, number, number, number][];
  /** Hauts du soubassement et de l'étage noble au-dessus de `g`. */
  levels: [number, number];
  /** Portique de l'avant-corps central : bord avant du balcon (t), haut de sa balustrade (altitude). */
  portico?: [number, number];
  /** Perron : s0, s1, début de la volée (t, bord du palier), pied (t), altitude du palier. */
  perron?: [number, number, number, number, number];
  /** Escalier du relief (`stairs` de la tuile) que le perron remplace à l'écran. */
  stairs?: string;
  /** Lucarnes du toit du corps principal : abscisse, haut mesuré. */
  dormers?: [number, number][];
  /** Œils-de-bœuf sur les pavillons d'angle (photo). */
  oculi?: boolean;
  /** Haut mesuré de la lucarne-fronton de l'avant-corps central. */
  fronton?: number;
  /** Pointe mesurée de l'épi ou du paratonnerre de chaque pavillon (null : épi d'après photo). */
  tips?: (number | null)[];
  /** Cheminées : s, t, côté, haut. */
  chim?: [number, number, number, number][];
}

export interface BuildingKind {
  k: BuildingKindId;
  /** Texte de l'enseigne ou de l'inscription (bâtiment principal d'un site). */
  n?: string;
  /** Couleur du panneau et des lettres de l'enseigne. */
  c?: string;
  tc?: string;
  /** Auvent : « marquise » anthracite sur poteaux fins, le long d'une façade (correction à la main d'après photo, D122). */
  style?: "marquise";
  /** Abri à chariots : milieu du petit côté ouvert (D121). */
  open?: [number, number];
  /** 1 : bâtiment principal de son site (inscription, drapeaux). */
  main?: 1;
  /** Clocher : x, y, côté, z du haut de la tour, z de la pointe. */
  tower?: [number, number, number, number, number];
  /** Cathédrale : volumes mesurés (le gabarit remplace le clocher générique). */
  mon?: CathedralSpec;
  /** Cathédrale d'après photo (D127) : modèle dédié (remplace murs, toit et façade génériques, et le gabarit `mon`). */
  cath?: CathedralModel;
  /** Hôtel de ville : modèle dédié (remplace murs, toit et façade génériques). */
  hall?: TownHallSpec;
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
  | { t: "gate"; st: "arroux" | "andre"; n: string; x: number; y: number; a: number; l: number; w: number; top?: number }
  /**
   * Fontaine modélisée d'après photo (D131) : centre de l'édicule, orientation, mobilier OpenStreetMap remplacé (`id`), sol, haut et rayon
   * du bassin mesurés (altitudes absolues).
   */
  | { t: "fountain"; st: "lazare"; n: string; x: number; y: number; a: number; id: number; g: number; top: number; rb: number };

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
    /** Mur d'entrée (indice dans `walls`), qui reçoit vitrines et porte ; absent : le plus long mur sur rue (D120). */
    front?: number;
    /** Autres murs de l'entrée d'une grande surface, vitrés au rez-de-chaussée (correction à la main, D120). */
    frontWalls?: number[];
    /** Mur de la grande enseigne d'une grande surface (correction à la main, D120) ; absent : le plus grand mur de l'entrée. */
    signWall?: number;
    /** Milieu de la grande enseigne, en mètres depuis le début du mur `signWall` ; absent : au milieu du mur. */
    signAt?: number;
    /** Enseigne basse d'après photo : bas du panneau, en mètres au-dessus du sol (D122) ; absent : en haut du mur. */
    signZ?: number;
  };
  walls: WallRun[];
}
