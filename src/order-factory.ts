import { BotConfig } from './config/config.js';
import { OrderIntent, OrderType, TradingSide } from './types/domain.js';
import { quantityForPrice } from './utils/quantity.js';

export function accountForSide(config: BotConfig, side: TradingSide): { accountId: number; accountNumber: number } {
  return side === 'BUY'
    ? { accountId: config.buyAccountId, accountNumber: config.buyAccountNumber }
    : { accountId: config.sellAccountId, accountNumber: config.sellAccountNumber };
}

export function createOrder(
  config: BotConfig,
  side: TradingSide,
  price: number,
  orderType: OrderType,
  reason: string
): OrderIntent {
  const account = accountForSide(config, side);
  return {
    side,
    stockId: config.stockId,
    accountId: account.accountId,
    accountNumber: account.accountNumber,
    price,
    quantity: quantityForPrice(price, config),
    orderType,
    reason
  };
}
