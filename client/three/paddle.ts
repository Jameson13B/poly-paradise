import * as THREE from 'three';
import { BALL_R, HALF, PADDLE_W, PADDLE_Y } from '../../shared/games/paddle.ts';
import { rng } from '../art.tsx';
import type { Court, CourtEvent } from '../games/PaddleBoard.tsx';
import { addLights, clamp01, disposeAll, fitCamera, flat, groundPoint, hsl, makeRenderer, reducedMotion, roughen, startLoop } from './gl.ts';
import type { Scene3D } from './support.ts';

export interface PaddleSceneProps {
  court: Court;
  meHue: number;
  rivalHue: number;
  playing: boolean;
}

/** Court units to scene units: the court is 10 wide, the middle line at z = 0, your baseline toward the camera. */
const S = 10;
const LIFT = 0.35;
const TRAIL = 10;

export function create(canvas: HTMLCanvasElement, first: PaddleSceneProps): Scene3D<PaddleSceneProps> {
  let p = first;
  const still = reducedMotion();
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
  const { sun } = addLights(scene, 12, 0.85);
  sun.position.set(-6, 22, 18);
  sun.target.position.set(S / 2, 0, (HALF * S) / 2);
  scene.add(sun.target);
  const r = rng(28);
  let w = 1;
  let h = 1;

  // Floor: a grid of slightly uneven warm stone tiles.
  const cols = 5;
  const rows = 8;
  const tw = S / cols;
  const tl = (HALF * S) / rows;
  const tileGeo = new THREE.BoxGeometry(tw * 0.96, 0.3, tl * 0.96);
  const tiles = new THREE.InstancedMesh(tileGeo, flat(0xffffff), cols * rows);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < cols * rows; i++) {
    tiles.setMatrixAt(i, m4.makeTranslation((i % cols) * tw + tw / 2, -0.15 + r() * 0.04, Math.floor(i / cols) * tl + tl / 2));
    tiles.setColorAt(i, hsl(222 + r() * 14, 20, 15 + r() * 5));
  }
  tiles.receiveShadow = true;
  const bed = new THREE.Mesh(new THREE.BoxGeometry(S + 1.4, 0.5, HALF * S + 1), flat(hsl(225, 25, 7)));
  bed.position.set(S / 2, -0.45, (HALF * S) / 2 + 0.3);
  scene.add(tiles, bed);

  const stone = flat(hsl(32, 34, 46));
  for (const x of [-0.35, S + 0.35]) {
    const rail = new THREE.Mesh(roughen(new THREE.BoxGeometry(0.6, 0.7, HALF * S + 0.8, 1, 1, 8), r, 0.14), stone);
    rail.position.set(x, 0.15, (HALF * S) / 2 + 0.2);
    rail.castShadow = rail.receiveShadow = true;
    scene.add(rail);
  }

  // The middle line, where the ball crosses onto the other phone: a glowing seam.
  const seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(S + 1.2, 0.08, 0.14), seamMat);
  seam.position.set(S / 2, 0.02, 0);
  const curtainMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(S + 1.2, 1.4), curtainMat);
  curtain.position.set(S / 2, 0.7, 0);
  // Where the rival's paddle is, on their screen.
  const rivalMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  const rivalMark = new THREE.Mesh(new THREE.BoxGeometry(PADDLE_W * S, 0.12, 0.2), rivalMat);
  rivalMark.position.set(S / 2, 0.08, -0.25);
  scene.add(seam, curtain, rivalMark);

  // Your paddle: a long hexagonal gem.
  const paddleMat = flat(0xffffff, { emissive: new THREE.Color(0) });
  const paddle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, PADDLE_W * S, 6).rotateZ(Math.PI / 2), paddleMat);
  paddle.position.set(S / 2, LIFT, PADDLE_Y * S);
  paddle.castShadow = true;
  scene.add(paddle);

  const ballMat = flat(0xfff2d6, { emissive: hsl(36, 90, 30) });
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R * S * 1.15, 0), ballMat);
  ball.castShadow = true;
  const trail = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(BALL_R * S, 0), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.35, depthWrite: false }), TRAIL);
  const serveRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  scene.add(ball, trail, serveRing);
  const history: THREE.Vector3[] = [];

  const fxLayer = new THREE.Group();
  scene.add(fxLayer);
  type Fx = { start: number; dur: number; step(k: number): void; objs: THREE.Object3D[] };
  let fx: Fx[] = [];
  let shake = 0;
  let paddleFlash = 0;
  let seamFlash = 0;
  let seamFlashHue = 0;

  const shard = new THREE.TetrahedronGeometry(0.16, 0);
  function burst(at: THREE.Vector3, n: number, color: THREE.Color, speed: number, up: number, dir = new THREE.Vector3()) {
    const bits = Array.from({ length: n }, () => {
      const m = new THREE.Mesh(shard, new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.copy(at);
      fxLayer.add(m);
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(a) * speed * Math.random(), up * (0.5 + Math.random()), Math.sin(a) * speed * Math.random()).add(dir);
      return { m, vel, spin: (Math.random() - 0.5) * 16 };
    });
    let last = 0;
    fx.push({
      start: performance.now(),
      dur: 0.7,
      objs: bits.map((b) => b.m),
      step(k) {
        const dt = (k - last) * 0.7;
        last = k;
        for (const b of bits) {
          b.vel.y -= 14 * dt;
          b.m.position.addScaledVector(b.vel, dt);
          b.m.rotation.x += b.spin * dt;
          b.m.rotation.z += b.spin * dt;
          (b.m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
        }
      },
    });
  }

  const at = (x: number, y: number) => new THREE.Vector3(x * S, LIFT, y * S);
  function react(e: CourtEvent) {
    if (still) return;
    if (e.t === 'hit') {
      burst(at(e.x, e.y), 8 + Math.round(e.power * 8), hsl(p.meHue, 80, 64), 3 + e.power * 4, 3, new THREE.Vector3(0, 0, -3));
      paddleFlash = 1;
      shake = Math.max(shake, 0.1 + e.power * 0.2);
    } else if (e.t === 'wall') burst(at(e.x, e.y), 5, new THREE.Color(0xffe0b0), 2, 2);
    else if (e.t === 'miss') {
      burst(at(e.x, HALF), 18, hsl(4, 80, 58), 5, 4);
      shake = 0.5;
    } else if (e.t === 'pass') {
      seamFlash = 1;
      seamFlashHue = p.meHue;
    } else if (e.t === 'point' && e.mine) {
      for (let k = 0; k < 5; k++) burst(new THREE.Vector3(Math.random() * S, 0.6, 0.3), 6, hsl(p.meHue, 80, 62), 3, 6, new THREE.Vector3(0, 0, 2));
      seamFlash = 1;
      seamFlashHue = p.meHue;
    }
  }

  function frame(t: number) {
    const c = p.court;
    for (const e of c.events.splice(0)) react(e);
    const time = still ? 0 : t;

    paddle.position.x = c.paddleX * S;
    paddle.rotation.z = Math.max(-0.25, Math.min(0.25, -c.paddleV * 0.08));
    paddle.rotation.x = time * 0.6;
    paddleFlash = Math.max(0, paddleFlash - 0.06);
    paddleMat.color.copy(hsl(p.meHue, 70, 56));
    paddleMat.emissive.copy(hsl(p.meHue, 80, 14 + paddleFlash * 40));

    rivalMark.position.x = c.rivalX * S;
    rivalMat.color.copy(hsl(p.rivalHue, 75, 62));
    // The seam glows in the rival's colour, brighter while the ball is over there.
    const away = !c.ball && p.playing;
    seamFlash = Math.max(0, seamFlash - 0.03);
    const pulse = away ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
    seamMat.color.copy(hsl(p.rivalHue, 80, 50 + pulse * 18)).lerp(hsl(seamFlashHue, 90, 75), seamFlash);
    curtainMat.color.copy(seamMat.color);
    curtainMat.opacity = 0.08 + pulse * 0.1 + seamFlash * 0.3;

    const b = c.ball;
    ball.visible = !!b;
    serveRing.visible = !!b && c.serveAt != null;
    let tk = 0;
    if (b) {
      const pos = at(b.x, b.y);
      if (c.serveAt != null) pos.y += Math.abs(Math.sin(time * 4)) * 0.4;
      ball.position.copy(pos);
      ball.rotation.x += 0.2;
      ball.rotation.y += 0.13;
      serveRing.position.set(pos.x, 0.05, pos.z);
      serveRing.scale.setScalar(1 + (time * 1.5) % 1);
      (serveRing.material as THREE.MeshBasicMaterial).opacity = 1 - ((time * 1.5) % 1);
      history.unshift(pos.clone());
      history.length = Math.min(history.length, TRAIL);
      history.forEach((hp, k) => {
        m4.compose(hp, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(1 - k / TRAIL));
        trail.setMatrixAt(tk++, m4);
      });
    } else history.length = 0;
    trail.count = c.serveAt != null ? 0 : tk;
    trail.instanceMatrix.needsUpdate = true;

    const now = performance.now();
    const running = fx;
    fx = [];
    for (const f of running) {
      const k = clamp01((now - f.start) / 1000 / f.dur);
      f.step(k);
      if (k < 1) fx.push(f);
      else
        for (const o of f.objs) {
          fxLayer.remove(o);
          ((o as THREE.Mesh).material as THREE.Material).dispose();
        }
    }

    const off = shake > 0 ? new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.5, 0) : new THREE.Vector3();
    shake = Math.max(0, shake - 0.03);
    camera.position.add(off);
    renderer.render(scene, camera);
    camera.position.sub(off);
    return p.playing || fx.length ? 16 : Infinity;
  }

  function fit() {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const corners = [-0.8, S + 0.8].flatMap((x) => [-0.6, HALF * S + 0.8].flatMap((z) => [new THREE.Vector3(x, -0.2, z), new THREE.Vector3(x, 0.8, z)]));
    fitCamera(camera, new THREE.Vector3(S / 2, 0, (HALF * S) / 2 + 0.4), new THREE.Vector3(0, 2.6, 1).normalize(), corners, 0.98);
    p.court.pick = (x, y) => {
      const g = groundPoint(camera, w, h, x, y, LIFT);
      return g ? Math.min(1, Math.max(0, g.x / S)) : null;
    };
  }

  const loop = startLoop(frame);
  return {
    update(next) {
      p = next;
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
