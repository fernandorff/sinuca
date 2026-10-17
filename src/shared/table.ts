// Mesa de pool de 9 pés. Unidades em metros; origem no canto (0,0) da área de jogo.
export const L = 2.54;
export const W = 1.27;
export const R = 0.028575;

const OUT = 0.6 * R;
export const POCKETS: { x: number; y: number; r: number }[] = [
  { x: -OUT, y: -OUT, r: 0.062 },
  { x: L + OUT, y: -OUT, r: 0.062 },
  { x: L + OUT, y: W + OUT, r: 0.062 },
  { x: -OUT, y: W + OUT, r: 0.062 },
  { x: L / 2, y: -OUT, r: 0.056 },
  { x: L / 2, y: W + OUT, r: 0.056 },
];

export const HEAD_X = L / 4;
export const FOOT = { x: (L * 3) / 4, y: W / 2 };

export type BallPos = { id: number; x: number; y: number; pocketed: boolean };

// Quinas de trás: 6 (lisa) e 15 (listrada); a 8 no centro da 3ª fileira.
const RACK_ROWS = [[1], [9, 2], [10, 8, 3], [11, 4, 12, 5], [6, 13, 14, 7, 15]];

export function rack(): BallPos[] {
  const gap = 2 * R + 0.0002;
  const dx = (gap * Math.sqrt(3)) / 2;
  const balls: BallPos[] = [{ id: 0, x: HEAD_X, y: W / 2, pocketed: false }];
  RACK_ROWS.forEach((row, k) =>
    row.forEach((id, j) => balls.push({ id, x: FOOT.x + k * dx, y: FOOT.y + (j - k / 2) * gap, pocketed: false })),
  );
  return balls;
}
