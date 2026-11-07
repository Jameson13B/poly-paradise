import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HIDDEN, JUNK, W, type StackPlayer, type StackState } from '../../shared/games/stack.ts';
import type { RoomView } from '../../shared/protocol.ts';
import { Gem, SEAT_HUES, seatColor } from '../art.tsx';
import { send } from '../net.ts';
import { Canvas3D } from '../three/Canvas3D.tsx';
import type { StackSceneProps } from '../three/stack.ts';
import { cellsOfPiece, LocalStack, type StackEvent } from './stack-local.ts';

const loadStack = () => import('../three/stack.ts');

export function StackBoard({ room }: { room: RoomView }) {
  const s = room.view as StackState;
  const you = Math.max(room.you, 0);
  const foe = (you + 1) % s.players.length;
  const playing = room.status === 'playing';

  // Pieces start falling at the server's start time, measured on this device's clock.
  const skew = room.now - Date.now();
  const game = useMemo(
    () => new LocalStack(s.seed, you, s.started - skew, s.players[you], (move) => send({ t: 'move', move })),
    [s.seed, you],
  );
  useEffect(() => game.sync(s.players[you], performance.now()), [room]);

  // Queue the rival's line clears so their board shatters too.
  const rivalEvents = useRef<StackEvent[]>([]);
  const prevRival = useRef<StackPlayer | null>(null);
  useEffect(() => {
    const before = prevRival.current;
    const l = s.last;
    if (before && l && l.seat === foe && l.cleared.length && l.n !== before.n)
      rivalEvents.current.push({ t: 'clear', rows: l.cleared, colors: l.cleared.map((y) => before.board.slice(y * W, y * W + W).map((v) => v || 3)) });
    prevRival.current = s.players[foe];
  }, [s]);

  // The game clock: gravity, landing, and a light tick for the countdown text.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastTick = 0;
    const loop = (t: number) => {
      game.step(Date.now(), Math.min(100, t - last));
      last = t;
      if (t - lastTick > 250) {
        lastTick = t;
        tick((n) => n + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, playing]);

  useKeys(game, playing);
  const pad = useGestures(game, playing);

  const props: StackSceneProps = { game, rival: s.players[foe] ?? null, rivalEvents: rivalEvents.current, meHue: SEAT_HUES[you], rivalHue: SEAT_HUES[foe], playing };
  const countdown = Math.ceil((game.started - Date.now()) / 1000);

  return (
    <div class="stack">
      <ul class="scores">
        {[you, foe].map((i) => {
          const pl = i === you ? game.player : s.players[i];
          return (
            <li class={`facet${pl?.out ? ' away' : ''}`} style={{ '--seat': seatColor(i) }}>
              <Gem seed={room.seats[i]?.seed ?? 0} size={28} />
              <span class="name">{i === you ? 'You' : room.seats[i]?.name}</span>
              <b>{pl?.lines ?? 0}</b>
              <span class="muted small">lines</span>
            </li>
          );
        })}
      </ul>
      <div class="stack-pad" {...pad}>
        <Canvas3D load={loadStack} props={props} label="Your stack and your rival's" fallback={<FlatStack {...props} />} />
        {playing && countdown > 0 && <div class="countdown">{countdown}</div>}
        {playing && game.player.out && <div class="countdown small">Topped out</div>}
      </div>
      <p class="muted small fleet-hint">
        <span class="touch-hint">Drag to move · tap to turn · flick down to drop</span>
        <span class="key-hint">← → move · ↑ or X turn · Z turn back · ↓ faster · Space drops</span>
      </p>
    </div>
  );
}

/** Arrow keys move and turn, Space drops; held arrows repeat after a short pause. */
function useKeys(game: LocalStack, playing: boolean) {
  useEffect(() => {
    if (!playing) return;
    const held = new Map<string, number>();
    const repeat = (key: string, act: () => void) => {
      act();
      held.set(key, window.setTimeout(function again() {
        act();
        held.set(key, window.setTimeout(again, 45));
      }, 150));
    };
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'x', 'z', 'X', 'Z'].includes(k)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (k === 'ArrowLeft') repeat(k, () => game.shift(-1));
      else if (k === 'ArrowRight') repeat(k, () => game.shift(1));
      else if (k === 'ArrowDown') game.softDrop(true);
      else if (k === 'ArrowUp' || k === 'x' || k === 'X') game.turn(1);
      else if (k === 'z' || k === 'Z') game.turn(-1);
      else if (k === ' ') game.hardDrop();
    };
    const up = (e: KeyboardEvent) => {
      clearTimeout(held.get(e.key));
      held.delete(e.key);
      if (e.key === 'ArrowDown') game.softDrop(false);
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      for (const t of held.values()) clearTimeout(t);
    };
  }, [game, playing]);
}

/** Drag sideways to move a column per cell, drag down to step down, tap to turn, flick down to drop. */
function useGestures(game: LocalStack, playing: boolean) {
  const g = useRef<{ id: number; x0: number; y0: number; ax: number; ay: number; lx: number; ly: number; t0: number; moved: boolean } | null>(null);
  return {
    onPointerDown(e: PointerEvent) {
      if (!playing || !game.live) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ax: e.clientX, ay: e.clientY, lx: e.clientX, ly: e.clientY, t0: e.timeStamp, moved: false };
    },
    onPointerMove(e: PointerEvent) {
      const d = g.current;
      if (!d || d.id !== e.pointerId) return;
      d.lx = e.clientX;
      d.ly = e.clientY;
      const step = game.cellPx * 0.85;
      while (e.clientX - d.ax >= step) {
        game.shift(1);
        d.ax += step;
        d.moved = true;
      }
      while (d.ax - e.clientX >= step) {
        game.shift(-1);
        d.ax -= step;
        d.moved = true;
      }
      while (e.clientY - d.ay >= game.cellPx) {
        game.nudgeDown();
        d.ay += game.cellPx;
        d.moved = true;
      }
    },
    onPointerUp(e: PointerEvent) {
      const d = g.current;
      g.current = null;
      if (!d || d.id !== e.pointerId) return;
      // Event timestamps measure the finger, not when a busy frame let this run.
      const dt = Math.max(1, e.timeStamp - d.t0);
      // The last move is more reliable than pointerup's coordinates on some touch screens.
      const dx = d.lx - d.x0;
      const dy = d.ly - d.y0;
      if (!d.moved && dt < 300 && Math.hypot(dx, dy) < 12) game.turn(1);
      else if (dy > game.cellPx * 2 && dy / dt > 0.6 && Math.abs(dx) < dy) game.hardDrop();
    },
    onPointerCancel() {
      g.current = null;
    },
  };
}

/** For devices without WebGL: the same layout, drawn flat. */
function FlatStack({ game, rival, meHue, playing }: StackSceneProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const color = (k: number) => (k === JUNK ? '#5b5f70' : `hsl(${[0, 330, 168, 42, 200, 95, 262, 14][k]} 68% 54%)`);
    const draw = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      const cell = Math.min(c.width / (W * 1.5 + 1.5), c.height / 20.5);
      game.cellPx = cell / dpr;
      const drawBoard = (board: number[], ox: number, size: number, extra: number[] = [], kind = 0) => {
        ctx.fillStyle = '#141432';
        ctx.fillRect(ox, 0, W * size, 20 * size);
        board.forEach((k, i) => {
          if (!k || i < HIDDEN * W) return;
          ctx.fillStyle = color(k);
          ctx.fillRect(ox + (i % W) * size + 1, (Math.floor(i / W) - HIDDEN) * size + 1, size - 2, size - 2);
        });
        for (const i of extra) {
          if (i < HIDDEN * W) continue;
          ctx.fillStyle = color(kind);
          ctx.fillRect(ox + (i % W) * size + 1, (Math.floor(i / W) - HIDDEN) * size + 1, size - 2, size - 2);
        }
      };
      ctx.clearRect(0, 0, c.width, c.height);
      drawBoard(game.player.board, 0, cell, game.piece ? cellsOfPiece(game.piece) : [], game.piece?.kind);
      if (rival) drawBoard(rival.board, cell * (W + 1), cell * 0.45);
      ctx.fillStyle = `hsl(${meHue} 70% 60%)`;
      ctx.fillRect(cell * W + 2, c.height - game.player.pending * cell, 4, game.player.pending * cell);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [game, rival, playing]);
  return <canvas ref={ref} class="flat-stack" aria-label="Your stack and your rival's" />;
}
