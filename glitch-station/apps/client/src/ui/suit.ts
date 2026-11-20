import { SUIT_COLORS, type Accessory, type Pattern } from "@glitch/shared";

/**
 * SVG suit used in menus (lobby, meeting cards, results). The in game
 * version is drawn by Phaser in game/sprites.ts with the same shapes.
 */

export function patternSvg(pattern: Pattern, ink: string): string {
  switch (pattern) {
    case "plain": return "";
    case "stripes": return `<path d="M14 30h28M14 36h28M14 42h28" stroke="${ink}" stroke-width="2.5"/>`;
    case "dots": return `<circle cx="21" cy="34" r="2.6" fill="${ink}"/><circle cx="35" cy="34" r="2.6" fill="${ink}"/><circle cx="28" cy="42" r="2.6" fill="${ink}"/>`;
    case "chevron": return `<path d="M17 32l11 7 11-7M17 40l11 7 11-7" stroke="${ink}" stroke-width="2.5" fill="none"/>`;
    case "cross": return `<path d="M28 29v16M20 37h16" stroke="${ink}" stroke-width="3"/>`;
    case "ring": return `<circle cx="28" cy="37" r="6" stroke="${ink}" stroke-width="2.5" fill="none"/>`;
    case "split": return `<path d="M28 26v26" stroke="${ink}" stroke-width="3"/>`;
    case "diamond": return `<path d="M28 30l6 7-6 7-6-7z" fill="${ink}"/>`;
    case "bars": return `<path d="M20 29v16M28 29v16M36 29v16" stroke="${ink}" stroke-width="2.5"/>`;
    case "star": return `<path d="M28 30l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z" fill="${ink}"/>`;
    case "wave": return `<path d="M15 36q4.5-5 9 0t9 0 9 0" stroke="${ink}" stroke-width="2.5" fill="none"/>`;
    case "grid": return `<path d="M21 29v16M35 29v16M15 34h26M15 41h26" stroke="${ink}" stroke-width="1.8"/>`;
  }
}

export function accessorySvg(a: Accessory): string {
  switch (a) {
    case "none": return "";
    case "antenna": return `<path d="M28 7V0" stroke="#F2F4FF" stroke-width="2.5"/><circle cx="28" cy="0" r="3" fill="#FF5E7A"/>`;
    case "cap": return `<path d="M13 12q15-12 30 0z" fill="#FFB23D"/><rect x="36" y="9" width="12" height="4" rx="2" fill="#FFB23D"/>`;
    case "halo": return `<ellipse cx="28" cy="2" rx="12" ry="3.5" stroke="#FFE27A" stroke-width="2.5" fill="none"/>`;
    case "headset": return `<path d="M12 22q0-16 16-16t16 16" stroke="#0B0D1A" stroke-width="3.5" fill="none"/><rect x="8" y="18" width="7" height="10" rx="3" fill="#3DE0FF"/>`;
    case "sprout": return `<path d="M28 8V2" stroke="#4DFFB0" stroke-width="2.5"/><path d="M28 3q-7-6-11 0q6 3 11 0zM28 3q7-6 11 0q-6 3-11 0z" fill="#4DFFB0"/>`;
  }
}

export function suitSvg(color: number, accessory: Accessory, opts: { dead?: boolean; size?: number } = {}): string {
  const c = SUIT_COLORS[color] ?? SUIT_COLORS[0]!;
  const size = opts.size ?? 44;
  const ink = "rgba(11,13,26,.45)";
  const body = `<rect x="10" y="8" width="36" height="46" rx="16" fill="${c.css}"/>
    <rect x="6" y="26" width="8" height="18" rx="4" fill="${c.css}" opacity=".85"/>
    ${patternSvg(c.pattern, ink)}
    <rect x="25" y="14" width="22" height="13" rx="6.5" fill="#0B0D1A"/>
    <rect x="28" y="16.5" width="16" height="8" rx="4" fill="#3DE0FF"/>
    <rect x="30" y="17.5" width="5" height="2.5" rx="1.2" fill="#F2F4FF" opacity=".8"/>
    <rect x="14" y="50" width="11" height="9" rx="4" fill="${c.css}"/><rect x="31" y="50" width="11" height="9" rx="4" fill="${c.css}"/>`;
  const dead = opts.dead ? `<path d="M10 10l36 46M46 10l-36 46" stroke="#FF5E7A" stroke-width="4" stroke-linecap="round"/>` : "";
  return `<svg viewBox="0 -6 56 68" width="${size}" height="${size}" aria-hidden="true" style="${opts.dead ? "opacity:.55" : ""}">${accessorySvg(accessory)}${body}${dead}</svg>`;
}
