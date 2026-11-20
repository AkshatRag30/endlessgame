import { CONFIG, QUICK_TEMPLATES, ROOMS, SKIP, SUIT_COLORS, taskById, type QuickTemplate } from "@glitch/shared";
import type { App } from "../app";
import { sfx } from "../audio";
import { bridge } from "../game/bridge";
import { clear, fmtSeconds, h, toast } from "./dom";
import { suitSvg } from "./suit";

/** Chat log + typed input + quick chat sheet. Used in meetings and in ghost chat. */
export class ChatBox {
  private log: HTMLElement;
  private sheet: HTMLElement;
  private readonly unsub: () => void;

  constructor(private readonly app: App, root: HTMLElement, private readonly ghostOnly: boolean) {
    this.log = h("div", { class: "chatlog", "aria-live": "polite" });
    this.sheet = h("div", { class: "quicksheet", hidden: true });
    const m = bridge.match!;
    const canType = m.settings.freeChat;
    const input = h("input", { class: "field", maxlength: CONFIG.meeting.chatMaxChars, placeholder: canType ? "Say something…" : "Typed chat is off", disabled: !canType, "aria-label": "Chat message" });
    const send = h("button", { class: "btn small primary", disabled: !canType }, "Send");
    const doSend = () => {
      const text = input.value.trim();
      if (!text) return;
      bridge.send({ t: "chat", text });
      input.value = "";
    };
    send.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
    const quick = h("button", { class: "btn small" }, "Quick chat");
    quick.addEventListener("click", () => this.openQuick());
    root.append(this.log, this.sheet, h("div", { class: "chatrow" }, quick, input, send));
    this.render();
    const prev = this.app.chat.length;
    void prev;
    const timer = window.setInterval(() => this.render(), 500);
    this.unsub = () => window.clearInterval(timer);
  }

  private count = -1;
  render(): void {
    const lines = this.app.chat.filter((l) => !this.ghostOnly || l.ghost);
    if (lines.length === this.count) return;
    this.count = lines.length;
    clear(this.log);
    if (!lines.length) this.log.append(h("p", { class: "empty" }, this.ghostOnly ? "No ghost messages yet." : "Say where you were and what you saw."));
    for (const l of lines) {
      const p = bridge.match?.players.get(l.from);
      const color = SUIT_COLORS[p?.color ?? 0]!.css;
      this.log.append(h("div", { class: `line${l.ghost ? " ghost" : ""}` },
        h("b", { style: `color:${color}` }, this.app.playerName(l.from)), l.ghost ? h("em", {}, " (ghost)") : null, ": ", l.text));
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  private openQuick(): void {
    const sheet = this.sheet;
    sheet.hidden = !sheet.hidden;
    if (sheet.hidden) return;
    const m = bridge.match!;
    const args: string[] = [];
    let tpl: QuickTemplate | null = null;
    const step = () => {
      clear(sheet);
      if (!tpl) {
        for (const [key, def] of Object.entries(QUICK_TEMPLATES)) {
          const b = h("button", { class: "chip" }, def.label);
          b.addEventListener("click", () => { tpl = key as QuickTemplate; step(); });
          sheet.append(b);
        }
        return;
      }
      const need = QUICK_TEMPLATES[tpl].args[args.length];
      if (!need) {
        bridge.send({ t: "quick", tpl, args });
        sheet.hidden = true;
        return;
      }
      const choices: [string, string][] =
        need === "room" ? ROOMS.map((r) => [r.id, r.name])
        : need === "task" ? m.tasks.map((t) => [t.id, taskById(t.id).name])
        : [...m.players.values()].filter((p) => p.id !== m.you).map((p) => [p.id, p.name]);
      sheet.append(h("p", { class: "lbl" }, `Pick a ${need}`));
      for (const [id, label] of choices) {
        const b = h("button", { class: "chip" }, label);
        b.addEventListener("click", () => { args.push(id); step(); });
        sheet.append(b);
      }
    };
    step();
  }

  destroy(): void {
    this.unsub();
  }
}

/** The meeting table: discussion, voting, result (PRD section 8). */
export class MeetingPanel {
  private el: HTMLElement;
  private head: HTMLElement;
  private timer: HTMLElement;
  private grid: HTMLElement;
  private footer: HTMLElement;
  private chat: ChatBox;
  private tick: number;
  private selected: string | null = null;

  constructor(private readonly app: App) {
    this.head = h("div", { class: "mhead" });
    this.timer = h("div", { class: "mtimer" });
    this.grid = h("div", { class: "mgrid" });
    this.footer = h("div", { class: "mfoot" });
    const chatRoot = h("div", { class: "mchat" });
    this.el = h("div", { class: "overlay meeting" },
      h("div", { class: "mpanel" },
        h("div", { class: "mtop" }, this.head, this.timer),
        h("div", { class: "mbody" }, h("div", { class: "mleft" }, this.grid, this.footer), chatRoot)));
    document.body.append(this.el);
    this.chat = new ChatBox(app, chatRoot, false);
    this.tick = window.setInterval(() => this.renderTimer(), 250);
  }

  destroy(): void {
    window.clearInterval(this.tick);
    this.chat.destroy();
    this.el.remove();
  }

  renderChat(): void {
    this.chat.render();
  }

  private renderTimer(): void {
    const mt = this.app.meeting;
    if (!mt) return;
    const left = mt.endsIn - (performance.now() - this.app.meetingAt);
    const label = mt.phase === "discussion" ? "Discussion" : mt.phase === "voting" ? "Voting" : "Result";
    this.timer.textContent = `${label} · ${fmtSeconds(left)}`;
    this.timer.classList.toggle("urgent", left < 10_000 && mt.phase !== "result");
  }

  render(): void {
    const mt = this.app.meeting;
    const m = bridge.match;
    if (!mt || !m) return;
    const name = (id: string) => this.app.playerName(id);
    clear(this.head);
    this.head.append(
      h("h2", {}, mt.reason === "report" ? "Body reported" : "Emergency meeting"),
      h("p", {}, mt.reason === "report" && mt.victim
        ? `${name(mt.caller)} found ${name(mt.victim)}.`
        : `${name(mt.caller)} pressed the button.`),
    );
    this.renderTimer();

    const alive = new Set(mt.alive);
    const voted = new Set(mt.voted);
    const iCanVote = mt.phase === "voting" && alive.has(m.you) && !voted.has(m.you);
    const counts = mt.result?.counts ?? {};
    clear(this.grid);
    for (const p of m.players.values()) {
      const dead = !alive.has(p.id);
      const card = h("button", {
        class: `pcard${dead ? " dead" : ""}${this.selected === p.id ? " sel" : ""}${mt.result?.ejected === p.id ? " out" : ""}`,
        disabled: !iCanVote || dead,
        "aria-label": `Vote ${p.name}`,
      },
        h("span", { html: suitSvg(p.color, p.accessory, { size: 40, dead }) }),
        h("span", { class: "pn" }, p.name, p.id === m.you ? " (you)" : ""),
        m.partners.has(p.id) ? h("span", { class: "tag bad" }, "Glitch") : null,
        voted.has(p.id) && mt.phase !== "result" ? h("span", { class: "tag ok" }, "Voted") : null,
        mt.phase === "result" && counts[p.id] ? h("span", { class: "votes" }, `${counts[p.id]} vote${counts[p.id]! > 1 ? "s" : ""}`) : null,
      );
      card.addEventListener("click", () => { this.selected = p.id; sfx.tap(); this.render(); });
      if (p.id !== m.you && !p.bot) {
        const mute = h("span", { class: "mini", role: "button", title: this.app.muted.has(p.id) ? "Unmute" : "Mute", tabindex: 0 }, this.app.muted.has(p.id) ? "🔇" : "🔈");
        mute.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.app.muted.has(p.id)) this.app.muted.delete(p.id); else this.app.muted.add(p.id);
          this.render();
        });
        const flag = h("span", { class: "mini", role: "button", title: "Report player", tabindex: 0 }, "⚑");
        flag.addEventListener("click", (e) => { e.stopPropagation(); bridge.send({ t: "flag", id: p.id }); toast(`Reported ${p.name}. Thanks.`); });
        card.append(h("span", { class: "minis" }, mute, flag));
      }
      this.grid.append(card);
    }

    clear(this.footer);
    if (mt.phase === "discussion") {
      this.footer.append(h("p", { class: "hint" }, "Talk first. Voting opens when the timer ends."));
    } else if (mt.phase === "voting") {
      if (!alive.has(m.you)) this.footer.append(h("p", { class: "hint" }, "Ghosts cannot vote."));
      else if (voted.has(m.you)) this.footer.append(h("p", { class: "hint" }, `Vote locked in. ${mt.voted.length} of ${mt.alive.length} voted.`));
      else {
        const vote = h("button", { class: "btn primary", disabled: !this.selected }, this.selected ? `Vote ${name(this.selected)}` : "Pick a player");
        vote.addEventListener("click", () => { if (this.selected) { bridge.send({ t: "vote", target: this.selected }); this.selected = null; } });
        const skip = h("button", { class: "btn" }, `Skip vote${counts[SKIP] ? ` (${counts[SKIP]})` : ""}`);
        skip.addEventListener("click", () => { bridge.send({ t: "vote", target: SKIP }); this.selected = null; });
        this.footer.append(vote, skip);
      }
    } else if (mt.result) {
      const out = mt.result.ejected;
      const roleText = mt.result.role === null ? "" : mt.result.role === "glitch" ? " They were a Glitch." : " They were not a Glitch.";
      this.footer.append(h("p", { class: "result" }, out ? `${name(out)} was ejected.${roleText}` : "No one was ejected.",
        counts[SKIP] ? ` (${counts[SKIP]} skipped)` : ""));
    }
  }
}
