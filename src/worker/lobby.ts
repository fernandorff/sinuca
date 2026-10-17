import { DurableObject } from 'cloudflare:workers';

export type RoomInfo = { id: string; mode: 'eightball'; players: number; phase: string };

// Lista de mesas abertas: um único objeto ('lobby') que todo navegador na tela inicial escuta.
export class Lobby extends DurableObject<Env> {
  private async rooms(): Promise<Record<string, RoomInfo>> {
    return (await this.ctx.storage.get<Record<string, RoomInfo>>('rooms')) ?? {};
  }

  private async save(rooms: Record<string, RoomInfo>) {
    await this.ctx.storage.put('rooms', rooms);
    const msg = JSON.stringify({ t: 'rooms', rooms: Object.values(rooms) });
    for (const ws of this.ctx.getWebSockets()) ws.send(msg);
  }

  async upsert(info: RoomInfo) {
    const rooms = await this.rooms();
    rooms[info.id] = info;
    await this.save(rooms);
  }

  async remove(id: string) {
    const rooms = await this.rooms();
    delete rooms[id];
    await this.save(rooms);
  }

  async has(id: string): Promise<boolean> {
    return id in (await this.rooms());
  }

  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ t: 'rooms', rooms: Object.values(await this.rooms()) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage() {}
}
