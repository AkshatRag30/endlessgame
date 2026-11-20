/**
 * Movement input: WASD/arrows on desktop, a floating joystick on touch
 * screens (left thumb anywhere on the left half, PRD section 5).
 */
export class MoveInput {
  private keys = new Set<string>();
  private stick: { id: number; ox: number; oy: number; dx: number; dy: number } | null = null;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  enabled = true;

  constructor(private readonly zone: HTMLElement) {
    this.base = document.createElement("div");
    this.base.className = "stick";
    this.knob = document.createElement("div");
    this.knob.className = "knob";
    this.base.append(this.knob);
    document.body.append(this.base);

    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());

    zone.addEventListener("pointerdown", (e) => {
      if (!this.enabled || this.stick || e.pointerType === "mouse") return;
      if (e.clientX > window.innerWidth * 0.55) return;
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      zone.setPointerCapture(e.pointerId);
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add("on");
      this.moveKnob(0, 0);
    });
    zone.addEventListener("pointermove", (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      const max = 48;
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      this.stick.dx = dx / max;
      this.stick.dy = dy / max;
      this.moveKnob(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null;
      this.base.classList.remove("on");
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  private moveKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** Direction in tiles space, length up to 1. */
  get(): { dx: number; dy: number } {
    if (!this.enabled) return { dx: 0, dy: 0 };
    if (this.stick) {
      const len = Math.hypot(this.stick.dx, this.stick.dy);
      return len < 0.18 ? { dx: 0, dy: 0 } : { dx: this.stick.dx, dy: this.stick.dy };
    }
    const k = this.keys;
    let dx = 0, dy = 0;
    if (k.has("a") || k.has("arrowleft")) dx -= 1;
    if (k.has("d") || k.has("arrowright")) dx += 1;
    if (k.has("w") || k.has("arrowup")) dy -= 1;
    if (k.has("s") || k.has("arrowdown")) dy += 1;
    const len = Math.hypot(dx, dy);
    return len ? { dx: dx / len, dy: dy / len } : { dx: 0, dy: 0 };
  }

  reset(): void {
    this.keys.clear();
    this.stick = null;
    this.base.classList.remove("on");
  }
}
