import { BotKind, STRATEGY_LIMITS, type OrderSide, type OrderType } from "../constants.js";
import type { OrderDraft, Rng } from "../types.js";
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
  hardMaxNotional,
  rng = Math.random
}: {
  minNotional: number;
  maxNotional: number;
  referencePrice: number;
  hardMaxNotional: number;
  rng?: Rng;
}): number | null {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || referencePrice > hardMaxNotional) {
    return null;
  }

  const cappedMax = Math.min(maxNotional, hardMaxNotional);
  const floor = Math.max(minNotional, referencePrice);
  const ceiling = Math.max(cappedMax, referencePrice);
  const boundedCeiling = Math.min(ceiling, hardMaxNotional);

  if (floor >= boundedCeiling) {
    return Math.round(floor);
  }

  return randomInt(Math.ceil(floor), Math.floor(boundedCeiling), rng);
}

export function quantityForNotional({
  targetNotional,
  referencePrice,
  hardMaxNotional
}: {
  targetNotional: number;
  referencePrice: number;
  hardMaxNotional: number;
}): number {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return 0;
  }

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

  return Math.min(value, STRATEGY_LIMITS.hardMaxNotional);
}
