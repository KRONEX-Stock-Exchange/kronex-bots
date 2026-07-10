import { randomNumber } from "./math.js";
import type { FairPriceConfig, Rng } from "../types.js";

export interface FairPriceUpdate {
  previousFairPrice: number;
  fairPrice: number;
  fairPriceChange: number;
  fairPriceChangePct: number;
  currentPrice: number;
  randomDeltaPct: number;
  divergencePct: number;
}

export class FairPriceWorker {
  private fairPrice: number | null = null;
  private readonly config: FairPriceConfig;
  private readonly rng: Rng;

  constructor(configOrRng: FairPriceConfig | Rng = { intervalMs: 500, randomDeltaMinPct: -0.56, randomDeltaMaxPct: 0.56 }, rng: Rng = Math.random) {
    if (typeof configOrRng === "function") {
      this.config = { intervalMs: 500, randomDeltaMinPct: -0.56, randomDeltaMaxPct: 0.56 };
      this.rng = configOrRng;
      return;
    }

    this.config = this.normalizeConfig(configOrRng);
    this.rng = rng;
  }

  initialize(currentPrice: number): void {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      throw new Error(`invalid initial fair price anchor: ${currentPrice}`);
    }

    this.fairPrice = Math.max(1, currentPrice);
  }

  get value(): number {
    if (this.fairPrice === null) {
      throw new Error("fair price is not initialized");
    }

    return this.fairPrice;
  }

  replaceValue(nextFairPrice: number): void {
    if (!Number.isFinite(nextFairPrice) || nextFairPrice <= 0) {
      throw new Error(`invalid fair price replacement: ${nextFairPrice}`);
    }

    this.fairPrice = Math.max(1, nextFairPrice);
  }

  update(currentPrice: number): FairPriceUpdate {
    const previousFairPrice = this.value;
    const randomDeltaPct = randomNumber(this.config.randomDeltaMinPct, this.config.randomDeltaMaxPct, this.rng);
    const nextFairPrice = Math.max(1, previousFairPrice * (1 + randomDeltaPct / 100));
    this.fairPrice = nextFairPrice;
    const fairPriceChange = nextFairPrice - previousFairPrice;

    return {
      previousFairPrice,
      fairPrice: nextFairPrice,
      fairPriceChange,
      fairPriceChangePct: previousFairPrice > 0 ? (fairPriceChange / previousFairPrice) * 100 : 0,
      currentPrice,
      randomDeltaPct,
      divergencePct: Number.isFinite(currentPrice) && currentPrice > 0
        ? ((nextFairPrice - currentPrice) / currentPrice) * 100
        : 0
    };
  }

  private normalizeConfig(config: FairPriceConfig): FairPriceConfig {
    const intervalMs = Number.isFinite(config.intervalMs) && config.intervalMs > 0 ? config.intervalMs : 500;
    const min = Number.isFinite(config.randomDeltaMinPct) ? config.randomDeltaMinPct : -0.56;
    const max = Number.isFinite(config.randomDeltaMaxPct) ? config.randomDeltaMaxPct : 0.56;
    return min <= max
      ? { intervalMs, randomDeltaMinPct: min, randomDeltaMaxPct: max }
      : { intervalMs, randomDeltaMinPct: max, randomDeltaMaxPct: min };
  }
}
