import * as THREE from "three";
import { DETAIL_DISTANCE } from "../render/tile-manager";
import { BENCH_ROUTE } from "./bench-route";
import { Polyline, soakTrend, summarizeFrames, type FrameSummary } from "./bench-stats";
import { Minimap } from "../ui/minimap";
import { MapData } from "../ui/map-data";
import type { GameContext } from "./context";
import { createCrowdSim, type CrowdSim } from "./crowd-sim";
import { PedSim, type Observer, type PedStats } from "../core/pedestrians";
import { NavManager } from "./nav-manager";
import { PigeonSim, pigeonCapacity } from "../core/pigeons";
import { PigeonRenderer } from "../render/pigeons";
import { createCrowd } from "../render/crowd/crowd";
import type { CrowdRenderer } from "../render/crowd/crowd-types";
import { followSun, gameSpawn } from "./game";
import { CATALOG } from "../core/vehicle-catalog";
import { Fleet } from "./vehicles";
import { Signals } from "../core/signals";
import { Traffic } from "./traffic";
import { Wanted } from "../core/wanted";
import { OFFICER, Officers } from "../core/officers";
import { gendarmeRecipe } from "../core/character";
import { PoliceController } from "./police";
import { showReportPanel } from "./report-panel";
import { CombatBot } from "./combat-bot";
import { Fx } from "../render/fx";

/**
 * Banc de test (?bench=1) : la caméra suit un parcours fixe dans les rues, à vitesse de voiture,
 * puis s'arrête sur la place pour comparer avec et sans ombres, et en définition réduite.
 * À la fin, un rapport lisible s'affiche (copier, télécharger en JSON).
 */

interface Phase {
  name: string;
  /** Arrêt sur la place pendant `seconds`, ou trajet de `from` à `to` mètres à `speed` m/s. */
  still?: { seconds: number };
  drive?: { from: number; to: number; speed: number };
  /** Trajet qui repart du début du parcours : on attend d'abord que les tuiles du départ soient construites, comme pour un arrêt. */
  warmStart?: boolean;
  /** Réglage appliqué avant la phase (non mesuré pendant la mise en route). */
  setup?: () => void;
  /** Foule de personnages animés devant la caméra pendant la phase (arrêts seulement). */
  crowd?: { n: number; shadows: boolean };
}

interface FrameSample {
  ms: number;
  draws: number;
  triangles: number;
  /** Temps de construction de tuile dans l'image mesurée (ms), 0 sinon. */
  build: number;
}

interface Memory {
  geometries: number;
  textures: number;
  geometryMB: number;
  textureMB: number;
  heapMB: number | null;
}

/** Mesure de la simulation des passants (`?sim=1`) pendant une phase. */
interface SimReport {
  /** Durée d'un pas de simulation (ms) : moyenne, 95 %, pire. */
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Naissances et disparitions pendant la phase, et état à la fin. */
  spawns: number;
  despawns: number;
  alive: number;
  tiers: [number, number, number];
  waiting: number;
  crossing: number;
  idle: number;
  spawnFailures: number;
  /** Super-tuiles de navigation chargées et arêtes. */
  navCells: number;
  navEdges: number;
  /** Pigeons vivants à la fin et coût moyen (ms par image : pas de simulation et recalcul des sommets). */
  pigeons: number;
  pigeonMs: number;
}

interface PhaseReport {
  name: string;
  frames: FrameSummary;
  draws: { avg: number; max: number };
  triangles: { avg: number; max: number };
  builds: { id: string; ms: number; frames: number; slice: number }[];
  /** À-coups (> 50 ms) qui tombent sur une image où une tuile se construisait. */
  hitchesWithBuild: number;
  /** Trajets seulement : images où la tuile sous le véhicule, ou celle qu'il atteint dans 1 s, n'avait pas encore ses obstacles (D50) ; null à l'arrêt. */
  late: { frames: number; here: number; ahead: number } | null;
  memory: Memory;
  /** Foule de la phase : effectif, répartition près / loin, durée moyenne de sa mise à jour (ms) ; null s'il n'y en avait pas. Avec `?sim=1`, `sim` mesure la simulation. */
  crowd: { n: number; shadows: boolean; near: number; far: number; updateMs: number; sim?: SimReport } | null;
  /** `?fleet=1` : véhicules garés comme dans le jeu (+ un de chaque modèle devant le départ), à la fin de la phase, et coût de leur mise à jour par image ; null sans. */
  fleet: { total: number; drawn: number; meshes: number; avgMs: number; maxMs: number } | null;
  /** `?traffic=N` : la circulation du jeu pendant le banc (D67), à la fin de la phase : voitures, cible, maillages, coût de simulation et de mise à jour ; null sans. */
  traffic: { max: number; cars: number; target: number; meshes: number; simAvgMs: number; simMaxMs: number; updateAvgMs: number; updateMaxMs: number; steps: number; contacts: number; honks: number } | null;
  /** `?police=1` (J4, D76) : à la fin de la phase, voitures de police, en poursuite, gendarmes à pied ; coût de la police par image (vue, infractions, équipages). */
  police: { cars: number; chasing: number; officers: number; avgMs: number; maxMs: number } | null;
  /** `?combat=1` (J5-6, D86) : à la fin de la phase, tirs, touchés, tués, cadavres, effets simultanés au plus, tirs de la police ; coût du tireur et des effets par image ; null sans. */
  combat: { shots: number; hits: number; kills: number; corpses: number; fxPeak: number; fxFrames: number; frames: number; policeShots: number; policeDamage: number; avgMs: number; maxMs: number } | null;
  /** Minimap : mises à jour de la phase, durée moyenne et pire durée (ms) ; null si elle est coupée (?minimap=0). */
  minimap: { updates: number; avgMs: number; maxMs: number } | null;
}

const CHASE_BACK = 7;
const CHASE_AHEAD = 14;
const CHASE_HEIGHT = 2.8;
const SPLIT = 1350;

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Estimation de la mémoire graphique : géométries et textures présentes dans la scène, plus la carte d'ombres. */
export function measureMemory(ctx: GameContext): Memory {
  const geos = new Set<string>(), texs = new Set<string>();
  let geoBytes = 0, texBytes = 0;
  ctx.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    const g = mesh.geometry as THREE.BufferGeometry | undefined;
    if (g && !geos.has(g.uuid)) {
      geos.add(g.uuid);
      for (const a of Object.values(g.attributes)) geoBytes += (a as THREE.BufferAttribute).array.byteLength;
      if (g.index) geoBytes += g.index.array.byteLength;
    }
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) geoBytes += inst.instanceMatrix.array.byteLength + (inst.instanceColor?.array.byteLength ?? 0);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      for (const v of Object.values(m)) {
        const t = v as THREE.Texture;
        if (!t || !t.isTexture || texs.has(t.uuid)) continue;
        texs.add(t.uuid);
        const img = t.image as { width?: number; height?: number } | undefined;
        const w = img?.width ?? 0, h = img?.height ?? 0;
        texBytes += w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1);
      }
    }
  });
  const { sunLight, renderer } = ctx;
  if (renderer.shadowMap.enabled && sunLight.castShadow) texBytes += sunLight.shadow.mapSize.x * sunLight.shadow.mapSize.y * 4;
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const info = renderer.info.memory;
  return {
    geometries: info.geometries,
    textures: info.textures,
    geometryMB: r1(geoBytes / 2 ** 20),
    textureMB: r1(texBytes / 2 ** 20),
    heapMB: heap ? r1(heap.usedJSHeapSize / 2 ** 20) : null,
  };
}

export function deviceInfo(ctx: GameContext): Record<string, unknown> {
  const { renderer } = ctx;
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  return {
    userAgent: navigator.userAgent,
    screen: `${screen.width} × ${screen.height}`,
    window: `${window.innerWidth} × ${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    pixelRatio: renderer.getPixelRatio(),
    drawingBuffer: `${size.x} × ${size.y}`,
    gpu: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    gpuVendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    cores: navigator.hardwareConcurrency,
  };
}

function simReport(stats: PedStats, ms: number[], base: { spawns: number; despawns: number }, nav: NavManager, pigeons: { alive: number; ms: number }): SimReport {
  const sorted = [...ms].sort((a, b) => a - b);
  const n = Math.max(1, sorted.length);
  return {
    avgMs: sorted.reduce((a, b) => a + b, 0) / n, p95Ms: sorted[Math.floor(n * 0.95)] ?? 0, maxMs: sorted[sorted.length - 1] ?? 0,
    spawns: stats.spawns - base.spawns, despawns: stats.despawns - base.despawns, alive: stats.alive, tiers: [...stats.tiers], waiting: stats.waiting,
    crossing: stats.crossing, idle: stats.idle, spawnFailures: stats.spawnFailures, navCells: nav.graph.cells.size, navEdges: nav.graph.edgeCount,
    pigeons: pigeons.alive, pigeonMs: pigeons.ms,
  };
}

export function startBench(ctx: GameContext): void {
  const { camera, renderer, scene, sky, atmosphere, world, tiles, terrainView, sunLight, params } = ctx;
  const { terrain } = world;
  const route = new Polyline(BENCH_ROUTE);
  const spawn = gameSpawn(params);
  const placeSun = followSun(ctx);
  const loadMs = performance.now();

  const setShadows = (on: boolean): void => {
    renderer.shadowMap.enabled = on;
    sunLight.castShadow = on;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; });
    });
  };
  // ?bench=court : version brève pour vérifier le déroulé (rendu logiciel), sans valeur de mesure.
  const short = params.get("bench") === "court";
  const still = short ? 2 : 1;
  const split = short ? 150 : SPLIT, end = short ? 300 : route.length;
  // ?crowd=100 : phases avec 100 personnages animés devant la caméra (avec puis sans ombres des personnages) ; ?soak=10 : 10 minutes d'endurance
  // avec cette foule (une phase par minute), pour voir si la chauffe fait baisser la fluidité.
  const soak = Math.min(Math.max(Math.floor(Number(params.get("soak") ?? 0)) || 0, 0), 30);
  // ?sim=1 : les passants sont ceux de la vraie simulation (J2), qui vivent pendant tout le banc, rues à 50 et 90 km/h comprises ; ?tiers=0 : tous jouent à
  // fond à chaque pas ; ?avoid=0 : ni évitement ni collisions (comparaisons de coût).
  const simMode = params.get("sim") === "1";
  // ?fleet=1 : les véhicules garés du jeu (voitures instanciées par modèle, deux-roues articulés) et, devant le départ, un exemplaire de chaque modèle du
  // catalogue : le pire cas d'appels de dessin (D56). Sans ce paramètre, le banc ne contient aucun véhicule (comparaison avec les mesures précédentes).
  // ?traffic=N : la circulation du jeu (J3, D64 et D65) pendant tout le banc : N voitures au plus, qui naissent hors de la vue autour du point suivi, roulent
  // avec leurs conducteurs, leurs feux et les passants du banc (avec ?sim=1), dessinées par instances ; sans ce paramètre, aucune voiture.
  const trafficN = Math.min(Math.max(Math.floor(Number(params.get("traffic") ?? 0)) || 0, 0), 60);
  // ?police=1 (J4, D76) : une poursuite à trois étoiles pendant tout le banc : quatre gendarmeries suivent le point suivi, gyrophares allumés, et descendent
  // aux arrêts (gendarmes dessinés dans la foule avec ?sim=1). Aucune arrestation ne termine le banc (les gendarmes remontent et redescendent).
  const policeMode = params.get("police") === "1";
  // ?combat=1 (J5-6, D86), avec ?sim=1 : un tireur au fusil d'assaut tient le point suivi et tire sans arrêt sur le passant le plus proche (munitions rechargées chaque
  // minute), les passants s'enfuient et meurent (cadavres plafonnés), les traits et étincelles passent par le maillage instancié des effets ; avec ?police=1 la poursuite
  // est à cinq étoiles (gendarmes et voitures armés qui tirent sur le point suivi).
  const combatMode = params.get("combat") === "1" && simMode;
  const fx = combatMode ? new Fx(scene) : null;
  let bot: CombatBot | null = null;
  let combatCost = { ms: 0, max: 0, frames: 0, fxPeak: 0, fxFrames: 0, policeShots: 0, policeDamage: 0, shots0: 0, hits0: 0, kills0: 0 };
  const fleetMode = params.get("fleet") === "1";
  const fleet = fleetMode ? new Fleet(scene, ctx.colliders, terrain) : null;
  if (fleet) {
    for (const extras of tiles.loadedExtras()) fleet.addFromTile(extras);
    tiles.onBuild = (extras) => fleet.addFromTile(extras);
    tiles.onUnload = (id) => fleet.removeTile(id);
    // Sans la gendarmerie : elle n'est jamais garée dans le jeu (D72), et un exemplaire de plus au départ ajoutait un maillage instancié (+2 appels) aux rapports du banc (D77).
    // Ni les véhicules uniques (D114) : un seul exemplaire, à sa place.
    CATALOG.filter((def) => def.id !== "gendarmerie" && !def.unique).forEach((def, i) => fleet.add(def.id, `banc-${def.id}`, spawn.x + ((i % 7) - 3) * 2.6, spawn.y + 10 + 6 * Math.floor(i / 7), 2.35, 0));
  }
  // &dent=1 (D113), avec ?fleet=1 : une voiture garée sur trois est abîmée (forme cabossée), une sur douze est une épave noircie : le pire cas des
  // formes abîmées (un maillage instancié de plus par modèle présent). Sans fumée ni flammes (elles sont du jeu, pas du banc).
  const dentMode = fleetMode && params.get("dent") === "1";
  let dentCount = 0;
  const dentFleet = (): void => {
    if (!fleet || !dentMode || fleet.vehicles.length === dentCount) return;
    fleet.vehicles.forEach((v, i) => {
      if (i < dentCount || v.family !== "car") return;
      if (i % 12 === 0) v.damage.restore(0, { front: 1, rear: 0.5 }, "explosion");
      else if (i % 3 === 0) v.damage.damage(50, 0);
    });
    dentCount = fleet.vehicles.length;
    fleet.refresh();
  };
  let fleetCost = { ms: 0, max: 0, frames: 0 };
  let trafficCost = { simMs: 0, simMax: 0, steps: 0, updMs: 0, updMax: 0, frames: 0, contacts: 0, honks: 0 };
  let policeCost = { ms: 0, max: 0, frames: 0 };
  // ?fast=200 : un trajet de plus à cette vitesse (km/h, 100 à 300), pour voir si les tuiles se construisent à temps (véhicules rapides, D50).
  const fastParam = Math.round(Number(params.get("fast") ?? 0)) || 0;
  const fastKmh = fastParam >= 100 ? Math.min(fastParam, 300) : 0;
  const crowdN = Math.min(Math.max(Math.floor(Number(params.get("crowd") ?? (soak > 0 || simMode ? 100 : 0))) || 0, 0), 400);
  const crowdPhases: Phase[] = crowdN > 0
    ? [
        { name: `Arrêt sur la place, ${crowdN} personnages`, still: { seconds: short ? 2 : 8 }, crowd: { n: crowdN, shadows: true } },
        { name: `Arrêt sur la place, ${crowdN} personnages, sans ombres des personnages`, still: { seconds: short ? 2 : 8 }, crowd: { n: crowdN, shadows: false } },
      ]
    : [];
  const soakPhases: Phase[] = Array.from({ length: soak }, (_, i) => ({
    name: `Endurance, ${crowdN} personnages, minute ${i + 1}/${soak}`, still: { seconds: short ? 3 : 60 }, crowd: { n: crowdN, shadows: true },
  }));
  const phases: Phase[] = [
    { name: "Arrêt sur la place", still: { seconds: short ? 2 : 8 } },
    ...crowdPhases,
    { name: "Rues à 50 km/h", drive: { from: 0, to: split, speed: 50 / 3.6 } },
    { name: "Rues à 90 km/h", drive: { from: split, to: end, speed: 90 / 3.6 } },
    ...(fastKmh > 0 ? [{ name: `Rues à ${fastKmh} km/h`, drive: { from: 0, to: end, speed: fastKmh / 3.6 }, warmStart: true }] : []),
    { name: "Arrêt, sans ombres", still: { seconds: 6 / still }, setup: () => setShadows(false) },
    { name: "Arrêt, sans ombres, définition 1×", still: { seconds: 6 / still }, setup: () => renderer.setPixelRatio(1) },
  ];
  // L'endurance passe en dernier, avec les ombres et la définition d'origine rétablies.
  if (soakPhases.length) {
    phases.push(
      { name: "Retour aux réglages d'origine", still: { seconds: 1 }, setup: () => { setShadows(settingsShadows); renderer.setPixelRatio(settingsPixelRatio); } },
      ...soakPhases,
    );
  }
  const settingsShadows = renderer.shadowMap.enabled, settingsPixelRatio = renderer.getPixelRatio();
  const settings = {
    crowd: crowdN,
    sim: simMode ? `simulation${params.get("tiers") === "0" ? ", sans paliers" : ""}${params.get("avoid") === "0" ? ", sans évitement" : ""}` : "",
    soak,
    fast: fastKmh,
    fleet: fleetMode ? (dentMode ? "dent" : true) : false,
    traffic: trafficN,
    police: policeMode,
    combat: combatMode,
    shadows: renderer.shadowMap.enabled,
    shadowMap: sunLight.shadow.mapSize.x,
    minimap: params.get("minimap") !== "0",
    pixelRatio: renderer.getPixelRatio(),
    detail: Number(params.get("detail") ?? DETAIL_DISTANCE),
    budget: Number(params.get("budget") ?? 4),
    hour: atmosphere.clock,
    route: `${r1(end / 1000)} km${short ? " (version courte, sans valeur de mesure)" : ""}`,
  };

  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:8px;"
    + "background:rgba(0,0,0,.6);color:#fff;font:13px system-ui,sans-serif;pointer-events:none;white-space:nowrap;";
  document.body.append(banner);

  // Minimap : la même que dans le jeu, mise à jour à 16 Hz, pour mesurer son coût au même moment que le reste (?minimap=0 pour comparer).
  const withMinimap = params.get("minimap") !== "0";
  const minimap = withMinimap ? new Minimap(document.getElementById("minimap") as HTMLCanvasElement) : null;
  if (minimap) {
    document.body.classList.add("minimap-on");
    MapData.load().then((d) => minimap.attach(d), (e: unknown) => console.warn("carte indisponible :", e));
  }
  let miniTimer = 0;

  const reports: PhaseReport[] = [];
  let index = -1;
  let phase: Phase | null = null;
  let samples: FrameSample[] = [];
  let firstBuild = 0;
  let warm = 0;
  let stableSince = 0;
  let lastBuildCount = 0;
  let t = 0;
  let pendingBuild = 0;
  let late = { here: 0, ahead: 0 };
  let crowd: CrowdRenderer | null = null;
  let crowdSim: CrowdSim | null = null;
  let crowdCost = { ms: 0, frames: 0 };
  // Vraie simulation (?sim=1) : persiste d'une phase à l'autre ; la navigation se charge autour du point suivi.
  let pedSim: PedSim | null = null;
  let simMs: number[] = [];
  let pigSim: PigeonSim | null = null;
  let pigView: PigeonRenderer | null = null;
  let pigCost = { ms: 0, frames: 0 };
  let simBase = { spawns: 0, despawns: 0 };
  let prefilled = false;
  const nav = simMode || trafficN > 0 || policeMode ? new NavManager() : null;
  const signals = nav && (trafficN > 0 || policeMode) ? new Signals(nav.graph.road, { t: 0 }) : null;
  const traffic = nav && signals ? new Traffic(scene, nav, terrain, ctx.colliders, (x, y) => tiles.solidAt(x, y), trafficN, signals, 11) : null;
  let trafficAcc = 0;
  const wanted = new Wanted();
  const police = policeMode && traffic && nav ? new PoliceController(wanted, ctx.colliders, () => nav.graph.road, () => signals, () => traffic) : null;
  const officerSeeds = new Int32Array(OFFICER.max).fill(-1), officerOut = new Uint8Array(OFFICER.max);
  if (nav) void nav.init().then(() => nav.preload(spawn.x, spawn.y));
  const groundAt = (x: number, z: number): number => terrain.heightAt(x, -z);

  const startPhase = (): void => {
    index++;
    phase = phases[index] ?? null;
    if (!phase) return;
    phase.setup?.();
    crowdCost = { ms: 0, frames: 0 };
    simMs = [];
    fleetCost = { ms: 0, max: 0, frames: 0 };
    trafficCost = { simMs: 0, simMax: 0, steps: 0, updMs: 0, updMax: 0, frames: 0, contacts: 0, honks: 0 };
    policeCost = { ms: 0, max: 0, frames: 0 };
    combatCost = { ms: 0, max: 0, frames: 0, fxPeak: 0, fxFrames: 0, policeShots: 0, policeDamage: 0, shots0: bot?.shots ?? 0, hits0: bot?.hits ?? 0, kills0: bot?.kills ?? 0 };
    pigCost = { ms: 0, frames: 0 };
    if (simMode) {
      if (!crowd) {
        pedSim = new PedSim(nav!.graph, terrain, ctx.colliders, { capacity: crowdN + (police ? OFFICER.max : 0), reserved: police ? OFFICER.max : 0, seed: 7, tiers: params.get("tiers") !== "0", avoid: params.get("avoid") !== "0" });
        crowd = createCrowd(scene, pedSim.state);
        pedSim.onSpawn = (slot, recipe) => crowd?.assign?.(slot, recipe);
        if (combatMode) bot = new CombatBot(pedSim, ctx.colliders);
        // Les pigeons du jeu (40 % de la foule) vivent aussi pendant le banc.
        pigSim = new PigeonSim(nav!.graph, terrain, ctx.colliders, { capacity: pigeonCapacity(crowdN), seed: 7 });
        pigView = new PigeonRenderer(scene, Math.max(1, pigSim.capacity));
      }
      crowd.setShadows(phase.crowd?.shadows ?? renderer.shadowMap.enabled);
      simBase = { spawns: pedSim!.stats.spawns, despawns: pedSim!.stats.despawns };
    } else {
      crowd?.dispose();
      crowd = null;
      crowdSim = null;
    }
    if (!simMode && phase.crowd) {
      const at = pose();
      crowdSim = createCrowdSim({ count: phase.crowd.n, camX: at.cam[0], camZ: -at.cam[2], camYaw: 0, seed: 7 });
      crowd = createCrowd(scene, crowdSim.state);
      crowd.setShadows(phase.crowd.shadows);
    }
    samples = [];
    late = { here: 0, ahead: 0 };
    t = 0;
    // Les arrêts attendent que les tuiles autour soient construites (au plus 12 s), puis 1,5 s de mise en route.
    warm = phase.still || phase.warmStart ? 12 : 0;
    stableSince = 0;
    firstBuild = tiles.builds.length;
    lastBuildCount = tiles.buildCount;
    if (minimap) Object.assign(minimap.cost, { calls: 0, totalMs: 0, maxMs: 0 });
  };

  const endPhase = (): void => {
    const p = phase!;
    let dSum = 0, dMax = 0, tSum = 0, tMax = 0, hitches = 0;
    for (const s of samples) {
      dSum += s.draws; dMax = Math.max(dMax, s.draws);
      tSum += s.triangles; tMax = Math.max(tMax, s.triangles);
      if (s.ms > 50 && s.build > 0) hitches++;
    }
    const n = Math.max(1, samples.length);
    reports.push({
      name: p.name,
      frames: summarizeFrames(samples.map((s) => s.ms)),
      draws: { avg: Math.round(dSum / n), max: dMax },
      triangles: { avg: Math.round(tSum / n), max: tMax },
      builds: tiles.builds.slice(firstBuild).map((b) => ({ id: b.id, ms: r1(b.ms), frames: b.frames, slice: r1(b.slice) })),
      hitchesWithBuild: hitches,
      late: p.drive ? { frames: samples.length, ...late } : null,
      memory: measureMemory(ctx),
      crowd: crowd && (simMode || p.crowd)
        ? {
            n: simMode ? crowdN : p.crowd!.n, shadows: p.crowd?.shadows ?? renderer.shadowMap.enabled, near: crowd.lodCounts().near, far: crowd.lodCounts().far,
            updateMs: crowdCost.frames ? crowdCost.ms / crowdCost.frames : 0,
            ...(pedSim ? { sim: simReport(pedSim.stats, simMs, simBase, nav!, { alive: pigSim?.stats.alive ?? 0, ms: pigCost.frames ? pigCost.ms / pigCost.frames : 0 }) } : {}),
          }
        : null,
      police: police && traffic
        ? (() => {
            let cars = 0, chasing = 0;
            traffic.forEachPolice((_id, _x, _y, _h, _s, ch) => {
              cars++;
              if (ch) chasing++;
            });
            return { cars, chasing, officers: police.officers.list.length, avgMs: policeCost.frames ? policeCost.ms / policeCost.frames : 0, maxMs: policeCost.max };
          })()
        : null,
      combat: bot && fx
        ? {
            shots: bot.shots - combatCost.shots0, hits: bot.hits - combatCost.hits0, kills: bot.kills - combatCost.kills0, corpses: pedSim?.stats.corpses ?? 0, fxPeak: combatCost.fxPeak,
            fxFrames: combatCost.fxFrames, frames: combatCost.frames, policeShots: combatCost.policeShots, policeDamage: Math.round(combatCost.policeDamage),
            avgMs: combatCost.frames ? combatCost.ms / combatCost.frames : 0, maxMs: combatCost.max,
          }
        : null,
      traffic: traffic
        ? {
            max: trafficN, cars: traffic.cars.length, target: traffic.target, meshes: traffic.models.drawn,
            simAvgMs: trafficCost.steps ? trafficCost.simMs / trafficCost.steps : 0, simMaxMs: trafficCost.simMax,
            updateAvgMs: trafficCost.frames ? trafficCost.updMs / trafficCost.frames : 0, updateMaxMs: trafficCost.updMax, steps: trafficCost.steps,
            contacts: trafficCost.contacts, honks: trafficCost.honks,
          }
        : null,
      fleet: fleet ? { ...fleet.stats, avgMs: fleetCost.frames ? fleetCost.ms / fleetCost.frames : 0, maxMs: fleetCost.max } : null,
      minimap: minimap && minimap.cost.calls > 0 ? { updates: minimap.cost.calls, avgMs: minimap.cost.totalMs / minimap.cost.calls, maxMs: minimap.cost.maxMs } : null,
    });
  };

  /** Position de l'appareil suivi (le « véhicule ») et de la caméra. */
  const pose = (): { x: number; y: number; vx: number; vy: number; cam: [number, number, number]; look: [number, number, number] } => {
    const p = phase!;
    if (p.drive) {
      const s = Math.min(p.drive.from + t * p.drive.speed, p.drive.to);
      const at = route.at(s), back = route.at(s - CHASE_BACK), ahead = route.at(s + CHASE_AHEAD);
      // Vitesse le long du parcours, pour l'anticipation du chargement.
      const next = route.at(s + 1);
      const len = Math.hypot(next.x - at.x, next.y - at.y) || 1;
      return {
        x: at.x, y: at.y,
        vx: ((next.x - at.x) / len) * p.drive.speed, vy: ((next.y - at.y) / len) * p.drive.speed,
        cam: [back.x, terrain.heightAt(back.x, back.y) + CHASE_HEIGHT, back.y],
        look: [ahead.x, terrain.heightAt(ahead.x, ahead.y) + 1.2, ahead.y],
      };
    }
    // Vue du jeu au départ : derrière le piéton, regard vers le nord (mairie, théâtre).
    const x = spawn.x, y = spawn.y;
    return { x, y, vx: 0, vy: 0, cam: [x, terrain.heightAt(x, y - 3.6) + 2.6, y - 3.6], look: [x, terrain.heightAt(x, y + 20) + 1.5, y + 20] };
  };

  let last = performance.now();
  startPhase();
  ctx.ready();
  const frame = (now: number): void => {
    const ms = now - last;
    last = now;
    const dt = Math.min(ms / 1000, 0.1);
    const p = phase;
    if (!p) return;

    let measuring = true;
    if (warm > 0) {
      measuring = false;
      warm -= dt;
      if (tiles.buildCount !== lastBuildCount) {
        lastBuildCount = tiles.buildCount;
        stableSince = 0;
      } else stableSince += dt;
      if (stableSince > 1.5) warm = 0;
      if (warm <= 0) {
        firstBuild = tiles.builds.length;
        pendingBuild = 0;
        t = 0;
        samples = [];
        late = { here: 0, ahead: 0 };
        if (minimap) Object.assign(minimap.cost, { calls: 0, totalMs: 0, maxMs: 0 });
      }
    } else {
      // La durée mesurée ici est celle de l'image précédente : on lui attribue sa construction de tuile.
      if (t > 0) samples.push({ ms, draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, build: pendingBuild });
      t += dt;
    }

    const done = p.still ? t >= p.still.seconds : t * p.drive!.speed >= p.drive!.to - p.drive!.from;
    if (measuring && done) {
      endPhase();
      startPhase();
      if (!phase) {
        crowd?.dispose();
        traffic?.dispose();
        fx?.dispose();
        banner.remove();
        showReport(ctx, { settings, loadMs, phases: reports });
        return;
      }
      requestAnimationFrame(frame);
      return;
    }

    const pos = pose();
    camera.position.set(pos.cam[0], pos.cam[1], -pos.cam[2]);
    camera.lookAt(pos.look[0], pos.look[1], -pos.look[2]);
    tiles.update(pos.x, pos.y, pos.vx, pos.vy);
    if (fleet) {
      dentFleet();
      const t0 = performance.now();
      fleet.cull(pos.x, pos.y);
      const ms = performance.now() - t0;
      fleetCost.ms += ms;
      fleetCost.max = Math.max(fleetCost.max, ms);
      fleetCost.frames++;
    }
    nav?.update(pos.x, pos.y, pos.vx, pos.vy);
    if (traffic && signals) {
      // Les voitures jouent à pas fixe (1/60 s, deux au plus par image) comme dans le jeu ; le point suivi est un piéton ou, en roulant, un véhicule sans physique.
      signals.clock.t += dt;
      trafficAcc = Math.min(trafficAcc + dt, 2 / 60);
      // Aux arrêts, le point suivi est un piéton (obstacle) ; en roulant, il est ignoré : le banc mesure la circulation, pas ses réactions à un faux joueur à 90 km/h.
      const body = phase?.drive ? null : { kind: "foot" as const, x: pos.x, y: pos.y, vx: pos.vx, vy: pos.vy };
      while (trafficAcc >= 1 / 60) {
        const t0 = performance.now();
        traffic.step(1 / 60, body);
        const d = performance.now() - t0;
        if (measuring) {
          trafficCost.simMs += d;
          trafficCost.simMax = Math.max(trafficCost.simMax, d);
          trafficCost.steps++;
          trafficCost.contacts += traffic.stats.contacts;
        }
        trafficAcc -= 1 / 60;
      }
      const u0 = performance.now();
      traffic.setNight(atmosphere.night);
      traffic.setPeds(pedSim);
      traffic.update(dt, { x: pos.x, y: pos.y, yaw: Math.atan2(pos.look[0] - pos.cam[0], pos.look[1] - pos.cam[2]), speed: Math.hypot(pos.vx, pos.vy), hour: atmosphere.hour, vehicle: null });
      const ud = performance.now() - u0;
      if (measuring) {
        trafficCost.updMs += ud;
        trafficCost.updMax = Math.max(trafficCost.updMax, ud);
        trafficCost.frames++;
      }
      if (police) {
        // Trois étoiles tenues pendant tout le banc ; la poursuite vise le point suivi, même en roulant (le banc n'a pas de véhicule).
        const c0 = performance.now();
        wanted.set(combatMode ? 5 : 3, pos.x, pos.y);
        const yaw = Math.atan2(pos.look[0] - pos.cam[0], pos.look[1] - pos.cam[2]);
        police.update(dt, {
          x: pos.x, y: pos.y, vx: pos.vx, vy: pos.vy, heading: yaw, speed: Math.hypot(pos.vx, pos.vy), driving: !!phase?.drive, vehicle: null,
          pedHits: 0, pedHitSpeed: 0, witnesses: () => 0,
        });
        traffic.setChaseTarget({ x: pos.x, y: pos.y, vx: pos.vx, vy: pos.vy });
        if (police.takeArrest()) police.reset();
        if (pedSim) {
          const base = pedSim.reservedStart, out = officerOut;
          out.fill(0);
          for (const o of police.officers.list) {
            out[o.slot] = 1;
            const fresh = officerSeeds[o.slot] !== o.seed;
            officerSeeds[o.slot] = o.seed;
            pedSim.setExternal(base + o.slot, true, fresh ? gendarmeRecipe(o.seed) : null, o.x, o.y, o.heading, o.speed, Officers.pose(o), o.mode === "dead" ? Math.min(o.poseT, 2.2) : o.armed && o.mode === "run" ? o.sinceShot : o.poseT, dt, o.armed && o.mode !== "dead", o.mode === "dead");
          }
          for (let k = 0; k < OFFICER.max; k++) {
            if (out[k] || officerSeeds[k]! < 0) continue;
            officerSeeds[k] = -1;
            pedSim.setExternal(base + k, false, null, 0, 0, 0, 0, 0, 0, 0);
          }
        }
        const pd = performance.now() - c0;
        if (measuring) {
          policeCost.ms += pd;
          policeCost.max = Math.max(policeCost.max, pd);
          policeCost.frames++;
        }
      }
    }
    pendingBuild = tiles.sliceMs;
    if (measuring && p.drive) {
      if (!tiles.solidAt(pos.x, pos.y)) late.here++;
      if (!tiles.solidAt(pos.x + pos.vx, pos.y + pos.vy)) late.ahead++;
    }
    terrainView.update(pos.x, pos.y);
    atmosphere.advance(dt);
    placeSun(pos.x, pos.y, terrain.heightAt(pos.x, pos.y));
    sky.position.copy(camera.position);
    if (minimap) {
      miniTimer -= dt;
      if (miniTimer <= 0) {
        miniTimer = 1 / 16;
        const yaw = Math.atan2(pos.look[0] - pos.cam[0], pos.look[1] - pos.cam[2]);
        minimap.time(() => minimap.update({ x: pos.x, y: pos.y, cameraYaw: yaw, facing: yaw, north: false, vehicles: [], waypoint: null }));
      }
    }
    if (pedSim && crowd && nav && nav.graph.edgeCount > 0) {
      const obs: Observer = {
        x: pos.x, y: pos.y, vx: pos.vx, vy: pos.vy, yaw: Math.atan2(pos.look[0] - pos.cam[0], pos.look[1] - pos.cam[2]), onFoot: !phase?.drive,
        vehicle: phase?.drive ? { x: pos.x, y: pos.y, vx: pos.vx, vy: pos.vy } : null,
        ...(traffic ? { vehicles: traffic.bodies(), honks: traffic.takeHonks() } : {}),
      };
      if (measuring && obs.honks) trafficCost.honks += obs.honks.length;
      if (!prefilled) {
        pedSim.prefill(obs);
        pigSim?.prefill(obs);
        prefilled = true;
      }
      const s0 = performance.now();
      pedSim.step(dt, obs);
      traffic?.applyImpacts();
      const sim = performance.now() - s0;
      const p0 = performance.now();
      if (pigSim && pigView) {
        pigSim.step(dt, obs, pedSim);
        pigView.update(pigSim.state, obs.x, obs.y, 100);
      }
      const pig = performance.now() - p0;
      const c0 = performance.now();
      crowd.update(pedSim.state, pos.cam[0], -pos.cam[2]);
      if (bot && fx) {
        // Le tireur, les tirs de la police et les effets (un seul maillage) : leur coût est compté ensemble.
        const k0 = performance.now();
        const z = terrain.heightAt(pos.x, pos.y) + 1.3;
        const r = bot.step(dt, pos.x, pos.y);
        if (r.fired > 0) {
          fx.flash(r.shots[0]!.x0, r.shots[0]!.y0, z);
          for (let k = 0; k < r.fxCount; k++) {
            const sh = r.shots[k]!;
            fx.tracer(sh.x0, sh.y0, z, sh.x1, sh.y1, z);
            if (sh.kind > 0) fx.sparks(sh.x1, sh.y1, z - 0.2, sh.kind === 2, Math.random);
          }
        }
        if (police) {
          const dmg = police.takeDamage();
          if (measuring) {
            combatCost.policeDamage += dmg;
            combatCost.policeShots += police.shots.length;
          }
          for (const sh of police.shots) {
            const z0 = terrain.heightAt(sh.x0, sh.y0) + 1.3;
            fx.flash(sh.x0, sh.y0, z0);
            fx.tracer(sh.x0, sh.y0, z0, sh.x1, sh.y1, z0);
          }
          police.clearShots();
        }
        fx.update(dt, [], t);
        const kd = performance.now() - k0;
        if (measuring) {
          combatCost.ms += kd;
          combatCost.max = Math.max(combatCost.max, kd);
          combatCost.frames++;
          combatCost.fxPeak = Math.max(combatCost.fxPeak, fx.count);
          if (fx.count > 0) combatCost.fxFrames++;
        }
      }
      if (measuring) {
        simMs.push(sim);
        pigCost.ms += pig;
        pigCost.frames++;
        crowdCost.ms += performance.now() - c0;
        crowdCost.frames++;
      }
    } else if (crowd && crowdSim) {
      crowdSim.step(dt, groundAt);
      const c0 = performance.now();
      crowd.update(crowdSim.state, pos.cam[0], -pos.cam[2]);
      if (measuring) {
        crowdCost.ms += performance.now() - c0;
        crowdCost.frames++;
      }
    }
    renderer.render(scene, camera);

    const remaining = p.still ? p.still.seconds - t : (p.drive!.to - p.drive!.from) / p.drive!.speed - t;
    banner.textContent = `Banc de test · ${index + 1}/${phases.length} · ${p.name} · `
      + (warm > 0 ? "mise en route…" : `${Math.max(0, Math.ceil(remaining))} s`);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

interface Report {
  settings: Record<string, unknown>;
  loadMs: number;
  phases: PhaseReport[];
}

function verdict(f: FrameSummary): string {
  if (f.fps >= 57 && f.low1 >= 40) return "fluide";
  if (f.fps >= 45) return "correct";
  if (f.fps >= 30) return "juste";
  return "insuffisant";
}

export function reportText(device: Record<string, unknown>, r: Report): string {
  const lines: string[] = [];
  lines.push(`BANC DE TEST AUTUN 3D — ${new Date().toLocaleString("fr-FR")}`);
  lines.push(`Version : ${String(device["build"] ?? "")}`);
  lines.push(`Appareil : ${String(device["gpu"])} · écran ${String(device["screen"])} · densité ${String(device["devicePixelRatio"])} · ${String(device["cores"])} cœurs`);
  lines.push(`Rendu : ${String(device["drawingBuffer"])} px (×${String(r.settings["pixelRatio"])}) · ombres ${r.settings["shadows"] ? `oui (${String(r.settings["shadowMap"])})` : "non"} · détail ${String(r.settings["detail"])} m · construction ${String(r.settings["budget"])} ms/image · ${String(r.settings["hour"])} · minimap ${r.settings["minimap"] ? "active" : "coupée"}${r.settings["fast"] ? ` · trajet rapide ${String(r.settings["fast"])} km/h` : ""}${r.settings["fleet"] ? ` · véhicules garés${r.settings["fleet"] === "dent" ? " (un sur trois abîmé)" : ""}` : ""}${r.settings["traffic"] ? ` · circulation ${String(r.settings["traffic"])}` : ""}${r.settings["police"] ? ` · police (${r.settings["combat"] ? "5 étoiles, armée" : "3 étoiles"})` : ""}${r.settings["combat"] ? " · combat (tireur au fusil d'assaut)" : ""}${r.settings["crowd"] ? ` · foule ${String(r.settings["crowd"])}${r.settings["sim"] ? ` (${String(r.settings["sim"])})` : ""}${r.settings["soak"] ? `, endurance ${String(r.settings["soak"])} min` : ""}` : ""}`);
  lines.push(`Chargement initial : ${(r.loadMs / 1000).toFixed(1)} s · parcours ${String(r.settings["route"])}`);
  const still = r.phases[0]?.frames;
  if (still && still.p50 > 0) lines.push(`Fréquence de l'écran estimée : ${Math.round(1000 / still.p50)} Hz`);
  lines.push("");
  for (const p of r.phases) {
    const f = p.frames;
    lines.push(`■ ${p.name} — ${verdict(f)}`);
    lines.push(`  ${f.fps.toFixed(1)} i/s en moyenne · 1 % les plus lentes : ${f.low1.toFixed(1)} i/s · ${f.frames} images en ${f.seconds.toFixed(1)} s`);
    lines.push(`  Durée d'image : médiane ${f.p50.toFixed(1)} ms · 95 % ${f.p95.toFixed(1)} · 99 % ${f.p99.toFixed(1)} · max ${f.max.toFixed(0)} ms`);
    lines.push(`  À-coups : ${f.over33} images > 33 ms, ${f.over50} > 50 ms (dont ${p.hitchesWithBuild} pendant une construction de tuile)`);
    if (p.late) lines.push(`  Chargement en retard : ${p.late.here} images sur ${p.late.frames} sans obstacles sous le véhicule, ${p.late.ahead} sans obstacles à 1 s devant (objectif : 0)`);
    if (p.fleet) lines.push(`  Véhicules garés : ${p.fleet.total} en tout · ${p.fleet.drawn} dessinés en ${p.fleet.meshes} maillages instanciés (un par modèle présent) · mise à jour ${p.fleet.avgMs.toFixed(2)} ms par image (pire ${p.fleet.maxMs.toFixed(2)} ms)`);
    if (p.traffic) {
      const q = p.traffic;
      lines.push(`  Circulation : ${q.cars} voitures (cible ${q.target}, au plus ${q.max}) · ${q.meshes} maillages instanciés · simulation ${q.simAvgMs.toFixed(3)} ms par pas (pire ${q.simMaxMs.toFixed(2)} ms, ${q.steps} pas) · mise à jour et naissances ${q.updateAvgMs.toFixed(3)} ms par image (pire ${q.updateMaxMs.toFixed(2)} ms) · ${q.contacts} pas avec contact, ${q.honks} coups de klaxon`);
    }
    if (p.police) {
      const q = p.police;
      lines.push(`  Police : ${q.cars} voitures dont ${q.chasing} en poursuite · ${q.officers} gendarmes à pied · ${q.avgMs.toFixed(3)} ms par image (pire ${q.maxMs.toFixed(2)} ms)`);
    }
    if (p.combat) {
      const q = p.combat;
      lines.push(`  Combat : ${q.shots} tirs, ${q.hits} touchés, ${q.kills} tués dans la phase · ${q.corpses} cadavres à la fin (au plus 8 qui ne s'enfoncent pas) · effets : jusqu'à ${q.fxPeak} instances, présents sur ${q.fxFrames} images de ${q.frames} (chacune coûte +1 appel de dessin) · tireur et effets ${q.avgMs.toFixed(3)} ms par image (pire ${q.maxMs.toFixed(2)} ms)${q.policeShots || q.policeDamage ? ` · police : ${q.policeShots} tirs, ${q.policeDamage} points de dégâts sur le point suivi` : ""}`);
    }
    if (p.minimap) lines.push(`  Minimap : ${p.minimap.updates} mises à jour · ${p.minimap.avgMs.toFixed(2)} ms en moyenne · pire ${p.minimap.maxMs.toFixed(2)} ms (objectif : moins d'1 ms)`);
    if (p.crowd) lines.push(`  Foule : ${p.crowd.n} personnages (${p.crowd.near} près, ${p.crowd.far} loin) · ombres des personnages ${p.crowd.shadows ? "oui" : "non"} · mise à jour ${p.crowd.updateMs.toFixed(2)} ms par image`);
    if (p.crowd?.sim) {
      const q = p.crowd.sim;
      lines.push(`  Simulation : ${q.avgMs.toFixed(3)} ms par image en moyenne · 95 % ${q.p95Ms.toFixed(3)} · pire ${q.maxMs.toFixed(2)} ms (objectif : moins de 2 ms)`);
      lines.push(`  Passants : ${q.alive} vivants (paliers ${q.tiers.join(" / ")}) · ${q.spawns} naissances, ${q.despawns} disparitions dans la phase · ${q.waiting} attendent, ${q.crossing} traversent, ${q.idle} à l'arrêt · ${q.spawnFailures} naissances refusées (en vue) · navigation ${q.navCells} super-tuiles, ${q.navEdges} arêtes`);
      lines.push(`  Pigeons : ${q.pigeons} vivants · ${q.pigeonMs.toFixed(3)} ms par image (simulation et sommets)`);
    }
    lines.push(`  Dessin : ${p.draws.avg} appels (max ${p.draws.max}) · ${Math.round(p.triangles.avg / 1000)}k triangles (max ${Math.round(p.triangles.max / 1000)}k)`);
    if (p.builds.length) {
      const n = p.builds.length;
      const sum = (f: (b: PhaseReport["builds"][number]) => number): number => p.builds.reduce((a, b) => a + f(b), 0);
      const slice = Math.max(...p.builds.map((b) => b.slice));
      const worst = [...p.builds].sort((a, b) => b.ms - a.ms).slice(0, 4).map((b) => `${b.id} ${b.ms.toFixed(0)}`).join(", ");
      lines.push(`  Tuiles construites : ${n} · travail moyen ${(sum((b) => b.ms) / n).toFixed(0)} ms étalé sur ${(sum((b) => b.frames) / n).toFixed(0)} images · plus longue tranche ${slice.toFixed(0)} ms`);
      lines.push(`  Tuiles les plus lourdes : ${worst} ms`);
    }
    const m = p.memory;
    lines.push(`  Mémoire : géométrie ≈ ${m.geometryMB} Mo (${m.geometries}) · textures ≈ ${m.textureMB} Mo (${m.textures})${m.heapMB !== null ? ` · JavaScript ${m.heapMB} Mo` : ""}`);
    lines.push("");
  }
  const soak = soakTrend(r.phases.filter((p) => p.name.startsWith("Endurance")).map((p) => p.frames.fps));
  if (soak) {
    lines.push(`Endurance : ${soak.first.toFixed(1)} i/s la première minute, ${soak.last.toFixed(1)} la dernière (minimum ${soak.min.toFixed(1)}), perte ${soak.drop.toFixed(1)} i/s`);
    lines.push("");
  }
  lines.push(`Navigateur : ${String(device["userAgent"])}`);
  return lines.join("\n");
}

function showReport(ctx: GameContext, r: Report): void {
  const device = { ...deviceInfo(ctx), build: __BUILD__ };
  const text = reportText(device, r);
  const json = JSON.stringify({ date: new Date().toISOString(), device, ...r }, null, 1);
  (window as unknown as { __autun: Record<string, unknown> }).__autun["bench"] = { text, json, report: r, device };
  showReportPanel(text, json, "banc");
}
