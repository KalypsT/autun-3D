import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createVehicle } from "../core/vehicle";
import { CATALOG, vehicleDef } from "../core/vehicle-catalog";
import { flatTerrain } from "../core/testing";
import { brokenLamps, crumplePoint, CRUSH, type CrumpleFrame } from "./car-damage";
import { CAR_BODIES, carRestGeometry, chimneyOf, createCarModel, DENTED, vendorOf } from "./car-model";
import { Smoke } from "./smoke";

const frame: CrumpleFrame = { noseZ: -2, tailZ: 2, halfWidth: 0.9, belt: 0.9, light: [], tail: [], glass: "#000000" };
const none = { front: 0, rear: 0, left: 0, right: 0 };
const v = new THREE.Vector3();

describe("carrosserie froissée (D110)", () => {
  it("sans dégât, rien ne bouge", () => {
    for (const [x, y, z] of [[0.5, 0.4, -2], [-0.9, 1.2, 0.3], [0, 0.3, 2]] as const) {
      expect(crumplePoint(x, y, z, none, frame, v)).toBe(0);
      expect(v.toArray()).toEqual([x, y, z]);
    }
  });

  it("l'avant écrasé recule le nez, pas la queue ; le flanc droit enfoncé rentre vers l'intérieur, pas le gauche", () => {
    const front = { ...none, front: 1 };
    const wear = crumplePoint(0.3, 0.5, -2, front, frame, v);
    expect(v.z).toBeGreaterThan(-2 + CRUSH.end * 0.6);
    expect(wear).toBeGreaterThan(0.9);
    crumplePoint(0.3, 0.5, 2, front, frame, v);
    expect(v.z).toBe(2);
    const right = { ...none, right: 1 };
    crumplePoint(0.9, 0.5, 0, right, frame, v);
    expect(v.x).toBeLessThan(0.9 - CRUSH.side * 0.6);
    crumplePoint(-0.9, 0.5, 0, right, frame, v);
    expect(v.x).toBe(-0.9);
  });

  it("deux sommets confondus bougent pareil (pas de fente entre deux faces)", () => {
    const zones = { front: 0.8, rear: 0.3, left: 0.5, right: 0 };
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    crumplePoint(-0.7, 0.85, -1.6, zones, frame, a);
    crumplePoint(-0.7, 0.85, -1.6, zones, frame, b);
    expect(a.equals(b)).toBe(true);
  });

  it("phares cassés : du côté le plus touché à partir de 45 %, les deux au-delà de 80 %", () => {
    expect(brokenLamps({ ...none, front: 0.3 })).toEqual({ headRight: false, headLeft: false, tailRight: false, tailLeft: false });
    expect(brokenLamps({ ...none, front: 0.6, left: 0.4 })).toMatchObject({ headLeft: true, headRight: false });
    expect(brokenLamps({ ...none, front: 0.6 })).toMatchObject({ headRight: true, headLeft: false });
    expect(brokenLamps({ ...none, front: 0.9 })).toMatchObject({ headRight: true, headLeft: true });
    expect(brokenLamps({ ...none, rear: 0.9 })).toMatchObject({ tailRight: true, tailLeft: true, headRight: false });
  });

  it("une vraie voiture : l'avant écrasé raccourcit le modèle, fêle le pare-brise, éteint les phares ; réparée, elle redevient exactement neuve", () => {
    const def = vehicleDef("berline")!;
    const model = createCarModel(def.id, "#1f3a52");
    model.update(createVehicle(0, 0, 0, flatTerrain()));
    const meshes: THREE.Mesh[] = [];
    model.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const body = meshes[0]!.geometry, detail = meshes[1]!.geometry;
    const before = (body.getAttribute("position").array as Float32Array).slice();
    const colors = (detail.getAttribute("color").array as Float32Array).slice();
    body.computeBoundingBox();
    const nose0 = body.boundingBox!.min.z;
    const broken = model.setDamage!({ front: 1, rear: 0, left: 0, right: 0 });
    expect(broken.headLeft && broken.headRight).toBe(true);
    body.computeBoundingBox();
    expect(body.boundingBox!.min.z).toBeGreaterThan(nose0 + 0.2);
    for (const g of [body, detail]) expect((g.getAttribute("position").array as Float32Array).every(Number.isFinite)).toBe(true);
    const changed = (detail.getAttribute("color").array as Float32Array).filter((c, i) => Math.abs(c - colors[i]!) > 0.05).length;
    expect(changed).toBeGreaterThan(30);
    model.setDamage!({ front: 0, rear: 0, left: 0, right: 0 });
    expect(Array.from(body.getAttribute("position").array as Float32Array)).toEqual(Array.from(before));
    expect(Array.from(detail.getAttribute("color").array as Float32Array)).toEqual(Array.from(colors));
    model.dispose();
  });
});

describe("fumée (D110)", () => {
  it("rien à l'écran sans bouffée ; une bouffée monte puis disparaît au bout de sa vie ; la capacité n'est jamais dépassée", () => {
    const smoke = new Smoke(null);
    smoke.update(0.1);
    expect(smoke.mesh.visible).toBe(false);
    const grey = new THREE.Color("#888888");
    smoke.emit(0, 0, 1, 0, 0, 1, grey, 0.2, 0.8, 1, Math.random);
    smoke.update(0.5);
    expect(smoke.count).toBe(1);
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    smoke.mesh.getMatrixAt(0, m);
    expect(p.setFromMatrixPosition(m).y).toBeGreaterThan(1);
    smoke.update(0.6);
    expect(smoke.count).toBe(0);
    expect(smoke.mesh.visible).toBe(false);
    for (let i = 0; i < 400; i++) smoke.emit(0, 0, 0, 0, 0, 1, grey, 0.2, 0.8, 5, Math.random);
    smoke.update(0.1);
    expect(smoke.count).toBe(smoke.mesh.instanceMatrix.count);
    smoke.dispose();
  });
});

describe("forme abîmée des voitures dessinées par instances (D112)", () => {
  it("chaque voiture a sa forme cabossée : même nombre de triangles, avant reculé, aucune valeur absurde", () => {
    for (const def of CATALOG.filter((d) => d.family === "car")) {
      const neat = carRestGeometry(def.id), dented = carRestGeometry(def.id + DENTED);
      expect(dented.getAttribute("position").count).toBe(neat.getAttribute("position").count);
      expect((dented.getAttribute("position").array as Float32Array).every(Number.isFinite)).toBe(true);
      neat.computeBoundingBox();
      dented.computeBoundingBox();
      expect(dented.boundingBox!.min.z).toBeGreaterThan(neat.boundingBox!.min.z + 0.1);
      // La peinture reste blanc pur (teintée par instance) : autant de sommets blancs qu'avant.
      const white = (g: THREE.BufferGeometry): number => {
        const c = g.getAttribute("color");
        let n = 0;
        for (let i = 0; i < c.count; i++) if (Math.min(c.getX(i), c.getY(i), c.getZ(i)) > 0.999) n++;
        return n;
      };
      expect(white(dented)).toBe(white(neat));
    }
  });
});

describe("camions-restaurants (D115)", () => {
  it("le vendeur se tient dans la caisse, derrière l'ouverture ; seul le camion pizza a une cheminée ; une voiture ordinaire n'a ni l'un ni l'autre", () => {
    for (const id of ["pizza-du-vallon", "rotisserie-champ-de-mars"]) {
      const v = vendorOf(id)!, p = CAR_BODIES[id]!;
      expect(Math.abs(v.x)).toBeLessThan(p.width / 2 - 0.2);
      expect(v.y).toBeGreaterThan(p.clearance - 0.1);
      expect(v.y + 1.7).toBeGreaterThan(p.foodTruck!.bottom + 0.5);
    }
    expect(chimneyOf("pizza-du-vallon")![1]).toBeGreaterThan(CAR_BODIES["pizza-du-vallon"]!.height);
    expect(chimneyOf("rotisserie-champ-de-mars")).toBeNull();
    // La pizza s'ouvre à gauche, la rôtisserie à droite : le vendeur et la cheminée sont du côté de l'ouverture.
    expect(vendorOf("pizza-du-vallon")!).toMatchObject({ side: -1 });
    expect(vendorOf("pizza-du-vallon")!.x).toBeLessThan(0);
    expect(chimneyOf("pizza-du-vallon")![0]).toBeLessThan(0);
    expect(vendorOf("rotisserie-champ-de-mars")!).toMatchObject({ side: 1 });
    expect(vendorOf("citadine")).toBeNull();
  });
});
