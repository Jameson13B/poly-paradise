import { useEffect, useRef, useState } from 'preact/hooks';
import { HALF, PADDLE_W, STALL_MS, stepBall, type Ball, type BallEvent, type PaddleState } from '../../shared/games/paddle.ts';
import type { RoomView } from '../../shared/protocol.ts';
import { Gem, SEAT_HUES, seatColor } from '../art.tsx';
import { send } from '../net.ts';
import { Canvas3D } from '../three/Canvas3D.tsx';
import type { PaddleSceneProps } from '../three/paddle.ts';

const loadCourt = () => import('../three/paddle.ts');

export type CourtEvent = BallEvent | { t: 'point'; mine: boolean };

/** Your half of the court as this device plays it. The scene reads it every frame. */
export interface Court {
  ball: Ball | null;
  /** Local clock (ms) when your serve launches; null when the ball's in play. */
  serveAt: number | null;
  paddleX: number;
  paddleV: number;
  targetX: number;
  rivalX: number;
  events: CourtEvent[];
  /** Set by the scene: screen point to court x, for touch and mouse. */
  pick: (x: number, y: number) => number | null;
}

export function PaddleBoard({ room }: { room: RoomView }) {
  const s = room.view as PaddleState;
  const me = Math.max(room.you, 0);
  const foe = (me + 1) % s.score.length;
  const playing = room.status === 'playing';
  const skew = room.now - Date.now();

  const court = useRef<Court>({ ball: null, serveAt: null, paddleX: 0.5, paddleV: 0, targetX: 0.5, rivalX: 0.5, events: [], pick: () => null }).current;
  const seen = useRef({ seq: -1, last: '', stallSent: -1 });
  // The loop reads the latest state through this, so paddle relays don't restart it.
  const latest = useRef({ s, skew });
  latest.current = { s, skew };

  // A new ball (handoff or point) arrives from the server.
  useEffect(() => {
    court.rivalX = 1 - (s.paddles[foe] ?? 0.5);
    const was = seen.current;
    const last = JSON.stringify(s.last);
    if (s.last && last !== was.last && was.seq >= 0) court.events.push({ t: 'point', mine: s.last.scorer === me });
    was.last = last;
    if (s.seq === was.seq) return;
    was.seq = s.seq;
    if (s.owner !== me) {
      court.ball = null;
      court.serveAt = null;
    } else if (s.serve != null) {
      court.ball = { x: 0.5, y: 0.3, vx: 0, vy: 0 };
      court.serveAt = s.serve - skew;
    } else if (s.entry) {
      court.serveAt = null;
      court.ball = { x: s.entry.x, y: 0, vx: s.entry.vx, vy: s.entry.vy };
      // Make up the time it spent crossing between devices.
      const late = Math.min(0.25, Math.max(0, (Date.now() + skew - s.entry.at) / 1000));
      if (late) stepBall(court.ball, late, court.paddleX, 0);
    }
  }, [room]);

  const [, tick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let sentX = -1;
    let sentAt = 0;
    let lastTick = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      // The paddle chases your finger quickly but not instantly, which reads as weight.
      const prev = court.paddleX;
      court.paddleX += (court.targetX - court.paddleX) * (1 - Math.exp(-dt * 28));
      court.paddleX = Math.min(1 - PADDLE_W / 2, Math.max(PADDLE_W / 2, court.paddleX));
      court.paddleV = dt ? court.paddleV * 0.7 + ((court.paddleX - prev) / dt) * 0.3 : 0;

      const b = court.ball;
      if (b && court.serveAt != null) {
        if (Date.now() >= court.serveAt) {
          b.vx = (Math.random() - 0.5) * 0.6;
          b.vy = 0.8;
          court.serveAt = null;
        }
      } else if (b) {
        for (const e of stepBall(b, dt, court.paddleX, court.paddleV)) {
          court.events.push(e);
          if (e.t === 'pass') {
            send({ t: 'move', move: { k: 'pass', seq: seen.current.seq, x: e.ball.x, vx: e.ball.vx, vy: e.ball.vy } });
            court.ball = null;
          } else if (e.t === 'miss') {
            send({ t: 'move', move: { k: 'miss', seq: seen.current.seq } });
            court.ball = null;
          }
        }
      }

      // If the rival's device has gone quiet with the ball, ask the server to call it.
      const { s, skew } = latest.current;
      if (s.owner !== me && Date.now() + skew - s.since > STALL_MS + 500 && seen.current.stallSent !== s.seq) {
        seen.current.stallSent = s.seq;
        send({ t: 'move', move: { k: 'stall', seq: s.seq } });
      }
      if (Math.abs(court.paddleX - sentX) > 0.01 && t - sentAt > 100) {
        sentX = court.paddleX;
        sentAt = t;
        send({ t: 'move', move: { k: 'paddle', x: court.paddleX } });
      }
      if (t - lastTick > 250) {
        lastTick = t;
        tick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useKeys(court, playing);
  const aim = (e: PointerEvent) => {
    if (!playing) return;
    // Mouse follows without a button; touch follows while the finger is down.
    if (e.pointerType !== 'mouse' && !e.buttons && e.type !== 'pointerdown') return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = court.pick(e.clientX - r.left, e.clientY - r.top);
    if (x != null) court.targetX = x;
  };

  const props: PaddleSceneProps = { court, meHue: SEAT_HUES[me], rivalHue: SEAT_HUES[foe], playing };
  const foeName = room.seats[foe]?.name ?? 'Your rival';
  const serving = court.serveAt != null ? Math.ceil((court.serveAt - Date.now()) / 1000) : 0;
  const status = !playing
    ? ''
    : court.serveAt != null
      ? serving > 0
        ? `Your serve in ${serving}`
        : 'Your serve'
      : s.owner === me
        ? ''
        : s.serve != null
          ? `${foeName} serves`
          : `On ${foeName}'s side`;

  return (
    <div class="paddle">
      <ul class="scores">
        {[me, foe].map((i) => (
          <li class={`facet${room.seats[i]?.connected ? '' : ' away'}${playing && s.owner === i ? ' turn' : ''}`} style={{ '--seat': seatColor(i) }}>
            <Gem seed={room.seats[i]?.seed ?? 0} size={28} />
            <span class="name">{i === me ? 'You' : room.seats[i]?.name}</span>
            <b>{s.score[i]}</b>
          </li>
        ))}
      </ul>
      <p class="turn-line">{status}</p>
      <div class="paddle-pad" onPointerDown={aim} onPointerMove={aim}>
        <Canvas3D load={loadCourt} props={props} label="Your half of the court" fallback={<FlatCourt {...props} />} />
      </div>
      <p class="muted small fleet-hint">
        <span class="touch-hint">Slide to move. Put the phones top to top, like one table.</span>
        <span class="key-hint">Move with the mouse or ← →. First to 7.</span>
      </p>
    </div>
  );
}

function useKeys(court: Court, playing: boolean) {
  useEffect(() => {
    if (!playing) return;
    const held = new Set<string>();
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const dir = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
      if (dir) court.targetX = Math.min(1, Math.max(0, court.targetX + dir * 1.6 * dt));
      raf = requestAnimationFrame(loop);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      held.add(e.key);
    };
    const up = (e: KeyboardEvent) => held.delete(e.key);
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
    };
  }, [court, playing]);
}

/** For devices without WebGL: the same half court, drawn flat from above. */
function FlatCourt({ court, meHue, rivalHue }: PaddleSceneProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      const u = Math.min(c.width, c.height / HALF);
      const ox = (c.width - u) / 2;
      court.pick = (x) => Math.min(1, Math.max(0, (x * dpr - ox) / u));
      ctx.fillStyle = '#2a1e1a';
      ctx.fillRect(ox, 0, u, HALF * u);
      ctx.fillStyle = `hsl(${rivalHue} 70% 60% / 0.5)`;
      ctx.fillRect(ox + (court.rivalX - PADDLE_W / 2) * u, 0, PADDLE_W * u, 4 * dpr);
      ctx.fillStyle = `hsl(${meHue} 70% 60%)`;
      ctx.fillRect(ox + (court.paddleX - PADDLE_W / 2) * u, 1.33 * u, PADDLE_W * u, 0.05 * u);
      if (court.ball) {
        ctx.fillStyle = '#fff4dc';
        ctx.beginPath();
        ctx.arc(ox + court.ball.x * u, court.ball.y * u, 0.03 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      court.events.length = 0;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [court]);
  return <canvas ref={ref} class="flat-court" aria-label="Your half of the court" />;
}
