// Bola 8 (WPA simplificada): sem push-out, sem regra de 3 faltas, a 8 vale em qualquer caçapa.
import type { SimEvent } from '../physics.ts';
import { FOOT, HEAD_X, POOL, W, rack, respot, type BallPos } from '../table.ts';

export type Group = 'solids' | 'stripes';
export type EightState = {
  mode: 'eightball';
  balls: BallPos[];
  seats: number;
  turn: number; // índice do assento; time = turn % 2
  groups: [Group | null, Group | null];
  ballInHand: 'anywhere' | 'kitchen' | null;
  isBreak: boolean;
  winner: 0 | 1 | null;
  lastFoul: string | null;
};

const groupOf = (id: number): Group | null => (id >= 1 && id <= 7 ? 'solids' : id >= 9 ? 'stripes' : null);
const other = (g: Group): Group => (g === 'solids' ? 'stripes' : 'solids');

export function newGame(seats: number, breakingSeat: number): EightState {
  return {
    mode: 'eightball',
    balls: rack(),
    seats,
    turn: breakingSeat,
    groups: [null, null],
    ballInHand: 'kitchen',
    isBreak: true,
    winner: null,
    lastFoul: null,
  };
}

export function applyShot(s: EightState, final: BallPos[], events: SimEvent[]): EightState {
  const team = (s.turn % 2) as 0 | 1;
  const myGroup = s.groups[team];
  const clearedBefore = myGroup !== null && s.balls.every((b) => groupOf(b.id) !== myGroup || b.pocketed);

  const firstHitEvent = events.find((e) => e.kind === 'hit' && (e.a === 0 || e.b === 0));
  const firstHit = firstHitEvent?.kind === 'hit' ? (firstHitEvent.a === 0 ? firstHitEvent.b : firstHitEvent.a) : null;
  const pots = events.filter((e): e is Extract<SimEvent, { kind: 'pocket' }> => e.kind === 'pocket');
  const potted = pots.map((e) => e.ball);
  const railAfterContact =
    firstHitEvent !== undefined && events.some((e) => (e.kind === 'cushion' || e.kind === 'pocket') && e.step >= firstHitEvent.step);

  let foul: string | null = null;
  if (potted.includes(0)) foul = 'Branca encaçapada';
  else if (firstHit === null) foul = 'Não acertou nenhuma bola';
  else if (!s.isBreak) {
    if (myGroup === null && firstHit === 8) foul = 'Bateu primeiro na 8';
    else if (myGroup !== null && (clearedBefore ? firstHit !== 8 : groupOf(firstHit) !== myGroup))
      foul = 'Bateu primeiro na bola errada';
    else if (!railAfterContact) foul = 'Nenhuma bola foi à tabela';
  }

  let balls = final.map((b) => ({ ...b }));
  let winner: 0 | 1 | null = null;
  if (potted.includes(8)) {
    if (s.isBreak) balls = respot(balls, 8, FOOT.x, FOOT.y, 1, POOL);
    else winner = clearedBefore && !foul ? team : ((1 - team) as 0 | 1);
  }
  if (potted.includes(0)) balls = respot(balls, 0, HEAD_X, W / 2, -1, POOL);

  // mesa aberta (nunca na saída): a primeira bola de grupo encaçapada sem falta define os grupos
  let groups = s.groups;
  if (myGroup === null && !s.isBreak && !foul) {
    const first = pots.map((e) => groupOf(e.ball)).find((g) => g !== null);
    if (first) groups = team === 0 ? [first, other(first)] : [other(first), first];
  }
  const mine = groups[team];
  const keepsTurn =
    !foul && potted.some((id) => id !== 0 && id !== 8 && (mine === null || groupOf(id) === mine));

  return {
    ...s,
    balls,
    groups,
    turn: winner !== null || keepsTurn ? s.turn : (s.turn + 1) % s.seats,
    ballInHand: winner === null && foul ? 'anywhere' : null,
    isBreak: false,
    winner,
    lastFoul: foul,
  };
}
