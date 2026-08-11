import { BotKind, OrderSide, type OrderSide as OrderSideValue } from "../constants.js";
import { randomInt } from "../domain/math.js";
import { filterAllowedOrderSides, hasPriceLimits, priceLimitSideBlockReason, priceLimitViolation } from "../domain/priceLimits.js";
import { pricesAroundCurrentPrice } from "../domain/tickSize.js";
import type { MarketSnapshot, OrderDraft, Rng, RuntimeConfig } from "../types.js";
import type { OrderRouter } from "../io/OrderRouter.js";
import {
  type BotRunner,
  type BotStateGetter,
  createLimitOrder,
  getReadyState
} from "./BotRuntime.js";

export class MarketMakerBot implements BotRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastOrderAt = 0;
  private nextOrderIntervalMs: number;
  private busy = false;
  private neutralFirstSide: OrderSideValue;
  private readonly locallyReservedPrices: Record<OrderSideValue, Map<number, number>> = {
    [OrderSide.BUY]: new Map<number, number>(),
    [OrderSide.SELL]: new Map<number, number>()
  };
  private readonly rng: Rng;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly router: OrderRouter,
    private readonly getState: BotStateGetter,
    rng: Rng = Math.random
  ) {
    this.rng = rng;
    this.neutralFirstSide = this.rng() < 0.5 ? OrderSide.BUY : OrderSide.SELL;
    this.nextOrderIntervalMs = this.randomOrderIntervalMs();
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.bots.marketMaker.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  createOrder(snapshot: MarketSnapshot, fairPrice: number): OrderDraft | null {
    if (snapshot.lastPrice === null || !hasPriceLimits(snapshot)) {
      return null;
    }

    const currentPrice = snapshot.lastPrice;
    const sidePreference = filterAllowedOrderSides(this.sidePreference(currentPrice, fairPrice), snapshot);
    const emptyPriceBySide = {
      [OrderSide.BUY]: this.firstEmptyPrice(snapshot, OrderSide.BUY, currentPrice),
      [OrderSide.SELL]: this.firstEmptyPrice(snapshot, OrderSide.SELL, currentPrice)
    };

    for (const side of sidePreference) {
      const price = emptyPriceBySide[side];
      if (price === null) {
        continue;
      }

      const order = createLimitOrder({
        config: this.config,
        botKind: BotKind.MARKET_MAKER,
        side,
        snapshot,
        price,
        reason: "empty_quote_level",
        rng: this.rng
      });

      if (order !== null) {
        this.locallyReservedPrices[side].set(price, Date.now());
      }

      return order;
    }

    return null;
  }

  private async tick(): Promise<void> {
    const readyState = getReadyState(this.getState);
    if (readyState === null || this.busy) {
      return;
    }

    const now = Date.now();
    if (now - this.lastOrderAt < this.nextOrderIntervalMs) {
      return;
    }

    const order = this.createOrder(readyState.snapshot, readyState.fairPrice);
    if (order === null) {
      return;
    }

    this.lastOrderAt = now;
    this.nextOrderIntervalMs = this.randomOrderIntervalMs();
    this.busy = true;
    try {
      const response = await this.router.route(order, readyState.snapshot, readyState.fairPrice);
      if (response === null || !response.ok) {
        this.locallyReservedPrices[order.side].delete(order.price);
      }
    } finally {
      this.busy = false;
    }
  }

  private randomOrderIntervalMs(): number {
    return randomInt(
      this.config.bots.marketMaker.minOrderIntervalMs,
      this.config.bots.marketMaker.maxOrderIntervalMs,
      this.rng
    );
  }

  private sidePreference(currentPrice: number, fairPrice: number): OrderSideValue[] {
    if (fairPrice >= currentPrice * 1.005) {
      return [OrderSide.BUY, OrderSide.SELL];
    }

    if (fairPrice <= currentPrice * 0.995) {
      return [OrderSide.SELL, OrderSide.BUY];
    }

    const firstSide = this.neutralFirstSide;
    this.neutralFirstSide = firstSide === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    return firstSide === OrderSide.BUY
      ? [OrderSide.BUY, OrderSide.SELL]
      : [OrderSide.SELL, OrderSide.BUY];
  }

  private firstEmptyPrice(snapshot: MarketSnapshot, side: OrderSideValue, currentPrice: number): number | null {
    if (priceLimitSideBlockReason(side, snapshot) !== null) {
      return null;
    }

    const occupiedPrices = this.occupiedPriceSet(snapshot, side);
    const candidates = pricesAroundCurrentPrice(currentPrice, side, 10)
      .filter((price) => priceLimitViolation(price, snapshot) === null);
    return candidates.find((price) => !occupiedPrices.has(price)) ?? null;
  }

  private occupiedPriceSet(snapshot: MarketSnapshot, side: OrderSideValue): Set<number> {
    const visibleLevels = side === OrderSide.BUY ? snapshot.bids : snapshot.asks;
    const visiblePrices = visibleLevels
      .filter((level) => level.quantity > 0)
      .map((level) => level.price);
    const visiblePriceSet = new Set(visiblePrices);
    const reservedPrices = this.locallyReservedPrices[side];
    const now = Date.now();

    for (const [price, reservedAt] of reservedPrices) {
      if (visiblePriceSet.has(price) || now - reservedAt > 10_000) {
        reservedPrices.delete(price);
      }
    }

    return new Set([...visiblePrices, ...reservedPrices.keys()]);
  }
}
