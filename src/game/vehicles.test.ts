import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Colliders } from "../core/collision";
import { flatTerrain } from "../core/testing";
import { CATALOG } from "../core/vehicle-catalog";
import { buildModel, chaseOf, Fleet, FORGET, MODEL_BUILDERS } from "./vehicles";
import { vehicleDef } from "../core/vehicle-catalog";

const make = (): Fleet => new Fleet(new THREE.Scene(), new Colliders(), flatTerrain());

describe("véhicules et sauvegarde", () => {
  it("seuls les véhicules déplacés (ou conduits) sont enregistrés", () => {
    const fleet = make();
    const a = fleet.add("velo-ville", "velo-1-0", 0, 0, 0, 1);
    fleet.add("citadine", "voiture-5,5", 20, 0, 1, 2);
    expect(fleet.savedVehicles()).toEqual([]);
    a.state.x = 12;
    a.state.y = -3;
    const saved = fleet.savedVehicles();
    expect(saved).toEqual([{ id: "velo-1-0", model: "velo-ville", variant: 1, x: 12, y: -3, heading: 0 }]);
    a.state.x = 0.2;
    a.state.y = 0;
    expect(fleet.savedVehicles()).toEqual([]);
    a.ridden = true;
    expect(fleet.savedVehicles()).toHaveLength(1);
  });

  it("un véhicule retrouvé n'est pas recréé à sa place d'origine quand sa tuile se charge, et reste à enregistrer", () => {
    const first = make();
    const v = first.add("trottinette", "trottinette-9-3", 5, 5, 0, 4);
    v.state.x = 40;
    v.state.y = 41;
    const saved = first.savedVehicles();

    const second = make();
    second.restore(saved);
    const again = second.add("trottinette", "trottinette-9-3", 5, 5, 0, 4);
    expect(again.state.x).toBe(40);
    expect(second.vehicles).toHaveLength(1);
    // Son origine est inconnue : il est enregistré à chaque fois, même s'il n'a plus bougé depuis.
    expect(second.savedVehicles()).toHaveLength(1);
    expect(second.get("trottinette-9-3")).toBe(again);
    expect(second.get("inconnu")).toBeNull();
  });
});

describe("véhicules laissés (D301)", () => {
  const far = FORGET.distance + 50;
  /** Le joueur reste en (px, py) pendant `t` secondes, par pas de 0,5 s ; rend les véhicules oubliés. */
  const wait = (fleet: Fleet, px: number, py: number, t: number, keep: Parameters<Fleet["forget"]>[3] = null, hold: Parameters<Fleet["forget"]>[4] = null) => {
    const out = [];
    for (let s = 0; s < t; s += 0.5) out.push(...fleet.forget(px, py, 0.5, keep, hold));
    return out;
  };

  it("une voiture de stationnement déplacée revient intacte à sa place quand le joueur est loin depuis assez longtemps", () => {
    const fleet = make();
    const v = fleet.add("citadine", "voiture-s1,1", 0, 0, 0, 2);
    v.state.x = 30;
    v.damage.damage(40);
    // Joueur loin de la voiture et de sa place, un peu moins longtemps que le délai : rien.
    expect(wait(fleet, 0, far + 30, FORGET.delay - 1)).toEqual([]);
    // Il revient près d'elle : le compteur repart de zéro.
    wait(fleet, 30, 10, 1);
    expect(wait(fleet, 0, far + 30, FORGET.delay - 1)).toEqual([]);
    expect(wait(fleet, 0, far + 30, 2)).toEqual([v]);
    expect(fleet.get("voiture-s1,1")).toBe(v);
    expect([v.state.x, v.state.y]).toEqual([0, 0]);
    expect(v.damage.health).toBe(100);
    expect(fleet.savedVehicles()).toEqual([]);
  });

  it("elle attend tant que sa place est près du joueur", () => {
    const fleet = make();
    const v = fleet.add("citadine", "voiture-s2,2", 0, 0, 0, 2);
    v.state.x = far + 100;
    expect(wait(fleet, 0, 10, FORGET.delay * 2)).toEqual([]);
    expect(v.state.x).toBe(far + 100);
  });

  it("une voiture volée ou abandonnée disparaît ; le dernier véhicule utilisé, les véhicules à leur place, uniques et épaves restent", () => {
    const fleet = make();
    const stolen = fleet.add("citadine", "volee-a-1", 0, 0, 0, 0, null);
    const left = fleet.add("citadine", "abandon-a-2", 5, 0, 0, 0);
    left.state.y = 4;
    const last = fleet.add("citadine", "volee-a-3", 10, 0, 0, 0, null);
    const parked = fleet.add("citadine", "voiture-s3,3", 15, 0, 0, 0);
    const unique = fleet.add("supercar", "unique-x", 20, 0, 0, 0, null);
    const wreck = fleet.add("citadine", "volee-a-4", 25, 0, 0, 0, null);
    wreck.damage.restore(0, { front: 1, rear: 1, left: 0, right: 0 }, "explosion");
    const gone = wait(fleet, 0, far, FORGET.delay + 1, last);
    expect(gone.map((v) => v.id).sort()).toEqual(["abandon-a-2", "volee-a-1"]);
    expect(fleet.get(stolen.id)).toBeNull();
    expect(fleet.vehicles).toEqual([last, parked, unique, wreck]);
    // Le joueur en prend un autre : l'ancien dernier véhicule redevient oubliable.
    expect(wait(fleet, 0, far, FORGET.delay + 1, parked)).toEqual([last]);
  });

  it("une voiture de stationnement retrouvée dans une sauvegarde apprend sa place quand sa tuile la recrée, sinon elle est retirée", () => {
    const first = make();
    const a = first.add("citadine", "voiture-s4,4", 0, 0, 0, 1);
    const b = first.add("citadine", "voiture-s5,5", 50, 0, 0, 1);
    a.state.x = 30;
    b.state.x = 80;
    const second = make();
    second.restore(first.savedVehicles());
    // Seule la tuile de la première est construite.
    second.add("citadine", "voiture-s4,4", 0, 0, 0, 1);
    wait(second, 0, far + 60, FORGET.delay + 1);
    expect(second.get("voiture-s4,4")?.state.x).toBe(0);
    expect(second.get("voiture-s5,5")).toBeNull();
  });

  it("une voiture dont la place est sur le marché installé est confiée au marché au lieu d'y revenir", () => {
    const fleet = make();
    const v = fleet.add("citadine", "voiture-s6,6", 0, 0, 0, 1);
    v.state.x = 30;
    const held: string[] = [];
    expect(wait(fleet, 0, far + 30, FORGET.delay + 1, null, (c) => (held.push(c.id), true))).toEqual([v]);
    expect(held).toEqual(["voiture-s6,6"]);
    expect(fleet.get(v.id)).toBeNull();
  });
});

describe("voiture garée à hauteur (D303)", () => {
  it("on la survole, on bute dessus plus bas ; sans altitude (passants, circulation), elle reste pleine", () => {
    const colliders = new Colliders();
    const fleet = new Fleet(new THREE.Scene(), colliders, flatTerrain());
    const v = fleet.add("citadine", "voiture-s9,9", 0, 0, 0, 1);
    const h = v.def.size.height;
    expect(colliders.resolve(0.5, 0, 0.5).hit).toBe(true);
    expect(colliders.resolve(0.5, 0, 0.5, 0, 0).hit).toBe(true);
    expect(colliders.resolve(0.5, 0, 0.5, 0, h - 0.5).hit).toBe(true);
    expect(colliders.resolve(0.5, 0, 0.5, 0, h + 0.1).hit).toBe(false);
  });
});

describe("catalogue et dessin", () => {
  it("chaque modèle du catalogue a son dessin, de chaque couleur de sa palette", () => {
    expect(Object.keys(MODEL_BUILDERS).sort()).toEqual(CATALOG.map((d) => d.id).sort());
    for (const d of CATALOG) {
      for (let variant = 0; variant < d.palette.length; variant++) {
        const m = buildModel(d, variant);
        expect(m.group.children.length).toBeGreaterThan(0);
        m.dispose();
      }
    }
  });

  it("un modèle inconnu est refusé, et une voiture garée n'a pas de modèle articulé avant qu'on y monte", () => {
    const fleet = make();
    expect(() => fleet.add("char-d-assaut", "x", 0, 0, 0, 0)).toThrow();
    const car = fleet.add("citadine", "voiture-1,1", 0, 0, 0, 3);
    expect(car.model).toBeNull();
    expect(car.family).toBe("car");
    expect(fleet.take(car)).toBe(car.model);
  });
});

describe("caméra de poursuite par modèle", () => {
  it("la citadine garde celle de sa famille ; une camionnette est plus loin et plus haut, une sportive plus près et plus basse", () => {
    const cam = (id: string) => chaseOf({ def: vehicleDef(id)! });
    const base = cam("citadine");
    expect(base).toEqual({ distance: 6.2, perSpeed: 0.06, height: 0.55 });
    expect(cam("camionnette").distance).toBeGreaterThan(base.distance + 1);
    expect(cam("camionnette").height).toBeGreaterThan(base.height);
    expect(cam("sportive").height).toBeLessThan(base.height);
    expect(cam("moto-routiere")).toEqual(chaseOf({ def: vehicleDef("moto-routiere")! }));
  });
});

describe("véhicules garés selon le quartier (D55)", () => {
  /** Un parking de `n` places côte à côte : deux traits de 4,8 m tous les 2,5 m. */
  const lot = (n: number, x0: number): number[][][] =>
    Array.from({ length: n + 1 }, (_, i) => [[x0 + i * 2.5 - 0.05, 0, x0 + i * 2.5 + 0.05, 0, x0 + i * 2.5 + 0.05, 4.8, x0 + i * 2.5 - 0.05, 4.8]]);
  const tile = (buildings: number, x0: number, id = "t") => ({ id, buildings, furniture: [], stairs: [], marks: lot(600, x0) });
  const models = (fleet: Fleet, prefix: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const v of fleet.vehicles) if (v.id.startsWith(prefix)) out[v.def.id] = (out[v.def.id] ?? 0) + 1;
    return out;
  };

  it("un grand parking de centre-ville mêle les huit modèles de voiture, avec peu de sportives", () => {
    const fleet = make();
    fleet.addFromTile(tile(200, 0));
    const cars = models(fleet, "voiture-");
    const total = Object.values(cars).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(120);
    expect(Object.keys(cars).length).toBeGreaterThanOrEqual(7);
    expect((cars["sportive"] ?? 0) / total).toBeLessThan(0.06);
    expect(Object.keys(cars).every((id) => CATALOG.find((d) => d.id === id)?.family === "car")).toBe(true);
    expect(Object.keys(models(fleet, "moto-")).every((id) => CATALOG.find((d) => d.id === id)?.family === "moto")).toBe(true);
  });

  it("le même parking en périphérie a plus de camionnettes qu'en centre-ville ; la tuile qui se recharge ne change rien", () => {
    const centre = make(), outskirts = make();
    centre.addFromTile(tile(200, 0));
    outskirts.addFromTile(tile(10, 0));
    expect(models(outskirts, "voiture-")["camionnette"]!).toBeGreaterThan(models(centre, "voiture-")["camionnette"]!);
    const before = centre.vehicles.length;
    centre.addFromTile(tile(200, 0));
    expect(centre.vehicles).toHaveLength(before);
  });

  it("un modèle garé reste le même véhicule dans la sauvegarde (identifiant et modèle)", () => {
    const fleet = make();
    fleet.addFromTile(tile(10, 0));
    const van = fleet.vehicles.find((v) => v.def.id === "camionnette")!;
    van.state.x += 30;
    const saved = fleet.savedVehicles().find((v) => v.id === van.id)!;
    expect(saved.model).toBe("camionnette");
    const again = make();
    again.restore([saved]);
    again.addFromTile(tile(200, 0));
    expect(again.get(van.id)!.def.id).toBe("camionnette");
  });
});

describe("modèle articulé seulement à la conduite", () => {
  it("un vélo garé est une instance : il reçoit son modèle quand on le prend, le perd quand on le pose", () => {
    const scene = new THREE.Scene();
    const fleet = new Fleet(scene, new Colliders(), flatTerrain());
    const bike = fleet.add("velo-ville", "velo-1-0", 0, 0, 0, 2);
    const before = scene.children.length;
    expect(bike.model).toBeNull();
    const model = fleet.take(bike);
    expect(bike.model).toBe(model);
    expect(scene.children.length).toBe(before + 1);
    fleet.park(bike);
    expect(bike.model).toBeNull();
    expect(scene.children.length).toBe(before);
  });

  it("les véhicules proches sont dessinés en un maillage par modèle, ceux qu'on conduit n'y sont plus, les lointains non plus", () => {
    const fleet = new Fleet(new THREE.Scene(), new Colliders(), flatTerrain());
    fleet.add("citadine", "c1", 0, 0, 0, 0);
    fleet.add("citadine", "c2", 5, 0, 0, 1);
    fleet.add("berline", "b1", 10, 0, 0, 0);
    fleet.add("moto-sportive", "m1", 15, 0, 0, 0);
    const far = fleet.add("scooter-125", "s-far", 90, 0, 0, 0);
    fleet.cull(0, 0);
    expect(fleet.stats).toMatchObject({ total: 5, drawn: 5, meshes: 4 });
    fleet.take(fleet.get("c1")!);
    fleet.cull(0, 0);
    expect(fleet.stats).toMatchObject({ drawn: 4, meshes: 4 });
    far.state.x = 400;
    fleet.park(far);
    fleet.cull(0, 0);
    expect(fleet.stats).toMatchObject({ drawn: 3, meshes: 3 });
  });
});


describe("feux tricolores et voitures du joueur (D160)", () => {
  it("les feux ne gênent que les voitures du joueur (carOnly) : la circulation et les passants les traversent ; une tuile déchargée les retire", () => {
    const colliders = new Colliders();
    const fleet = new Fleet(new THREE.Scene(), colliders, flatTerrain());
    const furniture = [{ kind: "traffic_signals", x: 10, y: 10, name: null, id: 42 }, { kind: "street_lamp", x: 20, y: 10, name: null, id: 43 }];
    fleet.addFromTile({ id: "t1", buildings: 0, furniture, stairs: [], marks: [] });
    expect(fleet.carOnly.resolve(10, 10, 0.5).hit).toBe(true);
    expect(colliders.resolve(10, 10, 0.5).hit).toBe(false);
    // Le lampadaire n'est pas un obstacle réservé aux voitures : c'est `addTileColliders` qui s'en charge.
    expect(fleet.carOnly.resolve(20, 10, 0.5).hit).toBe(false);
    fleet.removeTile("t1");
    expect(fleet.carOnly.resolve(10, 10, 0.5).hit).toBe(false);
  });
});
