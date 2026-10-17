import { expect, test } from 'vitest';
import { predictAim } from '../src/shared/aim.ts';
import { newGameFor, highlightIds } from '../src/shared/rules/index.ts';
import { POOL, R, W, type BallPos } from '../src/shared/table.ts';

const cue = { x: 0.5, y: W / 2 };
const ball = (id: number, x: number, y: number): BallPos => ({ id, x, y, pocketed: false });

test('straight shot: ghost touches the ball, object goes straight on', () => {
  const a = predictAim([ball(0, cue.x, cue.y), ball(3, 1.2, W / 2)], cue, 1, 0, POOL);
  expect(a.target).toBe(3);
  expect(a.ghost!.x).toBeCloseTo(1.2 - 2 * R, 6);
  expect(a.ghost!.y).toBeCloseTo(W / 2, 6);
  expect(a.targetDir!.x).toBeCloseTo(1, 6);
  expect(a.targetDir!.y).toBeCloseTo(0, 6);
});

test('cut shot: object goes along the line of centres', () => {
  const a = predictAim([ball(0, cue.x, cue.y), ball(3, 1.2, W / 2 + R)], cue, 1, 0, POOL);
  const t = a.targetDir!;
  expect(t.y).toBeGreaterThan(0.4);
  expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 6);
});

test('nearest ball wins and pocketed balls are ignored', () => {
  const balls = [ball(0, cue.x, cue.y), { ...ball(5, 0.8, W / 2), pocketed: true }, ball(6, 1.4, W / 2), ball(7, 1.0, W / 2)];
  expect(predictAim(balls, cue, 1, 0, POOL).target).toBe(7);
});

test('no ball on the line: the line ends at the cushion', () => {
  const a = predictAim([ball(0, cue.x, cue.y)], cue, 1, 0, POOL);
  expect(a.target).toBeNull();
  expect(a.end.x).toBeCloseTo(POOL.L - R, 6);
});

test('highlight: sinuca shows the ball on, snooker shows the reds', () => {
  expect(highlightIds(newGameFor('sinuca', 2, 0))).toEqual([1]);
  expect(highlightIds(newGameFor('snooker', 2, 0))).toHaveLength(15);
  expect(highlightIds(newGameFor('free', 2, 0))).toEqual([]);
});

test('highlight: eight-ball shows the shooter group once assigned', () => {
  const g = { ...newGameFor('eightball', 2, 0), groups: ['stripes', 'solids'] } as ReturnType<typeof newGameFor>;
  expect(highlightIds(g)).toEqual([9, 10, 11, 12, 13, 14, 15]);
});
