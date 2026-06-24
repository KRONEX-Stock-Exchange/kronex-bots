import { io, Socket } from 'socket.io-client';
import { BotConfig } from './config/config.js';
import { MarketState } from './market-state.js';

export class WsClient {
  private socket?: Socket;

  constructor(
    private readonly config: BotConfig,
    private readonly state: MarketState
  ) {}

  connect(): void {
    this.socket = io(this.config.wsUrl, { auth: { token: this.config.accessToken } });

    this.socket.on('connect', () => {
      console.log('[ws] connected', this.socket?.id);
      this.socket?.emit('joinStockRoom', this.config.stockId);
      this.socket?.emit('joinAccountRoom', this.config.buyAccountId);
      this.socket?.emit('joinAccountRoom', this.config.sellAccountId);
    });

    this.socket.on('stockInfoUpdated', (data) => this.state.updateStockInfo(data));
    this.socket.on('orderBookUpdated', (data) => this.state.updateOrderBook(data));
    this.socket.on('error', (data) => console.error('[ws:error]', data));
    this.socket.on('errorCustom', (data) => console.error('[ws:auth-error]', data));
    this.socket.on('exception', (data) => console.error('[ws:exception]', data));
    this.socket.on('disconnect', (reason) => console.warn('[ws] disconnected', reason));
  }
}
