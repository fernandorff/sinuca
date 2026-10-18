import { expect, test } from 'vitest';
import { parseClientMessage } from '../src/shared/protocol.ts';

const PID = 'abcdef12-3456';
const shot = (s: object) => JSON.stringify({ t: 'shot', shotNo: 0, shot: { dx: 1, dy: 0, power: 0.5, spinX: 0, spinY: 0, ...s } });
const ball = (id: number) => ({ id, x: 1, y: 0.5, pocketed: false });

test('accepts a valid hello and shot', () => {
  expect(parseClientMessage(JSON.stringify({ t: 'hello', playerId: PID, name: 'Ana' }))).toEqual({ t: 'hello', playerId: PID, name: 'Ana' });
  expect(parseClientMessage(shot({}))).toMatchObject({ t: 'shot', shotNo: 0 });
});

test('rejects messages over 2 KB (except result)', () => {
  expect(parseClientMessage(JSON.stringify({ t: 'aim', angle: 1, pad: 'x'.repeat(2100) }))).toBeNull();
});

test('rejects result over 64 KB', () => {
  const events = Array.from({ length: 999 }, (_, i) => ({ step: i, kind: 'cushion', ball: 1, pad: 'x'.repeat(60) }));
  expect(parseClientMessage(JSON.stringify({ t: 'result', shotNo: 0, final: [ball(0)], events }))).toBeNull();
});

test('rejects invalid JSON', () => expect(parseClientMessage('{nope')).toBeNull());
test('rejects unknown t', () => expect(parseClientMessage('{"t":"boom"}')).toBeNull());
test('rejects non-finite numbers', () => expect(parseClientMessage('{"t":"aim","angle":1e999}')).toBeNull());
test('rejects power outside [0,1]', () => expect(parseClientMessage(shot({ power: 1.2 }))).toBeNull());
test('rejects spin outside unit disc', () => expect(parseClientMessage(shot({ spinX: 0.8, spinY: 0.8 }))).toBeNull());
test('rejects non-unit direction', () => expect(parseClientMessage(shot({ dx: 0.5, dy: 0 }))).toBeNull());

test('rejects final with more than 22 balls', () => {
  const final = Array.from({ length: 23 }, (_, i) => ball(i % 22));
  expect(parseClientMessage(JSON.stringify({ t: 'result', shotNo: 0, final, events: [] }))).toBeNull();
});

test('rejects more than 1000 events', () => {
  const events = Array.from({ length: 1001 }, (_, i) => ({ step: i, kind: 'cushion', ball: 1 }));
  expect(parseClientMessage(JSON.stringify({ t: 'result', shotNo: 0, final: [ball(0)], events }))).toBeNull();
});

test('rejects bad playerId', () => {
  expect(parseClientMessage(JSON.stringify({ t: 'hello', playerId: 'X', name: 'Ana' }))).toBeNull();
});

test('name: strips < and >', () => {
  expect(parseClientMessage(JSON.stringify({ t: 'hello', playerId: PID, name: '<b>Zé</b>' }))).toMatchObject({ name: 'bZé/b' });
});

test('name: cut at 20 chars, empty → Jogador', () => {
  expect(parseClientMessage(JSON.stringify({ t: 'hello', playerId: PID, name: 'a'.repeat(30) }))).toMatchObject({ name: 'a'.repeat(20) });
  expect(parseClientMessage(JSON.stringify({ t: 'hello', playerId: PID, name: '   ' }))).toMatchObject({ name: 'Jogador' });
});

test('sit accepts seat 0..7 or null', () => {
  expect(parseClientMessage('{"t":"sit","seat":7}')).toEqual({ t: 'sit', seat: 7 });
  expect(parseClientMessage('{"t":"sit","seat":null}')).toEqual({ t: 'sit', seat: null });
  expect(parseClientMessage('{"t":"sit","seat":8}')).toBeNull();
});

test('accepts snooker ball ids up to 21 and 22 balls; rejects id 22', () => {
  const final = Array.from({ length: 22 }, (_, i) => ball(i));
  expect(parseClientMessage(JSON.stringify({ t: 'result', shotNo: 0, final, events: [{ step: 1, kind: 'hit', a: 0, b: 21, v: 1.5 }] }))).not.toBeNull();
  expect(parseClientMessage(JSON.stringify({ t: 'result', shotNo: 0, final: [ball(22)], events: [] }))).toBeNull();
});

test('accepts rerack', () => expect(parseClientMessage('{"t":"rerack"}')).toEqual({ t: 'rerack' }));

test('aim carries spin and power; old clients without them get zeros', () => {
  const aim = (o: object) => parseClientMessage(JSON.stringify({ t: 'aim', angle: 1, ...o }));
  expect(aim({ power: 0.4, spinX: 0.3, spinY: -0.5 })).toEqual({ t: 'aim', angle: 1, power: 0.4, spinX: 0.3, spinY: -0.5, item: null });
  expect(aim({})).toEqual({ t: 'aim', angle: 1, power: 0, spinX: 0, spinY: 0, item: null });
  expect(aim({ spinX: 0.8, spinY: 0.8 })).toBeNull();
  expect(aim({ power: 2 })).toBeNull();
});

test('video: an 11-character YouTube id or null', () => {
  expect(parseClientMessage('{"t":"video","id":"dQw4w9WgXcQ"}')).toEqual({ t: 'video', id: 'dQw4w9WgXcQ' });
  expect(parseClientMessage('{"t":"video","id":null}')).toEqual({ t: 'video', id: null });
  expect(parseClientMessage('{"t":"video","id":"<script>"}')).toBeNull();
});

test('timer: only the offered limits', () => {
  expect(parseClientMessage('{"t":"timer","seconds":30}')).toEqual({ t: 'timer', seconds: 30 });
  expect(parseClientMessage('{"t":"timer","seconds":0}')).toEqual({ t: 'timer', seconds: 0 });
  expect(parseClientMessage('{"t":"timer","seconds":7}')).toBeNull();
});

test('shot and aim carry an optional power from the list', () => {
  expect(parseClientMessage(shot({ item: 'bomb' }))).toMatchObject({ t: 'shot', shot: { item: 'bomb' } });
  expect(parseClientMessage(shot({ item: 'laser' }))).toBeNull();
  expect(parseClientMessage(JSON.stringify({ t: 'aim', angle: 1, item: 'ice' }))).toMatchObject({ t: 'aim', item: 'ice' });
});

test('shot carries the called pocket (0 to 5) for the mata-mata', () => {
  expect(parseClientMessage(shot({ call: 2 }))).toMatchObject({ shot: { call: 2 } });
  expect(parseClientMessage(shot({ call: 9 }))).toBeNull();
});
