// Mira, força, efeito e bola na mão. Toque e mouse pelos Pointer Events.
import type { Shot } from '../shared/physics.ts';
import type { GameScene } from './scene.ts';

export type ControlOpts = {
  ballInHand: 'anywhere' | 'kitchen' | null;
  cue: { x: number; y: number };
  cueValid: (p: { x: number; y: number }) => boolean;
};

export function createControls(
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  scene: GameScene,
  cb: {
    onAim(angle: number): void;
    onShoot(shot: Shot, cue?: { x: number; y: number }): void;
    onMoveCue(pos: { x: number; y: number }, valid: boolean): void;
  },
) {
  let opts: ControlOpts | null = null;
  let angle = 0;
  let spinX = 0;
  let spinY = 0;
  let camMode: 'top' | 'aim' = 'top';
  let placing = false;
  let placed: { x: number; y: number } | null = null;
  let lastAimSent = 0;

  root.innerHTML = `
    <div class="ctl-power" id="power" aria-label="Força: arraste para baixo e solte"><div class="ctl-power-fill" id="power-fill"></div><span>Força</span></div>
    <div class="ctl-spin" id="spin" aria-label="Efeito na branca"><div class="ctl-spin-dot" id="spin-dot"></div></div>
    <div class="ctl-buttons">
      <button id="cam" type="button">Vista de mira</button>
      <button id="move" type="button" hidden>Mover branca</button>
    </div>`;
  const $ = (id: string) => root.querySelector<HTMLElement>('#' + id)!;
  const power = $('power');
  const fill = $('power-fill');
  const spin = $('spin');
  const dot = $('spin-dot');
  const camBtn = $('cam') as HTMLButtonElement;
  const moveBtn = $('move') as HTMLButtonElement;

  const cuePos = () => placed ?? opts?.cue ?? null;

  function sendAim() {
    scene.setCue(!!opts, angle, 0);
    const now = performance.now();
    if (now - lastAimSent > 100) {
      lastAimSent = now;
      cb.onAim(angle);
    }
  }

  // mira: na vista de cima, aponta para onde o dedo está; na vista de mira, arrastar gira
  let dragX: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!opts) return;
    canvas.setPointerCapture(e.pointerId);
    dragX = e.clientX;
    pointerAt(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!opts || dragX === null) return;
    if (camMode === 'aim' && !placing) {
      angle += (e.clientX - dragX) * 0.003;
      dragX = e.clientX;
      if (camMode === 'aim') scene.setCamera('aim', angle);
      sendAim();
    } else pointerAt(e);
  });
  canvas.addEventListener('pointerup', () => (dragX = null));

  function pointerAt(e: PointerEvent) {
    const p = scene.pickTable(e.clientX, e.clientY);
    if (!p || !opts) return;
    if (placing) {
      placed = p;
      cb.onMoveCue(p, opts.cueValid(p));
      scene.setCue(true, angle, 0);
      return;
    }
    if (camMode !== 'top') return;
    const c = cuePos();
    if (!c || (p.x === c.x && p.y === c.y)) return;
    angle = Math.atan2(p.y - c.y, p.x - c.x);
    sendAim();
  }

  // força: arrastar para baixo carrega, soltar taca
  let pullStart: number | null = null;
  let pull = 0;
  power.addEventListener('pointerdown', (e) => {
    if (!opts) return;
    power.setPointerCapture(e.pointerId);
    pullStart = e.clientY;
    pull = 0;
  });
  power.addEventListener('pointermove', (e) => {
    if (pullStart === null) return;
    pull = Math.min(1, Math.max(0, (e.clientY - pullStart) / (power.clientHeight * 0.9)));
    fill.style.height = `${pull * 100}%`;
    scene.setCue(true, angle, pull);
  });
  power.addEventListener('pointerup', () => {
    if (pullStart === null || !opts) return;
    pullStart = null;
    fill.style.height = '0';
    scene.setCue(true, angle, 0);
    if (pull < 0.03) return;
    const cue = placed ?? undefined;
    if (cue && !opts.cueValid(cue)) return;
    // seno e cosseno só aqui, uma vez: a física recebe a direção pronta
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    const n = Math.sqrt(dx * dx + dy * dy);
    dx /= n;
    dy /= n;
    cb.onShoot({ dx, dy, power: pull, spinX, spinY }, cue);
  });

  // efeito: arrastar o ponto dentro do círculo (para cima = seguida, para baixo = puxada)
  function setSpin(e: PointerEvent) {
    const r = spin.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const d = Math.sqrt(x * x + y * y);
    if (d > 1) {
      x /= d;
      y /= d;
    }
    spinX = Math.abs(x) < 0.08 ? 0 : x;
    spinY = Math.abs(y) < 0.08 ? 0 : y;
    dot.style.left = `${50 + spinX * 40}%`;
    dot.style.top = `${50 - spinY * 40}%`;
  }
  spin.addEventListener('pointerdown', (e) => {
    spin.setPointerCapture(e.pointerId);
    setSpin(e);
  });
  spin.addEventListener('pointermove', (e) => {
    if (spin.hasPointerCapture(e.pointerId)) setSpin(e);
  });

  camBtn.addEventListener('click', () => {
    camMode = camMode === 'top' ? 'aim' : 'top';
    camBtn.textContent = camMode === 'top' ? 'Vista de mira' : 'Vista de cima';
    scene.setCamera(camMode, angle);
  });
  moveBtn.addEventListener('click', () => {
    placing = !placing;
    moveBtn.classList.toggle('on', placing);
    moveBtn.textContent = placing ? 'Pronto' : 'Mover branca';
  });

  return {
    enable(next: ControlOpts | null) {
      opts = next;
      placing = false;
      placed = null;
      root.classList.toggle('off', !next);
      moveBtn.hidden = !next?.ballInHand;
      moveBtn.classList.remove('on');
      moveBtn.textContent = 'Mover branca';
      scene.setCue(!!next, angle, 0);
      scene.setCamera(camMode, angle);
    },
    // espectadores veem a mira de quem está na vez
    showAim(a: number) {
      if (opts) return;
      scene.setCue(true, a, 0);
      if (camMode === 'aim') scene.setCamera('aim', a);
    },
    get camMode() {
      return camMode;
    },
  };
}
