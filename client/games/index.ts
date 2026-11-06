import type { ComponentType } from 'preact';
import type { RoomView } from '../../shared/protocol.ts';
import { DotsBoard } from './DotsBoard.tsx';

/** Client-side view for each game id. */
export const GAME_UI: Record<string, ComponentType<{ room: RoomView }>> = {
  dots: DotsBoard,
};
