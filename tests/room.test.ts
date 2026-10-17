import { expect, test } from 'vitest';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol.ts';
import { EMPTY_MS, FALLBACK_MS, SWEEP_MS, createRoom, nextAlarm, publicRoom, reduce, type Out, type RoomState } from '../src/shared/room.ts';
import { winnersOf } from '../src/shared/rules/index.ts';
import { simulate, type Shot } from '../src/shared/physics.ts';
import { R } from '../src/shared/table.ts';

const pid = (n: string) => `player-${n}0000`;
const SHOT: Shot = { dx: 1, dy: 0, power: 1, spinX: 0, spinY: 0 };

function run(s: RoomState | null, who: string, msg: ClientMsg, now = 0) {
  return reduce(s, { kind: 'msg', playerId: pid(who), msg }, now);
}

function errorsTo(out: Out[], who: string): string[] {
  return out.filter((o) => o.to === pid(who) && o.msg.t === 'error').map((o) => (o.msg as Extract<ServerMsg, { t: 'error' }>).code);
}

function room(...names: string[]): RoomState {
  let s: RoomState = createRoom('ABCD', 0);
  for (const n of names) s = run(s, n, { t: 'hello', playerId: pid(n), name: n }).state!;
  return s;
}

function started(...names: string[]): RoomState {
  return run(room(...names), names[0], { t: 'start' }).state!;
}

// quem está na vez dá a saída; devolve o estado em 'rolling' e o resultado simulado
function breakShot(s: RoomState, who: string, now = 0) {
  const r = run(s, who, { t: 'shot', shotNo: s.shotNo, shot: SHOT }, now);
  const sim = simulate(r.state!.game!.balls, SHOT);
  return { state: r.state!, out: r.out, result: { t: 'result' as const, shotNo: s.shotNo, final: sim.final, events: sim.events } };
}

test('hello to uninitialized room → not_found', () => {
  const r = run(null, 'a', { t: 'hello', playerId: pid('a'), name: 'a' });
  expect(r.state).toBeNull();
  expect(errorsTo(r.out, 'a')).toEqual(['not_found']);
});

test('8 seats then spectator', () => {
  const s = room('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
  expect(s.seats.map((x) => x?.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  expect(s.spectators.map((x) => x.name)).toEqual(['i']);
});

test('8 players: individual modes start with any count, bola 8 only with even teams (or alone)', () => {
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  expect(run(roomOf('snooker', ...eight), 'a', { t: 'start' }).state!.game!.seats).toBe(8);
  expect(run(roomOf('free', ...eight.slice(0, 7)), 'a', { t: 'start' }).state!.game!.seats).toBe(7);
  expect(run(roomOf('eightball', ...eight), 'a', { t: 'start' }).state!.game!.seats).toBe(8);
  expect(run(roomOf('eightball', ...eight.slice(0, 6)), 'a', { t: 'start' }).state!.game!.seats).toBe(6);
  expect(errorsTo(run(roomOf('eightball', ...eight.slice(0, 5)), 'a', { t: 'start' }).out, 'a')).toEqual(['bad_start']);
});

test('sit accepts seats 0 to 7', () => {
  let s = roomOf('free', 'a');
  s = run(s, 'a', { t: 'sit', seat: 7 }).state!;
  expect(s.seats[7]?.name).toBe('a');
});

test('start with 3 → bad_start; one stands → start with 2 → aiming', () => {
  let s = room('a', 'b', 'c');
  const r = run(s, 'a', { t: 'start' });
  expect(errorsTo(r.out, 'a')).toEqual(['bad_start']);
  s = run(s, 'b', { t: 'sit', seat: null }).state!;
  s = run(s, 'a', { t: 'start' }).state!;
  expect(s.phase).toBe('aiming');
  expect(s.game!.seats).toBe(2);
  expect(s.seats.map((x) => x?.name ?? null)).toEqual(['a', 'c', null, null, null, null, null, null]);
});

test('shot from wrong seat → not_your_turn', () => {
  const s = started('a', 'b');
  const r = run(s, 'b', { t: 'shot', shotNo: 0, shot: SHOT });
  expect(errorsTo(r.out, 'b')).toEqual(['not_your_turn']);
  expect(r.state!.phase).toBe('aiming');
});

test('rejects cue overlapping another ball', () => {
  const s = started('a', 'b');
  const one = s.game!.balls.find((b) => b.id === 1)!;
  const r = run(s, 'a', { t: 'shot', shotNo: 0, shot: SHOT, cue: { x: one.x - R, y: one.y } });
  expect(errorsTo(r.out, 'a')).toEqual(['bad_cue']);
});

test('rejects cue outside kitchen on break', () => {
  const s = started('a', 'b');
  const r = run(s, 'a', { t: 'shot', shotNo: 0, shot: SHOT, cue: { x: 1.2, y: 0.3 } });
  expect(errorsTo(r.out, 'a')).toEqual(['bad_cue']);
});

test('reconnect same playerId regains seat', () => {
  let s = started('a', 'b');
  s = reduce(s, { kind: 'disconnect', playerId: pid('b') }, 0).state!;
  expect(s.seats[1]!.connected).toBe(false);
  s = run(s, 'b', { t: 'hello', playerId: pid('b'), name: 'b' }).state!;
  expect(s.seats[1]).toMatchObject({ name: 'b', connected: true });
  expect(s.spectators).toEqual([]);
});

test('same playerId twice keeps one seat', () => {
  let s = room('a', 'b');
  s = run(s, 'a', { t: 'hello', playerId: pid('a'), name: 'a' }).state!;
  expect(s.seats.filter((x) => x?.playerId === pid('a'))).toHaveLength(1);
  expect(s.spectators).toEqual([]);
});

test('teammate shoots for disconnected partner', () => {
  let s = started('a', 'b', 'c', 'd');
  s = reduce(s, { kind: 'disconnect', playerId: pid('a') }, 0).state!;
  const r = run(s, 'c', { t: 'shot', shotNo: 0, shot: SHOT });
  expect(r.state!.phase).toBe('rolling');
});

test('2 players: disconnected shooter → nobody else can shoot', () => {
  let s = started('a', 'b');
  s = reduce(s, { kind: 'disconnect', playerId: pid('a') }, 0).state!;
  const r = run(s, 'b', { t: 'shot', shotNo: 0, shot: SHOT });
  expect(errorsTo(r.out, 'b')).toEqual(['not_your_turn']);
});

test('shooter result applied immediately', () => {
  const { state, result } = breakShot(started('a', 'b'), 'a');
  const r = run(state, 'a', result, 500);
  expect(r.state!.phase).not.toBe('rolling');
  expect(r.state!.shotNo).toBe(1);
  expect(r.out.filter((o) => o.msg.t === 'state')).toHaveLength(2);
});

test('fallback result after 10s', () => {
  const { state, result } = breakShot(started('a', 'b'), 'a', 1000);
  let s = run(state, 'b', result, 2000).state!;
  expect(s.phase).toBe('rolling');
  s = reduce(s, { kind: 'tick' }, 1000 + 9999).state!;
  expect(s.phase).toBe('rolling');
  s = reduce(s, { kind: 'tick' }, 1000 + 10000).state!;
  expect(s.phase).not.toBe('rolling');
  expect(s.shotNo).toBe(1);
});

test('late non-shooter result applies on arrival', () => {
  const { state, result } = breakShot(started('a', 'b'), 'a', 0);
  const s = run(state, 'b', result, 12000).state!;
  expect(s.shotNo).toBe(1);
});

test('public room has no playerIds', () => {
  const r = run(room('a'), 'b', { t: 'hello', playerId: pid('b'), name: 'b' });
  const text = JSON.stringify(r.out.filter((o) => o.msg.t === 'state').map((o) => (o.msg as Extract<ServerMsg, { t: 'state' }>).room));
  expect(text).not.toContain('player-');
});

test('sit: swap to free seat and stand to spectator in waiting', () => {
  let s = room('a', 'b', 'c');
  s = run(s, 'a', { t: 'sit', seat: 3 }).state!;
  expect(s.seats.map((x) => x?.name ?? null)).toEqual([null, 'b', 'c', 'a', null, null, null, null]);
  s = run(s, 'c', { t: 'sit', seat: null }).state!;
  expect(s.spectators.map((x) => x.name)).toEqual(['c']);
  s = run(s, 'c', { t: 'sit', seat: 0 }).state!;
  expect(s.seats[0]?.name).toBe('c');
});

test('rematch after over', () => {
  let s = started('a', 'b');
  s = { ...s, phase: 'over', game: { ...s.game!, winner: 0 } as RoomState['game'] };
  s = run(s, 'b', { t: 'rematch' }).state!;
  expect(s.phase).toBe('aiming');
  expect(s.game!.mode === 'eightball' && s.game!.winner).toBeNull();
  expect(s.game!.turn).toBe(1);
});

test('hello during rolling resends the shot to that player', () => {
  const { state } = breakShot(started('a', 'b'), 'a', 0);
  const r = run(state, 'b', { t: 'hello', playerId: pid('b'), name: 'b' }, 3000);
  const shot = r.out.find((o) => o.to === pid('b') && o.msg.t === 'shot');
  expect(shot?.msg).toMatchObject({ t: 'shot', shotNo: 0, by: 0 });
  expect((shot!.msg as Extract<ServerMsg, { t: 'shot' }>).balls).toEqual(state.game!.balls);
});

test('start counts only connected seats', () => {
  let s = room('a', 'b', 'c');
  s = reduce(s, { kind: 'disconnect', playerId: pid('c') }, 0).state!;
  s = run(s, 'a', { t: 'start' }).state!;
  expect(s.phase).toBe('aiming');
  expect(s.seats.map((x) => x?.name ?? null)).toEqual(['a', 'b', null, null, null, null, null, null]);
});

test('sit can take a disconnected seat while waiting', () => {
  let s = room('a', 'b', 'c', 'd', 'e');
  s = reduce(s, { kind: 'disconnect', playerId: pid('d') }, 0).state!;
  s = run(s, 'e', { t: 'sit', seat: 3 }).state!;
  expect(s.seats[3]).toMatchObject({ name: 'e', connected: true });
  expect(s.spectators).toEqual([]);
});

test('nextAlarm: a pending shot without fallback schedules nothing', () => {
  const { state } = breakShot(started('a', 'b'), 'a', 0);
  expect(nextAlarm(state, undefined, 0, 20000)).toBeNull();
});

test('nextAlarm: fallback, empty room and zombie sweep', () => {
  const { state } = breakShot(started('a', 'b'), 'a', 1000);
  const withFallback = run(state, 'b', breakShot(started('a', 'b'), 'a', 1000).result, 2000).state!;
  expect(nextAlarm(withFallback, undefined, 0, 2000)).toBe(1000 + FALLBACK_MS);
  expect(nextAlarm(started('a', 'b'), 5000, 0, 6000)).toBe(5000 + EMPTY_MS);
  expect(nextAlarm(started('a', 'b'), undefined, 2, 6000)).toBe(6000 + SWEEP_MS);
});

function roomOf(mode: RoomState['mode'], ...names: string[]): RoomState {
  let s: RoomState = createRoom('WXYZ', 0, mode);
  for (const n of names) s = run(s, n, { t: 'hello', playerId: pid(n), name: n }).state!;
  return s;
}

test('start respects the seat counts of each mode', () => {
  expect(run(roomOf('free', 'a'), 'a', { t: 'start' }).state!.phase).toBe('aiming');
  expect(run(roomOf('sinuca', 'a', 'b', 'c'), 'a', { t: 'start' }).state!.game!.mode).toBe('sinuca');
  expect(errorsTo(run(roomOf('eightball', 'a', 'b', 'c'), 'a', { t: 'start' }).out, 'a')).toEqual(['bad_start']);
});

test('rerack in free mode puts the balls back', () => {
  let s = run(roomOf('free', 'a', 'b'), 'a', { t: 'start' }).state!;
  s = { ...s, game: { ...s.game!, balls: s.game!.balls.map((b) => (b.id === 3 ? { ...b, pocketed: true } : b)) } };
  s = run(s, 'b', { t: 'rerack' }).state!;
  expect(s.game!.balls.every((b) => !b.pocketed)).toBe(true);
  expect(s.phase).toBe('aiming');
});

test('rerack is refused outside free mode', () => {
  const s = run(roomOf('eightball', 'a', 'b'), 'a', { t: 'start' }).state!;
  expect(errorsTo(run(s, 'a', { t: 'rerack' }).out, 'a')).toEqual(['bad_msg']);
});

test('sinuca: cue in hand must stay inside the D', () => {
  const s = run(roomOf('sinuca', 'a', 'b'), 'a', { t: 'start' }).state!;
  expect(errorsTo(run(s, 'a', { t: 'shot', shotNo: 0, shot: SHOT, cue: { x: 1.5, y: 0.9 } }).out, 'a')).toEqual(['bad_cue']);
  expect(run(s, 'a', { t: 'shot', shotNo: 0, shot: SHOT, cue: { x: 0.6, y: 0.889 } }).state!.phase).toBe('rolling');
});

test('individual modes: a connected player covers a disconnected turn', () => {
  let s = run(roomOf('sinuca', 'a', 'b', 'c'), 'a', { t: 'start' }).state!;
  s = reduce(s, { kind: 'disconnect', playerId: pid('a') }, 0).state!;
  expect(run(s, 'c', { t: 'shot', shotNo: 0, shot: SHOT }).state!.phase).toBe('rolling');
});

test('snooker game ends → over with rematch', () => {
  let s = run(roomOf('snooker', 'a', 'b'), 'a', { t: 'start' }).state!;
  s = { ...s, phase: 'over', game: { ...s.game!, winners: [1] } as RoomState['game'] };
  s = run(s, 'a', { t: 'rematch' }).state!;
  expect(s.phase).toBe('aiming');
  expect(s.game!.mode).toBe('snooker');
});

test('every mode can start with a single player', () => {
  for (const mode of ['eightball', 'free', 'sinuca', 'snooker'] as const) {
    expect(run(roomOf(mode, 'a'), 'a', { t: 'start' }).state!.phase).toBe('aiming');
  }
});

test('solo eight-ball: losing ends the game with no winner names', () => {
  let s = run(roomOf('eightball', 'a'), 'a', { t: 'start' }).state!;
  s = { ...s, game: { ...s.game!, isBreak: false, ballInHand: null, groups: ['solids', 'stripes'] } as RoomState['game'] };
  const { state } = breakShot(s, 'a');
  const r = run(state, 'a', { t: 'result', shotNo: 0, final: state.game!.balls.map((b) => (b.id === 8 ? { ...b, pocketed: true } : b)), events: [{ step: 1, kind: 'hit', a: 0, b: 8 }, { step: 3, kind: 'pocket', ball: 8, pocket: 0 }] });
  expect(r.state!.phase).toBe('over');
  expect(winnersOf(r.state!.game!)).toEqual([]);
});

test('aim relays the spin and power to everyone', () => {
  const s = run(roomOf('free', 'a'), 'a', { t: 'start' }).state!;
  const r = run(s, 'a', { t: 'aim', angle: 0.5, power: 0.3, spinX: 0.2, spinY: -0.4 });
  expect(r.out.map((o) => o.msg)).toEqual([{ t: 'aim', seat: 0, angle: 0.5, power: 0.3, spinX: 0.2, spinY: -0.4 }]);
});

test('reset: back to waiting, scores gone, dropped seats freed, spectators sit, newcomers sit', () => {
  let s = started('a', 'b');
  s = run(s, 'c', { t: 'hello', playerId: pid('c'), name: 'c' }).state!;
  expect(s.spectators.map((x) => x.name)).toEqual(['c']);
  s = reduce(s, { kind: 'disconnect', playerId: pid('b') }, 0).state!;
  const shotNo = s.shotNo;
  s = run(s, 'a', { t: 'reset' }).state!;
  expect(s.phase).toBe('waiting');
  expect(s.game).toBeNull();
  expect(s.pending).toBeNull();
  expect(s.shotNo).toBe(shotNo + 1);
  expect(s.seats.map((x) => x?.name ?? null).slice(0, 3)).toEqual(['a', 'c', null]);
  expect(s.spectators).toEqual([]);
  s = run(s, 'd', { t: 'hello', playerId: pid('d'), name: 'd' }).state!;
  expect(s.seats[2]?.name).toBe('d');
  expect(s.seats.filter(Boolean)).toHaveLength(3);
});

test('reset: only someone seated, and not while already waiting', () => {
  let s = started('a', 'b');
  s = run(s, 'c', { t: 'hello', playerId: pid('c'), name: 'c' }).state!;
  expect(errorsTo(run(s, 'c', { t: 'reset' }).out, 'c')).toEqual(['bad_msg']);
  expect(errorsTo(run(room('a'), 'a', { t: 'reset' }).out, 'a')).toEqual(['bad_msg']);
});

test('log: start, each shot, and new game go into the room log', () => {
  const { state, result } = breakShot(started('a', 'b'), 'a');
  let s = run(state, 'a', result, 500).state!;
  expect(s.log[0]).toBe('Partida começou com 2 jogadores');
  expect(s.log[1]).toMatch(/^a: /);
  s = run(s, 'a', { t: 'reset' }).state!;
  expect(s.log.at(-1)).toBe('a abriu uma nova partida');
});

test('vote kick: more than half of the others; the kicked one cannot come back', () => {
  let s = room('a', 'b', 'c', 'd');
  // 3 outros votam sobre 'd': precisa de 2
  let r = run(s, 'a', { t: 'kick', seat: 3 });
  s = r.state!;
  expect(s.seats[3]?.name).toBe('d');
  expect(publicRoom(s).kickVotes[3]).toBe(1);
  // clicar de novo tira o voto
  s = run(s, 'a', { t: 'kick', seat: 3 }).state!;
  expect(publicRoom(s).kickVotes[3]).toBe(0);
  s = run(s, 'a', { t: 'kick', seat: 3 }).state!;
  r = run(s, 'b', { t: 'kick', seat: 3 });
  s = r.state!;
  expect(s.seats[3]).toBeNull();
  expect(errorsTo(r.out, 'd')).toEqual(['kicked']);
  expect(s.log.at(-1)).toBe('d foi expulso por votação');
  expect(errorsTo(run(s, 'd', { t: 'hello', playerId: pid('d'), name: 'd' }).out, 'd')).toEqual(['kicked']);
});

test('vote kick: only seated players vote, not on themselves; 2 players → 1 vote is enough', () => {
  let s = room('a', 'b');
  expect(errorsTo(run(s, 'a', { t: 'kick', seat: 0 }).out, 'a')).toEqual(['bad_msg']);
  s = run(s, 'c', { t: 'hello', playerId: pid('c'), name: 'c' }).state!;
  s = run(s, 'c', { t: 'sit', seat: null }).state!;
  expect(errorsTo(run(s, 'c', { t: 'kick', seat: 1 }).out, 'c')).toEqual(['bad_msg']);
  s = run(s, 'a', { t: 'kick', seat: 1 }).state!;
  expect(s.seats[1]).toBeNull();
});

test('kicked mid-game: their turn is skipped, now and on the next shots', () => {
  let s = run(roomOf('free', 'a', 'b', 'c'), 'a', { t: 'start' }).state!;
  s = { ...s, game: { ...s.game!, turn: 1 } };
  s = run(s, 'a', { t: 'kick', seat: 1 }).state!;
  s = run(s, 'c', { t: 'kick', seat: 1 }).state!;
  expect(s.seats[1]).toBeNull();
  // era a vez dele: passa na hora para o próximo sentado
  expect(s.game!.turn).toBe(2);
  // c taca fraco para trás (não acerta nada): a vez iria para 0 (a); depois de a, pularia o 1 e iria para c
  const soft: Shot = { dx: -1, dy: 0, power: 0.05, spinX: 0, spinY: 0 };
  const shoot = (st: RoomState, who: string) => {
    const r = run(st, who, { t: 'shot', shotNo: st.shotNo, shot: soft });
    const sim = simulate(r.state!.game!.balls, soft);
    return run(r.state!, who, { t: 'result', shotNo: st.shotNo, final: sim.final, events: sim.events }).state!;
  };
  s = shoot(s, 'c');
  expect(s.game!.turn).toBe(0);
  s = shoot(s, 'a');
  expect(s.game!.turn).toBe(2);
});

test('video: anyone in the room puts one on or takes it off; one at a time', () => {
  let s = started('a', 'b');
  s = run(s, 'c', { t: 'hello', playerId: pid('c'), name: 'c' }).state!;
  s = run(s, 'c', { t: 'video', id: 'dQw4w9WgXcQ' }, 5000).state!;
  expect(publicRoom(s).video).toEqual({ id: 'dQw4w9WgXcQ', by: 'c', startedAt: 5000 });
  s = run(s, 'a', { t: 'video', id: 'aaaaaaaaaaa' }, 9000).state!;
  expect(publicRoom(s).video).toEqual({ id: 'aaaaaaaaaaa', by: 'a', startedAt: 9000 });
  expect(s.log.at(-1)).toBe('a colocou um vídeo');
  s = run(s, 'b', { t: 'video', id: null }).state!;
  expect(publicRoom(s).video).toBeNull();
  expect(s.log.at(-1)).toBe('b tirou o vídeo');
});
