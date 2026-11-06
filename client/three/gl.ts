import * as THREE from 'three';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function makeRenderer(canvas: HTMLCanvasElement, maxDpr = 2) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  r.setPixelRatio(Math.min(maxDpr, devicePixelRatio || 1));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  return r;
}

export const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, s / 100, l / 100);

/** Every surface is flat shaded: that's what makes it read as low-poly. */
export const flat = (color: THREE.ColorRepresentation, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

/** Sky fill plus a warm key light that casts shadows over a square of `reach` units. */
export function addLights(scene: THREE.Scene, reach: number, strength = 1) {
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1a1f3a, 1.4 * strength);
  const sun = new THREE.DirectionalLight(0xffe2bf, 2.6 * strength);
  sun.position.set(-reach * 0.6, reach * 1.4, reach * 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -reach;
  cam.right = cam.top = reach;
  cam.near = 0.5;
  cam.far = reach * 5;
  sun.shadow.bias = -0.002;
  scene.add(hemi, sun);
  return { hemi, sun };
}

/**
 * A render loop that sleeps when nothing moves and when the page is hidden.
 * `frame` returns how many ms it wants until the next frame, or Infinity to sleep
 * until `kick()` is called.
 */
export function startLoop(frame: (t: number, dt: number) => number) {
  let raf = 0;
  let last = 0;
  let next = 0;
  let stopped = false;
  const tick = (now: number) => {
    raf = 0;
    if (stopped || document.hidden) return void (last = 0);
    if (now >= next) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      const wait = frame(now / 1000, dt);
      if (wait === Infinity) return void (last = 0);
      next = now + wait - 4;
    }
    raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (raf || stopped) return;
    next = 0;
    raf = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', kick);
  kick();
  return {
    kick,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', kick);
    },
  };
}

/** Pull the camera back along `dir` until every corner sits inside the frame. */
export function fitCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, dir: THREE.Vector3, corners: THREE.Vector3[], margin = 0.94) {
  let d = 20;
  const p = new THREE.Vector3();
  for (let k = 0; k < 5; k++) {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let m = 0;
    for (const c of corners) {
      p.copy(c).project(camera);
      m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
    }
    d *= m / margin;
  }
  camera.position.copy(target).addScaledVector(dir, d);
  camera.lookAt(target);
}

const ray = new THREE.Raycaster();
/** Where a pointer at (x, y) CSS px meets the horizontal plane at height `y0`. */
export function groundPoint(camera: THREE.Camera, w: number, h: number, x: number, y: number, y0: number) {
  ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0), new THREE.Vector3());
}

/** Nudge every vertex a little so primitives look hand-cut rather than machined. */
export function roughen(g: THREE.BufferGeometry, r: () => number, amount: number, keepY = false) {
  const merged = mergeClose(g);
  const pos = merged.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (r() - 0.5) * amount);
    if (!keepY) pos.setY(i, pos.getY(i) + (r() - 0.5) * amount * 0.6);
    pos.setZ(i, pos.getZ(i) + (r() - 0.5) * amount);
  }
  merged.computeVertexNormals();
  return merged;
}

/** Weld vertices that share a position (seams, caps) so roughening doesn't tear the mesh. */
function mergeClose(g: THREE.BufferGeometry) {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const key = (i: number) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  const seen = new Map<string, number>();
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let at = seen.get(k);
    if (at === undefined) {
      at = verts.length / 3;
      seen.set(k, at);
      verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    index.push(at);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(index);
  return out;
}

export function disposeAll(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}

export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
