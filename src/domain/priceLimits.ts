import { OrderSide, type OrderSide as OrderSideValue } from "../constants.js";
import type { MarketSnapshot } from "../types.js";

export type PriceLimitViolationReason =
  | "price_above_upper_limit"
  | "price_below_lower_limit";

export type PriceLimitSideBlockReason =
  | "upper_limit_buy_blocked"
  | "lower_limit_sell_blocked";

export function hasPriceLimits(snapshot: MarketSnapshot): boolean {
  return snapshot.upperLimitPrice !== null && snapshot.lowerLimitPrice !== null;
}

export function priceLimitViolation(price: number, snapshot: MarketSnapshot): PriceLimitViolationReason | null {
  if (snapshot.upperLimitPrice !== null && price > snapshot.upperLimitPrice) {
    return "price_above_upper_limit";
  }

  if (snapshot.lowerLimitPrice !== null && price < snapshot.lowerLimitPrice) {
    return "price_below_lower_limit";
  }

  return null;
}

export function isAtUpperLimit(snapshot: MarketSnapshot): boolean {
  return snapshot.lastPrice !== null
    && snapshot.upperLimitPrice !== null
    && snapshot.lastPrice >= snapshot.upperLimitPrice;
}

export function isAtLowerLimit(snapshot: MarketSnapshot): boolean {
  return snapshot.lastPrice !== null
    && snapshot.lowerLimitPrice !== null
    && snapshot.lastPrice <= snapshot.lowerLimitPrice;
}

export function priceLimitSideBlockReason(
  side: OrderSideValue,
  snapshot: MarketSnapshot
): PriceLimitSideBlockReason | null {
  if (side === OrderSide.BUY && isAtUpperLimit(snapshot)) {
    return "upper_limit_buy_blocked";
  }

  if (side === OrderSide.SELL && isAtLowerLimit(snapshot)) {
    return "lower_limit_sell_blocked";
  }

  return null;
}
