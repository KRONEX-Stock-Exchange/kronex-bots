export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function randomInt(min: number, max: number, rng: () => number = Math.random): number {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  return lower + Math.floor(rng() * (upper - lower + 1));
}

export function randomNumber(min: number, max: number, rng: () => number = Math.random): number {
  return min + rng() * (max - min);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.replaceAll(",", "").trim();
    if (normalized === "") {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function toPositiveNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function toNonNegativeNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}
