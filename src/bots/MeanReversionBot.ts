import { BotKind, OrderSide } from "../constants.js";
import { randomInt } from "../domain/math.js";
import type { MarketSnapshot, OrderDraft, Rng, RuntimeConfig } from "../types.js";
import type { OrderRouter } from "../io/OrderRouter.js";
import {
  type BotRunner,
  type BotStateGetter,
  createMarketOrder,
  getReadyState
} from "./BotRuntime.js";

type ReversionSide = typeof OrderSide.BUY | typeof OrderSide.SELL;

export class MeanReversionBot implements BotRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy = false;
  private activeSide: ReversionSide | null = null;
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

    if (this.activeSide !== null) {
      this.logEnded(this.activeSide, "stop");
      this.activeSide = null;
    }
  }

  createOrder(snapshot: MarketSnapshot, fairPrice: number): OrderDraft | null {
    return this.createOrderForSide(this.activeSideFor(snapshot, fairPrice), snapshot);
  }

  private activeSideFor(snapshot: MarketSnapshot, fairPrice: number): ReversionSide | null {
    if (snapshot.lastPrice === null || fairPrice <= 0) {
      return null;
    }

    const divergencePct = ((snapshot.lastPrice - fairPrice) / fairPrice) * 100;
    if (divergencePct >= 5) {
      return OrderSide.SELL;
    }

    if (divergencePct <= -5) {
      return OrderSide.BUY;
    }

    return null;
  }

  private createOrderForSide(side: ReversionSide | null, snapshot: MarketSnapshot): OrderDraft | null {
    if (side === null) {
      return null;
    }

    if (side === OrderSide.SELL) {
      return createMarketOrder({
        config: this.config,
        botKind: BotKind.MEAN_REVERSION,
        side: OrderSide.SELL,
        snapshot,
        minNotional: this.config.bots.meanReversion.minNotional,
        maxNotional: this.config.bots.meanReversion.maxNotional,
        reason: "price_above_fair_by_5pct",
        rng: this.rng
      });
    }

    return createMarketOrder({
      config: this.config,
      botKind: BotKind.MEAN_REVERSION,
      side: OrderSide.BUY,
      snapshot,
      minNotional: this.config.bots.meanReversion.minNotional,
      maxNotional: this.config.bots.meanReversion.maxNotional,
      reason: "price_below_fair_by_5pct",
      rng: this.rng
    });
  }

  private async tick(): Promise<void> {
    const readyState = getReadyState(this.getState);
    if (readyState === null || this.busy) {
      return;
    }

    const activeSide = this.activeSideFor(readyState.snapshot, readyState.fairPrice);
    this.updateActivity(activeSide, readyState.snapshot, readyState.fairPrice);
    const order = this.createOrderForSide(activeSide, readyState.snapshot);
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

  private updateActivity(nextSide: ReversionSide | null, snapshot: MarketSnapshot, fairPrice: number): void {
    if (this.activeSide === nextSide) {
      return;
    }

    if (this.activeSide !== null) {
      this.logEnded(this.activeSide, "condition_changed", snapshot, fairPrice);
    }

    if (nextSide !== null) {
      this.logStarted(nextSide, snapshot, fairPrice);
    }

    this.activeSide = nextSide;
  }

  private logStarted(side: ReversionSide, snapshot: MarketSnapshot, fairPrice: number): void {
    const divergencePct = snapshot.lastPrice === null || fairPrice <= 0
      ? "n/a"
      : `${(((snapshot.lastPrice - fairPrice) / fairPrice) * 100).toFixed(4)}%`;
    console.log(`[MeanReversionBot] started side=${side} lastPrice=${snapshot.lastPrice ?? "n/a"} fairPrice=${fairPrice.toFixed(2)} divergence=${divergencePct}`);
  }

  private logEnded(
    side: ReversionSide,
    reason: string,
    snapshot?: MarketSnapshot,
    fairPrice?: number
  ): void {
    const divergencePct = snapshot?.lastPrice === null || snapshot?.lastPrice === undefined || fairPrice === undefined || fairPrice <= 0
      ? "n/a"
      : `${(((snapshot.lastPrice - fairPrice) / fairPrice) * 100).toFixed(4)}%`;
    const lastPrice = snapshot?.lastPrice ?? "n/a";
    const fairPriceText = fairPrice === undefined ? "n/a" : fairPrice.toFixed(2);
    console.log(`[MeanReversionBot] ended side=${side} reason=${reason} lastPrice=${lastPrice} fairPrice=${fairPriceText} divergence=${divergencePct}`);
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }

    const delayMs = randomInt(
      this.config.bots.meanReversion.minIntervalMs,
      this.config.bots.meanReversion.maxIntervalMs,
      this.rng
    );
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        this.scheduleNext();
      });
    }, delayMs);
  }
}
