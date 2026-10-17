import type { SimEvent } from '../physics.ts';

// o que importa de uma tacada para as regras: a primeira bola que a branca tocou e o que caiu
export function readShot(events: SimEvent[]) {
  const first = events.find((e) => e.kind === 'hit' && (e.a === 0 || e.b === 0));
  const firstHit = first?.kind === 'hit' ? (first.a === 0 ? first.b : first.a) : null;
  const pots = events.flatMap((e) => (e.kind === 'pocket' ? [e.ball] : []));
  return { firstHit, potted: pots.filter((id) => id !== 0), scratch: pots.includes(0) };
}

export function topScorers(scores: number[]): number[] {
  const best = Math.max(...scores);
  return scores.flatMap((v, i) => (v === best ? [i] : []));
}
