import assert from "node:assert/strict";
import test from "node:test";
import { BotKind, OrderSide, OrderType } from "../src/constants.js";
import { createOrderDraft } from "../src/domain/orderSizing.js";
import { OrderRouter } from "../src/io/OrderRouter.js";
import { MarketMakerBot } from "../src/bots/MarketMakerBot.js";
import { NoiseTakerBot } from "../src/bots/NoiseTakerBot.js";
import { MomentumBot } from "../src/bots/MomentumBot.js";
import { MeanReversionBot } from "../src/bots/MeanReversionBot.js";
import type { MarketSnapshot, RuntimeConfig } from "../src/types.js";
import type { OrderRouter as OrderRouterType } from "../src/io/OrderRouter.js";
import type { KronexApiClient } from "../src/io/KronexApiClient.js";
import type { JsonlLogger } from "../src/io/JsonlLogger.js";

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    stockId: 1,
    stockIds: [1],
    apiBaseUrl: "http://localhost:3000/api",
    wsUrl: "ws://localhost:3001/stock",
    accessToken: "token",
    logFilePath: "/tmp/kronex-bots-test.jsonl",
    random: {
      seed: "test-seed",
      fairStartJitterMs: 500,
      fairEventStartJitterMs: 3_000
    },
    orderSizing: {
      referencePrice: 7_500,
      decayExponent: 0.3,
      hardMaxNotional: 10_000_000
    },
    fairPrice: {
      intervalMs: 500,
      randomDeltaMinPct: -0.56,
      randomDeltaMaxPct: 0.56
    },
    fairPriceEvent: {
      intervalMs: 30_000,
      minRatePct: -40,
      maxRatePct: 40
    },
    accounts: {
      buy: { accountId: 1, accountNumber: 10001 },
      sell: { accountId: 2, accountNumber: 10002 }
    },
    bots: {
      marketMaker: {
        checkIntervalMs: 100,
        orderIntervalMs: 150,
        minNotional: 2_000_000,
        maxNotional: 10_000_000
      },
      noiseTaker: {
        minIntervalMs: 100,
        maxIntervalMs: 350,
        minNotional: 7_500,
        maxNotional: 1_500_000,
        minSideProbabilityPct: 10,
        maxSideProbabilityPct: 90,
        fullBiasDivergencePct: 5
      },
      momentum: {
        intervalMs: 450,
        minNotional: 7_500,
        maxNotional: 2_500_000
      },
      meanReversion: {
        minIntervalMs: 450,
        maxIntervalMs: 850,
        minNotional: 7_500,
        maxNotional: 5_000_000
      }
    },
    ...overrides
  };
}

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    stockId: 1,
    lastPrice: 10_000,
    upperLimitPrice: 100_000_000,
    lowerLimitPrice: 1,
    bids: [{ price: 10_000, quantity: 1 }],
    asks: [{ price: 10_010, quantity: 1 }],
    priceHistory: Array.from({ length: 31 }, (_, index) => 9_700 + index * 10),
    hasOrderBook: true,
    updatedAt: Date.now(),
    ...overrides
  };
}

const fakeRouter = {
  async route(): Promise<null> {
    return null;
  }
} as unknown as OrderRouterType;

const fakeApiClient = {
  async sendOrder() {
    return { ok: true, status: 200, body: null };
  }
} as unknown as KronexApiClient;

const fakeLogger = {
  async log(): Promise<void> {}
} as unknown as JsonlLogger;

test("market maker creates one prioritized limit order for an empty quote level", () => {
  const maker = new MarketMakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  const order = maker.createOrder(snapshot(), 10_100);

  assert.ok(order);
  assert.equal(order.botKind, BotKind.MARKET_MAKER);
  assert.equal(order.orderType, OrderType.LIMIT);
  assert.equal(order.side, OrderSide.BUY);
  assert.equal(order.price, 9_990);
  assert.ok(order.quantity >= 1);
  assert.ok(order.quantity * order.referencePrice <= 10_900_000);
});

test("market maker fills even when the order book is completely empty", () => {
  const maker = new MarketMakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  const order = maker.createOrder(snapshot({ hasOrderBook: false, bids: [], asks: [] }), 10_100);

  assert.ok(order);
  assert.equal(order.side, OrderSide.BUY);
  assert.equal(order.orderType, OrderType.LIMIT);
});

test("market maker walks empty quote levels once instead of repeating one price", () => {
  const maker = new MarketMakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  const emptySnapshot = snapshot({ hasOrderBook: false, bids: [], asks: [] });
  const orders = Array.from({ length: 12 }, () => maker.createOrder(emptySnapshot, 10_100));

  assert.deepEqual(orders.slice(0, 3).map((order) => order?.price), [10_000, 9_990, 9_980]);
  assert.equal(orders[9]?.price, 9_910);
  assert.equal(orders[10]?.side, OrderSide.SELL);
  assert.equal(orders[10]?.price, 10_010);
  assert.equal(orders[11]?.price, 10_020);
});

test("market maker returns no order until it has a current price", () => {
  const maker = new MarketMakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  assert.equal(maker.createOrder(snapshot({ lastPrice: null, hasOrderBook: false, bids: [], asks: [] }), 10_100), null);
});

test("market maker waits until price limits are known", () => {
  const maker = new MarketMakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  assert.equal(maker.createOrder(snapshot({
    upperLimitPrice: null,
    lowerLimitPrice: null,
    hasOrderBook: false,
    bids: [],
    asks: []
  }), 10_100), null);
});

test("market maker respects upper and lower price limit walls", () => {
  const maker = new MarketMakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);

  const upperLimitOrder = maker.createOrder(snapshot({
    lastPrice: 20_000,
    upperLimitPrice: 20_000,
    lowerLimitPrice: 10_000,
    hasOrderBook: false,
    bids: [],
    asks: []
  }), 25_000);
  assert.equal(upperLimitOrder?.side, OrderSide.SELL);
  assert.equal(upperLimitOrder?.price, 20_000);

  const lowerLimitOrder = maker.createOrder(snapshot({
    lastPrice: 5_000,
    upperLimitPrice: 10_000,
    lowerLimitPrice: 5_000,
    hasOrderBook: false,
    bids: [],
    asks: []
  }), 4_000);
  assert.equal(lowerLimitOrder?.side, OrderSide.BUY);
  assert.equal(lowerLimitOrder?.price, 5_000);
});

test("noise taker computes documented buy probability clamps", () => {
  const taker = new NoiseTakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);

  assert.equal(taker.buyProbabilityPct(10_000, 10_000), 50);
  assert.equal(taker.buyProbabilityPct(9_750, 10_000), 70);
  assert.equal(taker.buyProbabilityPct(9_500, 10_000), 90);
  assert.equal(taker.buyProbabilityPct(9_000, 10_000), 90);
  assert.equal(taker.buyProbabilityPct(10_250, 10_000), 30);
  assert.equal(taker.buyProbabilityPct(10_500, 10_000), 10);
  assert.equal(taker.buyProbabilityPct(11_000, 10_000), 10);
  assert.equal(taker.createOrder(snapshot(), 11_000)?.side, OrderSide.BUY);
});

test("market order bots use the allowed side at price limits", () => {
  const upperBuyTaker = new NoiseTakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  assert.equal(upperBuyTaker.createOrder(snapshot({
    lastPrice: 20_000,
    upperLimitPrice: 20_000,
    lowerLimitPrice: 10_000
  }), 30_000)?.side, OrderSide.SELL);

  const lowerSellTaker = new NoiseTakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0.999);
  assert.equal(lowerSellTaker.createOrder(snapshot({
    lastPrice: 5_000,
    upperLimitPrice: 10_000,
    lowerLimitPrice: 5_000
  }), 4_000)?.side, OrderSide.BUY);
});

test("noise taker resumes through the allowed side at price limits when fair price reverses", () => {
  const upperLimitTaker = new NoiseTakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  const upperOrder = upperLimitTaker.createOrder(snapshot({
    lastPrice: 20_000,
    upperLimitPrice: 20_000,
    lowerLimitPrice: 10_000
  }), 18_000);

  assert.equal(upperOrder?.side, OrderSide.SELL);

  const lowerLimitTaker = new NoiseTakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0.999);
  const lowerOrder = lowerLimitTaker.createOrder(snapshot({
    lastPrice: 5_000,
    upperLimitPrice: 10_000,
    lowerLimitPrice: 5_000
  }), 6_000);

  assert.equal(lowerOrder?.side, OrderSide.BUY);
});

test("noise taker side probability follows configured min max and full bias divergence", () => {
  const runtimeConfig = config();
  runtimeConfig.bots.noiseTaker = {
    ...runtimeConfig.bots.noiseTaker,
    minSideProbabilityPct: 20,
    maxSideProbabilityPct: 80,
    fullBiasDivergencePct: 10
  };
  const taker = new NoiseTakerBot(runtimeConfig, fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);

  assert.equal(taker.buyProbabilityPct(9_500, 10_000), 65);
  assert.equal(taker.buyProbabilityPct(10_500, 10_000), 35);
  assert.equal(taker.buyProbabilityPct(9_000, 10_000), 80);
  assert.equal(taker.buyProbabilityPct(11_000, 10_000), 20);
});

test("noise taker order size follows configured min and max notional", () => {
  const runtimeConfig = config();
  runtimeConfig.bots.noiseTaker = {
    ...runtimeConfig.bots.noiseTaker,
    minNotional: 30_000,
    maxNotional: 30_000
  };
  const taker = new NoiseTakerBot(runtimeConfig, fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  const order = taker.createOrder(snapshot(), 11_000);

  assert.ok(order);
  assert.equal(order.quantity, 3);
  assert.equal(order.quantity * order.referencePrice, 30_000);
});

test("high priced orders decay smoothly instead of keeping low-price share count", () => {
  const maker = new MarketMakerBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  const order = maker.createOrder(snapshot({ lastPrice: 3_000_000, hasOrderBook: false, bids: [], asks: [] }), 3_100_000);

  assert.ok(order);
  assert.equal(order.quantity, 4);

  const router = new OrderRouter(config(), fakeApiClient, fakeLogger);
  const tooManyHighPriceShares = createOrderDraft({
    stockId: 1,
    botKind: BotKind.NOISE_TAKER,
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    price: 3_000_000,
    quantity: 21,
    referencePrice: 3_000_000,
    reason: "too_many_high_price_shares"
  });

  assert.deepEqual(router.validate(tooManyHighPriceShares, snapshot({ lastPrice: 3_000_000 })), {
    valid: false,
    reason: "hard_notional_limit_exceeded"
  });
});

test("momentum detects thirty-step trends and respects fair price direction", () => {
  const momentum = new MomentumBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);
  const rising = Array.from({ length: 31 }, (_, index) => 100 + index);
  const falling = Array.from({ length: 31 }, (_, index) => 130 - index);
  const flat = Array.from({ length: 31 }, () => 100);
  const shortRising = Array.from({ length: 30 }, (_, index) => 100 + index);

  assert.equal(momentum.detectTrend(rising), "UP");
  assert.equal(momentum.detectTrend(falling), "DOWN");
  assert.equal(momentum.detectTrend(flat), "NONE");
  assert.equal(momentum.detectTrend(shortRising), "NONE");
  assert.equal(momentum.createOrder(snapshot(), 10_050)?.side, OrderSide.BUY);
  assert.equal(momentum.createOrder(snapshot(), 10_000), null);
});

test("mean reversion trades against five percent fair price divergence", () => {
  const reversion = new MeanReversionBot(config(), fakeRouter, () => ({ snapshot: null, fairPrice: null }), () => 0);

  assert.equal(reversion.createOrder(snapshot({ lastPrice: 10_500 }), 10_000)?.side, OrderSide.SELL);
  assert.equal(reversion.createOrder(snapshot({ lastPrice: 9_500 }), 10_000)?.side, OrderSide.BUY);
  assert.equal(reversion.createOrder(snapshot({ lastPrice: 10_400 }), 10_000), null);
});

test("order router builds the side-specific account payload for market orders", () => {
  const router = new OrderRouter(config(), fakeApiClient, fakeLogger);
  const order = createOrderDraft({
    stockId: 1,
    botKind: BotKind.NOISE_TAKER,
    side: OrderSide.SELL,
    orderType: OrderType.MARKET,
    price: 10_000,
    quantity: 2,
    referencePrice: 10_000,
    reason: "test"
  });

  assert.deepEqual(router.validate(order, snapshot()), {
    valid: true,
    payload: {
      accountNumber: 10002,
      price: 10_000,
      quantity: 2,
      orderType: OrderType.MARKET
    }
  });
});

test("order router rejects mismatched bot order type and hard cap overflow", () => {
  const router = new OrderRouter(config(), fakeApiClient, fakeLogger);
  const wrongType = createOrderDraft({
    stockId: 1,
    botKind: BotKind.NOISE_TAKER,
    side: OrderSide.BUY,
    orderType: OrderType.LIMIT,
    price: 10_000,
    quantity: 1,
    referencePrice: 10_000,
    reason: "wrong_type"
  });
  const tooLarge = createOrderDraft({
    stockId: 1,
    botKind: BotKind.NOISE_TAKER,
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    price: 10_000,
    quantity: 1_334,
    referencePrice: 10_000,
    reason: "too_large"
  });

  assert.deepEqual(router.validate(wrongType, snapshot()), {
    valid: false,
    reason: "bot_order_type_not_allowed"
  });
  assert.deepEqual(router.validate(tooLarge, snapshot()), {
    valid: false,
    reason: "hard_notional_limit_exceeded"
  });
});

test("order router rejects orders before price limits are known", () => {
  const router = new OrderRouter(config(), fakeApiClient, fakeLogger);
  const order = createOrderDraft({
    stockId: 1,
    botKind: BotKind.NOISE_TAKER,
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    price: 10_000,
    quantity: 1,
    referencePrice: 10_000,
    reason: "limits_unknown"
  });

  assert.deepEqual(router.validate(order, snapshot({ upperLimitPrice: null, lowerLimitPrice: null })), {
    valid: false,
    reason: "price_limits_unknown"
  });
});

test("order router rejects price limit violations and blocked limit sides", () => {
  const router = new OrderRouter(config(), fakeApiClient, fakeLogger);
  const upperSnapshot = snapshot({
    lastPrice: 20_000,
    upperLimitPrice: 20_000,
    lowerLimitPrice: 10_000
  });
  const lowerSnapshot = snapshot({
    lastPrice: 5_000,
    upperLimitPrice: 10_000,
    lowerLimitPrice: 5_000
  });
  const upperBuy = createOrderDraft({
    stockId: 1,
    botKind: BotKind.NOISE_TAKER,
    side: OrderSide.BUY,
    orderType: OrderType.MARKET,
    price: 20_000,
    quantity: 1,
    referencePrice: 20_000,
    reason: "upper_buy"
  });
  const lowerSell = createOrderDraft({
    stockId: 1,
    botKind: BotKind.NOISE_TAKER,
    side: OrderSide.SELL,
    orderType: OrderType.MARKET,
    price: 5_000,
    quantity: 1,
    referencePrice: 5_000,
    reason: "lower_sell"
  });
  const aboveUpper = createOrderDraft({
    stockId: 1,
    botKind: BotKind.MARKET_MAKER,
    side: OrderSide.SELL,
    orderType: OrderType.LIMIT,
    price: 20_050,
    quantity: 1,
    referencePrice: 20_050,
    reason: "above_upper"
  });
  const belowLower = createOrderDraft({
    stockId: 1,
    botKind: BotKind.MARKET_MAKER,
    side: OrderSide.BUY,
    orderType: OrderType.LIMIT,
    price: 9_990,
    quantity: 1,
    referencePrice: 9_990,
    reason: "below_lower"
  });

  assert.deepEqual(router.validate(upperBuy, upperSnapshot), {
    valid: false,
    reason: "upper_limit_buy_blocked"
  });
  assert.deepEqual(router.validate(lowerSell, lowerSnapshot), {
    valid: false,
    reason: "lower_limit_sell_blocked"
  });
  assert.deepEqual(router.validate(aboveUpper, upperSnapshot), {
    valid: false,
    reason: "price_above_upper_limit"
  });
  assert.deepEqual(router.validate(belowLower, upperSnapshot), {
    valid: false,
    reason: "price_below_lower_limit"
  });
});
