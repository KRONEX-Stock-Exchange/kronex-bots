import { BotKind, BOT_KINDS } from "../constants.js";
import { loadConfig } from "../config.js";
import { KronexApiClient } from "../io/KronexApiClient.js";
import { JsonlLogger } from "../io/JsonlLogger.js";
import { OrderRouter } from "../io/OrderRouter.js";
import type { BotProcessMessage, MarketSnapshot } from "../types.js";
import type { BotRunner, BotStateView } from "../bots/BotRuntime.js";
import { MarketMakerBot } from "../bots/MarketMakerBot.js";
import { NoiseTakerBot } from "../bots/NoiseTakerBot.js";
import { MomentumBot } from "../bots/MomentumBot.js";
import { MeanReversionBot } from "../bots/MeanReversionBot.js";
import { createSeededRng, deriveSeed, seedFingerprint } from "../domain/random.js";

const loadedConfig = loadConfig();
const stockId = parseStockId(process.argv[3], loadedConfig.stockId);
const config = { ...loadedConfig, stockId, stockIds: [stockId] };
const logger = new JsonlLogger(config.logFilePath);
const apiClient = new KronexApiClient(config);
const router = new OrderRouter(config, apiClient, logger);
const botKind = parseBotKind(process.argv[2] ?? process.env.BOT_PROCESS_KIND);
const processSeed = process.env.BOT_PROCESS_RANDOM_SEED
  ?? deriveSeed(config.random.seed, "stock", config.stockId, "bot", botKind);
const botRng = createSeededRng(processSeed);

let latestSnapshot: MarketSnapshot | null = null;
let latestFairPrice: number | null = null;

const getState = (): BotStateView => ({
  snapshot: latestSnapshot,
  fairPrice: latestFairPrice
});

const bot = createBot(botKind);
bot.start();

// void logger.log("bot_process_started", { botKind });
console.log(`[${botKind}] started stockId=${config.stockId} pid=${process.pid} seed=${seedFingerprint(processSeed)}`);

process.on("message", (message: unknown) => {
  const parsedMessage = parseMessage(message);
  if (parsedMessage === null) {
    return;
  }

  if (parsedMessage.type === "shutdown") {
    void shutdown("parent_shutdown");
    return;
  }

  latestSnapshot = parsedMessage.snapshot;
  latestFairPrice = parsedMessage.fairPrice;
});

process.on("disconnect", () => {
  void shutdown("parent_disconnected");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

function createBot(kind: BotKind): BotRunner {
  if (kind === BotKind.MARKET_MAKER) {
    return new MarketMakerBot(config, router, getState, botRng);
  }

  if (kind === BotKind.NOISE_TAKER) {
    return new NoiseTakerBot(config, router, getState, botRng);
  }

  if (kind === BotKind.MOMENTUM) {
    return new MomentumBot(config, router, getState, botRng);
  }

  return new MeanReversionBot(config, router, getState, botRng);
}

function parseBotKind(value: string | undefined): BotKind {
  if (BOT_KINDS.includes(value as BotKind)) {
    return value as BotKind;
  }

  throw new Error(`invalid bot kind: ${value ?? "missing"}`);
}

function parseStockId(value: string | undefined, fallback: number): number {
  const stockId = Number(value);
  return Number.isInteger(stockId) && stockId > 0 ? stockId : fallback;
}

function parseMessage(message: unknown): BotProcessMessage | null {
  if (message === null || typeof message !== "object") {
    return null;
  }

  const typedMessage = message as BotProcessMessage;
  if (typedMessage.type === "shutdown") {
    return typedMessage;
  }

  if (typedMessage.type === "state") {
    return typedMessage;
  }

  return null;
}

async function shutdown(reason: string): Promise<void> {
  bot.stop();
  // await logger.log("bot_process_stopped", { botKind, reason });
  process.exit(0);
}
