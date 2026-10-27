import { addDays, type SaveGame, type SaveStore } from "../core/save";
import { NotesStore } from "../core/notes-store";
import type { Waypoint } from "../core/waypoint";
import { WaypointMarker } from "../render/waypoint-marker";
import { BigMap } from "../ui/bigmap";
import { MapData } from "../ui/map-data";
import { Minimap, type MinimapVehicle } from "../ui/minimap";
import { openNotesBackend } from "../ui/notes-idb";
import { PauseMenu } from "../ui/pause-menu";
import type { Controls } from "../input/controls";
import type { GameContext } from "./context";
import type { Fleet } from "./vehicles";

/** Ce que l'interface doit savoir du jeu à un instant donné. */
export interface GameState {
  x: number;
  y: number;
  z: number;
  /** Direction du joueur ou du véhicule conduit (rad, 0 = nord). */
  facing: number;
  yaw: number;
  pitch: number;
  ridingId: string | null;
}

const AUTOSAVE_MS = 30000;
const MINIMAP_HZ = 16;
/** Véhicules garés montrés sur la minimap : dans ce rayon (m). */
const MINIMAP_VEHICLE_RADIUS = 150;
const SHOT_WIDTH = 800;

/**
 * Tout ce qui entoure le jeu : horloge, minimap, repère, menu pause, carte agrandie, notes, sauvegarde. Le jeu lui donne l'état
 * (`state`) et lui demande, à chaque image, de se mettre à jour (`tick`) ; la pause (`paused`) est son seul effet sur la simulation.
 */
export class UiBridge {
  paused = false;
  waypoint: Waypoint | null;
  readonly minimap: Minimap;
  readonly marker: WaypointMarker;
  private bigmap: BigMap | null = null;
  private readonly menu: PauseMenu;
  private readonly clockEl = document.getElementById("clock")!;
  private clockText = "";
  private clockTimer = 0;
  private miniTimer = 0;
  private shot: HTMLCanvasElement | null = null;
  private frozen: { x: number; y: number; z: number; heading: number; hour: number; day: number } | null = null;
  private lastSaved: number | null;
  private suppress = false;
  private notes: Promise<{ store: NotesStore; persistent: boolean }> | null = null;
  /** La carte agrandie couvre tout l'écran : inutile de dessiner le monde derrière. */
  get coversScreen(): boolean {
    return this.bigmap?.isOpen ?? false;
  }

  /** Pour redessiner l'écran figé quand un réglage change pendant la pause. */
  needsRender = false;
  private readonly vehicles: MinimapVehicle[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly controls: Controls,
    private readonly fleet: Fleet,
    private readonly saveStore: SaveStore | null,
    private readonly state: () => GameState,
    initial: SaveGame | null,
  ) {
    const settings = ctx.settings!;
    this.waypoint = initial?.waypoint ?? null;
    this.lastSaved = initial?.savedAt || null;
    this.minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement);
    this.marker = new WaypointMarker(ctx.world.terrain);
    ctx.scene.add(this.marker.group);
    this.marker.set(this.waypoint);

    this.menu = new PauseMenu({
      resume: () => this.setPaused(false),
      openMap: () => this.openMap(),
      settings: () => ({ values: settings.values, locked: settings.locked }),
      setSettings: (p) => {
        settings.set(p);
        this.needsRender = true;
      },
      save: () => this.save(),
      savedAt: () => this.lastSaved,
      newGame: () => this.newGame(),
      pauseShot: () => new Promise((resolve) => (this.shot ? this.shot.toBlob((b) => resolve(b), "image/jpeg", 0.82) : resolve(null))),
      situation: () => this.frozen ?? this.situation(),
      notes: () => (this.notes ??= this.openNotes()),
      build: typeof __BUILD__ === "string" ? __BUILD__ : "dev",
    });

    // Les données de la carte arrivent après le démarrage : la minimap et la carte agrandie s'activent à ce moment-là.
    MapData.load().then(
      (data) => {
        this.minimap.attach(data);
        this.bigmap = new BigMap(data, {
          player: () => {
            const s = this.state();
            return { x: s.x, y: s.y, facing: s.facing };
          },
          waypoint: () => this.waypoint,
          setWaypoint: (w) => this.setWaypoint(w),
          close: () => {
            this.bigmap?.close();
            this.menu.open("home");
          },
        });
      },
      (e: unknown) => console.warn("carte indisponible :", e),
    );

    document.getElementById("pausebtn")?.addEventListener("click", () => this.setPaused(true));
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      // Dans un champ de texte (note), seule Échap agit : taper « p » ne doit pas relancer le jeu.
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (e.code === "Escape" || (e.code === "KeyP" && !typing)) this.back();
    });
    if (this.saveStore) {
      setInterval(() => {
        if (!this.paused) this.save();
      }, AUTOSAVE_MS);
      const leave = (): void => {
        if (!this.suppress && !this.paused) this.save();
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") leave();
      });
      window.addEventListener("pagehide", leave);
    }
    settings.listeners.push(() => {
      this.needsRender = true;
    });
  }

  // --- Pause ---------------------------------------------------------------------------------------------------------------

  /** Échap ou P : ferme la carte, puis le menu ; sinon met en pause. */
  back(): void {
    if (this.bigmap?.isOpen) {
      this.bigmap.close();
      this.menu.open("home");
    } else if (this.paused) this.setPaused(false);
    else this.setPaused(true);
  }

  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    document.body.classList.toggle("paused", on);
    if (on) {
      this.controls.reset();
      // Dernière image et capture dans la même tâche : le tampon de dessin est encore valide.
      const { renderer, scene, camera } = this.ctx;
      renderer.render(scene, camera);
      this.capture();
      const s = this.state();
      this.frozen = { x: s.x, y: s.y, z: s.z, heading: s.yaw, hour: this.ctx.atmosphere.hour, day: this.ctx.atmosphere.day };
      this.save();
      this.menu.open("home");
    } else {
      this.bigmap?.close();
      this.menu.close();
      this.frozen = null;
      this.controls.reset();
    }
  }

  private situation(): { x: number; y: number; z: number; heading: number; hour: number; day: number } {
    const s = this.state();
    return { x: s.x, y: s.y, z: s.z, heading: s.yaw, hour: this.ctx.atmosphere.hour, day: this.ctx.atmosphere.day };
  }

  private capture(): void {
    const src = this.ctx.renderer.domElement;
    if (!src.width || !src.height) return;
    const c = (this.shot ??= document.createElement("canvas"));
    c.width = SHOT_WIDTH;
    c.height = Math.round((SHOT_WIDTH * src.height) / src.width);
    c.getContext("2d")?.drawImage(src, 0, 0, c.width, c.height);
  }

  private openMap(): boolean {
    if (!this.bigmap) return false;
    this.menu.close();
    this.bigmap.open();
    return true;
  }

  private openNotes(): Promise<{ store: NotesStore; persistent: boolean }> {
    return openNotesBackend().then(async ({ backend, persistent }) => {
      const store = new NotesStore(backend);
      await store.load();
      return { store, persistent };
    });
  }

  // --- Repère --------------------------------------------------------------------------------------------------------------

  setWaypoint(w: Waypoint | null): void {
    this.waypoint = w;
    this.marker.set(w);
    this.save();
  }

  // --- Sauvegarde ----------------------------------------------------------------------------------------------------------

  buildSave(): SaveGame {
    const s = this.state();
    const { atmosphere } = this.ctx;
    return {
      version: 1,
      savedAt: Date.now(),
      player: { x: s.x, y: s.y },
      camera: { yaw: s.yaw, pitch: s.pitch },
      riding: s.ridingId,
      vehicles: this.fleet.savedVehicles(),
      clock: { hour: atmosphere.hour, day: addDays(atmosphere.day, 0) },
      waypoint: this.waypoint,
    };
  }

  save(): boolean {
    if (!this.saveStore || this.suppress) return false;
    const s = this.buildSave();
    const ok = this.saveStore.write(s);
    if (ok) this.lastSaved = s.savedAt;
    return ok;
  }

  /** Efface la sauvegarde et recommence au départ (la page se recharge sans réécrire la partie en cours). */
  private newGame(): void {
    this.suppress = true;
    this.saveStore?.clear();
    location.reload();
  }

  // --- À chaque image ------------------------------------------------------------------------------------------------------

  tick(dt: number, time: number): void {
    const s = this.state();
    const { atmosphere, camera } = this.ctx;
    this.clockTimer -= dt;
    if (this.clockTimer <= 0) {
      this.clockTimer = 0.25;
      const t = atmosphere.clock;
      if (t !== this.clockText) {
        this.clockText = t;
        this.clockEl.textContent = t;
      }
    }
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 1 / MINIMAP_HZ;
      this.minimap.time(() => {
        const list = this.vehicles;
        list.length = 0;
        for (const v of this.fleet.vehicles) {
          if (v.ridden) continue;
          const dx = v.state.x - s.x, dy = v.state.y - s.y;
          if (dx * dx + dy * dy < MINIMAP_VEHICLE_RADIUS * MINIMAP_VEHICLE_RADIUS) list.push({ x: v.state.x, y: v.state.y, kind: v.kind });
        }
        this.minimap.update({ x: s.x, y: s.y, cameraYaw: s.yaw, facing: s.facing, north: this.ctx.settings!.values.minimapNorth, vehicles: list, waypoint: this.waypoint });
      });
    }
    this.marker.update(camera.position.x, -camera.position.z, time);
  }
}
