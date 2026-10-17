import type { ClientMsg } from '../shared/protocol.ts';

const BACKOFF = [1000, 2000, 5000];

// WebSocket que se reconecta sozinho (o celular derruba a conexão quando a tela bloqueia)
export function connect(path: string, onMsg: (m: any) => void, onOpen: () => void, onStatus: (on: boolean) => void = () => {}) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
  let ws: WebSocket | null = null;
  let tries = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    clearTimeout(timer);
    if (stopped || (ws && ws.readyState <= WebSocket.OPEN)) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      tries = 0;
      onStatus(true);
      onOpen();
    };
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus(false);
      if (stopped) return;
      timer = setTimeout(open, BACKOFF[Math.min(tries++, BACKOFF.length - 1)]);
    };
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') open();
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
