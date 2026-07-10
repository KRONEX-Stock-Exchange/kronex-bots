export const BotKind = {
  MARKET_MAKER: "MARKET_MAKER",
  NOISE_TAKER: "NOISE_TAKER",
  MOMENTUM: "MOMENTUM",
  MEAN_REVERSION: "MEAN_REVERSION"
} as const;

export type BotKind = (typeof BotKind)[keyof typeof BotKind];

export const OrderSide = {
  BUY: "BUY",
  SELL: "SELL"
} as const;

export type OrderSide = (typeof OrderSide)[keyof typeof OrderSide];

export const OrderType = {
  MARKET: "MARKET",
  LIMIT: "LIMIT"
} as const;

export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export const STRATEGY_LIMITS = {
  referencePrice: 7_500,
  decayExponent: 0.3,
  hardMaxNotional: 10_000_000,
  marketMaker: {
    minNotional: 2_000_000,
    maxNotional: 10_000_000
  },
  noiseTaker: {
    minNotional: 7_500,
    maxNotional: 1_500_000,
    minSideProbabilityPct: 10,
    maxSideProbabilityPct: 90,
    fullBiasDivergencePct: 5
  },
  momentum: {
    minNotional: 7_500,
    maxNotional: 2_500_000
  },
  meanReversion: {
    minNotional: 7_500,
    maxNotional: 5_000_000
  }
} as const;

export const BOT_KINDS: BotKind[] = [
  BotKind.MARKET_MAKER,
  BotKind.NOISE_TAKER,
  BotKind.MOMENTUM,
  BotKind.MEAN_REVERSION
];

export const ALLOWED_ORDER_TYPE_BY_BOT: Record<BotKind, OrderType> = {
  [BotKind.MARKET_MAKER]: OrderType.LIMIT,
  [BotKind.NOISE_TAKER]: OrderType.MARKET,
  [BotKind.MOMENTUM]: OrderType.MARKET,
  [BotKind.MEAN_REVERSION]: OrderType.MARKET
};
