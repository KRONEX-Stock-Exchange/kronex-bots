import assert from "node:assert/strict";
import test from "node:test";
import { OrderSide } from "../src/constants.js";
import { FairPriceEventWorker } from "../src/domain/fairPriceEvent.js";
import { FairPriceWorker } from "../src/domain/fairPrice.js";
import { hardMaxNotionalFromEnv, quantityForNotional, randomTargetNotional } from "../src/domain/orderSizing.js";
import {
  getTickSize,
  isAlignedToTick,
  normalizeLimitPrice,
  pricesAroundCurrentPrice
} from "../src/domain/tickSize.js";

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

test("fair price moves every update and never falls below one won", () => {
  const worker = new FairPriceWorker(() => 0);
  worker.initialize(50);
  const update = worker.update(50);

  assert.equal(update.randomDelta, -100);
  assert.ok(update.fairPrice >= 1);
  assert.equal(update.corrected, true);
});

test("fair price is corrected ten percent toward current price past thirty percent divergence", () => {
  const worker = new FairPriceWorker(() => 0.5);
  worker.initialize(2_000);
  const update = worker.update(1_000);

  assert.equal(update.randomDelta, 0);
  assert.equal(update.corrected, true);
  assert.equal(update.fairPrice, 1_900);
  assert.equal(update.fairPriceChange, -100);
  assert.equal(update.fairPriceChangePct, -5);
});

test("fair price random delta follows configured min and max", () => {
  const minWorker = new FairPriceWorker({ randomDeltaMin: -20, randomDeltaMax: 40 }, () => 0);
  minWorker.initialize(1_000);
  assert.equal(minWorker.update(1_000).randomDelta, -20);

  const maxWorker = new FairPriceWorker({ randomDeltaMin: -20, randomDeltaMax: 40 }, () => 0.999);
  maxWorker.initialize(1_000);
  assert.equal(maxWorker.update(1_000).randomDelta, 40);
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

test("sizing enforces one share minimum while respecting the ten million hard cap", () => {
  assert.equal(hardMaxNotionalFromEnv(30_000_000), 10_000_000);
  assert.equal(quantityForNotional({
    targetNotional: 500_000,
    referencePrice: 800_000,
    hardMaxNotional: 10_000_000
  }), 1);

  assert.equal(quantityForNotional({
    targetNotional: 20_000_000,
    referencePrice: 3_000_000,
    hardMaxNotional: 10_000_000
  }), 3);
});

test("random target notional can become one share when the stock is above the strategy max", () => {
  const target = randomTargetNotional({
    minNotional: 3_000_000,
    maxNotional: 5_000_000,
    referencePrice: 7_000_000,
    hardMaxNotional: 10_000_000,
    rng: () => 0.3
  });

  assert.equal(target, 7_000_000);
});
