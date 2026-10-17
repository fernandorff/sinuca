// Teste de fumaça contra um servidor rodando: node scripts/smoke.mjs [http://localhost:8787]
import { simulate } from '../src/shared/physics.ts';

const base = process.argv[2] ?? 'http://localhost:8787';
const wsBase = base.replace(/^http/, 'ws');
const SHOT = { dx: 1, dy: 0, power: 1, spinX: 0, spinY: 0.2 };

function fail(msg) {
  console.error('SMOKE FAIL:', msg);
  process.exit(1);
}

function client(path, playerId, name) {
  const ws = new WebSocket(wsBase + path);
  const msgs = [];
  const waiters = [];
  let closed = false;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  };
  ws.onclose = () => { closed = true; };
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error ' + path)); });
  return {
    ws, msgs, isClosed: () => closed,
    async hello() { await opened; if (playerId) this.send({ t: 'hello', playerId, name }); },
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor(pred, label, ms = 8000) {
      const seen = msgs.find(pred);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve) => {
        const timer = setTimeout(() => fail('timeout waiting for ' + label), ms);
        waiters.push({ pred, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      });
    },
  };
}

const health = await fetch(base + '/api/health').catch(() => null);
if (!health?.ok) fail('/api/health not ok');

const ghost = client('/ws/room/ZZZZ', 'smoke-ghost-0001', 'x');
await ghost.hello();
await ghost.waitFor((m) => m.t === 'error' && m.code === 'not_found', 'not_found');

const created = await fetch(base + '/api/rooms', { method: 'POST', body: JSON.stringify({ mode: 'eightball' }) });
const { id } = await created.json();
if (!/^[A-Z]{4}$/.test(id ?? '')) fail('bad room id ' + id);

const lobby = client('/ws/lobby');
const a = client('/ws/room/' + id, 'smoke-a-00000001', 'Ana');
const b = client('/ws/room/' + id, 'smoke-b-00000001', 'Bia');
await a.hello();
await b.hello();
await a.waitFor((m) => m.t === 'state' && m.room.seats.filter(Boolean).length === 2, 'two seats');
await lobby.waitFor((m) => m.t === 'rooms' && m.rooms.some((r) => r.id === id && r.players === 2), 'room in lobby');

a.send({ t: 'start' });
await b.waitFor((m) => m.t === 'state' && m.room.phase === 'aiming', 'aiming');
a.send({ t: 'shot', shotNo: 0, shot: SHOT });
for (const c of [a, b]) {
  const s = await c.waitFor((m) => m.t === 'shot' && m.shotNo === 0, 'shot broadcast');
  const sim = simulate(s.balls, s.shot);
  c.send({ t: 'result', shotNo: 0, final: sim.final, events: sim.events });
}
const sa = await a.waitFor((m) => m.t === 'state' && m.room.shotNo === 1, 'state after shot (A)');
const sb = await b.waitFor((m) => m.t === 'state' && m.room.shotNo === 1, 'state after shot (B)');
if (JSON.stringify(sa.room.game.balls) !== JSON.stringify(sb.room.game.balls)) fail('A and B see different tables');

// mesma pessoa em outra aba: a antiga é avisada e fechada, a nova fica conectada
const a2 = client('/ws/room/' + id, 'smoke-a-00000001', 'Ana');
await a2.hello();
await a.waitFor((m) => m.t === 'error' && m.code === 'other_tab', 'other_tab');
await new Promise((r) => setTimeout(r, 500));
const last = [...b.msgs].reverse().find((m) => m.t === 'state');
if (!last.room.seats[0]?.connected) fail('closing the old tab disconnected the new one');

for (const c of [a, b, a2, lobby, ghost]) c.ws.close();
console.log('SMOKE OK', id);
process.exit(0);
