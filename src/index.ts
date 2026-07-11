import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BOT_KINDS, type BotKind } from "./constants.js";
import { loadConfig } from "./config.js";
import { FairPriceEventWorker } from "./domain/fairPriceEvent.js";
import { FairPriceWorker } from "./domain/fairPrice.js";
import { toPositiveNumber } from "./domain/math.js";
import { clampPriceToLimits } from "./domain/priceLimits.js";
import { KronexApiClient } from "./io/KronexApiClient.js";
import { JsonlLogger } from "./io/JsonlLogger.js";
import { KronexSocketClient } from "./io/KronexSocketClient.js";
import { MarketState } from "./market/MarketState.js";
import type { KronexStock, MarketSnapshot, RootStateMessage, RuntimeConfig } from "./types.js";

type FairPriceMovement = {
  previousFairPrice: number;
  fairPrice: number;
  fairPriceChange: number;
  fairPriceChangePct: number;
  currentPrice?: number;
  divergencePct?: number;
};

class StockRuntime {
  private readonly logger: JsonlLogger;
  private readonly marketState: MarketState;
  private readonly fairPriceWorker: FairPriceWorker;
  private readonly fairPriceEventWorker: FairPriceEventWorker;
  private readonly socketClient: KronexSocketClient;
  private readonly children = new Map<BotKind, ChildProcess>();
  private fairPriceTimer: ReturnType<typeof setInterval> | null = null;
  private fairPriceEventTimer: ReturnType<typeof setInterval> | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: RuntimeConfig, logger: JsonlLogger) {
    this.logger = logger;
    this.marketState = new MarketState(config.stockId);
    this.fairPriceWorker = new FairPriceWorker(config.fairPrice);
    this.fairPriceEventWorker = new FairPriceEventWorker(config.fairPriceEvent);
    this.socketClient = new KronexSocketClient(config, this.marketState, this.logger);
  }

  start(stock: KronexStock): void {
    this.marketState.initializeFromStock(stock);

    const initialPrice = this.marketState.getCurrentPrice();
    if (initialPrice === null) {
      throw new Error(`stockId=${this.config.stockId} has no initial price`);
    }

    this.fairPriceWorker.initialize(clampPriceToLimits(initialPrice, this.marketState.getSnapshot()));
    this.spawnBots();
    this.socketClient.connect();
    this.startTimers();
    this.broadcastState();

    // await this.logger.log("root_started", {
    //   stockId: this.config.stockId,
    //   initialPrice,
    //   fairPrice: this.fairPriceWorker.value,
    //   fairPriceEventIntervalMs: this.config.fairPriceEvent.intervalMs,
    //   fairPriceEventMinRatePct: this.config.fairPriceEvent.minRatePct,
    //   fairPriceEventMaxRatePct: this.config.fairPriceEvent.maxRatePct,
    //   botCount: this.children.size
    // });
    console.log(`[StockRuntime] running stockId=${this.config.stockId} bots=${this.children.size}`);
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

    // await this.logger.log("root_stopped", { reason });
  }

  private spawnBots(): void {
    const childPath = fileURLToPath(new URL("./processes/botProcess.js", import.meta.url));

    for (const kind of BOT_KINDS) {
      const child = fork(childPath, [kind, String(this.config.stockId)], {
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        env: { ...process.env }
      });

      this.children.set(kind, child);
      child.on("exit", (code, signal) => {
        // void this.logger.log("bot_process_exited", { botKind: kind, code, signal });
      });
    }
  }

  private startTimers(): void {
    this.fairPriceTimer = setInterval(() => {
      const snapshot = this.marketState.getSnapshot();
      const currentPrice = snapshot.lastPrice;
      if (currentPrice === null) {
        return;
      }

      const update = this.applyFairPriceLimits(this.fairPriceWorker.update(currentPrice), snapshot);
      this.fairPriceWorker.replaceValue(update.fairPrice);
      // void this.logger.log("fair_price_updated", { ...update });
      this.logFairPriceMovement("FairPriceWorker", currentPrice, update);
      this.broadcastState();
    }, this.config.fairPrice.intervalMs);

    this.fairPriceEventTimer = setInterval(() => {
      const snapshot = this.marketState.getSnapshot();
      const update = this.applyFairPriceLimits(
        this.fairPriceEventWorker.update(this.fairPriceWorker.value),
        snapshot
      );
      this.fairPriceWorker.replaceValue(update.fairPrice);
      // void this.logger.log("fair_price_event_updated", { ...update });
      this.logFairPriceMovement("FairPriceEventWorker", snapshot.lastPrice, update);
      this.broadcastState();
    }, this.config.fairPriceEvent.intervalMs);

    this.broadcastTimer = setInterval(() => {
      this.broadcastState();
    }, 100);
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
  }

  private broadcastState(): void {
    const snapshot = this.marketState.getSnapshot();
    const fairPrice = this.enforceFairPriceLimits(snapshot);
    const message: RootStateMessage = {
      type: "state",
      snapshot,
      fairPrice
    };

    for (const child of this.children.values()) {
      if (child.connected) {
        child.send(message);
      }
    }
  }

  private enforceFairPriceLimits(snapshot: MarketSnapshot): number {
    const fairPrice = clampPriceToLimits(this.fairPriceWorker.value, snapshot);
    if (fairPrice !== this.fairPriceWorker.value) {
      this.fairPriceWorker.replaceValue(fairPrice);
    }

    return fairPrice;
  }

  private applyFairPriceLimits<T extends FairPriceMovement>(update: T, snapshot: MarketSnapshot): T {
    const fairPrice = clampPriceToLimits(update.fairPrice, snapshot);
    if (fairPrice === update.fairPrice) {
      return update;
    }

    const fairPriceChange = fairPrice - update.previousFairPrice;
    const adjusted = {
      ...update,
      fairPrice,
      fairPriceChange,
      fairPriceChangePct: update.previousFairPrice > 0
        ? (fairPriceChange / update.previousFairPrice) * 100
        : 0
    };

    if (adjusted.currentPrice !== undefined) {
      adjusted.divergencePct = Number.isFinite(adjusted.currentPrice) && adjusted.currentPrice > 0
        ? ((fairPrice - adjusted.currentPrice) / adjusted.currentPrice) * 100
        : 0;
    }

    return adjusted;
  }

  private formatSigned(value: number, fractionDigits: number): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(fractionDigits)}`;
  }

  private logFairPriceMovement(source: "FairPriceWorker" | "FairPriceEventWorker", lastPrice: number | null, update: FairPriceMovement): void {
    console.log(
      `[${source}] stockId=${this.config.stockId} lastPrice=${lastPrice ?? "n/a"} fairPrice=${update.fairPrice.toFixed(2)} fairPriceChange=${this.formatSigned(update.fairPriceChange, 2)} fairPriceChangePct=${this.formatSigned(update.fairPriceChangePct, 4)}%`
    );
  }
}

class KronexBotRoot {
  private readonly logger: JsonlLogger;
  private readonly apiClient: KronexApiClient;
  private readonly runtimes = new Map<number, StockRuntime>();

  constructor(private readonly config: RuntimeConfig) {
    this.logger = new JsonlLogger(config.logFilePath);
    this.apiClient = new KronexApiClient(config);
  }

  async start(): Promise<void> {
    const stocks = await this.apiClient.fetchStocks();

    for (const stockId of this.config.stockIds) {
      const stock = this.findConfiguredStock(stocks, stockId);
      const runtime = new StockRuntime(this.configForStock(stockId), this.logger);
      runtime.start(stock);
      this.runtimes.set(stockId, runtime);
    }

    console.log(`[KronexBotRoot] running stockIds=${this.config.stockIds.join(",")} runtimes=${this.runtimes.size}`);
  }

  async stop(reason: string): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await runtime.stop(reason);
    }
  }

  private configForStock(stockId: number): RuntimeConfig {
    return {
      ...this.config,
      stockId,
      stockIds: [stockId]
    };
  }

  private findConfiguredStock(stocks: KronexStock[], stockId: number): KronexStock {
    const stock = stocks.find((item) => Number(item.id) === stockId);
    if (!stock) {
      throw new Error(`stockId=${stockId} was not found from /stocks`);
    }

    if (toPositiveNumber(stock.price) === null) {
      throw new Error(`stockId=${stockId} has no valid price`);
    }

    return stock;
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
