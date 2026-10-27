import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BONE_COUNT, createPose, PARENT, solveBones, walkPose } from "../../core/character-rig";
import { recipeParts, type Lod } from "../character-parts";
import { CrowdRigs } from "./crowd-common";
import { NEAR_DISTANCE, type CrowdRenderer, type CrowdState } from "./crowd-types";

/**
 * Approche A : un `SkinnedMesh` par personnage (peau et os à la façon de three.js). La géométrie de chaque personnage fusionne ses
 * pièces dans la pose de repos, avec les couleurs de sa recette cuites dans les sommets ; les 13 os sont de vrais `THREE.Bone`.
 * Un appel de dessin par personnage (deux avec l'ombre). Au loin, on échange la géométrie contre une version à peu de facettes.
 */
export function createSkinnedCrowd(scene: THREE.Scene, state: CrowdState): CrowdRenderer {
  const rigs = new CrowdRigs(state.recipes);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group();
  scene.add(group);
  const restPose = createPose();
  const restRender = new Float32Array(BONE_COUNT * 16), restWorld = new Float32Array(BONE_COUNT * 16);
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const m4 = new THREE.Matrix4();

  interface Member {
    mesh: THREE.SkinnedMesh;
    geometries: [THREE.BufferGeometry, THREE.BufferGeometry];
    bones: THREE.Bone[];
    lod: Lod;
  }
  const members: Member[] = [];
  for (let i = 0; i < state.count; i++) {
    const recipe = state.recipes[i]!;
    // Repos (angles nuls, racine à l'origine) : les formes y sont placées une fois pour toutes.
    solveBones(restRender, restWorld, rigs.offsets[i]!, rigs.scales[i]!, restPose, { x: 0, y: 0, z: 0, yaw: 0 });

    const build = (lod: Lod): THREE.BufferGeometry => {
      const pieces: THREE.BufferGeometry[] = [];
      for (const { spec, geometry } of recipeParts(recipe, lod)) {
        for (const bone of spec.bones) {
          const g = geometry.clone();
          g.applyMatrix4(m4.fromArray(restRender, bone * 16));
          const n = g.getAttribute("position").count;
          // Couleur cuite : modulation de la forme × couleur d'emplacement.
          const col = g.getAttribute("color") as THREE.BufferAttribute;
          if (spec.slot >= 0) {
            const t = rigs.colors[i]!;
            for (let v = 0; v < n; v++) col.setXYZ(v, col.getX(v) * t[spec.slot * 3]!, col.getY(v) * t[spec.slot * 3 + 1]!, col.getZ(v) * t[spec.slot * 3 + 2]!);
          }
          const index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
          for (let v = 0; v < n; v++) {
            index[v * 4] = bone;
            weight[v * 4] = 1;
          }
          g.setAttribute("skinIndex", new THREE.BufferAttribute(index, 4));
          g.setAttribute("skinWeight", new THREE.BufferAttribute(weight, 4));
          pieces.push(g);
        }
      }
      const merged = mergeGeometries(pieces)!;
      pieces.forEach((p) => p.dispose());
      return merged;
    };

    const bones: THREE.Bone[] = [];
    const o = rigs.offsets[i]!;
    for (let b = 0; b < BONE_COUNT; b++) {
      const bone = new THREE.Bone();
      bone.position.set(o[b * 3]!, o[b * 3 + 1]!, o[b * 3 + 2]!);
      bones.push(bone);
      if (PARENT[b]! >= 0) bones[PARENT[b]!]!.add(bone);
    }
    const geometries: [THREE.BufferGeometry, THREE.BufferGeometry] = [build(0), build(1)];
    const mesh = new THREE.SkinnedMesh(geometries[0], material);
    mesh.add(bones[0]!);
    mesh.updateMatrixWorld(true);
    const inverses = bones.map((b) => b.matrixWorld.clone().invert());
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    group.add(mesh);
    members.push({ mesh, geometries, bones, lod: 0 });
  }

  let near = 0, far = 0;
  let shadows = true;
  return {
    name: "A · peau et os",
    update(st, camX, camZ) {
      near = far = 0;
      const nd2 = NEAR_DISTANCE * NEAR_DISTANCE;
      const pose = rigs.pose;
      for (let i = 0; i < st.count; i++) {
        const m = members[i]!;
        const dx = st.x[i]! - camX, dz = st.z[i]! - camZ;
        const lod: Lod = dx * dx + dz * dz < nd2 ? 0 : 1;
        if (lod === 0) near++;
        else far++;
        if (lod !== m.lod) {
          m.lod = lod;
          m.mesh.geometry = m.geometries[lod];
        }
        m.mesh.castShadow = lod === 0 && shadows;
        m.mesh.position.set(st.x[i]!, st.y[i]!, st.z[i]!);
        m.mesh.rotation.y = st.yaw[i]!;
        // Même pose que les autres approches.
        walkPose(pose, st.phase[i]!, st.speed[i]!, rigs.dims[i]!);
        const a = pose.angles;
        for (let b = 0; b < BONE_COUNT; b++) {
          euler.set(a[b * 3]!, a[b * 3 + 1]!, a[b * 3 + 2]!);
          m.bones[b]!.quaternion.setFromEuler(euler);
        }
        m.bones[0]!.position.y = rigs.offsets[i]![1]! + pose.rootDy;
      }
    },
    setShadows(on) {
      shadows = on;
    },
    lodCounts: () => ({ near, far }),
    dispose() {
      scene.remove(group);
      for (const m of members) {
        m.mesh.skeleton.dispose();
        m.geometries.forEach((g) => g.dispose());
      }
      material.dispose();
    },
  };
}
