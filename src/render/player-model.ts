import * as THREE from "three";

/** Personnage provisoire en pièces articulées (la marche balance bras et jambes). */
export interface PlayerModel {
  group: THREE.Group;
  /** Place et anime le personnage : position en repère données, cap, phase de pas et vitesse. */
  update(x: number, y: number, z: number, heading: number, stride: number, speed: number): void;
  /** Pose de cycliste, dans le repère local du vélo : bassin sur la selle `seat`, phase de pédalage `crank`. */
  ride(seat: THREE.Vector3, crank: number): void;
}

export function createPlayerModel(): PlayerModel {
  const group = new THREE.Group();
  const mat = (c: string): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: c });
  // Palette de l'affiche : veste vermillon, pantalon bleu nuit, écharpe moutarde, bonnet bleu-vert.
  const jacket = mat("#d9472b"), pants = mat("#1f3a52"), skin = mat("#eeb98f"), hair = mat("#2a6f7e"), scarf = mat("#f1b24a"), shoes = mat("#3a2a20");
  const box = (w: number, h: number, d: number, m: THREE.Material, y: number): THREE.Mesh => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, y, 0);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    return mesh;
  };
  const body = new THREE.Group();
  body.add(box(0.44, 0.62, 0.26, jacket, 1.12));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), skin);
  head.position.y = 1.56;
  head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.y = 1.58;
  const scarfMesh = box(0.3, 0.1, 0.3, scarf, 1.4);
  body.add(head, cap, scarfMesh);

  const limb = (w: number, h: number, d: number, m: THREE.Material, hipY: number, x: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, hipY, 0);
    const mesh = box(w, h, d, m, -h / 2);
    pivot.add(mesh);
    return pivot;
  };
  const legL = limb(0.17, 0.8, 0.2, pants, 0.8, -0.11), legR = limb(0.17, 0.8, 0.2, pants, 0.8, 0.11);
  const armL = limb(0.12, 0.58, 0.14, jacket, 1.4, -0.29), armR = limb(0.12, 0.58, 0.14, jacket, 1.4, 0.29);
  for (const leg of [legL, legR]) {
    const foot = box(0.19, 0.08, 0.3, shoes, -0.8 + 0.04);
    // Pointe des pieds vers l'avant (−z).
    foot.position.z = -0.04;
    leg.add(foot);
  }
  group.add(body, legL, legR, armL, armR);

  const HIP = 0.8;
  return {
    group,
    ride(seat, crank) {
      // Bassin sur la selle, buste penché vers le guidon, bras tendus, jambes qui pédalent.
      group.position.set(seat.x, seat.y - HIP + 0.04, seat.z);
      group.rotation.set(0, 0, 0);
      const lean = -0.42;
      body.rotation.x = lean;
      // Rotation du buste autour de la hanche plutôt que des pieds.
      body.position.set(0, HIP - HIP * Math.cos(lean), -HIP * Math.sin(lean));
      const c = Math.sin(crank) * 0.38;
      legL.rotation.x = 0.55 + c;
      legR.rotation.x = 0.55 - c;
      // Épaules avancées avec le buste.
      const sh = 1.4 - HIP;
      const shY = HIP + sh * Math.cos(lean), shZ = sh * Math.sin(lean);
      for (const arm of [armL, armR]) {
        arm.position.y = shY;
        arm.position.z = shZ;
        arm.rotation.x = 0.95;
      }
    },
    update(x, y, z, heading, stride, speed) {
      body.rotation.x = 0;
      body.position.z = 0;
      armL.position.set(-0.29, 1.4, 0);
      armR.position.set(0.29, 1.4, 0);
      const amp = Math.min(speed / 2, 1.8) * 0.5;
      const s = Math.sin(stride) * amp;
      legL.rotation.x = s;
      legR.rotation.x = -s;
      armL.rotation.x = -s * 0.9;
      armR.rotation.x = s * 0.9;
      const bob = Math.abs(Math.cos(stride)) * 0.04 * Math.min(speed / 2, 1.5);
      body.position.y = bob;
      group.position.set(x, z + bob * 0.2, -y);
      group.rotation.y = -heading;
    },
  };
}
