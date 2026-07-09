import { BotKind, OrderSide } from "../constants.js";
import type { MarketSnapshot, OrderDraft, Rng, RuntimeConfig } from "../types.js";
import type { OrderRouter } from "../io/OrderRouter.js";
import {
  type BotRunner,
  type BotStateGetter,
  createMarketOrder,
  getReadyState
} from "./BotRuntime.js";

type Trend = "UP" | "DOWN" | "NONE";
type ActiveMomentumTrend = Exclude<Trend, "NONE">;
const MOMENTUM_CONSECUTIVE_MOVES = 30;
const MOMENTUM_REQUIRED_PRICE_COUNT = MOMENTUM_CONSECUTIVE_MOVES + 1;

export class MomentumBot implements BotRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private activeTrend: ActiveMomentumTrend | null = null;
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
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.bots.momentum.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.activeTrend !== null) {
      this.logEnded(this.activeTrend, "stop");
      this.activeTrend = null;
    }
  }

  createOrder(snapshot: MarketSnapshot, fairPrice: number): OrderDraft | null {
    return this.createOrderForTrend(this.activeTrendFor(snapshot, fairPrice), snapshot, fairPrice);
  }

  detectTrend(priceHistory: number[]): Trend {
    const prices = priceHistory.slice(-MOMENTUM_REQUIRED_PRICE_COUNT);
    if (prices.length < MOMENTUM_REQUIRED_PRICE_COUNT) {
      return "NONE";
    }

    const nonDecreasing = prices.every((price, index) => index === 0 || price >= prices[index - 1]);
    const hasRise = prices.some((price, index) => index > 0 && price > prices[index - 1]);
    if (nonDecreasing && hasRise) {
      return "UP";
    }

    const nonIncreasing = prices.every((price, index) => index === 0 || price <= prices[index - 1]);
    const hasDrop = prices.some((price, index) => index > 0 && price < prices[index - 1]);
    if (nonIncreasing && hasDrop) {
      return "DOWN";
    }

    return "NONE";
  }

  private activeTrendFor(snapshot: MarketSnapshot, fairPrice: number): ActiveMomentumTrend | null {
    if (snapshot.lastPrice === null) {
      return null;
    }

    const trend = this.detectTrend(snapshot.priceHistory);
    if (trend === "UP" && fairPrice >= snapshot.lastPrice * 1.005) {
      return "UP";
    }

    if (trend === "DOWN" && fairPrice <= snapshot.lastPrice * 0.995) {
      return "DOWN";
    }

    return null;
  }

  private createOrderForTrend(
    trend: ActiveMomentumTrend | null,
    snapshot: MarketSnapshot,
    fairPrice: number
  ): OrderDraft | null {
    if (snapshot.lastPrice === null || trend === null) {
      return null;
    }

    if (trend === "UP") {
      return createMarketOrder({
        config: this.config,
        botKind: BotKind.MOMENTUM,
        side: OrderSide.BUY,
        snapshot,
        minNotional: this.config.bots.momentum.minNotional,
        maxNotional: this.config.bots.momentum.maxNotional,
        reason: "thirty_step_rising_momentum",
        rng: this.rng
      });
    }

    return createMarketOrder({
      config: this.config,
      botKind: BotKind.MOMENTUM,
      side: OrderSide.SELL,
      snapshot,
      minNotional: this.config.bots.momentum.minNotional,
      maxNotional: this.config.bots.momentum.maxNotional,
      reason: "thirty_step_falling_momentum",
      rng: this.rng
    });
  }

  private async tick(): Promise<void> {
    const readyState = getReadyState(this.getState);
    if (readyState === null || this.busy) {
      return;
    }

    const activeTrend = this.activeTrendFor(readyState.snapshot, readyState.fairPrice);
    this.updateActivity(activeTrend, readyState.snapshot, readyState.fairPrice);
    const order = this.createOrderForTrend(activeTrend, readyState.snapshot, readyState.fairPrice);
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

  private updateActivity(nextTrend: ActiveMomentumTrend | null, snapshot: MarketSnapshot, fairPrice: number): void {
    if (this.activeTrend === nextTrend) {
      return;
    }

    if (this.activeTrend !== null) {
      this.logEnded(this.activeTrend, "condition_changed", snapshot, fairPrice);
    }

    if (nextTrend !== null) {
      this.logStarted(nextTrend, snapshot, fairPrice);
    }

    this.activeTrend = nextTrend;
  }

  private logStarted(trend: ActiveMomentumTrend, snapshot: MarketSnapshot, fairPrice: number): void {
    const side = trend === "UP" ? OrderSide.BUY : OrderSide.SELL;
    console.log(`[MomentumBot] started trend=${trend} side=${side} lastPrice=${snapshot.lastPrice ?? "n/a"} fairPrice=${fairPrice.toFixed(2)}`);
  }

  private logEnded(
    trend: ActiveMomentumTrend,
    reason: string,
    snapshot?: MarketSnapshot,
    fairPrice?: number
  ): void {
    const side = trend === "UP" ? OrderSide.BUY : OrderSide.SELL;
    const lastPrice = snapshot?.lastPrice ?? "n/a";
    const fairPriceText = fairPrice === undefined ? "n/a" : fairPrice.toFixed(2);
    console.log(`[MomentumBot] ended trend=${trend} side=${side} reason=${reason} lastPrice=${lastPrice} fairPrice=${fairPriceText}`);
  }
}
