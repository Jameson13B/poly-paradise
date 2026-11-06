import type { Engine } from './types.ts';

/** 8×8 keeps a game to a few minutes and leaves cells big enough to tap on a phone. */
export const SIZE = 8;
export const LENGTHS = [4, 3, 3, 2, 2];

export interface Ship {
  r: number;
  c: number;
  len: number;
  /** Runs down from (r, c) when true, otherwise right. */
  v: boolean;
}

export type FleetMove =
  | { k: 'shuffle' }
  | { k: 'place'; ship: number; r: number; c: number; v: boolean }
  | { k: 'ready' }
  | { k: 'fire'; r: number; c: number };

export interface Shot {
  seat: number;
  i: number;
  hit: boolean;
  /** Index of the ship this shot sank, if it did. */
  sank: number;
}

export interface FleetState {
  phase: 'place' | 'battle';
  fleets: Ship[][];
  ready: boolean[];
  /** shots[seat][i] is 1 once that seat has fired at cell i of the other seat's waters. */
  shots: number[][];
  turn: number;
  last: Shot | null;
}

/** 0 = untouched, 1 = miss, 2 = hit. */
export type Mark = 0 | 1 | 2;

/** What one seat sees: its own fleet, and only what its shots have revealed of the other. */
export interface FleetView {
  phase: FleetState['phase'];
  turn: number;
  ready: boolean[];
  mine: Ship[];
  mineSunk: boolean[];
  /** Shots the other seat has fired into your waters. */
  incoming: Mark[];
  /** Your shots into their waters. */
  target: Mark[];
  /** Their ships, revealed once sunk (or all of them when the game ends). */
  theirs: (Ship | null)[];
  theirsSunk: boolean[];
  last: Shot | null;
}

export const cells = (s: Ship) => Array.from({ length: s.len }, (_, k) => (s.r + (s.v ? k : 0)) * SIZE + s.c + (s.v ? 0 : k));

const inBounds = (s: Ship) => s.r >= 0 && s.c >= 0 && (s.v ? s.r + s.len : s.c + s.len) <= SIZE && (s.v ? s.c : s.r) < SIZE;

/** Ships may not overlap, but may touch. */
export function fits(fleet: Ship[], idx: number, s: Ship) {
  if (!inBounds(s)) return false;
  const taken = new Set(fleet.flatMap((o, j) => (j === idx ? [] : cells(o))));
  return cells(s).every((i) => !taken.has(i));
}

export function randomFleet(): Ship[] {
  for (;;) {
    const fleet: Ship[] = [];
    for (const len of LENGTHS) {
      for (let tries = 0; tries < 100; tries++) {
        const v = Math.random() < 0.5;
        const s = { len, v, r: Math.floor(Math.random() * (v ? SIZE - len + 1 : SIZE)), c: Math.floor(Math.random() * (v ? SIZE : SIZE - len + 1)) };
        if (fits(fleet, -1, s)) {
          fleet.push(s);
          break;
        }
      }
    }
    if (fleet.length === LENGTHS.length) return fleet;
  }
}

const sunk = (s: Ship, shots: number[]) => cells(s).every((i) => shots[i]);
const allSunk = (fleet: Ship[], shots: number[]) => fleet.every((s) => sunk(s, shots));

function marks(fleet: Ship[], shots: number[]): Mark[] {
  const hull = new Set(fleet.flatMap(cells));
  return shots.map((v, i) => (!v ? 0 : hull.has(i) ? 2 : 1));
}

const int = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max;

export const fleet: Engine<FleetState, FleetMove> = {
  setup(seats) {
    return {
      phase: 'place',
      fleets: Array.from({ length: seats }, randomFleet),
      ready: Array(seats).fill(false),
      shots: Array.from({ length: seats }, () => Array(SIZE * SIZE).fill(0)),
      turn: 0,
      last: null,
    };
  },

  move(s, seat, m) {
    if (this.outcome(s)) return 'The game is over';
    if (!m || typeof m !== 'object') return 'Bad move';

    if (m.k === 'shuffle' || m.k === 'place' || m.k === 'ready') {
      if (s.phase !== 'place') return 'The battle has started';
      if (s.ready[seat]) return "You're already locked in";
      if (m.k === 'ready') {
        const ready = s.ready.map((r, i) => r || i === seat);
        return { ...s, ready, phase: ready.every(Boolean) ? 'battle' : 'place' };
      }
      const fleets = [...s.fleets];
      if (m.k === 'shuffle') {
        fleets[seat] = randomFleet();
      } else {
        if (!int(m.ship, LENGTHS.length) || !int(m.r, SIZE) || !int(m.c, SIZE) || typeof m.v !== 'boolean') return 'Bad move';
        const ship = { r: m.r, c: m.c, v: m.v, len: LENGTHS[m.ship] };
        if (!fits(s.fleets[seat], m.ship, ship)) return "That ship doesn't fit there";
        fleets[seat] = s.fleets[seat].map((o, j) => (j === m.ship ? ship : o));
      }
      return { ...s, fleets };
    }

    if (m.k === 'fire') {
      if (s.phase !== 'battle') return 'Still placing ships';
      if (seat !== s.turn) return 'Not your turn';
      if (!int(m.r, SIZE) || !int(m.c, SIZE)) return 'Bad move';
      const i = m.r * SIZE + m.c;
      if (s.shots[seat][i]) return 'You already fired there';

      const foe = (seat + 1) % s.fleets.length;
      const shots = s.shots.map((row, j) => (j === seat ? row.map((v, k) => (k === i ? 1 : v)) : row));
      const ships = s.fleets[foe];
      const struck = ships.findIndex((ship) => cells(ship).includes(i));
      const sank = struck >= 0 && sunk(ships[struck], shots[seat]) ? struck : -1;
      // Turns alternate on every shot, hit or miss, so nobody runs away with it.
      return { ...s, shots, turn: foe, last: { seat, i, hit: struck >= 0, sank } };
    }

    return 'Bad move';
  },

  view(s, seat): FleetView {
    const me = Math.max(seat, 0);
    const foe = (me + 1) % s.fleets.length;
    const over = !!this.outcome(s);
    const theirsSunk = s.fleets[foe].map((ship) => sunk(ship, s.shots[me]));
    return {
      phase: s.phase,
      turn: s.turn,
      ready: s.ready,
      mine: s.fleets[me],
      mineSunk: s.fleets[me].map((ship) => sunk(ship, s.shots[foe])),
      incoming: marks(s.fleets[me], s.shots[foe]),
      target: marks(s.fleets[foe], s.shots[me]),
      theirs: s.fleets[foe].map((ship, j) => (over || theirsSunk[j] ? ship : null)),
      theirsSunk,
      last: s.last,
    };
  },

  outcome(s) {
    if (s.phase !== 'battle') return null;
    const lost = s.fleets.findIndex((f, seat) => allSunk(f, s.shots[(seat + 1) % s.fleets.length]));
    if (lost < 0) return null;
    const winner = (lost + 1) % s.fleets.length;
    const fired = s.shots[winner].reduce((a, b) => a + b, 0);
    return { winners: [winner], note: `Whole fleet sunk in ${fired} shots` };
  },
};
