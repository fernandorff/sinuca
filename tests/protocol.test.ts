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

test('sit accepts seat 0..3 or null', () => {
  expect(parseClientMessage('{"t":"sit","seat":3}')).toEqual({ t: 'sit', seat: 3 });
  expect(parseClientMessage('{"t":"sit","seat":null}')).toEqual({ t: 'sit', seat: null });
  expect(parseClientMessage('{"t":"sit","seat":4}')).toBeNull();
});

test('accepts snooker ball ids up to 21 and 22 balls; rejects id 22', () => {
  const final = Array.from({ length: 22 }, (_, i) => ball(i));
  expect(parseClientMessage(JSON.stringify({ t: 'result', shotNo: 0, final, events: [{ step: 1, kind: 'hit', a: 0, b: 21, v: 1.5 }] }))).not.toBeNull();
  expect(parseClientMessage(JSON.stringify({ t: 'result', shotNo: 0, final: [ball(22)], events: [] }))).toBeNull();
});

test('accepts rerack', () => expect(parseClientMessage('{"t":"rerack"}')).toEqual({ t: 'rerack' }));
