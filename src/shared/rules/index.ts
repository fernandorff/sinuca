// Os quatro modos num lugar só: mesa, quantos jogadores podem começar e as regras.
import type { Item, SimEvent } from '../physics.ts';
import { POOL, SNOOKER, type BallPos, type Table } from '../table.ts';
import { applyShot as applyEight, newGame as newEight, type EightState } from './eightball.ts';
import { applyFree, newFree, type FreeState } from './free.ts';
import { applySinuca, ballOn, newSinuca, type SinucaState } from './sinuca.ts';
import { applySnooker, isRed, newSnooker, target, type SnookerState } from './snooker.ts';

export type Mode = 'eightball' | 'free' | 'sinuca' | 'snooker' | 'powers';
export type GameState = EightState | FreeState | SinucaState | SnookerState;

// até 8 por mesa (pedido do Fernando, 17/10/2026); na bola 8, times iguais (lugar par contra ímpar)
export const MAX_SEATS = 8;
const ANY = [1, 2, 3, 4, 5, 6, 7, 8];
export const MODES: Record<Mode, { label: string; table: Table; seats: number[] }> = {
  eightball: { label: 'Bola 8', table: POOL, seats: [1, 2, 4, 6, 8] },
  free: { label: 'Mesa livre', table: POOL, seats: ANY },
  sinuca: { label: 'Sinuca brasileira', table: SNOOKER, seats: ANY },
  snooker: { label: 'Snooker', table: SNOOKER, seats: ANY },
  // snooker de sempre com poderes guardados por jogador (modo separado, decisão do Fernando de 17/10/2026)
  powers: { label: 'Snooker com poderes', table: SNOOKER, seats: ANY },
};

export const isMode = (m: unknown): m is Mode => typeof m === 'string' && m in MODES;

export function newGameFor(mode: Mode, seats: number, breakingSeat: number): GameState {
  if (mode === 'eightball') return newEight(seats, breakingSeat);
  if (mode === 'free') return newFree(seats, breakingSeat);
  if (mode === 'sinuca') return newSinuca(seats, breakingSeat);
  if (mode === 'powers') return { ...newSnooker(seats, breakingSeat), stock: Array.from({ length: seats }, () => []) };
  return newSnooker(seats, breakingSeat);
}

export function applyFor(g: GameState, final: BallPos[], events: SimEvent[], item?: Item): GameState {
  if (g.mode === 'eightball') return applyEight(g, final, events);
  if (g.mode === 'free') return applyFree(g, final, events);
  if (g.mode === 'sinuca') return applySinuca(g, final, events);
  return applySnooker(g, final, events, item);
}

// assentos vencedores, ou null se a partida não acabou (a mesa livre nunca acaba)
export function winnersOf(g: GameState): number[] | null {
  if (g.mode === 'eightball') return g.winner === null ? null : Array.from({ length: g.seats }, (_, i) => i).filter((i) => i % 2 === g.winner);
  if (g.mode === 'free') return null;
  return g.winners;
}

// quem dá a saída na revanche: na bola 8, o time que perdeu; nos outros, o próximo assento
export function nextBreaker(g: GameState): number {
  if (g.mode === 'eightball' && g.winner !== null) return 1 - g.winner;
  return (g.turn + 1) % g.seats;
}

// bolas que o jogador da vez deve mirar, para o anel de destaque na mesa
export function highlightIds(g: GameState): number[] {
  const left = (pred: (id: number) => boolean) => g.balls.filter((b) => !b.pocketed && b.id !== 0 && pred(b.id)).map((b) => b.id);
  if (g.mode === 'free') return [];
  if (g.mode === 'sinuca') {
    if (g.secondFree) return left(() => true);
    const on = ballOn(g.balls);
    return on === null ? [] : [on];
  }
  if (g.mode === 'snooker') {
    const t = target(g);
    if (t === 'red') return left(isRed);
    if (t === 'color') return left((id) => !isRed(id));
    return [t];
  }
  const group = g.groups[g.turn % 2];
  if (!group) return [];
  const mine = left((id) => (group === 'solids' ? id >= 1 && id <= 7 : id >= 9));
  return mine.length ? mine : left((id) => id === 8);
}
