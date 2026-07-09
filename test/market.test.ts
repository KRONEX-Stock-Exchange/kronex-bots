import assert from "node:assert/strict";
import test from "node:test";
import { MarketState } from "../src/market/MarketState.js";

test("market state initializes from stock price and keeps enough prices for thirty-step momentum", () => {
  const market = new MarketState(1);
  market.initializeFromStock({ id: 1, price: "10000" });

  for (let index = 0; index < 34; index += 1) {
    assert.equal(market.applyStockInfoUpdated({ data: { stockId: 1, lastPrice: 10_001 + index } }), true);
  }

  const snapshot = market.getSnapshot();
  assert.equal(snapshot.lastPrice, 10_034);
  assert.equal(snapshot.priceHistory.length, 31);
  assert.deepEqual(snapshot.priceHistory.slice(0, 2), [10_004, 10_005]);
});

test("market state parses nested order book updates and aggregates duplicate prices", () => {
  const market = new MarketState(1);
  market.initializeFromStock({ id: 1, price: "10000" });

  const applied = market.applyOrderBookUpdated({
    data: {
      stockId: 1,
      orderbook: {
        buyOrderBook: [
          { orderPrice: "9990", totalQuantity: "10" },
          { orderPrice: "9990", remainingQuantity: "5" },
          { bidPrice: "9980", bidQuantity: "2" }
        ],
        sellOrderBook: {
          "10010": { totalQuantity: "8" },
          "10020": "4"
        }
      }
    }
  });

  const snapshot = market.getSnapshot();
  assert.equal(applied, true);
  assert.equal(snapshot.hasOrderBook, true);
  assert.equal(snapshot.bids[0]?.price, 9_990);
  assert.equal(snapshot.bids[0]?.quantity, 15);
  assert.equal(snapshot.asks[0]?.price, 10_010);
  assert.equal(snapshot.asks[0]?.quantity, 8);
});

test("market state accepts realtime server orderBookUpdated payload shape", () => {
  const market = new MarketState(1);
  market.initializeFromStock({ id: 1, price: "19480" });

  assert.equal(market.applyOrderBookUpdated({
    buyOrderbook: [
      { price: "19480", quantity: "3" },
      { price: "19470", quantity: "2" }
    ],
    sellOrderbook: [
      { price: "19490", quantity: "4" },
      { price: "19500", quantity: "5" }
    ]
  }), true);

  const snapshot = market.getSnapshot();
  assert.equal(snapshot.hasOrderBook, true);
  assert.equal(snapshot.bids[0]?.price, 19_480);
  assert.equal(snapshot.bids[0]?.quantity, 3);
  assert.equal(snapshot.asks[0]?.price, 19_490);
  assert.equal(snapshot.asks[0]?.quantity, 4);
});

test("market state ignores updates for other stock ids", () => {
  const market = new MarketState(1);
  market.initializeFromStock({ id: 1, price: "10000" });

  assert.equal(market.applyStockInfoUpdated({ data: { stockId: 2, lastPrice: 20_000 } }), false);
  assert.equal(market.applyOrderBookUpdated({ data: { stockId: 2, orderBook: { bids: [[19_990, 1]] } } }), false);
  assert.equal(market.getSnapshot().lastPrice, 10_000);
});
