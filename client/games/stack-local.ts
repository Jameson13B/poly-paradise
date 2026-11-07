import { fits, KICKS, lock, offsets, pieceAt, spawn, W, type Piece, type StackLock, type StackPlayer } from '../../shared/games/stack.ts';

export type StackEvent =
  | { t: 'clear'; rows: number[]; colors: number[][] }
  | { t: 'land'; cells: number[] }
  | { t: 'junk'; rows: number };

const LOCK_DELAY = 500;
const MAX_RESETS = 15;

/**
 * The board you're playing, run on this device so controls feel instant. Every
 * landed piece goes to the server, which runs the same `lock` and agrees.
 */
export class LocalStack {
  player: StackPlayer;
  piece: Piece | null = null;
  events: StackEvent[] = [];
  /** Screen pixels per cell, kept current by the scene for drag gestures. */
  cellPx = 24;
  private fall = 0;
  private grounded = 0;
  private resets = 0;
  private soft = false;
  private inflight: { n: number; at: number }[] = [];

  readonly seed: number;
  readonly seat: number;
  /** In this device's clock: the server's start time, corrected for skew. */
  readonly started: number;
  private send: (m: StackLock) => void;

  constructor(seed: number, seat: number, started: number, server: StackPlayer, send: (m: StackLock) => void) {
    this.seed = seed;
    this.seat = seat;
    this.started = started;
    this.send = send;
    this.player = structuredClone(server);
    this.next();
  }

  /** Falls faster every 20 seconds, the same for both players. */
  interval(now: number) {
    const level = Math.max(0, Math.floor((now - this.started) / 20000));
    return Math.max(50, 850 * 0.82 ** level);
  }

  get live() {
    return !!this.piece && !this.player.out;
  }

  step(now: number, dt: number) {
    if (!this.piece || now < this.started) return;
    const speed = this.soft ? Math.min(40, this.interval(now)) : this.interval(now);
    if (this.can(0, 1)) {
      this.grounded = 0;
      this.fall += dt;
      while (this.fall >= speed && this.piece && this.can(0, 1)) {
        this.fall -= speed;
        this.piece = { ...this.piece, y: this.piece.y + 1 };
      }
    } else {
      this.fall = 0;
      this.grounded += dt;
      if (this.grounded >= LOCK_DELAY) this.land();
    }
  }

  shift(dx: number) {
    if (!this.live || !this.can(dx, 0)) return false;
    this.piece = { ...this.piece!, x: this.piece!.x + dx };
    this.touched();
    return true;
  }

  turn(dir: 1 | -1) {
    if (!this.live) return;
    const p = this.piece!;
    const r = (p.r + dir + 4) % 4;
    for (const [kx, ky] of KICKS) {
      const q = { ...p, r, x: p.x + kx, y: p.y + ky };
      if (fits(this.player.board, q)) {
        this.piece = q;
        this.touched();
        return;
      }
    }
  }

  softDrop(on: boolean) {
    this.soft = on;
  }

  /** One row down now; used by drag gestures. */
  nudgeDown() {
    if (this.live && this.can(0, 1)) this.piece = { ...this.piece!, y: this.piece!.y + 1 };
  }

  hardDrop() {
    if (!this.live) return;
    this.piece = { ...this.piece!, y: this.ghostY() };
    this.land();
  }

  ghostY() {
    let y = this.piece!.y;
    while (fits(this.player.board, { ...this.piece!, y: y + 1 })) y++;
    return y;
  }

  nextKinds(count: number) {
    return Array.from({ length: count }, (_, k) => pieceAt(this.seed, this.player.n + 1 + k));
  }

  /** The server's copy of this board arrived. */
  sync(server: StackPlayer, now: number) {
    if (server.n >= this.player.n) {
      // Caught up (or another device played on): the server's copy is the truth.
      const moved = server.n !== this.player.n || server.board.some((v, i) => v !== this.player.board[i]);
      this.player = structuredClone(server);
      this.inflight = [];
      if (moved || (this.piece && !fits(this.player.board, this.piece))) this.next();
    } else if (this.inflight.length && now - this.inflight[0].at > 2000) {
      // A lock went missing or was refused: start again from the server's board.
      this.player = structuredClone(server);
      this.inflight = [];
      this.next();
    }
  }

  private can(dx: number, dy: number) {
    return !!this.piece && fits(this.player.board, { ...this.piece, x: this.piece.x + dx, y: this.piece.y + dy });
  }

  private touched() {
    if (this.grounded > 0 && this.resets < MAX_RESETS) {
      this.grounded = 0;
      this.resets++;
    }
  }

  private land() {
    const p = this.piece!;
    const before = this.player.board;
    const m: StackLock = { k: 'lock', n: this.player.n, x: p.x, y: p.y, r: p.r, g: this.player.pending };
    const res = lock(this.player, this.seed, this.seat, m);
    if (typeof res === 'string') return;
    if (res.cleared.length) {
      const withPiece = [...before];
      for (const i of cellsOfPiece(p)) withPiece[i] = p.kind;
      this.events.push({ t: 'clear', rows: res.cleared, colors: res.cleared.map((y) => withPiece.slice(y * W, y * W + W)) });
    } else this.events.push({ t: 'land', cells: cellsOfPiece(p).map((i) => i - res.junk * W) });
    if (res.junk) this.events.push({ t: 'junk', rows: res.junk });
    this.player = res.player;
    this.inflight.push({ n: m.n, at: performance.now() });
    this.send(m);
    this.next();
  }

  private next() {
    this.fall = 0;
    this.grounded = 0;
    this.resets = 0;
    this.piece = this.player.out ? null : spawn(pieceAt(this.seed, this.player.n));
    if (this.piece && !fits(this.player.board, this.piece)) this.piece = null;
  }
}

export const cellsOfPiece = (p: Piece) => offsets(p.kind, p.r).map(([dx, dy]) => (p.y + dy) * W + p.x + dx);
