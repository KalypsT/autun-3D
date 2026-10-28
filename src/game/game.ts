import * as THREE from "three";
import { HEAD_HEIGHT, solveCamera } from "../core/camera-rig";
import { createPlayer, PLAYER_RADIUS, stepPlayer } from "../core/player";
import { stepVehicle } from "../core/vehicle";
import { ALARM_SHOT, ALARM_SHOT_FLEE, type Observer } from "../core/pedestrians";
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
import { DEATH_HOURS, Health, HOSPITAL_SPAWN } from "../core/health";
import { HealthHud } from "../ui/health-hud";
import { Inventory, WEAPON_ORDER, WEAPONS, type AttackStyle, type GunId, type WeaponId } from "../core/weapons";
import { Gun, MUZZLE, type ShootWorld } from "../core/gun";
import { CACHE_ROUNDS, PICKUP_REACH, Pickups } from "../core/pickups";
import { Fx, type PickupView } from "../render/fx";
import { Melee } from "../core/melee";
import { WeaponHud } from "../ui/weapon-hud";
import { ARREST_HOURS, ARREST_SPAWN, PoliceController } from "./police";
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
import { AudioSystem } from "../audio/audio-system";
import { stepCrossed } from "../core/sound-model";
import { GameAudio, type TrafficVisit } from "./game-audio";
import { CameraShake, Haptics, speedFov, speedLines } from "../core/feel";
import { VehicleLights } from "../render/vehicle-lights";

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
    document.getElementById("attack"),
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
  // Sons (J7, D89) : rien ne joue avant le premier geste (règle des navigateurs) ; `?sound=0` les coupe.
  const audioSys = new AudioSystem(settings.values.volume);
  const audio = new GameAudio(audioSys);
  // Ressenti (D90) : vibrations du téléphone, tremblement de la caméra.
  const haptics = new Haptics(typeof navigator.vibrate === "function" ? (p) => void navigator.vibrate(p) : null);
  haptics.enabled = settings.values.vibration;
  const shake = new CameraShake();
  settings.listeners.push((v, changed) => {
    controls.sensitivity = v.sensitivity;
    if (changed.includes("volume")) audioSys.setVolume(v.volume);
    if (changed.includes("vibration")) haptics.enabled = v.vibration;
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
  /** Feux du véhicule conduit (D90). */
  let lights: VehicleLights | null = null;
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
    if (!pigeons) {
      pigeons = new PigeonsController(scene, startNav(), terrain, colliders, pg, 7);
      pigeons.onScatter = (x, y) => audio.scatter(x, y);
    } else pigeons.setCapacity(pg);
  };
  /** La foule, même vide (« Foule : Aucune ») : les gendarmes à pied y sont dessinés (J4-5). */
  const needPeds = (): PedsController => {
    if (!peds) {
      peds = new PedsController(scene, startNav(), terrain, colliders, 0, 7);
      peds.setSignals(signals);
      peds.setShadows(ctx.settings!.values.shadows !== 0);
    }
    return peds;
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
  // La circulation pour la police (J4) : créée au besoin, même avec « Circulation : Aucune » (elle n'a alors que des voitures de police).
  const needTraffic = (create: boolean): Traffic | null => {
    if (!traffic && create) traffic = new Traffic(scene, startNav(), terrain, colliders, (x, y) => tiles.solidAt(x, y), Math.max(0, settings.values.traffic), startSignals(), 11);
    return traffic as Traffic | null;
  };
  const navInfo = (): string => {
    if (!nav) return "";
    const p = peds as PedsController | null, d = navDebug as NavDebug | null, st = p?.stats;
    const pedText = p && st ? ` · passants ${st.alive}/${st.target} (max ${p.capacity})${st.corpses ? `, ${st.corpses} cadavres` : ""} sim ${p.simMs.toFixed(2)} ms dessin ${p.drawMs.toFixed(2)} ms` : "";
    const g = pigeons as PigeonsController | null, gs = g?.stats;
    const pigText = g && gs ? ` · pigeons ${gs.alive}/${g.capacity} (${gs.flocks} volées, ${(g.simMs + g.drawMs).toFixed(2)} ms)` : "";
    const tr = traffic as Traffic | null;
    const trafficText = tr ? ` · circulation ${tr.cars.length}/${tr.target} voitures (max ${tr.capacity}, ${tr.models.drawn} maillages, sim ${tr.simMs.toFixed(2)} ms)${tr.policeCount ? ` · police ${tr.policeCount} (${tr.chasing} en poursuite)` : ""}` : "";
    return ` · nav ${nav.graph.cells.size} cellules${trafficText}${d ? ` ${nav.graph.edgeCount} arêtes (${d.stats.edges} dessinées, ${d.stats.ms.toFixed(1)} ms)` : ""}${pedText}${pigText}`;
  };
  const meter = new FrameMeter(renderer, debugEl, () => ` · x ${player.x.toFixed(0)} y ${player.y.toFixed(0)} · ${(Math.abs(speedOf()) * 3.6).toFixed(1)} km/h · ${tiles.stats.loaded.length} tuiles · ${atmosphere.clock} · minimap ${miniCost()}${wantedInfo()}${navInfo()} · ${audio.info}`);

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
  // Repère de l'arme au sol disponible la plus proche (J5-3) : flèche et distance, comme les véhicules.
  const pkChip = (() => {
    const el = document.createElement("div");
    el.className = "chip";
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "⬆";
    const text = document.createElement("span");
    el.append(arrow, text);
    document.getElementById("nearby")!.append(el);
    return { el, arrow, text };
  })();
  const gasEl = document.getElementById("gas")!;
  const hornEl = document.getElementById("horn")!;
  const speedo = new Speedo(document.getElementById("speedo")!);
  // Niveau de recherche (J4, D70) : la police ne voit encore personne (J4-4) ; `?wanted=N` impose un niveau de départ (essais, captures).
  const wanted = new Wanted();
  const wantedHud = new WantedHud(document.getElementById("wanted")!);
  const police = new PoliceController(wanted, colliders, () => (nav as NavManager | null)?.graph.road ?? null, () => signals as Signals | null, needTraffic);
  police.minPursuers = chaseParam;
  // Santé (J5-0, D80) : reprise de la sauvegarde ; `?hurt=N` impose N points de vie (0 : mort au départ, essais et captures).
  const health = new Health(params.has("hurt") ? Number(params.get("hurt")) || 0 : (saved?.health ?? undefined));
  const healthHud = new HealthHud(document.getElementById("health")!);
  const hurtEl = document.getElementById("hurt")!;
  // Armes (J5, D80) : les poings sont toujours là ; reprise de la sauvegarde ; `?arms=knife,bat,pistol` (ou `all`) en donne pour les essais ; on en trouve dans les caches de la ville (D84).
  const inventory = new Inventory();
  if (saved) inventory.restore(saved.arms);
  const melee = new Melee();
  const gun = new Gun(0x51f7);
  const pickups = new Pickups();
  const armsParam = params.get("arms");
  if (armsParam) for (const id of armsParam === "all" ? WEAPON_ORDER : armsParam.split(",")) if (id in WEAPONS) inventory.grant(id as WeaponId, (CACHE_ROUNDS[id as WeaponId] ?? 0) * 2);
  const weaponHud = new WeaponHud(document.getElementById("weapon")!, document.getElementById("attack"), () => {
    inventory.cycle();
    melee.cancel();
    gun.cancel();
  });
  // Rechargement demandé au clavier (R), pris en compte à l'image suivante.
  let reloadAsked = false;
  let heldId: WeaponId | null = null;
  let aimW = 0;
  const pedWitnesses: number[] = [];
  if (params.has("wanted")) wanted.set(Number(params.get("wanted")) || 0, spawn.x, spawn.y);

  const mount = (v: Vehicle): void => {
    riding = v;
    leaving = false;
    rideModel = fleet.take(v);
    rideModel.group.add(model.group);
    lights = new VehicleLights(v.def);
    rideModel.group.add(lights.group);
    model.group.visible = rideModel.pose !== "hidden";
    controls.mode = "drive";
    gasEl.textContent = familyOf(v).gas;
    hornEl.textContent = familyOf(v).horn;
    document.body.classList.add("driving");
    document.body.classList.toggle("car", v.spec.handbrake);
    audio.setRide({ id: v.def.id, family: v.family, spec: v.spec });
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
    lights?.dispose();
    lights = null;
    scene.add(model.group);
    model.group.visible = true;
    rideModel = null;
    fleet.park(v);
    riding = null;
    leaving = false;
    controls.mode = "foot";
    document.body.classList.remove("driving", "car");
    audio.setRide(null);
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
    police.crime("carjack", got.x, got.y, true);
    mount(v);
  };
  const act = (): void => {
    if (riding) {
      if (Math.abs(riding.state.speed) < 1.2) dismount();
      else leaving = true;
      return;
    }
    // Une arme au sol à portée de main passe avant un véhicule.
    const pk = pickups.nearest(player.x, player.y, PICKUP_REACH);
    if (pk && pickups.canTake(pk, inventory)) {
      const fresh = !inventory.has(pk.weapon);
      pickups.take(pk, inventory);
      audio.pickup();
      if (fresh) inventory.select(pk.weapon);
      return;
    }
    const r = reachable();
    if (r.traffic) carjack();
    else if (r.fleet) {
      // Prendre un véhicule garé n'est une infraction que sous les yeux de la police (D70).
      if (r.fleet.home) police.crime("theft", player.x, player.y, false);
      mount(r.fleet);
    }
  };
  actionEl.addEventListener("click", act);
  window.addEventListener("keydown", (e) => {
    // En pause (menu, carte, saisie d'une note), les touches ne commandent plus le jeu.
    if (document.body.classList.contains("paused")) return;
    if (e.code === "KeyF") debugEl.style.display = debugEl.style.display === "block" ? "none" : "block";
    if (e.code === "KeyE" && !e.repeat) act();
    if (e.code === "KeyX" && !e.repeat) inventory.cycle();
    if (e.code === "KeyR" && !e.repeat) reloadAsked = true;
    if (e.code.startsWith("Digit") && !e.repeat) {
      const id = WEAPON_ORDER[Number(e.code.slice(5)) - 1];
      if (id) inventory.select(id);
    }
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
        marks.trail(`${v.id}-${axle}${side}`, x, y, terrain.heightAt(x, y, s.z), on, width);
      }
    }
  };

  // Effets de tir et armes au sol (un seul maillage instancié), monde du tir, réticule de la visée assistée.
  const fx = new Fx(scene);
  const pickViews: PickupView[] = [];
  const reticleEl = document.getElementById("reticle")!;
  const reticleV = new THREE.Vector3();
  const shootWorld: ShootWorld = {
    pick: (x, y, h, r, a, m, out) => {
      const p = peds as PedsController | null;
      if (!p) {
        out.length = 0;
        return 0;
      }
      return p.pick(x, y, h, r, a, m, out);
    },
    position: (slot, out) => (peds as PedsController | null)?.position(slot, out),
    hurt: (slot, d, ux, uy, i) => (peds as PedsController | null)?.hurt(slot, d, ux, uy, i) ?? 0,
    rayPed: (x, y, dx, dy, m, out) => {
      const p = peds as PedsController | null;
      if (!p) {
        out.slot = -1;
        out.dist = m;
        return false;
      }
      return p.rayPed(x, y, dx, dy, m, out);
    },
    wall: (ax, ay, bx, by) => colliders.raycast(ax, ay, bx, by),
  };
  const drops: { x: number; y: number }[] = [];
  let hudTimer = 0;
  let actionLabel = "";
  const updateHud = (): void => {
    let label = "";
    const r = riding ? null : reachable();
    const pk = riding ? null : pickups.nearest(player.x, player.y, PICKUP_REACH);
    if (pk && pickups.canTake(pk, inventory)) label = `Ramasser ${WEAPONS[pk.weapon].icon} ${WEAPONS[pk.weapon].name}`;
    else if (riding) label = "Descendre";
    else if (r?.traffic) label = `Prendre 🚗 ${r.traffic}`;
    else if (r?.fleet) label = `Monter ${r.fleet.def.icon ?? familyOf(r.fleet).icon} ${r.fleet.def.name}`;
    if (label !== actionLabel) {
      actionLabel = label;
      actionEl.textContent = label;
      actionEl.classList.toggle("show", label !== "");
    }
    if (riding) return;
    let near: { x: number; y: number; weapon: WeaponId } | null = null, nd = 500;
    for (const pk of pickups.list) {
      const d = Math.hypot(pk.x - player.x, pk.y - player.y);
      if (pickups.available(pk) && pickups.canTake(pk, inventory) && d < nd) {
        nd = d;
        near = pk;
      }
    }
    pkChip.el.classList.toggle("show", !!near && nd >= PICKUP_REACH);
    if (near && nd >= PICKUP_REACH) {
      pkChip.arrow.style.transform = `rotate(${Math.atan2(near.x - player.x, near.y - player.y) - yaw}rad)`;
      pkChip.text.textContent = `${WEAPONS[near.weapon].icon} ${Math.round(nd)} m`;
    }
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
    x: player.x, y: player.y, z: player.z, facing: facing(), yaw, pitch, ridingId: riding ? riding.id : null, health: health.hp, arms: inventory.toSave(),
  }), saved, {
    get: () => appearance,
    set: (r) => {
      appearance = r;
      model.setRecipe(r);
      appearanceStore.write(r);
    },
  });

  ui.police = police.minimap;

  // Arrestation (J4-5, D75) : le véhicule conduit est confisqué, on repart à pied au bord est de l'anneau, six heures plus tard, sans étoile.
  const busted = document.getElementById("busted")!;
  const banner = (title: string, sub: string, dead: boolean): void => {
    busted.querySelector(".b-title")!.textContent = title;
    busted.querySelector(".b-sub")!.textContent = sub;
    busted.classList.toggle("dead", dead);
    busted.classList.remove("show");
    void busted.offsetWidth;
    busted.classList.add("show");
  };
  const arrest = (): void => {
    const taken = riding;
    if (taken) {
      dismount();
      fleet.remove(taken);
    }
    police.reset();
    lastStars = 0;
    audio.arrest();
    haptics.arrest();
    inventory.loseAll();
    melee.cancel();
    gun.cancel();
    const r = colliders.resolve(ARREST_SPAWN.x, ARREST_SPAWN.y, PLAYER_RADIUS);
    Object.assign(player, { x: r.x, y: r.y, z: terrain.heightAt(r.x, r.y), vx: 0, vy: 0, speed: 0, heading: ARREST_SPAWN.heading });
    yaw = ARREST_SPAWN.heading;
    if (atmosphere.speed > 0) atmosphere.advance(ARREST_HOURS / atmosphere.speed);
    banner(appearance.sex === "f" ? "Arrêtée" : "Arrêté", `${ARREST_HOURS} heures en cellule${taken ? ", véhicule confisqué" : ""}. Reprise à la sortie de la gendarmerie.`, false);
    controls.reset();
    ui.save();
  };

  // Mort (J5-0, D80) : le véhicule conduit reste où il était, on se réveille à l'hôpital trois heures plus tard, santé pleine, sans étoile.
  const die = (): void => {
    if (riding) dismount();
    police.reset();
    lastStars = 0;
    audio.death();
    haptics.death();
    inventory.loseAll();
    melee.cancel();
    gun.cancel();
    const r = colliders.resolve(HOSPITAL_SPAWN.x, HOSPITAL_SPAWN.y, PLAYER_RADIUS);
    Object.assign(player, { x: r.x, y: r.y, z: terrain.heightAt(r.x, r.y), vx: 0, vy: 0, speed: 0, heading: HOSPITAL_SPAWN.heading });
    yaw = HOSPITAL_SPAWN.heading;
    if (atmosphere.speed > 0) atmosphere.advance(DEATH_HOURS / atmosphere.speed);
    health.restore();
    banner(appearance.sex === "f" ? "Morte" : "Mort", `Réveil à l'hôpital, ${DEATH_HOURS} heures plus tard.`, true);
    controls.reset();
    ui.save();
  };

  // Sons : dernière phase de marche (pas), dernier niveau de recherche, circulation à parcourir.
  let lastPhase = model.phase;
  let lastStars = wanted.stars;
  const eachCar = (visit: TrafficVisit): void => (traffic as Traffic | null)?.forEachSound(visit);
  const speedLinesEl = document.getElementById("speedlines")!;
  let speedLinesOn = false;
  // Klaxon (front montant) et bousculade d'un passant à pied (ralentit un instant).
  let hornHeld = false;
  let bumpTimer = 0;
  let last = performance.now();
  let acc = 0;
  let pausedRender = 0;
  const frame = (now: number): void => {
    // Jamais négatif : l'horodatage de la première image peut précéder `last` (initialisation longue) ; un pas négatif faisait grimper la progression de l'arrestation sans gendarme (trouvé en J5-0).
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
    last = now;
    const input = controls.poll();
    audioSys.setPaused(ui.paused);
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
    audio.horn(input.horn && !!riding);
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
        // Un coup en cours ralentit : on ne court pas en frappant.
        const k = (bumpTimer > 0 ? 0.7 : 1) * (melee.active ? 0.45 : gun.idle < 0.35 ? 0.6 : 1);
        stepPlayer(player, { forward: input.forward * k, right: input.right * k, run: input.run && !melee.active && gun.idle > 0.35 }, yaw, STEP, terrain, colliders);
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
        audio.impact(s.impact);
        audio.drive(dt, s, leaving ? 0 : input.throttle, leaving ? 1 : input.brake);
        haptics.crash(s.impact);
        if (s.impact >= 1.2) shake.impact(s.impact);
        lights?.update(atmosphere.night, (leaving || input.brake > 0.05) && s.speed > 0.5, s.speed < -0.3);
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
    // Sensation de vitesse (D90) : tremblement (vers la droite de l'écran et vers le haut), champ de vision qui s'ouvre, traits au-delà de 100 km/h.
    haptics.step(dt);
    shake.step(dt, riding ? speed : 0);
    const sx = shake.offset.x, sy = shake.offset.y;
    camera.position.set(cx + Math.cos(yaw) * sx, cz + sy, -(cy - Math.sin(yaw) * sx));
    camera.lookAt(player.x, tz - 0.1, -player.y);
    audio.listen(cx, cy, yaw, riding ? riding.state.vx : player.vx, riding ? riding.state.vy : player.vy);
    const fov = camera.fov + (speedFov(speed, !!riding) - camera.fov) * Math.min(1, dt * 3);
    if (Math.abs(camera.fov - fov) > 0.02) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const lines = riding ? speedLines(speed) : 0;
    if (lines > 0.01 || speedLinesOn) {
      speedLinesOn = lines > 0.01;
      speedLinesEl.style.display = speedLinesOn ? "block" : "none";
      // Les rayons tournent un peu à chaque image : ils défilent au lieu de rester figés.
      speedLinesEl.style.opacity = (Math.min(1, lines * 1.6) * 0.85).toFixed(2);
      speedLinesEl.style.transform = `rotate(${(Math.random() * 6).toFixed(1)}deg)`;
    }

    // Combat (J5) : à pied seulement. Mêlée : le coup tourne le joueur vers sa cible et touche à la frappe (J5-1). Arme à feu : tir instantané, visée assistée (J5-3).
    const weapon = inventory.current;
    const pedsNow0 = peds as PedsController | null;
    if (pedsNow0 && !pedsNow0.officerHurt) pedsNow0.officerHurt = (i, d, ux, uy, imp) => police.officers.hurt(i, d, ux, uy, imp);
    // Violence (J5-4) : frapper est une agression, tuer un meurtre ; la police l'ajoute si elle voit, sinon un passant vivant à moins de 25 m téléphone.
    const violence = (hits: number, killed: number): void => {
      if (hits <= 0) return;
      pedWitnesses.length = 0;
      police.crime(killed > 0 ? "murder" : "assault", player.x, player.y, (pedsNow0?.queryCircle(player.x, player.y, 25, pedWitnesses) ?? 0) > 0);
    };
    let reticle: { x: number; y: number; z: number } | null = null;
    if (riding || health.dead) {
      melee.cancel();
      gun.cancel();
      model.setStrike(null);
    } else if (weapon.kind === "melee") {
      gun.cancel();
      const res = melee.step(dt, input.attack, weapon, player.x, player.y, player.heading, pedsNow0);
      if (res.started && weapon.style !== "aim") audio.swing(weapon.style as AttackStyle);
      if (res.hits > 0) {
        audio.meleeHit(weapon.id);
        haptics.hit();
      }
      violence(res.hits, res.killed);
      if (melee.active && melee.facing !== null) player.heading += angleDelta(player.heading, melee.facing) * Math.min(1, 18 * dt);
      model.setStrike(melee.active && weapon.style !== "aim" ? { style: weapon.style, u: melee.progress, hitAt: weapon.hitAt, side: melee.side } : null);
    } else {
      melee.cancel();
      model.setStrike(null);
      const res = gun.step(dt, input.attack, reloadAsked, weapon, inventory, player.x, player.y, yaw, shootWorld);
      reloadAsked = false;
      if (res.dry) audio.dry();
      if (res.reloadStarted) audio.reload(false);
      if (res.reloadDone) audio.reload(true);
      if (input.attack || gun.aim > 0) player.heading += angleDelta(player.heading, gun.facing) * Math.min(1, 18 * dt);
      if (gun.targeted && pedsNow0) {
        const tp = { x: 0, y: 0 };
        pedsNow0.position(gun.target, tp);
        reticle = { x: tp.x, y: tp.y, z: terrain.heightAt(tp.x, tp.y) + 1.1 };
      }
      if (res.fired > 0) {
        // Traits, éclair de bouche et étincelles (un seul maillage, D84) ; le coup de feu effraie tout dans 40 m et la police l'entend si elle voit.
        const z0 = player.z + 1.3;
        const mx = player.x + Math.sin(gun.facing) * MUZZLE, my = player.y + Math.cos(gun.facing) * MUZZLE;
        fx.flash(mx, my, z0);
        audio.shot(weapon.id as GunId, mx, my, true);
        haptics.shot(weapon.id as GunId);
        for (let k = 0; k < res.fxCount; k++) {
          const sh = res.shots[k]!;
          const z1 = sh.kind === 2 ? terrain.heightAt(sh.x1, sh.y1) + 1.1 : z0;
          fx.tracer(sh.x0, sh.y0, z0, sh.x1, sh.y1, z1);
          if (sh.kind > 0) fx.sparks(sh.x1, sh.y1, z1, sh.kind === 2, Math.random);
        }
        pedsNow0?.alarm(player.x, player.y, ALARM_SHOT, ALARM_SHOT_FLEE);
        pedWitnesses.length = 0;
        police.crime("gunfire", player.x, player.y, (pedsNow0?.queryCircle(player.x, player.y, ALARM_SHOT, pedWitnesses) ?? 0) > 0);
        violence(res.hits, res.killed);
      }
    }
    // Position de tir : fondu de la garde à la visée, secousse du tir. Arme blanche : garde ; mains nues : rien.
    aimW += ((gun.aim > 0 || input.attack ? 1 : 0) - aimW) * Math.min(1, dt * 10);
    if (weapon.kind === "gun") {
      heldId = null;
      model.setGun(weapon.part, weapon.id as GunId, aimW, gun.recoil);
    } else if (heldId !== weapon.id) {
      heldId = weapon.id;
      model.setHeld(weapon.part, weapon.part && weapon.style !== "aim" ? weapon.style : null);
    }
    weaponHud.set(weapon, weapon.kind === "gun" ? { mag: inventory.magOf(weapon.id), reserve: inventory.reserveOf(weapon.id), reloading: gun.reloading > 0 } : null);
    // Réticule sur la cible assistée (un point de l'écran) ; armes au sol et effets : mis à jour à chaque image.
    if (reticle) {
      reticleV.set(reticle.x, reticle.z, -reticle.y).project(camera);
      reticleEl.style.display = reticleV.z < 1 ? "block" : "none";
      reticleEl.style.left = `${((reticleV.x + 1) / 2) * window.innerWidth}px`;
      reticleEl.style.top = `${((1 - reticleV.y) / 2) * window.innerHeight}px`;
    } else reticleEl.style.display = "none";
    pickups.update(dt);
    pickViews.length = 0;
    for (const pk of pickups.list) {
      if (!pickups.available(pk) || Math.hypot(pk.x - player.x, pk.y - player.y) > 90) continue;
      pickViews.push({ x: pk.x, y: pk.y, z: terrain.heightAt(pk.x, pk.y), weapon: pk.weapon });
    }
    fx.update(dt, pickViews, pickups.time);
    ui.caches.length = 0;
    for (const pk of pickups.list) if (pickups.available(pk) && Math.hypot(pk.x - player.x, pk.y - player.y) < 250) ui.caches.push(pk);
    if (riding && rideModel) {
      rideModel.update(riding.state);
      leaveMarks(riding);
      model.ride(rideModel, crank);
    } else {
      model.update(player.x, player.y, player.z, player.heading, player.stride, player.speed);
      model.group.visible = camDist > 0.9;
      if (stepCrossed(lastPhase, model.phase) && player.speed > 0.3) audio.footstep(player.speed > 3);
      lastPhase = model.phase;
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
      for (const h of obs.honks ?? []) audio.honk(h.x, h.y);
      (traffic as Traffic | null)?.setPeds(pedsNow);
      pedsNow?.update(dt, obs, camera.position.x, camera.position.z);
      if (pedsNow) audio.pedEvents(pedsNow.events);
      (traffic as Traffic | null)?.applyImpacts();
      (pigeons as PigeonsController | null)?.update(dt, obs, pedsNow);
      // Effet des passants sur le joueur : un choc ralentit le véhicule (10 à 30 %, jamais plus de 50 % d'un coup) ; à pied, une bousculade ralentit un instant.
      const imp = pedsNow?.impact;
      if (imp && riding && imp.hits > 0) {
        haptics.hit();
        shake.impact(Math.min(imp.speed, 6));
      }
      if (imp && riding && imp.slow > 0) {
        const keep = 1 - imp.slow, s = riding.state;
        s.speed *= keep;
        s.vx *= keep;
        s.vy *= keep;
      } else if (imp && !riding && imp.bump > 0) bumpTimer = 0.3;
    }

    {
      const imp = (peds as PedsController | null)?.impact;
      const s = riding?.state;
      police.update(dt, {
        x: player.x, y: player.y, vx: s ? s.vx : player.vx, vy: s ? s.vy : player.vy, heading: s ? s.heading : player.heading, speed: Math.abs(speedOf()), driving: !!riding,
        vehicle: riding ? { state: riding.state, spec: riding.spec } : null,
        pedHits: riding && imp ? imp.hits : 0, pedHitSpeed: imp ? imp.speed : 0, pedKills: riding && imp ? imp.kills : 0,
        witnesses: (x, y, r) => {
          pedWitnesses.length = 0;
          return (peds as PedsController | null)?.queryCircle(x, y, r, pedWitnesses) ?? 0;
        },
      });
    }
    // Police armée (J5-5, D85) : les balles qui portent retirent des points de vie (la moitié au volant) ; traits et éclairs de la police, passants effrayés ;
    // le pistolet d'un gendarme tué tombe à terre (on peut le ramasser).
    {
      const dmg = police.takeDamage();
      if (dmg > 0 && !health.dead) health.damage(dmg * (riding ? 0.5 : 1));
      if (police.shots.length > 0) {
        for (let i = 0; i < police.shots.length && i < 4; i++) {
          const sh = police.shots[i]!;
          audio.shot("pistol", sh.x0, sh.y0, false);
          if (!sh.hit) audio.nearMiss(sh.x0, sh.y0, sh.x1, sh.y1, player.x, player.y);
        }
        for (const sh of police.shots) {
          const z0 = terrain.heightAt(sh.x0, sh.y0) + 1.3;
          fx.flash(sh.x0, sh.y0, z0);
          fx.tracer(sh.x0, sh.y0, z0, sh.x1, sh.y1, sh.hit ? player.z + 1.1 : z0);
          if (sh.hit) fx.sparks(sh.x1, sh.y1, player.z + 1.1, true, Math.random);
        }
        (peds as PedsController | null)?.alarm(police.shots[0]!.x0, police.shots[0]!.y0, ALARM_SHOT, ALARM_SHOT_FLEE);
        police.clearShots();
      }
      drops.length = 0;
      police.takeDrops(drops);
      for (const d of drops) pickups.drop(d.x, d.y, "pistol", CACHE_ROUNDS.pistol! / 2);
    }
    // Gendarmes à pied : dessinés par la foule (emplacements réservés, aucun appel de dessin de plus) ; la foule est créée au besoin.
    if (police.officers.list.length > 0 || peds) needPeds().setOfficers(police.officers.list, dt);
    if (police.takeArrest()) arrest();
    health.update(dt);
    if (health.takeDeath()) die();
    if (health.takeHurt() > 0) {
      audio.hurt();
      haptics.hurt();
      hurtEl.classList.add("flash");
      void hurtEl.offsetWidth;
      hurtEl.classList.remove("flash");
    }
    healthHud.set(health.hp);
    wantedHud.set(wanted);
    if (wanted.stars !== lastStars) {
      audio.stars(wanted.stars, lastStars);
      lastStars = wanted.stars;
    }
    audio.traffic(dt, eachCar);
    audio.update(dt, atmosphere.hour, atmosphere.day);
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
    player, colliders, fleet, marks, ui, wanted, health, inventory, melee, gun, pickups, fx, renderer,
    /** Captures et mesures : redessine la scène telle quelle. */
    renderOnce: () => renderer.render(scene, camera),
    traffic: () => traffic as Traffic | null,
    police,
    /** Essais et captures : les passants (voir `PedsController`). */
    pedsController: () => peds as PedsController | null,
    /** Captures : tourner la caméra (rad, 0 = nord). */
    look: (v: number) => {
      yaw = v;
    },
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
    /** Essais : état du son (contexte, voix). */
    sound: () => ({ state: audioSys.ctx?.state ?? "aucun", info: audio.info }),
  });
}
