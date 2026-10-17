// Snooker simplificado (decisão do Fernando de 17/10/2026): sem "miss" e sem "free ball".
// Vermelhas 1..15 valem 1; cores 16..21 valem id − 14. Falta: no mínimo 4, ou o valor da maior bola envolvida.
import type { SimEvent } from '../physics.ts';
import { BAULK_X, SNOOKER, SNOOKER_COLOR_BASE, colorSpot, respot, snookerRack, type BallPos } from '../table.ts';
import { readShot, topScorers } from './shot.ts';

export type SnookerState = {
  mode: 'snooker';
  balls: BallPos[];
  seats: number;
  turn: number;
  scores: number[];
  onColor: boolean; // acabou de encaçapar vermelha: o alvo é uma cor
  ballInHand: 'd' | null;
  isBreak: boolean;
  winners: number[] | null;
  lastFoul: string | null;
};

export const isRed = (id: number) => id >= 1 && id <= 15;
export const valueOf = (id: number) => (isRed(id) ? 1 : id - SNOOKER_COLOR_BASE);

export function newSnooker(seats: number, breakingSeat: number): SnookerState {
  return {
    mode: 'snooker',
    balls: snookerRack(),
    seats,
    turn: breakingSeat,
    scores: Array(seats).fill(0),
    onColor: false,
    ballInHand: 'd',
    isBreak: true,
    winners: null,
    lastFoul: null,
  };
}

// o alvo da vez: 'red', 'color' (qualquer cor) ou o id da menor cor na fase final
export function target(s: SnookerState): 'red' | 'color' | number {
  if (s.onColor) return 'color';
  if (s.balls.some((b) => isRed(b.id) && !b.pocketed)) return 'red';
  const colors = s.balls.filter((b) => b.id > 15 && !b.pocketed).map((b) => b.id);
  return Math.min(...colors);
}

export function applySnooker(s: SnookerState, final: BallPos[], events: SimEvent[]): SnookerState {
  const next = (s.turn + 1) % s.seats;
  const t = target(s);
  const { firstHit, potted, scratch } = readShot(events);
  const pottedColors = potted.filter((id) => !isRed(id));
  const pottedReds = potted.filter(isRed);

  const legalFirst =
    firstHit !== null && (t === 'red' ? isRed(firstHit) : t === 'color' ? !isRed(firstHit) : firstHit === t);
  const legalPots =
    t === 'red'
      ? pottedColors.length === 0
      : t === 'color'
        ? pottedReds.length === 0 && pottedColors.every((id) => id === firstHit)
        : potted.every((id) => id === t);

  const respotColors = (balls: BallPos[], ids: number[]) =>
    ids.reduce((acc, id) => {
      const p = colorSpot(valueOf(id));
      return respot(acc, id, p.x, p.y, 1, SNOOKER);
    }, balls);

  if (scratch || !legalFirst || !legalPots) {
    const onValue = typeof t === 'number' ? valueOf(t) : t === 'color' && firstHit !== null && !isRed(firstHit) ? valueOf(firstHit) : 1;
    const involved = [onValue, ...(firstHit !== null ? [valueOf(firstHit)] : []), ...potted.map(valueOf)];
    const points = Math.max(4, ...involved);
    const scores = s.scores.map((v, i) => (i === next ? v + points : v));
    let balls = respotColors(final, pottedColors);
    if (scratch) balls = respot(balls, 0, BAULK_X - 0.12, SNOOKER.W / 2, -1, SNOOKER);
    const reason = scratch ? 'Branca encaçapada' : firstHit === null ? 'Não acertou nenhuma bola' : !legalFirst ? 'Bateu primeiro na bola errada' : 'Encaçapou a bola errada';
    return { ...s, balls, scores, turn: next, onColor: false, ballInHand: scratch ? 'd' : null, isBreak: false, lastFoul: `${reason} (${points} pontos)` };
  }

  const points = potted.reduce((sum, id) => sum + valueOf(id), 0);
  const scores = s.scores.map((v, i) => (i === s.turn ? v + points : v));
  // cor encaçapada depois de vermelha volta à marca; na fase final, fica fora
  const balls = t === 'color' ? respotColors(final, pottedColors) : final;
  const done = balls.every((b) => b.id === 0 || b.pocketed);
  const keeps = potted.length > 0;
  return {
    ...s,
    balls,
    scores,
    turn: keeps || done ? s.turn : next,
    onColor: t === 'red' && keeps,
    ballInHand: null,
    isBreak: false,
    winners: done ? topScorers(scores) : null,
    lastFoul: null,
  };
}
