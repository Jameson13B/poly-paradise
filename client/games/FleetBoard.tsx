import { useState } from 'preact/hooks';
import { cells as cellsOf, fits, SIZE, type FleetMove, type FleetView, type Mark, type Ship } from '../../shared/games/fleet.ts';
import type { RoomView } from '../../shared/protocol.ts';
import { Gem, rng, SEAT_HUES, seatColor } from '../art.tsx';
import { send } from '../net.ts';
import { Canvas3D } from '../three/Canvas3D.tsx';
import type { SeaProps } from '../three/sea.ts';

const loadSea = () => import('../three/sea.ts');

const C = 40;
const W = SIZE * C;
const move = (m: FleetMove) => send({ t: 'move', move: m });

export function FleetBoard({ room }: { room: RoomView }) {
  const v = room.view as FleetView;
  const you = Math.max(room.you, 0);
  const foe = (you + 1) % 2;
  const foeName = room.seats[foe]?.name ?? 'Your rival';
  const playing = room.status === 'playing';
  const afloat = (sunk: boolean[]) => sunk.filter((s) => !s).length;

  return (
    <div class="fleet" style={{ '--me': seatColor(you) }}>
      <ul class="scores">
        {[you, foe].map((i) => (
          <li
            class={`facet${i === you ? ' mine' : ''}${playing && v.phase === 'battle' && v.turn === i ? ' turn' : ''}${room.seats[i]?.connected ? '' : ' away'}`}
            style={{ '--seat': seatColor(i) }}
          >
            <Gem seed={room.seats[i]?.seed ?? 0} size={28} />
            <span class="name">{i === you ? 'You' : room.seats[i]?.name}</span>
            {v.phase === 'place' ? (
              <span class={`badge${v.ready[i] ? ' on' : ''}`} aria-label={v.ready[i] ? 'Ready' : 'Placing ships'}>
                {v.ready[i] ? '✓' : '…'}
              </span>
            ) : (
              <>
                <b>{afloat(i === you ? v.mineSunk : v.theirsSunk)}</b>
                <span class="muted small">afloat</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {v.phase === 'place' ? <Placing v={v} you={you} foeName={foeName} /> : <Battle v={v} you={you} foe={foe} foeName={foeName} playing={playing} />}
    </div>
  );
}

function Placing({ v, you, foeName }: { v: FleetView; you: number; foeName: string }) {
  const [sel, setSel] = useState(-1);
  const [nope, setNope] = useState('');
  const locked = v.ready[you];

  const tap = (r: number, c: number) => {
    if (locked) return;
    const i = r * SIZE + c;
    const here = v.mine.findIndex((s) => cellsOf(s).includes(i));
    let next: Ship | null = null;
    if (here >= 0 && here !== sel) return (setSel(here), setNope(''));
    if (here >= 0) next = { ...v.mine[here], v: !v.mine[here].v }; // tap the picked-up ship again to turn it
    else if (sel >= 0) next = { ...v.mine[sel], r, c };
    else return;
    const idx = here >= 0 ? here : sel;
    if (!fits(v.mine, idx, next)) return setNope("That doesn't fit there");
    setNope('');
    move({ k: 'place', ship: idx, r: next.r, c: next.c, v: next.v });
  };

  return (
    <>
      <p class="turn-line">{locked ? `Locked in. Waiting for ${foeName}…` : v.ready[(you + 1) % 2] ? `${foeName} is ready` : 'Arrange your fleet'}</p>
      <p class={`muted small fleet-hint${nope ? ' nope' : ''}`}>
        {locked ? 'Your ships stay hidden until they are hit.' : nope || (sel < 0 ? 'Tap a ship to pick it up.' : 'Tap water to move it, or tap the ship again to turn it.')}
      </p>
      <Waters ships={v.mine} hue={SEAT_HUES[you]} marks={v.incoming} selected={locked ? -1 : sel} onTap={locked ? undefined : tap} seed={you + 11} meHue={SEAT_HUES[you]} label="Your waters" />
      {!locked && (
        <div class="row fleet-actions">
          <button class="btn ghost" onClick={() => (setSel(-1), move({ k: 'shuffle' }))}>
            Shuffle
          </button>
          <button class="btn" onClick={() => (setSel(-1), move({ k: 'ready' }))}>
            Ready
          </button>
        </div>
      )}
    </>
  );
}

function Battle({ v, you, foe, foeName, playing }: { v: FleetView; you: number; foe: number; foeName: string; playing: boolean }) {
  const myTurn = playing && v.turn === you;
  const fire = (r: number, c: number) => myTurn && !v.target[r * SIZE + c] && move({ k: 'fire', r, c });
  const theirs = v.theirs.filter((s): s is Ship => !!s);

  return (
    <>
      <p class="turn-line">{playing ? (myTurn ? 'Your shot' : `${foeName} is aiming…`) : ''}</p>
      <p class="muted small fleet-hint">{report(v, you, foeName)}</p>
      <div class="fleet-boards">
        <Waters
          ships={theirs}
          sunk={v.theirs.flatMap((s, j) => (s ? [v.theirsSunk[j]] : []))}
          hue={SEAT_HUES[foe]}
          marks={v.target}
          fresh={v.last?.seat === you ? v.last.i : -1}
          onTap={myTurn ? fire : undefined}
          seed={foe + 31}
          label={`${foeName}'s waters`}
          live={myTurn}
          meHue={SEAT_HUES[you]}
        />
        <Waters
          ships={v.mine}
          sunk={v.mineSunk}
          hue={SEAT_HUES[you]}
          marks={v.incoming}
          fresh={v.last?.seat === foe ? v.last.i : -1}
          seed={you + 11}
          label="Your waters"
          meHue={SEAT_HUES[you]}
          mini
        />
      </div>
    </>
  );
}

function report(v: FleetView, you: number, foeName: string) {
  const l = v.last;
  if (!l) return 'Tap their waters to fire. Every shot passes the turn.';
  const mine = l.seat === you;
  if (l.sank >= 0) return mine ? 'You sank a ship!' : `${foeName} sank one of your ships.`;
  if (l.hit) return mine ? 'Hit!' : `${foeName} hit one of your ships.`;
  return mine ? 'Splash. A miss.' : `${foeName} missed.`;
}

interface WatersProps {
  ships: Ship[];
  sunk?: boolean[];
  hue: number;
  marks: Mark[];
  seed: number;
  label: string;
  selected?: number;
  fresh?: number;
  live?: boolean;
  mini?: boolean;
  meHue: number;
  onTap?: (r: number, c: number) => void;
}

function Waters(props: WatersProps) {
  const { ships, sunk = [], hue, marks, seed, label, selected = -1, fresh = -1, live = false, mini, meHue, onTap } = props;
  const sea: SeaProps = { ships, sunk, hue, marks, seed, selected, fresh, live, meHue, onTap };
  return (
    <figure class={`waters${mini ? ' mini' : ''}${live ? ' live' : ''}`}>
      <Canvas3D load={loadSea} props={sea} class="sea" label={label} fallback={<FlatWaters {...props} />} />
      <figcaption class="muted small">{label}</figcaption>
    </figure>
  );
}

/** The flat board, for devices without WebGL. */
function FlatWaters({ ships, sunk = [], hue, marks, seed, label, selected = -1, fresh = -1, live, onTap }: WatersProps) {
  const r = rng(seed);
  return (
      <svg class="grid panel facet" viewBox={`-4 -4 ${W + 8} ${W + 8}`} role="img" aria-label={label}>
        {/* Water: two triangles a cell, each a slightly different depth. */}
        {marks.map((_, i) => {
          const x = (i % SIZE) * C;
          const y = Math.floor(i / SIZE) * C;
          const a = 30 + r() * 8;
          const b = 24 + r() * 8;
          return (
            <g>
              <polygon points={`${x},${y} ${x + C},${y} ${x},${y + C}`} fill={`hsl(212 62% ${a}%)`} />
              <polygon points={`${x + C},${y} ${x + C},${y + C} ${x},${y + C}`} fill={`hsl(216 64% ${b}%)`} />
            </g>
          );
        })}
        {ships.map((s, j) => (
          <Hull ship={s} hue={hue} sunk={!!sunk[j]} selected={j === selected} />
        ))}
        {marks.map((m, i) =>
          m ? <Peg x={(i % SIZE) * C + C / 2} y={Math.floor(i / SIZE) * C + C / 2} hit={m === 2} fresh={i === fresh} /> : null,
        )}
        {onTap &&
          marks.map((m, i) => (
            <rect
              class={`cell${m && live ? ' spent' : ''}`}
              x={(i % SIZE) * C}
              y={Math.floor(i / SIZE) * C}
              width={C}
              height={C}
              onClick={() => onTap(Math.floor(i / SIZE), i % SIZE)}
            />
          ))}
      </svg>
  );
}

/** A faceted hull with a pointed bow, drawn lying right and turned for vertical ships. */
function Hull({ ship, hue, sunk, selected }: { ship: Ship; hue: number; sunk: boolean; selected: boolean }) {
  const w = ship.len * C;
  const m = C / 2;
  const x = ship.c * C;
  const y = ship.r * C;
  const t = ship.v ? `translate(${x + C} ${y}) rotate(90)` : `translate(${x} ${y})`;
  const sat = sunk ? 8 : 34;
  return (
    <g class={`hull${sunk ? ' sunk' : ''}${selected ? ' picked' : ''}`} transform={t}>
      <polygon points={`5,${m} 9,8 ${w - 15},8 ${w - 4},${m}`} fill={`hsl(${hue} ${sat}% ${sunk ? 30 : 72}%)`} />
      <polygon points={`5,${m} ${w - 4},${m} ${w - 15},${C - 8} 9,${C - 8}`} fill={`hsl(${hue} ${sat}% ${sunk ? 20 : 50}%)`} />
      {Array.from({ length: ship.len - 1 }, (_, k) => {
        const cx = (k + 0.7) * C;
        return <polygon points={`${cx},${m - 6} ${cx + 6},${m} ${cx},${m + 6} ${cx - 6},${m}`} fill={`hsl(${hue} ${sat}% ${sunk ? 38 : 86}%)`} />;
      })}
    </g>
  );
}

function Peg({ x, y, hit, fresh }: { x: number; y: number; hit: boolean; fresh: boolean }) {
  if (!hit) {
    return <polygon class={`peg miss${fresh ? ' fresh' : ''}`} points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`} />;
  }
  // An eight-point burst; alternating radii keep it jagged rather than round.
  const pts = Array.from({ length: 16 }, (_, k) => {
    const a = (Math.PI / 8) * k;
    const rad = k % 2 ? 6 : 14;
    return `${(x + Math.cos(a) * rad).toFixed(1)},${(y + Math.sin(a) * rad).toFixed(1)}`;
  }).join(' ');
  return (
    <g class={`peg hit${fresh ? ' fresh' : ''}`} style={{ transformOrigin: `${x}px ${y}px` }}>
      <polygon points={pts} fill="hsl(18 95% 56%)" />
      <polygon points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`} fill="hsl(46 100% 70%)" />
    </g>
  );
}
