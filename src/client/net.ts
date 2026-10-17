import type { ClientMsg } from '../shared/protocol.ts';

const BACKOFF = [1000, 2000, 5000];
const PING_MS = 10_000;
// sem nenhuma mensagem (nem o 'pong') por esse tempo, a conexão está morta: abre outra
const DEAD_MS = 25_000;

// WebSocket que se reconecta sozinho (o celular derruba a conexão quando a tela bloqueia)
export function connect(path: string, onMsg: (m: any) => void, onOpen: () => void, onStatus: (on: boolean) => void = () => {}) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
  let ws: WebSocket | null = null;
  let tries = 0;
  let stopped = false;
  let lastSeen = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    clearTimeout(timer);
    if (stopped || (ws && ws.readyState <= WebSocket.OPEN)) return;
    const self = new WebSocket(url);
    ws = self;
    lastSeen = Date.now();
    // os handlers ignoram um socket que já foi trocado por outro
    self.onopen = () => {
      if (ws !== self) return;
      tries = 0;
      onStatus(true);
      onOpen();
    };
    self.onmessage = (e) => {
      if (ws !== self) return;
      lastSeen = Date.now();
      if (e.data !== 'pong') onMsg(JSON.parse(e.data));
    };
    self.onclose = () => {
      if (ws !== self) return;
      onStatus(false);
      if (stopped) return;
      timer = setTimeout(open, BACKOFF[Math.min(tries++, BACKOFF.length - 1)]);
    };
  }

  function replaceIfDead() {
    if (stopped || !ws || ws.readyState !== WebSocket.OPEN || Date.now() - lastSeen < DEAD_MS) return;
    const dead = ws;
    ws = null;
    dead.close();
    onStatus(false);
    open();
  }

  setInterval(() => {
    replaceIfDead();
    if (ws?.readyState === WebSocket.OPEN) ws.send('ping');
  }, PING_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    replaceIfDead();
    open();
  });
  open();

  return {
    send(m: ClientMsg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    status: (): 'on' | 'off' => (ws?.readyState === WebSocket.OPEN ? 'on' : 'off'),
    stop() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
