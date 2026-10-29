import * as THREE from "three";
import { summarizeFrames, type FrameSummary } from "./bench-stats";
import { deviceInfo, measureMemory } from "./bench";
import type { GameContext } from "./context";
import { createCrowdSim, type CrowdSim } from "./crowd-sim";
import { followSun, gameSpawn } from "./game";
import { showReportPanel } from "./report-panel";
import { createCrowd } from "../render/crowd/crowd";
import { createCrowdState, type CrowdRenderer, type CrowdState } from "../render/crowd/crowd-types";
import { recipeFromSeed } from "../core/character";
import { createVehicle } from "../core/vehicle";
import { createPlayerModel } from "../render/player-model";
import { vehicleDef } from "../core/vehicle-catalog";
import { buildModel } from "./vehicles";

/**
 * Banc de foule (?proto=1) : une foule de personnages animés dans la vraie ville, mesurée comme le banc. (L'étape P a comparé trois façons de
 * la dessiner, A peau et os, B instances et nuanceur, C pièces groupées ; B a été retenue, D37, et A et C supprimées.) Chaque phase : construction, mise en route, 4 s d'images naturelles (fluidité),
 * puis 3 s avec attente de fin de dessin à chaque image (`finish`) pour mesurer le travail réel par image, que la limite de 60 Hz masque.
 * ?proto=look&n=24 : une rangée de personnages immobiles ou en marche, pour comparer les rendus à l'œil.
 */

type Approach = "B";
const FACTORIES: Record<Approach, (scene: THREE.Scene, state: CrowdState) => CrowdRenderer> = { B: createCrowd };

interface PhaseSpec {
  label: string;
  approach: Approach | null;
  n: number;
  shadows: boolean;
}

interface PhaseReport {
  label: string;
  approach: Approach | null;
  n: number;
  shadows: boolean;
  near: number;
  far: number;
  buildMs: number;
  natural: FrameSummary;
  /** Travail par image (ms), image après image, avec attente de fin de dessin. */
  work: { mean: number; p95: number; max: number };
  updateMs: number;
  submitMs: number;
  draws: number;
  triangles: number;
  geometries: number;
  heapMB: number | null;
}

const WARM = 1.2, NATURAL = 4, WORK = 3;
const CAM_HEIGHT = 1.9;

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
function pct(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

export function startProto(ctx: GameContext): void {
  const { camera, renderer, scene, sky, atmosphere, world, tiles, terrainView, params } = ctx;
  const { terrain } = world;
  const spawn = gameSpawn(params);
  const placeSun = followSun(ctx);
  const ground = terrain.heightAt(spawn.x, spawn.y);
  const camX = spawn.x, camZ = -spawn.y;
  camera.position.set(camX, ground + CAM_HEIGHT, camZ);
  camera.lookAt(camX, ground + CAM_HEIGHT - 0.5, camZ - 20);
  const groundAt = (x: number, z: number): number => terrain.heightAt(x, -z);
  const gl = renderer.getContext();

  if (params.get("proto") === "riders") return startRiders(ctx, groundAt, spawn, ground);
  const look = params.get("proto") === "look";
  if (look) return startLook(ctx, groundAt, camX, camZ, ground);

  const phases: PhaseSpec[] = [{ label: "Sans personnage (référence)", approach: null, n: 0, shadows: true }];
  for (const n of [50, 100, 200, 300]) phases.push({ label: `${n} personnages`, approach: "B", n, shadows: true });
  phases.push({ label: "200 personnages, sans ombres des personnages", approach: "B", n: 200, shadows: false });
  phases.push({ label: "Sans personnage (référence, fin)", approach: null, n: 0, shadows: true });
  const list = phases;
  const short = params.get("proto") === "court";
  const t = short ? { warm: 0.3, natural: 0.6, work: 0.6 } : { warm: WARM, natural: NATURAL, work: WORK };

  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:8px;"
    + "background:rgba(0,0,0,.6);color:#fff;font:13px system-ui,sans-serif;pointer-events:none;white-space:nowrap;";
  document.body.append(banner);

  const reports: PhaseReport[] = [];
  let index = -1;
  let stage: "tiles" | "warm" | "natural" | "work" = "tiles";
  let stageTime = 0;
  let crowd: CrowdRenderer | null = null;
  let sim: CrowdSim | null = null;
  let spec: PhaseSpec | null = null;
  let buildMs = 0;
  let natural: number[] = [], work: number[] = [], update: number[] = [], submit: number[] = [];
  let draws = 0, tris = 0, frames = 0;
  let stableSince = 0, lastBuildCount = tiles.buildCount, waited = 0;
  let last = performance.now();

  const startPhase = (): boolean => {
    crowd?.dispose();
    crowd = null;
    sim = null;
    index++;
    spec = list[index] ?? null;
    if (!spec) return false;
    const b0 = performance.now();
    if (spec.approach) {
      sim = createCrowdSim({ count: spec.n, camX, camZ, camYaw: 0, seed: 7 });
      crowd = FACTORIES[spec.approach](scene, sim.state);
      crowd.setShadows(spec.shadows);
    }
    buildMs = performance.now() - b0;
    natural = [];
    work = [];
    update = [];
    submit = [];
    draws = tris = frames = 0;
    stage = "warm";
    stageTime = 0;
    return true;
  };

  const endPhase = (): void => {
    const s = spec!;
    const mem = measureMemory(ctx);
    const lod = crowd?.lodCounts() ?? { near: 0, far: 0 };
    reports.push({
      label: s.label, approach: s.approach, n: s.n, shadows: s.shadows, near: lod.near, far: lod.far, buildMs: r1(buildMs),
      natural: summarizeFrames(natural),
      work: { mean: r2(mean(work)), p95: r2(pct(work, 95)), max: r2(Math.max(0, ...work)) },
      updateMs: r2(mean(update)), submitMs: r2(mean(submit)),
      draws: Math.round(draws / Math.max(1, frames)), triangles: Math.round(tris / Math.max(1, frames)),
      geometries: mem.geometries, heapMB: mem.heapMB,
    });
  };

  ctx.ready();
  const frame = (now: number): void => {
    const ms = now - last;
    last = now;
    const dt = Math.min(ms / 1000, 0.1);
    const t0 = performance.now();

    if (stage === "tiles") {
      // Attend que les tuiles autour du départ soient construites.
      waited += dt;
      if (tiles.buildCount !== lastBuildCount) {
        lastBuildCount = tiles.buildCount;
        stableSince = 0;
      } else stableSince += dt;
      if (stableSince > 1.5 || waited > 15) startPhase();
    } else {
      stageTime += dt;
    }

    sim?.step(dt, groundAt);
    const u0 = performance.now();
    if (crowd && sim) crowd.update(sim.state, camX, camZ);
    const u1 = performance.now();
    tiles.update(spawn.x, spawn.y, 0, 0);
    terrainView.update(spawn.x, spawn.y);
    atmosphere.advance(dt);
    placeSun(spawn.x, spawn.y, ground);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    const u2 = performance.now();
    if (stage === "work") gl.finish();
    const t1 = performance.now();

    if (stage === "natural") {
      natural.push(ms);
      update.push(u1 - u0);
      submit.push(u2 - u1);
      draws += renderer.info.render.calls;
      tris += renderer.info.render.triangles;
      frames++;
    } else if (stage === "work") work.push(t1 - t0);

    if (stage === "warm" && stageTime >= t.warm) {
      stage = "natural";
      stageTime = 0;
    } else if (stage === "natural" && stageTime >= t.natural) {
      stage = "work";
      stageTime = 0;
    } else if (stage === "work" && stageTime >= t.work) {
      endPhase();
      if (!startPhase()) {
        banner.remove();
        finish();
        return;
      }
    }
    banner.textContent = spec ? `Prototypes de foule · ${Math.max(index, 0) + 1}/${list.length} · ${spec.label} · ${stage === "warm" ? "mise en route" : stage === "natural" ? "fluidité" : "travail"}` : "Prototypes de foule · préparation des tuiles…";
    requestAnimationFrame(frame);
  };

  const finish = (): void => {
    const device = { ...deviceInfo(ctx), build: __BUILD__ };
    const text = protoText(device, reports, { shadows: renderer.shadowMap.enabled, pixelRatio: renderer.getPixelRatio() });
    const json = JSON.stringify({ date: new Date().toISOString(), device, phases: reports }, null, 1);
    (window as unknown as { __autun: Record<string, unknown> }).__autun["proto"] = { text, json, reports };
    showReportPanel(text, json, "foule");
  };
  requestAnimationFrame(frame);
}

function verdict(work: number, base: number): string {
  const cost = work - base;
  if (cost < 2) return "négligeable";
  if (cost < 5) return "léger";
  if (cost < 9) return "sensible";
  if (cost < 14) return "lourd";
  return "trop lourd";
}

export function protoText(device: Record<string, unknown>, reports: PhaseReport[], settings: { shadows: boolean; pixelRatio: number }): string {
  const lines: string[] = [];
  lines.push(`PROTOTYPES DE FOULE AUTUN 3D — ${new Date().toLocaleString("fr-FR")}`);
  lines.push(`Version : ${String(device["build"] ?? "")}`);
  lines.push(`Appareil : ${String(device["gpu"])} · écran ${String(device["screen"])} · densité ${String(device["devicePixelRatio"])} · ${String(device["cores"])} cœurs`);
  lines.push(`Rendu : ${String(device["drawingBuffer"])} px (×${settings.pixelRatio}) · ombres du soleil ${settings.shadows ? "oui" : "non"}`);
  lines.push("Lecture : « travail » = durée réelle d'une image avec attente de fin de dessin (la limite de 60 Hz la masque dans la fluidité) ; « coût » = travail moins la référence sans personnage ; le budget d'une image à 60 i/s est de 16,7 ms.");
  lines.push("");
  const base = reports.filter((r) => r.n === 0);
  const baseWork = base.length ? mean(base.map((r) => r.work.mean)) : 0;
  for (const r of reports) {
    const f = r.natural;
    lines.push(`■ ${r.label}${r.n ? ` — coût ${verdict(r.work.mean, baseWork)}` : ""}`);
    lines.push(`  Fluidité : ${f.fps.toFixed(1)} i/s · 1 % les plus lentes ${f.low1.toFixed(1)} i/s · médiane ${f.p50.toFixed(1)} ms · 95 % ${f.p95.toFixed(1)} · max ${f.max.toFixed(0)} · ${f.over33} images > 33 ms`);
    lines.push(`  Travail : ${r.work.mean.toFixed(2)} ms en moyenne (95 % ${r.work.p95.toFixed(2)} · max ${r.work.max.toFixed(1)})${r.n ? ` · coût de la foule +${(r.work.mean - baseWork).toFixed(2)} ms soit ${((r.work.mean - baseWork) / Math.max(1, r.n) * 1000).toFixed(0)} µs par personnage` : ""}`);
    if (r.n) lines.push(`  Processeur : mise à jour de la foule ${r.updateMs.toFixed(2)} ms · envoi du dessin ${r.submitMs.toFixed(2)} ms · construction ${r.buildMs} ms · ${r.near} près / ${r.far} loin`);
    lines.push(`  Dessin : ${r.draws} appels · ${Math.round(r.triangles / 1000)}k triangles · ${r.geometries} géométries${r.heapMB !== null ? ` · JavaScript ${r.heapMB} Mo` : ""}`);
    lines.push("");
  }
  lines.push(`Navigateur : ${String(device["userAgent"])}`);
  return lines.join("\n");
}

/**
 * ?proto=look et ?view=characters : une ou deux rangées de personnages devant la caméra, pour juger la variété (ou comparer les rendus).
 * `n` (24 par défaut), `seed`, `gap`, `dist`, `eye`, `turn` (cap des personnages : 0 de face, 3,14 de dos), `walk` (tous marchent à cette vitesse,
 * phases réparties sur un cycle). En galerie (`view=characters`),
 * un appui sur l'écran tire 24 autres recettes.
 */
function startLook(ctx: GameContext, groundAt: (x: number, z: number) => number, camX: number, camZ: number, ground: number): void {
  const { camera, renderer, scene, sky, atmosphere, tiles, terrainView, params } = ctx;
  const n = Number(params.get("n") ?? 24);
  let seed = Number(params.get("seed") ?? 1);
  const perRow = Math.ceil(n / 2), spacing = Number(params.get("gap") ?? 0.95), dist = Number(params.get("dist") ?? 5.2);
  const turn = Number(params.get("turn") ?? 0);
  // `walk=1.4` : tout le monde marche à cette vitesse (m/s), phases réparties sur un cycle (pour juger la démarche d'un coup d'œil).
  const walkAll = params.has("walk") ? Number(params.get("walk")) : null;
  const place = (): CrowdState => {
    const state = createCrowdState(Array.from({ length: n }, (_, i) => recipeFromSeed(seed * 1000 + i)));
    for (let i = 0; i < n; i++) {
      const row = i % 2, col = Math.floor(i / 2);
      state.x[i] = camX + (col - (perRow - 1) / 2) * spacing + (row ? spacing / 2 : 0);
      state.z[i] = camZ - dist - (row ? 2 : 0);
      state.y[i] = groundAt(state.x[i]!, state.z[i]!);
      // Face à la caméra : le « avant » du corps est −z, une rotation de π le tourne vers +z.
      state.yaw[i] = Math.PI + turn;
      const walking = walkAll !== null || i % 3 === 1;
      state.speed[i] = walking ? (walkAll ?? 1.4) : 0;
      state.phase[i] = walkAll !== null ? (i / n) * Math.PI * 2 : walking ? (i * 1.3) % (Math.PI * 2) : 0;
    }
    return state;
  };
  let state = place();
  let crowd = FACTORIES.B(scene, state);
  const eye = Number(params.get("eye") ?? 1.6);
  camera.position.set(camX, ground + eye, camZ);
  camera.lookAt(camX, ground + eye - 0.45 * (dist / 5.2), camZ - dist - 1);
  const placeSun = followSun(ctx);
  const x = camX, y = -camZ;
  if (params.get("view") === "characters") {
    // Appui bref : autres personnages (le plus souvent d'une seule tape ; pas de rotation de la caméra).
    renderer.domElement.addEventListener("click", () => {
      seed++;
      crowd.dispose();
      state = place();
      crowd = FACTORIES.B(scene, state);
    });
    const hint = document.createElement("div");
    hint.textContent = `Appuie sur l'écran pour tirer d'autres personnages · graine ${seed}`;
    hint.style.cssText = "position:fixed;left:50%;bottom:10px;transform:translateX(-50%);padding:5px 12px;border-radius:10px;background:rgba(0,0,0,.5);color:#fff;font:13px system-ui,sans-serif;pointer-events:none;";
    document.body.append(hint);
    renderer.domElement.addEventListener("click", () => {
      hint.textContent = `Appuie sur l'écran pour tirer d'autres personnages · graine ${seed}`;
    });
  }
  ctx.ready({ crowd });
  const frame = (): void => {
    crowd.update(state, camX, camZ);
    tiles.update(x, y, 0, 0);
    terrainView.update(x, y);
    atmosphere.advance(0);
    placeSun(x, y, ground);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** ?view=characters : la galerie des personnages (voir `startLook`), au départ du jeu. */
export function startGallery(ctx: GameContext): void {
  const spawn = gameSpawn(ctx.params);
  const ground = ctx.world.terrain.heightAt(spawn.x, spawn.y);
  startLook(ctx, (x, z) => ctx.world.terrain.heightAt(x, -z), spawn.x, -spawn.y, ground);
}

/**
 * ?proto=riders : un vélo, une moto et une trottinette avec leur conducteur, devant la caméra, pour juger les poses de près.
 * `heading` (rad, 0 = vers le nord, loin de la caméra ; 1,57 = de profil), `steer` (−1 à 1), `seed`, `eye`, `dist`, `crank` (rad, vélo).
 */
function startRiders(ctx: GameContext, groundAt: (x: number, z: number) => number, spawn: { x: number; y: number }, ground: number): void {
  const { camera, renderer, scene, sky, atmosphere, tiles, terrainView, world, params } = ctx;
  const heading = Number(params.get("heading") ?? Math.PI / 2), steer = Number(params.get("steer") ?? 0), seed = Number(params.get("seed") ?? 1);
  const dist = Number(params.get("dist") ?? 4.2), eye = Number(params.get("eye") ?? 1.1), crank = Number(params.get("crank") ?? 0.6);
  const models = ["velo-ville", "moto-routiere", "trottinette"].map((id) => buildModel(vehicleDef(id)!, 0));
  models.forEach((model, i) => {
    const state = createVehicle(spawn.x + (i - 1) * 2.4, spawn.y + dist, heading, world.terrain);
    state.steer = steer;
    state.lean = steer * 0.2;
    state.wheel = i;
    model.update(state);
    scene.add(model.group);
    const rider = createPlayerModel(recipeFromSeed(seed * 10 + i));
    model.group.add(rider.group);
    rider.ride(model, crank + i * 2.1);
  });
  void groundAt;
  const camX = spawn.x, camZ = -spawn.y;
  camera.position.set(camX, ground + eye, camZ);
  camera.lookAt(camX, ground + eye - 0.1, camZ - dist);
  const placeSun = followSun(ctx);
  ctx.ready({});
  const frame = (): void => {
    tiles.update(spawn.x, spawn.y, 0, 0);
    terrainView.update(spawn.x, spawn.y);
    atmosphere.advance(0);
    placeSun(spawn.x, spawn.y, ground);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
