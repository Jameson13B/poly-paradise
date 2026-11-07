import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { H, HIDDEN, JUNK, offsets, W, type StackPlayer } from '../../shared/games/stack.ts';
import { rng } from '../art.tsx';
import type { LocalStack, StackEvent } from '../games/stack-local.ts';
import { cellsOfPiece } from '../games/stack-local.ts';
import { addLights, clamp01, disposeAll, easeOut, fitCamera, flat, hsl, makeRenderer, reducedMotion, roughen, startLoop } from './gl.ts';
import type { Scene3D } from './support.ts';

export interface StackSceneProps {
  game: LocalStack;
  rival: StackPlayer | null;
  /** The rival's line clears, queued by the view as they arrive. */
  rivalEvents: StackEvent[];
  meHue: number;
  rivalHue: number;
  playing: boolean;
}

/** Our own gem palette for the seven shapes; junk is grey stone. */
export const KIND_HUES = [0, 330, 168, 42, 200, 95, 262, 14];
const kindColor = (k: number) => (k === JUNK ? hsl(230, 8, 38) : hsl(KIND_HUES[k], 68, 54));

const RIVAL_SCALE = 0.42;
const RIVAL_X = W + 1.3;
const NEXT_X = W + 1.5;

/** Board cell (row, col) to scene position, with row H-1 at the bottom. */
const cellPos = (i: number, out = new THREE.Vector3()) => out.set((i % W) + 0.5, H - 1 - Math.floor(i / W) + 0.5, 0);

export function create(canvas: HTMLCanvasElement, first: StackSceneProps): Scene3D<StackSceneProps> {
  let p = first;
  const still = reducedMotion();
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  const { sun } = addLights(scene, 16, 0.9);
  sun.position.set(-6, 30, 22);
  sun.target.position.set(W / 2, 10, 0);
  scene.add(sun.target);
  let w = 1;
  let h = 1;

  const blockGeo = gemBlock();
  const mine = new THREE.Group();
  const rivalGroup = new THREE.Group();
  rivalGroup.scale.setScalar(RIVAL_SCALE);
  rivalGroup.position.set(RIVAL_X, 0, 0);
  scene.add(mine, rivalGroup);
  mine.add(well(7));
  rivalGroup.add(well(8));

  const blocks = new THREE.InstancedMesh(blockGeo, flat(0xffffff), W * H + 4);
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  const ghost = new THREE.InstancedMesh(blockGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }), 4);
  const rivalBlocks = new THREE.InstancedMesh(blockGeo, flat(0xffffff), W * H);
  rivalBlocks.castShadow = true;
  const nextBlocks = new THREE.InstancedMesh(blockGeo, flat(0xffffff), 12);
  nextBlocks.castShadow = true;
  // Blocks live in their own layer so junk can push the stack up without moving the well.
  const pile = new THREE.Group();
  pile.add(blocks, ghost);
  mine.add(pile);
  rivalGroup.add(rivalBlocks);
  scene.add(nextBlocks);

  // Incoming junk: a column of red crystals beside your well.
  const meter = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.32, 0), flat(hsl(4, 80, 52), { emissive: hsl(4, 80, 18) }), 20);
  meter.position.set(-1.05, 0.5, 0.1);
  mine.add(meter);

  const fxLayer = new THREE.Group();
  scene.add(fxLayer);
  type Fx = { start: number; dur: number; step(k: number): void; objs: THREE.Object3D[] };
  let fx: Fx[] = [];
  const flashes = new Map<number, number>();
  let rise = { start: 0, rows: 0 };
  let shake = 0;

  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();

  function place(mesh: THREE.InstancedMesh, k: number, pos: THREE.Vector3, color: THREE.Color, scale = 1) {
    m4.compose(pos, q, one.clone().multiplyScalar(scale));
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, color);
  }

  function drawBoard(mesh: THREE.InstancedMesh, board: number[], extra: (k: number) => number, dim: boolean, now: number) {
    let k = 0;
    for (let i = HIDDEN * W; i < W * H; i++) {
      const kind = board[i];
      if (!kind) continue;
      col.copy(kindColor(kind));
      if (dim) col.lerp(hsl(230, 6, 30), 0.75);
      const f = flashes.get(i);
      if (f && mesh === blocks) {
        if (now > f) flashes.delete(i);
        else col.lerp(new THREE.Color(0xffffff), clamp01((f - now) / 180) * 0.7);
      }
      place(mesh, k++, cellPos(i, v), col);
    }
    k = extra(k);
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function consume(events: StackEvent[], group: THREE.Group, scale: number) {
    for (const e of events.splice(0)) {
      if (still) continue;
      if (e.t === 'clear') {
        e.rows.forEach((row, j) => {
          flashRow(group, row, scale);
          e.colors[j].forEach((kind, x) => shatter(group, row * W + x, kind || 8, scale));
        });
        if (scale === 1) shake = 0.25 + e.rows.length * 0.1;
      } else if (e.t === 'land' && scale === 1) {
        const until = performance.now() + 180;
        for (const i of e.cells) if (i >= 0) flashes.set(i, until);
      } else if (e.t === 'junk' && scale === 1) {
        rise = { start: performance.now(), rows: e.rows };
        shake = 0.3;
      }
    }
  }

  function flashRow(group: THREE.Group, row: number, scale: number) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(W, 0.9, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    group.localToWorld(bar.position.set(W / 2, H - 1 - row + 0.5, 0.55));
    bar.scale.setScalar(scale);
    fxLayer.add(bar);
    fx.push({
      start: performance.now(),
      dur: 0.35,
      objs: [bar],
      step(k) {
        bar.scale.set(scale * (1 + k * 0.1), scale * (1 - k), scale);
        (bar.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      },
    });
  }

  const shardGeo = new THREE.TetrahedronGeometry(0.22, 0);
  function shatter(group: THREE.Group, i: number, kind: number, scale: number) {
    const color = kindColor(kind);
    const bits = Array.from({ length: 2 }, () => {
      const m = new THREE.Mesh(shardGeo, new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true }));
      group.localToWorld(cellPos(i, m.position));
      m.scale.setScalar(scale);
      fxLayer.add(m);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 1, Math.random() * 5 + 2).multiplyScalar(scale);
      return { m, vel, spin: (Math.random() - 0.5) * 14 };
    });
    let last = 0;
    fx.push({
      start: performance.now(),
      dur: 0.8,
      objs: bits.map((b) => b.m),
      step(k) {
        const dt = (k - last) * 0.8;
        last = k;
        for (const b of bits) {
          b.vel.y -= 16 * scale * dt;
          b.m.position.addScaledVector(b.vel, dt);
          b.m.rotation.x += b.spin * dt;
          b.m.rotation.y += b.spin * dt;
          (b.m.material as THREE.MeshLambertMaterial).opacity = 1 - k * k;
        }
      },
    });
  }

  function frame() {
    const now = performance.now();
    const g = p.game;
    consume(g.events, pile, 1);
    consume(p.rivalEvents, rivalGroup, RIVAL_SCALE);

    // Junk pushes the stack up from below.
    const rk = rise.rows ? clamp01((now - rise.start) / 260) : 1;
    pile.position.y = -(1 - easeOut(rk)) * rise.rows;

    drawBoard(blocks, g.player.board, (k) => {
      if (!g.piece) return k;
      for (const i of cellsOfPiece(g.piece)) if (i >= HIDDEN * W - W) place(blocks, k++, cellPos(i, v), kindColor(g.piece.kind));
      return k;
    }, g.player.out, now);

    let gk = 0;
    if (g.piece && p.playing) {
      const ghostPiece = { ...g.piece, y: g.ghostY() };
      if (ghostPiece.y !== g.piece.y) for (const i of cellsOfPiece(ghostPiece)) place(ghost, gk++, cellPos(i, v), hsl(p.meHue, 80, 70), 0.96);
    }
    ghost.count = gk;
    ghost.instanceMatrix.needsUpdate = true;
    if (ghost.instanceColor) ghost.instanceColor.needsUpdate = true;

    if (p.rival) drawBoard(rivalBlocks, p.rival.board, (k) => k, p.rival.out, now);
    else rivalBlocks.count = 0;

    // The next three pieces, small, above the rival's well.
    let nk = 0;
    g.nextKinds(3).forEach((kind, j) => {
      const cells = offsets(kind, 0);
      const minX = Math.min(...cells.map((c) => c[0]));
      const maxX = Math.max(...cells.map((c) => c[0]));
      const minY = Math.min(...cells.map((c) => c[1]));
      for (const [cx, cy] of cells) {
        const s = 0.5;
        v.set(NEXT_X + 2.1 + (cx - (minX + maxX) / 2) * s, 20.4 - j * 1.6 - (cy - minY) * s, 0);
        place(nextBlocks, nk++, v, kindColor(kind), s);
      }
    });
    nextBlocks.count = nk;
    nextBlocks.instanceMatrix.needsUpdate = true;
    if (nextBlocks.instanceColor) nextBlocks.instanceColor.needsUpdate = true;

    const pending = Math.min(20, g.player.pending);
    for (let k = 0; k < pending; k++) {
      m4.makeTranslation(0, k * 0.72, 0).multiply(new THREE.Matrix4().makeRotationY(now / 600 + k));
      meter.setMatrixAt(k, m4);
    }
    meter.count = pending;
    meter.instanceMatrix.needsUpdate = true;

    const running = fx;
    fx = [];
    for (const f of running) {
      const k = clamp01((now - f.start) / 1000 / f.dur);
      f.step(k);
      if (k < 1) fx.push(f);
      else
        for (const o of f.objs) {
          fxLayer.remove(o);
          (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).dispose();
        }
    }

    const off = shake > 0 ? new THREE.Vector3((Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3, 0) : new THREE.Vector3();
    shake = Math.max(0, shake - 0.025);
    camera.position.add(off);
    renderer.render(scene, camera);
    camera.position.sub(off);
    return p.playing || fx.length || rk < 1 ? 16 : Infinity;
  }

  function fit() {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const x0 = -1.6;
    const x1 = RIVAL_X + (W + 0.6) * RIVAL_SCALE;
    const corners = [x0, x1].flatMap((x) => [-0.6, 20.9].flatMap((y) => [new THREE.Vector3(x, y, -0.7), new THREE.Vector3(x, y, 0.6)]));
    const center = new THREE.Vector3((x0 + x1) / 2, 10.2, 0);
    fitCamera(camera, center, new THREE.Vector3(0.08, 0.14, 1).normalize(), corners, 0.97);
    // Tell the gesture code how big a cell is on screen.
    const a = new THREE.Vector3(0, 10, 0).project(camera);
    const b = new THREE.Vector3(1, 10, 0).project(camera);
    p.game.cellPx = Math.max(8, ((b.x - a.x) / 2) * w);
  }

  const loop = startLoop(frame);

  return {
    update(next) {
      const gameChanged = next.game !== p.game;
      p = next;
      if (gameChanged) fit();
      loop.kick();
    },
    resize(cw, ch) {
      w = Math.max(1, cw);
      h = Math.max(1, ch);
      renderer.setSize(w, h, false);
      fit();
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

/** A block cut like a gem: a bevelled square prism with a low pyramid face toward you. */
function gemBlock() {
  const body = new THREE.CylinderGeometry(0.6, 0.66, 0.5, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2);
  const face = new THREE.ConeGeometry(0.6, 0.2, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2).translate(0, 0, 0.35);
  const geo = mergeGeometries([body.toNonIndexed(), face.toNonIndexed()])!;
  geo.computeVertexNormals();
  return geo;
}

/** The well: a dark back wall of faceted tiles between two stone pillars. */
function well(seed: number) {
  const r = rng(seed);
  const g = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 20.4, 0.3), flat(hsl(252, 30, 10)));
  back.position.set(W / 2, 10, -0.7);
  back.receiveShadow = true;
  const tileGeo = new THREE.CylinderGeometry(0.62, 0.66, 0.08, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2);
  const tiles = new THREE.InstancedMesh(tileGeo, flat(0xffffff), W * 20);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < W * 20; i++) {
    tiles.setMatrixAt(i, m4.makeTranslation((i % W) + 0.5, Math.floor(i / W) + 0.5, -0.5));
    tiles.setColorAt(i, hsl(248 + r() * 10, 24, 14 + r() * 4));
  }
  tiles.receiveShadow = true;
  const stone = flat(hsl(250, 12, 30));
  const pillars = [-0.45, W + 0.45].map((x) => {
    const m = new THREE.Mesh(roughen(new THREE.BoxGeometry(0.6, 21, 1.2, 1, 6, 1), r, 0.18), stone);
    m.position.set(x, 10.2, -0.2);
    m.castShadow = m.receiveShadow = true;
    return m;
  });
  const floor = new THREE.Mesh(roughen(new THREE.BoxGeometry(W + 1.6, 0.6, 1.4, 4, 1, 1), r, 0.15), stone);
  floor.position.set(W / 2, -0.32, -0.2);
  floor.receiveShadow = true;
  g.add(back, tiles, ...pillars, floor);
  return g;
}
