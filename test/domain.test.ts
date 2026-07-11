import assert from "node:assert/strict";
import test from "node:test";
import { OrderSide } from "../src/constants.js";
import { FairPriceEventWorker } from "../src/domain/fairPriceEvent.js";
import { FairPriceWorker } from "../src/domain/fairPrice.js";
import {
  hardMaxNotionalFromEnv,
  maxOrderNotionalForReferencePrice,
  normalizeDecayExponent,
  quantityForNotional,
  randomTargetNotional,
  scaledNotionalForReferencePrice
} from "../src/domain/orderSizing.js";
import {
  getTickSize,
  isAlignedToTick,
  normalizeLimitPrice,
  pricesAroundCurrentPrice
} from "../src/domain/tickSize.js";
import { clampPriceToLimits } from "../src/domain/priceLimits.js";

test("tick size follows Kronex market bands", () => {
  assert.equal(getTickSize(1_999), 1);
  assert.equal(getTickSize(2_000), 5);
  assert.equal(getTickSize(5_000), 10);
  assert.equal(getTickSize(20_000), 50);
  assert.equal(getTickSize(50_000), 100);
  assert.equal(getTickSize(200_000), 500);
  assert.equal(getTickSize(500_000), 1_000);
});

test("limit prices normalize by order side and stay tick aligned", () => {
  assert.equal(normalizeLimitPrice(10_003, OrderSide.BUY), 10_000);
  assert.equal(normalizeLimitPrice(10_003, OrderSide.SELL), 10_010);
  assert.equal(isAlignedToTick(10_010), true);
  assert.equal(isAlignedToTick(10_003), false);
});

test("market maker quote ladders are built around the current price", () => {
  const bids = pricesAroundCurrentPrice(10_003, OrderSide.BUY, 3);
  const asks = pricesAroundCurrentPrice(10_003, OrderSide.SELL, 3);

  assert.deepEqual(bids, [10_000, 9_990, 9_980]);
  assert.deepEqual(asks, [10_010, 10_020, 10_030]);
});

test("fair price is clamped to known stock price limits", () => {
  const bounds = { upperLimitPrice: 20_000, lowerLimitPrice: 10_000 };

  assert.equal(clampPriceToLimits(25_000, bounds), 20_000);
  assert.equal(clampPriceToLimits(15_000, bounds), 15_000);
  assert.equal(clampPriceToLimits(5_000, bounds), 10_000);
});

test("fair price moves every update and never falls below one won", () => {
  const worker = new FairPriceWorker({ intervalMs: 500, randomDeltaMinPct: -200, randomDeltaMaxPct: -200 }, () => 0);
  worker.initialize(50);
  const update = worker.update(50);

  assert.equal(update.randomDeltaPct, -200);
  assert.equal(update.fairPrice, 1);
});

test("fair price is not corrected toward current price past thirty percent divergence", () => {
  const worker = new FairPriceWorker({ intervalMs: 500, randomDeltaMinPct: 100, randomDeltaMaxPct: 100 }, () => 0);
  worker.initialize(2_000);
  const update = worker.update(1_000);

  assert.equal(update.randomDeltaPct, 100);
  assert.equal(update.fairPrice, 4_000);
  assert.equal(update.fairPriceChange, 2_000);
  assert.equal(update.fairPriceChangePct, 100);
  assert.equal(update.divergencePct, 300);
});

test("fair price random delta percent follows configured min and max", () => {
  const minWorker = new FairPriceWorker({ intervalMs: 500, randomDeltaMinPct: -20, randomDeltaMaxPct: 40 }, () => 0);
  minWorker.initialize(1_000);
  const minUpdate = minWorker.update(1_000);
  assert.equal(minUpdate.randomDeltaPct, -20);
  assert.equal(minUpdate.fairPrice, 800);

  const maxWorker = new FairPriceWorker({ intervalMs: 500, randomDeltaMinPct: -20, randomDeltaMaxPct: 40 }, () => 1);
  maxWorker.initialize(1_000);
  const maxUpdate = maxWorker.update(1_000);
  assert.equal(maxUpdate.randomDeltaPct, 40);
  assert.equal(maxUpdate.fairPrice, 1_400);
});

test("fair price random delta percent is applied to previous fair price", () => {
  const worker = new FairPriceWorker({ intervalMs: 500, randomDeltaMinPct: 0.56, randomDeltaMaxPct: 0.56 }, () => 0);
  worker.initialize(9_500);
  const update = worker.update(10_000);

  assert.equal(update.randomDeltaPct, 0.56);
  assert.equal(update.fairPrice, 9_553.2);
});

test("fair price event move is preserved by the regular worker", () => {
  const worker = new FairPriceWorker({ intervalMs: 500, randomDeltaMinPct: 0, randomDeltaMaxPct: 0 }, () => 0);
  worker.initialize(1_000);
  worker.replaceValue(1_200);
  const update = worker.update(1_000);

  assert.equal(update.fairPrice, 1_200);
  assert.equal(update.fairPriceChange, 0);
});

test("fair price event worker applies configured percent range", () => {
  const minWorker = new FairPriceEventWorker({ intervalMs: 30_000, minRatePct: -40, maxRatePct: 40 }, () => 0);
  const minUpdate = minWorker.update(1_000);

  assert.equal(minUpdate.eventRatePct, -40);
  assert.equal(minUpdate.fairPrice, 600);
  assert.equal(minUpdate.fairPriceChange, -400);
  assert.equal(minUpdate.fairPriceChangePct, -40);

  const maxWorker = new FairPriceEventWorker({ intervalMs: 30_000, minRatePct: -40, maxRatePct: 40 }, () => 1);
  const maxUpdate = maxWorker.update(1_000);

  assert.equal(maxUpdate.eventRatePct, 40);
  assert.equal(maxUpdate.fairPrice, 1_400);
  assert.equal(maxUpdate.fairPriceChange, 400);
  assert.equal(maxUpdate.fairPriceChangePct, 40);
});

test("fair price can be replaced by the event worker result", () => {
  const worker = new FairPriceWorker();
  worker.initialize(1_000);
  worker.replaceValue(1_400);

  assert.equal(worker.value, 1_400);
});

test("sizing enforces one share minimum while respecting decayed hard cap", () => {
  const orderSizing = {
    referencePrice: 7_500,
    decayExponent: 0.3,
    hardMaxNotional: 10_000_000
  };

  assert.equal(hardMaxNotionalFromEnv(-1), 10_000_000);
  assert.equal(hardMaxNotionalFromEnv(20_000_000), 20_000_000);
  assert.equal(quantityForNotional({
    targetNotional: 500_000,
    referencePrice: 800_000,
    orderSizing
  }), 1);

  assert.equal(quantityForNotional({
    targetNotional: 20_000_000,
    referencePrice: 3_000_000,
    orderSizing
  }), 6);
});

test("order notional scales with reference price decay exponent", () => {
  const orderSizing = {
    referencePrice: 7_500,
    decayExponent: 0.3,
    hardMaxNotional: 10_000_000
  };

  assert.equal(Math.round(scaledNotionalForReferencePrice(5_000_000, 7_500, orderSizing)), 5_000_000);
  assert.equal(Math.round(scaledNotionalForReferencePrice(5_000_000, 75_000, orderSizing)), 9_976_312);
  assert.equal(Math.round(scaledNotionalForReferencePrice(5_000_000, 3_000_000, orderSizing)), 30_170_882);
  assert.equal(Math.round(maxOrderNotionalForReferencePrice(3_000_000, orderSizing)), 60_341_763);
  assert.equal(quantityForNotional({
    targetNotional: 2_000_000_000,
    referencePrice: 3_000_000,
    orderSizing
  }), 20);
  assert.equal(normalizeDecayExponent(1.2), 0.3);
});

test("random target notional can become one share when scaled range is below one share", () => {
  const orderSizing = {
    referencePrice: 7_500,
    decayExponent: 0.3,
    hardMaxNotional: 10_000_000
  };
  const target = randomTargetNotional({
    minNotional: 10_000,
    maxNotional: 20_000,
    referencePrice: 7_000_000,
    orderSizing,
    rng: () => 0.3
  });

  assert.equal(target, 7_000_000);
});

test("random target notional scales with reference price decay", () => {
  const orderSizing = {
    referencePrice: 7_500,
    decayExponent: 0.3,
    hardMaxNotional: 10_000_000
  };
  const lowPriceTarget = randomTargetNotional({
    minNotional: 1_500_000,
    maxNotional: 1_500_000,
    referencePrice: 7_500,
    orderSizing,
    rng: () => 0
  });
  const highPriceTarget = randomTargetNotional({
    minNotional: 1_500_000,
    maxNotional: 1_500_000,
    referencePrice: 75_000,
    orderSizing,
    rng: () => 0
  });

  assert.equal(lowPriceTarget, 1_500_000);
  assert.equal(highPriceTarget, 2_992_893);
});
