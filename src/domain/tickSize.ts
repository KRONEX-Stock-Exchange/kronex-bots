import { OrderSide, type OrderSide as OrderSideValue } from "../constants.js";

const TICK_RULES = [
  { under: 2_000, size: 1 },
  { under: 5_000, size: 5 },
  { under: 20_000, size: 10 },
  { under: 50_000, size: 50 },
  { under: 200_000, size: 100 },
  { under: 500_000, size: 500 },
  { under: Number.POSITIVE_INFINITY, size: 1_000 }
] as const;

export function getTickSize(price: number): number {
  if (!Number.isFinite(price) || price <= 0) {
    return 1;
  }

  return TICK_RULES.find((rule) => price < rule.under)?.size ?? 1_000;
}

export function normalizeLimitPrice(price: number, side: OrderSideValue): number | null {
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const tickSize = getTickSize(price);
  const normalized = side === OrderSide.BUY
    ? Math.floor(price / tickSize) * tickSize
    : Math.ceil(price / tickSize) * tickSize;

  return normalized > 0 ? normalized : null;
}

export function isAlignedToTick(price: number): boolean {
  if (!Number.isFinite(price) || price <= 0) {
    return false;
  }

  return price % getTickSize(price) === 0;
}

export function previousTickPrice(price: number): number | null {
  const normalized = normalizeLimitPrice(price, OrderSide.BUY);
  if (normalized === null) {
    return null;
  }

  const next = normalized - getTickSize(Math.max(1, normalized - 1));
  return next > 0 ? normalizeLimitPrice(next, OrderSide.BUY) : null;
}

export function nextTickPrice(price: number): number | null {
  const normalized = normalizeLimitPrice(price, OrderSide.SELL);
  if (normalized === null) {
    return null;
  }

  return normalizeLimitPrice(normalized + getTickSize(normalized), OrderSide.SELL);
}

export function pricesAroundCurrentPrice(currentPrice: number, side: OrderSideValue, count: number): number[] {
  const prices: number[] = [];
  let nextPrice = normalizeLimitPrice(currentPrice, side);

  while (nextPrice !== null && prices.length < count) {
    prices.push(nextPrice);
    nextPrice = side === OrderSide.BUY ? previousTickPrice(nextPrice) : nextTickPrice(nextPrice);
  }

  return prices;
}
