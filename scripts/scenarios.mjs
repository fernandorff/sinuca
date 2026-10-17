// Cenários com várias pessoas contra um servidor rodando: node scripts/scenarios.mjs [http://localhost:8787]
// Os resultados das tacadas são montados à mão (o servidor confia em quem tacou), para controlar a regra.
const base = process.argv[2] ?? 'http://localhost:8787';
const wsBase = base.replace(/^http/, 'ws');
const SHOT = { dx: 1, dy: 0, power: 0.3, spinX: 0, spinY: 0 };

function fail(msg) {
  console.error('SCENARIOS FAIL:', msg);
  for (const p of globalThis.players ?? []) {
    const s = p.last('state')?.room;
    console.error(p.playerId, p.msgs.map((m) => m.t === 'state' ? 's' + m.room.shotNo + m.room.phase[0] : m.t === 'shot' ? 'shot' + m.shotNo : m.t === 'error' ? 'E:' + m.code : m.t).join(' '));
  }
  process.exit(1);
}

function client(id, who) {
  const ws = new WebSocket(`${wsBase}/ws/room/${id}`);
  const msgs = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  };
  const opened = new Promise((res) => (ws.onopen = res));
  const c = {
    ws, msgs, who,
    playerId: `scn-${who}-${id}`.toLowerCase(),
    async hello() { await opened; c.send({ t: 'hello', playerId: c.playerId, name: who }); },
    send: (m) => ws.send(JSON.stringify(m)),
    last: (t) => [...msgs].reverse().find((m) => m.t === t),
    waitFor(pred, label, ms = 8000) {
      const seen = msgs.find(pred);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve) => {
        const timer = setTimeout(() => fail(`${who}: timeout waiting for ${label}`), ms);
        waiters.push({ pred, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      });
    },
  };
  return c;
}

// tacada sem falta e sem bola encaçapada: a branca bate na bola `target` e uma bola vai à tabela
function miss(balls, target) {
  return { final: balls, events: [{ step: 1, kind: 'hit', a: 0, b: target }, { step: 5, kind: 'cushion', ball: target }] };
}

async function shootAndResolve(shooter, room, target, resultFrom = shooter) {
  shooter.send({ t: 'shot', shotNo: room.shotNo, shot: SHOT });
  const shot = await shooter.waitFor((m) => m.t === 'shot' && m.shotNo === room.shotNo, 'shot echo');
  const { final, events } = miss(shot.balls, target);
  resultFrom.send({ t: 'result', shotNo: shot.shotNo, final, events });
  return shot;
}

const res = await fetch(base + '/api/rooms', { method: 'POST', body: JSON.stringify({ mode: 'eightball' }) });
const { id } = await res.json();
const [a, b, c, d, e] = ['Ana', 'Bia', 'Caio', 'Duda', 'Edu'].map((n) => client(id, n));
globalThis.players = [a, b, c, d, e];
for (const p of [a, b, c, d, e]) await p.hello();
await e.waitFor((m) => m.t === 'state' && m.you.seat === null, 'Edu becomes spectator');
console.log('ok  4 seated + 1 spectator');

a.send({ t: 'start' });
let room = (await a.waitFor((m) => m.t === 'state' && m.room.phase === 'aiming', 'aiming')).room;
if (room.game.seats !== 4) fail('expected doubles');

// rodízio de duplas: A1, B1, A2, B2
const order = [];
// os hello chegam por conexões diferentes e podem chegar fora de ordem: o lugar vem do servidor
const bySeat = [];
for (const p of [a, b, c, d]) bySeat[(await p.waitFor((m) => m.t === 'state' && m.room.phase === 'aiming', 'seat')).you.seat] = p;
for (let i = 0; i < 4; i++) {
  const shooter = bySeat[room.game.turn];
  const prevShot = room.shotNo;
  await shootAndResolve(shooter, room, 1);
  room = (await a.waitFor((m) => m.t === 'state' && m.room.shotNo === prevShot + 1, 'state after shot')).room;
  order.push(room.game.turn);
}
if (order.join() !== '1,2,3,0') fail('rotation was ' + order.join());
console.log('ok  doubles rotation 1,2,3,0');

// espectador vê a mira de quem está na vez
const [s0, s1, s2, s3] = bySeat;
s0.send({ t: 'aim', angle: 0.5 });
await e.waitFor((m) => m.t === 'aim' && m.angle === 0.5, 'spectator sees aim');
console.log('ok  spectator sees aim');

// o assento 0 cai na vez dele: o parceiro (assento 2) joga
s0.ws.close();
await s1.waitFor((m) => m.t === 'state' && m.room.seats[0] && !m.room.seats[0].connected, 'seat 0 shown disconnected');
const before = room.shotNo;
s2.send({ t: 'shot', shotNo: before, shot: SHOT });
const cShot = await e.waitFor((m) => m.t === 'shot' && m.shotNo === before, 'spectator sees teammate shot');
console.log('ok  teammate shoots for disconnected partner; spectator sees shot');

// quem tacou (assento 2) não manda resultado; o assento 1 manda: vale depois de 10 s
const t0 = Date.now();
s1.send({ t: 'result', shotNo: before, ...miss(cShot.balls, 1) });
room = (await s1.waitFor((m) => m.t === 'state' && m.room.shotNo === before + 1, 'fallback applied', 15000)).room;
const waited = Date.now() - t0;
if (waited < 9000) fail('fallback applied too early: ' + waited + ' ms');
console.log(`ok  fallback result applied after ${(waited / 1000).toFixed(1)} s`);

// quem caiu volta: recupera o lugar
const back = client(id, s0.who);
await back.hello();
const st = await back.waitFor((m) => m.t === 'state' && m.you.seat === 0, 'seat 0 regained');
if (!st.room.seats[0].connected) fail('seat 0 not connected after reconnect');
console.log('ok  reconnect regains seat');

for (const p of [back, s1, s2, s3, e]) p.ws.close();
console.log('SCENARIOS OK', id);
process.exit(0);
