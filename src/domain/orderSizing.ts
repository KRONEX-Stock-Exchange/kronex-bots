import { BotKind, STRATEGY_LIMITS, type OrderSide, type OrderType } from "../constants.js";
import type { OrderDraft, OrderSizingConfig, Rng } from "../types.js";
import { randomInt } from "./math.js";

let nextOrderSequence = 0;

export function nextOrderId(botKind: BotKind): string {
  nextOrderSequence += 1;
  return `${botKind}-${process.pid}-${Date.now()}-${nextOrderSequence}`;
}

export function randomTargetNotional({
  minNotional,
  maxNotional,
  referencePrice,
  orderSizing,
  rng = Math.random
}: {
  minNotional: number;
  maxNotional: number;
  referencePrice: number;
  orderSizing: OrderSizingConfig;
  rng?: Rng;
}): number | null {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return null;
  }

  const hardMaxNotional = maxOrderNotionalForReferencePrice(referencePrice, orderSizing);
  const scaledMinNotional = scaledNotionalForReferencePrice(minNotional, referencePrice, orderSizing);
  const scaledMaxNotional = scaledNotionalForReferencePrice(Math.min(maxNotional, orderSizing.hardMaxNotional), referencePrice, orderSizing);
  const floor = Math.max(scaledMinNotional, referencePrice);
  const ceiling = Math.max(scaledMaxNotional, referencePrice);
  const boundedCeiling = Math.min(ceiling, hardMaxNotional);

  if (floor >= boundedCeiling) {
    return Math.round(floor);
  }

  return randomInt(Math.ceil(floor), Math.floor(boundedCeiling), rng);
}

export function quantityForNotional({
  targetNotional,
  referencePrice,
  orderSizing
}: {
  targetNotional: number;
  referencePrice: number;
  orderSizing: OrderSizingConfig;
}): number {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return 0;
  }

  const hardMaxNotional = maxOrderNotionalForReferencePrice(referencePrice, orderSizing);
  const maxQuantity = Math.floor(hardMaxNotional / referencePrice);
  if (maxQuantity < 1) {
    return 0;
  }

  return Math.min(maxQuantity, Math.max(1, Math.floor(targetNotional / referencePrice)));
}

export function createOrderDraft(input: {
  stockId: number;
  botKind: BotKind;
  side: OrderSide;
  orderType: OrderType;
  price: number;
  quantity: number;
  referencePrice: number;
  reason: string;
}): OrderDraft {
  return {
    id: nextOrderId(input.botKind),
    ...input
  };
}

export function hardMaxNotionalFromEnv(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return STRATEGY_LIMITS.hardMaxNotional;
  }

  return value;
}

export function scaledNotionalForReferencePrice(baseNotional: number, referencePrice: number, orderSizing: OrderSizingConfig): number {
  if (
    !Number.isFinite(baseNotional) ||
    baseNotional <= 0 ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    !Number.isFinite(orderSizing.referencePrice) ||
    orderSizing.referencePrice <= 0
  ) {
    return 0;
  }

  const exponent = normalizeDecayExponent(orderSizing.decayExponent);
  return baseNotional * ((referencePrice / orderSizing.referencePrice) ** exponent);
}

export function maxOrderNotionalForReferencePrice(referencePrice: number, orderSizing: OrderSizingConfig): number {
  return Math.max(referencePrice, scaledNotionalForReferencePrice(orderSizing.hardMaxNotional, referencePrice, orderSizing));
}

export function normalizeDecayExponent(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : STRATEGY_LIMITS.decayExponent;
}
