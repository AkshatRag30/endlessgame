import { anchorPoint, type Point, type RoomId } from "./map";

/** The eight task minigames from PRD section 6. */
export type TaskId = "reroute" | "align" | "defrag" | "purge" | "calibrate" | "sort" | "firewall" | "upload";
export type TaskKind = "common" | "short" | "long";

export interface TaskStage { room: RoomId; at: Point }

export interface TaskDef {
  id: TaskId;
  name: string;
  kind: TaskKind;
  /** One stage for most tasks; Upload Backup has two in different rooms. */
  stages: TaskStage[];
  /** Completing it lights the station up for anyone watching (proves innocence). */
  visual: boolean;
  hint: string;
}

const s = (room: RoomId, a: Parameters<typeof anchorPoint>[1]): TaskStage => ({ room, at: anchorPoint(room, a) });

export const TASKS: TaskDef[] = [
  { id: "reroute", name: "Reroute Circuit", kind: "short", stages: [s("power", "tl")], visual: false, hint: "Drag each wire to the port of the same colour" },
  { id: "align", name: "Align Signal", kind: "short", stages: [s("signal", "tl")], visual: false, hint: "Turn the dial until the waves overlap" },
  { id: "defrag", name: "Defrag Blocks", kind: "short", stages: [s("vault", "tr")], visual: false, hint: "Tap blocks to send them to their colour's column" },
  { id: "purge", name: "Purge Coolant", kind: "short", stages: [s("cooling", "tr")], visual: false, hint: "Hold the valve, release in the green band" },
  { id: "calibrate", name: "Calibrate Core", kind: "short", stages: [s("core", "b")], visual: true, hint: "Stop each ring when its gap reaches the top" },
  { id: "sort", name: "Sort Packets", kind: "common", stages: [s("dock", "l")], visual: false, hint: "Send each packet left or right by colour" },
  { id: "firewall", name: "Patch Firewall", kind: "common", stages: [s("hub", "tl")], visual: true, hint: "Tap the breaches before they spread" },
  { id: "upload", name: "Upload Backup", kind: "long", stages: [s("lab", "br"), s("vault", "bl")], visual: false, hint: "Download in the Lab, then upload in the Server Vault" },
];

export const TASK_IDS = TASKS.map((t) => t.id);

export function taskById(id: TaskId): TaskDef {
  const t = TASKS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  return t;
}

export function isTaskId(v: unknown): v is TaskId {
  return typeof v === "string" && (TASK_IDS as string[]).includes(v);
}

/** A player's progress on one task. `stage` is the next stage to do; done when stage === stages.length. */
export interface TaskState { id: TaskId; stage: number; done: boolean }
