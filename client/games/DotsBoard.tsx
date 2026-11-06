import { scores, type DotsMove, type DotsState } from '../../shared/games/dots-and-boxes.ts';
import type { RoomView } from '../../shared/protocol.ts';
import { Gem, SEAT_HUES, seatColor } from '../art.tsx';
import { send } from '../net.ts';

const G = 64;
const PAD = 18;

export function DotsBoard({ room }: { room: RoomView }) {
  const s = room.view as DotsState;
  const myTurn = room.status === 'playing' && s.turn === room.you;
  const sc = scores(s);
  const size = (n: number) => n * G + PAD * 2;
  const isLast = (m: DotsMove) => s.last?.k === m.k && s.last.r === m.r && s.last.c === m.c;
  const play = (m: DotsMove) => myTurn && send({ t: 'move', move: m });

  const line = (m: DotsMove, owner: number) => {
    const x1 = PAD + m.c * G;
    const y1 = PAD + m.r * G;
    const [x2, y2] = m.k === 'h' ? [x1 + G, y1] : [x1, y1 + G];
    if (owner >= 0) {
      return <line class={`drawn${isLast(m) ? ' last' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={seatColor(owner)} />;
    }
    return (
      <g class={`slot${myTurn ? ' live' : ''}`} onClick={() => play(m)}>
        <line class="ghost" x1={x1} y1={y1} x2={x2} y2={y2} />
        <line class="hit" x1={x1} y1={y1} x2={x2} y2={y2} />
      </g>
    );
  };

  const lines = [];
  for (let r = 0; r <= s.h; r++) for (let c = 0; c < s.w; c++) lines.push(line({ k: 'h', r, c }, s.hl[r * s.w + c]));
  for (let r = 0; r < s.h; r++) for (let c = 0; c <= s.w; c++) lines.push(line({ k: 'v', r, c }, s.vl[r * (s.w + 1) + c]));

  const turnName = room.seats[s.turn]?.name;

  return (
    <div class="dots" style={{ '--me': room.you >= 0 ? seatColor(room.you) : '#fff' }}>
      <ul class="scores">
        {room.seats.map((p, i) => (
          <li class={`facet${room.status === 'playing' && s.turn === i ? ' turn' : ''}${p.connected ? '' : ' away'}`} style={{ '--seat': seatColor(i) }}>
            <Gem seed={p.seed} size={28} />
            <span class="name">{i === room.you ? 'You' : p.name}</span>
            <b>{sc[i]}</b>
          </li>
        ))}
      </ul>
      <p class="turn-line">{room.status !== 'playing' ? '' : myTurn ? 'Your move' : `${turnName}'s move`}</p>
      <svg class="board panel facet" viewBox={`0 0 ${size(s.w)} ${size(s.h)}`} role="img" aria-label="Dots and boxes board">
        {s.boxes.map((owner, i) => {
          if (owner < 0) return null;
          const x = PAD + (i % s.w) * G;
          const y = PAD + Math.floor(i / s.w) * G;
          const hue = SEAT_HUES[owner];
          // Two shaded triangles per box keep the faceted look.
          return (
            <g class="box">
              <polygon points={`${x},${y} ${x + G},${y} ${x},${y + G}`} fill={`hsl(${hue} 60% 46%)`} />
              <polygon points={`${x + G},${y} ${x + G},${y + G} ${x},${y + G}`} fill={`hsl(${hue} 55% 36%)`} />
            </g>
          );
        })}
        {lines}
        {Array.from({ length: (s.h + 1) * (s.w + 1) }, (_, i) => {
          const x = PAD + (i % (s.w + 1)) * G;
          const y = PAD + Math.floor(i / (s.w + 1)) * G;
          return <polygon class="pip" points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`} />;
        })}
      </svg>
    </div>
  );
}
