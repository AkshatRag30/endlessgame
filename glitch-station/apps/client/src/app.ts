import Phaser from "phaser";
import {
  isValidRoomCode, normalizeRoomCode, type Accessory, type ErrorCode, type MeetingView, type ServerMessage,
} from "@glitch/shared";
import { sfx, unlockAudio } from "./audio";
import { bridge, type MatchState } from "./game/bridge";
import { MoveInput } from "./game/input";
import { Connection, createRoom, roomExists } from "./net/connection";
import { StationScene } from "./scenes/StationScene";
import { store, toast } from "./ui/dom";
import { renderHome } from "./ui/home";
import { Hud } from "./ui/hud";
import { renderLobby } from "./ui/lobby";
import { MeetingPanel } from "./ui/meeting";
import { showResults, showReveal } from "./ui/overlays";

export type LobbyMsg = Extract<ServerMessage, { t: "lobby" }>;
export type OverMsg = Extract<ServerMessage, { t: "over" }>;
export interface ChatLine { from: string; text: string; ghost: boolean }

const ERRORS: Record<ErrorCode, string> = {
  bad_message: "The server did not understand that.",
  protocol_mismatch: "Your game is out of date. Refresh the page.",
  room_not_found: "That room does not exist (or it closed).",
  room_full: "That room is full.",
  in_progress: "A match is already running in that room.",
  not_host: "Only the host can do that.",
  too_few_players: "Not enough players yet. Turn on practice mode or add bots.",
  rate_limited: "Slow down a little.",
  not_allowed: "Everyone needs to be ready first.",
};

export interface Profile { name: string; color: number; accessory: Accessory }

export class App {
  readonly ui = document.getElementById("ui")!;
  readonly input: MoveInput;
  conn: Connection | null = null;
  room: string | null = null;
  you: string | null = null;
  lobby: LobbyMsg | null = null;
  profile: Profile;
  chat: ChatLine[] = [];
  muted = new Set<string>();
  meeting: MeetingView | null = null;
  meetingAt = 0;
  over: OverMsg | null = null;
  private phaser: Phaser.Game | null = null;
  private hud: Hud | null = null;
  private meetingPanel: MeetingPanel | null = null;
  private revealShown = false;

  constructor() {
    this.input = new MoveInput(document.getElementById("game")!);
    this.profile = {
      name: store.get("gs:name") ?? "",
      color: Number(store.get("gs:color") ?? Math.floor(Math.random() * 12)) % 12,
      accessory: (store.get("gs:acc") as Accessory | null) ?? "none",
    };
    bridge.lowFx = store.get("gs:lowfx") === "1";
    bridge.send = (msg) => this.conn?.send(msg);
    document.addEventListener("pointerdown", unlockAudio, { once: false, passive: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
  }

  saveProfile(): void {
    store.set("gs:name", this.profile.name);
    store.set("gs:color", String(this.profile.color));
    store.set("gs:acc", this.profile.accessory);
  }

  start(): void {
    const code = normalizeRoomCode(new URLSearchParams(location.search).get("room") ?? "");
    renderHome(this, isValidRoomCode(code) ? code : "");
  }

  // ---- Joining -------------------------------------------------------------

  async create(): Promise<void> {
    try {
      const code = await createRoom();
      this.join(code);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  }

  async tryJoin(code: string): Promise<void> {
    code = normalizeRoomCode(code);
    if (!isValidRoomCode(code)) { toast("Room codes are 4 letters.", "bad"); return; }
    try {
      if (!(await roomExists(code))) { toast(ERRORS.room_not_found, "bad"); return; }
    } catch {
      toast("Could not reach the server.", "bad");
      return;
    }
    this.join(code);
  }

  private join(code: string): void {
    this.leaveRoom(false);
    this.room = code;
    history.replaceState(null, "", `?room=${code}`);
    const conn = new Connection(code);
    this.conn = conn;
    conn.onOpen = () => conn.send({
      t: "hello", name: this.profile.name, color: this.profile.color, accessory: this.profile.accessory,
      token: store.get(`gs:token:${code}`),
    });
    conn.onMessage = (m) => this.onMessage(m);
    conn.onState = (s) => this.hud?.setConnection(s);
    conn.start();
  }

  leaveRoom(goHome = true): void {
    this.conn?.stop();
    this.conn = null;
    this.teardownMatch();
    this.lobby = null;
    this.you = null;
    if (goHome) {
      history.replaceState(null, "", location.pathname);
      this.room = null;
      renderHome(this, "");
    }
  }

  // ---- Messages --------------------------------------------------------------

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        this.you = msg.you;
        store.set(`gs:token:${msg.room}`, msg.token);
        return;

      case "lobby":
        this.lobby = msg;
        if (msg.phase === "lobby") {
          if (bridge.match) this.teardownMatch();
          renderLobby(this);
        } else if (!bridge.match) {
          renderLobby(this); // match starting; matchStart is on its way
        }
        return;

      case "matchStart":
        return this.startMatch(msg);

      case "snap": {
        const m = bridge.match;
        if (!m) return;
        if (m.phase === "reveal") m.phase = "play";
        bridge.onSnap(msg);
        this.hud?.onSnap(msg);
        return;
      }

      case "tasks": {
        const m = bridge.match;
        if (!m) return;
        const before = m.tasks.filter((t) => t.done).length;
        m.tasks = msg.list;
        if (m.tasks.filter((t) => t.done).length > before) sfx.taskDone(); else sfx.stageDone();
        this.hud?.renderTasks();
        return;
      }

      case "fx":
        bridge.onFx(msg.kind, msg.x, msg.y);
        if (msg.kind === "conduit") sfx.conduit();
        return;

      case "meeting": {
        const m = bridge.match;
        if (!m) return;
        const fresh = msg.meeting && !this.meeting;
        this.meeting = msg.meeting;
        this.meetingAt = performance.now();
        if (msg.meeting) {
          m.phase = "meeting";
          this.hud?.closeModals();
          if (fresh) {
            this.chat = [];
            if (msg.meeting.reason === "report") sfx.report(); else sfx.meeting();
          }
          if (msg.meeting.phase === "result" && msg.meeting.result?.ejected) sfx.eject();
          this.meetingPanel ??= new MeetingPanel(this);
          this.meetingPanel.render();
        } else {
          m.phase = "play";
          this.meetingPanel?.destroy();
          this.meetingPanel = null;
          bridge.onTeleport();
        }
        return;
      }

      case "chat":
        if (this.muted.has(msg.from)) return;
        this.chat.push({ from: msg.from, text: msg.text, ghost: msg.ghost });
        if (this.chat.length > 80) this.chat.shift();
        this.meetingPanel?.renderChat();
        this.hud?.onChat();
        return;

      case "died": {
        const m = bridge.match;
        if (!m) return;
        m.ghost = true;
        sfx.died();
        toast(msg.how === "ejected" ? "You were ejected. You are now a ghost." : "You were eliminated. Keep helping as a ghost.", "bad");
        this.hud?.renderGhost();
        return;
      }

      case "over":
        this.over = msg;
        if (bridge.match) bridge.match.phase = "over";
        this.meetingPanel?.destroy();
        this.meetingPanel = null;
        this.hud?.closeModals();
        if (msg.winner === bridge.match?.role) sfx.win(); else sfx.lose();
        showResults(this, msg);
        return;

      case "error":
        toast(ERRORS[msg.code], "bad");
        if (msg.code === "room_not_found" || msg.code === "in_progress" || msg.code === "room_full") {
          store.set(`gs:token:${this.room}`, "");
          this.leaveRoom();
        }
        return;

      case "kicked":
        toast("The host removed you from the room.", "bad");
        this.leaveRoom();
        return;

      case "pong":
        this.hud?.setPing(this.conn?.rttMs ?? null);
        return;
    }
  }

  // ---- Match lifecycle ---------------------------------------------------------

  private startMatch(msg: Extract<ServerMessage, { t: "matchStart" }>): void {
    const resumed = bridge.match !== null;
    const state: MatchState = {
      you: this.you!, role: msg.role, partners: new Set(msg.partners),
      players: new Map(msg.players.map((p) => [p.id, p])),
      tasks: msg.tasks, settings: msg.settings, ghost: bridge.match?.ghost ?? false,
      phase: bridge.match?.phase === "meeting" ? "meeting" : "reveal", snap: null, busy: false,
    };
    if (resumed) {
      Object.assign(bridge.match!, { tasks: msg.tasks, role: msg.role, partners: state.partners });
      this.hud?.renderTasks();
      return;
    }
    bridge.match = state;
    this.over = null;
    this.chat = [];
    this.meeting = null;
    this.ui.innerHTML = "";
    this.hud = new Hud(this);
    this.input.reset();
    this.phaser = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game",
      backgroundColor: "#07080F",
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      render: { antialias: true },
      scene: [],
    });
    this.phaser.scene.add("station", StationScene, true, { input: this.input });
    if (!this.revealShown) {
      this.revealShown = true;
      showReveal(this, msg.role, msg.partners.map((id) => state.players.get(id)?.name ?? "?"));
    }
  }

  teardownMatch(): void {
    this.hud?.destroy();
    this.hud = null;
    this.meetingPanel?.destroy();
    this.meetingPanel = null;
    this.phaser?.destroy(true);
    this.phaser = null;
    bridge.match = null;
    this.meeting = null;
    this.over = null;
    this.revealShown = false;
    document.getElementById("game")!.innerHTML = "";
    document.querySelectorAll(".overlay").forEach((o) => o.remove());
  }

  playerName(id: string): string {
    return bridge.match?.players.get(id)?.name ?? this.lobby?.players.find((p) => p.id === id)?.name ?? "Someone";
  }

  get isHost(): boolean {
    return this.lobby?.host === this.you;
  }
}
