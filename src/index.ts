import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BOT_KINDS, type BotKind } from "./constants.js";
import { loadConfig } from "./config.js";
import { FairPriceEventWorker } from "./domain/fairPriceEvent.js";
import { FairPriceWorker } from "./domain/fairPrice.js";
import { toPositiveNumber } from "./domain/math.js";
import { KronexApiClient } from "./io/KronexApiClient.js";
import { JsonlLogger } from "./io/JsonlLogger.js";
import { KronexSocketClient } from "./io/KronexSocketClient.js";
import { MarketState } from "./market/MarketState.js";
import type { KronexStock, RootStateMessage, RuntimeConfig } from "./types.js";

type FairPriceMovement = {
  fairPriceChange: number;
  fairPriceChangePct: number;
};

class KronexBotRoot {
  private readonly logger: JsonlLogger;
  private readonly apiClient: KronexApiClient;
  private readonly marketState: MarketState;
  private readonly fairPriceWorker: FairPriceWorker;
  private readonly fairPriceEventWorker: FairPriceEventWorker;
  private readonly socketClient: KronexSocketClient;
  private readonly children = new Map<BotKind, ChildProcess>();
  private fairPriceTimer: ReturnType<typeof setInterval> | null = null;
  private fairPriceEventTimer: ReturnType<typeof setInterval> | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private summaryTimer: ReturnType<typeof setInterval> | null = null;
  private latestFairPriceUpdate: FairPriceMovement | null = null;

  constructor(private readonly config: RuntimeConfig) {
    this.logger = new JsonlLogger(config.logFilePath);
    this.apiClient = new KronexApiClient(config);
    this.marketState = new MarketState(config.stockId);
    this.fairPriceWorker = new FairPriceWorker(config.fairPrice);
    this.fairPriceEventWorker = new FairPriceEventWorker(config.fairPriceEvent);
    this.socketClient = new KronexSocketClient(config, this.marketState, this.logger);
  }

  async start(): Promise<void> {
    const stocks = await this.apiClient.fetchStocks();
    const stock = this.findConfiguredStock(stocks);
    this.marketState.initializeFromStock(stock);

    const initialPrice = this.marketState.getCurrentPrice();
    if (initialPrice === null) {
      throw new Error(`stockId=${this.config.stockId} has no initial price`);
    }

    this.fairPriceWorker.initialize(initialPrice);
    this.spawnBots();
    this.socketClient.connect();
    this.startTimers();
    this.broadcastState();

    await this.logger.log("root_started", {
      stockId: this.config.stockId,
      initialPrice,
      fairPrice: this.fairPriceWorker.value,
      fairPriceEventIntervalMs: this.config.fairPriceEvent.intervalMs,
      fairPriceEventMinRatePct: this.config.fairPriceEvent.minRatePct,
      fairPriceEventMaxRatePct: this.config.fairPriceEvent.maxRatePct,
      botCount: this.children.size
    });
    console.log(`[KronexBotRoot] running stockId=${this.config.stockId} bots=${this.children.size}`);
  }

  async stop(reason: string): Promise<void> {
    this.clearTimers();
    this.socketClient.disconnect();

    for (const child of this.children.values()) {
      if (child.connected) {
        child.send({ type: "shutdown" });
      }
    }

    setTimeout(() => {
      for (const child of this.children.values()) {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      }
    }, 1_000).unref();

    await this.logger.log("root_stopped", { reason });
  }

  private spawnBots(): void {
    const childPath = fileURLToPath(new URL("./processes/botProcess.js", import.meta.url));

    for (const kind of BOT_KINDS) {
      const child = fork(childPath, [kind], {
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        env: process.env
      });

      this.children.set(kind, child);
      child.on("exit", (code, signal) => {
        void this.logger.log("bot_process_exited", { botKind: kind, code, signal });
      });
    }
  }

  private startTimers(): void {
    this.fairPriceTimer = setInterval(() => {
      const currentPrice = this.marketState.getCurrentPrice();
      if (currentPrice === null) {
        return;
      }

      const update = this.fairPriceWorker.update(currentPrice);
      this.latestFairPriceUpdate = update;
      void this.logger.log("fair_price_updated", { ...update });
      this.broadcastState();
    }, 500);

    this.fairPriceEventTimer = setInterval(() => {
      const update = this.fairPriceEventWorker.update(this.fairPriceWorker.value);
      this.fairPriceWorker.replaceValue(update.fairPrice);
      this.latestFairPriceUpdate = update;
      void this.logger.log("fair_price_event_updated", { ...update });
      console.log(
        `[FairPriceEventWorker] eventRate=${update.eventRatePct.toFixed(4)}% fairPrice=${update.previousFairPrice.toFixed(2)}->${update.fairPrice.toFixed(2)} fairPriceChange=${this.formatSigned(update.fairPriceChange, 2)} fairPriceChangePct=${this.formatSigned(update.fairPriceChangePct, 4)}%`
      );
      this.broadcastState();
    }, this.config.fairPriceEvent.intervalMs);

    this.broadcastTimer = setInterval(() => {
      this.broadcastState();
    }, 100);

    this.summaryTimer = setInterval(() => {
      const snapshot = this.marketState.getSnapshot();
      const fairPriceChange = this.latestFairPriceUpdate
        ? `${this.latestFairPriceUpdate.fairPriceChange >= 0 ? "+" : ""}${this.latestFairPriceUpdate.fairPriceChange.toFixed(2)}`
        : "n/a";
      const fairPriceChangePct = this.latestFairPriceUpdate
        ? `${this.latestFairPriceUpdate.fairPriceChangePct >= 0 ? "+" : ""}${this.latestFairPriceUpdate.fairPriceChangePct.toFixed(4)}%`
        : "n/a";
      console.log(
        `[KronexBotRoot] lastPrice=${snapshot.lastPrice ?? "n/a"} fairPrice=${this.fairPriceWorker.value.toFixed(2)} fairPriceChange=${fairPriceChange} fairPriceChangePct=${fairPriceChangePct}`
      );
    }, this.config.consoleSummaryIntervalMs);
  }

  private clearTimers(): void {
    if (this.fairPriceTimer) {
      clearInterval(this.fairPriceTimer);
      this.fairPriceTimer = null;
    }

    if (this.fairPriceEventTimer) {
      clearInterval(this.fairPriceEventTimer);
      this.fairPriceEventTimer = null;
    }

    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }

    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
  }

  private broadcastState(): void {
    const message: RootStateMessage = {
      type: "state",
      snapshot: this.marketState.getSnapshot(),
      fairPrice: this.fairPriceWorker.value
    };

    for (const child of this.children.values()) {
      if (child.connected) {
        child.send(message);
      }
    }
  }

  private findConfiguredStock(stocks: KronexStock[]): KronexStock {
    const stock = stocks.find((item) => Number(item.id) === this.config.stockId);
    if (!stock) {
      throw new Error(`stockId=${this.config.stockId} was not found from /stocks`);
    }

    if (toPositiveNumber(stock.price) === null) {
      throw new Error(`stockId=${this.config.stockId} has no valid price`);
    }

    return stock;
  }

  private formatSigned(value: number, fractionDigits: number): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(fractionDigits)}`;
  }
}

const root = new KronexBotRoot(loadConfig());

process.on("SIGINT", () => {
  root.stop("SIGINT")
    .finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  root.stop("SIGTERM")
    .finally(() => process.exit(0));
});

root.start().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[KronexBotRoot] start failed message=${message}`);
  await root.stop("start_failed");
  process.exit(1);
});
