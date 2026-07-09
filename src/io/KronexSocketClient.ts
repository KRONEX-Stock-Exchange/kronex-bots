import { io, type Socket } from "socket.io-client";
import type { RuntimeConfig } from "../types.js";
import type { MarketState } from "../market/MarketState.js";
import type { JsonlLogger } from "./JsonlLogger.js";

export class KronexSocketClient {
  private socket: Socket | null = null;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly marketState: MarketState,
    private readonly logger: JsonlLogger
  ) {}

  connect(): void {
    this.socket = io(this.config.wsUrl, {
      auth: { token: this.config.accessToken }
    });

    this.socket.on("connect", () => {
      this.socket?.emit("joinStockRoom", this.config.stockId);
      void this.logger.log("socket_connected", { stockId: this.config.stockId });
    });

    this.socket.on("stockInfoUpdated", (payload: unknown) => {
      const applied = this.marketState.applyStockInfoUpdated(payload);
      if (!applied) {
        void this.logger.log("market_update_ignored", { source: "stockInfoUpdated" });
      }
    });

    this.socket.on("orderBookUpdated", (payload: unknown) => {
      const applied = this.marketState.applyOrderBookUpdated(payload);
      if (!applied) {
        void this.logger.log("market_update_ignored", { source: "orderBookUpdated" });
      }
    });

    for (const event of ["error", "errorCustom", "exception"] as const) {
      this.socket.on(event, (error: unknown) => {
        void this.logger.log("socket_error", {
          socketEvent: event,
          message: this.formatError(error)
        });
      });
    }

    this.socket.on("disconnect", (reason: string) => {
      void this.logger.log("socket_disconnected", { reason });
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return JSON.stringify(error);
  }
}
