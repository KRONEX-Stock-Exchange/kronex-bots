import { OrderBook, StockInfo } from './types/domain.js';

export class MarketState {
  stockInfo?: StockInfo;
  orderBook: OrderBook = { buyOrderbook: [], sellOrderbook: [] };
  orderBookUpdatedAt?: number;

  updateStockInfo(data: StockInfo): void {
    this.stockInfo = data;
  }

  updateOrderBook(data: OrderBook): void {
    this.orderBook = data;
    this.orderBookUpdatedAt = Date.now();
  }

  currentPrice(): number | undefined {
    const price = Number(this.stockInfo?.price);
    return Number.isFinite(price) && price > 0 ? price : undefined;
  }

  isReady(): boolean {
    return Boolean(this.stockInfo && this.orderBookUpdatedAt);
  }
}
