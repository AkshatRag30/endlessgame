import { DurableObject } from "cloudflare:workers";
import {
  applySettings, BOT_NAMES, cleanName, CONFIG, DEFAULT_SETTINGS, encode, minPlayersToStart, parseClientMessage, SUIT_COLORS,
  type Accessory, type ClientMessage, type ErrorCode, type LobbyPlayer, type ServerMessage, type Settings,
} from "@glitch/shared";
import type { Env } from "./env";
import { Match } from "./match";

/**
 * One instance per room (PRD section 10). Owns the lobby and, during a
 * match, runs the 20 tick simulation. Sockets use the standard accept()
 * API rather than hibernation because the room keeps live state in memory.
 */

interface Seat {
  id: string;
  token: string;
  name: string;
  color: number;
  accessory: Accessory;
  ready: boolean;
  bot: boolean;
  ws: WebSocket | null;
  connected: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

interface Conn { seatId: string | null; tokens: number; at: number }

const randomId = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export class RoomServer extends DurableObject<Env> {
  private code = "";
  private seats = new Map<string, Seat>();
  private conns = new Map<WebSocket, Conn>();
  private hostId: string | null = null;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private match: Match | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.code = url.searchParams.get("room") ?? this.code;
    const created = (await this.ctx.storage.get<boolean>("created")) === true;

    if (url.pathname === "/init") {
      if (created) return new Response("taken", { status: 409 });
      await this.ctx.storage.put("created", true);
      await this.ctx.storage.setAlarm(Date.now() + CONFIG.room.emptyRoomCloseMs);
      this.log("room_created", {});
      return Response.json({ ok: true });
    }

    if (url.pathname === "/info") {
      return Response.json({ exists: created, players: this.seats.size, inMatch: this.match !== null });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    if (!created) {
      server.send(encode({ t: "error", code: "room_not_found" }));
      server.close(4004, "room not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    const conn: Conn = { seatId: null, tokens: CONFIG.net.msgBurst, at: Date.now() };
    this.conns.set(server, conn);
    server.addEventListener("message", (ev) => this.onMessage(server, conn, ev.data));
    server.addEventListener("close", () => this.onClose(server, conn));
    server.addEventListener("error", () => this.onClose(server, conn));
    await this.ctx.storage.deleteAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Rooms close after 10 minutes with nobody connected (PRD section 9). */
  override async alarm(): Promise<void> {
    const anyone = [...this.seats.values()].some((s) => !s.bot && s.connected);
    if (anyone) return;
    this.stopTicking();
    this.match = null;
    this.seats.clear();
    this.hostId = null;
    await this.ctx.storage.deleteAll();
    this.log("room_closed", {});
  }

  // ---- Socket plumbing ----------------------------------------------------

  private send(ws: WebSocket | null, msg: ServerMessage): void {
    if (!ws) return;
    try { ws.send(encode(msg)); } catch { /* closed; close handler cleans up */ }
  }

  private sendSeat(id: string, msg: ServerMessage): void {
    const seat = this.seats.get(id);
    if (seat?.connected) this.send(seat.ws, msg);
  }

  private error(ws: WebSocket, code: ErrorCode): void {
    this.send(ws, { t: "error", code });
  }

  private rateOk(conn: Conn): boolean {
    const now = Date.now();
    conn.tokens = Math.min(CONFIG.net.msgBurst, conn.tokens + ((now - conn.at) / 1000) * CONFIG.net.msgRatePerS);
    conn.at = now;
    if (conn.tokens < 1) return false;
    conn.tokens--;
    return true;
  }

  private onMessage(ws: WebSocket, conn: Conn, raw: unknown): void {
    if (!this.rateOk(conn)) return;
    const msg = parseClientMessage(raw);
    if (!msg) return this.error(ws, "bad_message");

    if (msg.t === "ping") {
      const peers = [...this.seats.values()].filter((s) => s.connected && !s.bot).length;
      return this.send(ws, { t: "pong", id: msg.id, sentAt: msg.sentAt, serverTime: Date.now(), peers });
    }
    if (msg.t === "hello") return this.onHello(ws, conn, msg);

    const seat = conn.seatId ? this.seats.get(conn.seatId) : undefined;
    if (!seat || seat.ws !== ws) return this.error(ws, "not_allowed");
    this.onSeatMessage(seat, msg);
  }

  private onHello(ws: WebSocket, conn: Conn, msg: Extract<ClientMessage, { t: "hello" }>): void {
    // Reconnect: the token from local storage gets the same seat back, role intact.
    const existing = msg.token ? [...this.seats.values()].find((s) => s.token === msg.token && !s.bot) : undefined;
    if (existing) {
      if (existing.ws && existing.ws !== ws) {
        const old = this.conns.get(existing.ws);
        if (old) old.seatId = null;
        try { existing.ws.close(4000, "replaced"); } catch { /* ignore */ }
      }
      existing.ws = ws;
      existing.connected = true;
      if (existing.graceTimer) clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
      conn.seatId = existing.id;
      this.send(ws, { t: "welcome", you: existing.id, token: existing.token, room: this.code, protocol: CONFIG.protocolVersion });
      this.broadcastLobby();
      this.match?.resync(existing.id);
      this.log("reconnect", { id: existing.id });
      return;
    }

    if (this.match) return this.error(ws, "in_progress");
    if (this.seats.size >= this.settings.maxPlayers) return this.error(ws, "room_full");

    const id = randomId(3);
    const seat: Seat = {
      id, token: randomId(16), name: cleanName(msg.name), color: this.freeColor(msg.color), accessory: msg.accessory,
      ready: false, bot: false, ws, connected: true, graceTimer: null,
    };
    this.seats.set(id, seat);
    conn.seatId = id;
    if (!this.hostId) this.hostId = id;
    this.send(ws, { t: "welcome", you: id, token: seat.token, room: this.code, protocol: CONFIG.protocolVersion });
    this.broadcastLobby();
    this.log("join", { id, players: this.seats.size });
  }

  private onClose(ws: WebSocket, conn: Conn): void {
    this.conns.delete(ws);
    const seat = conn.seatId ? this.seats.get(conn.seatId) : undefined;
    if (!seat || seat.ws !== ws) return;
    seat.connected = false;
    seat.ws = null;
    this.match?.disconnected(seat.id);
    seat.graceTimer = setTimeout(() => this.dropSeat(seat.id), CONFIG.room.reconnectGraceMs);
    this.broadcastLobby();
    this.log("disconnect", { id: seat.id });
    if (![...this.seats.values()].some((s) => !s.bot && s.connected)) {
      void this.ctx.storage.setAlarm(Date.now() + CONFIG.room.emptyRoomCloseMs);
    }
  }

  /** Reconnect window ran out. */
  private dropSeat(id: string): void {
    const seat = this.seats.get(id);
    if (!seat || seat.connected) return;
    this.seats.delete(id);
    this.match?.leave(id);
    if (this.hostId === id) this.pickHost();
    if (![...this.seats.values()].some((s) => !s.bot)) {
      // Only bots left: stop simulating and clear them.
      this.stopTicking();
      this.match = null;
      this.seats.clear();
    }
    this.broadcastLobby();
  }

  private pickHost(): void {
    const next = [...this.seats.values()].find((s) => !s.bot && s.connected) ?? [...this.seats.values()].find((s) => !s.bot);
    this.hostId = next?.id ?? null;
  }

  private freeColor(wanted: number, except?: string): number {
    const taken = new Set([...this.seats.values()].filter((s) => s.id !== except).map((s) => s.color));
    if (!taken.has(wanted)) return wanted;
    return SUIT_COLORS.findIndex((_, i) => !taken.has(i));
  }

  // ---- Lobby and match control ----------------------------------------------

  private lobbyPlayers(): LobbyPlayer[] {
    return [...this.seats.values()].map((s) => ({
      id: s.id, name: s.name, color: s.color, accessory: s.accessory, ready: s.ready || s.bot,
      host: s.id === this.hostId, bot: s.bot, connected: s.connected || s.bot,
    }));
  }

  private broadcastLobby(): void {
    const msg: ServerMessage = {
      t: "lobby", phase: this.match ? "match" : "lobby", host: this.hostId ?? "", players: this.lobbyPlayers(), settings: this.settings,
    };
    for (const s of this.seats.values()) if (!s.bot && s.connected) this.send(s.ws, msg);
  }

  private onSeatMessage(seat: Seat, msg: ClientMessage): void {
    const isHost = seat.id === this.hostId;
    const now = Date.now();

    switch (msg.t) {
      case "lobbySet":
        if (this.match) return;
        if (msg.color !== null) seat.color = this.freeColor(msg.color, seat.id);
        if (msg.accessory !== null) seat.accessory = msg.accessory;
        if (msg.ready !== null) seat.ready = msg.ready;
        return this.broadcastLobby();

      case "settings":
        if (!isHost) return this.error(seat.ws!, "not_host");
        if (this.match) return;
        this.settings = applySettings(this.settings, msg.patch);
        return this.broadcastLobby();

      case "kick": {
        if (!isHost) return this.error(seat.ws!, "not_host");
        const target = this.seats.get(msg.id);
        if (!target || target.id === seat.id || this.match) return;
        this.send(target.ws, { t: "kicked" });
        try { target.ws?.close(4001, "kicked"); } catch { /* ignore */ }
        if (target.graceTimer) clearTimeout(target.graceTimer);
        this.seats.delete(target.id);
        this.log("kick", { id: target.id });
        return this.broadcastLobby();
      }

      case "addBot": {
        if (!isHost) return this.error(seat.ws!, "not_host");
        if (this.match || this.seats.size >= this.settings.maxPlayers) return;
        const used = new Set([...this.seats.values()].map((s) => s.name));
        const name = BOT_NAMES.map((n) => `${n} (bot)`).find((n) => !used.has(n)) ?? "Bot";
        const id = randomId(3);
        this.seats.set(id, {
          id, token: "", name, color: this.freeColor(Math.floor(Math.random() * SUIT_COLORS.length)),
          accessory: "none", ready: true, bot: true, ws: null, connected: true, graceTimer: null,
        });
        return this.broadcastLobby();
      }

      case "removeBot": {
        if (!isHost || this.match) return;
        const bot = [...this.seats.values()].reverse().find((s) => s.bot);
        if (bot) this.seats.delete(bot.id);
        return this.broadcastLobby();
      }

      case "start": {
        if (!isHost) return this.error(seat.ws!, "not_host");
        if (this.match) return;
        const seats = [...this.seats.values()];
        if (seats.length < minPlayersToStart(this.settings)) return this.error(seat.ws!, "too_few_players");
        if (seats.some((s) => !s.bot && s.id !== this.hostId && (!s.ready || !s.connected))) return this.error(seat.ws!, "not_allowed");
        return this.startMatch(now);
      }

      case "rematch":
        if (!isHost || !this.match || this.match.phase !== "over") return;
        this.match = null;
        this.stopTicking();
        for (const s of this.seats.values()) s.ready = s.bot;
        return this.broadcastLobby();

      default:
        this.match?.handle(seat.id, msg, now);
    }
  }

  private startMatch(now: number): void {
    const seats = [...this.seats.values()];
    this.match = new Match({
      seats: seats.map((s) => ({ id: s.id, name: s.name, color: s.color, accessory: s.accessory, bot: s.bot })),
      settings: this.settings,
      now,
      send: (id, msg) => this.sendSeat(id, msg),
      onOver: () => this.stopTicking(),
      log: (event, data) => this.log(event, data),
    });
    this.broadcastLobby();
    this.stopTicking();
    this.tickTimer = setInterval(() => this.match?.step(Date.now()), 1000 / CONFIG.net.tickRate);
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /** Analytics events (PRD section 14) go to Workers logs as JSON lines. */
  private log(event: string, data: Record<string, unknown>): void {
    console.log(JSON.stringify({ event, room: this.code, ...data }));
  }
}
