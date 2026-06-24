import { loadConfig } from './config/config.js';
import { MarketState } from './market-state.js';
import { createOrder } from './order-factory.js';
import { RestClient } from './rest-client.js';
import { TradingSide } from './types/domain.js';
import { WsClient } from './ws-client.js';

const config = loadConfig();
const state = new MarketState();
const rest = new RestClient(config);
const ws = new WsClient(config, state);

function randomSide(): TradingSide {
  return Math.random() < 0.5 ? 'BUY' : 'SELL';
}

async function submitRandomMarketOrder(): Promise<void> {
  const price = state.currentPrice();
  if (!price) {
    console.log('[random] waiting for stock price');
    return;
  }

  const side = randomSide();
  const order = createOrder(config, side, price, 'MARKET', 'random market order');
  console.log(`[random] side=${side} price=${price} quantity=${order.quantity}`);
  await rest.placeOrder(order);
}

ws.connect();
setInterval(() => {
  submitRandomMarketOrder().catch((error) => console.error('[random] failed', error));
}, config.randomOrderIntervalMs);
