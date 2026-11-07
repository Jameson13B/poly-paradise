import type { Engine } from './types.ts';

/**
 * Paddle: two phones top-to-top make one court. Each device owns the ball while
 * it's on its half, so returning it never lags; when it crosses the middle it's
 * handed to the other device. The server keeps score and checks each handoff.
 *
 * Court units, from each player's own view: x runs 0..1 left to right, y runs
 * 0 (the middle, top of your screen) to HALF (your baseline, bottom of the screen).
 */

export const HALF = 1.5;
export const PADDLE_Y = 1.36;
export const PADDLE_W = 0.24;
export const BALL_R = 0.03;
export const MAX_SPEED = 3.4;
export const TARGET = 7;
/** A ball that hasn't come back after this long counts as a miss. */
export const STALL_MS = 12000;

export type PaddleMove =
  | { k: 'pass'; seq: number; x: number; vx: number; vy: number }
  | { k: 'miss'; seq: number }
  | { k: 'stall'; seq: number }
  | { k: 'paddle'; x: number };

export interface PaddleState {
  score: number[];
  /** Whose half the ball is on (or who serves next). */
  owner: number;
  /** Bumped on every handoff and point, so devices know a new ball has started. */
  seq: number;
  /** Server time the serve launches, or null mid-rally. */
  serve: number | null;
  /** The ball entering the owner's half, in the owner's view, at server time `at`. */
  entry: { x: number; vx: number; vy: number; at: number } | null;
  /** Server time the owner got the ball, for the stall rule. */
  since: number;
  /** Paddle positions, relayed so each screen can hint where the rival stands. */
  paddles: number[];
  rally: number;
  last: { scorer: number; rally: number } | null;
}

const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

export const paddle: Engine<PaddleState, PaddleMove> = {
  setup(seats) {
    const owner = Math.floor(Math.random() * seats);
    const serve = Date.now() + 3200;
    return { score: Array(seats).fill(0), owner, seq: 0, serve, entry: null, since: serve, paddles: Array(seats).fill(0.5), rally: 0, last: null };
  },

  move(s, seat, m) {
    if (this.outcome(s)) return 'The game is over';
    if (!m || typeof m !== 'object') return 'Bad move';
    const foe = (seat + 1) % s.score.length;
    const now = Date.now();

    if (m.k === 'paddle') {
      if (!num(m.x)) return 'Bad move';
      return { ...s, paddles: s.paddles.map((x, i) => (i === seat ? Math.min(1, Math.max(0, m.x)) : x)) };
    }

    // Moves for an older ball (a handoff that crossed a stall call) are quietly dropped.
    if (m.seq !== s.seq) return s;

    if (m.k === 'pass') {
      if (seat !== s.owner) return s;
      if (![m.x, m.vx, m.vy].every(num) || m.vy >= 0 || Math.hypot(m.vx, m.vy) > MAX_SPEED * 1.05) return 'Bad move';
      // Facing each other, the rival's left is your right.
      const entry = { x: 1 - Math.min(1, Math.max(0, m.x)), vx: -m.vx, vy: -m.vy, at: now };
      return { ...s, owner: foe, seq: s.seq + 1, serve: null, entry, since: now, rally: s.rally + 1 };
    }

    const point = (loser: number): PaddleState => {
      const scorer = (loser + 1) % s.score.length;
      const serve = now + 1600;
      return {
        ...s,
        score: s.score.map((v, i) => (i === scorer ? v + 1 : v)),
        // The player who lost the point serves the next one.
        owner: loser,
        seq: s.seq + 1,
        serve,
        entry: null,
        since: serve,
        rally: 0,
        last: { scorer, rally: s.rally },
      };
    };

    if (m.k === 'miss') return seat === s.owner ? point(seat) : s;
    if (m.k === 'stall') return seat !== s.owner && now - s.since > STALL_MS ? point(s.owner) : s;
    return 'Bad move';
  },

  view: (s) => s,

  outcome(s) {
    const best = Math.max(...s.score);
    if (best < TARGET) return null;
    const winner = s.score.indexOf(best);
    return { winners: [winner], note: s.score.join(' – ') };
  },
};

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type BallEvent = { t: 'wall'; x: number; y: number } | { t: 'hit'; x: number; y: number; power: number } | { t: 'pass'; ball: Ball } | { t: 'miss'; x: number };

/**
 * Advance the ball on your half by dt seconds. `paddleX` and `paddleV` are your paddle's
 * position and speed (court units per second); a moving paddle puts some of that into the ball.
 */
export function stepBall(b: Ball, dt: number, paddleX: number, paddleV: number): BallEvent[] {
  const events: BallEvent[] = [];
  // Small steps so fast balls can't tunnel through the paddle.
  const n = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 0.01));
  for (let k = 0; k < n; k++) {
    const h = dt / n;
    const prevY = b.y;
    b.x += b.vx * h;
    b.y += b.vy * h;
    if (b.x < BALL_R || b.x > 1 - BALL_R) {
      b.x = b.x < BALL_R ? BALL_R * 2 - b.x : 2 - BALL_R * 2 - b.x;
      b.vx = -b.vx;
      events.push({ t: 'wall', x: b.x, y: b.y });
    }
    const line = PADDLE_Y - BALL_R;
    if (b.vy > 0 && prevY <= line && b.y > line && Math.abs(b.x - paddleX) <= PADDLE_W / 2 + BALL_R) {
      // Where it meets the paddle sets the angle: the edges send it wide.
      const off = Math.max(-1, Math.min(1, (b.x - paddleX) / (PADDLE_W / 2)));
      const speed = Math.min(MAX_SPEED, Math.hypot(b.vx, b.vy) * 1.06 + 0.04);
      const a = off * 1.0;
      b.vx = speed * Math.sin(a) + Math.max(-3, Math.min(3, paddleV)) * 0.25;
      b.vy = -speed * Math.cos(a);
      const s = Math.hypot(b.vx, b.vy);
      if (s > MAX_SPEED) {
        b.vx *= MAX_SPEED / s;
        b.vy *= MAX_SPEED / s;
      }
      // Always head up the court at a decent clip, however much sideways spin it took.
      const minUp = Math.max(0.45, Math.hypot(b.vx, b.vy) * 0.4);
      if (-b.vy < minUp) {
        const total = Math.hypot(b.vx, b.vy);
        b.vy = -minUp;
        b.vx = Math.sign(b.vx) * Math.sqrt(Math.max(0, total * total - minUp * minUp));
      }
      b.y = line;
      events.push({ t: 'hit', x: b.x, y: b.y, power: speed / MAX_SPEED });
    }
    if (b.y > HALF + BALL_R * 2) {
      events.push({ t: 'miss', x: b.x });
      break;
    }
    if (b.y < -BALL_R && b.vy < 0) {
      events.push({ t: 'pass', ball: { ...b } });
      break;
    }
  }
  return events;
}
