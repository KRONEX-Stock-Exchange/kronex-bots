import { existsSync, readFileSync } from "node:fs";
import { STRATEGY_LIMITS } from "./constants.js";
import { hardMaxNotionalFromEnv, normalizeDecayExponent } from "./domain/orderSizing.js";
import type { RuntimeConfig } from "./types.js";

const ENV_FILE_PATH = ".env";

function loadEnvFile(): void {
  if (!existsSync(ENV_FILE_PATH)) {
    return;
  }

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(ENV_FILE_PATH);
    return;
  }

  for (const line of readFileSync(ENV_FILE_PATH, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = stripInlineComment(trimmed.slice(separatorIndex + 1)).trim();
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function stripInlineComment(value: string): string {
  return value.replace(/\s+#.*$/, "");
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function positiveNumberEnv(name: string, fallback: number): number {
  const value = numberEnv(name, fallback);
  return value > 0 ? value : fallback;
}

function stringEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function notionalRange(minValue: number, maxValue: number, hardMaxNotional: number): { minNotional: number; maxNotional: number } {
  const maxNotional = Math.min(Math.max(1, maxValue), hardMaxNotional);
  const minNotional = Math.min(Math.max(1, minValue), maxNotional);
  return { minNotional, maxNotional };
}

function intervalRange(minValue: number, maxValue: number): { minIntervalMs: number; maxIntervalMs: number } {
  const minIntervalMs = Math.max(1, minValue);
  const maxIntervalMs = Math.max(minIntervalMs, maxValue);
  return { minIntervalMs, maxIntervalMs };
}

function numericRange(minValue: number, maxValue: number): { min: number; max: number } {
  return minValue <= maxValue
    ? { min: minValue, max: maxValue }
    : { min: maxValue, max: minValue };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sideProbabilityConfig(
  minValue: number,
  maxValue: number,
  fullBiasDivergencePct: number
): { minSideProbabilityPct: number; maxSideProbabilityPct: number; fullBiasDivergencePct: number } {
  return {
    minSideProbabilityPct: clampNumber(minValue, 0, 50),
    maxSideProbabilityPct: clampNumber(maxValue, 50, 100),
    fullBiasDivergencePct: fullBiasDivergencePct > 0 ? fullBiasDivergencePct : STRATEGY_LIMITS.noiseTaker.fullBiasDivergencePct
  };
}

loadEnvFile();

export function loadConfig(): RuntimeConfig {
  const hardMaxOrderNotional = hardMaxNotionalFromEnv(
    numberEnv("BOT_MAX_ORDER_NOTIONAL", STRATEGY_LIMITS.hardMaxNotional)
  );
  const marketMakerNotional = notionalRange(
    positiveNumberEnv("BOT_MM_MIN_ORDER_NOTIONAL", STRATEGY_LIMITS.marketMaker.minNotional),
    positiveNumberEnv("BOT_MM_MAX_ORDER_NOTIONAL", STRATEGY_LIMITS.marketMaker.maxNotional),
    hardMaxOrderNotional
  );
  const noiseTakerNotional = notionalRange(
    positiveNumberEnv("BOT_NOISE_MIN_ORDER_NOTIONAL", STRATEGY_LIMITS.noiseTaker.minNotional),
    positiveNumberEnv("BOT_NOISE_MAX_ORDER_NOTIONAL", STRATEGY_LIMITS.noiseTaker.maxNotional),
    hardMaxOrderNotional
  );
  const noiseTakerSideProbability = sideProbabilityConfig(
    numberEnv("BOT_NOISE_MIN_SIDE_PROBABILITY_PCT", STRATEGY_LIMITS.noiseTaker.minSideProbabilityPct),
    numberEnv("BOT_NOISE_MAX_SIDE_PROBABILITY_PCT", STRATEGY_LIMITS.noiseTaker.maxSideProbabilityPct),
    numberEnv("BOT_NOISE_FULL_BIAS_DIVERGENCE_PCT", STRATEGY_LIMITS.noiseTaker.fullBiasDivergencePct)
  );
  const momentumNotional = notionalRange(
    positiveNumberEnv("BOT_MOMENTUM_MIN_ORDER_NOTIONAL", STRATEGY_LIMITS.momentum.minNotional),
    positiveNumberEnv("BOT_MOMENTUM_MAX_ORDER_NOTIONAL", STRATEGY_LIMITS.momentum.maxNotional),
    hardMaxOrderNotional
  );
  const meanReversionNotional = notionalRange(
    positiveNumberEnv("BOT_REVERSION_MIN_ORDER_NOTIONAL", STRATEGY_LIMITS.meanReversion.minNotional),
    positiveNumberEnv("BOT_REVERSION_MAX_ORDER_NOTIONAL", STRATEGY_LIMITS.meanReversion.maxNotional),
    hardMaxOrderNotional
  );
  const fairPriceRandomDelta = numericRange(
    numberEnv("BOT_FAIR_RANDOM_DELTA_MIN", -0.56),
    numberEnv("BOT_FAIR_RANDOM_DELTA_MAX", 0.56)
  );
  const fairPriceEventRatePct = numericRange(
    numberEnv("BOT_FAIR_EVENT_RATE_MIN_PCT", -40),
    numberEnv("BOT_FAIR_EVENT_RATE_MAX_PCT", 40)
  );

  return {
    stockId: numberEnv("BOT_STOCK_ID", 1),
    apiBaseUrl: stringEnv("KRONEX_API_BASE_URL", "http://localhost:3000/api"),
    wsUrl: stringEnv("KRONEX_WS_URL", "ws://localhost:3001/stock"),
    accessToken: stringEnv("BOT_ACCESS_TOKEN", ""),
    logFilePath: stringEnv("BOT_LOG_FILE", "logs/bot-events.jsonl"),
    orderSizing: {
      referencePrice: positiveNumberEnv("BOT_ORDER_REFERENCE_PRICE", STRATEGY_LIMITS.referencePrice),
      decayExponent: normalizeDecayExponent(numberEnv("BOT_ORDER_PRICE_DECAY_EXPONENT", STRATEGY_LIMITS.decayExponent)),
      hardMaxNotional: hardMaxOrderNotional
    },
    fairPrice: {
      intervalMs: positiveNumberEnv("BOT_FAIR_INTERVAL_MS", 500),
      randomDeltaMinPct: fairPriceRandomDelta.min,
      randomDeltaMaxPct: fairPriceRandomDelta.max
    },
    fairPriceEvent: {
      intervalMs: positiveNumberEnv("BOT_FAIR_EVENT_INTERVAL_MS", 30_000),
      minRatePct: fairPriceEventRatePct.min,
      maxRatePct: fairPriceEventRatePct.max
    },
    accounts: {
      buy: {
        accountId: numberEnv("BOT_BUY_ACCOUNT_ID", 1),
        accountNumber: numberEnv("BOT_BUY_ACCOUNT_NUMBER", 10001)
      },
      sell: {
        accountId: numberEnv("BOT_SELL_ACCOUNT_ID", 2),
        accountNumber: numberEnv("BOT_SELL_ACCOUNT_NUMBER", 10002)
      }
    },
    bots: {
      marketMaker: {
        checkIntervalMs: positiveNumberEnv("BOT_MM_CHECK_INTERVAL_MS", 100),
        orderIntervalMs: positiveNumberEnv("BOT_MM_ORDER_INTERVAL_MS", 150),
        ...marketMakerNotional
      },
      noiseTaker: {
        ...intervalRange(
          positiveNumberEnv("BOT_NOISE_MIN_INTERVAL_MS", 100),
          positiveNumberEnv("BOT_NOISE_MAX_INTERVAL_MS", 350)
        ),
        ...noiseTakerNotional,
        ...noiseTakerSideProbability
      },
      momentum: {
        intervalMs: positiveNumberEnv("BOT_MOMENTUM_INTERVAL_MS", 450),
        ...momentumNotional
      },
      meanReversion: {
        ...intervalRange(
          positiveNumberEnv("BOT_REVERSION_MIN_INTERVAL_MS", 450),
          positiveNumberEnv("BOT_REVERSION_MAX_INTERVAL_MS", 850)
        ),
        ...meanReversionNotional
      }
    }
  };
}
