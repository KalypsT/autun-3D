import { HEAD_HEIGHT, solveCamera } from "../core/camera-rig";
import { createPlayer, PLAYER_RADIUS, stepPlayer } from "../core/player";
import { stepVehicle } from "../core/vehicle";
import type { Observer } from "../core/pedestrians";
import { pigeonCapacity } from "../core/pigeons";
import { SaveStore } from "../core/save";
import { Controls } from "../input/controls";
import { AppearanceStore } from "../core/appearance";
import type { Recipe } from "../core/character";
import { createPlayerModel } from "../render/player-model";
import type { GameContext } from "./context";
import { FrameMeter } from "./hud";
import { SkidMarks } from "../render/skid-marks";
import { Speedo } from "../ui/speedo";
import { Wanted } from "../core/wanted";
import { WantedHud } from "../ui/wanted-hud";
import type { VehicleModel } from "../render/vehicle-model";
import { gameSpawn } from "./start";
import { NavDebug } from "../render/nav-debug";
import { NavManager } from "./nav-manager";
import { PedsController } from "./peds-controller";
import { Signals } from "../core/signals";
import { Traffic } from "./traffic";
import { PigeonsController } from "./pigeons-controller";
import { UiBridge } from "./ui-bridge";
import { Fleet, chaseOf, familyOf, tyreOf, type Vehicle } from "./vehicles";
import { FAMILIES, LEGACY_MODELS, vehicleDef } from "../core/vehicle-catalog";

export { gameSpawn } from "./start";
const STEP = 1 / 60;
const MIN_PITCH = -0.3;
const MAX_PITCH = 1.25;
const SHADOW_HALF = 80;
/** Vitesse (m/s) sous laquelle on peut prendre une voiture de la circulation avec son conducteur (J4-1). */
const CARJACK_SPEED = 3;
/** Caméra de poursuite : inclinaison de repos. */
const CHASE_PITCH = 0.24;

function angleDelta(from: number, to: number): number {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/** Carte d'ombres centrée sur le joueur (plus fine qu'une carte pour toute la zone) ; renvoie de quoi placer le soleil à chaque image. */
export function followSun(ctx: GameContext): (x: number, y: number, z: number) => void {
  const { scene, sunLight, sunDir, atmosphere } = ctx;
  const sc = sunLight.shadow.camera;
  sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF; sc.near = 20; sc.far = 700;
  sc.updateProjectionMatrix();
  scene.add(sunLight.target);
  return (x, y, z) => {
    sunDir.copy(atmosphere.lightDir);
    // Cases de 0,5 m pour que les ombres ne scintillent pas.
    const sx = Math.round(x / 0.5) * 0.5, sy = Math.round(y / 0.5) * 0.5;
    sunLight.target.position.set(sx, z, -sy);
    sunLight.position.set(sx + sunDir.x * 300, z + sunDir.y * 300, -sy + sunDir.z * 300);
    sunLight.target.updateMatrixWorld();
  };
}

export function startGame(ctx: GameContext): void {
  const { camera, renderer, scene, sky, atmosphere, world, params, debugEl, tiles, terrainView, colliders } = ctx;
  const { terrain } = world;
  const spawn = ctx.start ?? { ...gameSpawn(params), save: null, noSave: true };
  const startYaw = spawn.yaw;
  const saved = spawn.save;
  const player = createPlayer(spawn.x, spawn.y, terrain, startYaw);
  // Apparence du joueur : enregistrée à part de la partie (survit à « nouvelle partie »), appliquée tout de suite.
  const appearanceStore = new AppearanceStore();
  let appearance: Recipe = appearanceStore.load();
  const model = createPlayerModel(appearance);
  scene.add(model.group);

  const placeSun = followSun(ctx);

  // Véhicules garés : aux parkings à vélos des tuiles déjà construites, puis de chaque nouvelle tuile.
  const fleet = new Fleet(scene, colliders, terrain);
  // Départ neuf : aucune voiture garée sur le joueur. Partie reprise : les véhicules laissés ailleurs reviennent où ils étaient.
  if (saved) fleet.restore(saved.vehicles);
  else fleet.keepClear(spawn.x, spawn.y, 4);
  for (const extras of tiles.loadedExtras()) fleet.addFromTile(extras);
  tiles.onBuild = (extras) => fleet.addFromTile(extras);
  tiles.onUnload = (id) => fleet.removeTile(id);

  const controls = new Controls(
    document.getElementById("touch")!,
    document.getElementById("stick-base")!,
    document.getElementById("stick-knob")!,
    document.getElementById("gas"),
    document.getElementById("brake"),
    document.getElementById("handbrake"),
    document.getElementById("horn"),
  );
  const fsButton = document.getElementById("fullscreen");
  fsButton?.addEventListener("click", () => {
    void document.documentElement.requestFullscreen?.().then(async () => {
      try {
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
      } catch {
        /* le verrouillage d'orientation n'existe pas partout */
      }
    });
  });
  if (params.has("debug")) debugEl.style.display = "block";

  const settings = ctx.settings!;
  controls.sensitivity = settings.values.sensitivity;
  settings.listeners.push((v, changed) => {
    controls.sensitivity = v.sensitivity;
    if (changed.includes("shadows")) (peds as PedsController | null)?.setShadows(v.shadows !== 0);
    // « Foule » change en direct ; si la navigation n'était pas chargée (réglage sur « Aucune » au départ), elle se charge maintenant.
    if (changed.includes("traffic")) startTraffic(v.traffic);
    if (changed.includes("crowd")) {
      if (v.crowd > 0) startPeds(v.crowd);
      else {
        (peds as PedsController | null)?.setCapacity(0);
        (pigeons as PigeonsController | null)?.setCapacity(0);
      }
    }
  });

  let yaw = startYaw;
  let pitch = saved ? saved.camera.pitch : 0.28;
  const distance = Number(params.get("dist") ?? 3.6);
  let camDist = distance;
  let riding: Vehicle | null = null;
  let rideModel: VehicleModel | null = null;
  /** Descente demandée en roulant : on freine d'abord. */
  let leaving = false;
  let crank = 0;
  let lookIdle = 0;
  const speedOf = (): number => (riding ? riding.state.speed : player.speed);
  // Navigation et passants (J2) : chargés autour du joueur dès que « Foule » n'est pas sur « Aucune » (ou avec ?nav=1 / ?nav=all pour le recouvrement de contrôle).
  const navParam = params.get("nav");
  const crowdSetting = ctx.settings!.values.crowd;
  let nav: NavManager | null = null;
  let peds: PedsController | null = null;
  let pigeons: PigeonsController | null = null;
  let navDebug: NavDebug | null = null;
  // Feux de circulation (J3-3) : une horloge de simulation, avancée à chaque image jouée (la pause la fige), pour les voitures et les passants.
  let signals: Signals | null = null;
  const startNav = (): NavManager => {
    if (!nav) {
      const n = (nav = new NavManager());
      signals = new Signals(n.graph.road, { t: 0 });
      if (navParam) {
        navDebug = new NavDebug(n.graph, terrain, navParam === "all");
        scene.add(navDebug.group);
      }
      void n.init().then(() => n.preload(player.x, player.y));
    }
    return nav;
  };
  const startPeds = (capacity: number): void => {
    if (capacity <= 0) return;
    if (!peds) {
      peds = new PedsController(scene, startNav(), terrain, colliders, capacity, 7);
      peds.setSignals(signals);
      peds.setShadows(ctx.settings!.values.shadows !== 0);
    } else peds.setCapacity(capacity);
    // Pigeons (J2-7) : leur nombre suit la foule ; ?pigeons=N le force (0 : aucun).
    const pg = params.has("pigeons") ? Math.max(0, Math.min(60, Math.round(Number(params.get("pigeons")) || 0))) : pigeonCapacity(capacity);
    if (!pigeons) pigeons = new PigeonsController(scene, startNav(), terrain, colliders, pg, 7);
    else pigeons.setCapacity(pg);
  };
  const startSignals = (): Signals => {
    startNav();
    return signals!;
  };
  if (navParam) startNav();
  startPeds(crowdSetting);
  // Circulation (J3) : réglage « Circulation » (nombre maximal de voitures, qui naissent et disparaissent autour du joueur selon l'heure et le quartier, D64) ;
  // `?traffic=N` l'impose.
  let traffic: Traffic | null = null;
  const startTraffic = (capacity: number): void => {
    if (capacity <= 0) {
      (traffic as Traffic | null)?.setCapacity(0);
      return;
    }
    if (!traffic) traffic = new Traffic(scene, startNav(), terrain, colliders, (x, y) => tiles.solidAt(x, y), capacity, startSignals(), 11);
    else (traffic as Traffic).setCapacity(capacity);
  };
  startTraffic(settings.values.traffic);
  // `?chase=N` (essais, J4-3) : N voitures de gendarmerie poursuivent le joueur, quel que soit le niveau de recherche (la circulation est créée au besoin).
  const chaseParam = params.has("chase") ? Math.max(0, Math.min(6, Math.round(Number(params.get("chase")) || 0))) : 0;
  if (chaseParam > 0) {
    if (!traffic) traffic = new Traffic(scene, startNav(), terrain, colliders, (x, y) => tiles.solidAt(x, y), 0, startSignals(), 11);
    (traffic as Traffic).pursuers = chaseParam;
  }
  const navInfo = (): string => {
    if (!nav) return "";
    const p = peds as PedsController | null, d = navDebug as NavDebug | null, st = p?.stats;
    const pedText = p && st ? ` · passants ${st.alive}/${st.target} (max ${p.capacity}) sim ${p.simMs.toFixed(2)} ms dessin ${p.drawMs.toFixed(2)} ms` : "";
    const g = pigeons as PigeonsController | null, gs = g?.stats;
    const pigText = g && gs ? ` · pigeons ${gs.alive}/${g.capacity} (${gs.flocks} volées, ${(g.simMs + g.drawMs).toFixed(2)} ms)` : "";
    const tr = traffic as Traffic | null;
    const trafficText = tr ? ` · circulation ${tr.cars.length}/${tr.target} voitures (max ${tr.capacity}, ${tr.models.drawn} maillages, sim ${tr.simMs.toFixed(2)} ms)${tr.policeCount ? ` · police ${tr.policeCount} (${tr.chasing} en poursuite)` : ""}` : "";
    return ` · nav ${nav.graph.cells.size} cellules${trafficText}${d ? ` ${nav.graph.edgeCount} arêtes (${d.stats.edges} dessinées, ${d.stats.ms.toFixed(1)} ms)` : ""}${pedText}${pigText}`;
  };
  const meter = new FrameMeter(renderer, debugEl, () => ` · x ${player.x.toFixed(0)} y ${player.y.toFixed(0)} · ${(Math.abs(speedOf()) * 3.6).toFixed(1)} km/h · ${tiles.stats.loaded.length} tuiles · ${atmosphere.clock} · minimap ${miniCost()}${wantedInfo()}${navInfo()}`);

  const wantedInfo = (): string => (wanted.stars > 0 || wanted.pendingCalls > 0 ? ` · recherche ${wanted.stars}★${wanted.seen ? " vu" : ` fuite ${Math.round(wanted.escape * 100)} %`}${wanted.pendingCalls ? ` (${wanted.pendingCalls} appel)` : ""}` : "");
  /** Coût de la minimap (préparation et dessin) depuis le dernier affichage : moyenne et pire cas, en ms. */
  const miniCost = (): string => {
    const c = ui.minimap.cost;
    const text = c.calls ? `${(c.totalMs / c.calls).toFixed(2)} ms (max ${c.maxMs.toFixed(2)})` : "–";
    Object.assign(c, { calls: 0, totalMs: 0, maxMs: 0 });
    return text;
  };

  const actionEl = document.getElementById("action") as HTMLButtonElement;
  // Un repère par type de véhicule (les voitures, partout, masqueraient les vélos) : flèche et distance du plus proche.
  const chips = (["bike", "kickscooter", "moto", "car"] as const).map((kind) => {
    const el = document.createElement("div");
    el.className = "chip";
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "⬆";
    const text = document.createElement("span");
    el.append(arrow, text);
    document.getElementById("nearby")!.append(el);
    return { kind, el, arrow, text };
  });
  const gasEl = document.getElementById("gas")!;
  const hornEl = document.getElementById("horn")!;
  const speedo = new Speedo(document.getElementById("speedo")!);
  // Niveau de recherche (J4, D70) : la police ne voit encore personne (J4-4) ; `?wanted=N` impose un niveau de départ (essais, captures).
  const wanted = new Wanted();
  const wantedHud = new WantedHud(document.getElementById("wanted")!);
  if (params.has("wanted")) wanted.set(Number(params.get("wanted")) || 0, spawn.x, spawn.y);

  const mount = (v: Vehicle): void => {
    riding = v;
    leaving = false;
    rideModel = fleet.take(v);
    rideModel.group.add(model.group);
    model.group.visible = rideModel.pose !== "hidden";
    controls.mode = "drive";
    gasEl.textContent = familyOf(v).gas;
    hornEl.textContent = familyOf(v).horn;
    document.body.classList.add("driving");
    document.body.classList.toggle("car", v.spec.handbrake);
  };
  const dismount = (): void => {
    const v = riding!;
    const s = v.state;
    // Pied à terre du côté gauche (portière d'une voiture), hors des obstacles.
    const side = familyOf(v).dismount;
    const r = colliders.resolve(s.x - Math.cos(s.heading) * side, s.y + Math.sin(s.heading) * side, PLAYER_RADIUS);
    Object.assign(player, { x: r.x, y: r.y, z: terrain.heightAt(r.x, r.y), vx: 0, vy: 0, speed: 0, heading: s.heading });
    s.vx = s.vy = s.yawRate = s.steer = s.lean = 0;
    s.speed = 0;
    rideModel?.update(s);
    scene.add(model.group);
    model.group.visible = true;
    rideModel = null;
    fleet.park(v);
    riding = null;
    leaving = false;
    controls.mode = "foot";
    document.body.classList.remove("driving", "car");
  };
  // Vol avec conducteur (J4-1, D71) : une voiture de la circulation lente (feu rouge, file) à portée de la main peut être prise ;
  // elle devient un véhicule de la flotte, son conducteur sort côté gauche, trébuche et s'enfuit, et il appelle la police.
  let stolen = 0;
  const reachable = (): { fleet: Vehicle | null; traffic: string | null } => {
    const n = fleet.nearest(player.x, player.y);
    const near = n && n.distance < familyOf(n.vehicle).reach ? n : null;
    const t = (traffic as Traffic | null)?.nearest(player.x, player.y, FAMILIES.car.reach);
    const jack = !!t && t.speed < CARJACK_SPEED && (!near || t.distance < near.distance);
    return { fleet: jack ? null : (near?.vehicle ?? null), traffic: jack ? t.def.name : null };
  };
  const carjack = (): void => {
    const got = (traffic as Traffic | null)?.extract(player.x, player.y, FAMILIES.car.reach);
    if (!got) return;
    const v = fleet.add(got.model, `volee-${Date.now().toString(36)}-${++stolen}`, got.x, got.y, got.heading, got.variant, null);
    const s = v.state;
    s.vx = got.vx;
    s.vy = got.vy;
    s.yawRate = got.yawRate;
    s.speed = got.vx * Math.sin(got.heading) + got.vy * Math.cos(got.heading);
    // Portière du conducteur : à gauche (même côté que la descente du joueur) ; il est tiré vers l'extérieur et s'enfuit loin du joueur.
    const lx = -Math.cos(got.heading), ly = Math.sin(got.heading), side = FAMILIES.car.dismount;
    (peds as PedsController | null)?.eject(got.x + lx * side, got.y + ly * side, got.driver, lx, ly, 1.6, player.x, player.y);
    wanted.report("carjack", got.x, got.y, "civilian");
    mount(v);
  };
  const act = (): void => {
    if (riding) {
      if (Math.abs(riding.state.speed) < 1.2) dismount();
      else leaving = true;
      return;
    }
    const r = reachable();
    if (r.traffic) carjack();
    else if (r.fleet) mount(r.fleet);
  };
  actionEl.addEventListener("click", act);
  window.addEventListener("keydown", (e) => {
    // En pause (menu, carte, saisie d'une note), les touches ne commandent plus le jeu.
    if (document.body.classList.contains("paused")) return;
    if (e.code === "KeyF") debugEl.style.display = debugEl.style.display === "block" ? "none" : "block";
    if (e.code === "KeyE" && !e.repeat) act();
  });
  // ?ride=velo, trottinette, voiture ou moto, ou l'identifiant d'une entrée du catalogue (citadine, moto-routiere…) : départ sur un véhicule (captures, essais).
  const rideParam = params.get("ride") ?? "";
  const ride = vehicleDef(LEGACY_MODELS[rideParam] ?? rideParam)?.id;
  if (ride) mount(fleet.add(ride, "depart", spawn.x, spawn.y, startYaw, 1));
  else if (saved?.riding) {
    const v = fleet.get(saved.riding);
    if (v) mount(v);
  }

  // Traces de pneus derrière les roues bloquées ou qui glissent.
  const marks = new SkidMarks();
  scene.add(marks.mesh);
  const leaveMarks = (v: Vehicle): void => {
    const s = v.state, { track, width } = tyreOf(v);
    const fx = Math.sin(s.heading), fy = Math.cos(s.heading), rx = Math.cos(s.heading), ry = -Math.sin(s.heading);
    const sliding = s.skid > 0.6;
    for (const [axle, off, on] of [["av", v.spec.front, s.lockedFront || sliding], ["ar", -v.spec.rear, s.lockedRear || sliding]] as const) {
      for (const side of track > 0 ? [-1, 1] : [0]) {
        const x = s.x + fx * off + rx * track * side, y = s.y + fy * off + ry * track * side;
        marks.trail(`${v.id}-${axle}${side}`, x, y, terrain.heightAt(x, y), on, width);
      }
    }
  };

  let hudTimer = 0;
  let actionLabel = "";
  const updateHud = (): void => {
    let label = "";
    const r = riding ? null : reachable();
    if (riding) label = "Descendre";
    else if (r?.traffic) label = `Prendre 🚗 ${r.traffic}`;
    else if (r?.fleet) label = `Monter ${r.fleet.def.icon ?? familyOf(r.fleet).icon} ${r.fleet.def.name}`;
    if (label !== actionLabel) {
      actionLabel = label;
      actionEl.textContent = label;
      actionEl.classList.toggle("show", label !== "");
    }
    if (riding) return;
    for (const c of chips) {
      const k = fleet.nearest(player.x, player.y, c.kind);
      const show = !!k && k.distance >= FAMILIES[c.kind].reach && k.distance < 600;
      c.el.classList.toggle("show", show);
      if (!show) continue;
      const bearing = Math.atan2(k.vehicle.state.x - player.x, k.vehicle.state.y - player.y);
      c.arrow.style.transform = `rotate(${bearing - yaw}rad)`;
      c.text.textContent = `${FAMILIES[c.kind].icon} ${Math.round(k.distance)} m`;
    }
  };

  const facing = (): number => (riding ? riding.state.heading : player.heading);
  const ui = new UiBridge(ctx, controls, fleet, spawn.noSave ? null : new SaveStore(), () => ({
    x: player.x, y: player.y, z: player.z, facing: facing(), yaw, pitch, ridingId: riding ? riding.id : null,
  }), saved, {
    get: () => appearance,
    set: (r) => {
      appearance = r;
      model.setRecipe(r);
      appearanceStore.write(r);
    },
  });

  // Klaxon (front montant) et bousculade d'un passant à pied (ralentit un instant).
  let hornHeld = false;
  let bumpTimer = 0;
  let last = performance.now();
  let acc = 0;
  let pausedRender = 0;
  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const input = controls.poll();
    if (ui.paused) {
      // Pause : ni simulation ni horloge. Le chargement des tuiles continue, et l'image se rafraîchit à 4 Hz
      // (ou tout de suite quand un réglage change) : rien ne bouge, mais l'aperçu des réglages reste vrai.
      pausedRender += dt;
      tiles.update(player.x, player.y, 0, 0);
      terrainView.update(player.x, player.y);
      if (!ui.coversScreen && (pausedRender > 0.25 || ui.needsRender)) {
        pausedRender = 0;
        ui.needsRender = false;
        placeSun(player.x, player.y, player.z);
        renderer.render(scene, camera);
      }
      requestAnimationFrame(frame);
      return;
    }
    const hornPressed = input.horn && !hornHeld;
    hornHeld = input.horn;
    if (hornPressed && riding) (traffic as Traffic | null)?.playerHorn(riding.state.x, riding.state.y, riding.state.heading);
    bumpTimer = Math.max(0, bumpTimer - dt);
    yaw += input.lookYaw;
    pitch = Math.min(Math.max(pitch + input.lookPitch, MIN_PITCH), MAX_PITCH);

    acc += dt;
    while (acc >= STEP) {
      if (riding) {
        const drive = leaving ? { throttle: 0, brake: 1, steer: 0 } : { throttle: input.throttle, brake: input.brake, steer: input.steer, handbrake: input.handbrake };
        stepVehicle(riding.state, riding.spec, drive, STEP, terrain, colliders, riding.family === "car" ? fleet.carOnly : null);
        if (drive.throttle > 0 && rideModel?.pose === "pedal") crank += (Math.max(riding.state.speed, 0.8) / riding.spec.wheelRadius) * 0.45 * STEP;
      } else {
        const k = bumpTimer > 0 ? 0.7 : 1;
        stepPlayer(player, { forward: input.forward * k, right: input.right * k, run: input.run }, yaw, STEP, terrain, colliders);
      }
      (traffic as Traffic | null)?.step(STEP, riding ? { kind: "vehicle", state: riding.state, spec: riding.spec } : { kind: "foot", x: player.x, y: player.y, vx: player.vx, vy: player.vy });
      acc -= STEP;
    }
    (traffic as Traffic | null)?.setNight(atmosphere.night);
    (traffic as Traffic | null)?.update(dt, { x: player.x, y: player.y, yaw, speed: Math.abs(speedOf()), hour: atmosphere.hour, vehicle: riding ? { x: riding.state.x, y: riding.state.y } : null });
    if (riding) {
      const s = riding.state;
      if (leaving && Math.abs(s.speed) < 0.4) dismount();
      else {
        player.x = s.x;
        player.y = s.y;
        player.z = s.z;
        s.impact = 0;
        // Caméra de poursuite : se recale derrière le véhicule, sauf si l'on vient de regarder ailleurs.
        lookIdle = input.looking ? 0 : lookIdle + dt;
        if (lookIdle > 1.2) {
          const behind = s.heading + (s.speed < -0.3 ? Math.PI : 0);
          yaw += angleDelta(yaw, behind) * Math.min(1, dt * 2.5);
          pitch += (CHASE_PITCH - pitch) * Math.min(1, dt * 1.5);
        }
      }
    }

    // Caméra : la distance revient doucement quand l'obstacle disparaît, se resserre aussitôt à l'approche d'un mur.
    const speed = Math.abs(speedOf());
    const chase = riding ? chaseOf(riding) : null;
    const targetDist = chase ? (params.has("dist") ? distance : chase.distance) + speed * chase.perSpeed : distance;
    const focusZ = chase ? player.z + chase.height : player.z;
    const rig = solveCamera({ x: player.x, y: player.y, z: focusZ, yaw, pitch, distance: targetDist }, colliders, terrain);
    camDist = rig.distance < camDist ? rig.distance : Math.min(rig.distance, camDist + dt * 6);
    const k = rig.distance > 0 ? camDist / rig.distance : 1;
    const tz = focusZ + HEAD_HEIGHT;
    const cx = player.x + (rig.x - player.x) * k, cy = player.y + (rig.y - player.y) * k, cz = tz + (rig.z - tz) * k;
    camera.position.set(cx, cz, -cy);
    camera.lookAt(player.x, tz - 0.1, -player.y);
    const fov = 62 + Math.min(speed * 0.8, 8);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (riding && rideModel) {
      rideModel.update(riding.state);
      leaveMarks(riding);
      model.ride(rideModel, crank);
    } else {
      model.update(player.x, player.y, player.z, player.heading, player.stride, player.speed);
      model.group.visible = camDist > 0.9;
    }
    if (riding) speedo.set(riding.state.speed, riding.spec.topSpeed);
    fleet.cull(cx, cy);
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.2;
      updateHud();
    }

    // Les tuiles vers lesquelles on se dirige se chargent en premier.
    if (riding) tiles.update(player.x, player.y, riding.state.vx, riding.state.vy);
    else tiles.update(player.x, player.y, player.vx, player.vy);
    terrainView.update(player.x, player.y);
    const navNow = nav as NavManager | null, pedsNow = peds as PedsController | null, dbgNow = navDebug as NavDebug | null;
    if (navNow) {
      const vx = riding ? riding.state.vx : player.vx, vy = riding ? riding.state.vy : player.vy;
      navNow.update(player.x, player.y, vx, vy);
      dbgNow?.update(player.x, player.y);
      // Les passants jouent avec le temps du jeu : la pause fige tout (cette partie de la boucle n'est pas atteinte).
      const obs: Observer = {
        x: player.x, y: player.y, vx, vy, yaw, onFoot: !riding, hour: atmosphere.hour,
        vehicle: riding ? { x: player.x, y: player.y, vx, vy, heading: riding.state.heading, hull: riding.spec.hull, hornRange: familyOf(riding).hornRange } : null,
        horn: hornPressed && !!riding,
        ...(traffic ? { vehicles: (traffic as Traffic).bodies(), honks: (traffic as Traffic).takeHonks() } : {}),
      };
      (traffic as Traffic | null)?.setPeds(pedsNow);
      pedsNow?.update(dt, obs, camera.position.x, camera.position.z);
      (traffic as Traffic | null)?.applyImpacts();
      (pigeons as PigeonsController | null)?.update(dt, obs, pedsNow);
      // Effet des passants sur le joueur : un choc ralentit le véhicule (10 à 30 %, jamais plus de 50 % d'un coup) ; à pied, une bousculade ralentit un instant.
      const imp = pedsNow?.impact;
      if (imp && riding && imp.slow > 0) {
        const keep = 1 - imp.slow, s = riding.state;
        s.speed *= keep;
        s.vx *= keep;
        s.vy *= keep;
      } else if (imp && !riding && imp.bump > 0) bumpTimer = 0.3;
    }

    wanted.update(dt, player.x, player.y, false);
    wantedHud.set(wanted);
    if (signals) (signals as Signals).clock.t += dt;
    atmosphere.advance(dt);
    placeSun(player.x, player.y, player.z);
    sky.position.copy(camera.position);
    ui.tick(dt, now / 1000);

    renderer.render(scene, camera);
    meter.tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  ctx.ready({
    player, colliders, fleet, marks, ui, wanted,
    traffic: () => traffic as Traffic | null,
    riding: () => riding,
    peds: () => {
      const p = peds as PedsController | null;
      return p ? { capacity: p.capacity, stats: p.stats, simMs: p.simMs, drawMs: p.drawMs } : null;
    },
    pigeons: () => {
      const g = pigeons as PigeonsController | null;
      return g ? { capacity: g.capacity, stats: g.stats, simMs: g.simMs, drawMs: g.drawMs } : null;
    },
    camera: () => ({ x: camera.position.x, y: -camera.position.z, z: camera.position.y }),
  });
}
