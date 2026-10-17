// Mesas. Unidades em metros; origem no canto (0,0) da área de jogo; x no comprimento.
export type Pocket = { x: number; y: number; r: number };
// só para o desenho: sideMouth = meia-largura da boca do meio; cornerMouth = boca do canto, medida na diagonal
// entre as pontas das tabelas (WPA: 11,4 a 11,75 cm no pool)
export type Table = { L: number; W: number; R: number; pockets: Pocket[]; sideMouth: number; cornerMouth: number };
export type BallPos = { id: number; x: number; y: number; pocketed: boolean };

// cantos 0..3 em (0,0),(L,0),(L,W),(0,W), centro 0,6R para fora da borda;
// meio 4..5 em (L/2,0),(L/2,W), centro sideOut para fora: a boca para o centro da bola fica com meia-largura
// √((r+R)² − (sideOut+R)²) na linha da tabela (regra da WPA: boca de 12,7 cm, buraco fora do verde)
function pockets(L: number, W: number, R: number, corner: number, side: number, sideOut: number): Pocket[] {
  const o = 0.6 * R;
  return [
    { x: -o, y: -o, r: corner },
    { x: L + o, y: -o, r: corner },
    { x: L + o, y: W + o, r: corner },
    { x: -o, y: W + o, r: corner },
    { x: L / 2, y: -sideOut, r: side },
    { x: L / 2, y: W + sideOut, r: side },
  ];
}

// Pool de 9 pés (bola 8 e mesa livre)
export const L = 2.54;
export const W = 1.27;
export const R = 0.028575;
export const POCKETS = pockets(L, W, R, 0.062, 0.042, 0.03);
export const POOL: Table = { L, W, R, pockets: POCKETS, sideMouth: 0.0635, cornerMouth: 0.115 };
export const HEAD_X = L / 4;
export const FOOT = { x: (L * 3) / 4, y: W / 2 };

// Mesa de snooker (sinuca brasileira e snooker): caçapas mais justas, bolas menores, "D" na cabeceira
export const SNOOKER: Table = (() => {
  const SL = 3.569;
  const SW = 1.778;
  const SR = 0.02625;
  return { L: SL, W: SW, R: SR, pockets: pockets(SL, SW, SR, 0.05, 0.035, 0.028), sideMouth: 0.0545, cornerMouth: 0.089 };
})();
export const BAULK_X = 0.737;
export const D_R = 0.292;

// marca de cada cor pelo valor: 2 amarela, 3 verde, 4 marrom, 5 azul, 6 rosa, 7 preta
export function colorSpot(value: number): { x: number; y: number } {
  const { L: SL, W: SW } = SNOOKER;
  const spots: Record<number, { x: number; y: number }> = {
    2: { x: BAULK_X, y: SW / 2 + D_R },
    3: { x: BAULK_X, y: SW / 2 - D_R },
    4: { x: BAULK_X, y: SW / 2 },
    5: { x: SL / 2, y: SW / 2 },
    6: { x: (SL * 3) / 4, y: SW / 2 },
    7: { x: SL - 0.324, y: SW / 2 },
  };
  return spots[value];
}

// Quinas de trás: 6 (lisa) e 15 (listrada); a 8 no centro da 3ª fileira.
const RACK_ROWS = [[1], [9, 2], [10, 8, 3], [11, 4, 12, 5], [6, 13, 14, 7, 15]];

function triangle(rows: number[][], apexX: number, y: number, r: number): BallPos[] {
  const gap = 2 * r + 0.0002;
  const dx = (gap * Math.sqrt(3)) / 2;
  return rows.flatMap((row, k) => row.map((id, j) => ({ id, x: apexX + k * dx, y: y + (j - k / 2) * gap, pocketed: false })));
}

export function rack(): BallPos[] {
  return [{ id: 0, x: HEAD_X, y: W / 2, pocketed: false }, ...triangle(RACK_ROWS, FOOT.x, FOOT.y, R)];
}

const CUE_IN_D = { id: 0, x: BAULK_X - 0.12, y: SNOOKER.W / 2 + 0.08, pocketed: false };

// Sinuca brasileira: ids 1..7 valem o próprio número; a vermelha (1) entre a rosa e a tabela
export function sinucaRack(): BallPos[] {
  const pink = colorSpot(6);
  return [
    { ...CUE_IN_D },
    { id: 1, x: pink.x, y: (SNOOKER.W / 2 + SNOOKER.W) / 2, pocketed: false },
    ...[2, 3, 4, 5, 6, 7].map((v) => ({ id: v, ...colorSpot(v), pocketed: false })),
  ];
}

// Snooker: vermelhas 1..15 em triângulo atrás da rosa; cores 16..21 valem id − 14 (16 amarela … 21 preta)
export const SNOOKER_COLOR_BASE = 14;
export function snookerRack(): BallPos[] {
  const pink = colorSpot(6);
  const reds = [[1], [2, 3], [4, 5, 6], [7, 8, 9, 10], [11, 12, 13, 14, 15]];
  return [
    { ...CUE_IN_D },
    ...triangle(reds, pink.x + 2 * SNOOKER.R + 0.004, SNOOKER.W / 2, SNOOKER.R),
    ...[2, 3, 4, 5, 6, 7].map((v) => ({ id: v + SNOOKER_COLOR_BASE, ...colorSpot(v), pocketed: false })),
  ];
}

// "D": semicírculo atrás da linha de cabeceira, onde a branca fica na mão
export function inD(p: { x: number; y: number }): boolean {
  const dx = p.x - BAULK_X;
  const dy = p.y - SNOOKER.W / 2;
  return p.x <= BAULK_X && dx * dx + dy * dy <= D_R * D_R;
}

// recoloca a bola no ponto (x, y) ou, se ocupado, no primeiro lugar livre andando em x na direção dir
export function respot(balls: BallPos[], id: number, x: number, y: number, dir: 1 | -1, table: Table): BallPos[] {
  const r = table.R;
  const free = (px: number) => balls.every((b) => b.id === id || b.pocketed || (b.x - px) * (b.x - px) + (b.y - y) * (b.y - y) >= 4 * r * r);
  let px = x;
  while (!free(px) && px > r && px < table.L - r) px += dir * (2 * r + 0.001);
  return balls.map((b) => (b.id === id ? { ...b, x: px, y, pocketed: false } : b));
}
