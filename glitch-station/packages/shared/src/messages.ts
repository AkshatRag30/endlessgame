import { CONFIG } from "./config";
import { isAccessory, SUIT_COLORS, type Accessory } from "./cosmetics";
import { ROOM_IDS, type RoomId } from "./map";
import { isQuickTemplate, type QuickTemplate, type Role, type Settings, type WinReason } from "./rules";
import { isTaskId, type TaskId, type TaskState } from "./tasks";

/**
 * Wire protocol. Clients only send intentions; the server owns the truth and
 * tells each client only what that client is allowed to know.
 */

export type SabotageKind = "blackout" | "meltdown" | "comms" | "doors";
export const SABOTAGE_KINDS: SabotageKind[] = ["blackout", "meltdown", "comms", "doors"];

export type ClientMessage =
  | { t: "ping"; id: number; sentAt: number }
  | { t: "hello"; name: string; color: number; accessory: Accessory; token: string | null }
  | { t: "lobbySet"; color: number | null; accessory: Accessory | null; ready: boolean | null }
  | { t: "settings"; patch: Record<string, number | boolean> }
  | { t: "kick"; id: string }
  | { t: "addBot" }
  | { t: "removeBot" }
  | { t: "start" }
  | { t: "input"; seq: number; dx: number; dy: number }
  | { t: "taskStart"; task: TaskId }
  | { t: "taskDone"; task: TaskId }
  | { t: "kill"; target: string }
  | { t: "report"; body: string }
  | { t: "emergency" }
  | { t: "sabotage"; kind: SabotageKind; room: RoomId | null }
  | { t: "fixStart"; kind: "blackout" | "comms" }
  | { t: "fixDone"; kind: "blackout" | "comms" }
  | { t: "hold"; panel: 0 | 1; on: boolean }
  | { t: "conduit" }
  | { t: "chat"; text: string }
  | { t: "quick"; tpl: QuickTemplate; args: string[] }
  | { t: "vote"; target: string }
  | { t: "flag"; id: string }
  | { t: "rematch" };

export interface LobbyPlayer {
  id: string; name: string; color: number; accessory: Accessory;
  ready: boolean; host: boolean; bot: boolean; connected: boolean;
}
export interface MatchPlayer { id: string; name: string; color: number; accessory: Accessory; bot: boolean }

export interface SabotageView { kind: SabotageKind; room: RoomId | null; endsIn: number | null }

/** Compact visible player: [id, x, y, ghost 0 or 1, moving 0 or 1]. */
export type SeenPlayer = [string, number, number, 0 | 1, 0 | 1];

export interface MeetingView {
  phase: "discussion" | "voting" | "result";
  endsIn: number;
  caller: string;
  reason: "report" | "emergency";
  victim: string | null;
  alive: string[];
  voted: string[];
  result: { ejected: string | null; role: Role | null; counts: Record<string, number> } | null;
}

export type ErrorCode =
  | "bad_message" | "protocol_mismatch" | "room_not_found" | "room_full" | "in_progress"
  | "not_host" | "too_few_players" | "rate_limited" | "not_allowed";

export type ServerMessage =
  | { t: "pong"; id: number; sentAt: number; serverTime: number; peers: number }
  | { t: "welcome"; you: string; token: string; room: string; protocol: number }
  | { t: "lobby"; phase: "lobby" | "match"; host: string; players: LobbyPlayer[]; settings: Settings }
  | { t: "matchStart"; players: MatchPlayer[]; role: Role; partners: string[]; tasks: TaskState[]; settings: Settings }
  | {
      t: "snap"; tick: number; ack: number;
      me: { x: number; y: number; ghost: boolean };
      others: SeenPlayer[];
      bodies: { id: string; victim: string; x: number; y: number }[];
      bar: number | null;
      sab: SabotageView | null;
      cd: { kill: number; sab: number; emer: number; emerLeft: number };
      doors: RoomId[];
      held: [boolean, boolean];
    }
  | { t: "tasks"; list: TaskState[] }
  | { t: "fx"; kind: "conduit" | "task" | "kill"; x: number; y: number }
  | { t: "meeting"; meeting: MeetingView | null }
  | { t: "chat"; from: string; text: string; ghost: boolean }
  | { t: "over"; winner: Role; reason: WinReason; roles: Record<string, Role> }
  | { t: "died"; how: "eliminated" | "ejected" }
  | { t: "error"; code: ErrorCode }
  | { t: "kicked" };

// ---- Validation ----------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max = 64): v is string => typeof v === "string" && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isColor = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < SUIT_COLORS.length;
const isRoom = (v: unknown): v is RoomId => typeof v === "string" && (ROOM_IDS as string[]).includes(v);

/**
 * Parses and validates a raw client frame. Anything malformed returns null,
 * and only known fields are copied, so the server never trusts socket data.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > CONFIG.net.maxMessageBytes) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;

  switch (m.t) {
    case "ping":
      return isNum(m.id) && isNum(m.sentAt) ? { t: "ping", id: m.id, sentAt: m.sentAt } : null;
    case "hello":
      if (!isStr(m.name, 40) || !isColor(m.color) || !isAccessory(m.accessory)) return null;
      if (m.token !== null && !isStr(m.token, 64)) return null;
      return { t: "hello", name: m.name, color: m.color, accessory: m.accessory, token: m.token as string | null };
    case "lobbySet":
      if (m.color !== null && !isColor(m.color)) return null;
      if (m.accessory !== null && !isAccessory(m.accessory)) return null;
      if (m.ready !== null && !isBool(m.ready)) return null;
      return { t: "lobbySet", color: m.color as number | null, accessory: m.accessory as Accessory | null, ready: m.ready as boolean | null };
    case "settings": {
      if (typeof m.patch !== "object" || m.patch === null || Array.isArray(m.patch)) return null;
      const patch: Record<string, number | boolean> = {};
      for (const [k, v] of Object.entries(m.patch as Record<string, unknown>).slice(0, 20)) {
        if (isNum(v) || isBool(v)) patch[k] = v;
      }
      return { t: "settings", patch };
    }
    case "kick": return isStr(m.id, 16) ? { t: "kick", id: m.id } : null;
    case "addBot": return { t: "addBot" };
    case "removeBot": return { t: "removeBot" };
    case "start": return { t: "start" };
    case "input":
      if (!Number.isInteger(m.seq) || !isNum(m.dx) || !isNum(m.dy)) return null;
      if (Math.abs(m.dx) > 1.01 || Math.abs(m.dy) > 1.01) return null;
      return { t: "input", seq: m.seq as number, dx: m.dx, dy: m.dy };
    case "taskStart": return isTaskId(m.task) ? { t: "taskStart", task: m.task } : null;
    case "taskDone": return isTaskId(m.task) ? { t: "taskDone", task: m.task } : null;
    case "kill": return isStr(m.target, 16) ? { t: "kill", target: m.target } : null;
    case "report": return isStr(m.body, 16) ? { t: "report", body: m.body } : null;
    case "emergency": return { t: "emergency" };
    case "sabotage":
      if (!(SABOTAGE_KINDS as unknown[]).includes(m.kind)) return null;
      if (m.kind === "doors" ? !isRoom(m.room) : m.room !== null && m.room !== undefined) return null;
      return { t: "sabotage", kind: m.kind as SabotageKind, room: m.kind === "doors" ? (m.room as RoomId) : null };
    case "fixStart":
    case "fixDone":
      return m.kind === "blackout" || m.kind === "comms" ? { t: m.t, kind: m.kind } : null;
    case "hold":
      return (m.panel === 0 || m.panel === 1) && isBool(m.on) ? { t: "hold", panel: m.panel, on: m.on } : null;
    case "conduit": return { t: "conduit" };
    case "chat": return isStr(m.text, 200) ? { t: "chat", text: m.text } : null;
    case "quick":
      if (!isQuickTemplate(m.tpl) || !Array.isArray(m.args) || m.args.length > 3) return null;
      if (!m.args.every((a) => isStr(a, 16))) return null;
      return { t: "quick", tpl: m.tpl, args: m.args as string[] };
    case "vote": return isStr(m.target, 16) ? { t: "vote", target: m.target } : null;
    case "flag": return isStr(m.id, 16) ? { t: "flag", id: m.id } : null;
    case "rematch": return { t: "rematch" };
    default: return null;
  }
}

const SERVER_TYPES = new Set([
  "pong", "welcome", "lobby", "matchStart", "snap", "tasks", "fx", "meeting", "chat", "over", "died", "error", "kicked",
]);

/** The client trusts the server's shapes but still refuses anything that is not a known message. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (typeof data !== "object" || data === null) return null;
  const t = (data as { t?: unknown }).t;
  return typeof t === "string" && SERVER_TYPES.has(t) ? (data as ServerMessage) : null;
}

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
