import { isMode } from '../shared/rules/index.ts';

export { Lobby } from './lobby.ts';
export { Room } from './room-do.ts';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => LETTERS[b % LETTERS.length]).join('');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby'));

    if (url.pathname === '/api/health') return new Response('ok');

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
      if (!isMode(body?.mode)) return new Response('modo inválido', { status: 400 });
      let id = newCode();
      while (await lobby.has(id)) id = newCode();
      await env.ROOM.get(env.ROOM.idFromName(id)).init(id, body.mode);
      return Response.json({ id });
    }

    const isUpgrade = req.headers.get('Upgrade') === 'websocket';
    if (url.pathname === '/ws/lobby' && isUpgrade) return lobby.fetch(req);

    const room = url.pathname.match(/^\/ws\/room\/([A-Z]{4})$/);
    if (room && isUpgrade) return env.ROOM.get(env.ROOM.idFromName(room[1])).fetch(req);

    return new Response('não encontrado', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
