import {
  BotKind,
  OrderType,
  type OrderSide
} from "../constants.js";
import {
  createOrderDraft,
  quantityForNotional,
  randomTargetNotional
} from "../domain/orderSizing.js";
import type { MarketSnapshot, OrderDraft, Rng, RuntimeConfig } from "../types.js";
import type { OrderRouter } from "../io/OrderRouter.js";

export interface BotStateView {
  snapshot: MarketSnapshot | null;
  fairPrice: number | null;
}

export type BotStateGetter = () => BotStateView;

export interface BotRunner {
  start(): void;
  stop(): void;
}

export interface BotDeps {
  config: RuntimeConfig;
  router: OrderRouter;
  getState: BotStateGetter;
  rng?: Rng;
}

export function getReadyState(getState: BotStateGetter): { snapshot: MarketSnapshot; fairPrice: number } | null {
  const state = getState();
  if (state.snapshot?.lastPrice === null || state.snapshot?.lastPrice === undefined || state.fairPrice === null) {
    return null;
  }

  return {
    snapshot: state.snapshot,
    fairPrice: state.fairPrice
  };
}

export function createMarketOrder(input: {
  config: RuntimeConfig;
  botKind: Exclude<BotKind, "MARKET_MAKER">;
  side: OrderSide;
  snapshot: MarketSnapshot;
  minNotional: number;
  maxNotional: number;
  reason: string;
  rng?: Rng;
}): OrderDraft | null {
  const referencePrice = input.snapshot.lastPrice;
  if (referencePrice === null) {
    return null;
  }

  const targetNotional = randomTargetNotional({
    minNotional: input.minNotional,
    maxNotional: input.maxNotional,
    referencePrice,
    hardMaxNotional: input.config.hardMaxOrderNotional,
    rng: input.rng
  });
  if (targetNotional === null) {
    return null;
  }

  const quantity = quantityForNotional({
    targetNotional,
    referencePrice,
    hardMaxNotional: input.config.hardMaxOrderNotional
  });
  if (quantity < 1) {
    return null;
  }

  return createOrderDraft({
    stockId: input.config.stockId,
    botKind: input.botKind,
    side: input.side,
    orderType: OrderType.MARKET,
    price: referencePrice,
    quantity,
    referencePrice,
    reason: input.reason
  });
}

export function createLimitOrder(input: {
  config: RuntimeConfig;
  botKind: typeof BotKind.MARKET_MAKER;
  side: OrderSide;
  price: number;
  reason: string;
  rng?: Rng;
}): OrderDraft | null {
  const targetNotional = randomTargetNotional({
    minNotional: input.config.bots.marketMaker.minNotional,
    maxNotional: input.config.bots.marketMaker.maxNotional,
    referencePrice: input.price,
    hardMaxNotional: input.config.hardMaxOrderNotional,
    rng: input.rng
  });
  if (targetNotional === null) {
    return null;
  }

  const quantity = quantityForNotional({
    targetNotional,
    referencePrice: input.price,
    hardMaxNotional: input.config.hardMaxOrderNotional
  });
  if (quantity < 1) {
    return null;
  }

  return createOrderDraft({
    stockId: input.config.stockId,
    botKind: input.botKind,
    side: input.side,
    orderType: OrderType.LIMIT,
    price: input.price,
    quantity,
    referencePrice: input.price,
    reason: input.reason
  });
}
