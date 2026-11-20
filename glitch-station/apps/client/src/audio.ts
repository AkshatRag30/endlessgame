/**
 * All sounds are synthesised with WebAudio: no audio files, no licences.
 * Browsers only allow audio after a tap, so the context starts on first use.
 */

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean): void { muted = m; }
export function isMuted(): boolean { return muted; }

export function unlockAudio(): void {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { ctx = null; }
  }
  void ctx?.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.12, slideTo?: number): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sfx = {
  tap: () => tone(660, 0, 0.06, "square", 0.04),
  taskDone: () => { tone(523, 0, 0.12, "triangle"); tone(784, 0.1, 0.18, "triangle"); },
  stageDone: () => tone(700, 0, 0.12, "triangle"),
  wrong: () => tone(140, 0, 0.18, "sawtooth", 0.06),
  report: () => { for (let i = 0; i < 3; i++) tone(880, i * 0.18, 0.12, "square", 0.08); },
  meeting: () => { tone(220, 0, 0.6, "triangle", 0.16); tone(330, 0.05, 0.6, "triangle", 0.1); },
  eliminate: () => tone(300, 0, 0.35, "sawtooth", 0.12, 60),
  died: () => { tone(400, 0, 0.5, "sine", 0.14, 80); },
  eject: () => tone(900, 0, 1.0, "sine", 0.1, 120),
  alarm: () => { tone(520, 0, 0.25, "square", 0.06); tone(390, 0.28, 0.25, "square", 0.06); },
  conduit: () => tone(180, 0, 0.25, "triangle", 0.1, 520),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.13, 0.3, "triangle", 0.12)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.18, 0.35, "triangle", 0.12)),
  reveal: () => { tone(196, 0, 0.8, "sine", 0.14); tone(294, 0.2, 0.8, "sine", 0.1); },
};
