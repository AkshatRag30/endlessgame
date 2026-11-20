import { CONFIG, encode, parseServerMessage, type ClientMessage, type ServerMessage } from "@glitch/shared";

export type ConnectionState = "connecting" | "open" | "closed";

/** Picks the server endpoint: explicit env var if set, otherwise the same site that served the page. */
export function serverBase(): { http: string; ws: string } {
  const explicit = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (explicit) {
    const ws = new URL(explicit);
    const http = new URL(explicit);
    http.protocol = ws.protocol === "wss:" ? "https:" : "http:";
    http.pathname = "";
    return { http: http.origin, ws: ws.toString() };
  }
  return { http: location.origin, ws: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws` };
}

/**
 * Owns the socket to one room: reconnects with backoff, measures ping, and
 * hands every validated server message to the listener.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private pingTimer: number | undefined;
  private retryTimer: number | undefined;
  private retryDelay: number = CONFIG.net.reconnectMinMs;
  private nextPingId = 1;
  private stopped = false;
  state: ConnectionState = "connecting";
  rttMs: number | null = null;

  onMessage: (msg: ServerMessage) => void = () => {};
  onState: (state: ConnectionState) => void = () => {};
  /** Called on every (re)connect so the app can send hello with its token. */
  onOpen: () => void = () => {};

  constructor(private readonly room: string) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    this.ws?.close(1000, "leave");
    this.ws = null;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.onState(s);
  }

  private open(): void {
    this.setState("connecting");
    const url = new URL(serverBase().ws);
    url.searchParams.set("room", this.room);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.retryDelay = CONFIG.net.reconnectMinMs;
      this.setState("open");
      this.onOpen();
      this.ping();
      this.pingTimer = window.setInterval(() => this.ping(), CONFIG.net.pingIntervalMs);
    });

    ws.addEventListener("message", (event) => {
      const msg = parseServerMessage(event.data);
      if (!msg) return;
      if (msg.t === "pong") {
        const rtt = Math.max(0, performance.now() - msg.sentAt);
        this.rttMs = this.rttMs === null ? rtt : this.rttMs * 0.7 + rtt * 0.3;
      }
      if (msg.t === "kicked" || (msg.t === "error" && msg.code === "room_not_found")) this.stopped = true;
      this.onMessage(msg);
    });

    ws.addEventListener("close", () => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.setState("closed");
      if (!this.stopped) {
        const delay = this.retryDelay;
        this.retryDelay = Math.min(this.retryDelay * 2, CONFIG.net.reconnectMaxMs);
        this.retryTimer = window.setTimeout(() => this.open(), delay);
      }
    });
  }

  private ping(): void {
    this.send({ t: "ping", id: this.nextPingId++, sentAt: performance.now() });
  }
}

export async function createRoom(): Promise<string> {
  const res = await fetch(`${serverBase().http}/api/rooms`, { method: "POST" });
  if (res.status === 429) throw new Error("Too many rooms created. Wait a minute and try again.");
  if (!res.ok) throw new Error("Could not create a room. Is the server running?");
  const data = (await res.json()) as { code: string };
  return data.code;
}

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`${serverBase().http}/api/rooms/${code}`);
  if (!res.ok) return false;
  const data = (await res.json()) as { exists: boolean };
  return data.exists;
}
