import type {
  ClientMessage, MatchPlayer, Role, ServerMessage, Settings, TaskId, TaskState,
} from "@glitch/shared";

/** State shared between the DOM app and the Phaser scene for the current match. */

export type Snap = Extract<ServerMessage, { t: "snap" }>;

export type Interaction =
  | { kind: "task"; task: TaskId; stage: number }
  | { kind: "fix"; fix: "blackout" | "comms" }
  | { kind: "panel"; panel: 0 | 1 }
  | { kind: "emergency" }
  | { kind: "conduit" };

export interface Actions {
  use: Interaction | null;
  report: string | null;
  kill: string | null;
}

export interface MatchState {
  you: string;
  role: Role;
  partners: Set<string>;
  players: Map<string, MatchPlayer>;
  tasks: TaskState[];
  settings: Settings;
  ghost: boolean;
  phase: "reveal" | "play" | "meeting" | "over";
  snap: Snap | null;
  /** A minigame or menu is open: movement stops. */
  busy: boolean;
}

export const bridge = {
  match: null as MatchState | null,
  lowFx: false,
  send: (_msg: ClientMessage): void => {},
  onActions: (_a: Actions): void => {},
  /** Called by the app when a snapshot arrives so the scene can reconcile. */
  onSnap: (_s: Snap): void => {},
  onFx: (_kind: "conduit" | "task" | "kill", _x: number, _y: number): void => {},
  /** Called when everyone is teleported (meeting end) so prediction resets. */
  onTeleport: (): void => {},
};
