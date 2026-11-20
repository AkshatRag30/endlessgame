import { CONFIG, type TaskId } from "@glitch/shared";
import { sfx } from "../audio";
import { h } from "../ui/dom";

/**
 * Task minigames (PRD section 6): short, touch friendly, original designs.
 * Each one renders into `root`, calls `done()` once when solved, and returns
 * a cleanup function.
 */

export type GameKind = TaskId | "blackout" | "comms";
type Game = (root: HTMLElement, done: () => void, stage: number) => () => void;

const COLORS = ["#FF5E7A", "#3DE0FF", "#FFB23D", "#4DFFB0"];
const rand = (n: number) => Math.floor(Math.random() * n);
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };

function canvas(root: HTMLElement, w = 300, h2 = 220): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = h("canvas", { width: w * 2, height: h2 * 2, class: "mg-canvas" });
  c.style.aspectRatio = `${w} / ${h2}`;
  root.append(c);
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);
  return [c, ctx];
}

/** Drag each wire on the left to the port of the same colour on the right. */
const reroute: Game = (root, done) => {
  const order = shuffle([0, 1, 2, 3]);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 300 220");
  svg.classList.add("mg-svg");
  root.append(svg);
  const NS = "http://www.w3.org/2000/svg";
  const y = (i: number) => 35 + i * 50;
  const connected = new Set<number>();
  const mk = (tag: string, attrs: Record<string, string | number>) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
    return el;
  };
  const lines: SVGLineElement[] = [];
  COLORS.forEach((c, i) => {
    lines[i] = mk("line", { x1: 40, y1: y(i), x2: 40, y2: y(i), stroke: c, "stroke-width": 8, "stroke-linecap": "round" }) as SVGLineElement;
    mk("rect", { x: 10, y: y(i) - 14, width: 34, height: 28, rx: 6, fill: c, "data-l": i, class: "mg-hit" });
  });
  order.forEach((ci, slot) => mk("rect", { x: 256, y: y(slot) - 14, width: 34, height: 28, rx: 6, fill: "none", stroke: COLORS[ci]!, "stroke-width": 4, "data-r": ci, class: "mg-hit" }));

  let drag: number | null = null;
  const pt = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 300, y: ((e.clientY - r.top) / r.height) * 220 };
  };
  svg.addEventListener("pointerdown", (e) => {
    const l = (e.target as Element).getAttribute("data-l");
    if (l === null || connected.has(+l)) return;
    drag = +l;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (drag === null) return;
    const p = pt(e);
    lines[drag]!.setAttribute("x2", String(p.x));
    lines[drag]!.setAttribute("y2", String(p.y));
  });
  svg.addEventListener("pointerup", (e) => {
    if (drag === null) return;
    const p = pt(e);
    const slot = Math.round((p.y - 35) / 50);
    const ok = p.x > 220 && order[slot] === drag;
    const line = lines[drag]!;
    if (ok) {
      line.setAttribute("x2", "256");
      line.setAttribute("y2", String(y(slot)));
      connected.add(drag);
      sfx.tap();
      if (connected.size === 4) done();
    } else {
      line.setAttribute("x2", "40");
      line.setAttribute("y2", line.getAttribute("y1")!);
    }
    drag = null;
  });
  return () => {};
};

/** Rotate the dial until your wave lies on top of the reference wave. Also the comms fix. */
const align: Game = (root, done) => {
  const [, ctx] = canvas(root, 300, 160);
  const target = 0.6 + Math.random() * 2.2;
  const slider = h("input", { type: "range", min: 0, max: 3.4, step: 0.01, value: target > 1.7 ? 0.2 : 3.2, class: "mg-range", "aria-label": "Signal phase" });
  root.append(slider);
  let held = 0, last = performance.now(), raf = 0, finished = false;
  const draw = (now: number) => {
    const dt = now - last; last = now;
    const phase = +slider.value;
    ctx.clearRect(0, 0, 300, 160);
    const wave = (ph: number, color: string, w: number) => {
      ctx.beginPath();
      for (let x = 0; x <= 300; x += 3) ctx.lineTo(x, 80 + Math.sin(x / 28 + ph + now / 600) * 40);
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
    };
    wave(target, "rgba(61,224,255,.45)", 8);
    const close = Math.abs(phase - target) < 0.12;
    wave(phase, close ? "#4DFFB0" : "#FFB23D", 3);
    held = close ? held + dt : 0;
    ctx.fillStyle = "#A9B0DD"; ctx.font = "12px Inter";
    ctx.fillText(close ? "Locked… hold it" : "Drag the slider", 10, 152);
    if (held > 700 && !finished) { finished = true; done(); return; }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};

/** Tap the column that matches the colour of the next block. */
const defrag: Game = (root, done) => {
  const queue = shuffle([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const next = h("div", { class: "mg-next" });
  const cols = h("div", { class: "mg-cols" });
  const counts = [0, 0, 0];
  const render = () => {
    next.innerHTML = "";
    queue.slice(0, 3).forEach((c, i) => next.append(h("span", { class: "mg-block", style: `background:${COLORS[c]};opacity:${1 - i * 0.3}` })));
  };
  for (let c = 0; c < 3; c++) {
    const col = h("button", { class: "mg-col", style: `border-color:${COLORS[c]}`, "aria-label": `Column ${c + 1}` });
    col.addEventListener("click", () => {
      if (!queue.length) return;
      if (queue[0] !== c) { sfx.wrong(); col.classList.add("shake"); setTimeout(() => col.classList.remove("shake"), 300); return; }
      queue.shift();
      counts[c]!++;
      col.append(h("span", { class: "mg-block", style: `background:${COLORS[c]}` }));
      sfx.tap();
      render();
      if (!queue.length) done();
    });
    cols.append(col);
  }
  root.append(next, cols);
  render();
  return () => {};
};

/** Hold the valve; let go while the needle is in the green band. */
const purge: Game = (root, done) => {
  const [, ctx] = canvas(root, 300, 150);
  const band = 0.45 + Math.random() * 0.35;
  const btn = h("button", { class: "mg-hold" }, "Hold valve");
  root.append(btn);
  let level = 0, holding = false, raf = 0, finished = false;
  const press = (on: boolean) => () => {
    if (finished) return;
    holding = on;
    if (!on) {
      if (Math.abs(level - band) < 0.07) { finished = true; done(); }
      else if (level > 0.02) { sfx.wrong(); level = 0; }
    }
  };
  btn.addEventListener("pointerdown", press(true));
  btn.addEventListener("pointerup", press(false));
  btn.addEventListener("pointerleave", () => holding && press(false)());
  const draw = () => {
    level = holding ? Math.min(1, level + 0.008) : Math.max(0, level - 0.004);
    if (level >= 1) { level = 0; holding = false; sfx.wrong(); }
    ctx.clearRect(0, 0, 300, 150);
    ctx.fillStyle = "#171B36"; ctx.fillRect(20, 50, 260, 40);
    ctx.fillStyle = "rgba(77,255,176,.35)"; ctx.fillRect(20 + (band - 0.07) * 260, 50, 0.14 * 260, 40);
    ctx.fillStyle = level > band + 0.07 ? "#FF5E7A" : "#3DE0FF"; ctx.fillRect(20, 58, level * 260, 24);
    ctx.fillStyle = "#A9B0DD"; ctx.font = "12px Inter"; ctx.fillText("Release in the green band", 20, 120);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};

/** Three spinning rings: tap to stop each when its gap reaches the top marker. */
const calibrate: Game = (root, done) => {
  const [c, ctx] = canvas(root, 240, 240);
  const rings = [0, 1, 2].map((i) => ({ r: 40 + i * 26, ang: Math.random() * 6.28, speed: (0.025 + i * 0.012) * (i % 2 ? -1 : 1), stopped: false }));
  let current = 0, raf = 0;
  const tap = () => {
    const ring = rings[current];
    if (!ring) return;
    const a = ((ring.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const offset = Math.min(Math.abs(a - Math.PI * 1.5), Math.PI * 2 - Math.abs(a - Math.PI * 1.5));
    if (offset < 0.32) { ring.stopped = true; current++; sfx.tap(); if (current === 3) setTimeout(done, 250); }
    else sfx.wrong();
  };
  c.addEventListener("pointerdown", tap);
  const btn = h("button", { class: "mg-hold" }, "Stop ring");
  btn.addEventListener("click", tap);
  root.append(btn);
  const draw = () => {
    ctx.clearRect(0, 0, 240, 240);
    ctx.fillStyle = "#FFB23D"; ctx.beginPath(); ctx.moveTo(120, 8); ctx.lineTo(112, -4 + 4); ctx.lineTo(128, 0); ctx.fill();
    ctx.fillRect(118, 4, 4, 16);
    rings.forEach((ring, i) => {
      if (!ring.stopped) ring.ang += ring.speed;
      ctx.beginPath();
      ctx.arc(120, 120, ring.r, ring.ang + 0.35, ring.ang + Math.PI * 2 - 0.35);
      ctx.strokeStyle = ring.stopped ? "#4DFFB0" : i === current ? "#3DE0FF" : "#3A4170";
      ctx.lineWidth = 12; ctx.stroke();
    });
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};

/** Send each packet left or right by colour. */
const sort: Game = (root, done) => {
  const packets = shuffle([0, 0, 0, 0, 1, 1, 1, 1]);
  const pkt = h("div", { class: "mg-packet" });
  const left = h("button", { class: "mg-bin", style: `border-color:${COLORS[0]}` }, "◀ Coral");
  const right = h("button", { class: "mg-bin", style: `border-color:${COLORS[1]}` }, "Cyan ▶");
  const count = h("div", { class: "mg-count" });
  const show = () => {
    pkt.style.background = COLORS[packets[0] ?? 0]!;
    count.textContent = `${8 - packets.length} / 8`;
  };
  const send = (side: number) => () => {
    if (!packets.length) return;
    if (packets[0] !== side) { sfx.wrong(); pkt.classList.add("shake"); setTimeout(() => pkt.classList.remove("shake"), 300); return; }
    packets.shift();
    sfx.tap();
    show();
    if (!packets.length) done();
  };
  left.addEventListener("click", send(0));
  right.addEventListener("click", send(1));
  let sx = 0;
  pkt.addEventListener("pointerdown", (e) => { sx = e.clientX; });
  pkt.addEventListener("pointerup", (e) => { const dx = e.clientX - sx; if (Math.abs(dx) > 30) send(dx < 0 ? 0 : 1)(); });
  root.append(h("div", { class: "mg-sort" }, left, pkt, right), count);
  show();
  return () => {};
};

/** Tap breaches before they spread. Patch ten to finish. */
const firewall: Game = (root, done) => {
  const grid = h("div", { class: "mg-grid" });
  const cells = Array.from({ length: 16 }, (_, i) => {
    const b = h("button", { class: "mg-cell", "aria-label": `Cell ${i + 1}` });
    grid.append(b);
    return b;
  });
  const breached = new Set<number>();
  let patched = 0, finished = false;
  const label = h("div", { class: "mg-count" }, "0 / 10 patched");
  cells.forEach((b, i) => b.addEventListener("click", () => {
    if (!breached.has(i) || finished) return;
    breached.delete(i);
    b.classList.remove("on");
    patched++;
    label.textContent = `${patched} / 10 patched`;
    sfx.tap();
    if (patched >= 10) { finished = true; done(); }
  }));
  const breach = (i: number) => { breached.add(i); cells[i]!.classList.add("on"); };
  breach(rand(16));
  const timer = window.setInterval(() => {
    if (finished) return;
    // Each breach may spread to a neighbour; a new one also appears.
    for (const i of [...breached]) {
      if (Math.random() < 0.35) {
        const n = [i - 4, i + 4, i % 4 ? i - 1 : -1, i % 4 !== 3 ? i + 1 : -1].filter((k) => k >= 0 && k < 16);
        breach(n[rand(n.length)]!);
      }
    }
    breach(rand(16));
    if (breached.size >= 16) { sfx.wrong(); patched = 0; label.textContent = "Overrun! 0 / 10"; for (const i of [...breached]) { breached.delete(i); cells[i]!.classList.remove("on"); } breach(rand(16)); }
  }, 1100);
  root.append(grid, label);
  return () => window.clearInterval(timer);
};

/** Two stages: download in the Lab, upload in the Server Vault. Keep the panel open. */
const upload: Game = (root, done, stage) => {
  const bar = h("div", { class: "mg-bar" }, h("i"));
  const label = h("div", { class: "mg-count" }, stage === 0 ? "Downloading backup…" : "Uploading backup…");
  root.append(h("div", { class: "mg-file" }, stage === 0 ? "⬇" : "⬆"), bar, label);
  const start = performance.now();
  const total = CONFIG.tasks.longStageMs;
  let raf = 0;
  const tick = () => {
    const k = Math.min(1, (performance.now() - start) / total);
    (bar.firstChild as HTMLElement).style.width = `${k * 100}%`;
    label.textContent = `${stage === 0 ? "Downloading" : "Uploading"}… ${Math.ceil((total * (1 - k)) / 1000)}s`;
    if (k >= 1) { done(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
};

/** Blackout fix: flip all five breakers back on. */
const blackout: Game = (root, done) => {
  const wrap = h("div", { class: "mg-switches" });
  const state = [0, 1, 2, 3, 4].map(() => Math.random() < 0.5);
  if (state.every(Boolean)) state[rand(5)] = false;
  state.forEach((on, i) => {
    const b = h("button", { class: `mg-switch${on ? " on" : ""}`, "aria-label": `Breaker ${i + 1}` });
    b.addEventListener("click", () => {
      state[i] = !state[i];
      b.classList.toggle("on", state[i]);
      sfx.tap();
      if (state.every(Boolean)) done();
    });
    wrap.append(b);
  });
  root.append(wrap, h("div", { class: "mg-count" }, "Turn every breaker on"));
  return () => {};
};

export const GAMES: Record<GameKind, Game> = {
  reroute, align, defrag, purge, calibrate, sort, firewall, upload, blackout, comms: align,
};
