import * as THREE from 'three';
import { rng } from '../art.tsx';
import { addLights, disposeAll, flat, hsl, makeRenderer, reducedMotion, roughen, startLoop } from './gl.ts';
import type { Scene3D } from './support.ts';

export interface WorldProps {
  /** The world leans toward this hue: the lobby's, or the game on the table. */
  hue: number;
  /** At a table the camera lifts away so the island sits quietly behind the board. */
  away: boolean;
  /** People online right now; that many little figures gather at the fire. */
  online: number;
  stalls: { hue: number; ready: boolean }[];
}

/**
 * The island everyone gathers on. It sits behind every screen: up close in the
 * lobby, far off while a game is on.
 */
export function create(canvas: HTMLCanvasElement, first: WorldProps): Scene3D<WorldProps> {
  let p = first;
  const still = reducedMotion();
  const renderer = makeRenderer(canvas, 1.5);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
  const { hemi, sun } = addLights(scene, 10, 0.6);
  const r = rng(7);
  let hue = p.hue;
  let awayK = p.away ? 1 : 0;
  let w = 1;
  let h = 1;

  scene.fog = new THREE.Fog(0x000000, 70, 220);

  // Sky dome: deep at the top, warmer at the horizon.
  const skyGeo = new THREE.SphereGeometry(400, 18, 10);
  const skyY = Float32Array.from(skyGeo.getAttribute('position').array as Float32Array).filter((_, i) => i % 3 === 1);
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyY.length * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  scene.add(sky);

  // Sea: a wide plane whose vertices roll; flat shading turns that into facets.
  const seaGeo = new THREE.PlaneGeometry(500, 500, 64, 64).rotateX(-Math.PI / 2);
  const seaMat = flat(0xffffff);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.receiveShadow = true;
  const seaPos = seaGeo.getAttribute('position');
  const seaBase = Float32Array.from(seaPos.array as Float32Array);
  scene.add(sea);

  // A low-poly moon low over the horizon, outside the fog.
  const moon = new THREE.Mesh(new THREE.CircleGeometry(4, 7), new THREE.MeshBasicMaterial({ color: 0xfff1d6, fog: false }));
  moon.position.set(-90, 50, -260);
  moon.scale.setScalar(3);
  moon.lookAt(0, 0, 0);
  scene.add(moon);

  const island = new THREE.Group();
  scene.add(island);
  const shadowy = (m: THREE.Object3D) => {
    m.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return m;
  };

  const rock = new THREE.Mesh(roughen(new THREE.CylinderGeometry(6.2, 3.4, 2.6, 10, 2), r, 0.8), flat(hsl(24, 18, 30)));
  rock.position.y = -1.1;
  const sand = new THREE.Mesh(roughen(new THREE.CylinderGeometry(6.4, 6.9, 0.6, 13, 1), r, 0.6, true), flat(hsl(38, 44, 60)));
  sand.position.y = 0.05;
  const grassMat = flat(0xffffff);
  const grass = new THREE.Mesh(roughen(new THREE.CylinderGeometry(4.9, 5.5, 0.55, 12, 1), r, 0.7, true), grassMat);
  grass.position.y = 0.45;
  const hill = new THREE.Mesh(roughen(new THREE.DodecahedronGeometry(2.3, 0), r, 0.5), grassMat);
  hill.scale.set(1.2, 0.62, 1);
  hill.position.set(-1.4, 0.7, -2.4);
  island.add(shadowy(rock), shadowy(sand), shadowy(grass), shadowy(hill));

  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + r() * 0.6 + 0.3;
    const palm = shadowy(palmTree(r));
    palm.position.set(Math.cos(a) * 5.4, 0.3, Math.sin(a) * 5.4);
    palm.rotation.y = r() * Math.PI * 2;
    island.add(palm);
  }
  for (let k = 0; k < 8; k++) {
    const a = r() * Math.PI * 2;
    const s = 0.3 + r() * 0.5;
    const stone = new THREE.Mesh(roughen(new THREE.DodecahedronGeometry(s, 0), r, s * 0.4), flat(hsl(220, 8, 40 + r() * 12)));
    stone.position.set(Math.cos(a) * (6.3 + r()), -0.1, Math.sin(a) * (6.3 + r()));
    island.add(shadowy(stone));
  }
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2;
    const d = 2 + r() * 2.5;
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + r() * 0.2, 0), flat(hsl(130 + r() * 30, 42, 26 + r() * 8)));
    bush.position.set(Math.cos(a) * d, 0.8, Math.sin(a) * d);
    island.add(shadowy(bush));
  }

  // The campfire at the centre, where people gather.
  const fire = new THREE.Group();
  const logs = new THREE.MeshLambertMaterial({ color: 0x5a3a22, flatShading: true });
  for (let k = 0; k < 4; k++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 5), logs);
    log.rotation.set(Math.PI / 2 - 0.5, (k / 4) * Math.PI * 2, 0);
    log.position.y = 0.2;
    fire.add(log);
  }
  const flames = [0xff5a24, 0xffa53a, 0xffe27a].map((color, k) => {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.3 - k * 0.08, 0.8 - k * 0.18, 5), new THREE.MeshBasicMaterial({ color }));
    f.position.y = 0.45 - k * 0.04;
    fire.add(f);
    return f;
  });
  const glow = new THREE.PointLight(0xff8a3d, 22, 9, 1.6);
  glow.position.y = 1;
  fire.add(glow);
  fire.position.set(0.6, 0.72, 0.9);
  island.add(fire);

  // A stall for each game, its gem floating over a stone plinth.
  const stalls: THREE.Mesh[] = [];
  const stallGroup = new THREE.Group();
  island.add(stallGroup);
  function buildStalls() {
    disposeAll(stallGroup);
    stallGroup.clear();
    stalls.length = 0;
    p.stalls.forEach((st, k) => {
      const a = (k / p.stalls.length) * Math.PI * 2 + 0.9;
      const g = new THREE.Group();
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.4, 6), flat(hsl(220, 10, 62)));
      plinth.position.y = 0.2;
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.38, 0),
        flat(st.ready ? hsl(st.hue, 70, 56) : hsl(st.hue, 12, 40), { emissive: st.ready ? hsl(st.hue, 80, 16) : new THREE.Color(0) }),
      );
      gem.position.y = 1.05;
      gem.scale.y = 1.35;
      g.add(shadowy(plinth), shadowy(gem));
      g.position.set(Math.cos(a) * 3.3 + 0.6, 0.72, Math.sin(a) * 3.3 + 0.9);
      stallGroup.add(g);
      stalls.push(gem);
    });
  }

  // Little gem-headed figures, one per person online, milling around the fire.
  const people = new THREE.Group();
  island.add(people);
  let folks: { obj: THREE.Group; a: number; d: number; speed: number; ph: number }[] = [];
  function buildPeople() {
    const n = Math.max(1, Math.min(12, p.online));
    if (n === folks.length) return;
    disposeAll(people);
    people.clear();
    const pr = rng(99);
    folks = Array.from({ length: n }, (_, k) => {
      const ph = pr() * 10;
      const g = new THREE.Group();
      const hue = pr() * 360;
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 5).translate(0, 0.21, 0), flat(hsl(hue, 30, 70)));
      const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0).translate(0, 0.55, 0), flat(hsl(hue, 70, 55)));
      g.add(shadowy(body), shadowy(head));
      people.add(g);
      return { obj: g, a: (k / n) * Math.PI * 2 + pr() * 0.4, d: 1.3 + pr() * 0.8, speed: (pr() - 0.5) * 0.25, ph };
    });
  }

  // Drifting clouds.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a93b8, flatShading: true, transparent: true, opacity: 0.55 });
  const clouds = Array.from({ length: 6 }, () => {
    const g = new THREE.Group();
    for (let k = 0; k < 3 + Math.floor(r() * 2); k++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + r() * 0.7, 0), cloudMat);
      puff.position.set(k * 1.1 - 1.5, r() * 0.4, r() * 0.6);
      puff.scale.y = 0.6;
      g.add(puff);
    }
    g.position.set((r() - 0.5) * 120, 14 + r() * 10, -40 - r() * 60);
    g.scale.setScalar(2 + r() * 1.5);
    scene.add(g);
    return g;
  });

  function tint() {
    const horizon = hsl(hue + 18, 38, 17);
    const zenith = hsl(hue - 20, 55, 7);
    const col = skyGeo.getAttribute('color');
    const c = new THREE.Color();
    skyY.forEach((y, i) => {
      c.copy(horizon).lerp(zenith, Math.min(1, Math.max(0, y / 200)) ** 0.6);
      col.setXYZ(i, c.r, c.g, c.b);
    });
    col.needsUpdate = true;
    renderer.setClearColor(horizon, 1);
    (scene.fog as THREE.Fog).color.copy(horizon);
    seaMat.color.copy(hsl(hue, 62, 15));
    grassMat.color.copy(hsl(132 + (hue - 196) * 0.12, 40, 32));
    hemi.color.copy(hsl(hue, 45, 55));
    hemi.groundColor.copy(hsl(hue + 30, 40, 10));
  }

  function frame(t: number, dt: number) {
    const delta = ((p.hue - hue + 540) % 360) - 180;
    hue += Math.abs(delta) < 0.5 ? delta : delta * Math.min(1, dt * 3);
    awayK += ((p.away ? 1 : 0) - awayK) * Math.min(1, dt * 1.5);
    if (still) {
      hue = p.hue;
      awayK = p.away ? 1 : 0;
    }
    tint();
    const time = still ? 0 : t;

    const pos = seaPos.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = seaBase[i];
      const z = seaBase[i + 2];
      pos[i + 1] = 0.22 * Math.sin(x * 0.32 + time * 0.7) + 0.16 * Math.sin(z * 0.45 + time * 0.9 + x * 0.2) - 0.2;
    }
    seaPos.needsUpdate = true;

    flames.forEach((f, k) => f.scale.set(1, 0.85 + 0.3 * Math.abs(Math.sin(time * 8 + k * 1.7)), 1));
    glow.intensity = 20 + Math.sin(time * 11) * 3 + Math.sin(time * 7.3) * 2;
    stalls.forEach((g, k) => {
      g.rotation.y = time * 0.6 + k;
      g.position.y = 1.05 + Math.sin(time * 1.4 + k) * 0.08;
    });
    for (const f of folks) {
      f.a += f.speed * dt;
      const x = Math.cos(f.a) * f.d;
      const z = Math.sin(f.a) * f.d;
      f.obj.position.set(x + fire.position.x, 0.72 + Math.abs(Math.sin(time * 2.2 + f.ph)) * 0.08, z + fire.position.z);
      f.obj.lookAt(fire.position.x, f.obj.position.y, fire.position.z);
    }
    // Far off behind a game, the moon and clouds would float between the boards.
    moon.visible = awayK < 0.5;
    for (const c of clouds) c.visible = awayK < 0.5;
    for (const c of clouds) {
      c.position.x += dt * 0.8;
      if (c.position.x > 70) c.position.x = -70;
    }

    frameIsland(dt);
    sun.target.position.set(0, 0, 0);

    renderer.render(scene, camera);
    if (still) return Infinity;
    // Smooth while the page scrolls or the camera moves; otherwise the backdrop is fine at 30fps (20 behind a game).
    return performance.now() < busyUntil || moving ? 16 : p.away ? 50 : 33;
  }

  // The lobby marks out where the island should sit with an .island-window element;
  // elsewhere it rests near the top, smaller and further off when a game is on.
  let busyUntil = 0;
  let moving = false;
  let mode = '';
  let from = { d: 0, x: 0, y: 0, lift: 0 };
  const cur = { d: 0, x: 0, y: 0, lift: 0 };
  let blend = 1;
  const onScroll = () => {
    busyUntil = performance.now() + 250;
    loop.kick();
  };
  addEventListener('scroll', onScroll, { passive: true });

  function frameIsland(dt: number) {
    const el = document.querySelector('.island-window');
    const rect = el?.getBoundingClientRect();
    const target = rect && rect.height > 0 ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : p.away ? { x: w * 0.25, y: h * 0.84, w: w * 0.5, h: h * 0.14 } : { x: w * 0.08, y: h * 0.04, w: w * 0.84, h: h * 0.3 };
    const key = el ? 'window' : p.away ? 'away' : 'rest';
    const lift = p.away ? 0.42 : 0.3;
    // At a table it rests low on screen, under the board, where it can't crowd the header.
    // Fit the island (about 15 units across, 7 tall on screen) into the target rectangle.
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const th = tv * (w / h);
    const d = Math.max((15 * w) / (0.95 * target.w) / (2 * th), (7.5 * h) / (0.95 * target.h) / (2 * tv));
    const want = { d, x: w / 2 - (target.x + target.w / 2), y: h / 2 - (target.y + target.h / 2), lift };
    if (key !== mode) {
      if (mode) {
        from = { ...cur };
        blend = still ? 1 : 0;
      }
      mode = key;
    }
    blend = Math.min(1, blend + dt / 1.1);
    moving = blend < 1;
    const k = blend < 1 ? 1 - (1 - blend) ** 3 : 1;
    for (const f of ['d', 'x', 'y', 'lift'] as const) cur[f] = from[f] + (want[f] - from[f]) * k;

    const orbit = (still ? 0 : performance.now() / 1000) * 0.03 + 0.4;
    camera.position.set(Math.sin(orbit) * cur.d * Math.cos(cur.lift), cur.d * Math.sin(cur.lift) + 0.8, Math.cos(orbit) * cur.d * Math.cos(cur.lift));
    camera.lookAt(0, 0.8, 0);
    camera.setViewOffset(w, h, cur.x, cur.y, w, h);
  }

  buildStalls();
  buildPeople();
  let stallKey = JSON.stringify(p.stalls);
  const loop = startLoop(frame);

  return {
    update(next) {
      p = next;
      const key = JSON.stringify(p.stalls);
      if (key !== stallKey) {
        stallKey = key;
        buildStalls();
      }
      buildPeople();
      loop.kick();
    },
    resize(cw, ch) {
      w = Math.max(1, cw);
      h = Math.max(1, ch);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      loop.kick();
    },
    dispose() {
      loop.stop();
      removeEventListener('scroll', onScroll);
      disposeAll(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** A palm: a leaning, segmented trunk and drooping fronds. */
function palmTree(r: () => number) {
  const g = new THREE.Group();
  const trunkMat = flat(hsl(28, 32, 34));
  const lean = 0.18 + r() * 0.15;
  let y = 0;
  let x = 0;
  for (let k = 0; k < 4; k++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.1 - k * 0.012, 0.13 - k * 0.012, 0.6, 5), trunkMat);
    seg.position.set(x, y + 0.3, 0);
    seg.rotation.z = -lean * (k + 1) * 0.5;
    g.add(seg);
    y += 0.56;
    x += Math.sin(lean * (k + 1) * 0.5) * 0.6;
  }
  const leafMat = flat(hsl(120 + r() * 25, 48, 32));
  for (let k = 0; k < 6; k++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.4, 3).translate(0, 0.7, 0), leafMat);
    leaf.scale.z = 0.35;
    leaf.position.set(x, y, 0);
    leaf.rotation.set(0, (k / 6) * Math.PI * 2, 1.15 + r() * 0.3, 'YXZ');
    g.add(leaf);
  }
  const nut = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), flat(0x4a3220));
  nut.position.set(x + 0.08, y - 0.1, 0.05);
  g.add(nut);
  return g;
}
