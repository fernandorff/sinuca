import { expect, test } from 'vitest';
import { predictAim, shotPreview } from '../src/shared/aim.ts';
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

test('cue path after contact: top spin follows forward, back spin draws back', () => {
  const balls = [ball(0, cue.x, cue.y), ball(3, 1.2, W / 2 + R * 0.4)];
  const end = (spinY: number) => {
    const p = shotPreview(balls, { dx: 1, dy: 0, power: 0.4, spinX: 0, spinY }, POOL)!.cue!;
    return p[p.length - 1].x - p[0].x;
  };
  expect(end(1)).toBeGreaterThan(0.05);
  expect(end(-1)).toBeLessThan(-0.05);
});

test('cue path: no ball on the line, no path', () => {
  expect(shotPreview([ball(0, cue.x, cue.y)], { dx: 1, dy: 0, power: 0.4, spinX: 0, spinY: 0 }, POOL)).toBeNull();
});

test('preview: the yellow line follows the english (right english throws the ball to the left)', () => {
  const balls = [ball(0, cue.x, cue.y), ball(3, 1.2, W / 2)];
  const dir = (spinX: number) => shotPreview(balls, { dx: 1, dy: 0, power: 0.4, spinX, spinY: 0 }, POOL)!.targetDir;
  expect(dir(0).y).toBeCloseTo(0, 6);
  expect(dir(1).y).toBeLessThan(-0.02);
  expect(dir(-1).y).toBeGreaterThan(0.02);
});
