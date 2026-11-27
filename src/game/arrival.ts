import * as THREE from "three";
import {
  arrivalDistance, CINE, DEPART, departureDistance, shotAt, STOP_D, TER, TRACK_LINE, WALK_END, WALK_HEADING, type TrackPoint,
} from "../core/arrival";
import { applyAppearance, recipeFromSeed } from "../core/character";
import type { Colliders } from "../core/collision";
import { WEEKDAY_NAMES } from "../core/calendar";
import { JOJO, Prologue, STORY_TEXT, type SavedStory, type StoryAction } from "../core/story";
import type { HeightField } from "../data/types";
import { createPlayerModel, type PlayerModel } from "../render/player-model";
import { TerModel } from "../render/ter-model";
import { SpeechBubbles } from "../ui/speech";
import logoUrl from "../assets/logo.webp";

/** Ce que l'arrivée demande au jeu. */
export interface ArrivalHost {
  scene: THREE.Scene;
  colliders: Colliders;
  terrain: HeightField;
  /** Pose (ou retire) le repère du joueur, avec son itinéraire (D310). */
  setWaypoint(at: { x: number; y: number } | null): void;
  /** Bandeau du milieu de l'écran (celui de « Arrêté »). */
  banner(title: string, sub: string): void;
  /** Enregistre la partie tout de suite. */
  save(): void;
  /** Le joueur (position) et sa tête, pour les bulles et les retournements de Jojo. */
  player(): { x: number; y: number; z: number };
  /** Jour de la semaine (0 = lundi) et heure du jeu, pour le carton de la cinématique. */
  when(): { weekday: number; hour: number };
}

const TRAIN_TAG = "ter";
/** Collisions de l'autorail : cercles le long de la caisse, recalculés au plus 10 fois par seconde quand il bouge. */
const TRAIN_CIRCLES = 11;

/**
 * Arrivée à la gare et prologue « Le retour » (D338) : l'autorail, la cinématique (caméra, bandes noires, logo, carton, toucher pour
 * passer), puis le SMS de Jojo, l'objectif et le repère, Jojo devant le café et ses répliques. La logique est dans `core/arrival.ts` et
 * `core/story.ts` ; ici, le dessin et l'interface.
 */
export class ArrivalController {
  readonly story: Prologue;
  /** Temps de la cinématique (s) ; −1 : pas de cinématique (finie, passée, ou partie reprise). */
  private t = -1;
  private model: TerModel | null = null;
  /** Temps depuis la fin de la cinématique (départ du train), −1 avant ; le train est retiré une fois parti. */
  private after = -1;
  private trainD = STOP_D;
  private circlesIn = 0;
  private readonly tp: TrackPoint = { x: 0, y: 0, heading: 0 };
  private readonly overlay: HTMLDivElement;
  private readonly smsEl: HTMLDivElement;
  private readonly goalEl: HTMLDivElement;
  private smsLeft = 0;
  private goalLeft = 0;
  private jojo: PlayerModel | null = null;
  private jojoHeading: number = JOJO.heading;
  private readonly bubbles = new SpeechBubbles(document.body);
  private readonly look = new THREE.Vector3();

  constructor(private readonly host: ArrivalHost, saved: SavedStory | null, intro: boolean) {
    this.story = new Prologue(saved, intro);
    this.overlay = document.createElement("div");
    this.overlay.id = "cine";
    this.overlay.innerHTML = `<div class="cine-bar top"></div><div class="cine-bar bottom"></div><img class="cine-logo" alt="Grand Theft Autun">`
      + `<div class="cine-card"><div class="cine-place"></div><div class="cine-when"></div></div><div class="cine-skip">Toucher pour passer</div>`;
    (this.overlay.querySelector(".cine-logo") as HTMLImageElement).src = logoUrl;
    this.overlay.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.skip();
    });
    this.smsEl = document.createElement("div");
    this.smsEl.id = "sms";
    this.goalEl = document.createElement("div");
    this.goalEl.id = "objective";
    document.body.append(this.overlay, this.smsEl, this.goalEl);
    if (intro && this.story.step === "arrivee") {
      this.model = new TerModel();
      host.scene.add(this.model.group);
      this.placeTrain(arrivalDistance(0));
      this.model.setDoors(0);
    }
  }

  /** La cinématique est en cours : commandes ignorées, interface masquée, caméra du plan. */
  get cinematic(): boolean {
    return this.t >= 0;
  }

  /** Le joueur n'est pas encore descendu du train (il n'est ni dessiné ni simulé). */
  get playerHidden(): boolean {
    return this.t >= 0 && this.t < CINE.out;
  }

  /** Le joueur descend et marche vers la gare (pas en avant, au cap `WALK_HEADING`). */
  get walking(): boolean {
    return this.t >= CINE.out && this.t < CINE.out + CINE.walk;
  }

  readonly walkHeading = WALK_HEADING;

  /** La partie commence (écran de chargement fermé) : la cinématique démarre s'il y en a une. */
  begin(): void {
    if (!this.model || this.story.step !== "arrivee") return;
    this.t = 0;
    document.body.classList.add("cinematic");
    this.overlay.classList.add("on");
    const { weekday, hour } = this.host.when();
    const minutes = Math.round(hour * 60), h = Math.floor(minutes / 60) % 24, m = minutes % 60;
    const day = WEEKDAY_NAMES[weekday] ?? "";
    (this.overlay.querySelector(".cine-place") as HTMLElement).textContent = STORY_TEXT.place;
    (this.overlay.querySelector(".cine-when") as HTMLElement).textContent = `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${h} h ${String(m).padStart(2, "0")}`;
  }

  /** Toucher pendant la cinématique : on passe à la fin (train à quai, joueur sur le quai, devant la gare). */
  skip(): void {
    if (this.t < 0) return;
    this.t = CINE.end;
    this.skipped = true;
  }

  /** Captures et essais : instant de la cinématique (s), ou −1 ; `seek` y saute. */
  get time(): number {
    return this.t;
  }

  seek(t: number): void {
    if (this.t >= 0) this.t = Math.max(0, t);
  }

  /** Vrai une fois, à l'image où la cinématique a été passée : le jeu pose le joueur au bout de sa marche. */
  skipped = false;
  readonly walkEnd = WALK_END;

  /** À chaque image (temps du jeu). */
  update(dt: number): void {
    if (this.t >= 0) {
      this.t += dt;
      this.placeTrain(arrivalDistance(this.t));
      this.model?.setDoors((this.t - CINE.door) / 1.2);
      this.overlay.classList.toggle("logo", this.t > 0.6 && this.t < 4.2);
      this.overlay.classList.toggle("card", this.t > CINE.out + 0.6 && this.t < CINE.end - 0.4);
      if (this.t >= CINE.end) this.finish();
    } else if (this.model && this.after >= 0) {
      this.after += dt;
      if (this.after > DEPART.after) {
        this.model.setDoors(1 - (this.after - DEPART.after) / 1.2);
        const d = departureDistance(this.after - DEPART.after - 1.5);
        if (d === null) this.removeTrain();
        else this.placeTrain(this.after - DEPART.after < 1.5 ? STOP_D : d);
      }
    }
    if (this.model) this.trainCircles(dt);
    const p = this.host.player();
    for (const a of this.t >= 0 ? [] : this.story.update(dt, p.x, p.y)) this.act(a);
    this.updateJojo(dt, p);
    if (this.smsLeft > 0 && (this.smsLeft -= dt) <= 0) this.smsEl.classList.remove("show");
    if (this.goalLeft > 0 && (this.goalLeft -= dt) <= 0) this.goalEl.classList.remove("show");
  }

  /** Caméra du plan en cours (après la caméra du jeu, qu'elle remplace pendant la cinématique). */
  placeCamera(camera: THREE.PerspectiveCamera): void {
    if (this.t < 0) return;
    const shot = shotAt(this.t);
    const ground = (x: number, y: number): number => this.host.terrain.heightAt(x, y);
    const [cx, cy, ch] = shot.from;
    camera.position.set(cx, ground(cx, cy) + ch, -cy);
    if ("train" in shot.look) {
      // Avant du train (il roule vers l'est : l'avant est devant le centre), ou son centre une fois à l'arrêt.
      TRACK_LINE.at(Math.min(this.trainD + TER.length / 2 - 2, STOP_D + 4), this.tp);
      this.look.set(this.tp.x, this.railZ(this.tp.x, this.tp.y) + shot.look.train, -this.tp.y);
    } else {
      const [lx, ly, lh] = shot.look;
      this.look.set(lx, ground(lx, ly) + lh, -ly);
    }
    camera.lookAt(this.look);
    if (Math.abs(camera.fov - shot.fov) > 0.01) {
      camera.fov = shot.fov;
      camera.updateProjectionMatrix();
    }
  }

  /** Bulles de Jojo : à placer à chaque image avec la caméra. */
  drawBubbles(camera: THREE.Camera, width: number, height: number, dt: number): void {
    this.bubbles.update(dt, camera, width, height);
  }

  private finish(): void {
    this.t = -1;
    this.after = 0;
    this.placeTrain(STOP_D);
    this.model?.setDoors(1);
    document.body.classList.remove("cinematic");
    this.overlay.classList.remove("on", "logo", "card");
    for (const a of this.story.introDone()) this.act(a);
  }

  private act(a: StoryAction): void {
    if (a.kind === "sms") {
      this.smsEl.innerHTML = `<div class="sms-from"></div><div class="sms-text"></div>`;
      (this.smsEl.firstChild as HTMLElement).textContent = `📱 ${a.from}`;
      (this.smsEl.lastChild as HTMLElement).textContent = a.text;
      this.smsEl.classList.add("show");
      this.smsLeft = 9;
    } else if (a.kind === "objective") {
      this.goalEl.textContent = a.text;
      this.goalEl.classList.add("show");
      this.goalLeft = 7;
    } else if (a.kind === "waypoint") {
      this.host.setWaypoint(a.at);
      // Arrivé auprès de Jojo : le SMS et l'objectif s'effacent devant ses répliques.
      if (!a.at) {
        this.smsLeft = this.goalLeft = 0;
        this.smsEl.classList.remove("show");
        this.goalEl.classList.remove("show");
      }
    }
    else if (a.kind === "say") this.bubbles.say(1, a.text, a.seconds, () => this.jojoHead());
    else if (a.kind === "banner") this.host.banner(a.title, a.sub);
    else this.host.save();
  }

  private jojoHead(): { x: number; y: number; z: number } | null {
    return this.jojo ? { x: JOJO.x, y: JOJO.y, z: this.host.terrain.heightAt(JOJO.x, JOJO.y) + 1.85 } : null;
  }

  /** Jojo devant le café tant que le prologue l'attend ; tourné vers le joueur quand il est près. */
  private updateJojo(dt: number, p: { x: number; y: number }): void {
    const here = this.story.jojoHere;
    if (here && !this.jojo) {
      this.jojo = createPlayerModel(applyAppearance(recipeFromSeed(1977), { sex: "m", age: "adult", top: "jacket", bottom: "jeans", hat: "cap", beard: "stubble", bag: "none", scarf: false }));
      this.host.scene.add(this.jojo.group);
      this.host.colliders.currentTag = "jojo";
      this.host.colliders.addCircle(JOJO.x, JOJO.y, 0.35);
      this.host.colliders.currentTag = null;
    } else if (!here && this.jojo) {
      this.host.scene.remove(this.jojo.group);
      this.host.colliders.removeTag("jojo");
      this.jojo = null;
    }
    if (!this.jojo) return;
    const near = Math.hypot(p.x - JOJO.x, p.y - JOJO.y) < 12;
    const want = near ? Math.atan2(p.x - JOJO.x, p.y - JOJO.y) : JOJO.heading;
    const d = Math.atan2(Math.sin(want - this.jojoHeading), Math.cos(want - this.jojoHeading));
    this.jojoHeading += d * Math.min(1, dt * 4);
    this.jojo.update(JOJO.x, JOJO.y, this.host.terrain.heightAt(JOJO.x, JOJO.y), this.jojoHeading, 0, 0);
  }

  private railZ(x: number, y: number): number {
    return this.host.terrain.railAt?.(x, y) ?? this.host.terrain.heightAt(x, y);
  }

  private placeTrain(d: number): void {
    if (!this.model) return;
    const moved = Math.abs(d - this.trainD) > 1e-3;
    this.trainD = d;
    // Cap dans le sens de la marche à l'arrivée (vers l'est) ; altitude moyenne des deux bogies.
    const a = TRACK_LINE.at(d + TER.length / 2 - 4.2), ax = a.x, ay = a.y;
    const b = TRACK_LINE.at(d - TER.length / 2 + 4.2), bx = b.x, by = b.y;
    const c = TRACK_LINE.at(d, this.tp);
    const z = (this.railZ(ax, ay) + this.railZ(bx, by)) / 2;
    this.model.place(c.x, c.y, z, Math.atan2(ax - bx, ay - by));
    if (moved) this.circlesIn = Math.min(this.circlesIn, 0.1);
  }

  /** Obstacle : cercles le long de la caisse (le joueur, les passants et les voitures butent dessus). */
  private trainCircles(dt: number): void {
    if ((this.circlesIn -= dt) > 0) return;
    this.circlesIn = 1e9;
    const col = this.host.colliders;
    col.removeTag(TRAIN_TAG);
    col.currentTag = TRAIN_TAG;
    const p: TrackPoint = { x: 0, y: 0, heading: 0 };
    for (let i = 0; i < TRAIN_CIRCLES; i++) {
      TRACK_LINE.at(this.trainD - TER.length / 2 + TER.halfWidth + (i * (TER.length - 2 * TER.halfWidth)) / (TRAIN_CIRCLES - 1), p);
      col.addCircle(p.x, p.y, TER.halfWidth, undefined, this.railZ(p.x, p.y) + TER.roof);
    }
    col.currentTag = null;
  }

  private removeTrain(): void {
    if (!this.model) return;
    this.host.scene.remove(this.model.group);
    this.model.dispose();
    this.model = null;
    this.host.colliders.removeTag(TRAIN_TAG);
  }
}
