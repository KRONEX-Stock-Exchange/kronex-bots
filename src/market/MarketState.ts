import { OrderSide, type OrderSide as OrderSideValue } from "../constants.js";
import { asRecord, toNonNegativeNumber, toPositiveNumber } from "../domain/math.js";
import type { KronexStock, MarketSnapshot, OrderBookLevel } from "../types.js";

export class MarketState {
  private static readonly priceHistoryLimit = 31;
  private lastPrice: number | null = null;
  private bids: OrderBookLevel[] = [];
  private asks: OrderBookLevel[] = [];
  private priceHistory: number[] = [];
  private updatedAt = Date.now();

  constructor(private readonly stockId: number) {}

  initializeFromStock(stock: KronexStock): void {
    const price = this.extractPrice(stock);
    if (price === null) {
      throw new Error(`stockId=${this.stockId} has no valid initial price`);
    }

    this.updateLastPrice(price);
  }

  applyStockInfoUpdated(payload: unknown): boolean {
    const payloadRecord = asRecord(payload);
    const container = asRecord(payloadRecord?.data) ?? payloadRecord;
    const data = asRecord(container?.stock) ?? asRecord(payloadRecord?.stock) ?? container;

    if (!this.isForConfiguredStock(container) || !this.isForConfiguredStock(data)) {
      return false;
    }

    const price = this.extractPrice(data);
    if (price === null) {
      return false;
    }

    this.updateLastPrice(price);
    return true;
  }

  applyOrderBookUpdated(payload: unknown): boolean {
    const payloadRecord = asRecord(payload);
    const container = asRecord(payloadRecord?.data) ?? payloadRecord;
    const data = this.selectOrderBookRecord(container, payloadRecord);

    if (!this.isForConfiguredStock(container) || !this.isForConfiguredStock(data)) {
      return false;
    }

    const bids = this.aggregateLevels(this.extractLevels(data, OrderSide.BUY));
    const asks = this.aggregateLevels(this.extractLevels(data, OrderSide.SELL));

    if (bids.length === 0 && asks.length === 0) {
      return false;
    }

    this.bids = bids.sort((left, right) => right.price - left.price);
    this.asks = asks.sort((left, right) => left.price - right.price);
    this.updatedAt = Date.now();
    return true;
  }

  getSnapshot(): MarketSnapshot {
    return {
      stockId: this.stockId,
      lastPrice: this.lastPrice,
      bids: this.bids.map((level) => ({ ...level })),
      asks: this.asks.map((level) => ({ ...level })),
      priceHistory: [...this.priceHistory],
      hasOrderBook: this.bids.length > 0 || this.asks.length > 0,
      updatedAt: this.updatedAt
    };
  }

  getCurrentPrice(): number | null {
    return this.lastPrice;
  }

  private updateLastPrice(price: number): void {
    this.lastPrice = price;
    this.priceHistory.push(price);
    if (this.priceHistory.length > MarketState.priceHistoryLimit) {
      this.priceHistory.splice(0, this.priceHistory.length - MarketState.priceHistoryLimit);
    }
    this.updatedAt = Date.now();
  }

  private isForConfiguredStock(data: Record<string, unknown> | null): boolean {
    const rawStockId = data?.stockId ?? data?.id;
    if (rawStockId === undefined || rawStockId === null) {
      return true;
    }

    return Number(rawStockId) === this.stockId;
  }

  private extractPrice(data: unknown): number | null {
    const record = asRecord(data);
    if (!record) {
      return null;
    }

    return (
      toPositiveNumber(record.lastPrice) ??
      toPositiveNumber(record.currentPrice) ??
      toPositiveNumber(record.price) ??
      toPositiveNumber(record.closePrice) ??
      toPositiveNumber(record.tradePrice)
    );
  }

  private selectOrderBookRecord(
    container: Record<string, unknown> | null,
    payloadRecord: Record<string, unknown> | null
  ): Record<string, unknown> | null {
    return (
      asRecord(container?.orderBook) ??
      asRecord(container?.orderbook) ??
      asRecord(container?.orderBooks) ??
      asRecord(container?.orderBookData) ??
      asRecord(container?.orderBookInfo) ??
      asRecord(payloadRecord?.orderBook) ??
      asRecord(payloadRecord?.orderbook) ??
      asRecord(payloadRecord?.orderBooks) ??
      asRecord(payloadRecord?.orderBookData) ??
      asRecord(payloadRecord?.orderBookInfo) ??
      container
    );
  }

  private extractLevels(data: unknown, side: OrderSideValue): OrderBookLevel[] {
    const record = asRecord(data);
    const candidates = side === OrderSide.BUY
      ? [
        record?.bids,
        record?.bidLevels,
        record?.buy,
        record?.buys,
        record?.buyOrders,
        record?.bidOrders,
        record?.buyOrderBook,
        record?.buyOrderbook,
        record?.buyOrderBooks,
        record?.buyOrderbooks,
        record?.bidOrderBook,
        record?.bidOrderbook,
        record?.bidOrderBooks,
        record?.bidOrderbooks,
        record?.buyBook,
        record?.buybook,
        record?.bidBook,
        record?.bidbook,
        record?.bid
      ]
      : [
        record?.asks,
        record?.askLevels,
        record?.sell,
        record?.sells,
        record?.sellOrders,
        record?.askOrders,
        record?.sellOrderBook,
        record?.sellOrderbook,
        record?.sellOrderBooks,
        record?.sellOrderbooks,
        record?.askOrderBook,
        record?.askOrderbook,
        record?.askOrderBooks,
        record?.askOrderbooks,
        record?.sellBook,
        record?.sellbook,
        record?.askBook,
        record?.askbook,
        record?.ask
      ];

    return candidates
      .flatMap((candidate) => this.collectRawLevels(candidate, side))
      .map((level) => this.normalizeLevel(level, side))
      .filter((level): level is OrderBookLevel => level !== null);
  }

  private collectRawLevels(candidate: unknown, side: OrderSideValue): unknown[] {
    if (Array.isArray(candidate)) {
      return candidate;
    }

    const record = asRecord(candidate);
    if (!record) {
      return [];
    }

    if (this.extractLevelPrice(record, side) !== null) {
      return [record];
    }

    for (const key of ["levels", "orders", "items", "rows", "data", "list"]) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }

    const mappedLevels: unknown[] = [];
    for (const [priceKey, value] of Object.entries(record)) {
      const price = toPositiveNumber(priceKey);
      if (price === null) {
        continue;
      }

      const valueRecord = asRecord(value);
      mappedLevels.push(valueRecord ? { price, ...valueRecord } : { price, quantity: value });
    }

    return mappedLevels;
  }

  private normalizeLevel(level: unknown, side: OrderSideValue): OrderBookLevel | null {
    const record = asRecord(level);
    const price = Array.isArray(level)
      ? toPositiveNumber(level[0])
      : this.extractLevelPrice(record, side);
    const quantity = Array.isArray(level)
      ? toNonNegativeNumber(level[1])
      : this.extractLevelQuantity(record, side, price);

    if (price === null || quantity === null) {
      return null;
    }

    return { price, quantity };
  }

  private extractLevelPrice(record: Record<string, unknown> | null, side: OrderSideValue): number | null {
    if (!record) {
      return null;
    }

    const sidePrice = side === OrderSide.BUY
      ? record.bidPrice ?? record.buyPrice
      : record.askPrice ?? record.sellPrice;

    return (
      toPositiveNumber(record.price) ??
      toPositiveNumber(record.orderPrice) ??
      toPositiveNumber(record.quotePrice) ??
      toPositiveNumber(record.stockPrice) ??
      toPositiveNumber(record.unitPrice) ??
      toPositiveNumber(sidePrice)
    );
  }

  private extractLevelQuantity(
    record: Record<string, unknown> | null,
    side: OrderSideValue,
    price: number | null
  ): number | null {
    if (!record) {
      return null;
    }

    const sideQuantity = side === OrderSide.BUY
      ? record.bidQuantity ?? record.buyQuantity
      : record.askQuantity ?? record.sellQuantity;
    const directQuantity = (
      toNonNegativeNumber(record.quantity) ??
      toNonNegativeNumber(record.tradeQuantity) ??
      toNonNegativeNumber(record.remainingQuantity) ??
      toNonNegativeNumber(record.remainQuantity) ??
      toNonNegativeNumber(record.totalQuantity) ??
      toNonNegativeNumber(record.orderQuantity) ??
      toNonNegativeNumber(record.volume) ??
      toNonNegativeNumber(record.totalVolume) ??
      toNonNegativeNumber(record.amount) ??
      toNonNegativeNumber(record.size) ??
      toNonNegativeNumber(sideQuantity)
    );

    if (directQuantity !== null) {
      return directQuantity;
    }

    if (Array.isArray(record.orders)) {
      const nestedQuantity = record.orders.reduce((sum, order) => {
        const orderRecord = asRecord(order);
        return sum + (this.extractLevelQuantity(orderRecord, side, price) ?? 0);
      }, 0);

      if (nestedQuantity > 0) {
        return nestedQuantity;
      }
    }

    const sideNotional = side === OrderSide.BUY
      ? record.bidNotional ?? record.buyNotional
      : record.askNotional ?? record.sellNotional;
    const notional = (
      toNonNegativeNumber(record.notional) ??
      toNonNegativeNumber(record.totalNotional) ??
      toNonNegativeNumber(sideNotional)
    );

    if (price !== null && price > 0 && notional !== null) {
      return notional / price;
    }

    return null;
  }

  private aggregateLevels(levels: OrderBookLevel[]): OrderBookLevel[] {
    const quantityByPrice = new Map<number, number>();
    for (const level of levels) {
      quantityByPrice.set(level.price, (quantityByPrice.get(level.price) ?? 0) + level.quantity);
    }

    return Array.from(quantityByPrice.entries()).map(([price, quantity]) => ({ price, quantity }));
  }
}
