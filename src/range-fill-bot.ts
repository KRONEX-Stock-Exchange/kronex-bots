import { loadConfig } from './config/config.js';
import { createOrder } from './order-factory.js';
import { RestClient } from './rest-client.js';
import { nextTickPrice, roundPrice } from './utils/price.js';

const config = loadConfig();
const rest = new RestClient(config);

if (config.rangeLowerPrice === undefined || config.rangeUpperPrice === undefined || config.rangeCenterPrice === undefined) {
  throw new Error('RANGE_LOWER_PRICE, RANGE_CENTER_PRICE and RANGE_UPPER_PRICE are required for range-fill bot');
}

if (config.rangeLowerPrice > config.rangeCenterPrice || config.rangeCenterPrice > config.rangeUpperPrice) {
  throw new Error('range prices must satisfy RANGE_LOWER_PRICE <= RANGE_CENTER_PRICE <= RANGE_UPPER_PRICE');
}

function rangePrices(lowerPrice: number, upperPrice: number): number[] {
  const prices: number[] = [];
  let price = roundPrice(lowerPrice, 'up');
  const upper = roundPrice(upperPrice, 'down');

  while (price <= upper) {
    prices.push(price);
    price = nextTickPrice(price);
  }

  return prices;
}

async function seedRange(): Promise<void> {
  const lower = roundPrice(config.rangeLowerPrice!, 'up');
  const center = roundPrice(config.rangeCenterPrice!, 'down');
  const upper = roundPrice(config.rangeUpperPrice!, 'down');
  const buyPrices = rangePrices(lower, center);
  const sellPrices = rangePrices(center, upper);
  const orders = [
    ...buyPrices.map((price) => createOrder(config, 'BUY', price, 'LIMIT', 'seed bid range')),
    ...sellPrices.map((price) => createOrder(config, 'SELL', price, 'LIMIT', 'seed ask range'))
  ];

  console.log(`[range-fill] lower=${lower} center=${center} upper=${upper} buyOrders=${buyPrices.length} sellOrders=${sellPrices.length}`);
  for (const order of orders) {
    await rest.placeOrder(order);
  }
  console.log(`[range-fill] done orders=${orders.length}`);
}

seedRange().catch((error) => {
  console.error('[range-fill] failed', error);
  process.exitCode = 1;
});
