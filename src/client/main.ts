import { simulate } from '../shared/physics.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { cueOk, type PublicRoom } from '../shared/room.ts';
import { rack, type BallPos } from '../shared/table.ts';
import { createControls } from './controls.ts';
import { connect } from './net.ts';
import { createScene } from './scene.ts';
import { askName, el, renderHud, renderLobby, screen, toast, type RoomInfo } from './ui.ts';

// localStorage pode falhar (aba anônima, dados bloqueados): cai para a memória
const memory = new Map<string, string>();
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k) ?? memory.get(k) ?? null;
    } catch {
      return memory.get(k) ?? null;
    }
  },
  set(k: string, v: string) {
    memory.set(k, v);
    try {
      localStorage.setItem(k, v);
    } catch {
      // só na memória
    }
  },
};

// ?as=nome dá outra identidade na mesma máquina (testar com várias abas, ou dois lugares num PC só)
const as = new URLSearchParams(location.search).get('as')?.replace(/[^a-z0-9]/gi, '').slice(0, 12) ?? '';
const PID = 'sinuca:pid' + (as && ':' + as);
const NAME = 'sinuca:name' + (as && ':' + as);
const playerId = store.get(PID) ?? crypto.randomUUID();
store.set(PID, playerId);

const ui = document.getElementById('ui')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
window.addEventListener('hashchange', () => location.reload());

async function main() {
  const name = store.get(NAME) || (await askName(ui, ''));
  store.set(NAME, name);
  const id = location.hash.slice(1).toUpperCase();
  if (/^[A-Z]{4}$/.test(id)) startRoom(id, name);
  else startLobby(name);
}

function startLobby(name: string) {
  document.body.className = 'in-lobby';
  let rooms: RoomInfo[] | null = null;
  const draw = () =>
    renderLobby(ui, name, rooms, create, async () => {
      name = await askName(document.body, name);
      store.set(NAME, name);
      draw();
    });
  async function create(mode: string) {
    try {
      const res = await fetch('/api/rooms', { method: 'POST', body: JSON.stringify({ mode }) });
      if (!res.ok) throw new Error(String(res.status));
      location.hash = (await res.json()).id;
    } catch {
      toast('Não deu para criar a mesa. Tente de novo.');
    }
  }
  connect('/ws/lobby', (m) => {
    if (m.t !== 'rooms') return;
    rooms = (m.rooms as RoomInfo[]).sort((a, b) => Number(b.phase === 'waiting') - Number(a.phase === 'waiting'));
    draw();
  }, () => {});
  draw();
}

function startRoom(id: string, name: string) {
  document.body.className = 'in-room';
  const scene = createScene(canvas);
  const hud = el('div', { class: 'hud' });
  const ctl = el('div', { class: 'controls off' });
  ui.replaceChildren(hud, ctl);

  let room: PublicRoom | null = null;
  let you: { playerId: string; seat: number | null } = { playerId, seat: null };
  let online = false;
  let animating = false;
  let queued: PublicRoom | null = null;
  let shown: BallPos[] = [];
  let status = 'Conectando…';

  const net = connect('/ws/room/' + id, onMsg, () => net.send({ t: 'hello', playerId, name }), (on) => {
    online = on;
    draw();
  });
  const controls = createControls(canvas, ctl, scene, {
    onAim: (angle) => net.send({ t: 'aim', angle }),
    onShoot(shot, cue) {
      if (!room) return;
      net.send({ t: 'shot', shotNo: room.shotNo, shot, cue });
      controls.enable(null);
    },
    onMoveCue(p, valid) {
      show(shown.map((b) => (b.id === 0 ? { ...b, x: p.x, y: p.y, pocketed: false } : b)));
      status = valid ? 'Branca posicionada. Mire e taque.' : 'A branca não pode ficar aí.';
      draw();
    },
  });

  const act = {
    sit: (seat: number | null) => net.send({ t: 'sit', seat }),
    start: () => net.send({ t: 'start' }),
    rematch: () => net.send({ t: 'rematch' }),
    lobby: () => (location.hash = ''),
    async copy() {
      try {
        await navigator.clipboard.writeText(location.href);
        toast('Link copiado. Mande no grupo!');
      } catch {
        toast(location.href);
      }
    },
  };

  function draw() {
    if (room) renderHud(hud, room, you, online, status, act);
  }

  function show(balls: BallPos[]) {
    shown = balls;
    scene.setBalls(balls);
  }

  // desliza cada bola até a posição oficial em 150 ms
  function tween(to: BallPos[]) {
    const from = new Map(shown.map((b) => [b.id, b]));
    if (!shown.length) return show(to);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / 150));
      show(to.map((b) => {
        const f = from.get(b.id);
        return f && !b.pocketed ? { ...b, x: f.x + (b.x - f.x) * k, y: f.y + (b.y - f.y) * k } : b;
      }));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function myTurn(r: PublicRoom): boolean {
    const g = r.game;
    if (!g || r.phase !== 'aiming' || you.seat === null) return false;
    if (you.seat === g.turn) return true;
    return g.seats === 4 && !r.seats[g.turn]?.connected && you.seat % 2 === g.turn % 2;
  }

  function applyState(r: PublicRoom) {
    room = r;
    const g = r.game;
    tween(g ? g.balls : rack());
    const turnName = g ? r.seats[g.turn]?.name ?? '' : '';
    const foul = g?.lastFoul ? `Falta: ${g.lastFoul}. ` : '';
    if (r.phase === 'waiting') status = 'Esperando os jogadores.';
    else if (r.phase === 'over') status = foul;
    else if (myTurn(r)) status = `${foul}Sua vez${g!.ballInHand ? ' · bola na mão' : ''}.`;
    else status = `${foul}Vez de ${turnName}.`;
    if (myTurn(r) && g) {
      const cue = g.balls.find((b) => b.id === 0)!;
      controls.enable({ ballInHand: g.ballInHand, cue, cueValid: (p) => cueOk(g, p) });
    } else controls.enable(null);
    draw();
  }

  function animate(m: Extract<ServerMsg, { t: 'shot' }>) {
    animating = true;
    controls.enable(null);
    status = `${room?.seats[m.by]?.name ?? 'Alguém'} tacou.`;
    draw();
    const sim = simulate(m.balls, m.shot);
    // o resultado sai antes da animação: se quem tacou cair, a mesa usa o de outro aparelho
    net.send({ t: 'result', shotNo: m.shotNo, final: sim.final, events: sim.events });
    const t0 = performance.now();
    const frame = (t: number) => {
      const i = Math.min(sim.frames.length - 1, Math.max(0, Math.floor(((t - t0) / 1000) * 60)));
      show(sim.frames[i]);
      if (controls.camMode === 'aim') scene.follow(sim.frames[i].find((b) => b.id === 0 && !b.pocketed) ?? null);
      if (i < sim.frames.length - 1) return requestAnimationFrame(frame);
      animating = false;
      scene.follow(null);
      const next = queued ?? room;
      queued = null;
      if (next) applyState(next);
    };
    requestAnimationFrame(frame);
  }

  function onMsg(m: ServerMsg) {
    if (m.t === 'state') {
      you = m.you;
      if (animating) queued = m.room;
      else applyState(m.room);
    } else if (m.t === 'shot') animate(m);
    else if (m.t === 'aim') {
      if (m.seat !== you.seat) controls.showAim(m.angle);
    } else if (m.code === 'not_found') {
      net.stop();
      screen(ui, 'Mesa não encontrada', 'Confira o link ou crie uma mesa nova no lobby.', 'Ir para o lobby', act.lobby);
    } else if (m.code === 'other_tab') {
      net.stop();
      screen(ui, 'Mesa aberta em outra aba', 'Você abriu esta mesa em outra aba ou janela.', 'Jogar nesta aba', () => location.reload());
    } else {
      toast(m.msg);
      if (room && !animating) applyState(room);
    }
  }
}

main();
