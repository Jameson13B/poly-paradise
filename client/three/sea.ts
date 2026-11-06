import * as THREE from 'three';
import { cells, SIZE, type Mark, type Ship } from '../../shared/games/fleet.ts';
import { rng } from '../art.tsx';
import { addLights, clamp01, disposeAll, easeOut, fitCamera, flat, groundPoint, hsl, makeRenderer, reducedMotion, startLoop } from './gl.ts';
import type { Scene3D } from './support.ts';

export interface SeaProps {
  ships: Ship[];
  sunk: boolean[];
  /** Hue of the fleet's owner. */
  hue: number;
  marks: Mark[];
  seed: number;
  selected: number;
  /** Cell of the newest shot, which gets the full shell-and-splash treatment. */
  fresh: number;
  /** It's your turn to fire here: the rim lights up in `meHue`. */
  live: boolean;
  meHue: number;
  onTap?: (r: number, c: number) => void;
}

const TOP = 0.15;
const at = (i: number) => new THREE.Vector3((i % SIZE) - SIZE / 2 + 0.5, 0, Math.floor(i / SIZE) - SIZE / 2 + 0.5);
const wave = (t: number, i: number) => 0.05 * Math.sin(t * 1.5 + (i % SIZE) * 0.7 + Math.floor(i / SIZE) * 0.45);

interface Fx {
  start: number;
  dur: number;
  step(k: number, t: number): void;
  objs: THREE.Object3D[];
}

export function create(canvas: HTMLCanvasElement, first: SeaProps): Scene3D<SeaProps> {
  let p = first;
  const still = reducedMotion();
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  addLights(scene, 7, 0.8);

  // The slab the tiles float in, with a rim that lights up when it's your shot.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 0.7, 0.4, SIZE + 0.7), flat(hsl(222, 45, 12)));
  slab.position.y = -0.3;
  slab.receiveShadow = true;
  const rimMat = flat(hsl(222, 30, 26), { emissive: new THREE.Color(0) });
  const rim = new THREE.Group();
  for (const [w, d, x, z] of [
    [SIZE + 0.9, 0.3, 0, -(SIZE + 0.6) / 2],
    [SIZE + 0.9, 0.3, 0, (SIZE + 0.6) / 2],
    [0.3, SIZE + 0.3, -(SIZE + 0.6) / 2, 0],
    [0.3, SIZE + 0.3, (SIZE + 0.6) / 2, 0],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, d), rimMat);
    m.position.set(x, -0.05, z);
    m.castShadow = true;
    rim.add(m);
  }
  scene.add(slab, rim);

  // One instanced mesh for all 64 tiles: slightly tapered square prisms.
  const tileGeo = new THREE.CylinderGeometry(0.6, 0.66, 0.3, 4, 1).rotateY(Math.PI / 4);
  const tiles = new THREE.InstancedMesh(tileGeo, flat(0xffffff), SIZE * SIZE);
  tiles.receiveShadow = true;
  scene.add(tiles);
  const r = rng(first.seed);
  const jitter = Array.from({ length: SIZE * SIZE }, () => [r() * 10 - 5, r() * 8]);
  const tileColor = (i: number, mark: Mark, lit: boolean) => {
    const [dh, dl] = jitter[i];
    const c = mark === 2 ? hsl(14, 34, 18 + dl * 0.4) : mark === 1 ? hsl(212, 24, 36 + dl * 0.5) : hsl(210 + dh, 66, 24 + dl);
    return lit ? c.offsetHSL(0, 0, 0.14) : c;
  };

  const shipLayer = new THREE.Group();
  const markLayer = new THREE.Group();
  const fxLayer = new THREE.Group();
  scene.add(shipLayer, markLayer, fxLayer);

  let shipsKey = '';
  let shipObjs: { obj: THREE.Group; ship: Ship; sunk: boolean; selected: boolean }[] = [];
  const markObjs = new Map<number, { obj: THREE.Object3D; kind: 'miss' | 'fire' | 'smoke' }>();
  let marks: Mark[] = [];
  let hover = -1;
  let fx: Fx[] = [];
  let shake = 0;
  let w = 1;
  let h = 1;

  function buildShips() {
    for (const s of shipObjs) disposeAll(s.obj);
    shipLayer.clear();
    shipObjs = p.ships.map((ship, j) => {
      const obj = shipMesh(ship.len, p.hue, !!p.sunk[j], j === p.selected);
      const mid = (ship.len - 1) / 2;
      obj.position.set(ship.c + (ship.v ? 0 : mid) - SIZE / 2 + 0.5, 0, ship.r + (ship.v ? mid : 0) - SIZE / 2 + 0.5);
      obj.rotation.y = ship.v ? -Math.PI / 2 : 0;
      shipLayer.add(obj);
      return { obj, ship, sunk: !!p.sunk[j], selected: j === p.selected };
    });
  }

  function syncMarks(animate: boolean) {
    const smoking = new Set(p.ships.flatMap((s, j) => (p.sunk[j] ? cells(s) : [])));
    p.marks.forEach((m, i) => {
      const kind = m === 1 ? 'miss' : m === 2 ? (smoking.has(i) ? 'smoke' : 'fire') : null;
      const had = markObjs.get(i);
      if (had?.kind === kind) return;
      if (had) {
        markLayer.remove(had.obj);
        disposeAll(had.obj);
        markObjs.delete(i);
      }
      if (!kind) return;
      const obj = kind === 'miss' ? buoy() : burning(kind === 'fire');
      obj.position.copy(at(i));
      markLayer.add(obj);
      markObjs.set(i, { obj, kind });
      if (animate && !still && i === p.fresh && !marks[i]) incoming(i, m === 2, obj);
    });
    marks = [...p.marks];
  }

  /** A shell drops onto the cell, then a splash or a blast. The mark appears on impact. */
  function incoming(i: number, hit: boolean, mark: THREE.Object3D) {
    const t0 = performance.now() / 1000;
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), flat(0x22262f));
    const pos = at(i);
    mark.visible = false;
    fx.push({
      start: t0,
      dur: 0.32,
      objs: [shell],
      step(k) {
        shell.position.set(pos.x + (1 - k) * 1.2, TOP + (1 - k * k) * 6, pos.z - (1 - k) * 1.5);
        if (k >= 1) {
          mark.visible = true;
          hit ? blast(pos) : splash(pos);
        }
      },
    });
    fxLayer.add(shell);
  }

  function burst(pos: THREE.Vector3, n: number, colors: number[], speed: number, dur: number, size: number) {
    const geo = new THREE.TetrahedronGeometry(size, 0);
    const bits = Array.from({ length: n }, (_, k) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[k % colors.length], transparent: true }));
      const a = (k / n) * Math.PI * 2 + Math.random();
      const v = new THREE.Vector3(Math.cos(a) * speed * (0.4 + Math.random()), speed * (1.6 + Math.random()), Math.sin(a) * speed * (0.4 + Math.random()));
      m.position.copy(pos).setY(TOP + 0.1);
      fxLayer.add(m);
      return { m, v, spin: Math.random() * 8 };
    });
    let lastK = 0;
    fx.push({
      start: performance.now() / 1000,
      dur,
      objs: bits.map((b) => b.m),
      step(k) {
        const dt = (k - lastK) * dur;
        lastK = k;
        for (const b of bits) {
          b.v.y -= 9 * dt;
          b.m.position.addScaledVector(b.v, dt);
          b.m.rotation.x += b.spin * dt;
          b.m.rotation.z += b.spin * dt;
          (b.m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
        }
      },
    });
  }

  function ring(pos: THREE.Vector3, color: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos).setY(TOP + 0.03);
    fxLayer.add(m);
    fx.push({
      start: performance.now() / 1000,
      dur: 0.7,
      objs: [m],
      step(k) {
        m.scale.setScalar(1 + easeOut(k) * 1.8);
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      },
    });
  }

  const splash = (pos: THREE.Vector3) => {
    burst(pos, 9, [0xe8f4ff, 0x9fd0ff], 0.9, 0.75, 0.09);
    ring(pos, 0xdff0ff);
  };
  const blast = (pos: THREE.Vector3) => {
    burst(pos, 12, [0xff6a2b, 0xffc24a, 0xff3d2e], 1.5, 0.7, 0.11);
    ring(pos, 0xffb347);
    shake = 0.35;
  };

  function paintTiles() {
    const c = new THREE.Color();
    for (let i = 0; i < SIZE * SIZE; i++) {
      c.copy(tileColor(i, p.marks[i], i === hover && (p.live || !!p.onTap) && !(p.live && p.marks[i])));
      tiles.setColorAt(i, c);
    }
    tiles.instanceColor!.needsUpdate = true;
  }

  const m4 = new THREE.Matrix4();
  function frame(t: number) {
    const time = still ? 0 : t;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = at(i);
      m4.makeTranslation(v.x, wave(time, i) + (i === hover && p.onTap ? 0.05 : 0), v.z);
      tiles.setMatrixAt(i, m4);
    }
    tiles.instanceMatrix.needsUpdate = true;

    for (const s of shipObjs) {
      const cs = cells(s.ship);
      const y = cs.reduce((a, i) => a + wave(time, i), 0) / cs.length;
      s.obj.position.y = TOP + y + (s.selected ? 0.28 : 0) - (s.sunk ? 0.16 : 0);
      s.obj.rotation.x = s.sunk ? 0.22 : Math.sin(time * 1.3 + s.ship.r) * 0.04;
    }
    for (const [i, m] of markObjs) {
      m.obj.position.y = TOP + wave(time, i);
      if (!still) m.obj.userData.tick?.(t);
    }

    const pulse = p.live ? 0.5 + 0.5 * Math.sin(t * 3) : 0;
    rimMat.color.copy(p.live ? hsl(p.meHue, 70, 46) : hsl(222, 30, 26));
    rimMat.emissive.copy(p.live ? hsl(p.meHue, 80, 20 + pulse * 14) : new THREE.Color(0));

    const now = performance.now() / 1000;
    // Steps can start new effects (a shell landing starts its splash), so collect into a fresh list.
    const running = fx;
    fx = [];
    for (const f of running) {
      const k = clamp01((now - f.start) / f.dur);
      f.step(k, now);
      if (k < 1) fx.push(f);
      else
        for (const o of f.objs) {
          fxLayer.remove(o);
          disposeAll(o);
        }
    }

    camera.position.add(shakeOffset());
    renderer.render(scene, camera);
    camera.position.sub(lastShake);
    // Busy effects get 60fps; idle waves are fine at 30.
    return still && !fx.length ? Infinity : fx.length || shake ? 16 : 33;
  }

  const lastShake = new THREE.Vector3();
  function shakeOffset() {
    if (shake <= 0) return lastShake.set(0, 0, 0);
    shake = Math.max(0, shake - 0.02);
    return lastShake.set((Math.random() - 0.5) * shake * 0.25, (Math.random() - 0.5) * shake * 0.25, 0);
  }

  function fit() {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const e = SIZE / 2 + 0.5;
    const corners = [-e, e].flatMap((x) => [-e, e].flatMap((z) => [new THREE.Vector3(x, -0.3, z), new THREE.Vector3(x, 0.6, z)]));
    fitCamera(camera, new THREE.Vector3(0, 0, 0.3), new THREE.Vector3(0, 1.7, 1).normalize(), corners);
  }

  function cellAt(x: number, y: number) {
    const g = groundPoint(camera, w, h, x, y, TOP);
    if (!g) return -1;
    const c = Math.floor(g.x + SIZE / 2);
    const r = Math.floor(g.z + SIZE / 2);
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : -1;
  }

  buildShips();
  syncMarks(false);
  paintTiles();
  const loop = startLoop(frame);

  return {
    update(next) {
      p = next;
      const key = JSON.stringify([p.ships, p.sunk, p.selected, p.hue]);
      if (key !== shipsKey) {
        shipsKey = key;
        buildShips();
      }
      syncMarks(true);
      paintTiles();
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
      const i = kind === 'leave' ? -1 : cellAt(x, y);
      if (kind === 'tap') {
        if (i >= 0) p.onTap?.(Math.floor(i / SIZE), i % SIZE);
        return;
      }
      if (i !== hover) {
        hover = i;
        paintTiles();
        loop.kick();
      }
    },
    dispose() {
      loop.stop();
      disposeAll(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** A small warship: tapered hull with a pointed bow, deck, bridge and funnels. */
function shipMesh(len: number, hue: number, sunk: boolean, selected: boolean) {
  const g = new THREE.Group();
  const L = len - 0.18;
  const hw = 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, -hw * 0.85);
  shape.lineTo(L / 2 - 0.45, -hw);
  shape.lineTo(L / 2, 0);
  shape.lineTo(L / 2 - 0.45, hw);
  shape.lineTo(-L / 2, hw * 0.85);
  shape.lineTo(-L / 2 - 0.06, 0);
  shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }).rotateX(-Math.PI / 2);
  // Pull the keel in so the hull reads as a boat, not a slab.
  const pos = hullGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0.01) {
      pos.setX(i, pos.getX(i) * 0.86);
      pos.setZ(i, pos.getZ(i) * 0.55);
    }
  }
  hullGeo.translate(0, -0.05, 0);
  hullGeo.computeVertexNormals();

  const sat = sunk ? 6 : 34;
  const glow = selected ? { emissive: hsl(hue, 70, 22) } : {};
  const hull = new THREE.Mesh(hullGeo, flat(hsl(hue, sat, sunk ? 22 : 44), glow));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.62, 0.1, 0.36), flat(hsl(hue, sat * 0.6, sunk ? 28 : 70), glow));
  deck.position.set(-0.05, 0.3, 0);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3), flat(hsl(hue, sat * 0.5, sunk ? 26 : 82), glow));
  bridge.position.set(-L / 2 + 0.55, 0.45, 0);
  g.add(hull, deck, bridge);
  for (let k = 0; k < len - 2; k++) {
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.26, 6), flat(hsl(hue, sat, sunk ? 18 : 34), glow));
    funnel.position.set(-L / 2 + 1.15 + k * 0.75, 0.48, 0);
    g.add(funnel);
  }
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

/** A white marker buoy floats where a shot missed. */
function buoy() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), flat(0xf2f6ff));
  body.scale.y = 1.3;
  body.position.y = 0.2;
  body.castShadow = true;
  g.add(body);
  return g;
}

/** Flames over a fresh hit; just smoke once the ship has gone down. */
function burning(fire: boolean) {
  const g = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  if (fire) {
    for (const [col, s, x] of [
      [0xff5a24, 1, 0],
      [0xffc24a, 0.6, 0.06],
    ] as const) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.17 * s, 0.5 * s, 5), new THREE.MeshBasicMaterial({ color: col }));
      f.position.set(x, 0.3 * s + 0.12, x);
      g.add(f);
      flames.push(f);
    }
  }
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0x56596a, flatShading: true, transparent: true, opacity: 0.7 });
  const puffs = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), smokeMat);
    g.add(m);
    return m;
  });
  const phase = Math.random() * 10;
  g.userData.tick = (t: number) => {
    flames.forEach((f, k) => f.scale.set(1, 0.8 + 0.35 * Math.abs(Math.sin(t * 9 + k * 2 + phase)), 1));
    puffs.forEach((m, k) => {
      const u = (t * 0.45 + k / 3 + phase) % 1;
      m.position.set(Math.sin(u * 5 + k) * 0.08, 0.45 + u * 1.1, 0);
      m.scale.setScalar(0.6 + u * 1.3);
    });
  };
  g.userData.tick(0);
  return g;
}
