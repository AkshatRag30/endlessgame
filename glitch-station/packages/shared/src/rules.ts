import { CONFIG } from "./config";
import { ROOMS, type RoomId } from "./map";
import { TASKS, isTaskId, taskById, type TaskId, type TaskState } from "./tasks";

/** Pure game rules shared by the server (truth) and the client (display). */

export type Role = "crew" | "glitch";

// ---- Settings (PRD section 9) -------------------------------------------

export interface Settings {
  maxPlayers: number;
  /** 0 means auto: 1 Glitch for up to 7 players, 2 for 8 or more. */
  glitches: number;
  killCooldown: number;
  discussion: number;
  voting: number;
  crewVision: number;
  commonTasks: number;
  shortTasks: number;
  longTasks: number;
  revealRole: boolean;
  freeChat: boolean;
  /** Lets 3 or 4 players start a match; host can add bots to fill. */
  practice: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  maxPlayers: CONFIG.room.maxPlayers,
  glitches: 0,
  killCooldown: CONFIG.glitch.eliminateCooldownS,
  discussion: CONFIG.meeting.discussionS,
  voting: CONFIG.meeting.votingS,
  crewVision: CONFIG.vision.crewTiles,
  commonTasks: 2,
  shortTasks: 3,
  longTasks: 1,
  revealRole: true,
  freeChat: true,
  practice: false,
};

const RANGES: Record<Exclude<keyof Settings, "revealRole" | "freeChat" | "practice">, [number, number]> = {
  maxPlayers: [CONFIG.room.minPlayers, CONFIG.room.maxPlayers],
  glitches: [0, 3],
  killCooldown: [15, 45],
  discussion: [15, 120],
  voting: [15, 120],
  crewVision: [3, 9],
  commonTasks: [0, 2],
  shortTasks: [0, 5],
  longTasks: [0, 1],
};

/** Applies a partial, untrusted update on top of current settings, clamping every number. */
export function applySettings(current: Settings, patch: Record<string, unknown>): Settings {
  const next: Settings = { ...current };
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const v = patch[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const [lo, hi] = RANGES[key];
      next[key] = Math.min(hi, Math.max(lo, Math.round(v)));
    }
  }
  for (const key of ["revealRole", "freeChat", "practice"] as const) {
    if (typeof patch[key] === "boolean") next[key] = patch[key] as boolean;
  }
  if (next.commonTasks + next.shortTasks + next.longTasks === 0) next.shortTasks = 1;
  return next;
}

export function minPlayersToStart(settings: Settings): number {
  return settings.practice ? CONFIG.room.practiceMinPlayers : CONFIG.room.minPlayers;
}

/** Glitches can never start equal to the crew, or they would win instantly. */
export function glitchCountFor(players: number, setting: number): number {
  const auto = players >= 8 ? 2 : 1;
  const wanted = setting === 0 ? auto : setting;
  const max = Math.max(1, Math.floor((players - 1) / 2));
  return Math.max(1, Math.min(wanted, max));
}

// ---- Randomness ---------------------------------------------------------

export type Rng = () => number;

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function assignRoles(ids: readonly string[], glitches: number, rng: Rng = Math.random): Map<string, Role> {
  const shuffled = shuffle(ids, rng);
  const roles = new Map<string, Role>();
  shuffled.forEach((id, i) => roles.set(id, i < glitches ? "glitch" : "crew"));
  return roles;
}

/** Everyone shares the same common tasks; short and long tasks are drawn per player. */
export function makeTaskDraw(settings: Settings, rng: Rng = Math.random) {
  const commons = shuffle(TASKS.filter((t) => t.kind === "common"), rng).slice(0, settings.commonTasks);
  return (): TaskState[] => {
    const shorts = shuffle(TASKS.filter((t) => t.kind === "short"), rng).slice(0, settings.shortTasks);
    const longs = shuffle(TASKS.filter((t) => t.kind === "long"), rng).slice(0, settings.longTasks);
    return [...commons, ...shorts, ...longs].map((t) => ({ id: t.id, stage: 0, done: false }));
  };
}

// ---- Votes (PRD section 8) ----------------------------------------------

export const SKIP = "skip";

/** Most votes is ejected; a tie at the top, or skip matching the top, ejects nobody. */
export function tallyVotes(votes: ReadonlyMap<string, string>): { ejected: string | null; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const target of votes.values()) counts[target] = (counts[target] ?? 0) + 1;
  const skip = counts[SKIP] ?? 0;
  let best: string | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [target, n] of Object.entries(counts)) {
    if (target === SKIP) continue;
    if (n > bestCount) { best = target; bestCount = n; tie = false; }
    else if (n === bestCount) tie = true;
  }
  if (!best || tie || skip >= bestCount) return { ejected: null, counts };
  return { ejected: best, counts };
}

// ---- Win conditions (PRD section 4) -------------------------------------

export type WinReason = "tasks" | "ejected" | "numbers" | "meltdown";
export interface Winner { team: Role; reason: WinReason }

export function checkWinner(input: {
  aliveCrew: number;
  aliveGlitches: number;
  tasksDone: number;
  tasksTotal: number;
  meltdownExpired: boolean;
}): Winner | null {
  if (input.meltdownExpired) return { team: "glitch", reason: "meltdown" };
  if (input.aliveGlitches === 0) return { team: "crew", reason: "ejected" };
  if (input.tasksTotal > 0 && input.tasksDone >= input.tasksTotal) return { team: "crew", reason: "tasks" };
  if (input.aliveGlitches >= input.aliveCrew) return { team: "glitch", reason: "numbers" };
  return null;
}

// ---- Chat safety (PRD sections 8 and 11) --------------------------------

/** A short open word list; the PRD asks for a free list, not a paid moderation API. */
const BLOCKED_WORDS = [
  "fuck", "shit", "bitch", "cunt", "dick", "pussy", "asshole", "bastard", "slut", "whore",
  "fag", "faggot", "nigger", "nigga", "retard", "kys", "rape", "porn", "cock", "wank",
];
const BLOCKED_RE = new RegExp(`(${BLOCKED_WORDS.join("|")})`, "gi");

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]", "g");

/** Removes control characters, trims, caps length and masks blocked words. */
export function cleanChat(text: string): string {
  const flat = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return flat.slice(0, CONFIG.meeting.chatMaxChars).replace(BLOCKED_RE, (w) => "*".repeat(w.length));
}

export function cleanName(text: string): string {
  const flat = text.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  const capped = flat.slice(0, CONFIG.room.nameMaxChars).replace(BLOCKED_RE, (w) => "*".repeat(w.length));
  return capped || "Player";
}

// ---- Quick chat ---------------------------------------------------------

export type QuickTemplate = "was_in" | "saw_at" | "sus" | "skip" | "did";
export const QUICK_TEMPLATES: Record<QuickTemplate, { label: string; args: ("room" | "player" | "task")[] }> = {
  was_in: { label: "I was in [room]", args: ["room"] },
  saw_at: { label: "I saw [player] at [room]", args: ["player", "room"] },
  sus: { label: "[player] is sus", args: ["player"] },
  skip: { label: "Skip", args: [] },
  did: { label: "I did [task]", args: ["task"] },
};

/** Builds the sentence on the server from validated ids, so nobody can smuggle free text through quick chat. */
export function renderQuick(tpl: QuickTemplate, args: readonly string[], playerName: (id: string) => string | null): string | null {
  const def = QUICK_TEMPLATES[tpl];
  if (args.length !== def.args.length) return null;
  const parts: string[] = [];
  for (let i = 0; i < def.args.length; i++) {
    const kind = def.args[i]!;
    const v = args[i]!;
    if (kind === "room") {
      const room = ROOMS.find((r) => r.id === (v as RoomId));
      if (!room) return null;
      parts.push(room.name);
    } else if (kind === "task") {
      if (!isTaskId(v)) return null;
      parts.push(taskById(v as TaskId).name);
    } else {
      const name = playerName(v);
      if (!name) return null;
      parts.push(name);
    }
  }
  let i = 0;
  return def.label.replace(/\[(room|player|task)\]/g, () => parts[i++]!);
}

export function isQuickTemplate(v: unknown): v is QuickTemplate {
  return typeof v === "string" && v in QUICK_TEMPLATES;
}
