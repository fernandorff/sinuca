// Aparência de cada bola por modo, usada pela mesa 3D e pela bandeja do HUD.
import type { Mode } from '../shared/rules/index.ts';
import { SNOOKER_COLOR_BASE } from '../shared/table.ts';

const POOL_COLORS = ['#f4f1e8', '#f2c230', '#1d4fb8', '#c8282b', '#5a2a86', '#e3711c', '#1c7a43', '#7a1f22', '#111111'];
// cores da sinuca pelo valor: 1 vermelha, 2 amarela, 3 verde, 4 marrom, 5 azul, 6 rosa, 7 preta
const SNOOKER_COLORS = ['#f4f1e8', '#c41e24', '#f2c230', '#1c7a43', '#6b3e1e', '#1d4fb8', '#f19bb5', '#111111'];

// pool: lisas, listradas e número; sinuca e snooker: bolas lisas, sem número
export function ballLook(mode: Mode, id: number): { color: string; stripe: boolean; label: string } {
  if (mode === 'sinuca') return { color: SNOOKER_COLORS[id], stripe: false, label: '' };
  // mata-mata: 1 a 4 vermelhas, 5 a 8 amarelas, lisas e sem número
  if (mode === 'matamata') return { color: id === 0 ? SNOOKER_COLORS[0] : id <= 4 ? SNOOKER_COLORS[1] : SNOOKER_COLORS[2], stripe: false, label: '' };
  if (mode === 'snooker' || mode === 'powers') return { color: SNOOKER_COLORS[id === 0 ? 0 : id <= 15 ? 1 : id - SNOOKER_COLOR_BASE], stripe: false, label: '' };
  return { color: POOL_COLORS[id <= 8 ? id : id - 8], stripe: id >= 9, label: id > 0 ? String(id) : '' };
}

