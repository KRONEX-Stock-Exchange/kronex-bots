import { ALLOWED_ORDER_TYPE_BY_BOT, OrderSide, OrderType } from "../constants.js";
import { isAlignedToTick } from "../domain/tickSize.js";
import type {
  ApiOrderResponse,
  JsonRecord,
  MarketSnapshot,
  OrderDraft,
  OrderPayload,
  OrderValidationResult,
  RuntimeConfig
} from "../types.js";
import type { KronexApiClient } from "./KronexApiClient.js";
import type { JsonlLogger } from "./JsonlLogger.js";

export class OrderRouter {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly apiClient: KronexApiClient,
    private readonly logger: JsonlLogger
  ) {}

  async route(order: OrderDraft, snapshot: MarketSnapshot, fairPrice: number): Promise<ApiOrderResponse | null> {
    await this.logger.log("order_created", this.logPayload(order, snapshot, fairPrice));
    const validation = this.validate(order, snapshot);

    if (!validation.valid) {
      await this.logger.log("order_skipped", {
        ...this.logPayload(order, snapshot, fairPrice),
        reason: validation.reason
      });
      return null;
    }

    const response = await this.apiClient.sendOrder({
      stockId: order.stockId,
      side: order.side,
      payload: validation.payload
    });

    await this.logger.log(response.ok ? "order_sent" : "order_rejected", {
      ...this.logPayload(order, snapshot, fairPrice),
      status: response.status,
      responseBody: response.body
    });

    return response;
  }

  validate(order: OrderDraft, snapshot: MarketSnapshot): OrderValidationResult {
    if (order.stockId !== this.config.stockId || snapshot.stockId !== this.config.stockId) {
      return { valid: false, reason: "stock_id_mismatch" };
    }

    if (order.side !== OrderSide.BUY && order.side !== OrderSide.SELL) {
      return { valid: false, reason: "invalid_side" };
    }

    if (order.orderType !== OrderType.MARKET && order.orderType !== OrderType.LIMIT) {
      return { valid: false, reason: "invalid_order_type" };
    }

    if (ALLOWED_ORDER_TYPE_BY_BOT[order.botKind] !== order.orderType) {
      return { valid: false, reason: "bot_order_type_not_allowed" };
    }

    if (!this.config.accessToken) {
      return { valid: false, reason: "missing_access_token" };
    }

    if (!Number.isInteger(order.quantity) || order.quantity < 1) {
      return { valid: false, reason: "invalid_quantity" };
    }

    if (!Number.isFinite(order.referencePrice) || order.referencePrice <= 0) {
      return { valid: false, reason: "invalid_reference_price" };
    }

    if (order.orderType === OrderType.MARKET) {
      if (snapshot.lastPrice === null || order.price !== snapshot.lastPrice || order.referencePrice !== snapshot.lastPrice) {
        return { valid: false, reason: "market_price_must_equal_last_price" };
      }
    }

    if (order.orderType === OrderType.LIMIT && !isAlignedToTick(order.price)) {
      return { valid: false, reason: "limit_price_not_aligned_to_tick" };
    }

    const notional = order.quantity * order.referencePrice;
    if (notional > this.config.hardMaxOrderNotional) {
      return { valid: false, reason: "hard_notional_limit_exceeded" };
    }

    const account = order.side === OrderSide.BUY ? this.config.accounts.buy : this.config.accounts.sell;
    if (!Number.isInteger(account.accountNumber) || account.accountNumber < 1) {
      return { valid: false, reason: "invalid_account_number" };
    }

    if (this.config.accounts.buy.accountNumber === this.config.accounts.sell.accountNumber) {
      return { valid: false, reason: "buy_sell_accounts_must_differ" };
    }

    const payload: OrderPayload = {
      accountNumber: account.accountNumber,
      price: order.referencePrice,
      quantity: order.quantity,
      orderType: order.orderType
    };

    return { valid: true, payload };
  }

  private logPayload(order: OrderDraft, snapshot: MarketSnapshot, fairPrice: number): JsonRecord {
    return {
      orderId: order.id,
      stockId: order.stockId,
      botKind: order.botKind,
      side: order.side,
      orderType: order.orderType,
      price: order.price,
      quantity: order.quantity,
      referencePrice: order.referencePrice,
      actualNotional: order.quantity * order.referencePrice,
      fairPrice,
      lastPrice: snapshot.lastPrice,
      reason: order.reason
    };
  }
}
