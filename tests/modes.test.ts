import { expect, test } from 'vitest';
import type { SimEvent } from '../src/shared/physics.ts';
import { applyFree, newFree, type FreeState } from '../src/shared/rules/free.ts';
import { applySinuca, newSinuca, type SinucaState } from '../src/shared/rules/sinuca.ts';
import { applySnooker, newSnooker, type SnookerState } from '../src/shared/rules/snooker.ts';
import { HEAD_X, inD } from '../src/shared/table.ts';

const hit = (step: number, a: number, b: number): SimEvent => ({ step, kind: 'hit', a, b });
const rail = (step: number, ball: number): SimEvent => ({ step, kind: 'cushion', ball });
const pot = (step: number, ball: number): SimEvent => ({ step, kind: 'pocket', ball, pocket: 0 });

function finalOf<S extends { balls: { id: number; pocketed: boolean; x: number; y: number }[] }>(s: S, events: SimEvent[]) {
  const gone = new Set(events.filter((e) => e.kind === 'pocket').map((e) => (e as { ball: number }).ball));
  return s.balls.map((b) => (gone.has(b.id) ? { ...b, pocketed: true } : b));
}
const gone = <S extends { balls: { id: number; pocketed: boolean }[] }>(s: S, ids: number[]): S => ({
  ...s,
  balls: s.balls.map((b) => (ids.includes(b.id) ? { ...b, pocketed: true } : b)),
});
const ball = (s: { balls: { id: number; pocketed: boolean; x: number; y: number }[] }, id: number) => s.balls.find((b) => b.id === id)!;

// ---------- mesa livre ----------
const free = (s: FreeState, ev: SimEvent[]) => applyFree(s, finalOf(s, ev), ev);

test('free: pot keeps the turn, miss passes it', () => {
  let s = newFree(3, 0);
  s = free(s, [hit(1, 0, 1), pot(5, 1)]);
  expect(s.turn).toBe(0);
  s = free(s, [hit(1, 0, 2), rail(5, 2)]);
  expect(s.turn).toBe(1);
});

test('free: scratch respots the cue at the head and passes the turn', () => {
  const s = free(newFree(2, 0), [hit(1, 0, 1), pot(5, 0)]);
  expect(ball(s, 0).pocketed).toBe(false);
  expect(ball(s, 0).x).toBeLessThanOrEqual(HEAD_X);
  expect(s.turn).toBe(1);
});

test('free: alone at the table always plays', () => {
  const s = free(newFree(1, 0), [hit(1, 0, 2)]);
  expect(s.turn).toBe(0);
});

// ---------- sinuca brasileira ----------
const sin = (s: SinucaState, ev: SimEvent[]) => applySinuca(s, finalOf(s, ev), ev);
const afterBreak = (seats = 2): SinucaState => ({ ...newSinuca(seats, 0), isBreak: false, ballInHand: null });

test('sinuca: break must touch the red first, else 7 to the next player', () => {
  const s = sin(newSinuca(2, 0), [hit(1, 0, 2), rail(4, 2)]);
  expect(s.scores).toEqual([0, 7]);
  expect(s.turn).toBe(1);
});

test('sinuca: legal break passes the turn without points', () => {
  const s = sin(newSinuca(2, 0), [hit(1, 0, 1), rail(4, 1)]);
  expect(s.scores).toEqual([0, 0]);
  expect(s.turn).toBe(1);
  expect(s.isBreak).toBe(false);
});

test('sinuca: potting the ball on scores, stays off and grants a second free shot', () => {
  const s = sin(afterBreak(), [hit(1, 0, 1), pot(6, 1)]);
  expect(s.scores).toEqual([1, 0]);
  expect(ball(s, 1).pocketed).toBe(true);
  expect(s.secondFree).toBe(true);
  expect(s.turn).toBe(0);
});

test('sinuca: second free shot scores any ball and respots it', () => {
  let s = { ...gone(afterBreak(), [1]), secondFree: true };
  s = sin(s, [hit(1, 0, 6), pot(6, 6)]);
  expect(s.scores).toEqual([6, 0]);
  expect(ball(s, 6).pocketed).toBe(false);
  expect(s.secondFree).toBe(false);
  expect(s.turn).toBe(0);
});

test('sinuca: ball on and another fall together → both score, the other respots', () => {
  const s = sin(afterBreak(), [hit(1, 0, 1), pot(5, 1), pot(7, 4)]);
  expect(s.scores).toEqual([5, 0]);
  expect(ball(s, 1).pocketed).toBe(true);
  expect(ball(s, 4).pocketed).toBe(false);
});

test('sinuca: penalty shot converted scores, respots and forces the ball on next', () => {
  let s = sin(afterBreak(), [hit(1, 0, 7), pot(6, 7)]);
  expect(s.scores).toEqual([7, 0]);
  expect(ball(s, 7).pocketed).toBe(false);
  expect(s.mustBallOn).toBe(true);
  s = sin(s, [hit(1, 0, 5), rail(3, 5)]);
  expect(s.scores).toEqual([7, 7]);
  expect(s.turn).toBe(1);
});

test('sinuca: penalty shot missed → 7 to the next player', () => {
  const s = sin(afterBreak(3), [hit(1, 0, 6), rail(4, 6)]);
  expect(s.scores).toEqual([0, 7, 0]);
  expect(s.turn).toBe(1);
});

test('sinuca: free shot missed → no penalty, turn passes', () => {
  const s = sin(afterBreak(), [hit(1, 0, 1), rail(4, 1)]);
  expect(s.scores).toEqual([0, 0]);
  expect(s.turn).toBe(1);
});

test('sinuca: cue ball potted → 7 to the next player and ball in hand in the D', () => {
  const s = sin(afterBreak(), [hit(1, 0, 1), pot(6, 0)]);
  expect(s.scores).toEqual([0, 7]);
  expect(s.ballInHand).toBe('d');
  expect(inD(ball(s, 0))).toBe(true);
});

test('sinuca: clearing the table ends the game, highest score wins', () => {
  let s = gone(afterBreak(), [1, 2, 3, 4, 5, 6]);
  s = { ...s, scores: [10, 15] };
  s = sin(s, [hit(1, 0, 7), pot(6, 7)]);
  expect(s.scores).toEqual([17, 15]);
  expect(s.winners).toEqual([0]);
});

// ---------- snooker ----------
const snk = (s: SnookerState, ev: SimEvent[]) => applySnooker(s, finalOf(s, ev), ev);
const live = (seats = 2): SnookerState => ({ ...newSnooker(seats, 0), isBreak: false, ballInHand: null });

test('snooker: potting a red scores 1 and the next target is a colour', () => {
  const s = snk(live(), [hit(1, 0, 3), pot(6, 3)]);
  expect(s.scores).toEqual([1, 0]);
  expect(s.onColor).toBe(true);
  expect(s.turn).toBe(0);
});

test('snooker: colour after a red scores its value and is respotted', () => {
  let s = snk(live(), [hit(1, 0, 3), pot(6, 3)]);
  s = snk(s, [hit(1, 0, 21), pot(5, 21)]);
  expect(s.scores).toEqual([8, 0]);
  expect(ball(s, 21).pocketed).toBe(false);
  expect(s.onColor).toBe(false);
});

test('snooker: hitting a colour when a red is on → foul of at least 4 to the next player', () => {
  const s = snk(live(), [hit(1, 0, 16), rail(4, 16)]);
  expect(s.scores).toEqual([0, 4]);
  expect(s.turn).toBe(1);
});

test('snooker: potting the black on a red shot → foul of 7', () => {
  const s = snk(live(), [hit(1, 0, 2), hit(3, 2, 21), pot(8, 21)]);
  expect(s.scores).toEqual([0, 7]);
  expect(ball(s, 21).pocketed).toBe(false);
});

test('snooker: with no reds, colours go in order and stay down', () => {
  const reds = Array.from({ length: 15 }, (_, i) => i + 1);
  let s = gone(live(), reds);
  s = snk(s, [hit(1, 0, 16), pot(5, 16)]);
  expect(s.scores).toEqual([2, 0]);
  expect(ball(s, 16).pocketed).toBe(true);
  s = snk(s, [hit(1, 0, 18), rail(3, 18)]);
  expect(s.scores).toEqual([2, 4]);
});

test('snooker: potting the black last ends the game', () => {
  const s0 = gone(live(), [...Array.from({ length: 15 }, (_, i) => i + 1), 16, 17, 18, 19, 20]);
  const s = snk({ ...s0, scores: [30, 20] }, [hit(1, 0, 21), pot(5, 21)]);
  expect(s.scores).toEqual([37, 20]);
  expect(s.winners).toEqual([0]);
});

test('solo sinuca: a foul does not give points to yourself', () => {
  const s = sin({ ...newSinuca(1, 0), isBreak: false, ballInHand: null }, [hit(1, 0, 6), rail(4, 6)]);
  expect(s.scores).toEqual([0]);
  expect(s.turn).toBe(0);
});

test('solo snooker: a foul does not give points to yourself', () => {
  const s = snk({ ...newSnooker(1, 0), isBreak: false, ballInHand: null }, [hit(1, 0, 16), rail(4, 16)]);
  expect(s.scores).toEqual([0]);
});
