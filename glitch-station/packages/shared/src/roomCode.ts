import { CONFIG } from "./config";

const { codeAlphabet, codeLength } = CONFIG.room;
const CODE_PATTERN = new RegExp(`^[${codeAlphabet}]{${codeLength}}$`);

/** Uppercases and trims user input so "  abcd " joins room ABCD. */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** Random room code. Pass a custom random source for tests. */
export function generateRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < codeLength; i++) {
    code += codeAlphabet[Math.floor(random() * codeAlphabet.length)];
  }
  return code;
}
