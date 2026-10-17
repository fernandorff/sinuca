// Mira, força, efeito e bola na mão. Toque e mouse pelos Pointer Events.
import type { Shot } from '../shared/physics.ts';
import type { GameScene } from './scene.ts';

export type ControlOpts = {
  ballInHand: 'anywhere' | 'kitchen' | 'd' | null;
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
  let power = 0.5;
  let spinX = 0;
  let spinY = 0;
  let camMode: 'top' | 'aim' = 'top';
  let placing = false;
  let placed: { x: number; y: number } | null = null;
  let lastAimSent = 0;

  root.innerHTML = `
    <div class="ctl-shoot">
      <div class="ctl-power" id="power" role="slider" tabindex="0" aria-label="Força" aria-valuemin="0" aria-valuemax="100">
        <div class="ctl-power-fill" id="power-fill"></div><span>Força<br><b id="power-pct"></b></span>
      </div>
      <button id="shoot" type="button" class="primary" title="Tacar (barra de espaço)">Tacar</button>
    </div>
    <div class="ctl-spin" id="spin" aria-label="Efeito na branca"><div class="ctl-spin-dot" id="spin-dot"></div></div>
    <div class="ctl-buttons">
      <button id="cam" type="button">Vista de mira</button>
      <button id="move" type="button" hidden>Mover branca</button>
    </div>`;
  const $ = (id: string) => root.querySelector<HTMLElement>('#' + id)!;
  const powerEl = $('power');
  const fill = $('power-fill');
  const pct = $('power-pct');
  const shootBtn = $('shoot') as HTMLButtonElement;
  const spin = $('spin');
  const dot = $('spin-dot');
  const camBtn = $('cam') as HTMLButtonElement;
  const moveBtn = $('move') as HTMLButtonElement;

  const cuePos = () => placed ?? opts?.cue ?? null;
  // o taco recua conforme a força escolhida
  const showCue = () => scene.setCue(!!opts, angle, power * 0.5);

  function sendAim() {
    showCue();
    const now = performance.now();
    if (now - lastAimSent > 100) {
      lastAimSent = now;
      cb.onAim(angle);
    }
  }

  // mira: na vista de cima, aponta para onde o dedo está; na vista de mira, arrastar para os lados gira
  let dragX: number | null = null;
  let dragCue = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!opts) return;
    canvas.setPointerCapture(e.pointerId);
    dragX = e.clientX;
    // com bola na mão, agarrar a branca (ou perto dela) já arrasta, sem o botão Mover branca
    const p = scene.pickTable(e.clientX, e.clientY);
    const c = cuePos();
    dragCue = !!opts.ballInHand && !!p && !!c && (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < 0.0049;
    pointerAt(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!opts || dragX === null) return;
    if (camMode === 'aim' && !placing && !dragCue) {
      angle += (e.clientX - dragX) * 0.003;
      dragX = e.clientX;
      scene.setCamera('aim', angle);
      sendAim();
    } else pointerAt(e);
  });
  canvas.addEventListener('pointerup', () => {
    dragX = null;
    dragCue = false;
  });

  function pointerAt(e: PointerEvent) {
    const p = scene.pickTable(e.clientX, e.clientY);
    if (!p || !opts) return;
    if (placing || dragCue) {
      placed = p;
      cb.onMoveCue(p, opts.cueValid(p));
      showCue();
      return;
    }
    if (camMode !== 'top') return;
    const c = cuePos();
    if (!c || (p.x === c.x && p.y === c.y)) return;
    angle = Math.atan2(p.y - c.y, p.x - c.x);
    sendAim();
  }

  // força: tocar ou arrastar na barra escolhe o nível (mais em baixo, mais forte) e ele fica marcado;
  // o botão Tacar dispara (decisão do Fernando de 17/10/2026)
  function setPower(p: number) {
    power = Math.min(1, Math.max(0.03, p));
    fill.style.height = `${power * 100}%`;
    pct.textContent = `${Math.round(power * 100)}%`;
    powerEl.setAttribute('aria-valuenow', String(Math.round(power * 100)));
    showCue();
  }
  function powerAt(e: PointerEvent) {
    const r = powerEl.getBoundingClientRect();
    setPower((e.clientY - r.top) / r.height);
  }
  powerEl.addEventListener('pointerdown', (e) => {
    powerEl.setPointerCapture(e.pointerId);
    powerAt(e);
  });
  powerEl.addEventListener('pointermove', (e) => {
    if (powerEl.hasPointerCapture(e.pointerId)) powerAt(e);
  });
  // rodinha do mouse: para baixo aumenta a força, como na barra (pedido do Fernando, 17/10/2026)
  window.addEventListener(
    'wheel',
    (e) => {
      if (!opts || e.deltaY === 0) return;
      e.preventDefault();
      setPower(power + (e.deltaY > 0 ? 0.03 : -0.03));
    },
    { passive: false },
  );
  powerEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') setPower(power + 0.05);
    if (e.key === 'ArrowUp') setPower(power - 0.05);
  });
  setPower(power);

  shootBtn.addEventListener('click', () => {
    if (!opts) return;
    const cue = placed ?? undefined;
    if (cue && !opts.cueValid(cue)) return;
    // seno e cosseno só aqui, uma vez: a física recebe a direção pronta
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    const n = Math.sqrt(dx * dx + dy * dy);
    dx /= n;
    dy /= n;
    cb.onShoot({ dx, dy, power, spinX, spinY }, cue);
  });

  // setas giram a mira de pouquinho (Shift: mais rápido) — mira fina no desktop
  window.addEventListener('keydown', (e) => {
    if (!opts || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || (e.target as HTMLElement | null)?.closest('input, textarea')) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.02 : 0.002) * (e.key === 'ArrowRight' ? 1 : -1);
    angle += step;
    if (camMode === 'aim') scene.setCamera('aim', angle);
    sendAim();
  });

  // barra de espaço taca, como o botão (pedido do Fernando, 17/10/2026); não vale digitando num campo
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || !opts || (e.target as HTMLElement | null)?.closest('input, textarea')) return;
    e.preventDefault();
    shootBtn.click();
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
      showCue();
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
