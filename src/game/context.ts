import type * as THREE from "three";
import type { Colliders } from "../core/collision";
import type { WorldBase } from "../data/types";
import type { TileManager } from "../render/tile-manager";
import type { Atmosphere } from "../render/atmosphere";
import type { TerrainView } from "../render/terrain";
import type { SettingsController } from "./settings-controller";
import type { StartState } from "./start";

/** Ce que le jeu et le viewer partagent : rendu, scène, soleil et données du monde. */
export interface GameContext {
  renderer: THREE.WebGLRenderer;
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
  colliders: Colliders;
  params: URLSearchParams;
  debugEl: HTMLElement;
  /** Réglages du joueur (jeu seulement : le viewer et le banc gardent les valeurs par défaut, pour des mesures comparables). */
  settings: SettingsController | null;
  /** Départ de la partie (position, sauvegarde reprise) ; null hors du jeu. */
  start: StartState | null;
  /** Appelé quand le monde est prêt à être affiché (retire l'écran de chargement, signale aux captures). */
  ready: (extra?: object) => void;
}
