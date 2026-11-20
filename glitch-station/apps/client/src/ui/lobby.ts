import { CONFIG, glitchCountFor, minPlayersToStart, type Settings } from "@glitch/shared";
import type { App } from "../app";
import { sfx } from "../audio";
import { clear, h, toast } from "./dom";
import { accessoryPicker, colorPicker } from "./home";
import { suitSvg } from "./suit";

type NumKey = Exclude<keyof Settings, "revealRole" | "freeChat" | "practice">;

const NUMS: { key: NumKey; label: string; min: number; max: number; step: number; unit?: string; fmt?: (v: number) => string }[] = [
  { key: "maxPlayers", label: "Max players", min: CONFIG.room.minPlayers, max: CONFIG.room.maxPlayers, step: 1 },
  { key: "glitches", label: "Glitches", min: 0, max: 3, step: 1, fmt: (v) => (v === 0 ? "Auto" : String(v)) },
  { key: "killCooldown", label: "Elimination cooldown", min: 15, max: 45, step: 5, unit: "s" },
  { key: "discussion", label: "Discussion time", min: 15, max: 120, step: 15, unit: "s" },
  { key: "voting", label: "Voting time", min: 15, max: 120, step: 15, unit: "s" },
  { key: "crewVision", label: "Crew vision", min: 3, max: 9, step: 1, unit: " tiles" },
  { key: "commonTasks", label: "Common tasks", min: 0, max: 2, step: 1 },
  { key: "shortTasks", label: "Short tasks", min: 0, max: 5, step: 1 },
  { key: "longTasks", label: "Long tasks", min: 0, max: 1, step: 1 },
];

export function renderLobby(app: App): void {
  const lobby = app.lobby;
  if (!lobby) return;
  const root = app.ui;
  clear(root);
  const me = lobby.players.find((p) => p.id === app.you);
  const host = app.isHost;
  const s = lobby.settings;

  if (lobby.phase === "match") {
    root.append(h("div", { class: "screen center" }, h("div", { class: "spinner" }), h("p", {}, "Match starting…")));
    return;
  }

  const link = `${location.origin}${location.pathname}?room=${app.room}`;
  const share = h("button", { class: "btn small" }, "Share link");
  share.addEventListener("click", async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Glitch Station", text: `Join my Glitch Station room ${app.room}`, url: link });
      else { await navigator.clipboard.writeText(link); toast("Link copied", "good"); }
    } catch { /* cancelled */ }
  });

  const list = h("ul", { class: "players" }, ...lobby.players.map((p) => {
    const kick = host && p.id !== app.you
      ? h("button", { class: "icon-btn", title: `Remove ${p.name}`, "aria-label": `Remove ${p.name}` }, "✕")
      : null;
    kick?.addEventListener("click", () => app.conn?.send({ t: "kick", id: p.id }));
    return h("li", { class: `player${p.connected ? "" : " off"}` },
      h("span", { html: suitSvg(p.color, p.accessory, { size: 38 }) }),
      h("span", { class: "pname" }, p.name, p.id === app.you ? h("em", {}, " (you)") : null),
      p.host ? h("span", { class: "tag host" }, "Host") : null,
      p.bot ? h("span", { class: "tag" }, "Bot") : null,
      !p.connected ? h("span", { class: "tag warn" }, "Reconnecting") : null,
      !p.host ? h("span", { class: `tag ${p.ready ? "ok" : ""}` }, p.ready ? "Ready" : "Not ready") : null,
      kick,
    );
  }));

  const taken = new Set(lobby.players.filter((p) => p.id !== app.you).map((p) => p.color));
  const look = me ? h("div", { class: "card" },
    h("label", { class: "lbl" }, "Your suit"),
    colorPicker(me.color, taken, (i) => { app.profile.color = i; app.saveProfile(); app.conn?.send({ t: "lobbySet", color: i, accessory: null, ready: null }); }),
    accessoryPicker(me.accessory, (a) => { app.profile.accessory = a; app.saveProfile(); app.conn?.send({ t: "lobbySet", color: null, accessory: a, ready: null }); }),
  ) : null;

  const count = lobby.players.length;
  const need = minPlayersToStart(s);
  const notReady = lobby.players.filter((p) => !p.host && !p.ready).length;
  let reason = "";
  if (count < need) reason = `Need ${need - count} more player${need - count === 1 ? "" : "s"}${s.practice ? " (add bots)" : " (or turn on practice mode)"}`;
  else if (notReady) reason = `Waiting for ${notReady} player${notReady === 1 ? "" : "s"} to get ready`;

  const actions = h("div", { class: "card" });
  if (host) {
    const start = h("button", { class: "btn primary big", disabled: !!reason }, "Start match");
    start.addEventListener("click", () => { sfx.tap(); app.conn?.send({ t: "start" }); });
    const addBot = h("button", { class: "btn small", disabled: count >= s.maxPlayers }, "+ Add bot");
    addBot.addEventListener("click", () => app.conn?.send({ t: "addBot" }));
    const rmBot = h("button", { class: "btn small", disabled: !lobby.players.some((p) => p.bot) }, "− Remove bot");
    rmBot.addEventListener("click", () => app.conn?.send({ t: "removeBot" }));
    actions.append(start, h("p", { class: "hint" }, reason || `${glitchCountFor(count, s.glitches)} Glitch${glitchCountFor(count, s.glitches) > 1 ? "es" : ""} this match`), h("div", { class: "row" }, addBot, rmBot));
  } else if (me) {
    const ready = h("button", { class: `btn big ${me.ready ? "" : "primary"}` }, me.ready ? "Not ready" : "I'm ready");
    ready.addEventListener("click", () => { sfx.tap(); app.conn?.send({ t: "lobbySet", color: null, accessory: null, ready: !me.ready }); });
    actions.append(ready, h("p", { class: "hint" }, "The host starts the match."));
  }

  const settings = h("details", { class: "card settings", open: host && window.innerWidth > 900 },
    h("summary", {}, host ? "Match settings" : "Match settings (host only)"),
    ...NUMS.map((n) => {
      const v = s[n.key];
      const dec = h("button", { class: "step", disabled: !host || v <= n.min, "aria-label": `Lower ${n.label}` }, "−");
      const inc = h("button", { class: "step", disabled: !host || v >= n.max, "aria-label": `Raise ${n.label}` }, "+");
      dec.addEventListener("click", () => app.conn?.send({ t: "settings", patch: { [n.key]: v - n.step } }));
      inc.addEventListener("click", () => app.conn?.send({ t: "settings", patch: { [n.key]: v + n.step } }));
      return h("div", { class: "setting" }, h("span", {}, n.label), h("span", { class: "stepper" }, dec, h("b", {}, n.fmt ? n.fmt(v) : `${v}${n.unit ?? ""}`), inc));
    }),
    ...(["revealRole", "freeChat", "practice"] as const).map((key) => {
      const label = { revealRole: "Reveal ejected role", freeChat: "Typed chat in meetings", practice: "Practice mode (3+ players)" }[key];
      const box = h("input", { type: "checkbox", checked: s[key], disabled: !host });
      box.addEventListener("change", () => app.conn?.send({ t: "settings", patch: { [key]: box.checked } }));
      return h("label", { class: "setting" }, h("span", {}, label), box);
    }),
  );

  const leave = h("button", { class: "btn ghost small" }, "Leave room");
  leave.addEventListener("click", () => app.leaveRoom());

  root.append(h("div", { class: "screen lobby" },
    h("div", { class: "roomcode" }, h("span", { class: "lbl" }, "Room code"), h("b", {}, app.room ?? ""), share),
    h("div", { class: "cols" },
      h("div", { class: "col" }, h("div", { class: "card" }, h("label", { class: "lbl" }, `Players ${count} / ${s.maxPlayers}`), list), actions),
      h("div", { class: "col" }, look, settings, leave),
    ),
  ));
}
