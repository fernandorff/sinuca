// Vídeo do YouTube da mesa (pedido do Fernando, 17/10/2026): um por vez, todo mundo ouve, qualquer um troca ou tira.
// Usa o player oficial do YouTube (IFrame API); quem entra depois pega o vídeo no meio, pelo relógio de cada um.
type YTPlayer = { loadVideoById(o: { videoId: string; startSeconds: number }): void; stopVideo(): void; playVideo(): void; setVolume(v: number): void };
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, o: object) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// aceita link de vídeo, youtu.be, shorts, live, embed ou só o código de 11 caracteres
export function videoId(link: string): string | null {
  const t = link.trim();
  const m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/) ?? t.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

export function createVideo(host: HTMLElement) {
  let player: YTPlayer | null = null;
  let api: Promise<void> | null = null;
  let current: string | null = null;
  let volume = 40;
  const loadApi = () =>
    (api ??= new Promise<void>((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.append(s);
    }));

  return {
    async show(v: { id: string; startedAt: number } | null) {
      const key = v ? `${v.id}@${v.startedAt}` : null;
      if (key === current) return;
      current = key;
      host.hidden = !v;
      if (!v) return player?.stopVideo();
      await loadApi();
      if (current !== key) return;
      const startSeconds = Math.max(0, Math.floor((Date.now() - v.startedAt) / 1000));
      if (player) return player.loadVideoById({ videoId: v.id, startSeconds });
      const box = document.createElement('div');
      host.append(box);
      player = new window.YT!.Player(box, {
        width: '100%',
        height: '100%',
        videoId: v.id,
        playerVars: { autoplay: 1, start: startSeconds, playsinline: 1 },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            e.target.setVolume(volume);
            e.target.playVideo();
          },
        },
      });
    },
    // mesmo controle de volume da música (0 a 1)
    setVolume(v: number) {
      volume = Math.round(v * 100);
      player?.setVolume(volume);
    },
  };
}
