import * as THREE from "three";

export const HORIZON = new THREE.Color("#bfd2e4");

/** Ciel : dégradé horizon → zénith, voile chaud autour du soleil. Le dôme suit la caméra. */
export function createSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sun: { value: sunDir.clone().normalize() },
      horizon: { value: HORIZON.clone() },
      zenith: { value: new THREE.Color("#4a84c4") },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sun; uniform vec3 horizon; uniform vec3 zenith;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(s, 6.0) * 0.18 + pow(s, 180.0) * 0.9);
        col = mix(col, horizon, smoothstep(0.0, -0.25, vDir.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
