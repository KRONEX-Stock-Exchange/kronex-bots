# Kronex Bots

Kronex용 단순 주문 봇 모음입니다. 봇은 서로 별개로 실행할 수 있고, 매수는 매수 전용 계좌, 매도는 매도 전용 계좌로만 전송합니다.

## 봇 구성

### 1. 호가창 채움 봇

```bash
BOT_ACCESS_TOKEN=... npm run bot:fill
```

동작:

- 1초마다 WebSocket 호가창을 확인합니다.
- 현재가 기준 아래 10호가는 매수 지정가로 확인합니다.
- 현재가 기준 위 10호가는 매도 지정가로 확인합니다.
- 매수/매도 호가를 합쳐서 해당 가격에 주문이 아예 없을 때만 지정가 주문으로 채웁니다.
- 빈 호가가 없으면 주문을 넣지 않고 계속 감시합니다.
- 기본으로 한 주기마다 빈 호가 1개만 채웁니다.

관련 설정:

- `FILL_INTERVAL_MS`: 확인 주기, 기본값 `1000`
- `FILL_LEVELS_EACH_SIDE`: 현재가 기준 위/아래 확인 호가 수, 기본값 `10`
- `FILL_MAX_ORDERS_PER_TICK`: 한 주기당 최대 주문 수, 기본값 `1`

### 2. 무작위 시장가 주문 봇

```bash
BOT_ACCESS_TOKEN=... npm run bot:random
```

동작:

- 기본 1초마다 시장가 주문 1개를 생성합니다.
- 매수/매도 방향은 랜덤입니다.
- 매수면 매수 전용 계좌, 매도면 매도 전용 계좌를 사용합니다.
- 주문 수량은 호가창 채움 봇과 같은 공식으로 계산합니다.

관련 설정:

- `RANDOM_ORDER_INTERVAL_MS`: 주문 주기, 기본값 `1000`

### 3. 상/하한가 범위 시드 봇

```bash
RANGE_LOWER_PRICE=8000 RANGE_UPPER_PRICE=12000 BOT_ACCESS_TOKEN=... npm run bot:range-fill
```

동작:

- 상장 초기처럼 호가창에 물량이 없을 때 전 호가에 물량을 세팅하는 시드 봇입니다.
- WebSocket을 감시하지 않습니다.
- 호가창에 기존 물량이 있는지 확인하지 않습니다.
- `RANGE_LOWER_PRICE`부터 `RANGE_CENTER_PRICE`까지 매수 지정가 주문을 세팅합니다.
- `RANGE_CENTER_PRICE`부터 `RANGE_UPPER_PRICE`까지 매도 지정가 주문을 세팅합니다.
- 모든 주문 전송을 시도한 뒤 프로그램을 종료합니다.

관련 설정:

- `RANGE_LOWER_PRICE`: 채울 하단 가격, 필수
- `RANGE_UPPER_PRICE`: 채울 상단 가격, 필수
- `RANGE_CENTER_PRICE`: 매수/매도 기준 가격, 필수

## 실행

```bash
npm install
BOT_ACCESS_TOKEN=... npm run bot:fill
```

기본값은 `BOT_DRY_RUN=true`입니다. 이 상태에서는 실제 주문을 전송하지 않고 로그만 출력합니다.

실제 주문을 보내려면 명시적으로 `BOT_DRY_RUN=false`를 설정합니다.

```bash
BOT_DRY_RUN=false BOT_ACCESS_TOKEN=... npm run bot:fill
```

## 환경변수

- `BOT_ACCESS_TOKEN`: Socket.IO handshake와 REST Authorization header에 쓰는 access token
- `KRONEX_WS_URL`: WebSocket URL, 기본값 `http://localhost:3001/stock`
- `KRONEX_API_BASE_URL`: REST API base URL, 기본값 `http://localhost:3001/api`
- `BOT_STOCK_ID`: 대상 종목 id, 기본값 `1`
- `BOT_BUY_ACCOUNT_ID`: 매수 전용 계좌 id, 기본값 `1`
- `BOT_BUY_ACCOUNT_NUMBER`: 매수 전용 계좌 번호, 기본값 `10001`
- `BOT_SELL_ACCOUNT_ID`: 매도 전용 계좌 id, 기본값 `2`
- `BOT_SELL_ACCOUNT_NUMBER`: 매도 전용 계좌 번호, 기본값 `10002`
- `BOT_DRY_RUN`: `true`면 로그만 출력, `false`면 REST 주문 전송, 기본값 `true`

## 수량 공식

기준 가격은 10,000원이고, 이때 주문 수량은 35주~1000주 사이에서 랜덤으로 정합니다.

실제 주문 수량:

```text
random(35, 1000) * 10000 / 주문가격
```

예시:

- 주문가격 10,000원: 35주~1000주
- 주문가격 20,000원: 기준 수량의 약 1/2
- 주문가격 5,000원: 기준 수량의 약 2배

관련 설정:

- `BOT_QUANTITY_REFERENCE_PRICE`: 기준 가격, 기본값 `10000`
- `BOT_QUANTITY_MIN_AT_REFERENCE`: 기준 가격에서 최소 수량, 기본값 `35`
- `BOT_QUANTITY_MAX_AT_REFERENCE`: 기준 가격에서 최대 수량, 기본값 `1000`

## 핵심 규칙

- WebSocket은 `io(KRONEX_WS_URL, { auth: { token: BOT_ACCESS_TOKEN } })`로 연결합니다.
- 종목 데이터는 `joinStockRoom`에 `BOT_STOCK_ID`를 emit해서 구독합니다.
- 계좌 데이터는 `joinAccountRoom`에 계좌 id를 emit해서 구독합니다.
- 매수 주문은 `BOT_BUY_ACCOUNT_ID` / `BOT_BUY_ACCOUNT_NUMBER` 계좌만 사용합니다.
- 매도 주문은 `BOT_SELL_ACCOUNT_ID` / `BOT_SELL_ACCOUNT_NUMBER` 계좌만 사용합니다.
- REST 주문 요청에는 `Authorization: Bearer <BOT_ACCESS_TOKEN>` header를 붙입니다.

## 주문 라우팅

- 매수: `accountId=1`, `accountNumber=10001`, endpoint `/stocks/{stockId}/orders/buy`
- 매도: `accountId=2`, `accountNumber=10002`, endpoint `/stocks/{stockId}/orders/sell`
- 요청 payload: `accountNumber`, `price`, `quantity`, `orderType`

## 검증

확인한 명령:

```bash
npm run typecheck
npm run build
```
