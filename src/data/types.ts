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
  | "care" | "culture" | "church" | "chapel" | "hidden" | "cart" | "house";

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

/**
 * Aile d'un collège (D148) : toit à deux pans sur l'axe p → q (bouts du faîtage), demi-largeurs `wl` (à gauche de l'axe) et `wr`, égouts `el` et
 * `er` de chaque côté et faîtage `r` (altitudes). Chaque bout est `hip` (croupe), `gable` (pignon plein) ou `ext` (pignon prolongé dans l'aile voisine).
 */
export interface CollegeWing {
  p: [number, number];
  q: [number, number];
  wl: number;
  wr: number;
  el: number;
  er: number;
  r: number;
  a: "hip" | "gable" | "ext";
  b: "hip" | "gable" | "ext";
  /** Lucarnes (D151) sur le pan gauche (`dl`) et le pan droit (`dr`) : [« ped » (fronton triangulaire) ou « rect » (chien-assis), pas en m]. */
  dl?: ["ped" | "rect", number];
  dr?: ["ped" | "rect", number];
}

/** Avant-corps central d'une façade (D151) : sur le pan `left` ou droit de l'aile `w`, à `u` mètres de son début, demi-largeur `hw`. */
export interface CollegePavilion {
  w: number;
  left: boolean;
  u: number;
  hw: number;
}

/**
 * Grille d'honneur d'un collège (D149) : de `a` à `b` (clôture OpenStreetMap), soubassement de pierre, ferronnerie dorée, portail central de largeur
 * `portal[1]` à `portal[0]` mètres de `a` ; `walls` : murs et clôtures des tuiles qu'elle remplace (identifiants) ; `trees` : arbres de la carte
 * (tuples des tuiles) remplacés par des arbres taillés en rideau derrière elle.
 */
export interface CollegeGrille {
  a: [number, number];
  b: [number, number];
  walls: number[];
  trees: Tree[];
  portal: [number, number];
}

/**
 * Église Notre-Dame d'après photo et relevé LiDAR (D150). Repère : origine `o` au milieu de la façade (côté place), `s` vers le chevet (cap `a`),
 * `t` à sa gauche (vers le sud-est). `wings` : nef (toit à deux pans, pignon côté façade, croupe côté chevet) puis transept (deux croupes) ;
 * `aisles` : bas-côtés en appentis côté façade (de s = 0 à `s1`, entre le mur de la nef et les faces extérieures `tNW` et `tSE`, haut mesuré
 * à la nef `top` et égout `eave`) ; `front` : haut de l'étage bas de la façade ; `transept` : s0, s1 ; `turret` : clocheton (x, y, rayon, haut
 * de la lanterne, sommet mesuré) ; `t0`, `hw` : axe et demi-largeur de la nef.
 */
export interface NotreDameSpec {
  o: [number, number];
  a: number;
  wings: CollegeWing[];
  t0: number;
  hw: number;
  transept: [number, number];
  aisles: { s1: number; tNW: number; tSE: number; top: number; eave: number };
  front: number;
  turret: { x: number; y: number; r: number; lantern: number; top: number };
}

/** Collège d'après relevé LiDAR (D148) : ailes à toits mesurés ; les murs suivent le contour BD TOPO, chacun monte à l'égout de l'aile la plus proche. */
export interface CollegeSpec {
  wings: CollegeWing[];
  /** Couleur de la couverture (tuiles brunes par défaut ; zinc gris pour l'aile de la rue aux Raz). */
  roof?: string;
  /** Grille d'honneur sur la place du Champ de Mars et arbres taillés derrière elle (D149). */
  grille?: CollegeGrille;
  /** Avant-corps à fronton cintré, inscription et drapeaux (D151). */
  pavilions?: CollegePavilion[];
}

export interface BuildingKind {
  k: BuildingKindId;
  /** Texte de l'enseigne ou de l'inscription (bâtiment principal d'un site). */
  n?: string;
  /** Couleur du panneau et des lettres de l'enseigne. */
  c?: string;
  tc?: string;
  /** Auvent : « marquise » anthracite sur poteaux fins, le long d'une façade (correction à la main d'après photo, D122). */
  style?: "marquise" | "lidl";
  /** Plan du toit mesuré au LiDAR (D143) : z = a·x + b·y + c (repère local) et hauteur de l'acrotère ; remplace le toit plat du gabarit. */
  roof?: [number, number, number, number];
  /** Magasin d'après photo (D143) : façade vitrée, sas, panneaux, galerie… (remplace l'entrée générique de la grande surface). */
  store?: StoreModel;
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
  /** Couleur de la couverture imposée (zinc des annexes du lycée, D152) ; sinon celle du gabarit ou de la fiche. */
  zinc?: string;
  /** Église Notre-Dame d'après photo (D150) : modèle dédié (remplace murs, toit et façade génériques). */
  nd?: NotreDameSpec;
  /** Partie de Notre-Dame dessinée par le modèle `nd` d'un autre bâtiment (le chevet, D150) : ni murs ni toit génériques. */
  ndPart?: 1;
  /** Collège d'après relevé (D148) : modèle dédié (remplace murs, toit et façade génériques). */
  college?: CollegeSpec;
  /** Hôtel de ville : modèle dédié (remplace murs, toit et façade génériques). */
  hall?: TownHallSpec;
  /** Église Saint-André d'après photo (D138) : modèle dédié (remplace murs, toit et façade génériques). */
  chap?: ChapelModel;
  /** Maison d'après photo (D140) : modèle dédié (remplace murs, toit, façade et obstacle génériques). */
  house?: HouseModel;
}

/**
 * Magasin d'après photo (D143, D144, tools/data/build_stores.py). `e` : arête du contour (sommet e vers e + 1) qui porte la façade ; les abscisses
 * `s` se comptent en mètres depuis le sommet e. Lidl : mur vitré sur `glass`, sas `door` (centre, largeur), panneaux perpendiculaires aux
 * abscisses `blades`, long mur plein `side` (arête, casier [s, largeur], grilles, zone hachurée [s0, s1, distance mini, distance maxi]).
 * Pharmacie : vitrage sur `glass` en retrait de `gallery` mètres sous la galerie, croix de la façade et du toit (`cross`).
 * Bricomarché : vitrage `glass` et portique `door` sous l'auvent `canopy` [s0, s1, profondeur], enseigne `sign` [s, hauteur], tondeuses `display`
 * [s0, s1]. Intermarché : lames rouges `slats` [s0, s1], vitrage, porte, enseigne, store du Drive `tent` (x, y) et abris solaires `carports`.
 * But : bloc central `block` [s0, s1] plus haut, auvent, vitrine, enseigne carrée, triangles gris sur les arêtes `wings`.
 * Jardinerie : pavillons vitrés à pignon `pavilions` [arête, s0, s1, égout, faîtage] et bannière `banner` [arête, s0, s1, bas, haut].
 * D145 : galeries marchandes (`galerie`) : `units` (une enseigne par unité, sur l'arête e entre s0 et s1), auvent vitré `arcade`, aires de jeux `play` ;
 * GiFi (`gifi`) : tour d'entrée orange `tower` [s, largeur, haut] ; Action (`action`) : unités vitrées dont une condamnée.
 * D146 : Espace Aubade et Comptoir des Fers (`comptoir` : quatre volumes de BD TOPO redécoupés en `extra`, murs et toits `wall` et `roofc`), rotonde
 * d'entrée (`rotonde` : vitrage et poteaux bleus sous un bandeau blanc) et Norauto (`norauto` : portes d'atelier, bloc d'entrée bleu `block`, panneau `panel`).
 */
export interface StoreModel {
  style: "lidl" | "pharmacy" | "bricomarche" | "intermarche" | "but" | "jardinerie" | "galerie" | "gifi" | "action" | "comptoir" | "rotonde" | "norauto";
  e: number;
  glass: [number, number];
  door?: [number, number];
  blades?: number[];
  side?: { e: number; locker: [number, number]; vents: number[]; hatch: [number, number, number, number] };
  gallery?: number;
  cross?: [number, number];
  canopy?: [number, number, number];
  sign?: [number, number];
  display?: [number, number];
  slats?: [number, number];
  tent?: [number, number];
  carports?: Carport[];
  block?: [number, number];
  wings?: number[];
  pavilions?: [number, number, number, number, number][];
  banner?: [number, number, number, number, number];
  tower?: [number, number, number];
  units?: StoreUnit[];
  arcade?: Arcade;
  play?: [number, number, number][];
  panel?: [number, number, number, number];
  wall?: string;
  roofc?: string;
}

/**
 * Unité d'une galerie ou d'un magasin à plusieurs enseignes (D145) : arête du contour, s0, s1 (mètres depuis le sommet de l'arête), nom, couleur du
 * bandeau (vide : pas de bandeau), couleur des lettres, mode (« glass » : vitrine et porte, « wall » : mur plein et porte étroite, « board » : vitrine
 * condamnée, « garage » : porte d'atelier, « blank » : mur plein, « bay » : vitrage sans porte), position de la porte depuis s0 (sinon au milieu).
 */
export type StoreUnit = [number, number, number, string, string, string, ("glass" | "wall" | "board" | "garage" | "blank" | "bay")?, number?];

/** Auvent vitré continu sur poteaux fins (D145) : tronçons [arête, s0, s1], distances au mur du bord arrière et du bord avant (m), hauteur du dessus au-dessus du sol (m). */
export interface Arcade {
  runs: [number, number, number][];
  o: [number, number];
  z: number;
}

/** Abri de parking solaire mesuré au LiDAR (D144) : centre (x, y), angle du grand côté (degrés, x vers l'est), longueur, largeur, plan du dessus z = a·x + b·y + c. */
export type Carport = [number, number, number, number, number, number, number, number];

/** Ouverture d'une maison (D140) : mur du L, distance depuis son début, genre, largeur, hauteur, appui. */
export type HouseOpening = [number, number, "lamp"] | [number, number, "door2" | "door4" | "window1" | "window2", number, number, number?];

/**
 * Maison d'après photo (D140, tools/data/build_monuments.py), dans son repère (origine `o`, angle `a` de l'axe s, `sg` : sens de t) ;
 * hauteurs au-dessus du sol `g`. Plan en L : corps [s0, s1] × [t0, t1] et aile [sw, s1] × [t0, tw] (murs, mesurés au LiDAR) ; toit à croupes
 * de pente `pitch`, débord `ov`, pans précalculés (contour en (s, t), plan z = a·s + b·t + c).
 */
export interface HouseModel {
  o: [number, number];
  a: number;
  sg: 1 | -1;
  g: number;
  eave: number;
  pitch: number;
  ov: number;
  walls: [[number, number, number, number], [number, number, number, number]];
  roof: { r: number[]; k: [number, number, number] }[];
  /** Entrée couverte au coin (sw, tw) : côtés du renfoncement (le long du bout de l'aile, le long de son côté), porte d'entrée (largeur, hauteur). */
  porch: [number, number, number, number];
  /** Lucarnes : pan (« main » : pan sud-est du corps ; « wing » : bout de l'aile), abscisse s, largeur. */
  dormers: ["main" | "wing", number, number][];
  /** Cheminée : s, t, haut. */
  chim: [number, number, number];
  openings: HouseOpening[];
  colors: { wall: string; roof: string; shutter: string };
  fit?: number;
}

/**
 * Église accolée à une porte romaine (D138, tools/data/build_monuments.py), dans le repère de la porte (origine `o`, angle `a`) ; hauteurs
 * au-dessus du sol `g`.
 */
export interface ChapelModel {
  o: [number, number];
  a: number;
  /** Nef : s0, s1 (largeur), t0 (côté de la tour ronde), t1 (pignon d'entrée). */
  nave: [number, number, number, number];
  g: number;
  eave: number;
  ridge: number;
  /** Tour ronde : centre (s, t), rayon, égout, pointe du toit conique. */
  round: [number, number, number, number, number];
  /** Porte du pignon d'entrée : décalage depuis son milieu, largeur, hauteur. */
  door: [number, number, number];
  /** Baies en plein cintre : côté (−1 : mur s0, 1 : mur s1), distance depuis le pignon d'entrée, largeur, appui, hauteur. */
  windows: [number, number, number, number, number][];
  light?: 1;
}

export type PitchSport = "soccer" | "rugby" | "tennis" | "basketball" | "handball" | "multi" | "athletics" | "other";

export type Site =
  /** Station-service : auvent l × w centré en (x, y), grand côté orienté de `a` radians ; `roof` : bâtiment-auvent existant. */
  | { t: "fuel"; x: number; y: number; a: number; l: number; w: number; n?: string; c?: string; roof?: string }
  /** Terrain de sport : contour et rectangle orienté le plus petit (centre, angle du grand côté, longueur, largeur). */
  | { t: "pitch"; s: PitchSport; r: number[]; box: [number, number, number, number, number] }
  /** Piste ; `s` : « dirt », terre battue (correction d'après photo, D133), sinon synthétique. */
  | { t: "track"; r: number[]; s?: "dirt" }
  | { t: "cemetery"; r: number[] }
  /** Porte romaine (D95) : centre, angle du grand côté, longueur, épaisseur, haut mesuré (altitude) ; `st` : disposition (Arroux, Saint-André). */
  | { t: "gate"; st: "arroux" | "andre"; n: string; x: number; y: number; a: number; l: number; w: number; top?: number; gm?: GateModel }
  /**
   * Fontaine modélisée d'après photo (D131) : centre de l'édicule, orientation, mobilier OpenStreetMap remplacé (`id`), sol, haut et rayon
   * du bassin mesurés (altitudes absolues).
   */
  | { t: "fountain"; st: "lazare"; n: string; x: number; y: number; a: number; id: number; g: number; top: number; rb: number }
  | TheatreSite
  | JanusSite
  | RoundaboutSite
  | CurtainSite
  | BandstandSite;

/**
 * Îlot de rond-point d'après photo (D142, tools/data/build_roundabouts.py) : centre et rayon du milieu de la bordure (orthophoto), largeur
 * de la bordure, chaussée autour `g` et bombé de l'îlot (LiDAR) ; arbre du centre (tronc, haut et rayon de la couronne par palier, au-dessus
 * du terrain) ; massif de fleurs (rayons autour du tronc, couleurs, photo) ; mobilier de la carte retiré de l'îlot (`drop`).
 */
export interface RoundaboutSite {
  t: "roundabout";
  n: string;
  c: [number, number];
  r: number;
  curb: number;
  g: number;
  mound: number;
  fit?: [number, number];
  tree: { k: "cedar"; x: number; y: number; top: number; tiers: [number, number][] };
  bed: [number, number];
  flowers: string[];
  drop: number[];
}

/**
 * Tilleuls taillés en rideau de la place du Champ de Mars (D155, tools/data/build_square.py) : rectangle orienté (centre `c`, cap `a` du grand côté,
 * longueur `l`, largeur `w`), sol médian `g`, haut mesuré au LiDAR `top` au-dessus du sol local ; les files de troncs (`rows`, en part de la largeur)
 * ont un pas `pitch`, un tronc nu jusqu'à `trunk` et une couronne de `crown` m d'épaisseur sous le haut (photos et orthophotographie). Les arbres
 * génériques de la carte qui sont dedans ne sont plus dessinés.
 */
export interface CurtainSite {
  t: "curtain";
  n: string;
  c: [number, number];
  a: number;
  l: number;
  w: number;
  g: number;
  top: number;
  fill: number;
  trunk: number;
  pitch: number;
  rows: number[];
  crown: number;
}

/**
 * Kiosque à musique d'après photo et relevé LiDAR (D155) : octogone de cercle circonscrit `r` (contour BD TOPO, masqué), sommets à partir du cap `ph`,
 * `nv` sommets ; terrain sur le contour de `lo` à `hi`, plancher à `hi + floor`, sommet de l'épi `top` ; marches du côté bas (cap `low`) ; colonnes de
 * `post` m de côté, égout à `eave` m au-dessus du plancher.
 */
export interface BandstandSite {
  t: "bandstand";
  n: string;
  id: string;
  c: [number, number];
  r: number;
  ph: number;
  nv: number;
  lo: number;
  hi: number;
  top: number;
  low: number;
  floor: number;
  post: number;
  eave: number;
  steps: number;
}

/** Mur debout du temple de Janus (D139) : abscisses d depuis le coin extérieur commun, hauteurs au-dessus du sol `g` du site. */
export interface JanusWall {
  /** Arches traversantes : milieu, largeur, naissance de l'arc. */
  arches: [number, number, number][];
  /** Niches (sur les deux faces) : milieu, largeur, bas, haut (arc compris). */
  niches: [number, number, number, number][];
  /** Baies traversantes de l'étage : milieu, largeur, appui, naissance de l'arc. */
  windows: [number, number, number, number][];
  /** Dessus ruiné (d, z). */
  top: [number, number][];
}

/**
 * Temple de Janus d'après photo (D139, tools/data/build_monuments.py) : cella carrée, repère au coin extérieur commun des deux murs debout
 * (`o`), s le long du mur `S` (angle `a`), t le long du mur `W` ; longueurs et épaisseurs mesurées au LiDAR ; terre-plein et souches des
 * murs arasés (hauteurs au-dessus de `g`) ; mur OpenStreetMap remplacé (`wall`).
 */
export interface JanusSite {
  t: "janus";
  n: string;
  o: [number, number];
  a: number;
  L: [number, number];
  tw: [number, number];
  g: number;
  pod: number;
  low: number;
  wall: number;
  S: JanusWall;
  W: JanusWall;
  /** Trous de boulin : pas horizontal et vertical. */
  putlog: [number, number];
  light?: 1;
}

/**
 * Porte romaine d'après photo (D137, tools/data/build_monuments.py) : centre et épaisseur du corps mesurés au LiDAR, rue (altitude absolue),
 * le reste lu sur la photo de face. Abscisses `s` le long de la porte depuis le centre `c` (sens de l'angle `a` du site), hauteurs au-dessus
 * de la rue `g`.
 */
export interface GateModel {
  c: [number, number];
  /** Longueur mesurée (D138 : bouts au LiDAR et contre l'emprise d'un bâtiment) ; sinon celle du site. */
  l?: number;
  /** Épaisseur du corps. */
  w: number;
  g: number;
  /** Rue de chaque côté (t < 0, t > 0), à 3 m des faces. */
  street: [number, number];
  /** Haut du corps au relevé (contrôle). */
  body: number;
  piers: [number, number][];
  /** Arches : s0, s1, naissance de l'arc. */
  arches: [number, number, number][];
  /** Largeur des archivoltes. */
  band: number;
  /** Corniche au-dessus des arches (bas, haut). */
  cornice: [number, number];
  /** Haut de l'attique (appui de la galerie). */
  attic: number;
  /**
   * Galerie : abscisses des pilastres (n + 1, depuis le bout gauche de la photo), largeur des arcades, haut de leur arc, entablement (bas,
   * haut), arcades conservées (indices, bornes comprises), murs à arcades (t0, t1 : un sur une face, ou un sur chaque face avec le couloir
   * entre les deux).
   */
  gal: { s: number[]; open: number; crown: number; ent: [number, number]; keep: [number, number]; t: [number, number][] };
  /** Haut du corps (s, z), dans le sens des s croissants ; deux points de même s font une marche (ruine). */
  top: [number, number][];
  /** Blocage apparent, parement perdu (s0, s1, z0, z1), sur les deux faces. */
  rubble: [number, number, number, number][];
  /** Bloc en saillie au sommet de la galerie (s0, s1, haut). */
  block?: [number, number, number];
  /** Toit de tuiles à croupes au-dessus de la galerie (égout, faîtage). */
  roof?: [number, number];
  /** Tour de moellons à un bout (s0, s1, t0, t1, haut). */
  tower?: [number, number, number, number, number];
  /** Teinte de la pierre (sinon le calcaire gris clair d'Arroux). */
  stone?: string;
  /** Éclairée la nuit (projecteurs au pied). */
  light?: 1;
}

/**
 * Théâtre romain modélisé d'après photo (D133), mesuré au LiDAR (tools/data/build_monuments.py). Repère polaire : centre `c`, axe `a` (du
 * centre vers le fond de la cavea), angles `u` relatifs à l'axe (radians) ; rayons en mètres, altitudes absolues (locales).
 */
export interface TheatreSite {
  t: "theatre";
  /** Bâtiment BD TOPO remplacé (masqué). */
  id: string;
  n: string;
  c: [number, number];
  a: number;
  /** Orchestre : altitude, rayon (pied du podium). */
  zo: number;
  ro: number;
  /** Demi-ouverture mesurée de la pente (la cavea est dessinée en demi-cercle). */
  span: number;
  /** Gradins restaurés : nombre de rangs (photo), rayon du premier et de la fin du dernier, haut du premier et du dernier. */
  rows: [number, number, number, number, number];
  /** Étendue angulaire des gradins restaurés (orthophotographie). */
  rest: [number, number];
  /** Précinction : rayons intérieur et extérieur, altitude. */
  pr: [number, number, number];
  /** Partie haute : pied (r2), début de la terrasse (r3), lisière des arbres (r4), sommet (r5) et son altitude. */
  up: [number, number, number, number, number];
  /** Escaliers : angles en bas ; en haut, angle et altitude du haut ; largeur des escaliers du haut. */
  lanes: [number[], [number, number][], number];
  /**
   * Coins de la partie haute : u0, u1, ruiné (1 : profil en paliers de r2 à r4) ou non (altitudes à r2, r3, r4), nombre de rangs restaurés
   * sur la pente de r2 à r3 (0 : herbe ; photos, D134).
   */
  cun: [number, number, number, number[], number][];
  /** Massifs ruinés du bas, au-delà des gradins : u0, u1, profil en paliers de ro à r2. */
  ends: [number, number, number[]][];
  /** Scène moderne : quatre coins (le premier côté face à l'orchestre), dessus, profondeur des marches. */
  stage: number[];
  /** Poteaux d'éclairage (pied x, y ; hauteur au-dessus du sol) et arbustes taillés (x, y, hauteur) : orthophotographie et photos, D136. */
  poles?: [number, number, number][];
  shrubs?: [number, number, number][];
}

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

/**
 * Devanture en applique d'après photo (D141, `fronts` de manual.json) : travées de gauche à droite vu de la rue, à partir de `s0` mètres du
 * début du mur d'entrée ; hauteurs au-dessus du trottoir.
 */
export interface Devanture {
  s0: number;
  /** Haut du bandeau supérieur. */
  h: number;
  /** Appui des vitrines (haut des soubassements de pierre). */
  sill: number;
  /** Haut des baies (vitrines et portes). */
  top: number;
  frieze: [number, number];
  /** Haut de la corniche (posée sur la frise). */
  cornice: number;
  bays: ["pilaster" | "door" | "window" | "shopdoor", number][];
  stone: string;
  sign: { text: string; bg: string; fg: string; s: [number, number]; z: [number, number] };
  /** Inscription sur une vitrine, numéro sur un pilastre : [travée, texte]. */
  label?: [number, string];
  number?: [number, string];
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
    /** Devanture d'après photo (D141), dessinée telle quelle sur le mur d'entrée à la place des vitrines génériques. */
    devanture?: Devanture;
  };
  walls: WallRun[];
}
