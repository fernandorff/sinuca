import { expect, test } from 'vitest';
import type { SimEvent } from '../src/shared/physics.ts';
import { describeShot } from '../src/shared/log.ts';
import { applyFor, newGameFor } from '../src/shared/rules/index.ts';

const hit = (step: number, a: number, b: number): SimEvent => ({ step, kind: 'hit', a, b });
const rail = (step: number, ball: number): SimEvent => ({ step, kind: 'cushion', ball });
const pot = (step: number, ball: number): SimEvent => ({ step, kind: 'pocket', ball, pocket: 0 });
const names = ['Ana', 'Bia', 'Caio'];

function play(mode: Parameters<typeof newGameFor>[0], seats: number, events: SimEvent[]) {
  const before = { ...newGameFor(mode, seats, 0), isBreak: false, ballInHand: null } as ReturnType<typeof newGameFor>;
  const gone = new Set(events.flatMap((e) => (e.kind === 'pocket' ? [e.ball] : [])));
  const final = before.balls.map((b) => (gone.has(b.id) ? { ...b, pocketed: true } : b));
  return describeShot(before, applyFor(before, final, events), events, names);
}

test('sinuca: names the potted ball and the points', () => {
  expect(play('sinuca', 2, [hit(1, 0, 1), pot(5, 1)])).toBe('Ana: encaçapou vermelha · Ana +1');
});

test('snooker foul with 3 players: reason and the split', () => {
  expect(play('snooker', 3, [hit(1, 0, 16), rail(4, 16)])).toBe('Ana: não encaçapou · falta: Bateu primeiro na bola errada (4 pontos) · Bia +2, Caio +2');
});

test('mesa livre: balls by number, cue ball in the pocket', () => {
  expect(play('free', 2, [hit(1, 0, 3), pot(4, 3), pot(9, 0)])).toBe('Ana: encaçapou a 3 · falta: Branca encaçapada');
  expect(play('free', 2, [hit(1, 0, 3), rail(4, 3)])).toBe('Ana: não encaçapou');
});
