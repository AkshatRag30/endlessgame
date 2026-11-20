/**
 * Twelve suit colours chosen to stay distinguishable, each paired with a
 * pattern so colour blind players can still tell suits apart (PRD section 13).
 */
export interface SuitColor { name: string; hex: number; css: string; pattern: Pattern }
export type Pattern = "plain" | "stripes" | "dots" | "chevron" | "cross" | "ring" | "split" | "diamond" | "bars" | "star" | "wave" | "grid";

export const SUIT_COLORS: SuitColor[] = [
  { name: "Mint", hex: 0x4dffb0, css: "#4DFFB0", pattern: "plain" },
  { name: "Cyan", hex: 0x3de0ff, css: "#3DE0FF", pattern: "stripes" },
  { name: "Coral", hex: 0xff5e7a, css: "#FF5E7A", pattern: "dots" },
  { name: "Amber", hex: 0xffb23d, css: "#FFB23D", pattern: "chevron" },
  { name: "Violet", hex: 0xa77bff, css: "#A77BFF", pattern: "cross" },
  { name: "White", hex: 0xf2f4ff, css: "#F2F4FF", pattern: "ring" },
  { name: "Blue", hex: 0x4a6bff, css: "#4A6BFF", pattern: "split" },
  { name: "Lime", hex: 0xc6ff3d, css: "#C6FF3D", pattern: "diamond" },
  { name: "Rose", hex: 0xff7ad9, css: "#FF7AD9", pattern: "bars" },
  { name: "Brown", hex: 0xa0703d, css: "#A0703D", pattern: "star" },
  { name: "Teal", hex: 0x1fae9b, css: "#1FAE9B", pattern: "wave" },
  { name: "Slate", hex: 0x7d86b8, css: "#7D86B8", pattern: "grid" },
];

export const ACCESSORIES = ["none", "antenna", "cap", "halo", "headset", "sprout"] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export function isAccessory(v: unknown): v is Accessory {
  return typeof v === "string" && (ACCESSORIES as readonly string[]).includes(v);
}

export const BOT_NAMES = ["Volt", "Pixel", "Byte", "Nova", "Flux", "Echo", "Quark", "Zip", "Rune", "Blip"];
