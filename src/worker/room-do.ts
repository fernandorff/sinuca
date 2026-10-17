import { DurableObject } from 'cloudflare:workers';
import { parseClientMessage, type ServerMsg } from '../shared/protocol.ts';
import { FALLBACK_MS, createRoom, reduce, type Input, type Out, type RoomState } from '../shared/room.ts';

const EMPTY_MS = 10 * 60 * 1000;

type Attachment = { playerId: string | null };

// Casca de uma mesa: entrega as mensagens, grava o estado e cuida dos alarmes. As regras ficam em room.ts.
export class Room extends DurableObject<Env> {
  private state: RoomState | null | undefined; // undefined = ainda não leu do disco

  private async load(): Promise<RoomState | null> {
    if (this.state === undefined) this.state = (await this.ctx.storage.get<RoomState>('state')) ?? null;
    return this.state;
  }

  private lobby() {
    return this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
  }

  private playerOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.playerId ?? null;
  }

  private live(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && this.playerOf(ws) !== null);
  }

  async init(id: string) {
    if (await this.load()) return;
    await this.commit(createRoom(id, Date.now()));
  }

  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const msg = typeof raw === 'string' ? parseClientMessage(raw) : null;
    if (!msg) return send(ws, { t: 'error', code: 'bad_msg', msg: 'Mensagem inválida.' });

    if (msg.t === 'hello') {
      ws.serializeAttachment({ playerId: msg.playerId } satisfies Attachment);
      // a mesma pessoa em outra aba: a antiga é avisada e fechada
      for (const other of this.live(ws)) {
        if (this.playerOf(other) !== msg.playerId) continue;
        send(other, { t: 'error', code: 'other_tab', msg: 'Mesa aberta em outra aba.' });
        other.serializeAttachment({ playerId: null } satisfies Attachment);
        other.close(4000, 'other_tab');
      }
    }
    const playerId = this.playerOf(ws);
    if (!playerId) return send(ws, { t: 'error', code: 'bad_msg', msg: 'Envie hello primeiro.' });
    await this.step({ kind: 'msg', playerId, msg });
  }

  async webSocketClose(ws: WebSocket) {
    const playerId = this.playerOf(ws);
    // só desconecta se a pessoa não tem outra aba aberta nesta mesa
    if (!playerId || this.live(ws).some((o) => this.playerOf(o) === playerId)) return;
    if (!(await this.load())) return;
    await this.step({ kind: 'disconnect', playerId }, ws);
  }

  async alarm() {
    const s = await this.load();
    if (!s) return;
    const now = Date.now();
    const emptySince = await this.ctx.storage.get<number>('emptySince');
    if (this.live().length === 0 && emptySince !== undefined && now - emptySince >= EMPTY_MS) {
      await this.lobby().remove(s.id);
      await this.ctx.storage.deleteAll();
      this.state = null;
      return;
    }
    await this.step({ kind: 'tick' });
    await this.schedule();
  }

  private async step(input: Input, closing?: WebSocket) {
    const before = await this.load();
    const { state, out } = reduce(before, input, Date.now());
    this.deliver(out, closing);
    if (state && state !== before) await this.commit(state, closing);
  }

  private deliver(out: Out[], closing?: WebSocket) {
    const sockets = this.live(closing);
    for (const o of out) {
      for (const ws of sockets) if (o.to === 'all' || this.playerOf(ws) === o.to) send(ws, o.msg);
    }
  }

  private async commit(state: RoomState, closing?: WebSocket) {
    const before = this.state;
    this.state = state;
    await this.ctx.storage.put('state', state);
    const players = state.seats.filter(Boolean).length;
    if (!before || before.phase !== state.phase || before.seats.filter(Boolean).length !== players) {
      await this.lobby().upsert({ id: state.id, mode: state.mode, players, phase: state.phase });
    }
    await this.schedule(closing);
  }

  // um Durable Object tem um alarme só: aponta para o prazo mais próximo
  private async schedule(closing?: WebSocket) {
    const s = this.state;
    const now = Date.now();
    let emptySince = await this.ctx.storage.get<number>('emptySince');
    if (this.live(closing).length > 0) {
      if (emptySince !== undefined) await this.ctx.storage.delete('emptySince');
      emptySince = undefined;
    } else if (emptySince === undefined) {
      emptySince = now;
      await this.ctx.storage.put('emptySince', now);
    }
    const deadlines: number[] = [];
    if (s?.pending) deadlines.push(s.pending.shotAt + FALLBACK_MS);
    if (emptySince !== undefined) deadlines.push(emptySince + EMPTY_MS);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }
}

function send(ws: WebSocket, msg: ServerMsg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket já fechado
  }
}
