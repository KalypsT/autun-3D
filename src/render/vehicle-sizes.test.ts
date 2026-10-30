import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { flatTerrain } from "../core/testing";
import { createVehicle } from "../core/vehicle";
import { CATALOG } from "../core/vehicle-catalog";
import { buildModel, restGeometryOf } from "../game/vehicles";

describe("deux-roues : le modèle dessiné respecte le gabarit du catalogue", () => {
  it.each(CATALOG.filter((d) => d.family !== "car").map((d) => d.id))("%s", (id) => {
    const def = CATALOG.find((d) => d.id === id)!;
    const model = buildModel(def, 0);
    model.update(createVehicle(0, 0, 0, flatTerrain()));
    model.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.group), size = box.getSize(new THREE.Vector3());
    expect(Math.abs(size.z - def.size.length)).toBeLessThan(0.08);
    expect(Math.abs(size.x - def.size.width)).toBeLessThan(0.08);
    expect(Math.abs(size.y - def.size.height)).toBeLessThan(0.08);
    expect(box.min.y).toBeGreaterThan(-0.03);
    expect(box.min.y).toBeLessThan(0.03);
    // Le conducteur a ses points d'appui : poignées au-dessus du sol, pieds plus bas que la selle.
    const a = model.anchors!;
    const p = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());
    if (model.pose !== "stand") {
      expect(p(a.gripL).y).toBeGreaterThan(p(a.footL).y);
      expect(model.seat.y).toBeGreaterThan(p(a.footL).y);
    }
  });
});

describe("deux-roues : budget de triangles d'un exemplaire garé (D108)", () => {
  // Vélos et trottinettes sont nombreux aux parkings à vélos : plus économes que les motos, rares dans les rues.
  const budget: Record<string, number> = { bike: 1400, kickscooter: 800, moto: 2200 };
  it.each(CATALOG.filter((d) => d.family !== "car").map((d) => d.id))("%s", (id) => {
    const def = CATALOG.find((d) => d.id === id)!;
    expect(restGeometryOf(id).getAttribute("position").count / 3).toBeLessThan(budget[def.family]!);
  });
});

