/** Seats that won. Every seat winning means a draw. */
export interface Outcome {
  winners: number[];
  note?: string;
}

/**
 * A game's rules, run authoritatively on the server. Engines are pure:
 * they return new state rather than mutating, so they're easy to test and
 * can later run on the client for prediction.
 */
export interface Engine<S, M> {
  setup(seats: number): S;
  /** Returns the next state, or an error message for an illegal move. */
  move(state: S, seat: number, move: M): S | string;
  /** What one seat is allowed to see (hidden information lives here). */
  view(state: S, seat: number): unknown;
  outcome(state: S): Outcome | null;
}

export interface GameInfo {
  id: string;
  name: string;
  blurb: string;
  players: [min: number, max: number];
  mode: 'turns' | 'realtime';
  hue: number;
  ready: boolean;
}
