import { BotKind, OrderSide } from "../constants.js";
import { clamp, randomInt } from "../domain/math.js";
import { allowedOrderSides, filterAllowedOrderSides } from "../domain/priceLimits.js";
import type { MarketSnapshot, OrderDraft, Rng, RuntimeConfig } from "../types.js";
import type { OrderRouter } from "../io/OrderRouter.js";
import {
  type BotRunner,
  type BotStateGetter,
  createMarketOrder,
  getReadyState
} from "./BotRuntime.js";

export class NoiseTakerBot implements BotRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy = false;
  private readonly rng: Rng;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly router: OrderRouter,
    private readonly getState: BotStateGetter,
    rng: Rng = Math.random
  ) {
    this.rng = rng;
  }

  start(): void {
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  createOrder(snapshot: MarketSnapshot, fairPrice: number): OrderDraft | null {
    if (snapshot.lastPrice === null || fairPrice <= 0) {
      return null;
    }

    for (const side of this.sideCandidates(snapshot, fairPrice)) {
      const order = createMarketOrder({
        config: this.config,
        botKind: BotKind.NOISE_TAKER,
        side,
        snapshot,
        minNotional: this.config.bots.noiseTaker.minNotional,
        maxNotional: this.config.bots.noiseTaker.maxNotional,
        reason: "probabilistic_noise_order",
        rng: this.rng
      });

      if (order !== null) {
        return order;
      }
    }

    return null;
  }

  buyProbabilityPct(currentPrice: number, fairPrice: number): number {
    const divergencePct = ((fairPrice - currentPrice) / fairPrice) * 100;
    const {
      minSideProbabilityPct,
      maxSideProbabilityPct,
      fullBiasDivergencePct
    } = this.config.bots.noiseTaker;
    const biasRatio = clamp(divergencePct / fullBiasDivergencePct, -1, 1);
    const buyProbability = biasRatio >= 0
      ? 50 + biasRatio * (maxSideProbabilityPct - 50)
      : 50 + biasRatio * (50 - minSideProbabilityPct);

    return clamp(buyProbability, minSideProbabilityPct, maxSideProbabilityPct);
  }

  private async tick(): Promise<void> {
    const readyState = getReadyState(this.getState);
    if (readyState === null || this.busy) {
      return;
    }

    const order = this.createOrder(readyState.snapshot, readyState.fairPrice);
    if (order === null) {
      return;
    }

    this.busy = true;
    try {
      await this.router.route(order, readyState.snapshot, readyState.fairPrice);
    } finally {
      this.busy = false;
    }
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }

    const delayMs = randomInt(
      this.config.bots.noiseTaker.minIntervalMs,
      this.config.bots.noiseTaker.maxIntervalMs,
      this.rng
    );
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        this.scheduleNext();
      });
    }, delayMs);
  }

  private chooseSide(currentPrice: number, fairPrice: number): typeof OrderSide.BUY | typeof OrderSide.SELL {
    const buyProbability = this.buyProbabilityPct(currentPrice, fairPrice) / 100;
    return this.rng() < buyProbability ? OrderSide.BUY : OrderSide.SELL;
  }

  private sideCandidates(snapshot: MarketSnapshot, fairPrice: number): Array<typeof OrderSide.BUY | typeof OrderSide.SELL> {
    if (snapshot.lastPrice === null) {
      return [];
    }

    const preferredSide = this.chooseSide(snapshot.lastPrice, fairPrice);
    const fallbackSide = this.fairPriceDirectionalSide(snapshot.lastPrice, fairPrice);
    const candidates = fallbackSide === null || fallbackSide === preferredSide
      ? [preferredSide]
      : [preferredSide, fallbackSide];
    const allowedFallbackSides = allowedOrderSides(snapshot) as Array<typeof OrderSide.BUY | typeof OrderSide.SELL>;
    const allowedCandidates = filterAllowedOrderSides(candidates, snapshot);

    return allowedCandidates.length > 0 ? allowedCandidates : allowedFallbackSides;
  }

  private fairPriceDirectionalSide(
    currentPrice: number,
    fairPrice: number
  ): typeof OrderSide.BUY | typeof OrderSide.SELL | null {
    if (fairPrice >= currentPrice * 1.005) {
      return OrderSide.BUY;
    }

    if (fairPrice <= currentPrice * 0.995) {
      return OrderSide.SELL;
    }

    return null;
  }
}
