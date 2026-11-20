import { CONFIG, generateRoomCode, isValidRoomCode, normalizeRoomCode } from "@glitch/shared";
import type { Env } from "./env";

export { RoomServer } from "./room";
export type { Env } from "./env";

/** Best effort per isolate limit on room creation (PRD section 11). */
const createLog = new Map<string, number[]>();
function createAllowed(ip: string): boolean {
  const now = Date.now();
  const recent = (createLog.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= CONFIG.room.roomCreatePerMinutePerIp) return false;
  recent.push(now);
  createLog.set(ip, recent);
  if (createLog.size > 5000) createLog.clear();
  return true;
}

function originAllowed(request: Request, env: Env): boolean {
  const list = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const origin = request.headers.get("Origin");
  return origin !== null && list.includes(origin);
}

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "glitch-station-server", protocol: CONFIG.protocolVersion });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (!originAllowed(request, env)) return new Response("Forbidden", { status: 403 });
      if (!createAllowed(request.headers.get("CF-Connecting-IP") ?? "local")) {
        return Response.json({ error: "rate_limited" }, { status: 429 });
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateRoomCode();
        const res = await roomStub(env, code).fetch(`https://room/init?room=${code}`, { method: "POST" });
        if (res.ok) return Response.json({ code });
      }
      return Response.json({ error: "busy" }, { status: 503 });
    }

    const info = url.pathname.match(/^\/api\/rooms\/([A-Za-z]{4})$/);
    if (info && request.method === "GET") {
      const code = normalizeRoomCode(info[1]!);
      if (!isValidRoomCode(code)) return Response.json({ exists: false });
      return roomStub(env, code).fetch(`https://room/info?room=${code}`);
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      if (!originAllowed(request, env)) return new Response("Forbidden", { status: 403 });
      const room = normalizeRoomCode(url.searchParams.get("room") ?? "");
      if (!isValidRoomCode(room)) return new Response("Invalid room code", { status: 400 });
      const forwarded = new URL(request.url);
      forwarded.searchParams.set("room", room);
      return roomStub(env, room).fetch(new Request(forwarded, request));
    }

    // Everything else is the game client itself.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
