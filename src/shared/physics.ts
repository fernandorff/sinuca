// Física 2D determinística: só + - * / e Math.sqrt, passo fixo.
// Seno, cosseno, atan2 e hypot ficam fora daqui: não arredondam igual em todos os navegadores.
import { POOL, type BallPos, type Table } from './table.ts';

export type Shot = { dx: number; dy: number; power: number; spinX: number; spinY: number };
export type SimEvent =
  | { step: number; kind: 'hit'; a: number; b: number; v?: number }
  | { step: number; kind: 'cushion'; ball: number; v?: number }
  | { step: number; kind: 'pocket'; ball: number; pocket: number };
// w = velocidade do ponto de contato se a bola rolasse (ω×R); side = efeito lateral
export type Body = BallPos & { vx: number; vy: number; wx: number; wy: number; side: number };

const G = 9.81;
const MU_S = 0.2;
const MU_R = 0.01;
const DT = 1 / 240;
const MAX_SPEED = 6;
const E_BALL = 0.95;
const E_CUSHION = 0.75;
const REST = 0.005;
const MAX_STEPS = 240 * 20;

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

export function simulate(
  start: BallPos[],
  shot: Shot,
  onStep?: (bodies: Body[], step: number) => void,
  table: Table = POOL,
): { final: BallPos[]; events: SimEvent[]; frames: BallPos[][]; steps: number } {
  const bodies: Body[] = start.map((b) => ({ ...b, vx: 0, vy: 0, wx: 0, wy: 0, side: 0 }));
  const events: SimEvent[] = [];
  const frames: BallPos[][] = [];
  const snap = () => bodies.map(({ id, x, y, pocketed }) => ({ id, x, y, pocketed }));

  const cue = bodies.find((b) => b.id === 0 && !b.pocketed);
  if (cue) {
    const speed = shot.power * MAX_SPEED;
    cue.vx = shot.dx * speed;
    cue.vy = shot.dy * speed;
    cue.wx = shot.dx * speed * shot.spinY * 1.2;
    cue.wy = shot.dy * speed * shot.spinY * 1.2;
    cue.side = shot.spinX * speed * 0.5;
  }

  let step = 0;
  frames.push(snap());
  while (step < MAX_STEPS) {
    step++;
    let moving = false;
    for (const b of bodies) {
      if (b.pocketed) continue;
      friction(b);
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      if (b.vx || b.vy || b.wx || b.wy) moving = true;
    }
    collideBalls(bodies, step, events, table.R);
    for (const b of bodies) if (!b.pocketed) cushionsAndPockets(b, step, events, table);
    onStep?.(bodies, step);
    if (step % 4 === 0) frames.push(snap());
    if (!moving) break;
  }

  const final = bodies.map(({ id, x, y, pocketed }) => ({ id, x: round(x), y: round(y), pocketed }));
  frames.push(final);
  return { final, events, frames, steps: step };
}

function friction(b: Body) {
  const sx = b.vx - b.wx;
  const sy = b.vy - b.wy;
  const slip = len(sx, sy);
  if (slip > 3.5 * MU_S * G * DT) {
    // deslizando: o atrito freia a bola e transforma a diferença em giro
    const k = (MU_S * G * DT) / slip;
    b.vx -= sx * k;
    b.vy -= sy * k;
    b.wx += 2.5 * sx * k;
    b.wy += 2.5 * sy * k;
  } else if (slip > 0) {
    // o deslize terminaria neste passo: passa a rolar (conserva o momento no ponto de contato)
    b.vx = b.wx = (5 * b.vx + 2 * b.wx) / 7;
    b.vy = b.wy = (5 * b.vy + 2 * b.wy) / 7;
  } else {
    const v = len(b.vx, b.vy);
    const dv = MU_R * G * DT;
    if (v <= dv || v < REST) {
      b.vx = b.vy = b.wx = b.wy = 0;
    } else {
      b.vx -= (b.vx / v) * dv;
      b.vy -= (b.vy / v) * dv;
      b.wx = b.vx;
      b.wy = b.vy;
    }
  }
  if (len(b.vx, b.vy) < REST && len(b.wx, b.wy) < REST) b.vx = b.vy = b.wx = b.wy = 0;
  b.side *= 0.995;
}

function collideBalls(bodies: Body[], step: number, events: SimEvent[], R: number) {
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (a.pocketed) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (b.pocketed) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d = len(dx, dy);
      if (d >= 2 * R || d === 0) continue;
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      if (rvx * dx + rvy * dy < 0) {
        // numa tacada forte a bola anda quase um raio por passo: o choque é achado já com as bolas sobrepostas.
        // Volta as duas ao instante em que se tocaram (|d − v·t| = 2R), senão a bola acertada sai torta
        const A = rvx * rvx + rvy * rvy;
        const Bh = dx * rvx + dy * rvy;
        const t = (Bh + Math.sqrt(Bh * Bh - A * (dx * dx + dy * dy - 4 * R * R))) / A;
        a.x -= a.vx * t;
        a.y -= a.vy * t;
        b.x -= b.vx * t;
        b.y -= b.vy * t;
        dx = b.x - a.x;
        dy = b.y - a.y;
        const dc = len(dx, dy);
        const nx = dx / dc;
        const ny = dy / dc;
        const approach = rvx * nx + rvy * ny;
        // massas iguais: troca a componente normal; o giro (w) não muda, por isso existe puxada e seguida
        const k = ((1 + E_BALL) / 2) * Math.min(0, approach);
        a.vx += k * nx;
        a.vy += k * ny;
        b.vx -= k * nx;
        b.vy -= k * ny;
        // o resto do passo já com as velocidades novas
        a.x += a.vx * t;
        a.y += a.vy * t;
        b.x += b.vx * t;
        b.y += b.vy * t;
        // v = velocidade do impacto (para o volume do som); arredondada, não entra nas regras
        events.push({ step, kind: 'hit', a: a.id, b: b.id, v: round2(-approach) });
        continue;
      }
      const nx = dx / d;
      const ny = dy / d;
      const push = (2 * R - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
}

function cushionsAndPockets(b: Body, step: number, events: SimEvent[], table: Table) {
  const { L, W, R, pockets } = table;
  for (let p = 0; p < pockets.length; p++) {
    const pk = pockets[p];
    if (len(b.x - pk.x, b.y - pk.y) < pk.r) return pocket(b, p, step, events);
  }
  const inMouth = pockets.some((pk) => len(b.x - pk.x, b.y - pk.y) < pk.r + R);
  if (inMouth) {
    // na boca da caçapa não há tabela; se o centro sair da mesa, a bola caiu na caçapa mais próxima
    if (b.x < 0 || b.x > L || b.y < 0 || b.y > W) pocket(b, nearestPocket(b, pockets), step, events);
    return;
  }
  if (b.x < R) cushion(b, 1, 0, R - b.x, step, events);
  else if (b.x > L - R) cushion(b, -1, 0, b.x - (L - R), step, events);
  if (b.y < R) cushion(b, 0, 1, R - b.y, step, events);
  else if (b.y > W - R) cushion(b, 0, -1, b.y - (W - R), step, events);
}

// n = normal apontando para dentro da mesa; depth = quanto a bola passou da tabela
function cushion(b: Body, nx: number, ny: number, depth: number, step: number, events: SimEvent[]) {
  b.x += nx * depth;
  b.y += ny * depth;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  const v = len(b.vx, b.vy);
  // efeito lateral: empurra a saída da tabela para o lado do efeito, relativo à direção de chegada
  let tx = 0;
  let ty = 0;
  if (v > 0 && b.side !== 0) {
    const rx = b.vy / v;
    const ry = -b.vx / v;
    const along = rx * -ny + ry * nx;
    tx = -ny * along * b.side * 0.6;
    ty = nx * along * b.side * 0.6;
  }
  b.vx += -(1 + E_CUSHION) * vn * nx + tx;
  b.vy += -(1 + E_CUSHION) * vn * ny + ty;
  const wn = b.wx * nx + b.wy * ny;
  if (wn < 0) {
    b.wx -= (1 + E_CUSHION) * wn * nx;
    b.wy -= (1 + E_CUSHION) * wn * ny;
  }
  b.side = 0;
  events.push({ step, kind: 'cushion', ball: b.id, v: round2(-vn) });
}

function nearestPocket(b: Body, pockets: Table['pockets']): number {
  let best = 0;
  let bestD = Infinity;
  pockets.forEach((pk, i) => {
    const d = len(b.x - pk.x, b.y - pk.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function pocket(b: Body, p: number, step: number, events: SimEvent[]) {
  b.pocketed = true;
  b.vx = b.vy = b.wx = b.wy = b.side = 0;
  events.push({ step, kind: 'pocket', ball: b.id, pocket: p });
}
