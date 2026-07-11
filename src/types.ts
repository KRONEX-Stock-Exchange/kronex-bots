import type { BotKind, OrderSide, OrderType } from "./constants.js";

export type JsonRecord = Record<string, unknown>;
export type Rng = () => number;

export interface AccountConfig {
  accountId: number;
  accountNumber: number;
}

export interface NotionalRangeConfig {
  minNotional: number;
  maxNotional: number;
}

export interface OrderSizingConfig {
  referencePrice: number;
  decayExponent: number;
  hardMaxNotional: number;
}

export interface IntervalRangeConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
}

export interface SideProbabilityConfig {
  minSideProbabilityPct: number;
  maxSideProbabilityPct: number;
  fullBiasDivergencePct: number;
}

export interface FairPriceConfig {
  intervalMs: number;
  randomDeltaMinPct: number;
  randomDeltaMaxPct: number;
}

export interface FairPriceEventConfig {
  intervalMs: number;
  minRatePct: number;
  maxRatePct: number;
}

export interface RandomConfig {
  seed: string;
  fairStartJitterMs: number;
  fairEventStartJitterMs: number;
}

export interface RuntimeConfig {
  stockId: number;
  stockIds: number[];
  apiBaseUrl: string;
  wsUrl: string;
  accessToken: string;
  logFilePath: string;
  random: RandomConfig;
  orderSizing: OrderSizingConfig;
  fairPrice: FairPriceConfig;
  fairPriceEvent: FairPriceEventConfig;
  accounts: {
    buy: AccountConfig;
    sell: AccountConfig;
  };
  bots: {
    marketMaker: NotionalRangeConfig & {
      checkIntervalMs: number;
      orderIntervalMs: number;
    };
    noiseTaker: NotionalRangeConfig & IntervalRangeConfig & SideProbabilityConfig;
    momentum: NotionalRangeConfig & {
      intervalMs: number;
    };
    meanReversion: NotionalRangeConfig & IntervalRangeConfig;
  };
}

export interface KronexStock extends JsonRecord {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  status?: unknown;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface MarketSnapshot {
  stockId: number;
  lastPrice: number | null;
  upperLimitPrice: number | null;
  lowerLimitPrice: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  priceHistory: number[];
  hasOrderBook: boolean;
  updatedAt: number;
}

export interface OrderDraft {
  id: string;
  stockId: number;
  botKind: BotKind;
  side: OrderSide;
  orderType: OrderType;
  price: number;
  quantity: number;
  referencePrice: number;
  reason: string;
}

export interface OrderPayload {
  accountNumber: number;
  price: number;
  quantity: number;
  orderType: OrderType;
}

export interface ApiOrderResponse {
  ok: boolean;
  status: number | "network_error";
  body: unknown;
}

export interface RootStateMessage {
  type: "state";
  snapshot: MarketSnapshot;
  fairPrice: number;
}

export interface ShutdownMessage {
  type: "shutdown";
}

export type BotProcessMessage = RootStateMessage | ShutdownMessage;

export type OrderValidationResult = {
  valid: true;
  payload: OrderPayload;
} | {
  valid: false;
  reason: string;
};
