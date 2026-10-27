import * as THREE from "three";
import { CharacterBatch } from "./character-batch";
import { CrowdRigs } from "./crowd-common";
import { NEAR_DISTANCE, type CrowdRenderer, type CrowdState } from "./crowd-types";

/**
 * Foule : deux lots (détail complet près de la caméra, détail réduit au loin), chacun d'un seul appel de dessin (D37).
 * Les matrices sont en coordonnées du monde : les lots restent à l'origine de la scène.
 */
export function createCrowd(scene: THREE.Scene, state: CrowdState): CrowdRenderer {
  const rigs = new CrowdRigs(state.recipes);
  const batches = [new CharacterBatch(0, state.count), new CharacterBatch(1, state.count)] as const;
  const group = new THREE.Group();
  for (const b of batches) group.add(b.mesh);
  scene.add(group);
  let near = 0, far = 0;
  return {
    name: "B · instances et nuanceur",
    update(st, camX, camZ) {
      batches[0].clear();
      batches[1].clear();
      near = far = 0;
      const nd2 = NEAR_DISTANCE * NEAR_DISTANCE;
      for (let i = 0; i < st.count; i++) {
        const dx = st.x[i]! - camX, dz = st.z[i]! - camZ;
        const lod = dx * dx + dz * dz < nd2 ? 0 : 1;
        if (lod === 0) near++;
        else far++;
        rigs.solve(st, i);
        batches[lod].push(rigs.render, rigs.colors[i]!, rigs.masks[i]!);
      }
      batches[0].flush();
      batches[1].flush();
    },
    setShadows(on) {
      batches[0].mesh.castShadow = on;
    },
    lodCounts: () => ({ near, far }),
    dispose() {
      scene.remove(group);
      for (const b of batches) b.dispose();
    },
  };
}
