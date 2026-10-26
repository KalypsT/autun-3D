import * as THREE from "three";
import { BENCH_ROUTE } from "./bench-route";
import { Polyline, summarizeFrames, type FrameSummary } from "./bench-stats";
import type { GameContext } from "./context";
import { followSun, gameSpawn } from "./game";

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
  /** Réglage appliqué avant la phase (non mesuré pendant la mise en route). */
  setup?: () => void;
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

interface PhaseReport {
  name: string;
  frames: FrameSummary;
  draws: { avg: number; max: number };
  triangles: { avg: number; max: number };
  builds: { id: string; ms: number; frames: number; slice: number }[];
  /** À-coups (> 50 ms) qui tombent sur une image où une tuile se construisait. */
  hitchesWithBuild: number;
  memory: Memory;
}

const CHASE_BACK = 7;
const CHASE_AHEAD = 14;
const CHASE_HEIGHT = 2.8;
const SPLIT = 1350;

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Estimation de la mémoire graphique : géométries et textures présentes dans la scène, plus la carte d'ombres. */
function measureMemory(ctx: GameContext): Memory {
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

function deviceInfo(ctx: GameContext): Record<string, unknown> {
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
  const phases: Phase[] = [
    { name: "Arrêt sur la place", still: { seconds: short ? 2 : 8 } },
    { name: "Rues à 50 km/h", drive: { from: 0, to: split, speed: 50 / 3.6 } },
    { name: "Rues à 90 km/h", drive: { from: split, to: end, speed: 90 / 3.6 } },
    { name: "Arrêt, sans ombres", still: { seconds: 6 / still }, setup: () => setShadows(false) },
    { name: "Arrêt, sans ombres, définition 1×", still: { seconds: 6 / still }, setup: () => renderer.setPixelRatio(1) },
  ];
  const settings = {
    shadows: renderer.shadowMap.enabled,
    shadowMap: sunLight.shadow.mapSize.x,
    pixelRatio: renderer.getPixelRatio(),
    detail: Number(params.get("detail") ?? 210),
    budget: Number(params.get("budget") ?? 4),
    hour: atmosphere.clock,
    route: `${r1(end / 1000)} km${short ? " (version courte, sans valeur de mesure)" : ""}`,
  };

  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:6;padding:6px 12px;border-radius:8px;"
    + "background:rgba(0,0,0,.6);color:#fff;font:13px system-ui,sans-serif;pointer-events:none;white-space:nowrap;";
  document.body.append(banner);

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

  const startPhase = (): void => {
    index++;
    phase = phases[index] ?? null;
    if (!phase) return;
    phase.setup?.();
    samples = [];
    t = 0;
    // Les arrêts attendent que les tuiles autour soient construites (au plus 12 s), puis 1,5 s de mise en route.
    warm = phase.still ? 12 : 0;
    stableSince = 0;
    firstBuild = tiles.builds.length;
    lastBuildCount = tiles.buildCount;
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
      memory: measureMemory(ctx),
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
    pendingBuild = tiles.sliceMs;
    terrainView.update(pos.x, pos.y);
    atmosphere.advance(dt);
    placeSun(pos.x, pos.y, terrain.heightAt(pos.x, pos.y));
    sky.position.copy(camera.position);
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
  lines.push(`Rendu : ${String(device["drawingBuffer"])} px (×${String(r.settings["pixelRatio"])}) · ombres ${r.settings["shadows"] ? `oui (${String(r.settings["shadowMap"])})` : "non"} · détail ${String(r.settings["detail"])} m · construction ${String(r.settings["budget"])} ms/image · ${String(r.settings["hour"])}`);
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
  lines.push(`Navigateur : ${String(device["userAgent"])}`);
  return lines.join("\n");
}

function showReport(ctx: GameContext, r: Report): void {
  const device = { ...deviceInfo(ctx), build: __BUILD__ };
  const text = reportText(device, r);
  const json = JSON.stringify({ date: new Date().toISOString(), device, ...r }, null, 1);
  console.log(text);
  (window as unknown as { __autun: Record<string, unknown> }).__autun["bench"] = { text, json, report: r, device };

  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;inset:8px;z-index:10;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;"
    + "background:rgba(18,20,26,.94);color:#eee;font:13px system-ui,sans-serif;";
  const pre = document.createElement("pre");
  pre.textContent = text;
  pre.style.cssText = "flex:1;margin:0;overflow:auto;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;user-select:text;-webkit-user-select:text;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
  const button = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "padding:10px 14px;border-radius:8px;border:1px solid #888;background:#2b3140;color:#fff;font:14px system-ui,sans-serif;";
    b.addEventListener("click", fn);
    bar.append(b);
    return b;
  };
  const copy = button("Copier le rapport", () => {
    navigator.clipboard.writeText(text).then(
      () => { copy.textContent = "Copié ✓"; },
      () => {
        // Repli : sélection du texte pour une copie manuelle.
        const range = document.createRange();
        range.selectNodeContents(pre);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        copy.textContent = "Texte sélectionné : copiez-le";
      },
    );
  });
  button("Télécharger (JSON)", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `autun-banc-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  button("Relancer", () => location.reload());
  button("Jouer", () => { location.search = ""; });
  panel.append(bar, pre);
  document.body.append(panel);
}
