// Mensagens entre o navegador e a mesa. A única validação do jogo fica aqui: formato e tamanho.
import { ITEMS, type Item, type Shot, type SimEvent } from './physics.ts';
import type { PublicRoom } from './room.ts';
import { MAX_SEATS } from './rules/index.ts';
import type { BallPos } from './table.ts';

export type ClientMsg =
  | { t: 'hello'; playerId: string; name: string }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'rerack' }
  | { t: 'reset' }
  | { t: 'kick'; seat: number }
  | { t: 'video'; id: string | null }
  | { t: 'timer'; seconds: number }
  | { t: 'join' }
  | { t: 'admit'; id: number }
  | { t: 'sit'; seat: number | null }
  | { t: 'aim'; angle: number; power: number; spinX: number; spinY: number; item: Item | null }
  | { t: 'shot'; shotNo: number; shot: Shot; cue?: { x: number; y: number } }
  | { t: 'result'; shotNo: number; final: BallPos[]; events: SimEvent[] };

export type ErrorCode = 'not_found' | 'other_tab' | 'not_your_turn' | 'bad_cue' | 'bad_start' | 'bad_msg' | 'kicked';

export type ServerMsg =
  // now = relógio do servidor no envio: cada tela acerta a contagem do tempo pela diferença com o próprio relógio
  | { t: 'state'; room: PublicRoom; you: { playerId: string; seat: number | null; voted: number[]; kicked: boolean; admitted: number[]; joinId: number | null }; now: number }
  | { t: 'shot'; shotNo: number; by: number; shot: Shot; balls: BallPos[] }
  | { t: 'aim'; seat: number; angle: number; power: number; spinX: number; spinY: number; item: Item | null }
  | { t: 'error'; code: ErrorCode; msg: string };

// limites de tempo por jogada que a mesa oferece (0 = sem limite)
export const TIMER_OPTIONS = [0, 15, 30, 45, 60, 90];

const MAX_RESULT = 64 * 1024;
const MAX_OTHER = 2 * 1024;
// snooker: branca + 15 vermelhas + 6 cores
const MAX_ID = 21;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isItem = (v: unknown): v is Item => ITEMS.includes(v as Item);
const int = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '').replace(/[<>]/g, '').trim().slice(0, 20);
  return name || 'Jogador';
}

function shot(v: unknown): Shot | null {
  if (!isObj(v)) return null;
  const { dx, dy, power, spinX, spinY, item } = v;
  if (!num(dx) || !num(dy) || !num(power) || !num(spinX) || !num(spinY)) return null;
  const dir = Math.sqrt(dx * dx + dy * dy);
  if (dir < 0.999 || dir > 1.001 || power < 0 || power > 1 || spinX * spinX + spinY * spinY > 1) return null;
  if (item === undefined || item === null) return { dx, dy, power, spinX, spinY };
  return isItem(item) ? { dx, dy, power, spinX, spinY, item } : null;
}

function ball(v: unknown): BallPos | null {
  if (!isObj(v) || !int(v.id, 0, MAX_ID) || !num(v.x) || !num(v.y) || typeof v.pocketed !== 'boolean') return null;
  return { id: v.id, x: v.x, y: v.y, pocketed: v.pocketed };
}

function event(v: unknown): SimEvent | null {
  if (!isObj(v) || !int(v.step, 0, 1e6)) return null;
  if (v.kind === 'hit' && int(v.a, 0, MAX_ID) && int(v.b, 0, MAX_ID)) return { step: v.step, kind: 'hit', a: v.a, b: v.b };
  if (v.kind === 'cushion' && int(v.ball, 0, MAX_ID)) return { step: v.step, kind: 'cushion', ball: v.ball };
  if (v.kind === 'pocket' && int(v.ball, 0, MAX_ID) && int(v.pocket, 0, 5))
    return { step: v.step, kind: 'pocket', ball: v.ball, pocket: v.pocket };
  return null;
}

function all<T>(list: unknown, max: number, parse: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(list) || list.length > max) return null;
  const out = list.map(parse);
  return out.every((x) => x !== null) ? (out as T[]) : null;
}

export function parseClientMessage(raw: string): ClientMsg | null {
  if (raw.length > MAX_RESULT) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  if (m.t !== 'result' && raw.length > MAX_OTHER) return null;

  switch (m.t) {
    case 'hello':
      if (typeof m.playerId !== 'string' || !/^[a-z0-9-]{8,40}$/.test(m.playerId)) return null;
      return { t: 'hello', playerId: m.playerId, name: cleanName(m.name) };
    case 'start':
    case 'rematch':
    case 'rerack':
    case 'reset':
    case 'join':
      return { t: m.t };
    case 'admit':
      return int(m.id, 1, 1e9) ? { t: 'admit', id: m.id } : null;
    case 'timer':
      return TIMER_OPTIONS.includes(m.seconds as number) ? { t: 'timer', seconds: m.seconds as number } : null;
    case 'video':
      return m.id === null || (typeof m.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(m.id)) ? { t: 'video', id: m.id as string | null } : null;
    case 'kick':
      return int(m.seat, 0, MAX_SEATS - 1) ? { t: 'kick', seat: m.seat } : null;
    case 'sit':
      return m.seat === null || int(m.seat, 0, MAX_SEATS - 1) ? { t: 'sit', seat: m.seat as number | null } : null;
    case 'aim': {
      // força e efeito vão junto para os outros verem o ajuste ao vivo; cliente antigo sem eles manda zero
      const { power = 0, spinX = 0, spinY = 0, item = null } = m;
      if (!num(m.angle) || !num(power) || !num(spinX) || !num(spinY)) return null;
      if (power < 0 || power > 1 || spinX * spinX + spinY * spinY > 1 || (item !== null && !isItem(item))) return null;
      return { t: 'aim', angle: m.angle, power, spinX, spinY, item: item as Item | null };
    }
    case 'shot': {
      const s = shot(m.shot);
      if (!s || !int(m.shotNo, 0, 1e9)) return null;
      if (m.cue === undefined) return { t: 'shot', shotNo: m.shotNo, shot: s };
      if (!isObj(m.cue) || !num(m.cue.x) || !num(m.cue.y)) return null;
      return { t: 'shot', shotNo: m.shotNo, shot: s, cue: { x: m.cue.x, y: m.cue.y } };
    }
    case 'result': {
      const final = all(m.final, MAX_ID + 1, ball);
      const events = all(m.events, 1000, event);
      if (!final || !events || !int(m.shotNo, 0, 1e9)) return null;
      return { t: 'result', shotNo: m.shotNo, final, events };
    }
    default:
      return null;
  }
}
