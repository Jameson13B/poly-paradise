import { dotsAndBoxes } from './dots-and-boxes.ts';
import { fleet } from './fleet.ts';
import { stack } from './stack.ts';
import type { Engine, GameInfo } from './types.ts';

export const GAMES: GameInfo[] = [
  { id: 'dots', name: 'Dots & Boxes', blurb: 'Claim the most squares, one line at a time.', players: [2, 4], mode: 'turns', hue: 168, ready: true },
  { id: 'fleet', name: 'Fleet', blurb: 'Hide your ships. Call your shots.', players: [2, 2], mode: 'turns', hue: 210, ready: true },
  { id: 'paddle', name: 'Paddle', blurb: 'One ball, two screens, no mercy.', players: [2, 2], mode: 'realtime', hue: 28, ready: false },
  { id: 'stack', name: 'Stack Duel', blurb: 'Clear lines, send junk to your rival.', players: [2, 2], mode: 'realtime', hue: 280, ready: true },
];

export const ENGINES: Record<string, Engine<any, any>> = {
  dots: dotsAndBoxes,
  fleet,
  stack,
};

export const gameInfo = (id: string): GameInfo => GAMES.find((g) => g.id === id) ?? GAMES[0];
