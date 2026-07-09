import { randomNumber } from "./math.js";
import type { FairPriceEventConfig, Rng } from "../types.js";

export interface FairPriceEventUpdate {
  previousFairPrice: number;
  fairPrice: number;
  fairPriceChange: number;
  fairPriceChangePct: number;
  eventRatePct: number;
}

export class FairPriceEventWorker {
  private readonly config: FairPriceEventConfig;
  private readonly rng: Rng;

  constructor(config: FairPriceEventConfig, rng: Rng = Math.random) {
    this.config = this.normalizeConfig(config);
    this.rng = rng;
  }

  update(currentFairPrice: number): FairPriceEventUpdate {
    if (!Number.isFinite(currentFairPrice) || currentFairPrice <= 0) {
      throw new Error(`invalid fair price for event worker: ${currentFairPrice}`);
    }

    const eventRatePct = randomNumber(this.config.minRatePct, this.config.maxRatePct, this.rng);
    const nextFairPrice = Math.max(1, currentFairPrice * (1 + eventRatePct / 100));
    const fairPriceChange = nextFairPrice - currentFairPrice;

    return {
      previousFairPrice: currentFairPrice,
      fairPrice: nextFairPrice,
      fairPriceChange,
      fairPriceChangePct: (fairPriceChange / currentFairPrice) * 100,
      eventRatePct
    };
  }

  private normalizeConfig(config: FairPriceEventConfig): FairPriceEventConfig {
    const intervalMs = Number.isFinite(config.intervalMs) && config.intervalMs > 0
      ? config.intervalMs
      : 30_000;
    const minRatePct = Number.isFinite(config.minRatePct) ? config.minRatePct : -40;
    const maxRatePct = Number.isFinite(config.maxRatePct) ? config.maxRatePct : 40;

    return minRatePct <= maxRatePct
      ? { intervalMs, minRatePct, maxRatePct }
      : { intervalMs, minRatePct: maxRatePct, maxRatePct: minRatePct };
  }
}
