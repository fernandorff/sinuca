import { expect, test } from 'vitest';
import { FOOT, HEAD_X, W } from '../src/shared/table.ts';
import type { SimEvent } from '../src/shared/physics.ts';
import { applyShot, newGame, type EightState } from '../src/shared/rules/eightball.ts';

const hit = (step: number, a: number, b: number): SimEvent => ({ step, kind: 'hit', a, b });
const rail = (step: number, ball: number): SimEvent => ({ step, kind: 'cushion', ball });
const pot = (step: number, ball: number): SimEvent => ({ step, kind: 'pocket', ball, pocket: 0 });

// aplica os eventos: as bolas encaçapadas saem; o resto fica onde estava
function shoot(s: EightState, events: SimEvent[]): EightState {
  const gone = new Set(events.filter((e) => e.kind === 'pocket').map((e) => (e as { ball: number }).ball));
  const final = s.balls.map((b) => (gone.has(b.id) ? { ...b, pocketed: true } : b));
  return applyShot(s, final, events);
}

function afterBreak(seats: 2 | 4 = 2, groups: EightState['groups'] = [null, null]): EightState {
  return { ...newGame(seats, 0), isBreak: false, ballInHand: null, groups };
}

function withPocketed(s: EightState, ids: number[]): EightState {
  return { ...s, balls: s.balls.map((b) => (ids.includes(b.id) ? { ...b, pocketed: true } : b)) };
}

test('break scratch → ball in hand anywhere, turn passes', () => {
  const s = shoot(newGame(2, 0), [hit(1, 0, 1), rail(5, 2), pot(9, 0)]);
  expect(s.ballInHand).toBe('anywhere');
  expect(s.turn).toBe(1);
  expect(s.isBreak).toBe(false);
  const cue = s.balls.find((b) => b.id === 0)!;
  expect(cue.pocketed).toBe(false);
  expect(cue.x).toBeLessThanOrEqual(HEAD_X);
});

test('open table: pot solid → team gets solids, keeps turn', () => {
  const s = shoot(afterBreak(), [hit(1, 0, 3), pot(8, 3)]);
  expect(s.groups).toEqual(['solids', 'stripes']);
  expect(s.turn).toBe(0);
  expect(s.lastFoul).toBeNull();
});

test('first hit on opponent group → foul, turn passes', () => {
  const s = shoot(afterBreak(2, ['solids', 'stripes']), [hit(1, 0, 10), rail(4, 10)]);
  expect(s.lastFoul).not.toBeNull();
  expect(s.ballInHand).toBe('anywhere');
  expect(s.turn).toBe(1);
});

test('no cushion and no pot after contact → foul', () => {
  const s = shoot(afterBreak(2, ['solids', 'stripes']), [hit(1, 0, 2)]);
  expect(s.lastFoul).not.toBeNull();
  expect(s.turn).toBe(1);
});

test('8 early → other team wins', () => {
  const s = shoot(afterBreak(2, ['solids', 'stripes']), [hit(1, 0, 8), pot(6, 8)]);
  expect(s.winner).toBe(1);
});

test('8 with group cleared before shot → shooter team wins', () => {
  const start = withPocketed(afterBreak(2, ['solids', 'stripes']), [1, 2, 3, 4, 5, 6, 7]);
  const s = shoot(start, [hit(1, 0, 8), pot(6, 8)]);
  expect(s.winner).toBe(0);
});

test('8 + scratch → other team wins', () => {
  const start = withPocketed(afterBreak(2, ['solids', 'stripes']), [1, 2, 3, 4, 5, 6, 7]);
  const s = shoot(start, [hit(1, 0, 8), pot(6, 8), pot(9, 0)]);
  expect(s.winner).toBe(1);
});

test('group cleared and 8 in same shot → other team wins', () => {
  const start = withPocketed(afterBreak(2, ['solids', 'stripes']), [1, 2, 3, 4, 5, 6]);
  const s = shoot(start, [hit(1, 0, 7), pot(5, 7), hit(6, 7, 8), pot(9, 8)]);
  expect(s.winner).toBe(1);
});

test('doubles rotation 0→1→2→3→0 on misses', () => {
  let s = afterBreak(4, ['solids', 'stripes']);
  const turns: number[] = [];
  for (let i = 0; i < 4; i++) {
    const target = s.turn % 2 === 0 ? 2 : 10;
    s = shoot(s, [hit(1, 0, target), rail(3, target)]);
    turns.push(s.turn);
  }
  expect(turns).toEqual([1, 2, 3, 0]);
  expect(s.lastFoul).toBeNull();
});

test('8 on break → respotted at FOOT, no winner', () => {
  const start = newGame(2, 0);
  // abre espaço no FOOT, como acontece depois que a armação se espalha
  start.balls = start.balls.map((b) => (b.id === 1 ? { ...b, x: 0.5, y: 0.3 } : b));
  const s = shoot(start, [hit(1, 0, 1), pot(7, 8)]);
  const eight = s.balls.find((b) => b.id === 8)!;
  expect(s.winner).toBeNull();
  expect(eight.pocketed).toBe(false);
  expect(eight.x).toBeCloseTo(FOOT.x);
  expect(eight.y).toBeCloseTo(W / 2);
});
