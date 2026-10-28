import * as THREE from "three";
import { setPart } from "../../core/character-kit";
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
  const mask = new Float32Array(3);
  return {
    name: "B · instances et nuanceur",
    assign: (i, recipe) => rigs.assign(i, recipe),
    update(st, camX, camZ) {
      batches[0].clear();
      batches[1].clear();
      near = far = 0;
      const nd2 = NEAR_DISTANCE * NEAR_DISTANCE;
      const alive = st.alive;
      for (let i = 0; i < st.count; i++) {
        if (alive && !alive[i]) continue;
        const dx = st.x[i]! - camX, dz = st.z[i]! - camZ;
        const lod = dx * dx + dz * dz < nd2 ? 0 : 1;
        if (lod === 0) near++;
        else far++;
        rigs.solve(st, i);
        // Un pistolet tenu s'ajoute au masque (de près seulement : l'arme n'existe pas dans le détail réduit).
        if (st.held && st.held[i] && lod === 0) {
          mask.set(rigs.masks[i]!);
          setPart(mask, "weaponPistol", true);
          batches[lod].push(rigs.render, rigs.colors[i]!, mask);
        } else batches[lod].push(rigs.render, rigs.colors[i]!, rigs.masks[i]!);
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
