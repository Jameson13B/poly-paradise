import type { Outcome } from './games/types.ts';

export interface PlayerPublic {
  id: string;
  name: string;
  /** Seeds the player's low-poly gem avatar. */
  seed: number;
}

export interface GameStat {
  game: string;
  rating: number;
  played: number;
  wins: number;
}

export interface Profile extends PlayerPublic {
  joined: number;
  stats: GameStat[];
}

export interface Seat extends PlayerPublic {
  connected: boolean;
}

export interface RoomView {
  code: string;
  game: string;
  host: string;
  status: 'waiting' | 'playing' | 'finished';
  seats: Seat[];
  /** Your seat index, or -1. */
  you: number;
  view: unknown;
  outcome: Outcome | null;
  /** Player ids who asked for a rematch. */
  rematch: string[];
}

export interface BoardRow extends PlayerPublic {
  rating: number;
  played: number;
  wins: number;
}

export interface RecentMatch {
  game: string;
  at: number;
  players: (PlayerPublic & { won: boolean })[];
}

export interface Pulse {
  online: number;
  open: number;
  playing: number;
  recent: RecentMatch[];
}

export type ClientMsg =
  | { t: 'hello'; token: string }
  | { t: 'rename'; name: string }
  | { t: 'create'; game: string }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'start' }
  | { t: 'move'; move: unknown }
  | { t: 'rematch' }
  | { t: 'board'; game: string }
  | { t: 'profile'; id: string }
  | { t: 'linkCode' };

export type ServerMsg =
  | { t: 'me'; me: Profile }
  | { t: 'room'; room: RoomView | null }
  | { t: 'pulse'; pulse: Pulse }
  | { t: 'board'; game: string; rows: BoardRow[] }
  | { t: 'profile'; profile: Profile }
  | { t: 'linkCode'; code: string; expires: number }
  | { t: 'signedOut' }
  | { t: 'error'; message: string };
