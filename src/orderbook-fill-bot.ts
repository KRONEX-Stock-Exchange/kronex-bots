import { loadConfig } from './config/config.js';
import { MarketState } from './market-state.js';
import { createOrder } from './order-factory.js';
import { RestClient } from './rest-client.js';
import { pricesAbove, pricesBelow, roundPrice } from './utils/price.js';
import { WsClient } from './ws-client.js';

const config = loadConfig();
const state = new MarketState();
const rest = new RestClient(config);
const ws = new WsClient(config, state);

function existingPrices(rows: Array<{ price: string }>): Set<number> {
  return new Set(rows.map((row) => Number(row.price)).filter((price) => Number.isFinite(price)));
}

function allExistingPrices(): Set<number> {
  return new Set([...existingPrices(state.orderBook.buyOrderbook), ...existingPrices(state.orderBook.sellOrderbook)]);
}

async function fillMissingQuotes(): Promise<void> {
  if (!state.isReady()) {
    console.log('[fill] waiting for stock price and order book');
    return;
  }

  const current = state.currentPrice();
  if (!current) {
    console.log('[fill] waiting for stock price');
    return;
  }

  const center = roundPrice(current, 'down');
  const occupiedPrices = allExistingPrices();
  const isEmptyPrice = (price: number) => !occupiedPrices.has(price);
  const missingBuyPrices = pricesBelow(center, config.fillLevelsEachSide).filter(isEmptyPrice);
  const missingSellPrices = pricesAbove(center, config.fillLevelsEachSide).filter(isEmptyPrice);
  const orders = [
    ...missingBuyPrices.map((price) => createOrder(config, 'BUY', price, 'LIMIT', 'fill missing bid quote')),
    ...missingSellPrices.map((price) => createOrder(config, 'SELL', price, 'LIMIT', 'fill missing ask quote'))
  ].slice(0, config.fillMaxOrdersPerTick);

  if (orders.length === 0) {
    console.log(`[fill] no missing quotes around ${center}`);
    return;
  }

  console.log(`[fill] current=${center} orders=${orders.length}`);
  for (const order of orders) {
    await rest.placeOrder(order);
  }
}

ws.connect();
setInterval(() => {
  fillMissingQuotes().catch((error) => console.error('[fill] failed', error));
}, config.fillIntervalMs);
