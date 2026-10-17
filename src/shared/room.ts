// Máquina de estados de uma mesa: pura, sem Cloudflare. O Durable Object só entrega mensagens e grava o estado.
import type { Shot, SimEvent } from './physics.ts';
import type { ClientMsg, ErrorCode, ServerMsg } from './protocol.ts';
import { MAX_SEATS, MODES, applyFor, newGameFor, nextBreaker, winnersOf, type GameState, type Mode } from './rules/index.ts';
import { describeShot } from './log.ts';
import { HEAD_X, inD, type BallPos } from './table.ts';

export const FALLBACK_MS = 10_000;
export const EMPTY_MS = 10 * 60 * 1000;
export const SWEEP_MS = 30_000;

export type Seat = { playerId: string; name: string; connected: boolean };
export type RoomState = {
  id: string;
  mode: Mode;
  createdAt: number;
  seats: (Seat | null)[];
  spectators: { playerId: string; name: string }[];
  phase: 'waiting' | 'aiming' | 'rolling' | 'over';
  game: GameState | null;
  shotNo: number;
  // o que aconteceu em cada jogada, as mais novas no fim (só as últimas LOG_MAX)
  log: string[];
  // voto para expulsar (pedido do Fernando, 17/10/2026): quem votou em quem, e quem já foi expulso desta mesa
  kick?: { target: string; voters: string[] }[];
  kicked?: string[];
  // vídeo do YouTube que a mesa toda ouve: um por vez, qualquer um troca ou tira (pedido do Fernando, 17/10/2026)
  video?: { id: string; by: string; startedAt: number } | null;
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
export type PublicRoom = Omit<RoomState, 'pending' | 'seats' | 'spectators' | 'kick' | 'kicked' | 'video'> & {
  video: { id: string; by: string; startedAt: number } | null;
  seats: ({ name: string; connected: boolean } | null)[];
  // votos válidos para expulsar cada assento
  kickVotes: number[];
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
  bad_start: 'Esse modo não começa com esse número de jogadores sentados.',
  bad_msg: 'Mensagem inválida.',
  kicked: 'Você foi expulso desta mesa por votação.',
};

export function createRoom(id: string, now: number, mode: Mode = 'eightball'): RoomState {
  return { id, mode, createdAt: now, seats: Array(MAX_SEATS).fill(null), spectators: [], phase: 'waiting', game: null, shotNo: 0, log: [], pending: null };
}

// só vale o voto de quem está sentado e conectado, e nunca em si mesmo
const votersOf = (s: RoomState, target: string) =>
  (s.kick ?? []).find((k) => k.target === target)?.voters.filter((v) => v !== target && s.seats.some((x) => x?.connected && x.playerId === v)) ?? [];
// mais da metade dos outros jogadores sentados e conectados
const kickNeed = (s: RoomState, target: string) => Math.floor(s.seats.filter((x) => x?.connected && x.playerId !== target).length / 2) + 1;

export function publicRoom(s: RoomState): PublicRoom {
  const { pending, seats, spectators, kick, kicked, video, ...rest } = s;
  return {
    ...rest,
    video: video ?? null,
    kickVotes: seats.map((x) => (x ? votersOf(s, x.playerId).length : 0)),
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
  const voted = (id: string) => s.seats.flatMap((x, i) => (x && (s.kick ?? []).some((k) => k.target === x.playerId && k.voters.includes(id)) ? [i] : []));
  return [...seated, ...watching].map((you) => ({ to: you.playerId, msg: { t: 'state', room, you: { ...you, voted: voted(you.playerId) } } }));
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
  if (turnSeat?.connected || mine < 0) return false;
  // quem caiu: na bola 8 em time um parceiro joga a vez; nos modos individuais, qualquer um sentado joga por ele
  if (s.game.mode === 'eightball') return s.game.seats > 2 && mine % 2 === s.game.turn % 2;
  return true;
}

export function cueOk(game: GameState, cue: { x: number; y: number }): boolean {
  const { L, W, R } = MODES[game.mode].table;
  if (!game.ballInHand) return false;
  if (cue.x < R || cue.x > L - R || cue.y < R || cue.y > W - R) return false;
  if (game.ballInHand === 'kitchen' && cue.x > HEAD_X) return false;
  if (game.ballInHand === 'd' && !inD(cue)) return false;
  return game.balls.every((b) => b.id === 0 || b.pocketed || (b.x - cue.x) * (b.x - cue.x) + (b.y - cue.y) * (b.y - cue.y) >= 4 * R * R);
}

const LOG_MAX = 40;
// mesas salvas antes do log não têm o campo
const withLog = (s: RoomState, line: string): RoomState => ({ ...s, log: [...(s.log ?? []), line].slice(-LOG_MAX) });

function finish(s: RoomState, final: BallPos[], events: SimEvent[]): RoomState {
  const game = applyFor(s.game!, final, events);
  const line = describeShot(s.game!, game, events, s.seats.map((x) => x?.name ?? null));
  return skipEmpty(withLog({ ...s, game, shotNo: s.shotNo + 1, phase: winnersOf(game) !== null ? 'over' : 'aiming', pending: null }, line));
}

// vez de um lugar vazio (de quem foi expulso): passa para o próximo sentado; na bola 8 em time, para o
// próximo do mesmo time (se o time inteiro saiu, a vez fica e os outros jogam por ele)
function skipEmpty(s: RoomState): RoomState {
  const g = s.game;
  if (!g || s.phase !== 'aiming' || s.seats[g.turn]) return s;
  const step = g.mode === 'eightball' && g.seats > 2 ? 2 : 1;
  let turn = g.turn;
  for (let k = 0; k < g.seats && !s.seats[turn]; k++) turn = (turn + step) % g.seats;
  return s.seats[turn] ? { ...s, game: { ...g, turn } } : s;
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
      if (s.kicked?.includes(playerId)) return fail(s, playerId, 'kicked');
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
      if (s.phase !== 'waiting' || !MODES[s.mode].seats.includes(sitting.length)) return fail(s, playerId, 'bad_start');
      const seats = Array.from({ length: MAX_SEATS }, (_, j) => sitting[j] ?? null);
      return changed(withLog({ ...s, seats, phase: 'aiming', game: newGameFor(s.mode, sitting.length, 0), pending: null }, `Partida começou com ${sitting.length} ${sitting.length > 1 ? 'jogadores' : 'jogador'}`));
    }

    case 'rematch': {
      if (s.phase !== 'over' || !s.game) return fail(s, playerId, 'bad_msg');
      return changed(withLog({ ...s, phase: 'aiming', game: newGameFor(s.mode, s.game.seats, nextBreaker(s.game)), shotNo: s.shotNo + 1, pending: null }, 'Revanche'));
    }

    // nova partida (pedido do Fernando, 17/10/2026): qualquer um sentado volta a mesa para a espera; o placar zera,
    // lugar de quem caiu fica livre, quem assistia senta nos lugares livres e quem chegar pelo link também
    case 'reset': {
      if (s.phase === 'waiting' || seatOf(s, playerId) < 0) return fail(s, playerId, 'bad_msg');
      const seats = s.seats.map((x) => (x?.connected ? x : null));
      const waiting = [...s.spectators];
      for (let j = 0; j < seats.length && waiting.length; j++) {
        if (seats[j]) continue;
        const v = waiting.shift()!;
        seats[j] = { playerId: v.playerId, name: v.name, connected: true };
      }
      const who = s.seats[seatOf(s, playerId)]!.name;
      return changed(withLog({ ...s, seats, spectators: waiting, phase: 'waiting', game: null, pending: null, shotNo: s.shotNo + 1 }, `${who} abriu uma nova partida`));
    }

    // voto para expulsar: clicar de novo tira o voto; com mais da metade dos outros, o jogador sai e não volta
    case 'kick': {
      const me = seatOf(s, playerId);
      const target = s.seats[msg.seat];
      if (me < 0 || !s.seats[me]!.connected || !target || msg.seat === me) return fail(s, playerId, 'bad_msg');
      const others = (s.kick ?? []).filter((k) => k.target !== target.playerId);
      const prev = (s.kick ?? []).find((k) => k.target === target.playerId)?.voters ?? [];
      const voters = prev.includes(playerId) ? prev.filter((v) => v !== playerId) : [...prev, playerId];
      const next: RoomState = { ...s, kick: [...others, { target: target.playerId, voters }] };
      if (votersOf(next, target.playerId).length < kickNeed(next, target.playerId)) return changed(next);
      const out = skipEmpty(
        withLog(
          { ...next, seats: next.seats.map((x, j) => (j === msg.seat ? null : x)), kick: others, kicked: [...(s.kicked ?? []), target.playerId] },
          `${target.name} foi expulso por votação`,
        ),
      );
      const r = changed(out);
      r.out.push({ to: target.playerId, msg: { t: 'error', code: 'kicked', msg: ERRORS.kicked } });
      return r;
    }

    case 'video': {
      const name = s.seats.find((x) => x?.playerId === playerId)?.name ?? s.spectators.find((x) => x.playerId === playerId)?.name;
      if (!name) return fail(s, playerId, 'bad_msg');
      const video = msg.id ? { id: msg.id, by: name, startedAt: now } : null;
      return changed(withLog({ ...s, video }, video ? `${name} colocou um vídeo` : `${name} tirou o vídeo`));
    }

    // mesa livre: qualquer um sentado arruma as bolas de novo
    case 'rerack': {
      if (s.mode !== 'free' || s.phase !== 'aiming' || !s.game || seatOf(s, playerId) < 0) return fail(s, playerId, 'bad_msg');
      return changed({ ...s, game: newGameFor('free', s.game.seats, s.game.turn), shotNo: s.shotNo + 1 });
    }

    case 'aim':
      if (!canShoot(s, playerId)) return { state: s, out: [] };
      return { state: s, out: [{ to: 'all', msg: { t: 'aim', seat: s.game!.turn, angle: msg.angle, power: msg.power, spinX: msg.spinX, spinY: msg.spinY } }] };

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
