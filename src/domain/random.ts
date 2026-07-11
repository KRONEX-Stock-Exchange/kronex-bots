import { createHash, randomBytes } from "node:crypto";
import type { Rng } from "../types.js";

type SeedPart = string | number;

export function createRunSeed(): string {
  return randomBytes(16).toString("hex");
}

export function deriveSeed(baseSeed: string, ...parts: SeedPart[]): string {
  const seedText = [baseSeed, ...parts.map(String)].join(":");
  return createHash("sha256").update(seedText).digest("hex");
}

export function seedFingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 8);
}

export function createSeededRng(seed: string): Rng {
  const seedBytes = createHash("sha256").update(seed).digest();
  let state = seedBytes.readUInt32LE(0);

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function randomDelayMs(maxDelayMs: number, rng: Rng): number {
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0) {
    return 0;
  }

  return Math.floor(rng() * (Math.floor(maxDelayMs) + 1));
}
