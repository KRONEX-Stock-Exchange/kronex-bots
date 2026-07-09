import { randomInt } from "./math.js";
import type { FairPriceConfig, Rng } from "../types.js";

export interface FairPriceUpdate {
  previousFairPrice: number;
  fairPrice: number;
  fairPriceChange: number;
  fairPriceChangePct: number;
  currentPrice: number;
  randomDelta: number;
  divergencePct: number;
  corrected: boolean;
}

export class FairPriceWorker {
  private fairPrice: number | null = null;
  private readonly config: FairPriceConfig;
  private readonly rng: Rng;

  constructor(configOrRng: FairPriceConfig | Rng = { randomDeltaMin: -100, randomDeltaMax: 100 }, rng: Rng = Math.random) {
    if (typeof configOrRng === "function") {
      this.config = { randomDeltaMin: -100, randomDeltaMax: 100 };
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
    const randomDelta = randomInt(this.config.randomDeltaMin, this.config.randomDeltaMax, this.rng);
    let nextFairPrice = Math.max(1, previousFairPrice + randomDelta);
    let corrected = false;

    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      const divergence = (nextFairPrice - currentPrice) / currentPrice;
      if (Math.abs(divergence) > 0.3) {
        nextFairPrice += (currentPrice - nextFairPrice) * 0.1;
        corrected = true;
      }
    }

    nextFairPrice = Math.max(1, nextFairPrice);
    this.fairPrice = nextFairPrice;
    const fairPriceChange = nextFairPrice - previousFairPrice;

    return {
      previousFairPrice,
      fairPrice: nextFairPrice,
      fairPriceChange,
      fairPriceChangePct: previousFairPrice > 0 ? (fairPriceChange / previousFairPrice) * 100 : 0,
      currentPrice,
      randomDelta,
      divergencePct: Number.isFinite(currentPrice) && currentPrice > 0
        ? ((nextFairPrice - currentPrice) / currentPrice) * 100
        : 0,
      corrected
    };
  }

  private normalizeConfig(config: FairPriceConfig): FairPriceConfig {
    const min = Number.isFinite(config.randomDeltaMin) ? config.randomDeltaMin : -100;
    const max = Number.isFinite(config.randomDeltaMax) ? config.randomDeltaMax : 100;
    return min <= max
      ? { randomDeltaMin: min, randomDeltaMax: max }
      : { randomDeltaMin: max, randomDeltaMax: min };
  }
}
