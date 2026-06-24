export type TradingSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';

export interface StockInfo {
  id: number;
  name: string;
  price: string;
  prevClose: string;
  open: string;
  high: string;
  low: string;
  close: string;
  upperLimit: string;
  lowerLimit: string;
}

export interface OrderBookLevel {
  price: string;
  quantity: string;
}

export interface OrderBook {
  buyOrderbook: OrderBookLevel[];
  sellOrderbook: OrderBookLevel[];
}

export interface AccountState {
  id: number;
  accountNumber: number;
  balance: number;
  availableBalance: number;
  holdings: Record<number, HoldingState>;
}

export interface HoldingState {
  stockId: number;
  quantity: number;
  availableQuantity: number;
  average: number;
  totalBuyAmount: number;
}

export interface OpenOrder {
  id: string;
  stockId: number;
  price: string;
  quantity: string;
  filledQuantity: string;
  orderType: OrderType;
  tradingType: TradingSide;
  status: string;
}

export interface OrderIntent {
  side: TradingSide;
  stockId: number;
  accountId: number;
  accountNumber: number;
  price: number;
  quantity: number;
  orderType: OrderType;
  reason: string;
}
