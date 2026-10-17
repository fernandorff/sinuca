// Telas em DOM: apelido, lobby, HUD da mesa e avisos.
import type { PublicRoom } from '../shared/room.ts';

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
      el('h1', {}, 'Sinuca'),
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
const MODES = [
  { id: 'eightball', label: 'Bola 8', ready: true },
  { id: 'free', label: 'Mesa livre', ready: false },
  { id: 'sinuca', label: 'Sinuca brasileira', ready: false },
  { id: 'snooker', label: 'Snooker', ready: false },
];
const PHASE: Record<string, string> = { waiting: 'esperando', aiming: 'jogando', rolling: 'jogando', over: 'fim de jogo' };

export function renderLobby(root: HTMLElement, name: string, rooms: RoomInfo[] | null, onCreate: (mode: string) => void, onRename: () => void) {
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
                el('span', {}, MODES.find((m) => m.id === r.mode)?.label ?? r.mode),
                el('span', { class: 'muted' }, `${r.players}/4 · ${PHASE[r.phase] ?? r.phase}`),
                el('a', { class: 'button', href: '#' + r.id }, r.phase === 'waiting' ? 'Entrar' : 'Assistir'),
              ),
            ),
          );
  root.replaceChildren(
    el(
      'div',
      { class: 'lobby' },
      el('header', {}, el('h1', {}, 'Sinuca'), el('button', { type: 'button', class: 'link', onclick: onRename }, `${name} · trocar`)),
      el('section', {}, el('h2', {}, 'Criar mesa'), el('div', { class: 'modes' }, ...MODES.map((m) =>
        el('button', { type: 'button', class: m.ready ? 'primary' : '', disabled: !m.ready, onclick: () => onCreate(m.id) }, m.label, !m.ready && el('small', {}, 'em breve')),
      ))),
      el('section', {}, el('h2', {}, 'Mesas abertas'), list),
    ),
  );
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

export function renderHud(
  root: HTMLElement,
  room: PublicRoom,
  you: { seat: number | null },
  online: boolean,
  status: string,
  act: { sit(seat: number | null): void; start(): void; rematch(): void; copy(): void; lobby(): void },
) {
  const g = room.game;
  const waiting = room.phase === 'waiting';
  const seatCount = g ? g.seats : 4;
  const seats = room.seats.slice(0, seatCount).map((s, i) => {
    const team = i % 2;
    const group = g?.groups[team];
    const turn = g && !room.rolling && room.phase === 'aiming' && g.turn === i;
    if (!s) {
      return el('li', { class: `seat empty team-${team}` }, waiting && you.seat !== i ? el('button', { type: 'button', onclick: () => act.sit(i) }, 'Sentar aqui') : 'livre');
    }
    return el(
      'li',
      { class: `seat team-${team}${turn ? ' turn' : ''}${i === you.seat ? ' me' : ''}` },
      el('span', { class: `dot ${s.connected ? 'on' : 'off'}`, title: s.connected ? 'conectado' : 'desconectado' }),
      el('b', {}, s.name),
      group && el('small', {}, GROUP[group]),
    );
  });
  const seated = room.seats.filter(Boolean).length;
  const winnerNames = g && g.winner !== null ? room.seats.filter((s, i) => s && i % 2 === g.winner).map((s) => s!.name).join(' e ') : '';

  root.replaceChildren(...[
    el(
      'div',
      { class: 'hud-top' },
      el('button', { type: 'button', class: 'link', onclick: act.lobby, 'aria-label': 'Voltar ao lobby' }, '‹ Lobby'),
      el('button', { type: 'button', class: 'code', onclick: act.copy, title: 'Copiar link da mesa' }, `${room.id} · copiar link`),
      el('span', { class: `dot ${online ? 'on' : 'off'}`, title: online ? 'conectado' : 'reconectando…' }),
    ),
    el('ul', { class: 'seats' }, ...seats),
    el('div', { class: 'status' }, status),
    waiting &&
      el(
        'div',
        { class: 'center-actions' },
        el('p', {}, seated === 2 || seated === 4 ? 'Todos prontos?' : 'A partida começa com 2 ou 4 jogadores sentados.'),
        you.seat !== null && el('button', { type: 'button', class: 'primary', disabled: !(seated === 2 || seated === 4), onclick: act.start }, 'Começar'),
        you.seat !== null && el('button', { type: 'button', onclick: () => act.sit(null) }, 'Assistir'),
        you.seat === null && el('p', { class: 'muted' }, 'Você está assistindo. Toque em "Sentar aqui" num lugar livre.'),
      ),
    room.phase === 'over' &&
      el('div', { class: 'center-actions' }, el('h2', {}, `${winnerNames} ${g?.seats === 4 ? 'venceram' : 'venceu'}!`), you.seat !== null && el('button', { type: 'button', class: 'primary', onclick: act.rematch }, 'Revanche')),
    you.seat === null && !waiting && el('div', { class: 'badge' }, 'assistindo'),
  ].filter((c): c is HTMLElement => !!c));
}
