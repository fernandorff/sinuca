// Mata-mata (sinuca de bar): 4 vermelhas (1 a 4), 4 amarelas (5 a 8) e a branca; sozinho, 1x1 ou 2x2.
// Regras da casa escolhidas pelo Fernando em 18/10/2026: a primeira bola encaçapada sem falta define a cor de cada
// lado; falta = o adversário tira uma bola dele da mesa; a última bola tem que cair na caçapa cantada.
import type { SimEvent } from '../physics.ts';
import { FOOT, HEAD_X, POOL, W, matamataRack, respot, type BallPos } from '../table.ts';
import { readShot } from './shot.ts';

export type Color = 'red' | 'yellow';
export type MataState = {
  mode: 'matamata';
  balls: BallPos[];
  seats: number;
  turn: number; // time = turn % 2
  groups: [Color | null, Color | null];
  ballInHand: 'anywhere' | 'kitchen' | null;
  isBreak: boolean;
  winner: 0 | 1 | null;
  lastFoul: string | null;
};

export const colorOf = (id: number): Color => (id <= 4 ? 'red' : 'yellow');
const other = (c: Color): Color => (c === 'red' ? 'yellow' : 'red');
export const leftOf = (balls: BallPos[], c: Color) => balls.filter((b) => b.id !== 0 && !b.pocketed && colorOf(b.id) === c);

export function newMata(seats: number, breakingSeat: number): MataState {
  return { mode: 'matamata', balls: matamataRack(), seats, turn: breakingSeat, groups: [null, null], ballInHand: 'kitchen', isBreak: true, winner: null, lastFoul: null };
}

// a bola do adversário que sai na falta: a mais longe das caçapas (a mais difícil para ele)
function farthest(balls: BallPos[]): BallPos {
  const near = (b: BallPos) => Math.min(...POOL.pockets.map((p) => Math.hypot(b.x - p.x, b.y - p.y)));
  return balls.reduce((a, b) => (near(b) > near(a) ? b : a));
}

export function applyMata(s: MataState, final: BallPos[], events: SimEvent[], call?: number): MataState {
  const team = (s.turn % 2) as 0 | 1;
  const { firstHit, potted, scratch } = readShot(events);
  const pocketOf = (id: number) => events.flatMap((e) => (e.kind === 'pocket' && e.ball === id ? [e.pocket] : []))[0];
  let mine = s.groups[team];
  const foul = scratch
    ? 'Branca encaçapada'
    : firstHit === null
      ? 'Não acertou nenhuma bola'
      : mine && colorOf(firstHit) !== mine
        ? 'Bateu primeiro na bola do outro'
        : null;

  // mesa aberta: a primeira bola encaçapada sem falta define a cor de cada lado
  let groups = s.groups;
  if (!mine && !foul && potted.length) {
    const c = colorOf(potted[0]);
    groups = team === 0 ? [c, other(c)] : [other(c), c];
    mine = c;
  }

  let balls = final.map((b) => ({ ...b }));
  if (scratch) balls = respot(balls, 0, HEAD_X, W / 2, -1, POOL);

  // última bola: só vale se era a única que restava do dono, encaçapada por ele, sem falta, na caçapa cantada;
  // senão volta para a marca
  let winner: 0 | 1 | null = null;
  let lastFoul = foul;
  for (const c of ['red', 'yellow'] as const) {
    const owner = groups[0] === c ? 0 : groups[1] === c ? 1 : null;
    if (owner === null || leftOf(balls, c).length > 0) continue;
    const before = leftOf(s.balls, c);
    const last = before.length === 1 ? before[0].id : potted.filter((id) => colorOf(id) === c).at(-1)!;
    if (owner === team && !foul && before.length === 1 && call !== undefined && pocketOf(last) === call) winner = team;
    else {
      balls = respot(balls, last, FOOT.x, FOOT.y, 1, POOL);
      lastFoul ??= 'A última bola tem que cair na caçapa cantada: ela volta para a mesa';
    }
  }

  // falta: o adversário tira uma bola dele (nunca a última); sem ter o que tirar, ou com a branca na caçapa,
  // ele joga com a branca na mão
  let ballInHand: MataState['ballInHand'] = null;
  if (foul && winner === null) {
    const opp = groups[1 - team];
    const theirs = opp ? leftOf(balls, opp) : [];
    if (theirs.length >= 2) {
      const out = farthest(theirs).id;
      balls = balls.map((b) => (b.id === out ? { ...b, pocketed: true } : b));
    } else ballInHand = 'anywhere';
    if (scratch) ballInHand = 'anywhere';
  }

  const keeps = !foul && winner === null && potted.some((id) => mine !== null && colorOf(id) === mine && balls.find((b) => b.id === id)!.pocketed);
  return {
    ...s,
    balls,
    groups,
    turn: winner !== null || keeps ? s.turn : (s.turn + 1) % s.seats,
    ballInHand,
    isBreak: false,
    winner,
    lastFoul,
  };
}
