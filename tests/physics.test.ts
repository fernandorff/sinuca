import { expect, test } from 'vitest';
import { HEAD_X, L, POCKETS, R, SNOOKER, W, rack, snookerRack, type BallPos } from '../src/shared/table.ts';
import { simulate, type Body, type Shot } from '../src/shared/physics.ts';

const BREAK: Shot = { dx: 1, dy: 0, power: 1, spinX: 0, spinY: 0 };
const IMPACT = 0.9 - 2 * R;

function line(): BallPos[] {
  return [
    { id: 0, x: IMPACT - 0.01, y: W / 2, pocketed: false },
    { id: 1, x: 0.9, y: W / 2, pocketed: false },
  ];
}

// posição da branca quando a bola 1 passa de x = 2.2 (antes de voltar da tabela)
function cueXWhenObjectFar(spinY: number): number {
  let cueX = NaN;
  simulate(line(), { dx: 1, dy: 0, power: 0.4, spinX: 0, spinY }, (bodies) => {
    if (Number.isNaN(cueX) && bodies[1].x > 2.2) cueX = bodies[0].x;
  });
  return cueX;
}

test('deterministic', () => {
  expect(simulate(rack(), BREAK)).toEqual(simulate(rack(), BREAK));
});

test('energy never increases without english', () => {
  let prev = Infinity;
  let worst = -Infinity;
  simulate(rack(), BREAK, (bodies: Body[]) => {
    let e = 0;
    for (const b of bodies) e += (b.vx * b.vx + b.vy * b.vy) / 2 + (b.wx * b.wx + b.wy * b.wy) / 5;
    worst = Math.max(worst, e - prev);
    prev = e;
  });
  expect(worst).toBeLessThanOrEqual(1e-9);
});

test('stop shot: centered full hit, cue nearly stops', () => {
  expect(Math.abs(cueXWhenObjectFar(0) - IMPACT)).toBeLessThan(0.05);
});

test('draw: spinY -1 cue ends left of impact point', () => {
  expect(cueXWhenObjectFar(-1)).toBeLessThan(IMPACT - 0.05);
});

test('follow: spinY +1 cue ends right of impact point', () => {
  expect(cueXWhenObjectFar(1)).toBeGreaterThan(IMPACT + 0.05);
});

test('no ball leaves the table', () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let balls = rack();
  for (let i = 0; i < 50; i++) {
    const cue = balls.find((b) => b.id === 0)!;
    if (cue.pocketed) Object.assign(cue, { x: HEAD_X, y: W / 2, pocketed: false });
    const a = rnd() * 2 * Math.PI;
    balls = simulate(balls, { dx: Math.cos(a), dy: Math.sin(a), power: 0.2 + rnd() * 0.8, spinX: rnd() * 1.2 - 0.6, spinY: rnd() * 1.2 - 0.6 }).final;
    for (const b of balls) {
      // parada na boca de uma caçapa (pendurada na quina) não é sair da mesa
      if (b.pocketed || POCKETS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < p.r + R)) continue;
      expect(b.x).toBeGreaterThanOrEqual(R - 1e-9);
      expect(b.x).toBeLessThanOrEqual(L - R + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(R - 1e-9);
      expect(b.y).toBeLessThanOrEqual(W - R + 1e-9);
    }
  }
});

test('corner pocket', () => {
  const balls: BallPos[] = [
    { id: 0, x: 0.3, y: 0.3, pocketed: false },
    { id: 1, x: 0.1, y: 0.1, pocketed: false },
  ];
  const { events } = simulate(balls, { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2, power: 0.3, spinX: 0, spinY: 0 });
  expect(events).toContainEqual(expect.objectContaining({ kind: 'pocket', ball: 1, pocket: 0 }));
});

test('all balls stop', () => {
  expect(simulate(rack(), BREAK).steps).toBeLessThan(240 * 20);
});

test('snooker table: no ball leaves the table', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let balls = snookerRack();
  const { L: SL, W: SW, R: SR } = SNOOKER;
  for (let i = 0; i < 40; i++) {
    const cue = balls.find((b) => b.id === 0)!;
    if (cue.pocketed) Object.assign(cue, { x: 0.6, y: SW / 2, pocketed: false });
    const a = rnd() * 2 * Math.PI;
    balls = simulate(balls, { dx: Math.cos(a), dy: Math.sin(a), power: 0.2 + rnd() * 0.8, spinX: 0, spinY: 0 }, undefined, SNOOKER).final;
    for (const b of balls) {
      if (b.pocketed) continue;
      expect(b.x).toBeGreaterThanOrEqual(SR - 1e-9);
      expect(b.x).toBeLessThanOrEqual(SL - SR + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(SR - 1e-9);
      expect(b.y).toBeLessThanOrEqual(SW - SR + 1e-9);
    }
  }
  expect(balls.filter((b) => b.pocketed).length).toBeGreaterThan(0);
});

test('snooker table: a ball beyond the pool length stays put', () => {
  const { final } = simulate(snookerRack(), { dx: 1, dy: 0, power: 0.05, spinX: 0, spinY: 0 }, undefined, SNOOKER);
  const black = final.find((b) => b.id === 21)!;
  expect(black.pocketed).toBe(false);
  expect(black.x).toBeCloseTo(SNOOKER.L - 0.324, 6);
});

test('hit and cushion events carry impact speed', () => {
  const { events } = simulate(rack(), BREAK);
  const hit = events.find((e) => e.kind === 'hit');
  expect(hit && 'v' in hit && hit.v).toBeGreaterThan(1);
});

test('side pocket: a ball through the mouth drops, one hitting the jaw bounces back', () => {
  const shoot = (offset: number) =>
    simulate(
      [{ id: 0, x: L / 2 + offset, y: 0.4, pocketed: false }],
      { dx: 0, dy: -1, power: 0.25, spinX: 0, spinY: 0 },
    );
  expect(shoot(0.02).events).toContainEqual(expect.objectContaining({ kind: 'pocket', ball: 0, pocket: 4 }));
  const jaw = shoot(0.06);
  expect(jaw.events.some((e) => e.kind === 'pocket')).toBe(false);
  expect(jaw.events).toContainEqual(expect.objectContaining({ kind: 'cushion', ball: 0 }));
});

// direção da bola alvo logo depois do choque (corte com a bola alvo 0,8R acima da linha da tacada)
function objectDir(power: number, spinX: number, offset = 0.8): { x: number; y: number } {
  const balls: BallPos[] = [
    { id: 0, x: 0.5, y: W / 2, pocketed: false },
    { id: 3, x: 1.2, y: W / 2 + R * offset, pocketed: false },
  ];
  let dir: { x: number; y: number } | null = null;
  simulate(balls, { dx: 1, dy: 0, power, spinX, spinY: 0 }, (bodies) => {
    const b = bodies[1];
    const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (!dir && v > 0) dir = { x: b.vx / v, y: b.vy / v };
  });
  return dir!;
}
const deg = (d: { x: number; y: number }) => (Math.atan2(d.y, d.x) * 180) / Math.PI;
// no contato, a linha dos centros sobe 0,4 (seno do corte): 23,58°
const CENTRES = (Math.asin(0.4) * 180) / Math.PI;

test('cut shot: same direction soft or hard (the contact is found at the exact moment)', () => {
  expect(Math.abs(deg(objectDir(0.2, 0)) - deg(objectDir(1, 0)))).toBeLessThan(0.5);
});

test('throw: the object ball leaves a few degrees off the line of centres; outside english reduces it', () => {
  const none = deg(objectDir(0.5, 0));
  const inside = deg(objectDir(0.5, 1));
  const outside = deg(objectDir(0.5, -1));
  for (const a of [none, inside, outside]) expect(Math.abs(a - CENTRES)).toBeLessThan(5);
  // o corte sozinho já empurra a bola para a frente (ângulo menor que o dos centros)
  expect(none).toBeLessThan(CENTRES - 1);
  expect(outside).toBeGreaterThan(none + 1);
});

test('throw on a straight shot: english to the right sends the ball a little to the left, and vice versa', () => {
  // y cresce para a direita de quem taca na direção +x
  expect(objectDir(0.5, 0, 0).y).toBeCloseTo(0, 6);
  expect(objectDir(0.5, 1, 0).y).toBeLessThan(-0.02);
  expect(objectDir(0.5, -1, 0).y).toBeGreaterThan(0.02);
});
