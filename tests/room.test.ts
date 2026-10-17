import { expect, test } from 'vitest';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol.ts';
import { EMPTY_MS, FALLBACK_MS, SWEEP_MS, createRoom, nextAlarm, reduce, type Out, type RoomState } from '../src/shared/room.ts';
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

test('4 seats then spectator', () => {
  const s = room('a', 'b', 'c', 'd', 'e');
  expect(s.seats.map((x) => x?.name)).toEqual(['a', 'b', 'c', 'd']);
  expect(s.spectators.map((x) => x.name)).toEqual(['e']);
});

test('start with 3 → bad_start; one stands → start with 2 → aiming', () => {
  let s = room('a', 'b', 'c');
  const r = run(s, 'a', { t: 'start' });
  expect(errorsTo(r.out, 'a')).toEqual(['bad_start']);
  s = run(s, 'b', { t: 'sit', seat: null }).state!;
  s = run(s, 'a', { t: 'start' }).state!;
  expect(s.phase).toBe('aiming');
  expect(s.game!.seats).toBe(2);
  expect(s.seats.map((x) => x?.name ?? null)).toEqual(['a', 'c', null, null]);
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
  expect(s.seats.map((x) => x?.name ?? null)).toEqual([null, 'b', 'c', 'a']);
  s = run(s, 'c', { t: 'sit', seat: null }).state!;
  expect(s.spectators.map((x) => x.name)).toEqual(['c']);
  s = run(s, 'c', { t: 'sit', seat: 0 }).state!;
  expect(s.seats[0]?.name).toBe('c');
});

test('rematch after over', () => {
  let s = started('a', 'b');
  s = { ...s, phase: 'over', game: { ...s.game!, winner: 0 } };
  s = run(s, 'b', { t: 'rematch' }).state!;
  expect(s.phase).toBe('aiming');
  expect(s.game!.winner).toBeNull();
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
  expect(s.seats.map((x) => x?.name ?? null)).toEqual(['a', 'b', null, null]);
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
