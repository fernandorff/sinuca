// Telas em DOM: apelido, lobby, HUD da mesa e avisos.
import { MAX_SEATS, MODES, winnersOf, type GameState, type Mode } from '../shared/rules/index.ts';
import { ballOn } from '../shared/rules/sinuca.ts';
import { target, valueOf } from '../shared/rules/snooker.ts';
import { COLOR_NAME } from '../shared/log.ts';
import type { PublicRoom } from '../shared/room.ts';
import { ballLook } from './look.ts';
import { TRACKS, type TrackId } from './music.ts';
import { CONTROLS, RULES } from './rules-text.ts';

type Child = Node | string | null | undefined | false;
export function el(tag: string, props: Record<string, any> = {}, ...children: Child[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

export function askName(root: HTMLElement, current: string): Promise<string> {
  return new Promise((resolve) => {
    const input = el('input', { id: 'name', maxlength: 20, placeholder: 'Seu apelido', value: current, autocomplete: 'nickname' }) as HTMLInputElement;
    const form = el(
      'form',
      { class: 'panel', onsubmit: (e: Event) => {
        e.preventDefault();
        const name = input.value.replace(/[<>]/g, '').trim();
        if (!name) return input.focus();
        overlay.remove();
        resolve(name);
      } },
      el('h1', {}, 'Sinuquinha do Pix'),
      el('label', { for: 'name' }, 'Como seus amigos te chamam?'),
      input,
      el('button', { type: 'submit', class: 'primary' }, 'Continuar'),
    );
    const overlay = el('div', { class: 'overlay' }, form);
    root.append(overlay);
    input.focus();
  });
}

export type RoomInfo = { id: string; mode: string; players: number; phase: string };
const PHASE: Record<string, string> = { waiting: 'esperando', aiming: 'jogando', rolling: 'jogando', over: 'fim de jogo' };
const modeLabel = (m: string) => (m in MODES ? MODES[m as Mode].label : m);

export function renderLobby(root: HTMLElement, name: string, rooms: RoomInfo[] | null, onCreate: (mode: Mode) => void, onRename: () => void) {
  const list =
    rooms === null
      ? el('p', { class: 'muted' }, 'Carregando mesas…')
      : rooms.length === 0
        ? el('p', { class: 'muted' }, 'Nenhuma mesa aberta. Crie uma e mande o link no grupo.')
        : el(
            'ul',
            { class: 'rooms' },
            ...rooms.map((r) =>
              el(
                'li',
                {},
                el('span', { class: 'code' }, r.id),
                el('span', {}, modeLabel(r.mode)),
                el('span', { class: 'muted' }, `${r.players}/${MAX_SEATS} · ${PHASE[r.phase] ?? r.phase}`),
                el('a', { class: 'button', href: '#' + r.id }, r.phase === 'waiting' ? 'Entrar' : 'Assistir'),
              ),
            ),
          );
  root.replaceChildren(
    el(
      'div',
      { class: 'lobby' },
      el(
        'header',
        { class: 'hero' },
        el('div', {}, el('h1', {}, 'Sinuquinha do Pix'), el('p', { class: 'muted' }, 'Mesa de bar com os amigos. Sem cadastro: crie a mesa e mande o link.')),
        el('button', { type: 'button', class: 'link', onclick: onRename }, `${name} · trocar`),
      ),
      el('section', {}, el('h2', {}, 'Criar mesa'), el('div', { class: 'modes' }, ...(Object.keys(MODES) as Mode[]).map((m) =>
        el(
          'div',
          { class: `mode-card mode-${m}` },
          el('b', {}, MODES[m].label),
          el('span', { class: 'muted' }, RULES[m].tagline),
          el('small', {}, seatsText(m)),
          el(
            'div',
            { class: 'mode-actions' },
            el('button', { type: 'button', class: 'primary', onclick: () => onCreate(m) }, 'Criar mesa'),
            el('button', { type: 'button', onclick: () => showRules(m) }, 'Regras'),
          ),
        ),
      ))),
      el('section', {}, el('h2', {}, 'Mesas abertas'), list),
    ),
  );
}

// "1, 2, 4, 6 ou 8 jogadores", "1 a 8 jogadores"
function seatsText(mode: Mode): string {
  const n = MODES[mode].seats;
  const contiguous = n.every((v, i) => i === 0 || v === n[i - 1] + 1);
  return `${contiguous ? `${n[0]} a ${n[n.length - 1]}` : `${n.slice(0, -1).join(', ')} ou ${n[n.length - 1]}`} jogadores`;
}

export function screen(root: HTMLElement, title: string, text: string, button: string, onClick: () => void) {
  root.replaceChildren(el('div', { class: 'overlay' }, el('div', { class: 'panel' }, el('h1', {}, title), el('p', {}, text), el('button', { type: 'button', class: 'primary', onclick: onClick }, button))));
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  let t = document.getElementById('toast');
  if (!t) document.body.append((t = el('div', { id: 'toast', role: 'status' })));
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove('show'), 3500);
}

const GROUP = { solids: 'lisas', stripes: 'listradas' };
// painel de jogadas aberto ou fechado: preferência de cada um, guardada no navegador
let logOpen = (() => {
  try {
    return localStorage.getItem('sinuca:log') === '1';
  } catch {
    return false;
  }
})();

// o que o jogador da vez precisa saber da regra, numa linha
export function targetText(g: GameState): string {
  if (g.mode === 'sinuca') {
    const on = ballOn(g.balls);
    if (on === null) return '';
    if (g.secondFree) return 'Tacada livre: qualquer bola vale';
    const base = `Bola da vez: ${COLOR_NAME[on]} (${on})`;
    return g.mustBallOn ? `${base}. Agora tem que ser nela` : base;
  }
  if (g.mode === 'snooker') {
    const t = target(g);
    if (t === 'red') return 'Alvo: uma vermelha';
    if (t === 'color') return 'Alvo: uma cor';
    return `Alvo: ${COLOR_NAME[valueOf(t)]} (${valueOf(t)})`;
  }
  return '';
}

export function renderHud(
  root: HTMLElement,
  room: PublicRoom,
  you: { seat: number | null },
  online: boolean,
  status: string,
  muted: boolean,
  animating: boolean,
  music: TrackId,
  act: { sit(seat: number | null): void; start(): void; rematch(): void; rerack(): void; reset(): void; copy(): void; lobby(): void; mute(): void; skip(): void; music(id: TrackId): void },
) {
  const g = room.game;
  const waiting = room.phase === 'waiting';
  const teams = room.mode === 'eightball';
  const seatCount = g ? g.seats : MAX_SEATS;
  const seats = room.seats.slice(0, seatCount).map((s, i) => {
    const team = teams ? ` team-${i % 2}` : '';
    const group = g?.mode === 'eightball' ? g.groups[i % 2] : null;
    const score = g && 'scores' in g ? g.scores[i] : null;
    const turn = g && !room.rolling && room.phase === 'aiming' && g.turn === i;
    if (!s) {
      return el('li', { class: `seat empty${team}` }, waiting && you.seat !== i ? el('button', { type: 'button', onclick: () => act.sit(i) }, 'Sentar aqui') : 'livre');
    }
    return el(
      'li',
      { class: `seat${team}${turn ? ' turn' : ''}${i === you.seat ? ' me' : ''}` },
      el('span', { class: `dot ${s.connected ? 'on' : 'off'}`, title: s.connected ? 'conectado' : 'desconectado' }),
      el('b', {}, s.name),
      group && el('small', {}, `${GROUP[group]} · faltam ${left(g!, group)}`),
      score !== null && el('span', { class: 'score' }, String(score)),
    );
  });
  const seated = room.seats.filter(Boolean).length;
  const canStart = MODES[room.mode].seats.includes(seated);
  const winners = g ? winnersOf(g) : null;
  const winnerNames = (winners ?? []).map((i) => room.seats[i]?.name).filter(Boolean).join(' e ');
  const rule = g && room.phase === 'aiming' ? targetText(g) : '';

  root.replaceChildren(...[
    el(
      'div',
      { class: 'hud-top' },
      el('button', { type: 'button', class: 'link', onclick: act.lobby, 'aria-label': 'Voltar ao lobby' }, '‹ Lobby'),
      el('button', { type: 'button', class: 'code', onclick: act.copy, title: 'Copiar link da mesa' }, `${room.id} · copiar link`),
      el('span', { class: `dot ${online ? 'on' : 'off'}`, title: online ? 'conectado' : 'reconectando…' }),
      el('button', { type: 'button', class: 'link', onclick: act.mute, 'aria-pressed': String(!muted) }, muted ? 'Som: desligado' : 'Som: ligado'),
      el('button', { type: 'button', class: 'link', onclick: () => showRules(room.mode) }, 'Regras'),
      el('button', { type: 'button', class: 'link', onclick: () => showRules(room.mode, true) }, 'Controles'),
      el(
        'button',
        {
          type: 'button',
          class: 'link',
          'aria-pressed': String(logOpen),
          onclick: () => {
            logOpen = !logOpen;
            try {
              localStorage.setItem('sinuca:log', logOpen ? '1' : '0');
            } catch {}
            renderHud(root, room, you, online, status, muted, animating, music, act);
          },
        },
        'Jogadas',
      ),
      !waiting && you.seat !== null && el('button', { type: 'button', class: 'link', onclick: act.reset, title: 'Volta para a espera: o placar zera e entra quem quiser' }, 'Nova partida'),
      el(
        'label',
        { class: 'music' },
        'Música ',
        el('select', { onchange: (e: Event) => act.music((e.target as HTMLSelectElement).value as TrackId) }, ...TRACKS.map((t) => el('option', { value: t.id, selected: t.id === music }, t.label))),
      ),
    ),
    el('div', { class: 'mode-name' }, MODES[room.mode].label),
    el('ul', { class: 'seats' }, ...seats),
    g && tray(room.mode, g),
    animating && el('button', { type: 'button', class: 'skip', onclick: act.skip }, 'Pular ⏭'),
    el('div', { class: 'status' }, status),
    logOpen &&
      el(
        'ol',
        { class: 'log', 'aria-label': 'Jogadas' },
        ...((room.log ?? []).length ? [...room.log].reverse().map((t) => el('li', {}, t)) : [el('li', { class: 'muted' }, 'Nenhuma jogada ainda.')]),
      ),
    rule && el('div', { class: 'status rule' }, rule),
    room.mode === 'free' && room.phase === 'aiming' && you.seat !== null && el('button', { type: 'button', class: 'rerack', onclick: act.rerack }, 'Arrumar mesa'),
    waiting &&
      el(
        'div',
        { class: 'center-actions' },
        el('p', {}, canStart ? 'Todos prontos?' : `${MODES[room.mode].label}: começa com ${seatsText(room.mode)} sentados.`),
        you.seat !== null && el('button', { type: 'button', class: 'primary', disabled: !canStart, onclick: act.start }, 'Começar'),
        you.seat !== null && el('button', { type: 'button', onclick: () => act.sit(null) }, 'Assistir'),
        you.seat === null && el('p', { class: 'muted' }, 'Você está assistindo. Toque em "Sentar aqui" num lugar livre.'),
      ),
    room.phase === 'over' &&
      el(
        'div',
        { class: 'center-actions victory' },
        el('h2', {}, winnerNames ? `${winnerNames} ${(winners?.length ?? 0) > 1 ? 'venceram' : 'venceu'}!` : 'Fim de jogo'),
        g && 'scores' in g && board(room, g.scores, winners ?? []),
        you.seat !== null && el('button', { type: 'button', class: 'primary', onclick: act.rematch }, 'Revanche'),
        you.seat !== null && el('button', { type: 'button', onclick: act.reset }, 'Nova partida (abrir lugares)'),
      ),
    you.seat === null && !waiting && el('div', { class: 'badge' }, 'assistindo'),
  ].filter((c): c is HTMLElement => !!c));
}

// quantas bolas do grupo ainda estão na mesa (bola 8)
function left(g: GameState, group: 'solids' | 'stripes'): number {
  return g.balls.filter((b) => !b.pocketed && (group === 'solids' ? b.id >= 1 && b.id <= 7 : b.id >= 9)).length;
}

// bandeja: as bolas que já caíram, na ordem do número
function tray(mode: Mode, g: GameState): HTMLElement | null {
  const down = g.balls.filter((b) => b.pocketed && b.id !== 0).sort((a, b) => a.id - b.id);
  if (!down.length) return null;
  return el(
    'div',
    { class: 'tray', 'aria-label': 'Bolas encaçapadas' },
    ...down.map((b) => {
      const { color, stripe, label } = ballLook(mode, b.id);
      const style = stripe ? `background: linear-gradient(#f4f1e8 0 28%, ${color} 28% 72%, #f4f1e8 72%)` : `background: ${color}`;
      return el('span', { class: 'mini', style, title: label || 'bola' }, label);
    }),
  );
}

// aviso grande e curto no meio da tela ("Sua vez!", "Falta!", "Na caçapa!")
export function banner(text: string, kind: 'turn' | 'foul' | 'good' = 'turn') {
  document.querySelector('.banner')?.remove();
  const b = el('div', { class: `banner ${kind}`, role: 'status' }, text);
  document.body.append(b);
  setTimeout(() => b.remove(), 1600);
}

// placar final, do maior para o menor
function board(room: PublicRoom, scores: number[], winners: number[]): HTMLElement {
  const rows = scores.map((pts, i) => ({ i, pts, name: room.seats[i]?.name ?? '—' })).sort((a, b) => b.pts - a.pts);
  return el('ul', { class: 'board' }, ...rows.map((r) => el('li', { class: winners.includes(r.i) ? 'win' : '' }, el('span', {}, r.name), el('b', {}, String(r.pts)))));
}

// menu de regras do modo, com os controles no fim; só os controles pelo botão Controles da mesa
export function showRules(mode: Mode, onlyControls = false) {
  document.querySelector('.rules-overlay')?.remove();
  const close = () => overlay.remove();
  const overlay = el(
    'div',
    { class: 'overlay rules-overlay', onclick: (e: Event) => e.target === overlay && close() },
    el(
      'div',
      { class: 'panel rules', role: 'dialog', 'aria-label': 'Regras de ' + MODES[mode].label },
      ...(onlyControls
        ? []
        : [
            el('h1', {}, MODES[mode].label),
            el('p', { class: 'muted' }, RULES[mode].tagline),
            el('h2', {}, 'Regras'),
            el('ul', {}, ...RULES[mode].items.map((t) => el('li', {}, t))),
          ]),
      el('h2', {}, 'Controles'),
      el('ul', {}, ...CONTROLS.map((t) => el('li', {}, t))),
      el('button', { type: 'button', class: 'primary', onclick: close }, 'Entendi'),
    ),
  );
  document.body.append(overlay);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);
}
