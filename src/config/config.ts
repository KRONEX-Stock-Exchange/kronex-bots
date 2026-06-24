import 'dotenv/config';

export interface BotConfig {
  apiBaseUrl: string;
  wsUrl: string;
  accessToken: string;
  stockId: number;
  buyAccountId: number;
  buyAccountNumber: number;
  sellAccountId: number;
  sellAccountNumber: number;
  dryRun: boolean;
  fillIntervalMs: number;
  fillLevelsEachSide: number;
  fillMaxOrdersPerTick: number;
  randomOrderIntervalMs: number;
  rangeLowerPrice?: number;
  rangeUpperPrice?: number;
  rangeCenterPrice?: number;
  quantityReferencePrice: number;
  quantityMinAtReference: number;
  quantityMaxAtReference: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function optionalNum(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === 'true';
}

export function loadConfig(): BotConfig {
  return {
    apiBaseUrl: process.env.KRONEX_API_BASE_URL ?? 'http://localhost:3001/api',
    wsUrl: process.env.KRONEX_WS_URL ?? 'http://localhost:3001/stock',
    accessToken: required('BOT_ACCESS_TOKEN'),
    stockId: num('BOT_STOCK_ID', 1),
    buyAccountId: num('BOT_BUY_ACCOUNT_ID', 1),
    buyAccountNumber: num('BOT_BUY_ACCOUNT_NUMBER', 10001),
    sellAccountId: num('BOT_SELL_ACCOUNT_ID', 2),
    sellAccountNumber: num('BOT_SELL_ACCOUNT_NUMBER', 10002),
    dryRun: bool('BOT_DRY_RUN', true),
    fillIntervalMs: num('FILL_INTERVAL_MS', 1000),
    fillLevelsEachSide: num('FILL_LEVELS_EACH_SIDE', 10),
    fillMaxOrdersPerTick: num('FILL_MAX_ORDERS_PER_TICK', 1),
    randomOrderIntervalMs: num('RANDOM_ORDER_INTERVAL_MS', 1000),
    rangeLowerPrice: optionalNum('RANGE_LOWER_PRICE'),
    rangeUpperPrice: optionalNum('RANGE_UPPER_PRICE'),
    rangeCenterPrice: optionalNum('RANGE_CENTER_PRICE'),
    quantityReferencePrice: num('BOT_QUANTITY_REFERENCE_PRICE', 10_000),
    quantityMinAtReference: num('BOT_QUANTITY_MIN_AT_REFERENCE', 35),
    quantityMaxAtReference: num('BOT_QUANTITY_MAX_AT_REFERENCE', 1000)
  };
}
