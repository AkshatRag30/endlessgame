import { ACCESSORIES, CONFIG, SUIT_COLORS } from "@glitch/shared";
import type { App } from "../app";
import { isMuted, setMuted } from "../audio";
import { bridge } from "../game/bridge";
import { clear, h, store } from "./dom";
import { suitSvg } from "./suit";

export function colorPicker(selected: number, taken: Set<number>, onPick: (i: number) => void): HTMLElement {
  return h("div", { class: "swatches", role: "radiogroup", "aria-label": "Suit colour" },
    ...SUIT_COLORS.map((c, i) => {
      const b = h("button", {
        class: `swatch${i === selected ? " sel" : ""}`, role: "radio", "aria-checked": i === selected ? "true" : "false",
        "aria-label": c.name, title: c.name, disabled: taken.has(i) && i !== selected,
        html: suitSvg(i, "none", { size: 34 }),
      });
      b.addEventListener("click", () => onPick(i));
      return b;
    }));
}

export function accessoryPicker(selected: string, onPick: (a: (typeof ACCESSORIES)[number]) => void): HTMLElement {
  return h("div", { class: "chips" }, ...ACCESSORIES.map((a) => {
    const b = h("button", { class: `chip${a === selected ? " sel" : ""}` }, a === "none" ? "No hat" : a[0]!.toUpperCase() + a.slice(1));
    b.addEventListener("click", () => onPick(a));
    return b;
  }));
}

export function renderHome(app: App, prefill: string): void {
  const root = app.ui;
  clear(root);
  const p = app.profile;

  const preview = h("div", { class: "preview", html: suitSvg(p.color, p.accessory, { size: 96 }) });
  const name = h("input", { class: "field", maxlength: CONFIG.room.nameMaxChars, placeholder: "Your nickname", value: p.name, "aria-label": "Nickname", autocomplete: "nickname" });
  const code = h("input", { class: "field code", maxlength: 4, placeholder: "CODE", value: prefill, "aria-label": "Room code", autocapitalize: "characters", autocomplete: "off" });

  const rerender = () => renderHome(app, code.value);
  const ensureName = () => {
    p.name = name.value.trim();
    if (!p.name) { name.focus(); name.classList.add("shake"); setTimeout(() => name.classList.remove("shake"), 300); return false; }
    app.saveProfile();
    return true;
  };

  const create = h("button", { class: "btn primary" }, "Create room");
  create.addEventListener("click", () => { if (ensureName()) void app.create(); });
  const join = h("button", { class: "btn" }, "Join");
  const doJoin = () => { if (ensureName()) void app.tryJoin(code.value); };
  join.addEventListener("click", doJoin);
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
  code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ""); });
  name.addEventListener("input", () => { p.name = name.value; app.saveProfile(); });

  const sound = h("input", { type: "checkbox", checked: !isMuted() });
  sound.addEventListener("change", () => setMuted(!sound.checked));
  const lowfx = h("input", { type: "checkbox", checked: bridge.lowFx });
  lowfx.addEventListener("change", () => { bridge.lowFx = lowfx.checked; store.set("gs:lowfx", lowfx.checked ? "1" : "0"); });

  root.append(h("div", { class: "screen home" },
    h("div", { class: "logo" }, h("span", {}, "GLITCH"), h("span", {}, "STATION")),
    h("p", { class: "tagline" }, "Keep the station running. Find the Glitch before it finds you."),
    h("div", { class: "card" },
      h("div", { class: "who" }, preview, h("div", { class: "grow" }, h("label", { class: "lbl" }, "Nickname"), name)),
      h("label", { class: "lbl" }, "Suit"),
      colorPicker(p.color, new Set(), (i) => { p.color = i; p.name = name.value; app.saveProfile(); rerender(); }),
      accessoryPicker(p.accessory, (a) => { p.accessory = a; p.name = name.value; app.saveProfile(); rerender(); }),
    ),
    h("div", { class: "card" },
      create,
      h("div", { class: "or" }, "or join friends"),
      h("div", { class: "row" }, code, join),
    ),
    h("div", { class: "opts" },
      h("label", {}, sound, " Sound"),
      h("label", {}, lowfx, " Low effects (older phones)"),
    ),
    h("p", { class: "fine" }, "No account needed. Nickname only. For ages 13 and up."),
  ));
  if (prefill && p.name) join.focus(); else if (!p.name) name.focus();
}
