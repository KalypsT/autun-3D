import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { gendarmeRecipe } from "../core/character";
import { Health, HOSPITAL_SPAWN } from "../core/health";
import { OFFICER, Officers } from "../core/officers";
import { MAX_CORPSES, PedSim, type Observer } from "../core/pedestrians";
import { Pickups } from "../core/pickups";
import { Signals } from "../core/signals";
import { loadRealNav, loadRealRoadWorld } from "../core/testing";
import { Wanted } from "../core/wanted";
import { Fx } from "../render/fx";
import { CombatBot } from "./combat-bot";
import { NavManager } from "./nav-manager";
import { PoliceController } from "./police";
import { Traffic } from "./traffic";

const { world, colliders } = loadRealRoadWorld();
const { cells } = loadRealNav();
const DT = 1 / 60;

interface Report {
  bad: string[];
  deaths: number;
  shots: number;
  policeShots: number;
  maxCorpses: number;
  maxOfficers: number;
  maxPickups: number;
  maxFx: number;
  maxStars: number;
  kills: number;
}

/**
 * Tout ensemble (J5-6, piège 8) : « Dense » en petit (20 voitures), 100 passants, feux, police réelle à **cinq étoiles**, un tireur au fusil d'assaut qui tient la place
 * et tire sans arrêt sur les passants, des gendarmes armés qui descendent et tirent sur lui, des effets de tir dans le vrai maillage. Quand sa santé tombe à 0 il
 * « meurt » comme dans le jeu (reprise à l'hôpital, police remise à zéro) puis revient sur la place avec cinq étoiles. Rien ne doit s'accumuler ni sortir des bornes.
 */
function soak(seed: number, minutes: number): Report {
  const nav = new NavManager();
  for (const c of cells) nav.graph.add(c);
  const signals = new Signals(nav.graph.road, { t: 0 });
  const traffic = new Traffic(new THREE.Scene(), nav, world.terrain, colliders, () => true, 20, signals, seed);
  const peds = new PedSim(nav.graph, world.terrain, colliders, { capacity: 100 + OFFICER.max, reserved: OFFICER.max, seed });
  peds.signals = signals;
  traffic.setPeds(peds);
  const wanted = new Wanted();
  const police = new PoliceController(wanted, colliders, () => nav.graph.road, () => signals, () => traffic);
  const health = new Health();
  const bot = new CombatBot(peds, colliders, seed);
  const pickups = new Pickups();
  const fx = new Fx(new THREE.Scene());
  const rep: Report = { bad: [], deaths: 0, shots: 0, policeShots: 0, maxCorpses: 0, maxOfficers: 0, maxPickups: 0, maxFx: 0, maxStars: 0, kills: 0 };
  const home = { x: -10, y: -40 };
  let x = home.x, y = home.y;
  let calm = 0;
  wanted.set(5, x, y);
  const base = peds.reservedStart;
  const seeds = new Int32Array(OFFICER.max).fill(-1), seen = new Uint8Array(OFFICER.max);
  const drops: { x: number; y: number }[] = [];
  const total = minutes * 60 * 60;
  for (let i = 0; i < total; i++) {
    const t = i * DT;
    traffic.step(DT, { kind: "foot", x, y, vx: 0, vy: 0 });
    traffic.update(DT, { x, y, yaw: 0, speed: 0, hour: 15, vehicle: null });
    const obs: Observer = { x, y, vx: 0, vy: 0, yaw: 0, onFoot: true, vehicle: null, hour: 15, vehicles: traffic.bodies(), honks: traffic.takeHonks() };
    if (i === 0) peds.prefill(obs);
    peds.clearEvents();
    peds.step(DT, obs);
    traffic.applyImpacts();
    // Le tireur : tirs, effets.
    const r = bot.step(DT, x, y);
    if (r.fired > 0) {
      fx.flash(x, y, 1.3);
      for (let k = 0; k < r.fxCount; k++) fx.tracer(r.shots[k]!.x0, r.shots[k]!.y0, 1.3, r.shots[k]!.x1, r.shots[k]!.y1, 1.3);
    }
    // La police réelle ; ses gendarmes sont dans les emplacements réservés (cibles et dessin) ; ses tirs retirent des points de vie au tireur.
    police.update(DT, { x, y, vx: 0, vy: 0, heading: 0, speed: 0, driving: false, vehicle: null, pedHits: 0, pedHitSpeed: 0, witnesses: (px, py, rad) => peds.queryCircle(px, py, rad, []) });
    seen.fill(0);
    for (const o of police.officers.list) {
      if (o.slot >= OFFICER.max) rep.bad.push("emplacement hors limite");
      seen[o.slot] = 1;
      const fresh = seeds[o.slot] !== o.seed;
      seeds[o.slot] = o.seed;
      peds.setExternal(base + o.slot, true, fresh ? gendarmeRecipe(o.seed) : null, o.x, o.y, o.heading, o.speed, Officers.pose(o), o.poseT, DT, o.armed && o.mode !== "dead", o.mode === "dead");
    }
    for (let k = 0; k < OFFICER.max; k++) {
      if (seen[k] || seeds[k]! < 0) continue;
      seeds[k] = -1;
      peds.setExternal(base + k, false, null, 0, 0, 0, 0, 0, 0, 0);
    }
    rep.policeShots += police.shots.length;
    for (const sh of police.shots) {
      fx.flash(sh.x0, sh.y0, 1.3);
      fx.tracer(sh.x0, sh.y0, 1.3, sh.x1, sh.y1, 1.3);
    }
    police.clearShots();
    const dmg = police.takeDamage();
    if (dmg > 0) health.damage(dmg);
    drops.length = 0;
    police.takeDrops(drops);
    for (const d of drops) pickups.drop(d.x, d.y, "pistol", 12);
    pickups.update(DT);
    fx.update(DT, [], t);
    health.update(DT);
    if (health.takeDeath()) {
      // Comme `die()` du jeu : police remise à zéro, santé pleine, à l'hôpital ; puis le tireur revient sur la place, de nouveau à cinq étoiles.
      rep.deaths++;
      police.reset();
      wanted.clear();
      calm = t + 15;
      health.restore();
      x = HOSPITAL_SPAWN.x;
      y = HOSPITAL_SPAWN.y;
      for (let k = 0; k < 30; k++) peds.step(DT, { ...obs, x, y });
      x = home.x;
      y = home.y;
    }
    // Quinze secondes de calme après la reprise, puis cinq étoiles de nouveau (le tireur a recommencé à tirer, la police revient).
    if (calm > 0 && t >= calm) {
      calm = 0;
      wanted.set(5, x, y);
    }
    signals.clock.t += DT;
    const st = peds.stats;
    rep.maxCorpses = Math.max(rep.maxCorpses, st.corpses - st.sinking);
    rep.maxOfficers = Math.max(rep.maxOfficers, police.officers.alive());
    rep.maxPickups = Math.max(rep.maxPickups, pickups.list.length);
    rep.maxFx = Math.max(rep.maxFx, fx.count);
    rep.maxStars = Math.max(rep.maxStars, wanted.stars);
    if (!Number.isFinite(peds.checksum()) || !Number.isFinite(health.hp) || health.hp < 0 || health.hp > 100) rep.bad.push("valeur hors bornes");
    if (st.alive + st.corpses > 100) rep.bad.push("emplacement perdu");
  }
  rep.shots = bot.shots;
  rep.kills = bot.kills;
  traffic.dispose();
  return rep;
}

describe("combat, police armée, circulation et foule ensemble (J5-6)", () => {
  it("quatre minutes à cinq étoiles avec un tireur sur la place : rien ne s'accumule, rien ne sort des bornes, le joueur meurt et reprend", () => {
    for (const seed of [3, 11]) {
      const r = soak(seed, 4);
      expect(r.bad).toEqual([]);
      expect(r.shots).toBeGreaterThan(200);
      expect(r.kills).toBeGreaterThan(5);
      expect(r.maxCorpses).toBeLessThanOrEqual(MAX_CORPSES);
      expect(r.maxOfficers).toBeLessThanOrEqual(OFFICER.max);
      expect(r.maxFx).toBeLessThanOrEqual(192);
      expect(r.maxStars).toBeLessThanOrEqual(5);
      // Les armes lâchées s'accumulent peu (3 minutes de vie chacune).
      expect(r.maxPickups).toBeLessThan(13 + 40);
      expect(r.deaths).toBeGreaterThan(2);
      expect(r.deaths).toBeLessThan(25);
    }
  }, 900000);
});
