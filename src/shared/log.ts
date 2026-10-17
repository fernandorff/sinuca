// Log de atividades (pedido do Fernando, 17/10/2026): uma linha por jogada, montada no servidor para todos verem igual.
import type { SimEvent } from './physics.ts';
import { winnersOf, type GameState } from './rules/index.ts';
import { readShot } from './rules/shot.ts';
import { isRed } from './rules/snooker.ts';
import { SNOOKER_COLOR_BASE } from './table.ts';

export const COLOR_NAME: Record<number, string> = { 1: 'vermelha', 2: 'amarela', 3: 'verde', 4: 'marrom', 5: 'azul', 6: 'rosa', 7: 'preta' };

function ballName(g: GameState, id: number): string {
  if (g.mode === 'sinuca') return COLOR_NAME[id];
  if (g.mode === 'snooker') return isRed(id) ? 'vermelha' : COLOR_NAME[id - SNOOKER_COLOR_BASE];
  return `a ${id}`;
}

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0]);
const nameOf = (names: (string | null)[], i: number) => names[i] ?? `Jogador ${i + 1}`;

export function describeShot(before: GameState, after: GameState, events: SimEvent[], names: (string | null)[]): string {
  const { potted } = readShot(events);
  const parts = [potted.length ? `encaçapou ${list(potted.map((id) => ballName(before, id)))}` : 'não encaçapou'];
  if (after.lastFoul) parts.push(`falta: ${after.lastFoul}`);
  if ('scores' in before && 'scores' in after) {
    const deltas = after.scores.flatMap((v, i) => {
      const d = v - before.scores[i];
      return d ? [`${nameOf(names, i)} ${d > 0 ? '+' : ''}${d}`] : [];
    });
    if (deltas.length) parts.push(deltas.join(', '));
  }
  const winners = winnersOf(after);
  if (winners) parts.push(`fim: ${list(winners.map((i) => nameOf(names, i)))} ${winners.length > 1 ? 'venceram' : 'venceu'}`);
  return `${nameOf(names, before.turn)}: ${parts.join(' · ')}`;
}
