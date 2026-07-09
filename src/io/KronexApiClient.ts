import { OrderSide, type OrderSide as OrderSideValue } from "../constants.js";
import type { ApiOrderResponse, KronexStock, OrderPayload, RuntimeConfig } from "../types.js";

export class KronexApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: RuntimeConfig,
    fetchImpl: typeof fetch = globalThis.fetch
  ) {
    if (typeof fetchImpl !== "function") {
      throw new Error("global fetch is required");
    }

    this.fetchImpl = fetchImpl;
  }

  async fetchStocks(): Promise<KronexStock[]> {
    const response = await this.fetchImpl(`${this.config.apiBaseUrl}/stocks`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    const body = await this.parseJson(response);
    if (!response.ok) {
      throw new Error(`stocks request failed status=${response.status}`);
    }

    if (Array.isArray(body)) {
      return body as KronexStock[];
    }

    if (body !== null && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
      return (body as { data: KronexStock[] }).data;
    }

    throw new Error("stocks response must be an array or { data: [...] }");
  }

  async sendOrder(input: {
    stockId: number;
    side: OrderSideValue;
    payload: OrderPayload;
  }): Promise<ApiOrderResponse> {
    const sidePath = input.side === OrderSide.BUY ? "buy" : "sell";

    try {
      const response = await this.fetchImpl(
        `${this.config.apiBaseUrl}/stocks/${input.stockId}/orders/${sidePath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(input.payload)
        }
      );

      return {
        ok: response.ok,
        status: response.status,
        body: await this.parseJson(response)
      };
    } catch (error: unknown) {
      return {
        ok: false,
        status: "network_error",
        body: {
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}
