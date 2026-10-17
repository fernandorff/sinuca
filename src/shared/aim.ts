// Previsão da mira (só para desenhar; não entra na física): onde a branca encosta primeiro e para onde a bola vai.
import { simulate, type Shot } from './physics.ts';
import type { BallPos, Table } from './table.ts';

type P = { x: number; y: number };
export type AimLine = { end: P; ghost: P | null; target: number | null; targetDir: P | null; cueDir: P | null };

export function predictAim(balls: BallPos[], cue: P, dx: number, dy: number, table: Table): AimLine {
  const { L, W, R } = table;
  let best = Infinity;
  let target: BallPos | null = null;
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    // |cue + t·d − b| = 2R  →  t² − 2t(d·(b−cue)) + |b−cue|² − 4R² = 0
    const ox = b.x - cue.x;
    const oy = b.y - cue.y;
    const along = ox * dx + oy * dy;
    const disc = along * along - (ox * ox + oy * oy - 4 * R * R);
    if (along <= 0 || disc < 0) continue;
    const t = along - Math.sqrt(disc);
    if (t > 0 && t < best) {
      best = t;
      target = b;
    }
  }
  // até a tabela, se nenhuma bola estiver no caminho
  const wall = Math.min(
    dx > 0 ? (L - R - cue.x) / dx : dx < 0 ? (R - cue.x) / dx : Infinity,
    dy > 0 ? (W - R - cue.y) / dy : dy < 0 ? (R - cue.y) / dy : Infinity,
  );
  if (!target || best > wall) {
    return { end: { x: cue.x + dx * wall, y: cue.y + dy * wall }, ghost: null, target: null, targetDir: null, cueDir: null };
  }
  const ghost = { x: cue.x + dx * best, y: cue.y + dy * best };
  const nx = (target.x - ghost.x) / (2 * R);
  const ny = (target.y - ghost.y) / (2 * R);
  // a branca segue pela tangente (sem efeito)
  const dot = dx * nx + dy * ny;
  const tx = dx - dot * nx;
  const ty = dy - dot * ny;
  const tl = Math.sqrt(tx * tx + ty * ty);
  return {
    end: ghost,
    ghost,
    target: target.id,
    targetDir: { x: nx, y: ny },
    cueDir: tl > 1e-6 ? { x: tx / tl, y: ty / tl } : null,
  };
}

// Caminho da branca depois do choque, com a força e o efeito de verdade: simula só a branca e a primeira bola
// do caminho (as outras não entram, para ficar leve a cada movimento da mira). Até `len` metros depois do choque.
export function cuePath(balls: BallPos[], shot: Shot, table: Table, len = 0.3): P[] | null {
  const cue = balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) return null;
  const aim = predictAim(balls, cue, shot.dx, shot.dy, table);
  const target = balls.find((b) => b.id === aim.target);
  if (!target) return null;
  const sim = simulate([cue, target], shot, undefined, table);
  const hit = sim.events.find((e) => e.kind === 'hit');
  if (!hit) return null;
  const path: P[] = [];
  let walked = 0;
  for (let i = Math.floor(hit.step / 4); i < sim.frames.length && walked < len; i++) {
    const p = sim.frames[i].find((b) => b.id === 0)!;
    if (p.pocketed) break;
    const prev = path[path.length - 1];
    if (prev) walked += Math.sqrt((p.x - prev.x) * (p.x - prev.x) + (p.y - prev.y) * (p.y - prev.y));
    path.push({ x: p.x, y: p.y });
  }
  return path.length > 1 ? path : null;
}
