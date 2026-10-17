// Máquina de estados de uma mesa: pura, sem Cloudflare. O Durable Object só entrega mensagens e grava o estado.
import type { Shot, SimEvent } from './physics.ts';
import type { ClientMsg, ErrorCode, ServerMsg } from './protocol.ts';
import { applyShot, newGame, type EightState } from './rules/eightball.ts';
import { HEAD_X, L, R, W, type BallPos } from './table.ts';

export const FALLBACK_MS = 10_000;
export const EMPTY_MS = 10 * 60 * 1000;
export const SWEEP_MS = 30_000;

export type Seat = { playerId: string; name: string; connected: boolean };
export type RoomState = {
  id: string;
  mode: 'eightball';
  createdAt: number;
  seats: (Seat | null)[];
  spectators: { playerId: string; name: string }[];
  phase: 'waiting' | 'aiming' | 'rolling' | 'over';
  game: EightState | null;
  shotNo: number;
  pending: {
    shotNo: number;
    by: number;
    shooter: string;
    shotAt: number;
    // guardados para reenviar a tacada a quem reconectar no meio dela
    shot: Shot;
    balls: BallPos[];
    fallback: { final: BallPos[]; events: SimEvent[] } | null;
  } | null;
};
export type PublicRoom = Omit<RoomState, 'pending' | 'seats' | 'spectators'> & {
  seats: ({ name: string; connected: boolean } | null)[];
  spectators: { name: string }[];
  rolling: boolean;
};
export type Out = { to: 'all' | string; msg: ServerMsg };
export type Input =
  | { kind: 'msg'; playerId: string; msg: ClientMsg }
  | { kind: 'disconnect'; playerId: string }
  | { kind: 'tick' };

const ERRORS: Record<ErrorCode, string> = {
  not_found: 'Mesa não encontrada.',
  other_tab: 'Mesa aberta em outra aba.',
  not_your_turn: 'Não é a sua vez.',
  bad_cue: 'A branca não pode ficar aí.',
  bad_start: 'A partida começa com 2 ou 4 jogadores sentados.',
  bad_msg: 'Mensagem inválida.',
};

export function createRoom(id: string, now: number): RoomState {
  return { id, mode: 'eightball', createdAt: now, seats: [null, null, null, null], spectators: [], phase: 'waiting', game: null, shotNo: 0, pending: null };
}

export function publicRoom(s: RoomState): PublicRoom {
  const { pending, seats, spectators, ...rest } = s;
  return {
    ...rest,
    seats: seats.map((x) => (x ? { name: x.name, connected: x.connected } : null)),
    spectators: spectators.map((x) => ({ name: x.name })),
    rolling: pending !== null,
  };
}

// um 'state' por participante conectado, cada um com o próprio assento
function broadcast(s: RoomState): Out[] {
  const room = publicRoom(s);
  const seated = s.seats.flatMap((x, i) => (x?.connected ? [{ playerId: x.playerId, seat: i as number | null }] : []));
  const watching = s.spectators.map((x) => ({ playerId: x.playerId, seat: null }));
  return [...seated, ...watching].map((you) => ({ to: you.playerId, msg: { t: 'state', room, you } }));
}

const fail = (s: RoomState | null, playerId: string, code: ErrorCode) => ({
  state: s,
  out: [{ to: playerId, msg: { t: 'error' as const, code, msg: ERRORS[code] } }],
});

const seatOf = (s: RoomState, playerId: string) => s.seats.findIndex((x) => x?.playerId === playerId);

function canShoot(s: RoomState, playerId: string): boolean {
  if (s.phase !== 'aiming' || !s.game) return false;
  const turnSeat = s.seats[s.game.turn];
  if (turnSeat?.playerId === playerId) return true;
  const mine = seatOf(s, playerId);
  // dupla: o parceiro joga a vez de quem caiu
  return s.game.seats === 4 && !turnSeat?.connected && mine >= 0 && mine % 2 === s.game.turn % 2;
}

export function cueOk(game: EightState, cue: { x: number; y: number }): boolean {
  if (!game.ballInHand) return false;
  if (cue.x < R || cue.x > L - R || cue.y < R || cue.y > W - R) return false;
  if (game.ballInHand === 'kitchen' && cue.x > HEAD_X) return false;
  return game.balls.every((b) => b.id === 0 || b.pocketed || (b.x - cue.x) ** 2 + (b.y - cue.y) ** 2 >= 4 * R * R);
}

function finish(s: RoomState, final: BallPos[], events: SimEvent[]): RoomState {
  const game = applyShot(s.game!, final, events);
  return { ...s, game, shotNo: s.shotNo + 1, phase: game.winner !== null ? 'over' : 'aiming', pending: null };
}

function hello(s: RoomState, playerId: string, name: string): { state: RoomState; out: Out[] } {
  const changed = (next: RoomState) => ({ state: next, out: broadcast(next) });
  const i = seatOf(s, playerId);
  if (i >= 0) return changed({ ...s, seats: s.seats.map((x, j) => (j === i ? { playerId, name, connected: true } : x)) });
  const spectators = s.spectators.filter((x) => x.playerId !== playerId);
  const free = s.seats.indexOf(null);
  if (s.phase === 'waiting' && free >= 0) {
    return changed({ ...s, seats: s.seats.map((x, j) => (j === free ? { playerId, name, connected: true } : x)), spectators });
  }
  return changed({ ...s, spectators: [...spectators, { playerId, name }] });
}

// Um Durable Object tem um alarme só: o prazo mais próximo entre o resultado reserva de uma tacada,
// a limpeza da mesa vazia e a varredura de conexões mortas. Prazo de tacada sem reserva não arma nada
// (um resultado atrasado já vale ao chegar), senão o alarme dispararia sem parar.
export function nextAlarm(s: RoomState | null, emptySince: number | undefined, live: number, now: number): number | null {
  const deadlines: number[] = [];
  if (s?.pending?.fallback) deadlines.push(s.pending.shotAt + FALLBACK_MS);
  if (live === 0 && emptySince !== undefined) deadlines.push(emptySince + EMPTY_MS);
  if (live > 0) deadlines.push(now + SWEEP_MS);
  return deadlines.length ? Math.min(...deadlines) : null;
}

export function reduce(s: RoomState | null, input: Input, now: number): { state: RoomState | null; out: Out[] } {
  if (s === null) {
    return input.kind === 'msg' && input.msg.t === 'hello' ? fail(null, input.playerId, 'not_found') : { state: null, out: [] };
  }
  const changed = (next: RoomState) => ({ state: next, out: broadcast(next) });

  if (input.kind === 'tick') {
    const p = s.pending;
    if (s.phase === 'rolling' && p?.fallback && now - p.shotAt >= FALLBACK_MS) return changed(finish(s, p.fallback.final, p.fallback.events));
    return { state: s, out: [] };
  }

  const { playerId } = input;
  if (input.kind === 'disconnect') {
    const i = seatOf(s, playerId);
    const seats = s.seats.map((x, j) => (j === i && x ? { ...x, connected: false } : x));
    return changed({ ...s, seats, spectators: s.spectators.filter((x) => x.playerId !== playerId) });
  }

  const msg = input.msg;
  switch (msg.t) {
    case 'hello': {
      const r = hello(s, playerId, msg.name);
      // chegou no meio de uma tacada: recebe a tacada também, para simular e mandar o resultado
      const p = r.state.pending;
      if (p) r.out.push({ to: playerId, msg: { t: 'shot', shotNo: p.shotNo, by: p.by, shot: p.shot, balls: p.balls } });
      return r;
    }

    case 'sit': {
      if (s.phase !== 'waiting') return fail(s, playerId, 'bad_msg');
      const i = seatOf(s, playerId);
      const me = i >= 0 ? s.seats[i]! : s.spectators.find((x) => x.playerId === playerId);
      if (!me) return fail(s, playerId, 'bad_msg');
      // antes da partida, um assento de quem caiu pode ser ocupado por outro
      if (msg.seat !== null && s.seats[msg.seat]?.connected) return fail(s, playerId, 'bad_msg');
      const seats = s.seats.map((x, j) => (j === i ? null : x));
      let spectators = s.spectators.filter((x) => x.playerId !== playerId);
      if (msg.seat === null) spectators = [...spectators, { playerId, name: me.name }];
      else seats[msg.seat] = { playerId, name: me.name, connected: true };
      return changed({ ...s, seats, spectators });
    }

    case 'start': {
      // quem caiu antes de começar fica de fora (ao voltar, entra como espectador)
      const sitting = s.seats.filter((x): x is Seat => x !== null && x.connected);
      if (s.phase !== 'waiting' || (sitting.length !== 2 && sitting.length !== 4)) return fail(s, playerId, 'bad_start');
      const seats = [0, 1, 2, 3].map((j) => sitting[j] ?? null);
      return changed({ ...s, seats, phase: 'aiming', game: newGame(sitting.length as 2 | 4, 0), pending: null });
    }

    case 'rematch': {
      if (s.phase !== 'over' || !s.game || s.game.winner === null) return fail(s, playerId, 'bad_msg');
      const loser = 1 - s.game.winner;
      return changed({ ...s, phase: 'aiming', game: newGame(s.game.seats as 2 | 4, loser), shotNo: s.shotNo + 1, pending: null });
    }

    case 'aim':
      if (!canShoot(s, playerId)) return { state: s, out: [] };
      return { state: s, out: [{ to: 'all', msg: { t: 'aim', seat: s.game!.turn, angle: msg.angle } }] };

    case 'shot': {
      if (!canShoot(s, playerId) || msg.shotNo !== s.shotNo) return fail(s, playerId, 'not_your_turn');
      let game = s.game!;
      if (msg.cue) {
        if (!cueOk(game, msg.cue)) return fail(s, playerId, 'bad_cue');
        const { x, y } = msg.cue;
        game = { ...game, balls: game.balls.map((b) => (b.id === 0 ? { ...b, x, y, pocketed: false } : b)) };
      }
      const pending = { shotNo: s.shotNo, by: game.turn, shooter: playerId, shotAt: now, shot: msg.shot, balls: game.balls, fallback: null };
      const next: RoomState = { ...s, game, phase: 'rolling', pending };
      return {
        state: next,
        out: [{ to: 'all', msg: { t: 'shot', shotNo: s.shotNo, by: game.turn, shot: msg.shot, balls: game.balls } }],
      };
    }

    case 'result': {
      const p = s.pending;
      if (s.phase !== 'rolling' || !p || msg.shotNo !== p.shotNo) return { state: s, out: [] };
      const ids = s.game!.balls.map((b) => b.id).join();
      if (msg.final.map((b) => b.id).join() !== ids) return fail(s, playerId, 'bad_msg');
      if (playerId === p.shooter || now - p.shotAt >= FALLBACK_MS) return changed(finish(s, msg.final, msg.events));
      if (p.fallback) return { state: s, out: [] };
      return { state: { ...s, pending: { ...p, fallback: { final: msg.final, events: msg.events } } }, out: [] };
    }
  }
}
