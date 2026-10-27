import * as THREE from "three";
import { PART_SPECS } from "../../core/character-kit";
import { partGeometry } from "../character-parts";
import { CrowdRigs } from "./crowd-common";
import { NEAR_DISTANCE, type CrowdRenderer, type CrowdState } from "./crowd-types";

/**
 * Approche C : pièces articulées, regroupées par instances. Chaque pièce du catalogue (tête, cuisse, manche, cheveux…) est un
 * `InstancedMesh` ; le CPU calcule les matrices des 13 os de chaque personnage et les copie dans l'instance de chaque pièce.
 * Appels de dessin : un par pièce présente dans la foule (≈ 25 à 45 par niveau de détail), quel que soit le nombre de personnages.
 * Couleur : `instanceColor` (une par instance de pièce), réécrite à chaque image (version simple, sans optimisation).
 */
export function createPartsCrowd(scene: THREE.Scene, state: CrowdState): CrowdRenderer {
  const rigs = new CrowdRigs(state.recipes);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group();
  scene.add(group);

  interface Slot {
    mesh: THREE.InstancedMesh;
    count: number;
  }
  /** meshes[niveau][pièce] : un InstancedMesh par pièce du catalogue, de capacité suffisante pour toute la foule. */
  const meshes: (Slot | null)[][] = [[], []];
  const capacity = new Int32Array(PART_SPECS.length);
  for (let i = 0; i < state.count; i++) for (const s of rigs.parts[i]!) capacity[s]! += PART_SPECS[s]!.bones.length;
  for (const lod of [0, 1] as const) {
    PART_SPECS.forEach((spec, s) => {
      const geometry = partGeometry(spec, lod);
      if (!geometry || capacity[s] === 0) {
        meshes[lod]![s] = null;
        return;
      }
      const mesh = new THREE.InstancedMesh(geometry, material, capacity[s]!);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity[s]! * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = lod === 0;
      group.add(mesh);
      meshes[lod]![s] = { mesh, count: 0 };
    });
  }

  let near = 0, far = 0;
  return {
    name: "C · pièces groupées",
    update(st, camX, camZ) {
      for (const lod of meshes) for (const m of lod) if (m) m.count = 0;
      near = far = 0;
      const nd2 = NEAR_DISTANCE * NEAR_DISTANCE;
      for (let i = 0; i < st.count; i++) {
        const dx = st.x[i]! - camX, dz = st.z[i]! - camZ;
        const lod = dx * dx + dz * dz < nd2 ? 0 : 1;
        if (lod === 0) near++;
        else far++;
        rigs.solve(st, i);
        const colors = rigs.colors[i]!;
        const list = meshes[lod]!;
        for (const s of rigs.parts[i]!) {
          const slot = list[s];
          if (!slot) continue;
          const spec = PART_SPECS[s]!;
          const matrices = slot.mesh.instanceMatrix.array as Float32Array;
          const tint = slot.mesh.instanceColor!.array as Float32Array;
          for (const bone of spec.bones) {
            const k = slot.count++;
            const src = bone * 16;
            for (let e = 0; e < 16; e++) matrices[k * 16 + e] = rigs.render[src + e]!;
            if (spec.slot >= 0) {
              tint[k * 3] = colors[spec.slot * 3]!;
              tint[k * 3 + 1] = colors[spec.slot * 3 + 1]!;
              tint[k * 3 + 2] = colors[spec.slot * 3 + 2]!;
            } else tint[k * 3] = tint[k * 3 + 1] = tint[k * 3 + 2] = 1;
          }
        }
      }
      for (const lod of meshes) {
        for (const slot of lod) {
          if (!slot) continue;
          slot.mesh.count = slot.count;
          slot.mesh.visible = slot.count > 0;
          slot.mesh.instanceMatrix.needsUpdate = true;
          slot.mesh.instanceColor!.needsUpdate = true;
        }
      }
    },
    setShadows(on) {
      for (const slot of meshes[0]!) if (slot) slot.mesh.castShadow = on;
    },
    lodCounts: () => ({ near, far }),
    dispose() {
      scene.remove(group);
      for (const lod of meshes) for (const slot of lod) slot?.mesh.dispose();
      material.dispose();
    },
  };
}
