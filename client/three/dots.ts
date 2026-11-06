import * as THREE from 'three';
import type { DotsMove, DotsState } from '../../shared/games/dots-and-boxes.ts';
import { SEAT_HUES } from '../art.tsx';
import { addLights, clamp01, disposeAll, easeOut, fitCamera, flat, groundPoint, hsl, makeRenderer, reducedMotion, startLoop } from './gl.ts';
import type { Scene3D } from './support.ts';

export interface DotsProps {
  s: DotsState;
  myTurn: boolean;
  me: number;
  onPlay(m: DotsMove): void;
}

const TOP = 0.1;
const keyOf = (m: DotsMove) => `${m.k}${m.r},${m.c}`;
const seatHue = (seat: number) => SEAT_HUES[seat % SEAT_HUES.length];

export function create(canvas: HTMLCanvasElement, first: DotsProps): Scene3D<DotsProps> {
  let p = first;
  const still = reducedMotion();
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  addLights(scene, 6, 0.85);

  let built = '';
  const board = new THREE.Group();
  const lines = new Map<string, { obj: THREE.Mesh; born: number }>();
  const boxes = new Map<number, { obj: THREE.Group; born: number }>();
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false });
  const hoverMat = flat(0xffffff, { transparent: true, opacity: 0.75 });
  const barGeo = new THREE.BoxGeometry(0.78, 0.12, 0.13);
  const ghostGeo = new THREE.BoxGeometry(0.7, 0.03, 0.05);
  const ghosts = new Map<string, THREE.Mesh>();
  const hover = new THREE.Mesh(barGeo, hoverMat);
  hover.visible = false;
  scene.add(board, hover);
  let w = 1;
  let h = 1;

  /** Board-space position of dot (r, c). */
  const dot = (r: number, c: number) => new THREE.Vector3(c - p.s.w / 2, 0, r - p.s.h / 2);
  const lineAt = (m: DotsMove) => {
    const a = dot(m.r, m.c);
    return m.k === 'h' ? a.add(new THREE.Vector3(0.5, TOP, 0)) : a.add(new THREE.Vector3(0, TOP, 0.5));
  };

  /** Slab, cell tiles and dots. Rebuilt only when the board size changes. */
  function buildBoard() {
    disposeAll(board);
    board.clear();
    lines.clear();
    boxes.clear();
    ghosts.clear();
    const { w: bw, h: bh } = p.s;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.9, 0.5, bh + 0.9), flat(hsl(226, 32, 16)));
    slab.position.y = -0.3;
    slab.receiveShadow = true;
    slab.castShadow = true;
    board.add(slab);
    const tileGeo = new THREE.CylinderGeometry(0.62, 0.68, 0.12, 4).rotateY(Math.PI / 4);
    const tiles = new THREE.InstancedMesh(tileGeo, flat(0xffffff), bw * bh);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < bw * bh; i++) {
      const v = dot(Math.floor(i / bw), i % bw).add(new THREE.Vector3(0.5, -0.06, 0.5));
      tiles.setMatrixAt(i, m4.makeTranslation(v.x, v.y, v.z));
      tiles.setColorAt(i, hsl(224 + ((i * 37) % 9), 26, 22 + ((i * 53) % 5)));
    }
    tiles.receiveShadow = true;
    board.add(tiles);
    const pipGeo = new THREE.OctahedronGeometry(0.12, 0);
    const pips = new THREE.InstancedMesh(pipGeo, flat(0xe8eeff), (bw + 1) * (bh + 1));
    for (let i = 0; i < (bw + 1) * (bh + 1); i++) {
      const v = dot(Math.floor(i / (bw + 1)), i % (bw + 1));
      pips.setMatrixAt(i, m4.makeTranslation(v.x, TOP + 0.04, v.z));
    }
    pips.castShadow = true;
    board.add(pips);
    fit();
  }

  function sync(animate: boolean) {
    const { s } = p;
    const now = performance.now() / 1000;
    const all: [DotsMove, number][] = [];
    for (let r = 0; r <= s.h; r++) for (let c = 0; c < s.w; c++) all.push([{ k: 'h', r, c }, s.hl[r * s.w + c]]);
    for (let r = 0; r < s.h; r++) for (let c = 0; c <= s.w; c++) all.push([{ k: 'v', r, c }, s.vl[r * (s.w + 1) + c]]);

    for (const [m, owner] of all) {
      const k = keyOf(m);
      if (owner >= 0 && !lines.has(k)) {
        const bar = new THREE.Mesh(barGeo, flat(hsl(seatHue(owner), 72, 56)));
        bar.position.copy(lineAt(m));
        bar.rotation.y = m.k === 'v' ? Math.PI / 2 : 0;
        bar.castShadow = true;
        board.add(bar);
        lines.set(k, { obj: bar, born: animate && !still ? now : 0 });
      }
      const ghost = ghosts.get(k);
      const wantGhost = owner < 0 && p.myTurn;
      if (wantGhost && !ghost) {
        const g = new THREE.Mesh(ghostGeo, ghostMat);
        g.position.copy(lineAt(m)).setY(TOP - 0.02);
        g.rotation.y = m.k === 'v' ? Math.PI / 2 : 0;
        board.add(g);
        ghosts.set(k, g);
      } else if (!wantGhost && ghost) {
        board.remove(ghost);
        ghosts.delete(k);
      }
    }

    s.boxes.forEach((owner, i) => {
      if (owner < 0 || boxes.has(i)) return;
      const obj = prism(seatHue(owner));
      obj.position.copy(dot(Math.floor(i / s.w), i % s.w)).add(new THREE.Vector3(0.5, 0, 0.5));
      board.add(obj);
      boxes.set(i, { obj, born: animate && !still ? now : 0 });
    });

    const lastKey = s.last ? keyOf(s.last) : '';
    for (const [k, l] of lines) (l.obj.material as THREE.MeshLambertMaterial).emissive.copy(k === lastKey ? hsl(0, 0, 18) : new THREE.Color(0));
    if (!p.myTurn) hover.visible = false;
  }

  function frame() {
    const now = performance.now() / 1000;
    let busy = false;
    for (const l of lines.values()) {
      const k = l.born ? clamp01((now - l.born) / 0.32) : 1;
      if (k < 1) busy = true;
      // Drops in from above with a small bounce.
      l.obj.position.y = TOP + (1 - easeOut(k)) * 1.4 + Math.sin(k * Math.PI) * 0.06;
    }
    for (const b of boxes.values()) {
      const k = b.born ? clamp01((now - b.born - 0.2) / 0.45) : 1;
      if (k < 1) busy = true;
      const g = 1 + Math.sin(k * Math.PI) * 0.25 * (1 - k);
      b.obj.scale.set(g, Math.max(0.001, easeOut(k)), g);
    }
    renderer.render(scene, camera);
    return busy ? 16 : Infinity;
  }

  function fit() {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const ex = p.s.w / 2 + 0.5;
    const ez = p.s.h / 2 + 0.5;
    const corners = [-ex, ex].flatMap((x) => [-ez, ez].flatMap((z) => [new THREE.Vector3(x, -0.5, z), new THREE.Vector3(x, 0.7, z)]));
    fitCamera(camera, new THREE.Vector3(0, 0, 0.25), new THREE.Vector3(0, 1.9, 1).normalize(), corners);
  }

  /** The nearest free line to a pointer, if it's close enough to mean it. */
  function pick(x: number, y: number): DotsMove | null {
    const g = groundPoint(camera, w, h, x, y, TOP);
    if (!g) return null;
    const { s } = p;
    const u = g.x + s.w / 2;
    const v = g.z + s.h / 2;
    const opts: [number, DotsMove][] = [];
    const hr = Math.round(v);
    const hc = Math.floor(u);
    if (hr >= 0 && hr <= s.h && hc >= 0 && hc < s.w) opts.push([Math.abs(v - hr), { k: 'h', r: hr, c: hc }]);
    const vc = Math.round(u);
    const vr = Math.floor(v);
    if (vc >= 0 && vc <= s.w && vr >= 0 && vr < s.h) opts.push([Math.abs(u - vc), { k: 'v', r: vr, c: vc }]);
    opts.sort((a, b) => a[0] - b[0]);
    const best = opts.find(([d, m]) => d < 0.42 && !lines.has(keyOf(m)));
    return best ? best[1] : null;
  }

  function show(m: DotsMove | null) {
    hover.visible = !!m && p.myTurn;
    if (!m) return;
    hover.position.copy(lineAt(m)).setY(TOP + 0.08);
    hover.rotation.y = m.k === 'v' ? Math.PI / 2 : 0;
    hoverMat.color.copy(hsl(seatHue(p.me), 72, 62));
  }

  const loop = startLoop(frame);
  const rebuild = () => {
    const key = `${p.s.w}x${p.s.h}`;
    // A rematch starts from an empty board, so start fresh then too.
    const fresh = p.s.hl.every((x) => x < 0) && p.s.vl.every((x) => x < 0) && lines.size > 0;
    if (key !== built || fresh) {
      built = key;
      buildBoard();
      return true;
    }
    return false;
  };
  rebuild();
  sync(false);

  return {
    update(next) {
      p = next;
      const wasBuilt = rebuild();
      sync(!wasBuilt);
      loop.kick();
    },
    resize(cw, ch) {
      w = Math.max(1, cw);
      h = Math.max(1, ch);
      renderer.setSize(w, h, false);
      fit();
      loop.kick();
    },
    pointer(kind, x, y) {
      if (!p.myTurn) return;
      const m = kind === 'leave' ? null : pick(x, y);
      if (kind === 'tap') {
        if (m) p.onPlay(m);
        show(null);
      } else show(m);
      loop.kick();
    },
    dispose() {
      loop.stop();
      disposeAll(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** A claimed box: a square block with a low faceted roof, like a cut gem. */
function prism(hue: number) {
  const g = new THREE.Group();
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 0.32, 4).rotateY(Math.PI / 4).translate(0, 0.16, 0), flat(hsl(hue, 58, 44)));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.26, 4).rotateY(Math.PI / 4).translate(0, 0.45, 0), flat(hsl(hue, 66, 60)));
  for (const m of [block, roof]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  g.add(block, roof);
  return g;
}
