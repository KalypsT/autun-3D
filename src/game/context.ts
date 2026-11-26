import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import type { WorldBase } from "../data/types";
import type { TileManager } from "../render/tile-manager";
import type { Atmosphere } from "../render/atmosphere";
import type { TerrainView } from "../render/terrain";
import type { Vista } from "../render/vista";
import type { SettingsController } from "./settings-controller";
import type { StartState } from "./start";
import type { StorageLike } from "../core/save";
import type { GameHost } from "../domothib/host";
import type { PostFx } from "../render/post";

/** Ce que le jeu et le viewer partagent : rendu, scène, soleil et données du monde. */
export interface GameContext {
  renderer: THREE.WebGLRenderer;
  /** Effets d'image (D314) : toujours dessiner la scène par `post.render`, jamais `renderer.render` (sinon ni couleurs ni halo). */
  post: PostFx;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh;
  sunLight: THREE.DirectionalLight;
  /** Direction vers le soleil dans le repère three. */
  sunDir: THREE.Vector3;
  atmosphere: Atmosphere;
  world: WorldBase;
  tiles: TileManager;
  terrainView: TerrainView;
  /** Panorama (D268) : en hauteur, l'horizon s'éloigne. */
  vista: Vista;
  colliders: Colliders;
  params: URLSearchParams;
  debugEl: HTMLElement;
  /** Réglages du joueur (jeu seulement : le viewer et le banc gardent les valeurs par défaut, pour des mesures comparables). */
  settings: SettingsController | null;
  /** Départ de la partie (position, sauvegarde reprise) ; null hors du jeu. */
  start: StartState | null;
  /** Stockage de la partie et de l'apparence : sauvegardes du joueur dans DomoThib, sinon `localStorage` ; null : rien n'est enregistré (D305). */
  storage: StorageLike | null;
  /** DomoThib (pause, reprise, quitter) ; null quand le jeu tourne seul (D305). */
  host: GameHost | null;
  /** Appelé quand le monde est prêt à être affiché (« Touche l'écran pour jouer », ou retire l'écran de chargement ; signale aux captures). */
  ready: (extra?: object) => void;
  /** Résolue quand l'écran de chargement est fermé (D338) : le toucher du joueur, ou tout de suite hors du jeu et avec un paramètre de test. */
  started: Promise<void>;
}
