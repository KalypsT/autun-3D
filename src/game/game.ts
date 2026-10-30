import * as THREE from "three";
import { HEAD_HEIGHT, solveCamera } from "../core/camera-rig";
import { createPlayer, groundPlayer, PLAYER_RADIUS, slidePlayer, stepPlayer } from "../core/player";
import { contactAngle, FALLEN_LEAN, landWheelie, rampThrottle, stepVehicle } from "../core/vehicle";
import { DAMAGE, ZONES, type DamageTier } from "../core/damage";
import { GarageStop } from "../core/garages";
import { onDuty, UNIQUE, UniqueKeeper, UNIQUES } from "../core/uniques";
import { chimneyOf, vendorOf } from "../render/car-model";
import { applyAppearance, recipeFromSeed, WHITE } from "../core/character";
import { blastShare, EXPLOSION, wreckStage } from "../core/explosion";
import { rayHull } from "../core/vehicle-contact";
import { Smoke } from "../render/smoke";
import { DOWN_TIME } from "../core/character-rig";
import { StuntMeter } from "../core/stunt";
import { ALARM_SHOT, ALARM_SHOT_FLEE, type Observer, type TrafficBody } from "../core/pedestrians";
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
import { VehicleNameHud } from "../ui/vehicle-name";
import { DEATH_HOURS, dropDamage, fallDamage, Health, HOSPITAL_SPAWN } from "../core/health";
import { HealthHud } from "../ui/health-hud";
import { Inventory, WEAPON_ORDER, WEAPONS, type AttackStyle, type GunId, type WeaponId } from "../core/weapons";
import { Gun, MUZZLE, type ShootWorld } from "../core/gun";
import { CACHE_ROUNDS, PICKUP_REACH, Pickups } from "../core/pickups";
import { Fx, type PickupView } from "../render/fx";
import { Melee } from "../core/melee";
import { WeaponHud } from "../ui/weapon-hud";
import { icon, vehicleIcon, weaponIcon } from "../ui/icons";
import { ARREST_HOURS, ARREST_SPAWN, PoliceController } from "./police";
import type { VehicleModel } from "../render/vehicle-model";
import { gameSpawn } from "./start";
import { NavDebug } from "../render/nav-debug";
import { NavManager } from "./nav-manager";
import { PedsController } from "./peds-controller";
import { Signals } from "../core/signals";
import { Traffic, type Abandoned } from "./traffic";
import { PigeonsController } from "./pigeons-controller";
import { UiBridge } from "./ui-bridge";
import { Fleet, chaseOf, drivenSpec, familyOf, smokeOrigin, tyreOf, type Vehicle } from "./vehicles";
import { FAMILIES, LEGACY_MODELS, vehicleDef } from "../core/vehicle-catalog";
import { AudioSystem } from "../audio/audio-system";
import { stepCrossed } from "../core/sound-model";
import { GameAudio, type TrafficVisit } from "./game-audio";
import { CameraShake, Haptics, speedFov, speedLines } from "../core/feel";
import { VehicleLights } from "../render/vehicle-lights";
import { TouristTrain, TRAIN_CLEAR, type TrainEnv } from "./tourist-train";

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
  // Aucune voiture garée sur la place d'un véhicule unique (D115 : la rôtisserie est au milieu du parking du Champ de Mars).
  for (const spot of UNIQUES) {
    const def = vehicleDef(spot.model);
    if (def) fleet.keepClear(spot.x, spot.y, def.size.length / 2 + 1.5);
  }
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
    document.getElementById("jump"),
  );
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
  // Plein écran (et paysage) au premier appui sur le jeu, et de nouveau après en être sorti ; il faut un geste, d'où l'écoute des appuis.
  const enterFullscreen = (): void => {
    if (!settings.values.fullscreen || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen().then(async () => {
      try {
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
      } catch {
        /* le verrouillage d'orientation n'existe pas partout */
      }
    }, () => {
      /* refusé (navigateur, réglage du téléphone) : on réessaiera au prochain appui */
    });
  };
  document.getElementById("touch")?.addEventListener("pointerdown", enterFullscreen);
  settings.listeners.push((v, changed) => {
    controls.sensitivity = v.sensitivity;
    // Le changement vient d'un appui dans le menu : c'est un geste, le plein écran peut s'ouvrir ou se fermer tout de suite.
    if (changed.includes("fullscreen")) {
      if (v.fullscreen) enterFullscreen();
      else if (document.fullscreenElement) void document.exitFullscreen();
    }
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
  /** Tombé d'un deux-roues (D98) : temps restant au sol (s) et sens de la chute (+1 sur le dos, −1 en avant). */
  let downFor = 0;
  let downSide = -1;
  /** Roue arrière et roue avant : distance sur une roue, affichée au-dessus du compteur de vitesse. */
  const stunt = new StuntMeter();
  const stuntEl = document.getElementById("stunt");
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
  const meter = new FrameMeter(renderer, debugEl, () => ` · x ${player.x.toFixed(0)} y ${player.y.toFixed(0)} · ${(Math.abs(speedOf()) * 3.6).toFixed(1)} km/h · ${tiles.stats.loaded.length} tuiles · ${atmosphere.clock} · minimap ${miniCost()}${wantedInfo()}${navInfo()}${damageInfo()} · ${audio.info}`);

  const wantedInfo = (): string => (wanted.stars > 0 || wanted.pendingCalls > 0 ? ` · recherche ${wanted.stars}★${wanted.seen ? " vu" : ` fuite ${Math.round(wanted.escape * 100)} %`}${wanted.pendingCalls ? ` (${wanted.pendingCalls} appel)` : ""}` : "");
  /** Coût de la minimap (préparation et dessin) depuis le dernier affichage : moyenne et pire cas, en ms. */
  const miniCost = (): string => {
    const c = ui.minimap.cost;
    const text = c.calls ? `${(c.totalMs / c.calls).toFixed(2)} ms (max ${c.maxMs.toFixed(2)})` : "–";
    Object.assign(c, { calls: 0, totalMs: 0, maxMs: 0 });
    return text;
  };

  const actionEl = document.getElementById("action") as HTMLButtonElement;
  const gasEl = document.getElementById("gas")!;
  const hornEl = document.getElementById("horn")!;
  // Pédales (D104) : pictogramme et mot ; le mot de l'accélérateur suit la famille du véhicule (Pédaler, Accélérer).
  gasEl.innerHTML = `${icon("gas")}<span></span>`;
  const gasLabel = gasEl.querySelector("span")!;
  document.getElementById("brake")!.innerHTML = `${icon("brake")}<span>Frein</span>`;
  document.getElementById("handbrake")!.innerHTML = `${icon("handbrake")}<span>Frein<br>à main</span>`;
  document.getElementById("jump")!.innerHTML = icon("jump");
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
  // Rechargement demandé au clavier (R) ou au bouton (arme à feu en main, à pied), pris en compte à l'image suivante.
  let reloadAsked = false;
  let gunInHand = false;
  document.getElementById("reload")?.addEventListener("click", () => {
    reloadAsked = true;
  });
  let heldId: WeaponId | null = null;
  let aimW = 0;
  const pedWitnesses: number[] = [];
  if (params.has("wanted")) wanted.set(Number(params.get("wanted")) || 0, spawn.x, spawn.y);

  const vehicleName = new VehicleNameHud(document.getElementById("vname")!);
  const mount = (v: Vehicle): void => {
    riding = v;
    leaving = false;
    // Un deux-roues tombé se relève quand on remonte dessus.
    Object.assign(v.state, { lean: 0, wheelie: 0, wheelieRate: 0, fallen: false, impact: 0, vz: 0, air: 0 });
    rideModel = fleet.take(v);
    rideModel.group.add(model.group);
    lights = new VehicleLights(v.def);
    shownDamage = -1;
    rideModel.group.add(lights.group);
    model.group.visible = rideModel.pose !== "hidden";
    controls.mode = "drive";
    controls.lift = v.family !== "car";
    gasLabel.textContent = familyOf(v).gas;
    gasEl.setAttribute("aria-label", familyOf(v).gas);
    // Klaxon ou sonnette : un bouton rond avec son pictogramme, le mot dans son libellé.
    hornEl.innerHTML = icon(familyOf(v).horn === "Sonnette" ? "bell" : "horn");
    hornEl.setAttribute("aria-label", familyOf(v).horn);
    hornEl.title = familyOf(v).horn;
    document.body.classList.add("driving");
    document.body.classList.toggle("car", v.spec.handbrake);
    audio.setRide({ id: v.def.id, family: v.family, spec: v.spec });
    vehicleName.show(v.def.badge);
  };
  /** Descend du véhicule ; `lean` : inclinaison où on le laisse (un deux-roues tombé reste couché). */
  const dismount = (lean = 0): void => {
    const v = riding!;
    vehicleName.hide();
    const s = v.state;
    // Pied à terre du côté gauche (portière d'une voiture), hors des obstacles.
    const side = familyOf(v).dismount;
    const r = colliders.resolve(s.x - Math.cos(s.heading) * side, s.y + Math.sin(s.heading) * side, PLAYER_RADIUS);
    Object.assign(player, { x: r.x, y: r.y, z: terrain.heightAt(r.x, r.y), vx: 0, vy: 0, speed: 0, heading: s.heading });
    groundPlayer(player);
    landWheelie(s, v.spec);
    s.vx = s.vy = s.yawRate = s.steer = 0;
    s.lean = lean;
    s.fallen = false;
    s.speed = 0;
    stunt.end();
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
  // Dégâts (D109, D110) : les véhicules abîmés par le joueur (celui qu'il conduit, et ceux qu'il a laissés) brûlent jusqu'à leur fin
  // et fument tant qu'on est à moins de 150 m ; la voiture conduite montre sa carrosserie froissée, ses phares et ses vitres cassés.
  // Une épave n'a plus de moteur et ne se reprend pas.
  const damaged = new Set<Vehicle>();
  const abandoned: Abandoned[] = [];
  const garageStop = new GarageStop();
  // Véhicules uniques (D114) : apparition à leur place (selon leur horaire), retrait hors service, retour à leur place après un moment.
  const keeper = new UniqueKeeper();
  let uniqueTimer = 0;
  const updateUniques = (dt: number): void => {
    uniqueTimer -= dt;
    if (uniqueTimer > 0) return;
    const step = 0.5 - uniqueTimer;
    uniqueTimer = 0.5;
    for (const spot of UNIQUES) {
      const v = fleet.get(spot.id) ?? null;
      const view = {
        exists: !!v, atHome: !!v && Math.hypot(v.state.x - spot.x, v.state.y - spot.y) < UNIQUE.home, usable: !!v && v.damage.usable, ridden: !!v && v === riding,
        toVehicle: v ? Math.hypot(v.state.x - player.x, v.state.y - player.y) : Infinity, toHome: Math.hypot(spot.x - player.x, spot.y - player.y),
      };
      const action = keeper.decide(spot, view, atmosphere.hour, step);
      if ((action === "despawn" || action === "respawn") && v) {
        damaged.delete(v);
        fleet.remove(v);
      }
      if (action === "spawn" || action === "respawn") fleet.add(spot.model, spot.id, spot.x, spot.y, spot.heading, 0);
      // Camions-restaurants (D115) : un vendeur en tablier blanc derrière le comptoir quand le camion est ouvert, à sa place, et qu'on est assez près.
      const w = fleet.get(spot.id);
      const spotAt = vendorOf(spot.model);
      const open = !!w && !!spotAt && w !== riding && w.damage.usable && onDuty(spot, atmosphere.hour)
        && Math.hypot(w.state.x - spot.x, w.state.y - spot.y) < UNIQUE.home && Math.hypot(w.state.x - player.x, w.state.y - player.y) < 90;
      let vendor = vendors.get(spot.id);
      if (!open && vendor) {
        scene.remove(vendor.group);
        vendor.dispose();
        vendors.delete(spot.id);
      } else if (open && w && spotAt) {
        if (!vendor) {
          vendor = createPlayerModel(applyAppearance(recipeFromSeed(vendorSeed(spot.id)), { top: "apron", topColor: WHITE, hat: "none" }));
          scene.add(vendor.group);
          vendors.set(spot.id, vendor);
        }
        const p = vendorWorld(w, spotAt);
        vendor.update(p.x, p.y, p.z, w.state.heading + (spotAt.side * Math.PI) / 2, 0, 0);
      }
    }
  };
  // Petit train touristique (D117) : il tourne sur son circuit, montré de 11 h à 18 h. `?train=<m>` : le place à tant de mètres du départ.
  const train = new TouristTrain(scene, colliders, terrain, Number(params.get("train") ?? 0) || 0);
  // Aucune voiture garée sur le circuit : une place dont le centre est à moins de la demi-largeur du train et d'une demi-voiture.
  fleet.keepClearAlong(train.route.samples(), TRAIN_CLEAR);
  const trainCars: TrainEnv["cars"][number][] = [];
  const trainParked: TrainEnv["parked"][number][] = [];
  const updateTrain = (dt: number): void => {
    const t = traffic as Traffic | null, at = train.position;
    trainCars.length = 0;
    if (t) for (const c of t.cars) trainCars.push(c.sim);
    // Véhicules de la flotte qui ne sont plus à leur place (laissés par le joueur sur la chaussée) : le train s'arrête devant.
    trainParked.length = 0;
    for (const v of fleet.vehicles) {
      if (v.ridden || Math.abs(v.state.x - at.x) > 80 || Math.abs(v.state.y - at.y) > 80) continue;
      if (!v.home || Math.hypot(v.state.x - v.home.x, v.state.y - v.home.y) > 0.5) trainParked.push(v);
    }
    train.update(dt, {
      x: player.x, y: player.y, hour: atmosphere.hour, vehicle: riding ? { state: riding.state, spec: riding.spec } : null,
      cars: trainCars, peds: peds as PedsController | null, parked: trainParked, road: (nav as NavManager | null)?.graph.road ?? null, signals: signals as Signals | null,
    });
    t?.setExtra(train.visible ? train.others : []);
  };
  /** Les voitures que voient les passants, et le train quand il est là. */
  const withTrain = (bodies: readonly TrafficBody[]): readonly TrafficBody[] => (train.visible ? [...bodies, ...train.bodies] : bodies);
  /** Vendeurs des camions-restaurants (D115), par identifiant de véhicule unique. */
  const vendors = new Map<string, ReturnType<typeof createPlayerModel>>();
  const vendorSeed = (id: string): number => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  /** Position dans le monde d'un point du repère du véhicule (x à droite, y en haut, z vers l'arrière). */
  const vendorWorld = (v: Vehicle, at: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
    const hx = Math.sin(v.state.heading), hy = Math.cos(v.state.heading);
    return { x: v.state.x - hx * at.z + hy * at.x, y: v.state.y - hy * at.z - hx * at.x, z: v.state.z + at.y };
  };
  /** On prend un camion-restaurant ouvert (D115) : le vendeur saute dehors et s'enfuit, c'est un vol sous les yeux de témoins. */
  const robVendor = (v: Vehicle): boolean => {
    const vendor = vendors.get(v.id), at = vendorOf(v.def.id);
    if (!vendor || !at) return false;
    scene.remove(vendor.group);
    vendor.dispose();
    vendors.delete(v.id);
    // Il sort par l'ouverture, du côté où elle est.
    const p = vendorWorld(v, { ...at, x: at.x + at.side * 1.6 });
    const ux = at.side * Math.cos(v.state.heading), uy = -at.side * Math.sin(v.state.heading);
    (peds as PedsController | null)?.eject(p.x, p.y, vendorSeed(v.id), ux, uy, 1.4, v.state.x, v.state.y);
    police.crime("carjack", v.state.x, v.state.y, true);
    return true;
  };
  const CHIMNEY_SMOKE = new THREE.Color("#cfcac0");
  // Véhicules abîmés retrouvés dans la sauvegarde (D113) : ils fument (ou brûlent) de nouveau.
  for (const v of fleet.vehicles) if (v.damage.version > 0 && (v.damage.health < DAMAGE.max || v.damage.end)) damaged.add(v);
  /** Véhicules sur la trajectoire d'un tir (D113) : de la flotte, ou de la circulation (état, fiche et dégâts). */
  const shotTargets: (Vehicle | { state: Vehicle["state"]; spec: Vehicle["spec"]; damage: Vehicle["damage"] })[] = [];
  const smoke = new Smoke(scene);
  const SMOKE: Partial<Record<DamageTier, { rate: number; color: THREE.Color; size: [number, number]; life: number }>> = {
    smoke: { rate: 7, color: new THREE.Color("#e9e5dc"), size: [0.22, 0.7], life: 1.8 },
    heavy: { rate: 12, color: new THREE.Color("#4a4a50"), size: [0.28, 0.95], life: 2.2 },
    fire: { rate: 16, color: new THREE.Color("#2a2a2e"), size: [0.32, 1.15], life: 2.6 },
  };
  let shownDamage = -1;
  /** Montre l'état des dégâts sur le modèle conduit (seulement quand il a changé). */
  const showDamage = (): void => {
    if (!riding || !rideModel || riding.damage.version === shownDamage) return;
    shownDamage = riding.damage.version;
    const broken = rideModel.setDamage?.(riding.damage.zones);
    if (broken) lights?.setBroken(broken);
  };
  /** Fumée d'un véhicule abîmé (de la flotte ou de la circulation), selon son palier. */
  const emitSmoke = (s: Vehicle["state"], def: Vehicle["def"], tier: DamageTier, dt: number): void => {
    const style = SMOKE[tier];
    if (!style || Math.hypot(s.x - player.x, s.y - player.y) > 150) return;
    const [ox, oy, oz] = smokeOrigin(def);
    const hx = Math.sin(s.heading), hy = Math.cos(s.heading);
    for (let n = Math.floor(dt * style.rate + Math.random()); n > 0; n--) {
      const x = s.x + hx * oz + hy * ox + (Math.random() - 0.5) * 0.3, y = s.y + hy * oz - hx * ox + (Math.random() - 0.5) * 0.3;
      smoke.emit(x, y, s.z + oy, s.vx * 0.2 + (Math.random() - 0.5) * 0.4, s.vy * 0.2 + (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.6,
        style.color, style.size[0], style.size[1] * (0.8 + Math.random() * 0.4), style.life * (0.8 + Math.random() * 0.4), Math.random);
    }
  };
  /** Point du choc : au bord de la carrosserie, dans la direction du choc. */
  const contactPoint = (v: Vehicle, angle: number): { x: number; y: number } => {
    const s = v.state, ca = Math.cos(angle), sa = Math.sin(angle);
    const r = 1 / Math.hypot(ca / (v.def.size.length / 2), sa / (v.def.size.width / 2));
    const hx = Math.sin(s.heading), hy = Math.cos(s.heading);
    return { x: s.x + (hx * ca + hy * sa) * r, y: s.y + (hy * ca - hx * sa) * r };
  };
  /** Le joueur percute un véhicule garé (D112) : celui dont la coque touche le point du choc prend le même choc, de son côté. */
  const hitParked = (v: Vehicle, impact: number, angle: number): void => {
    if (Number.isNaN(angle)) return;
    const p = contactPoint(v, angle);
    for (const w of fleet.around(p.x, p.y, 4, near)) {
      if (w === v) continue;
      const ws = w.state, hx = Math.sin(ws.heading), hy = Math.cos(ws.heading);
      if (!w.spec.hull.some(([off, r]) => Math.hypot(ws.x + hx * off - p.x, ws.y + hy * off - p.y) < r + 0.35)) continue;
      w.damage.hit(impact, contactAngle(ws, p.x - ws.x, p.y - ws.y));
      damaged.add(w);
      fleet.refresh();
      return;
    }
  };
  /** Étincelles au point du choc (au bord de la carrosserie, dans la direction du choc). */
  const crashSparks = (v: Vehicle, angle: number): void => {
    if (Number.isNaN(angle) || v.family === "bike" || v.family === "kickscooter") return;
    const p = contactPoint(v, angle);
    fx.sparks(p.x, p.y, v.state.z + 0.45, false, Math.random);
  };
  // Feu et explosion (D111) : flammes sans éclairage (un second maillage de bouffées), boule de feu, souffle qui blesse et pousse,
  // épave noircie qui brûle, puis fume, puis disparaît quand on ne la voit plus.
  const flames = new Smoke(scene, false);
  const FLAME_COLORS = ["#fff1a8", "#f1b24a", "#e8641e", "#d9472b"].map((c) => new THREE.Color(c));
  const WRECK_SMOKE = new THREE.Color("#3a3a3f");
  const near: Vehicle[] = [];
  const blastPeds: number[] = [];
  const blastPos = { x: 0, y: 0 };
  /** Flammes : sur le capot (véhicule en feu) ou sur toute la caisse (épave qui brûle). */
  const emitFlames = (s: Vehicle["state"], def: Vehicle["def"], dt: number, rate: number, spread: boolean): void => {
    if (Math.hypot(s.x - player.x, s.y - player.y) > 150) return;
    const [ox, oy, oz] = smokeOrigin(def);
    const hx = Math.sin(s.heading), hy = Math.cos(s.heading), half = def.size.length / 2 - 0.3;
    const n = Math.floor(dt * rate + Math.random());
    for (let i = 0; i < n; i++) {
      const along = spread ? (Math.random() * 2 - 1) * half : oz, side = spread ? (Math.random() - 0.5) * def.size.width * 0.7 : ox;
      const x = s.x + hx * along + hy * side, y = s.y + hy * along - hx * side;
      flames.emit(x, y, s.z + (spread ? 0.5 + Math.random() * 0.5 : oy), (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 2 + Math.random() * 1.5,
        FLAME_COLORS[Math.floor(Math.random() * FLAME_COLORS.length)]!, 0.22, spread ? 0.75 : 0.55, 0.4 + Math.random() * 0.35, Math.random);
    }
    if (Math.random() < dt * 4) audio.crackle(s.x, s.y);
  };
  const emitWreckSmoke = (v: Vehicle, dt: number, rate: number): void => {
    if (Math.hypot(v.state.x - player.x, v.state.y - player.y) > 150) return;
    const s = v.state, n = Math.floor(dt * rate + Math.random());
    for (let i = 0; i < n; i++) {
      smoke.emit(s.x + (Math.random() - 0.5), s.y + (Math.random() - 0.5), s.z + 1.1, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 1.1 + Math.random() * 0.6,
        WRECK_SMOKE, 0.25, 0.85 + Math.random() * 0.3, 2.2 + Math.random(), Math.random);
    }
  };
  /** Le véhicule explose : boule de feu, débris, bruit ; le souffle tue le conducteur, blesse et projette autour, abîme les véhicules voisins. */
  const explode = (v: Vehicle): void => {
    const s = v.state, x = s.x, y = s.y, z = s.z;
    // Boule de feu (jaune au cœur, orange et rouge autour), puis, un peu après, le nuage de fumée qui monte au-dessus.
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4.5, core = i < 12;
      flames.emit(x + Math.cos(a) * 0.4, y + Math.sin(a) * 0.4, z + 0.8, Math.cos(a) * sp, Math.sin(a) * sp, 1 + Math.random() * 4,
        FLAME_COLORS[core ? Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3)]!, 0.6, core ? 2.6 + Math.random() : 1.8 + Math.random() * 1.2,
        0.7 + Math.random() * 0.5, Math.random);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.5;
      smoke.emit(x + Math.cos(a) * 0.8, y + Math.sin(a) * 0.8, z + 1.8 + Math.random(), Math.cos(a) * sp, Math.sin(a) * sp, 2 + Math.random() * 1.5, WRECK_SMOKE,
        0.6, 1.6 + Math.random() * 0.8, 3 + Math.random() * 1.5, Math.random, 0.45 + Math.random() * 0.4);
    }
    for (let i = 0; i < 6; i++) fx.sparks(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, z + 0.6 + Math.random(), false, Math.random);
    audio.explosion(x, y);
    const dPlayer = Math.hypot(player.x - x, player.y - y);
    if (dPlayer < 45) shake.impact(Math.max(2, 8 - dPlayer / 5));
    if (dPlayer < 25) haptics.crash(8);
    // Le joueur : tué s'il est dedans ; à pied, blessé selon la distance ; dans un autre véhicule, protégé de moitié.
    if (!health.dead) {
      if (riding === v) health.damage(10000);
      else {
        const hurt = EXPLOSION.player * blastShare(dPlayer) * (riding ? EXPLOSION.sheltered : 1);
        if (hurt > 0) health.damage(hurt);
      }
    }
    // Les véhicules voisins (dont celui du joueur) : abîmés du côté du souffle ; une voiture déjà très touchée peut prendre feu à son tour.
    for (const w of fleet.around(x, y, EXPLOSION.radius, near)) {
      if (w === v) continue;
      const points = EXPLOSION.vehicle * blastShare(Math.hypot(w.state.x - x, w.state.y - y));
      if (points <= 0) continue;
      w.damage.damage(points, contactAngle(w.state, x - w.state.x, y - w.state.y));
      damaged.add(w);
    }
    (traffic as Traffic | null)?.blast(x, y, EXPLOSION.radius, (d) => EXPLOSION.vehicle * blastShare(d));
    // Les passants et les gendarmes à pied : blessés ou tués, projetés.
    let hits = 0, killed = 0;
    const n = shootWorld.pick(x, y, 0, EXPLOSION.radius, Math.PI, 24, blastPeds);
    for (let i = 0; i < n; i++) {
      const slot = blastPeds[i]!;
      shootWorld.position(slot, blastPos);
      const dx = blastPos.x - x, dy = blastPos.y - y, d = Math.hypot(dx, dy), share = blastShare(d);
      if (share <= 0) continue;
      const r = shootWorld.hurt(slot, EXPLOSION.ped * share, d > 0.01 ? dx / d : 1, d > 0.01 ? dy / d : 0, EXPLOSION.impulse * share);
      if (r > 0) hits++;
      if (r === 2) killed++;
    }
    // Une explosion en public est une infraction, ses morts des meurtres ; un passant vivant à moins de 40 m appelle.
    pedWitnesses.length = 0;
    const seen = ((peds as PedsController | null)?.queryCircle(x, y, 40, pedWitnesses) ?? 0) > 0;
    police.crime("explosion", x, y, seen);
    if (hits > 0) police.crime(killed > 0 ? "murder" : "assault", x, y, seen);
    fleet.refresh();
  };
  const updateDamage = (dt: number): void => {
    if (riding && riding.damage.version > 0) damaged.add(riding);
    showDamage();
    for (const v of damaged) {
      v.damage.update(dt);
      for (const e of v.damage.takeEvents()) if (e.kind === "explode") explode(v);
      const d = v.damage;
      if (d.end === "explosion") {
        const stage = wreckStage(d.sinceEnd);
        if (stage === "fire") {
          emitFlames(v.state, v.def, dt, 26, true);
          emitWreckSmoke(v, dt, 6);
        } else if (stage === "smoke") emitWreckSmoke(v, dt, 3.5);
        // Une épave froide, hors de vue depuis longtemps, disparaît (une voiture de stationnement reviendra à sa place avec sa tuile).
        else if (d.sinceEnd > EXPLOSION.vanish && v !== riding && Math.hypot(v.state.x - player.x, v.state.y - player.y) > EXPLOSION.vanishDistance) {
          fleet.remove(v);
          damaged.delete(v);
        }
        continue;
      }
      if (d.end === "breakdown") {
        if (d.profile.burns && wreckStage(d.sinceEnd) !== "cold") emitWreckSmoke(v, dt, 3);
        continue;
      }
      if (d.burning >= 0) emitFlames(v.state, v.def, dt, 18, false);
      emitSmoke(v.state, v.def, d.tier, dt);
      if (v.damage.version > 0 && v.damage.tier === "ok" && v.damage.health >= DAMAGE.max) damaged.delete(v);
    }
    // La circulation (D112) : ses voitures abîmées fument et brûlent ; celles que leur conducteur abandonne rejoignent la flotte (garées, avec leurs dégâts),
    // et le conducteur civil descend et s'enfuit ; une gendarmerie en feu est hors d'usage.
    const tr = traffic as Traffic | null;
    if (tr) {
      tr.forEachDamaged((st, def, dmg) => {
        if (dmg.burning >= 0) emitFlames(st, def, dt, 18, false);
        emitSmoke(st, def, dmg.tier, dt);
      });
      for (const a of tr.takeAbandoned(abandoned)) {
        // Sa place d'origine est celle où on l'a laissée : elle n'est enregistrée que si le joueur la déplace.
        const v = fleet.add(a.model, `abandon-${Date.now().toString(36)}-${++stolen}`, a.x, a.y, a.heading, a.variant);
        v.damage = a.damage;
        damaged.add(v);
        fleet.refresh();
        if (a.police) continue;
        const lx = -Math.cos(a.heading), ly = Math.sin(a.heading), side = FAMILIES.car.dismount;
        (peds as PedsController | null)?.eject(a.x + lx * side, a.y + ly * side, a.driver, lx, ly, 1.2, a.x, a.y);
      }
    }
    // Fumée de la cheminée du four à pizza (D115), tant que le camion est ouvert.
    for (const [id] of vendors) {
      const w = fleet.get(id), top = w ? chimneyOf(w.def.id) : null;
      if (!w || !top || Math.random() > dt * 3) continue;
      const p = vendorWorld(w, { x: top[0], y: top[1], z: top[2] });
      smoke.emit(p.x, p.y, p.z, 0, 0, 0.8 + Math.random() * 0.4, CHIMNEY_SMOKE, 0.15, 0.55, 2.2, Math.random);
    }
    smoke.update(dt);
    flames.update(dt);
    // Garage (D113) : arrêté devant, au volant d'un véhicule abîmé, on repart réparé ; le nom du garage s'affiche comme celui d'un véhicule.
    if (riding) {
      const d = riding.damage, needs = d.usable && d.version > 0 && (d.health < DAMAGE.max || ZONES.some((z) => d.zones[z] > 0));
      const g = garageStop.update(dt, ui.garages, riding.state.x, riding.state.y, riding.state.speed, needs);
      if (g) {
        d.repair();
        damaged.delete(riding);
        vehicleName.show({ make: g.name, model: "Réparée" });
      }
    }
    const tier = riding?.damage.tier;
    audio.setDamage(tier === "smoke" ? 0.3 : tier === "heavy" ? 0.7 : tier === "fire" || tier === "wrecked" ? 1 : 0);
    speedo.setHurt(!!riding && (riding.damage.health <= DAMAGE.heavy || !riding.damage.usable));
  };
  const damageInfo = (): string => {
    const d = riding?.damage;
    if (!d) return "";
    const z = d.zones;
    return ` · dégâts ${d.health.toFixed(0)} ${d.tier}${d.burning >= 0 ? ` feu ${d.burning.toFixed(1)} s` : ""} (av ${z.front.toFixed(2)} ar ${z.rear.toFixed(2)} g ${z.left.toFixed(2)} d ${z.right.toFixed(2)})`;
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
  /**
   * Chute d'un deux-roues (D98) : choc trop fort contre un obstacle ou une voiture, ou cabrage trop poussé. Le deux-roues reste couché
   * là où il est ; le pilote est projeté dans le sens de la marche, glisse, reste au sol puis se relève ; blessure selon la vitesse, jamais mortelle.
   */
  const fall = (speed: number): void => {
    const v = riding!;
    const s = v.state;
    // Basculé en arrière (roue arrière trop poussée) : il tombe sur le dos, derrière ; sinon (choc), en avant.
    const back = s.fallen && s.wheelie > 0 && s.impact < v.spec.fallImpact;
    const sp = Math.hypot(s.vx, s.vy);
    const dx = sp > 0.3 ? s.vx / sp : Math.sin(s.heading), dy = sp > 0.3 ? s.vy / sp : Math.cos(s.heading);
    audio.impact(Math.max(s.impact, 4));
    haptics.crash(Math.max(s.impact, 4));
    shake.impact(Math.min(Math.max(s.impact, 2), 8));
    const x = s.x, y = s.y;
    dismount(s.lean >= 0 ? FALLEN_LEAN : -FALLEN_LEAN);
    // Devant le deux-roues (ou derrière, s'il a basculé en arrière), hors de sa coque.
    const ahead = back ? -1.2 : 1.2;
    const r = colliders.resolve(x + dx * ahead, y + dy * ahead, PLAYER_RADIUS);
    const throw_ = back ? 0 : 0.6 * speed;
    Object.assign(player, { x: r.x, y: r.y, z: terrain.heightAt(r.x, r.y, player.z), vx: dx * throw_, vy: dy * throw_, speed: 0, heading: Math.atan2(dx, dy) });
    groundPlayer(player);
    downFor = DOWN_TIME;
    downSide = back ? 1 : -1;
    health.damage(fallDamage(speed, health.hp));
  };
  const act = (): void => {
    if (downFor > 0) return;
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
      if (!robVendor(r.fleet) && r.fleet.home) police.crime("theft", player.x, player.y, false);
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
  if (ride) {
    const v = fleet.add(ride, "depart", spawn.x, spawn.y, startYaw, 1);
    // `?damage=N` : santé du véhicule de départ (essais des dégâts, D109), les points perdus répartis sur les zones de `&dent=front,left`
    // (défaut : l'avant et l'arrière).
    if (params.has("damage")) {
      const lost = DAMAGE.max - Math.min(DAMAGE.max, Math.max(0, Number(params.get("damage")) || 0));
      const ANGLE: Record<string, number> = { front: 0, right: Math.PI / 2, rear: Math.PI, left: -Math.PI / 2 };
      const where = (params.get("dent") ?? "").split(",").filter((z) => z in ANGLE);
      if (where.length === 0) v.damage.damage(lost);
      for (const z of where) v.damage.damage(lost / where.length, ANGLE[z]);
    }
    v.damage.takeEvents();
    mount(v);
  }
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
    // Les balles s'arrêtent aussi sur les obstacles ronds : véhicules garés, troncs, poteaux (D113).
    wall: (ax, ay, bx, by) => colliders.raycast(ax, ay, bx, by, true),
    // Véhicules visés (D113) : ceux de la flotte et de la circulation à moins de 80 m ; la balle les abîme du côté où elle entre.
    rayVehicle: (x, y, dx, dy, maxDist) => {
      shotTargets.length = 0;
      for (const v of fleet.around(x, y, 80, near)) if (!v.ridden) shotTargets.push(v);
      for (const c of (traffic as Traffic | null)?.cars ?? []) if (Math.hypot(c.sim.state.x - x, c.sim.state.y - y) < 80) shotTargets.push({ state: c.sim.state, spec: c.sim.spec, damage: c.sim.damage });
      let best: { dist: number; id: number } | null = null;
      shotTargets.forEach((t, id) => {
        const d = rayHull(x, y, dx, dy, t, best?.dist ?? maxDist);
        if (d !== null) best = { dist: d, id };
      });
      return best;
    },
    hurtVehicle: (id, damage, x, y) => {
      const t = shotTargets[id];
      if (!t) return;
      t.damage.shot(damage, contactAngle(t.state, x - t.state.x, y - t.state.y));
      if ("def" in t) {
        damaged.add(t);
        fleet.refresh();
      }
    },
  };
  const drops: { x: number; y: number }[] = [];
  let hudTimer = 0;
  let actionLabel = "";
  // Bouton d'action (D103) : à pied, rond avec un pictogramme et un verbe court (le nom complet est dans son libellé accessible) ;
  // les objets proches ne sont plus signalés en haut à droite, la minimap les montre.
  const updateHud = (): void => {
    let verb = "", what = "", ico = "";
    const r = riding ? null : reachable();
    const pk = riding ? null : pickups.nearest(player.x, player.y, PICKUP_REACH);
    if (pk && pickups.canTake(pk, inventory)) [verb, what, ico] = ["Ramasser", WEAPONS[pk.weapon].name, weaponIcon(pk.weapon)];
    else if (riding) [verb, ico] = ["Descendre", icon("exit")];
    else if (r?.traffic) [verb, what, ico] = ["Prendre", r.traffic, icon("car")];
    else if (r?.fleet) [verb, what, ico] = ["Monter", r.fleet.def.name, vehicleIcon(r.fleet.def.id, r.fleet.def.family)];
    const label = what ? `${verb} : ${what}` : verb;
    if (label !== actionLabel) {
      actionLabel = label;
      actionEl.innerHTML = ico ? `${ico}<span>${verb}</span>` : verb;
      actionEl.setAttribute("aria-label", label);
      actionEl.title = label;
      actionEl.classList.toggle("show", label !== "");
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
    groundPlayer(player);
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
    groundPlayer(player);
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
  let jumpHeld = false;
  /** Accélérateur dosé de la voiture conduite (la commande est tout ou rien). */
  let throttle = 0;
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
    // Un appui, un saut : il ne compte qu'au premier pas de simulation de l'image.
    let jumpNow = input.jump && !jumpHeld && downFor <= 0 && !health.dead;
    jumpHeld = input.jump;
    if (hornPressed && riding) (traffic as Traffic | null)?.playerHorn(riding.state.x, riding.state.y, riding.state.heading);
    audio.horn(input.horn && !!riding);
    bumpTimer = Math.max(0, bumpTimer - dt);
    yaw += input.lookYaw;
    pitch = Math.min(Math.max(pitch + input.lookPitch, MIN_PITCH), MAX_PITCH);

    acc += dt;
    // Vitesse avant ce pas : celle d'une éventuelle chute (le choc l'a déjà réduite).
    const rideSpeed = riding ? Math.hypot(riding.state.vx, riding.state.vy) : 0;
    while (acc >= STEP) {
      if (riding) {
        throttle = riding.family === "car" || riding.family === "moto" ? rampThrottle(throttle, leaving ? 0 : input.throttle, STEP) : input.throttle;
        const drive = leaving ? { throttle: 0, brake: 1, steer: 0 } : { throttle, brake: input.brake, steer: input.steer, handbrake: input.handbrake, lift: input.lift };
        stepVehicle(riding.state, drivenSpec(riding), drive, STEP, terrain, colliders, riding.family === "car" ? fleet.carOnly : null, true);
        if (drive.throttle > 0 && rideModel?.pose === "pedal") crank += (Math.max(riding.state.speed, 0.8) / riding.spec.wheelRadius) * 0.45 * STEP;
      } else {
        // Un coup en cours ralentit : on ne court pas en frappant.
        const k = (bumpTimer > 0 ? 0.7 : 1) * (melee.active ? 0.45 : gun.idle < 0.35 ? 0.6 : 1);
        if (downFor > 0) {
          downFor = Math.max(0, downFor - STEP);
          slidePlayer(player, STEP, terrain, colliders);
        } else {
          stepPlayer(player, { forward: input.forward * k, right: input.right * k, run: input.run && !melee.active && gun.idle > 0.35, jump: jumpNow }, yaw, STEP, terrain, colliders);
          jumpNow = false;
        }
      }
      (traffic as Traffic | null)?.step(STEP, riding ? { kind: "vehicle", state: riding.state, spec: riding.spec } : { kind: "foot", x: player.x, y: player.y, vx: player.vx, vy: player.vy });
      acc -= STEP;
    }
    // Réception d'un saut ou d'une chute : choc ressenti au-delà de 1,5 m, blessure au-delà de SAFE_DROP.
    if (player.landed > 0) {
      const drop = player.landed;
      player.landed = 0;
      if (drop > 1.5) {
        audio.impact(Math.min(drop * 1.5, 8));
        haptics.crash(Math.min(drop * 1.5, 8));
        shake.impact(Math.min(drop, 8));
      }
      const hurt = dropDamage(drop);
      if (hurt > 0 && !health.dead) health.damage(hurt);
    }
    updateDamage(dt);
    updateUniques(dt);
    updateTrain(dt);
    (traffic as Traffic | null)?.setNight(atmosphere.night);
    (traffic as Traffic | null)?.update(dt, { x: player.x, y: player.y, yaw, speed: Math.abs(speedOf()), hour: atmosphere.hour, vehicle: riding ? { x: riding.state.x, y: riding.state.y } : null });
    if (riding) {
      const s = riding.state;
      // Dégâts (D109) : chaque choc de l'image abîme le véhicule, à l'endroit où il a porté.
      if (s.impact > 0 && riding.damage.hit(s.impact, s.impactAngle) > 0) {
        crashSparks(riding, s.impactAngle);
        hitParked(riding, s.impact, s.impactAngle);
      }
      if (leaving && Math.abs(s.speed) < 0.4) dismount();
      else if (riding.spec.leans && (s.fallen || s.impact >= riding.spec.fallImpact)) fall(Math.max(rideSpeed, s.impact));
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
    if (riding || health.dead || downFor > 0) {
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
    // Bouton de rechargement : seulement avec une arme à feu en main (le CSS le cache aussi en véhicule).
    if ((weapon.kind === "gun") !== gunInHand) document.body.classList.toggle("gun", (gunInHand = weapon.kind === "gun"));
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
      stunt.update(riding.state.wheelie, riding.state.speed, dt);
    } else {
      model.setDown(downFor > 0 ? { t: DOWN_TIME - downFor, side: downSide } : null);
      model.setAir(player.climb ? { climb: true, vz: 0, t: player.z } : player.air ? { climb: false, vz: player.vz, t: 0 } : null);
      model.update(player.x, player.y, player.z, player.heading, player.stride, player.speed);
      model.group.visible = camDist > 0.9;
      if (stepCrossed(lastPhase, model.phase) && player.speed > 0.3) audio.footstep(player.speed > 3);
      lastPhase = model.phase;
    }
    if (riding) speedo.set(riding.state.speed, riding.spec.topSpeed);
    if (!riding) stunt.update(0, 0, dt);
    if (stuntEl) {
      const text = stunt.label();
      if (stuntEl.textContent !== text) stuntEl.textContent = text;
    }
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
        ...(traffic ? { vehicles: withTrain((traffic as Traffic).bodies()), honks: (traffic as Traffic).takeHonks() } : train.visible ? { vehicles: train.bodies } : {}),
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
      // Au volant, les balles des gendarmes abîment aussi le véhicule (D113).
      if (dmg > 0 && riding) riding.damage.shot(dmg);
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
    /** Essais et captures : le petit train (D117), les feux et les rues chargées. */
    train,
    signals: () => signals as Signals | null,
    road: () => (nav as NavManager | null)?.graph.road ?? null,
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
