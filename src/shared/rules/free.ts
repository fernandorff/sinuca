// Mesa livre: bolas de pool, sem árbitro. Encaçapou, joga de novo; errou, passa a vez.
import type { SimEvent } from '../physics.ts';
import { HEAD_X, POOL, W, rack, respot, type BallPos } from '../table.ts';
import { readShot } from './shot.ts';

export type FreeState = {
  mode: 'free';
  balls: BallPos[];
  seats: number;
  turn: number;
  ballInHand: null;
  isBreak: boolean;
  lastFoul: string | null;
};

export function newFree(seats: number, breakingSeat: number): FreeState {
  return { mode: 'free', balls: rack(), seats, turn: breakingSeat, ballInHand: null, isBreak: false, lastFoul: null };
}

export function applyFree(s: FreeState, final: BallPos[], events: SimEvent[]): FreeState {
  const { potted, scratch } = readShot(events);
  const balls = scratch ? respot(final, 0, HEAD_X, W / 2, -1, POOL) : final;
  const keeps = !scratch && potted.length > 0;
  return { ...s, balls, turn: keeps ? s.turn : (s.turn + 1) % s.seats, lastFoul: scratch ? 'Branca encaçapada' : null };
}
