// Sinuca brasileira (bola da vez), com as decisões do Fernando de 17/10/2026:
// - o tipo da tacada sai da 1ª bola tocada (sem cantar): bola da vez = livre; numerada = castigo de 7 se não cair
// - bola da vez e outra caindo juntas: contam as duas, e a outra volta à marca
// - branca encaçapada: 7 pontos para o próximo e branca na mão no "D"
import type { SimEvent } from '../physics.ts';
import { BAULK_X, SNOOKER, colorSpot, respot, sinucaRack, type BallPos } from '../table.ts';
import { readShot, topScorers } from './shot.ts';

export type SinucaState = {
  mode: 'sinuca';
  balls: BallPos[]; // ids 1..7 valem o próprio número
  seats: number;
  turn: number;
  scores: number[];
  secondFree: boolean; // acabou de encaçapar a bola da vez: a próxima é livre em qualquer bola
  mustBallOn: boolean; // acabou de converter uma numerada: a próxima tem que ser na bola da vez
  ballInHand: 'd' | null;
  isBreak: boolean;
  winners: number[] | null;
  lastFoul: string | null;
};

const PENALTY = 7;

export function newSinuca(seats: number, breakingSeat: number): SinucaState {
  return {
    mode: 'sinuca',
    balls: sinucaRack(),
    seats,
    turn: breakingSeat,
    scores: Array(seats).fill(0),
    secondFree: false,
    mustBallOn: false,
    ballInHand: 'd',
    isBreak: true,
    winners: null,
    lastFoul: null,
  };
}

// a bola da vez: a de menor valor na mesa
export function ballOn(balls: BallPos[]): number | null {
  const left = balls.filter((b) => b.id > 0 && !b.pocketed).map((b) => b.id);
  return left.length ? Math.min(...left) : null;
}

function spotOf(id: number): { x: number; y: number } {
  return id === 1 ? sinucaRack()[1] : colorSpot(id);
}

function respotAll(balls: BallPos[], ids: number[]): BallPos[] {
  return ids.reduce((acc, id) => {
    const p = spotOf(id);
    return respot(acc, id, p.x, p.y, 1, SNOOKER);
  }, balls);
}

export function applySinuca(s: SinucaState, final: BallPos[], events: SimEvent[]): SinucaState {
  const next = (s.turn + 1) % s.seats;
  const on = ballOn(s.balls);
  const { firstHit, potted, scratch } = readShot(events);

  const foul = (reason: string): SinucaState => {
    // sozinho na mesa, a falta não dá pontos a ninguém
    const scores = s.scores.map((v, i) => (i === next && s.seats > 1 ? v + PENALTY : v));
    let balls = respotAll(final, potted);
    if (scratch) balls = respot(balls, 0, BAULK_X - 0.12, SNOOKER.W / 2, -1, SNOOKER);
    return { ...s, balls, scores, turn: next, secondFree: false, mustBallOn: false, ballInHand: scratch ? 'd' : null, isBreak: false, lastFoul: reason };
  };

  if (s.isBreak) {
    if (firstHit !== 1) return foul('Na saída, a branca tem que tocar primeiro na vermelha');
    if (scratch) return foul('Branca encaçapada');
    return { ...s, balls: respotAll(final, potted), turn: next, ballInHand: null, isBreak: false, lastFoul: null };
  }
  if (scratch) return foul('Branca encaçapada');
  if (firstHit === null) return foul('Não acertou nenhuma bola');

  const freeShot = s.secondFree || firstHit === on;
  if (!freeShot) {
    if (s.mustBallOn) return foul('Depois de converter uma numerada, a tacada é na bola da vez');
    if (!potted.includes(firstHit)) return foul('Castigo: a bola numerada não caiu');
  }

  // tacada válida: tudo que caiu marca; a bola da vez sai da mesa e as outras voltam à marca
  const points = potted.reduce((sum, id) => sum + id, 0);
  const scores = s.scores.map((v, i) => (i === s.turn ? v + points : v));
  const balls = respotAll(final, potted.filter((id) => id !== on));
  const done = balls.every((b) => b.id === 0 || b.pocketed);
  const keeps = potted.length > 0;
  return {
    ...s,
    balls,
    scores,
    turn: keeps || done ? s.turn : next,
    secondFree: !s.secondFree && freeShot && on !== null && potted.includes(on),
    mustBallOn: !freeShot,
    ballInHand: null,
    winners: done ? topScorers(scores) : null,
    lastFoul: null,
  };
}
