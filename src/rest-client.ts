import { BotConfig } from './config/config.js';
import { OrderIntent } from './types/domain.js';

export class RestClient {
  constructor(private readonly config: BotConfig) {}

  async placeOrder(intent: OrderIntent): Promise<void> {
    this.assertDedicatedAccount(intent);

    if (this.config.dryRun) {
      console.log(
        `[dry-run order] side=${intent.side} stockId=${intent.stockId} accountId=${intent.accountId} accountNumber=${intent.accountNumber} price=${intent.price} quantity=${intent.quantity} orderType=${intent.orderType} reason="${intent.reason}"`
      );
      return;
    }

    const path = intent.side === 'BUY' ? `/stocks/${intent.stockId}/orders/buy` : `/stocks/${intent.stockId}/orders/sell`;
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        accountNumber: intent.accountNumber,
        price: intent.price,
        quantity: intent.quantity,
        orderType: intent.orderType
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`order failed ${response.status}: ${text}`);
    }
  }

  private assertDedicatedAccount(intent: OrderIntent): void {
    if (intent.side === 'BUY' && (intent.accountId !== this.config.buyAccountId || intent.accountNumber !== this.config.buyAccountNumber)) {
      throw new Error(`blocked BUY order from non-buy account: accountId=${intent.accountId} accountNumber=${intent.accountNumber}`);
    }
    if (intent.side === 'SELL' && (intent.accountId !== this.config.sellAccountId || intent.accountNumber !== this.config.sellAccountNumber)) {
      throw new Error(`blocked SELL order from non-sell account: accountId=${intent.accountId} accountNumber=${intent.accountNumber}`);
    }
  }
}
