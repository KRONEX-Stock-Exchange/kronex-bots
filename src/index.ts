import { loadConfig } from './config/config.js';

const config = loadConfig();

const extracted = {
  websocket: {
    url: config.wsUrl,
    auth: {
      tokenSource: 'BOT_ACCESS_TOKEN',
      socketIoHandshake: { auth: { token: '<BOT_ACCESS_TOKEN>' } }
    },
    stockSubscription: {
      emit: 'joinStockRoom',
      payload: config.stockId,
      events: ['stockInfoUpdated', 'orderBookUpdated', 'matchedListUpdated']
    },
    accountSubscriptions: [
      {
        role: 'BUY account',
        emit: 'joinAccountRoom',
        payload: config.buyAccountId,
        events: ['accountInit', 'accountBalanceUpdated', 'holdingUpdated', 'openOrdersUpdated']
      },
      {
        role: 'SELL account',
        emit: 'joinAccountRoom',
        payload: config.sellAccountId,
        events: ['accountInit', 'accountBalanceUpdated', 'holdingUpdated', 'openOrdersUpdated']
      }
    ]
  },
  accessToken: {
    env: 'BOT_ACCESS_TOKEN',
    configured: Boolean(config.accessToken),
    restHeader: 'Authorization: Bearer <BOT_ACCESS_TOKEN>',
    websocketAuth: 'auth.token = <BOT_ACCESS_TOKEN>'
  },
  orderRouting: {
    apiBaseUrl: config.apiBaseUrl,
    stockId: config.stockId,
    buy: {
      accountId: config.buyAccountId,
      accountNumber: config.buyAccountNumber,
      endpoint: `/stocks/${config.stockId}/orders/buy`,
      side: 'BUY',
      payload: {
        accountNumber: config.buyAccountNumber,
        price: '<number>',
        quantity: '<number>',
        orderType: 'LIMIT | MARKET'
      }
    },
    sell: {
      accountId: config.sellAccountId,
      accountNumber: config.sellAccountNumber,
      endpoint: `/stocks/${config.stockId}/orders/sell`,
      side: 'SELL',
      payload: {
        accountNumber: config.sellAccountNumber,
        price: '<number>',
        quantity: '<number>',
        orderType: 'LIMIT | MARKET'
      }
    }
  }
};

console.log(JSON.stringify(extracted, null, 2));
