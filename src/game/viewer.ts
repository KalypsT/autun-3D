import * as THREE from "three";
import { Sailboats } from "../render/sailboats";
import type { GameContext } from "./context";
import { NavDebug } from "../render/nav-debug";
import { NavManager } from "./nav-manager";
import { PedSim, type Observer } from "../core/pedestrians";
import { createCrowd } from "../render/crowd/crowd";
import { FrameMeter } from "./hud";
import { PigeonSim, type PigeonState } from "../core/pigeons";
import { PigeonRenderer } from "../render/pigeons";

const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  aerial: [-150, -230, 140, 0, 10, 5],
  street: [28, -25, 1.7, -5, 70, 8],
  place: [-95, -75, 2.0, 30, -20, 4],
  mairie: [10, 35, 1.7, 15, 95, 10],
  // Hôtel de ville (D293, D294), comme les photos Street View de l'utilisateur : côté est depuis le parking de la place ; arrière (rue Jeannin)
  // depuis ses deux coins ; côté ouest (rue de l'Hôtel de ville) depuis le coin arrière et depuis la place ; le perron de face et de biais.
  "mairie-est": [66.6, 101.8, 1.7, 34.0, 105.0, 9],
  "mairie-arriere-est": [21.2, 131.1, 1.7, 3.2, 111.7, 5],
  "mairie-arriere-ouest": [-22.9, 102.5, 1.7, 1.5, 110.6, 5],
  "mairie-ouest": [-18.3, 92.3, 1.7, 3.8, 67.3, 7],
  "mairie-ouest-place": [5.9, 54.4, 1.7, -7.8, 85.9, 8],
  "mairie-perron": [38.7, 54.8, 1.7, 29.7, 69.3, 4],
  "mairie-perron-biais": [25.3, 53.6, 1.7, 30.7, 67.6, 3.5],
  // Drapeaux et devise du balcon ; plaques « ASCENSEUR » et « HALLES » entre les arcades (D293).
  "mairie-drapeaux": [35.0, 60.8, 1.7, 27.6, 72.6, 15],
  "mairie-arcades": [20.6, 61.2, 1.7, 17.4, 66.3, 3],
  // Panneaux tirés du graphe routier (D295) : un stop et un sens interdit, une limitation à 30, un cédez-le-passage, vus par le conducteur.
  "panneaux-stop": [169.0, -187.1, 1.7, 163.4, -179.98, 1.6],
  "panneaux-30": [356.9, -94.1, 1.7, 362.66, -86.98, 1.6],
  "panneaux-cedez": [52.3, 77.6, 1.7, 60.34, 73.23, 1.6],
  church: [-40, -95, 1.7, -86, -136, 12],
  // Théâtre municipal (D223) : de face depuis la place, comme la photo de la façade.
  municipal: [17, 7, 1.7, -4.1, 38.7, 9],
  // Gare (D228) : de face depuis le parvis, comme la photo de la façade.
  gare: [-420.5, 477.6, 1.7, -444.7, 509.4, 5],
  // Parc des expositions l'Eduen (D231) : depuis le parking, comme la photo de face ; vue de drone du sud ; route de Chalon ; hall courbe.
  eduen: [1672.6, 620.4, 1.7, 1657.4, 552.3, 5],
  "eduen-haut": [1675.6, 458.2, 45, 1663.2, 554.9, 0],
  "eduen-route": [1625.4, 514.9, 1.7, 1642.8, 537.4, 4],
  "eduen-hall": [1708.0, 520.2, 1.7, 1679.5, 552.0, 4],
  // Logo du pignon côté route (D232) ; entrée côté parking, sous l'auvent « ENTRÉE ».
  "eduen-logo": [1647.4, 507.9, 1.7, 1661.6, 527.5, 7.5],
  // Mâts à drapeaux, mât d'éclairage, haie et barrière depuis l'avenue (D233) ; le parking vu d'en haut, depuis le toit de la salle.
  "eduen-mats": [1735.9, 590.3, 1.7, 1704.5, 586.4, 5],
  "eduen-parking": [1627.8, 573.4, 30, 1660.2, 635.5, 0],
  "eduen-entree": [1679.5, 581.8, 1.7, 1680.6, 564.3, 2.2],
  // McDonald's de la route de Chalon (D234) : côté parking, entre le McDonald's et le bowling ; depuis l'entrée sur la route ; depuis le
  // drive, vers la véranda (photos Street View de juillet 2026).
  mcdo: [1387.3, 667.0, 1.7, 1381.1, 691.4, 3],
  "mcdo-route": [1348.0, 674.4, 1.7, 1376.6, 682.5, 3],
  "mcdo-drive": [1388.2, 656.5, 1.7, 1374.8, 678.9, 3],
  // Façades (D235) : le long côté du parking (bandes blanches, M jaunes, entrée), comme la photo ; le pignon ouest du bowling vu du McDonald's.
  "mcdo-parking": [1354.2, 695.9, 1.7, 1376.1, 695.0, 3.5],
  // Entrée depuis la route : « McDRIVE » et « PARKING » peints au sol (D237).
  "mcdo-entree": [1371.6, 650.3, 2.2, 1377.5, 668.6, 0],
  "bowling-mcdo": [1373.0, 660.4, 1.7, 1394.4, 665.5, 3],
  // Bowling Strike Bowl (D234) : depuis la route de Chalon, depuis le parking nord, la terrasse du pignon sud ; les deux vus d'en haut.
  bowling: [1406.4, 624.0, 1.7, 1419.5, 655.4, 4],
  "bowling-parking": [1429.9, 694.9, 1.7, 1420.3, 666.2, 4],
  "bowling-terrasse": [1402.6, 645.9, 1.7, 1421.0, 642.5, 2],
  "route-chalon-haut": [1375.6, 615.7, 40, 1402.0, 669.6, 0],
  // Gendarmerie de l'avenue André Frenaud (D238) : le portail depuis l'avenue (photo du portail) ; du sud-ouest, par-dessus la pelouse ;
  // le long côté sud depuis la rue Lazare Carnot ; le collectif de logements ; la cour depuis l'est ; vue haute de l'ouest.
  gendarmerie: [1751.8, 623.8, 1.7, 1773.4, 606.9, 4],
  "gendarmerie-sud": [1730.8, 575.0, 1.7, 1776.3, 590.7, 4],
  "gendarmerie-carnot": [1779.5, 547.3, 1.7, 1777.5, 586.7, 5],
  "gendarmerie-logements": [1801.5, 576.4, 1.7, 1813.6, 552.0, 4],
  "gendarmerie-cour": [1803.5, 610.3, 1.7, 1767.6, 606.5, 3],
  "gendarmerie-haut": [1720.4, 591.8, 45, 1787.7, 601.7, 0],
  // Base nautique du plan d'eau du Vallon (D245) : depuis la route de Chalon (photo), devant la remise aux kayaks, du lac, de haut.
  nautique: [1356, 648, 1.7, 1300, 600, 0],
  "nautique-darse": [1312, 606, 1.7, 1318, 588, 2],
  "nautique-lac": [1290, 530, 1.7, 1308, 568, 2],
  "nautique-haut": [1345, 640, 35, 1308, 578, 0],
  // Pontons et cale du plan d'eau du Vallon (D246) : ponton de pêche (comme la photo), darse et ponton de la base, cale, ponton de l'abri,
  // ponton en L du sud-ouest, ponton de l'île (depuis le lac), vue haute de la base.
  "pontons-peche": [1013, 316, 1.7, 1036, 300, -0.5],
  "pontons-base": [1301, 641, 1.7, 1276, 628, -0.3],
  cale: [1322, 613, 1.7, 1298, 604, -0.5],
  "pontons-abri": [1292, 547, 1.7, 1273, 557, 0],
  "pontons-sud-ouest": [1143, 121, 1.7, 1130, 165, -0.3],
  "pontons-ile": [1298, 127, 2.1, 1292, 108, 0],
  "pontons-haut": [1318, 660, 28, 1286, 600, 0],
  // Équipements du plan d'eau du Vallon (D247) : skatepark depuis le parking (comme la photo), pump track, aire de jeux depuis le chemin (photo),
  // agrès de l'ouest, gué du Brisecou, vue haute du skatepark.
  skatepark: [1405, 590, 1.7, 1376, 566, 0],
  "pump-track": [1418, 532, 1.7, 1395, 542, 0],
  "aire-de-jeux": [1497, 182, 1.7, 1503, 158, 0.5],
  agres: [998, 267, 1.7, 1012, 256, 0.5],
  gue: [1345, 27, 1.7, 1351, 18, -0.3],
  "skatepark-haut": [1415, 600, 26, 1385, 555, 0],
  // Aire de glisse rénovée (D248) : piste d'éducation routière, bowl.
  "piste-education": [1352, 548, 9, 1378, 580, 0],
  bowl: [1365, 596, 3, 1376.3, 587.3, -1.5],
  // Vie du lac (D249) : pêcheurs du sud-ouest (photo), pêcheur du ponton, voiliers depuis la digue (?season=ete&weekday=6&h=14).
  pecheurs: [1150, 95, 1.7, 1185, 128, 0],
  "pecheur-ponton": [1015, 330, 2, 1033, 316, 0],
  voiliers: [1150, 628, 3, 1180, 520, -1],
  cathedrale: [-330, -250, 1.7, -300, -330, 14],
  // Porte d'Arroux (D137, éclairage revu en D297) : de face depuis la rue côté ville, comme les photos de nuit, et de près.
  arroux: [-263.5, 1046, 1.7, -269.1, 1071.2, 6.5],
  "arroux-pres": [-266, 1058, 1.7, -270.5, 1071.2, 5],
  // Porte Saint-André (D138) : de biais depuis la rue côté ville (ouest-sud-ouest), comme la photo de nuit.
  andre: [521, 829, 1.7, 545.5, 842.2, 6],
  lycee: [250, 120, 1.7, 290, 100, 4],
  // Lycée militaire (D258) : depuis les pelouses, sur l'axe du grand portail, comme la photo 1 (façade nord-ouest).
  militaire: [566, 52, 1.7, 592, 30, 12],
  // Lycée Bonaparte (D148) : depuis le Champ de Mars, vers l'ouest-sud-ouest, comme la photo 1.
  bonaparte: [-40, -92, 1.7, -92, -119, 5],
  parking: [-60, 150, 1.7, -20, 170, 3],
  // Croix de la Libération (D267) : depuis le parking (photo 1), depuis l'aire de décollage, vue haute.
  croix: [-848, -1838, 1.7, -841, -1809, 6],
  "croix-nord": [-824, -1784, 1.7, -841, -1809, 5],
  "croix-haut": [-818, -1786, 22, -841, -1809, 0],
  // Lot 4 (D268) : la vue depuis la terrasse nord de la plate-forme, vers la cathédrale (photo 15).
  "croix-vue": [-838.5, -1805.5, 1.7, 36.6, -571.5, 20],
  // Terrils des Télots (D269) : depuis les champs du sud (photo 2), depuis le bras mort de l'Arroux (photo 3), depuis le sommet du terril
  // est vers la ville, et au-dessus des lacets.
  telots: [250, 3450, 1.7, 250, 3780, 30],
  "telots-etang": [470, 3590, 1.7, 260, 3780, 25],
  "telots-haut": [346, 3787, 1.7, 36.6, -571.5, 20],
  "telots-lacets": [380, 3640, 60, 330, 3760, 20],
  "telots-sentier": [332, 3685.7, 1.7, 352, 3700, 4],
  // Galerie des personnages (startGallery) : le départ du jeu.
  characters: [-10, -40, 1.7, -10, -20, 1.2],
};

/** Vue demandée : ?cam=x,y,h,cibleX,cibleY,hCible ou ?view=nom. */
export function viewerView(params: URLSearchParams): [number, number, number, number, number, number] {
  const custom = params.get("cam")?.split(",").map(Number);
  return custom && custom.length === 6 && custom.every(Number.isFinite)
    ? (custom as [number, number, number, number, number, number])
    : (VIEWS[params.get("view") ?? "aerial"] ?? VIEWS["aerial"]!);
}

/** Caméra libre pour les captures et le diagnostic : ?view=nom ou ?cam=x,y,h,cibleX,cibleY,hCible. */
export function startViewer(ctx: GameContext): void {
  const { camera, renderer, scene, sky, params, debugEl, world, tiles, terrainView, vista, atmosphere, sunDir, sunLight } = ctx;
  const { terrain } = world;
  let yaw = 0, pitch = 0;
  const pos = new THREE.Vector3();
  const ground = (x: number, y: number): number => terrain.heightAt(x, y);

  const v = viewerView(params);
  const z = ground(v[0], v[1]) + v[2];
  pos.set(v[0], z, -v[1]);
  const dx = v[3] - v[0], dy = v[4] - v[1], dz = ground(v[3], v[4]) + v[5] - z;
  yaw = Math.atan2(dx, dy);
  pitch = Math.atan2(dz, Math.hypot(dx, dy));

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyF") debugEl.style.display = debugEl.style.display === "block" ? "none" : "block";
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  const canvas = renderer.domElement;
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw += e.movementX * 0.005;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.005));
  });

  // ?nav=1 ou ?nav=all : recouvrement de la navigation (files, passages, places, points d'intérêt ; avec all, le graphe routier).
  const navParam = params.get("nav");
  // ?sim=80 : 80 passants de la simulation autour de la caméra (captures) ; ?warm=20 : secondes simulées avant la première image (défaut 20).
  const simN = Math.min(Math.max(Math.floor(Number(params.get("sim") ?? 0)) || 0, 0), 400);
  // ?pigeons=30 : jusqu'à 30 pigeons autour de la caméra ; ?scare=0.8 : la volée visée s'envole, puis 0,8 s passent avant la première image.
  const pigN = Math.min(Math.max(Math.floor(Number(params.get("pigeons") ?? 0)) || 0, 0), 60);
  const nav = navParam || simN > 0 || pigN > 0 ? new NavManager() : null;
  const pedSim = simN > 0 && nav ? new PedSim(nav.graph, terrain, ctx.colliders, { capacity: simN, seed: Number(params.get("seed") ?? 7), spawnInView: true }) : null;
  const crowd = pedSim ? createCrowd(scene, pedSim.state) : null;
  if (pedSim && crowd) pedSim.onSpawn = (slot, recipe) => crowd.assign?.(slot, recipe);
  // Les pigeons ne fuient pas la caméra : leur « joueur » est reculé de 40 m derrière elle (`?pigobs=x,y` le place ailleurs) : les captures voient les oiseaux de près, posés.
  const pigAt = params.get("pigobs")?.split(",").map(Number);
  const pigObserver = (): Observer => ({
    ...observer(), x: pigAt?.[0] ?? pos.x - Math.sin(yaw) * 40, y: pigAt?.[1] ?? -pos.z + Math.cos(yaw) * 40, hour: atmosphere.hour,
  });
  const pigSim = pigN > 0 && nav ? new PigeonSim(nav.graph, terrain, ctx.colliders, { capacity: pigN, seed: Number(params.get("seed") ?? 7), spawnInView: true }) : null;
  const pigView = pigSim ? new PigeonRenderer(scene, pigN) : null;
  // ?pigsheet=x,y : planche de modèles (8 poses, de profil, tournés vers l'est, alignés vers l'est depuis ce point) pour juger l'oiseau de près.
  const sheetAt = params.get("pigsheet")?.split(",").map(Number);
  const sheet = pigSim && sheetAt && sheetAt.length === 2 ? pigeonSheet(terrain, sheetAt[0]!, sheetAt[1]!) : null;
  const observer = (): Observer => ({ x: pos.x, y: -pos.z, vx: 0, vy: 0, yaw, onFoot: true, vehicle: null });
  const navDebug = nav && navParam ? new NavDebug(nav.graph, terrain, navParam === "all") : null;
  if (navDebug) scene.add(navDebug.group);
  // Voiliers du plan d'eau du Vallon (D249), comme dans le jeu (?day= règle la saison).
  const sailboats = new Sailboats();
  scene.add(sailboats.group);
  const meter = new FrameMeter(renderer, debugEl);
  let last = performance.now();
  const fwd = new THREE.Vector3();
  const tick = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const speed = (keys.has("ShiftLeft") ? 25 : 6) * dt;
    fwd.set(Math.sin(yaw), 0, -Math.cos(yaw));
    if (keys.has("KeyW") || keys.has("ArrowUp")) pos.addScaledVector(fwd, speed);
    if (keys.has("KeyS") || keys.has("ArrowDown")) pos.addScaledVector(fwd, -speed);
    if (keys.has("KeyD") || keys.has("ArrowRight")) pos.add(new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(speed));
    if (keys.has("KeyA") || keys.has("ArrowLeft")) pos.add(new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(-speed));
    if (keys.has("KeyE")) pos.y += speed;
    if (keys.has("KeyQ")) pos.y -= speed;
    camera.position.copy(pos);
    const cp = Math.cos(pitch);
    camera.lookAt(pos.x + Math.sin(yaw) * cp, pos.y + Math.sin(pitch), pos.z - Math.cos(yaw) * cp);
    sky.position.copy(camera.position);
    atmosphere.advance(dt);
    sunDir.copy(atmosphere.lightDir);
    sunLight.position.copy(sunDir).multiplyScalar(400);
    tiles.update(pos.x, -pos.z);
    terrainView.update(pos.x, -pos.z);
    vista.update(pos.x, -pos.z, pos.y, dt, true);
    sailboats.update(now / 1000, atmosphere.hour, atmosphere.calendar.season, atmosphere.calendar.weekday, tiles.loadedExtras().flatMap((e) => e.sail ?? []));
    nav?.update(pos.x, -pos.z);
    navDebug?.update(pos.x, -pos.z);
    if (pedSim && crowd && nav!.graph.edgeCount > 0) {
      pedSim.step(dt, observer());
      crowd.update(pedSim.state, pos.x, pos.z);
    }
    if (pigSim && pigView && nav!.graph.edgeCount > 0) {
      if (!sheet) pigSim.step(dt, pigObserver());
      pigView.update(sheet ?? pigSim.state, pos.x, -pos.z, 100);
    }
    renderer.render(scene, camera);
    meter.tick(dt);
    requestAnimationFrame(tick);
  };
  if (params.has("debug")) debugEl.style.display = "block";
  requestAnimationFrame(tick);
  if (nav) {
    void nav.preload(v[0], v[1]).then(() => {
      if (pedSim && crowd) {
        // Les passants ont déjà marché un moment : on simule `warm` secondes avant la première image.
        pedSim.prefill(observer());
        for (let i = 0, n = Math.round(Number(params.get("warm") ?? 20) * 60); i < n; i++) pedSim.step(1 / 60, observer());
        // ?hit=3 : trois passants autour de la cible sont poussés (captures des chutes), puis on laisse 1,2 s passer.
        const hits = Math.min(Math.max(Math.floor(Number(params.get("hit") ?? 0)) || 0, 0), 20);
        if (hits > 0) {
          const near: number[] = [];
          pedSim.queryCircle(v[3], v[4], 30, near);
          near.slice(0, hits).forEach((slot, k) => pedSim.applyImpulse(slot, 5.5 - (k % 2) * 3, 1.5 * (k % 3 - 1)));
          for (let i = 0; i < Math.round(Number(params.get("after") ?? 1.2) * 60); i++) pedSim.step(1 / 60, observer());
        }
        crowd.update(pedSim.state, pos.x, pos.z);
        crowd.setShadows(true);
      }
      if (pigSim && pigView) {
        const obs = pigObserver;
        pigSim.prefill(obs());
        for (let i = 0, n = Math.round(Number(params.get("warm") ?? 20) * 60); i < n; i++) pigSim.step(1 / 60, obs());
        const scare = Number(params.get("scare") ?? 0);
        if (scare > 0) {
          pigSim.scatter(v[3], v[4], 40);
          for (let i = 0; i < Math.round(scare * 60); i++) pigSim.step(1 / 60, obs());
        }
        pigView.update(sheet ?? pigSim.state);
        if (params.has("debug")) console.log("pigeons", JSON.stringify(pigSim.stats), JSON.stringify(pigSim.spotList().filter((sp) => sp.busy).map((sp) => [Math.round(sp.x), Math.round(sp.y)])), JSON.stringify(Array.from(pigSim.state.alive).flatMap((a, i) => (a ? [[+pigSim.state.x[i]!.toFixed(1), +pigSim.state.y[i]!.toFixed(1)]] : [])).slice(0, 8)));
      }
      ctx.ready();
    });
  } else ctx.ready();
}

/** Huit oiseaux dans huit poses (debout, coup de bec, marche, alerte, montée, descente, plané, atterrissage) et les quatre plumages. */
function pigeonSheet(terrain: { heightAt(x: number, y: number): number }, x0: number, y0: number): PigeonState {
  const n = 8, f = (): Float32Array => new Float32Array(n);
  const st: PigeonState = { capacity: n, alive: new Uint8Array(n).fill(1), x: f(), y: f(), z: f(), heading: f(), pitch: f(), wing: f(), wing2: f(), fold: f(), peck: f(), bob: f(), tint: new Uint8Array(n) };
  const poses = [
    { }, { peck: 1 }, { bob: 0.014 }, { fold: 0.35, wing: 0.3 },
    { fold: 1, wing: 0.9, wing2: 0.4, pitch: 0.5, up: 1.0 }, { fold: 1, wing: -0.7, wing2: -0.4, pitch: -0.2, up: 1.0 }, { fold: 1, wing: 0.15, up: 1.0 }, { fold: 1, wing: 0.9, wing2: 0.5, pitch: 0.7, up: 0.5 },
  ];
  poses.forEach((p: { peck?: number; bob?: number; fold?: number; wing?: number; wing2?: number; pitch?: number; up?: number }, i) => {
    st.x[i] = x0 + i * 0.7;
    st.y[i] = y0;
    st.z[i] = terrain.heightAt(st.x[i]!, y0) + (p.up ?? 0);
    st.heading[i] = Math.PI / 2;
    st.peck[i] = p.peck ?? 0;
    st.bob[i] = p.bob ?? 0;
    st.fold[i] = p.fold ?? 0;
    st.wing[i] = p.wing ?? 0;
    st.wing2[i] = p.wing2 ?? 0;
    st.pitch[i] = p.pitch ?? 0;
    st.tint[i] = i % 4;
  });
  return st;
}
