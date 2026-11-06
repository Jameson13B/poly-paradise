import type { Engine } from './types.ts';

export interface DotsMove {
  k: 'h' | 'v';
  r: number;
  c: number;
}

export interface DotsState {
  /** Board size in boxes. */
  w: number;
  h: number;
  seats: number;
  /** Seat that drew each line, or -1. Horizontal lines: (h+1) rows of w. Vertical: h rows of (w+1). */
  hl: number[];
  vl: number[];
  /** Seat that closed each box, or -1. */
  boxes: number[];
  turn: number;
  last: DotsMove | null;
}

export function scores(s: DotsState): number[] {
  const out = Array(s.seats).fill(0);
  for (const b of s.boxes) if (b >= 0) out[b]++;
  return out;
}

function closed(s: DotsState, r: number, c: number): boolean {
  return (
    s.hl[r * s.w + c] >= 0 &&
    s.hl[(r + 1) * s.w + c] >= 0 &&
    s.vl[r * (s.w + 1) + c] >= 0 &&
    s.vl[r * (s.w + 1) + c + 1] >= 0
  );
}

export const dotsAndBoxes: Engine<DotsState, DotsMove> = {
  setup(seats) {
    const n = seats > 2 ? 5 : 4;
    return {
      w: n,
      h: n,
      seats,
      hl: Array((n + 1) * n).fill(-1),
      vl: Array(n * (n + 1)).fill(-1),
      boxes: Array(n * n).fill(-1),
      turn: 0,
      last: null,
    };
  },

  move(s, seat, m) {
    if (this.outcome(s)) return 'The game is over';
    if (seat !== s.turn) return 'Not your turn';
    if (!m || (m.k !== 'h' && m.k !== 'v') || !Number.isInteger(m.r) || !Number.isInteger(m.c)) return 'Bad move';

    const horizontal = m.k === 'h';
    const rows = horizontal ? s.h + 1 : s.h;
    const cols = horizontal ? s.w : s.w + 1;
    if (m.r < 0 || m.r >= rows || m.c < 0 || m.c >= cols) return 'Bad move';
    const idx = m.r * cols + m.c;
    if ((horizontal ? s.hl : s.vl)[idx] >= 0) return 'That line is taken';

    const next: DotsState = { ...s, hl: [...s.hl], vl: [...s.vl], boxes: [...s.boxes], last: m };
    (horizontal ? next.hl : next.vl)[idx] = seat;

    const touching: [number, number][] = horizontal
      ? [[m.r - 1, m.c], [m.r, m.c]]
      : [[m.r, m.c - 1], [m.r, m.c]];
    let scored = false;
    for (const [r, c] of touching) {
      if (r < 0 || r >= s.h || c < 0 || c >= s.w) continue;
      if (next.boxes[r * s.w + c] < 0 && closed(next, r, c)) {
        next.boxes[r * s.w + c] = seat;
        scored = true;
      }
    }
    // Closing a box earns another turn.
    next.turn = scored ? seat : (seat + 1) % s.seats;
    return next;
  },

  view: (s) => s,

  outcome(s) {
    if (s.boxes.some((b) => b < 0)) return null;
    const sc = scores(s);
    const best = Math.max(...sc);
    return { winners: sc.flatMap((v, i) => (v === best ? [i] : [])) };
  },
};
