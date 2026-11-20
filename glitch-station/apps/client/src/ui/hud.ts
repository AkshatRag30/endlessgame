import {
  CONDUITS, CONFIG, EMERGENCY_BUTTON, FIX_POINTS, FLOOR, MAP_SIZE, ROOMS, taskById, type RoomId,
} from "@glitch/shared";
import type { App } from "../app";
import { sfx } from "../audio";
import { bridge, type Actions, type Snap } from "../game/bridge";
import type { ConnectionState } from "../net/connection";
import { GAMES, type GameKind } from "../tasks/minigames";
import { clear, fmtSeconds, h } from "./dom";
import { ChatBox } from "./meeting";

const SAB_TEXT = {
  blackout: { title: "Blackout", fix: "Flip the breakers in Power Grid" },
  meltdown: { title: "Core Meltdown", fix: "Two people hold both panels in Core Reactor" },
  comms: { title: "Comms jammed", fix: "Realign the dish in Signal Tower" },
  doors: { title: "Doors locked", fix: "They open by themselves" },
};

export class Hud {
  private root: HTMLElement;
  private barFill: HTMLElement;
  private barLabel: HTMLElement;
  private taskList: HTMLElement;
  private sabBanner: HTMLElement;
  private ghostBanner: HTMLElement;
  private ping: HTMLElement;
  private dot: HTMLElement;
  private useBtn: HTMLButtonElement;
  private reportBtn: HTMLButtonElement;
  private killBtn: HTMLButtonElement;
  private sabBtn: HTMLButtonElement;
  private chatBtn: HTMLButtonElement;
  private actions: Actions = { use: null, report: null, kill: null };
  private modal: { el: HTMLElement; cleanup: () => void } | null = null;
  private lastSab: string | null = null;
  private holding: 0 | 1 | null = null;
  private keyHandler: (e: KeyboardEvent) => void;

  constructor(private readonly app: App) {
    const m = bridge.match!;
    this.barFill = h("i");
    this.barLabel = h("span", {}, "Station tasks");
    this.taskList = h("ol");
    this.sabBanner = h("div", { class: "sab", hidden: true, role: "alert" });
    this.ghostBanner = h("div", { class: "ghostban", hidden: true }, "You are a ghost: keep doing tasks, chat only with ghosts");
    this.ping = h("b", {}, "··");
    this.dot = h("span", { class: "dot" });
    this.useBtn = h("button", { class: "act use", disabled: true }, "Use");
    this.reportBtn = h("button", { class: "act report", disabled: true }, "Report");
    this.killBtn = h("button", { class: "act kill", disabled: true }, "Eliminate");
    this.sabBtn = h("button", { class: "act sabotage" }, "Sabotage");
    this.chatBtn = h("button", { class: "act chat", hidden: true }, "Ghost chat");

    const mapBtn = h("button", { class: "pillbtn", "aria-label": "Station map" }, "Map");
    mapBtn.addEventListener("click", () => this.openMap());
    const leave = h("button", { class: "pillbtn", "aria-label": "Leave match" }, "✕");
    leave.addEventListener("click", () => { if (confirm("Leave this match? You can rejoin within 60 seconds.")) app.leaveRoom(); });

    const tasksBox = h("details", { class: "tasks", open: window.innerWidth > 700 },
      h("summary", {}, m.role === "glitch" ? "Fake tasks" : "Your tasks"), this.taskList);

    this.root = h("div", { class: "hud" },
      h("div", { class: "top" },
        h("div", { class: "taskbar" }, this.barLabel, h("div", { class: "track" }, this.barFill)),
        h("div", { class: "pills" }, h("span", { class: "net" }, this.dot, this.ping, " ms"), mapBtn, leave),
      ),
      tasksBox, this.sabBanner, this.ghostBanner,
      h("div", { class: "actions" },
        m.role === "glitch" ? this.sabBtn : null,
        m.role === "glitch" ? this.killBtn : null,
        this.chatBtn, this.reportBtn, this.useBtn),
    );
    app.ui.append(this.root);

    this.useBtn.addEventListener("click", () => this.use());
    this.useBtn.addEventListener("pointerdown", () => this.holdPanel(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) this.useBtn.addEventListener(ev, () => this.holdPanel(false));
    this.reportBtn.addEventListener("click", () => this.report());
    this.killBtn.addEventListener("click", () => this.kill());
    this.sabBtn.addEventListener("click", () => this.openSabotage());
    this.chatBtn.addEventListener("click", () => this.openGhostChat());

    this.keyHandler = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === "escape") this.closeModals();
      if (this.modal || bridge.match?.phase !== "play") return;
      if (k === "e" || k === " ") { e.preventDefault(); if (this.actions.use?.kind === "panel") this.holdPanel(true); else this.use(); }
      if (k === "r") this.report();
      if (k === "q") this.kill();
      if (k === "f" && m.role === "glitch") this.openSabotage();
      if (k === "m") this.openMap();
    };
    window.addEventListener("keydown", this.keyHandler);
    window.addEventListener("keyup", this.keyUp);

    bridge.onActions = (a) => { this.actions = a; this.renderButtons(); };
    this.renderTasks();
    this.renderGhost();
  }

  private keyUp = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() === "e" || e.key === " ") this.holdPanel(false);
  };

  destroy(): void {
    this.closeModals();
    this.holdPanel(false);
    window.removeEventListener("keydown", this.keyHandler);
    window.removeEventListener("keyup", this.keyUp);
    bridge.onActions = () => {};
    this.root.remove();
  }

  // ---- Status --------------------------------------------------------------

  setPing(ms: number | null): void {
    this.ping.textContent = ms === null ? "··" : String(Math.round(ms));
    this.dot.dataset.state = ms === null ? "" : ms < CONFIG.net.pingTargetMs ? "good" : ms < 300 ? "ok" : "bad";
  }

  setConnection(s: ConnectionState): void {
    if (s !== "open") { this.dot.dataset.state = "bad"; this.ping.textContent = "offline"; }
  }

  onSnap(s: Snap): void {
    const m = bridge.match!;
    if (s.bar === null) {
      this.barLabel.textContent = "Task bar offline (comms jammed)";
      this.barFill.style.width = "0%";
    } else {
      this.barLabel.textContent = "Station tasks";
      this.barFill.style.width = `${Math.round(s.bar * 100)}%`;
    }
    this.taskList.parentElement!.classList.toggle("jammed", s.sab?.kind === "comms");

    const sab = s.sab;
    if (sab) {
      const t = SAB_TEXT[sab.kind];
      const room = sab.room ? ` (${ROOMS.find((r) => r.id === sab.room)?.name})` : "";
      this.sabBanner.hidden = false;
      this.sabBanner.dataset.kind = sab.kind;
      this.sabBanner.textContent = `${t.title}${room}${sab.endsIn !== null ? ` · ${fmtSeconds(sab.endsIn)}` : ""} · ${t.fix}`;
      if (this.lastSab !== sab.kind) { sfx.alarm(); this.lastSab = sab.kind; }
    } else {
      this.sabBanner.hidden = true;
      this.lastSab = null;
      if (this.modal?.el.dataset.fix) this.closeModals();
    }

    if (m.role === "glitch") {
      const k = s.cd.kill;
      this.killBtn.textContent = k > 0 ? `Eliminate ${fmtSeconds(k)}` : "Eliminate";
      const sc = s.cd.sab;
      this.sabBtn.disabled = m.ghost && !!s.sab || sc > 0 || !!s.sab;
      this.sabBtn.textContent = s.sab ? "Sabotage (active)" : sc > 0 ? `Sabotage ${fmtSeconds(sc)}` : "Sabotage";
      this.sabBtn.hidden = false;
    }
    this.renderButtons();
  }

  renderGhost(): void {
    const m = bridge.match!;
    this.ghostBanner.hidden = !m.ghost;
    this.chatBtn.hidden = !m.ghost;
    if (m.ghost) { this.killBtn.hidden = true; this.reportBtn.hidden = true; }
  }

  onChat(): void {
    const last = this.app.chat.at(-1);
    if (last?.ghost && bridge.match?.ghost && !this.modal) this.chatBtn.classList.add("ping");
  }

  renderTasks(): void {
    const m = bridge.match!;
    clear(this.taskList);
    for (const t of m.tasks) {
      const def = taskById(t.id);
      const where = def.stages[Math.min(t.stage, def.stages.length - 1)]!.room;
      const stage = def.stages.length > 1 && !t.done ? ` (${t.stage + 1}/${def.stages.length})` : "";
      this.taskList.append(h("li", { class: t.done ? "done" : "" },
        `${ROOMS.find((r) => r.id === where)!.name}: ${def.name}${stage}`));
    }
  }

  private renderButtons(): void {
    const m = bridge.match!;
    const a = this.actions;
    const s = m.snap;
    const u = a.use;
    let label = "Use";
    let enabled = !!u;
    if (u?.kind === "task") label = taskById(u.task).name;
    if (u?.kind === "fix") label = u.fix === "blackout" ? "Fix lights" : "Fix comms";
    if (u?.kind === "panel") label = this.holding !== null ? "Holding…" : "Hold panel";
    if (u?.kind === "conduit") label = "Conduit";
    if (u?.kind === "emergency") {
      const left = s?.cd.emerLeft ?? 0;
      const cd = s?.cd.emer ?? 0;
      label = left <= 0 ? "No meetings left" : cd > 0 ? `Emergency ${fmtSeconds(cd)}` : "Emergency meeting";
      enabled = left > 0 && cd <= 0 && s?.sab?.kind !== "meltdown";
    }
    this.useBtn.textContent = label;
    this.useBtn.disabled = !enabled;
    this.useBtn.classList.toggle("hot", enabled);
    this.reportBtn.disabled = !a.report;
    this.reportBtn.classList.toggle("hot", !!a.report);
    const killReady = !!a.kill && (s?.cd.kill ?? 1) <= 0;
    this.killBtn.disabled = !killReady;
    this.killBtn.classList.toggle("hot", killReady);
  }

  // ---- Actions ----------------------------------------------------------------

  private use(): void {
    const m = bridge.match!;
    const u = this.actions.use;
    if (!u || this.modal || m.phase !== "play") return;
    switch (u.kind) {
      case "task":
        if (m.role === "crew") bridge.send({ t: "taskStart", task: u.task });
        this.openGame(u.task, u.stage, () => {
          if (m.role === "crew") bridge.send({ t: "taskDone", task: u.task });
        });
        return;
      case "fix":
        bridge.send({ t: "fixStart", kind: u.fix });
        this.openGame(u.fix, 0, () => bridge.send({ t: "fixDone", kind: u.fix }), true);
        return;
      case "emergency":
        bridge.send({ t: "emergency" });
        return;
      case "conduit":
        bridge.send({ t: "conduit" });
        sfx.conduit();
        return;
      case "panel":
        return; // handled by press and hold
    }
  }

  private holdPanel(on: boolean): void {
    const u = this.actions.use;
    if (on && u?.kind === "panel" && this.holding === null) {
      this.holding = u.panel;
      bridge.send({ t: "hold", panel: u.panel, on: true });
      this.renderButtons();
    } else if (!on && this.holding !== null) {
      bridge.send({ t: "hold", panel: this.holding, on: false });
      this.holding = null;
      this.renderButtons();
    }
  }

  private report(): void {
    if (!this.actions.report) return;
    bridge.send({ t: "report", body: this.actions.report });
  }

  private kill(): void {
    if (!this.actions.kill || this.killBtn.disabled) return;
    bridge.send({ t: "kill", target: this.actions.kill });
    sfx.eliminate();
  }

  // ---- Modals -------------------------------------------------------------------

  private openModal(title: string, hint: string, build: (body: HTMLElement) => () => void, extraClass = ""): HTMLElement {
    this.closeModals();
    const m = bridge.match!;
    m.busy = true;
    this.app.input.reset();
    const body = h("div", { class: "mg-body" });
    const close = h("button", { class: "icon-btn close", "aria-label": "Close" }, "✕");
    const el = h("div", { class: `overlay modal ${extraClass}` },
      h("div", { class: "panel" }, h("div", { class: "mg-head" }, h("div", {}, h("h3", {}, title), h("p", {}, hint)), close), body));
    close.addEventListener("click", () => this.closeModals());
    el.addEventListener("click", (e) => { if (e.target === el) this.closeModals(); });
    document.body.append(el);
    this.modal = { el, cleanup: build(body) };
    return el;
  }

  closeModals(): void {
    if (this.modal) {
      this.modal.cleanup();
      this.modal.el.remove();
      this.modal = null;
    }
    if (bridge.match) bridge.match.busy = false;
  }

  private openGame(kind: GameKind, stage: number, onDone: () => void, isFix = false): void {
    const title = kind === "blackout" ? "Restore power" : kind === "comms" ? "Realign the dish" : taskById(kind).name;
    const hint = kind === "blackout" ? "Turn every breaker on" : kind === "comms" ? "Line the waves up and hold" : taskById(kind).hint;
    const el = this.openModal(title, hint, (body) => GAMES[kind](body, () => {
      onDone();
      body.classList.add("solved");
      sfx.taskDone();
      setTimeout(() => this.closeModals(), 450);
    }, stage));
    if (isFix) el.dataset.fix = "1";
  }

  private openSabotage(): void {
    const m = bridge.match!;
    if (m.role !== "glitch" || this.sabBtn.disabled) return;
    this.openModal("Sabotage", "One at a time. Pick wisely.", (body) => {
      const pick = (kind: "blackout" | "meltdown" | "comms") => () => {
        bridge.send({ t: "sabotage", kind, room: null });
        this.closeModals();
      };
      const opts = [
        ["blackout", "Blackout", "Crew vision drops to 2 tiles"],
        ["meltdown", "Core Meltdown", "Critical: 40 s or you win"],
        ["comms", "Jam Comms", "Hides task lists and the bar"],
      ] as const;
      for (const [k, name, desc] of opts) {
        const b = h("button", { class: `sabopt ${k}` }, h("b", {}, name), h("span", {}, desc));
        b.addEventListener("click", pick(k));
        body.append(b);
      }
      body.append(h("p", { class: "lbl" }, "Lock doors (10 s)"));
      const rooms = h("div", { class: "chips" });
      for (const r of ROOMS) {
        const b = h("button", { class: "chip" }, r.name);
        b.addEventListener("click", () => { bridge.send({ t: "sabotage", kind: "doors", room: r.id as RoomId }); this.closeModals(); });
        rooms.append(b);
      }
      body.append(rooms);
      return () => {};
    }, "wide");
  }

  private openGhostChat(): void {
    this.chatBtn.classList.remove("ping");
    this.openModal("Ghost chat", "Only other ghosts can read this.", (body) => {
      const box = new ChatBox(this.app, body, true);
      return () => box.destroy();
    }, "wide");
  }

  private openMap(): void {
    const m = bridge.match!;
    this.openModal("Neon Relay", m.snap?.sab?.kind === "comms" ? "Comms are jammed: task markers hidden" : "Amber: your tasks · Red: active sabotage", (body) => {
      const S = 8;
      const c = h("canvas", { width: MAP_SIZE * S * 2, height: MAP_SIZE * S * 2, class: "map-canvas" });
      body.append(c);
      const ctx = c.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.fillStyle = "#07080F";
      ctx.fillRect(0, 0, MAP_SIZE * S, MAP_SIZE * S);
      for (let i = 0; i < FLOOR.length; i++) {
        if (!FLOOR[i]) continue;
        ctx.fillStyle = "#1E2347";
        ctx.fillRect((i % MAP_SIZE) * S, Math.floor(i / MAP_SIZE) * S, S, S);
      }
      ctx.font = "bold 9px Inter, sans-serif";
      ctx.fillStyle = "#9EA6DA";
      for (const r of ROOMS) ctx.fillText(r.name.toUpperCase(), r.x0 * S + 3, r.y0 * S + 11);
      const dotAt = (x: number, y: number, color: string, r = 4) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x * S, y * S, r, 0, Math.PI * 2); ctx.fill(); };
      dotAt(EMERGENCY_BUTTON.x, EMERGENCY_BUTTON.y, "#FF5E7A", 5);
      if (m.snap?.sab?.kind !== "comms") {
        for (const t of m.tasks) if (!t.done) { const st = taskById(t.id).stages[t.stage]!; dotAt(st.at.x, st.at.y, "#FFB23D"); }
      }
      const sab = m.snap?.sab?.kind;
      if (sab === "blackout" || sab === "comms") dotAt(FIX_POINTS[sab].x, FIX_POINTS[sab].y, "#FF5E7A", 6);
      if (sab === "meltdown") for (const p of FIX_POINTS.meltdown) dotAt(p.x, p.y, "#FF5E7A", 6);
      if (m.role === "glitch") for (const cd of CONDUITS) dotAt(cd.x, cd.y, "#A77BFF", 3);
      if (m.snap) {
        const color = m.players.get(m.you)?.color;
        dotAt(m.snap.me.x, m.snap.me.y, "#F2F4FF", 6);
        if (color !== undefined) dotAt(m.snap.me.x, m.snap.me.y, "#3DE0FF", 3);
      }
      return () => {};
    }, "wide");
  }
}
