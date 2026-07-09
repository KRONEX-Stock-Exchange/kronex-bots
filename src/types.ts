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

export interface IntervalRangeConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
}

export interface FairPriceConfig {
  randomDeltaMin: number;
  randomDeltaMax: number;
}

export interface FairPriceEventConfig {
  intervalMs: number;
  minRatePct: number;
  maxRatePct: number;
}

export interface RuntimeConfig {
  stockId: number;
  apiBaseUrl: string;
  wsUrl: string;
  accessToken: string;
  logFilePath: string;
  consoleSummaryIntervalMs: number;
  hardMaxOrderNotional: number;
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
    noiseTaker: NotionalRangeConfig & IntervalRangeConfig;
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
