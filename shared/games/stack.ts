import type { Engine } from './types.ts';

/**
 * Stack Duel: a falling-blocks race. Each device runs its own board for instant
 * controls; the server checks every piece as it lands, using this same code, so
 * both copies agree. Both players get the same piece order from a shared seed.
 */

export const W = 10;
/** Two hidden rows on top where pieces enter. */
export const HIDDEN = 2;
export const H = 20 + HIDDEN;
export const JUNK = 8;

/** Kinds 1–7: the seven four-cell shapes, as rows in their bounding box. */
const SHAPES: Record<number, number[][]> = {
  1: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  2: [[1, 1], [1, 1]],
  3: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  4: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  5: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  6: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  7: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

/** [dx, dy] offsets for each kind and quarter turn, precomputed. */
const ROTS: Record<number, [number, number][][]> = {};
for (const [k, rows] of Object.entries(SHAPES)) {
  const n = rows.length;
  let grid = rows;
  ROTS[+k] = [];
  for (let r = 0; r < 4; r++) {
    ROTS[+k].push(grid.flatMap((row, y) => row.flatMap((v, x) => (v ? [[x, y] as [number, number]] : []))));
    // Clockwise: (x, y) -> (n - 1 - y, x)
    grid = grid.map((_, y) => grid.map((__, x) => grid[n - 1 - x][y]));
  }
}

export const boxSize = (kind: number) => SHAPES[kind].length;
export const offsets = (kind: number, r: number) => ROTS[kind][((r % 4) + 4) % 4];

export interface Piece {
  kind: number;
  r: number;
  x: number;
  y: number;
}

export function fits(board: number[], p: Piece) {
  return offsets(p.kind, p.r).every(([dx, dy]) => {
    const x = p.x + dx;
    const y = p.y + dy;
    return x >= 0 && x < W && y >= 0 && y < H && !board[y * W + x];
  });
}

export const spawn = (kind: number): Piece => ({ kind, r: 0, x: Math.floor((W - boxSize(kind)) / 2), y: 0 });

/** Tried in order when a turn bumps into something. */
export const KICKS: [number, number][] = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pieces come in shuffled sets of all seven, so droughts stay short. */
export function pieceAt(seed: number, n: number) {
  const r = rng(seed * 31 + Math.floor(n / 7) * 7919);
  const bag = [1, 2, 3, 4, 5, 6, 7];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag[n % 7];
}

export interface StackPlayer {
  board: number[];
  /** Pieces locked so far, which is also the index of the piece in play. */
  n: number;
  /** Junk rows on their way in. */
  pending: number;
  /** Junk batches received, which seeds where each batch's gap goes. */
  batches: number;
  lines: number;
  sent: number;
  out: boolean;
}

export interface StackLock {
  k: 'lock';
  n: number;
  x: number;
  y: number;
  r: number;
  /** Junk rows the client let in with this piece (it can't know about junk still in flight). */
  g: number;
}

export interface LockResult {
  player: StackPlayer;
  cleared: number[];
  attack: number;
  junk: number;
}

/** Junk sent for clearing 1, 2, 3 or 4 rows at once. */
const ATTACK = [0, 0, 1, 2, 4];

export const newPlayer = (): StackPlayer => ({ board: Array(W * H).fill(0), n: 0, pending: 0, batches: 0, lines: 0, sent: 0, out: false });

export function lock(p: StackPlayer, seed: number, seat: number, m: StackLock): LockResult | string {
  if (p.out) return 'You topped out';
  if (!m || m.k !== 'lock' || m.n !== p.n) return 'Out of sync';
  if (![m.x, m.y, m.r, m.g].every(Number.isInteger) || m.r < 0 || m.r > 3 || m.g < 0) return 'Bad move';
  const piece = { kind: pieceAt(seed, p.n), r: m.r, x: m.x, y: m.y };
  if (!fits(p.board, piece) || fits(p.board, { ...piece, y: piece.y + 1 })) return "That piece can't rest there";

  let board = [...p.board];
  for (const [dx, dy] of offsets(piece.kind, piece.r)) board[(piece.y + dy) * W + piece.x + dx] = piece.kind;

  const cleared: number[] = [];
  for (let y = 0; y < H; y++) if (board.slice(y * W, y * W + W).every(Boolean)) cleared.push(y);
  if (cleared.length) {
    const kept = board.filter((_, i) => !cleared.includes(Math.floor(i / W)));
    board = [...Array(cleared.length * W).fill(0), ...kept];
  }

  // Clearing rows first cancels junk that's on its way in; the rest goes to the rival.
  let attack = ATTACK[cleared.length];
  let pending = p.pending;
  const cancel = Math.min(attack, pending);
  attack -= cancel;
  pending -= cancel;

  // Junk only rises when a piece lands without clearing anything.
  let junk = 0;
  let out = false;
  let batches = p.batches;
  if (!cleared.length) {
    junk = Math.min(m.g, pending, H);
    if (junk) {
      const gap = Math.floor(rng(seed + (seat + 1) * 104729 + batches)() * W);
      batches++;
      out = board.slice(0, junk * W).some(Boolean);
      const row = Array.from({ length: W }, (_, x) => (x === gap ? 0 : JUNK));
      board = [...board.slice(junk * W), ...Array.from({ length: junk }, () => row).flat()];
      pending -= junk;
    }
  }

  const n = p.n + 1;
  out ||= !fits(board, spawn(pieceAt(seed, n)));
  return {
    player: { board, n, pending, batches, lines: p.lines + cleared.length, sent: p.sent + attack, out },
    cleared,
    attack,
    junk,
  };
}

export interface StackState {
  seed: number;
  /** When pieces start falling (after a short countdown). */
  started: number;
  players: StackPlayer[];
  last: { seat: number; n: number; cleared: number[]; attack: number } | null;
}

export const stack: Engine<StackState, StackLock> = {
  setup(seats) {
    return {
      seed: Math.floor(Math.random() * 2 ** 31),
      started: Date.now() + 3500,
      players: Array.from({ length: seats }, newPlayer),
      last: null,
    };
  },

  move(s, seat, m) {
    if (this.outcome(s)) return 'The game is over';
    const res = lock(s.players[seat], s.seed, seat, m);
    if (typeof res === 'string') return res;
    const players = s.players.map((p, i) => (i === seat ? res.player : p));
    if (res.attack) {
      // Two players for now; with more, junk would go to the next player still standing.
      const foe = players.findIndex((p, i) => i !== seat && !p.out);
      if (foe >= 0) players[foe] = { ...players[foe], pending: players[foe].pending + res.attack };
    }
    return { ...s, players, last: { seat, n: res.player.n, cleared: res.cleared, attack: res.attack } };
  },

  view: (s) => s,

  outcome(s) {
    const alive = s.players.flatMap((p, i) => (p.out ? [] : [i]));
    if (alive.length > 1) return null;
    const winner = alive[0] ?? s.last?.seat ?? 0;
    const w = s.players[winner];
    return { winners: [winner], note: `${w.lines} lines cleared, ${w.sent} junk rows sent` };
  },
};
