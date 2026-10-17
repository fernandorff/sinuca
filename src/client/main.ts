import { simulate } from '../shared/physics.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import { MODES, highlightIds, newGameFor, type Mode } from '../shared/rules/index.ts';
import { cueOk, type PublicRoom } from '../shared/room.ts';
import type { BallPos } from '../shared/table.ts';
import { createControls } from './controls.ts';
import { connect } from './net.ts';
import { createScene } from './scene.ts';
import { createMusic, TRACKS, type TrackId } from './music.ts';
import { createSound } from './sound.ts';
import { askName, banner, el, renderHud, renderLobby, screen, toast, type RoomInfo } from './ui.ts';

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
  async function create(mode: Mode) {
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
  const hud = el('div', { class: 'hud' });
  const ctl = el('div', { class: 'controls off' });
  ui.replaceChildren(hud, ctl);

  let room: PublicRoom | null = null;
  let you: { playerId: string; seat: number | null } = { playerId, seat: null };
  let online = false;
  let animating = false;
  let skip = false;
  // tacada com bola caindo não pode ser pulada: todo mundo vê a bola entrar (pedido do Fernando, 17/10/2026)
  let skippable = true;
  let wasMine = false;
  let lastShotNo = -1;
  let queued: PublicRoom | null = null;
  let shown: BallPos[] = [];
  let status = 'Conectando…';
  let muted = store.get('sinuca:mute') === '1';
  const sound = createSound(() => muted);
  // música de fundo escolhida (fica salva); o navegador só deixa tocar depois do primeiro toque
  const music = createMusic();
  const saved = store.get('sinuca:music');
  let musicId: TrackId = TRACKS.some((t) => t.id === saved) ? (saved as TrackId) : 'off';
  window.addEventListener('pointerdown', () => musicId !== 'off' && music.play(musicId), { once: true });

  // a cena depende da mesa do modo, que só se sabe quando chega o primeiro estado
  let view: { scene: ReturnType<typeof createScene>; controls: ReturnType<typeof createControls> } | null = null;
  function viewFor(mode: Mode) {
    if (view) return view;
    const scene = createScene(canvas, mode);
    const controls = createControls(canvas, ctl, scene, {
      onAim: (aim) => net.send({ t: 'aim', ...aim }),
      onShoot(shot, cue) {
        if (!room) return;
        net.send({ t: 'shot', shotNo: room.shotNo, shot, cue });
        controls.enable(null);
      },
      onMoveCue(p, valid) {
        show(shown.map((b) => (b.id === 0 ? { ...b, x: p.x, y: p.y, pocketed: false } : b)));
        status = valid ? 'Branca posicionada. Mire e aperte Tacar.' : 'A branca não pode ficar aí.';
        draw();
      },
    });
    return (view = { scene, controls });
  }

  // Espaço durante a tacada pula a animação (na sua vez, Espaço taca: isso fica nos controles)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && animating && skippable) {
      e.preventDefault();
      skip = true;
    }
  });

  const net = connect('/ws/room/' + id, onMsg, () => net.send({ t: 'hello', playerId, name }), (on) => {
    online = on;
    draw();
  });

  const act = {
    sit: (seat: number | null) => net.send({ t: 'sit', seat }),
    start: () => net.send({ t: 'start' }),
    rematch: () => net.send({ t: 'rematch' }),
    rerack: () => net.send({ t: 'rerack' }),
    // no meio do jogo pergunta antes: o placar de todos zera
    reset: () => {
      if (room?.phase === 'over' || confirm('Começar uma nova partida? O placar zera e a mesa volta para a espera, para entrar mais gente.')) net.send({ t: 'reset' });
    },
    skip: () => (skip = skippable),
    music(id: TrackId) {
      musicId = id;
      store.set('sinuca:music', id);
      music.play(id);
      draw();
    },
    lobby: () => (location.hash = ''),
    mute() {
      muted = !muted;
      store.set('sinuca:mute', muted ? '1' : '0');
      sound.unlock();
      draw();
    },
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
    if (room) renderHud(hud, room, you, online, status, muted, animating && skippable, musicId, act);
  }

  function show(balls: BallPos[]) {
    shown = balls;
    view?.scene.setBalls(balls);
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
    if (r.seats[g.turn]?.connected) return false;
    // quem está na vez caiu: na bola 8 em dupla joga o parceiro; nos modos individuais, qualquer um sentado
    return g.mode === 'eightball' ? g.seats === 4 && you.seat % 2 === g.turn % 2 : true;
  }

  function applyState(r: PublicRoom) {
    room = r;
    const { controls, scene } = viewFor(r.mode);
    const g = r.game;
    scene.setHighlight(g && r.phase === 'aiming' ? highlightIds(g) : []);
    tween(g ? g.balls : newGameFor(r.mode, MODES[r.mode].seats[0], 0).balls);
    const turnName = g ? r.seats[g.turn]?.name ?? '' : '';
    const foul = g?.lastFoul ? `Falta: ${g.lastFoul}. ` : '';
    if (r.phase === 'waiting') status = 'Esperando os jogadores.';
    else if (r.phase === 'over') status = foul;
    else if (myTurn(r)) status = `${foul}Sua vez${g!.ballInHand ? ' · bola na mão' : ''}. Mire, escolha a força e aperte Tacar (ou Espaço).`;
    else status = `${foul}Vez de ${turnName}.`;
    // avisos grandes: falta na tacada que acabou de ser aplicada, ou a vez que acabou de virar sua
    const newShot = lastShotNo !== -1 && r.shotNo !== lastShotNo;
    if (r.phase === 'aiming' && newShot && g?.lastFoul) banner('Falta!', 'foul');
    else if (myTurn(r) && !wasMine) banner('Sua vez!');
    lastShotNo = r.shotNo;
    wasMine = myTurn(r);
    if (myTurn(r) && g) {
      const cue = g.balls.find((b) => b.id === 0)!;
      controls.enable({ ballInHand: g.ballInHand, cue, cueValid: (p) => cueOk(g, p) });
    } else controls.enable(null);
    draw();
  }

  function animate(m: Extract<ServerMsg, { t: 'shot' }>) {
    if (!room) return;
    const { scene, controls } = viewFor(room.mode);
    const sim = simulate(m.balls, m.shot, undefined, MODES[room.mode].table);
    animating = true;
    skip = false;
    skippable = !sim.events.some((e) => e.kind === 'pocket');
    controls.enable(null);
    scene.setHighlight([]);
    status = `${room.seats[m.by]?.name ?? 'Alguém'} tacou.`;
    draw();
    // o resultado sai antes da animação: se quem tacou cair, a mesa usa o de outro aparelho
    net.send({ t: 'result', shotNo: m.shotNo, final: sim.final, events: sim.events });
    const power = m.shot.power;
    let nextEvent = 0;
    let potted = false;
    let t0 = 0;
    const frame = (t: number) => {
      if (!t0) t0 = t;
      const i = skip ? sim.frames.length - 1 : Math.min(sim.frames.length - 1, Math.max(0, Math.floor(((t - t0) / 1000) * 60)));
      show(sim.frames[i]);
      if (skip) nextEvent = sim.events.length;
      // cada quadro cobre 4 passos da física: os eventos que já aconteceram viram som, brilho e tremidinha
      for (; nextEvent < sim.events.length && sim.events[nextEvent].step <= i * 4; nextEvent++) {
        const e = sim.events[nextEvent];
        if (e.kind === 'pocket') {
          sound.play('pocket');
          buzz(25);
          if (!potted && e.ball !== 0) banner('Na caçapa!', 'good');
          potted ||= e.ball !== 0;
        } else if (e.kind === 'hit') {
          const v = e.v ?? 1;
          sound.play('ball', v / 4);
          const a = sim.frames[i].find((b) => b.id === e.a);
          const b = sim.frames[i].find((b) => b.id === e.b);
          if (a && b) scene.flash((a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(1, v / 2.5));
          if (v > 2.2) scene.shake(Math.min(0.012, v * 0.0025));
        } else sound.play('cushion', (e.v ?? 1) / 4);
      }
      if (controls.camMode === 'aim') scene.follow(sim.frames[i].find((b) => b.id === 0 && !b.pocketed) ?? null);
      if (i < sim.frames.length - 1) return requestAnimationFrame(frame);
      animating = false;
      scene.follow(null);
      const next = queued ?? room;
      queued = null;
      if (next) applyState(next);
    };
    // primeiro o taco bate na branca; só então as bolas andam
    void scene.strike(Math.atan2(m.shot.dy, m.shot.dx), skip ? 0 : power).then(() => {
      sound.play('cue', power);
      buzz(12 + power * 20);
      if (power > 0.7) scene.shake(0.006 * power);
      requestAnimationFrame(frame);
    });
  }

  // vibração curta no celular (onde existir)
  function buzz(ms: number) {
    try {
      navigator.vibrate?.(ms);
    } catch {
      // sem vibração
    }
  }

  function onMsg(m: ServerMsg) {
    if (m.t === 'state') {
      you = m.you;
      if (animating) queued = m.room;
      else applyState(m.room);
    } else if (m.t === 'shot') animate(m);
    else if (m.t === 'aim') {
      if (m.seat !== you.seat) view?.controls.showAim(m);
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

