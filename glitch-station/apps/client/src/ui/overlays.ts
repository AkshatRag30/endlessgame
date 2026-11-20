import { CONFIG, type Role } from "@glitch/shared";
import type { App, OverMsg } from "../app";
import { sfx } from "../audio";
import { bridge } from "../game/bridge";
import { h } from "./dom";
import { suitSvg } from "./suit";

/** Full screen role card at the start of a match (PRD section 13). */
export function showReveal(app: App, role: Role, partners: string[]): void {
  const me = bridge.match?.players.get(app.you ?? "");
  sfx.reveal();
  const el = h("div", { class: `overlay reveal ${role}` },
    h("div", { class: "rcard" },
      h("p", { class: "lbl" }, "You are"),
      h("h1", {}, role === "glitch" ? "A Glitch" : "Crew"),
      me ? h("div", { html: suitSvg(me.color, me.accessory, { size: 120 }) }) : null,
      h("p", {}, role === "glitch"
        ? "Eliminate the crew without being seen. Sabotage, use conduits, fake your tasks."
        : "Finish your tasks and find the Glitch. Report bodies, call meetings, vote wisely."),
      partners.length ? h("p", { class: "partners" }, `Your fellow Glitch: ${partners.join(", ")}`) : null,
    ));
  document.body.append(el);
  setTimeout(() => el.classList.add("fade"), CONFIG.roleRevealMs - 600);
  setTimeout(() => el.remove(), CONFIG.roleRevealMs);
}

const REASONS = {
  tasks: "All station tasks were completed.",
  ejected: "Every Glitch was voted out.",
  numbers: "The Glitches matched the crew in number.",
  meltdown: "The core melted down.",
};

export function showResults(app: App, over: OverMsg): void {
  document.querySelectorAll(".overlay.results").forEach((o) => o.remove());
  const m = bridge.match;
  const won = m?.role === over.winner;
  const players = m ? [...m.players.values()] : [];
  const rematch = h("button", { class: "btn primary big" }, "Back to lobby");
  rematch.addEventListener("click", () => app.conn?.send({ t: "rematch" }));
  const leave = h("button", { class: "btn ghost" }, "Leave room");
  leave.addEventListener("click", () => app.leaveRoom());

  const el = h("div", { class: `overlay results ${over.winner}` },
    h("div", { class: "rcard wide" },
      h("p", { class: "lbl" }, won ? "Victory" : "Defeat"),
      h("h1", {}, over.winner === "glitch" ? "Glitches win" : "Crew wins"),
      h("p", {}, REASONS[over.reason]),
      h("div", { class: "roles" }, ...players.map((p) => h("div", { class: `rp ${over.roles[p.id]}` },
        h("span", { html: suitSvg(p.color, p.accessory, { size: 40 }) }),
        h("b", {}, p.name), h("span", {}, over.roles[p.id] === "glitch" ? "Glitch" : "Crew")))),
      h("div", { class: "row" }, app.isHost ? rematch : h("p", { class: "hint" }, "Waiting for the host to start a rematch…"), leave),
    ));
  document.body.append(el);
}
