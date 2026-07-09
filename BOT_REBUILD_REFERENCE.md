# Kronex Bot Integration Reference

이 문서는 Kronex 봇을 만들 때 필요한 서버 연동 규격만 정리한다.

포함 범위:

- 전체 종목 조회 API
- 주문 API
- access token 적용 방식
- 매수/매도 계좌 선택 규칙
- WebSocket 시장 데이터 구독 방식
- 주문 payload 형식
- 공통 주문 제한
- 호가 단위

## REST API

기본 REST 주소는 런타임 설정값으로 주입한다.

```text
KRONEX_API_BASE_URL=http://localhost:3000/api
```

### 전체 종목 조회

```http
GET {KRONEX_API_BASE_URL}/stocks
Accept: application/json
```

응답은 배열 또는 `{ "data": [...] }` 형태를 모두 허용한다.

```json
[
  {
    "id": 1,
    "name": "Kronex Sample",
    "price": "10000",
    "status": "LISTED"
  }
]
```

봇에서 필요한 최소 필드:

| 필드     | 타입               | 설명                                 |
| -------- | ------------------ | ------------------------------------ |
| `id`     | number             | 주문 endpoint에 들어가는 `stockId`   |
| `name`   | string             | 로그 표시용 종목명                   |
| `price`  | string 또는 number | 현재 기준 가격으로 사용할 수 있는 값 |
| `status` | string             | 상장 상태                            |

### 매수 주문

```http
POST {KRONEX_API_BASE_URL}/stocks/{stockId}/orders/buy
Authorization: Bearer {BOT_ACCESS_TOKEN}
Content-Type: application/json
```

### 매도 주문

```http
POST {KRONEX_API_BASE_URL}/stocks/{stockId}/orders/sell
Authorization: Bearer {BOT_ACCESS_TOKEN}
Content-Type: application/json
```

### 주문 payload

```json
{
  "accountNumber": 10001,
  "price": 10000,
  "quantity": 1,
  "orderType": "LIMIT"
}
```

| 필드            | 타입                      | 설명                                          |
| --------------- | ------------------------- | --------------------------------------------- |
| `accountNumber` | number                    | 주문 방향에 맞는 계좌번호                     |
| `price`         | number                    | 지정가 주문 가격 또는 시장가 주문의 기준 가격 |
| `quantity`      | number                    | 정수 수량, 최소 1                             |
| `orderType`     | `"MARKET"` 또는 `"LIMIT"` | 주문 타입                                     |

시장가 주문도 payload에는 `price`를 넣는다. 이 값은 주문 금액 제한을 계산하기 위한 기준 가격으로 `lastPrice`를 사용한다.

## Access Token

REST 주문 요청에는 반드시 Bearer token을 붙인다.

```http
Authorization: Bearer {BOT_ACCESS_TOKEN}
```

전체 종목 조회는 현재 클라이언트 기준으로 인증 헤더 없이 호출한다.

WebSocket 연결은 `auth.token`에 같은 token을 넣는다.

```ts
io(KRONEX_WS_URL, {
  auth: { token: BOT_ACCESS_TOKEN },
});
```

## 계좌 선택 규칙

매수와 매도는 서로 다른 전용 계좌를 사용한다.

```text
BUY  -> BOT_BUY_ACCOUNT_ID / BOT_BUY_ACCOUNT_NUMBER
SELL -> BOT_SELL_ACCOUNT_ID / BOT_SELL_ACCOUNT_NUMBER
```

기본값:

| 방향   | accountId | accountNumber |
| ------ | --------: | ------------: |
| `BUY`  |       `1` |       `10001` |
| `SELL` |       `2` |       `10002` |

주문 전송 전 검증:

- `BUY` 주문은 매수 전용 계좌만 사용한다.
- `SELL` 주문은 매도 전용 계좌만 사용한다.
- 방향과 계좌가 맞지 않으면 주문을 보내지 않는다.

## WebSocket 시장 데이터

기본 WebSocket 주소는 런타임 설정값으로 주입한다.

```text
KRONEX_WS_URL=ws://localhost:3001/stock
```

연결 방식:

```ts
const socket = io(KRONEX_WS_URL, {
  auth: { token: BOT_ACCESS_TOKEN },
});
```

종목 room 구독:

```ts
socket.emit("joinStockRoom", stockId);
```

수신 이벤트:

| 이벤트             | 설명                       |
| ------------------ | -------------------------- |
| `stockInfoUpdated` | 현재가, 종목 정보 갱신     |
| `orderBookUpdated` | 호가창 갱신                |
| `error`            | 일반 socket 오류           |
| `errorCustom`      | 인증 또는 서버 커스텀 오류 |
| `exception`        | socket exception           |
| `disconnect`       | 연결 종료                  |

봇은 WebSocket으로 받은 `lastPrice`와 order book snapshot을 기준으로 주문을 판단한다. 가격, 캔들, 호가창은 봇이 직접 생성하지 않는다.

`kronex-realtime-server`의 실제 `orderBookUpdated` payload는 아래 필드명을 사용한다.

```json
{
  "buyOrderbook": [
    { "price": "19480", "quantity": "3" }
  ],
  "sellOrderbook": [
    { "price": "19490", "quantity": "4" }
  ]
}
```

`price`, `quantity`는 문자열로 올 수 있으므로 봇은 숫자로 변환해서 사용한다.

## 주문 타입 규칙

사용 가능한 주문 타입:

```text
MARKET
LIMIT
```

주문 타입별 기준:

| 주문 타입 | 가격 처리             | 설명                                                |
| --------- | --------------------- | --------------------------------------------------- |
| `MARKET`  | `price = lastPrice`   | 시장가 주문. 기준 가격은 주문 금액 제한 계산에 사용 |
| `LIMIT`   | 호가 단위 보정된 가격 | 지정가 주문. 서버 호가 단위를 반드시 준수           |

## 공통 주문 제한

모든 주문은 전송 직전에 다시 제한을 검사한다.

```text
maxOrderNotional = 10,000,000
referencePrice = LIMIT이면 orderPrice, MARKET이면 lastPrice
maxQuantity = floor(maxOrderNotional / referencePrice)
```

주문 가능 조건:

```text
quantity >= 1
quantity는 정수
referencePrice > 0
quantity * referencePrice <= maxOrderNotional
```

`maxQuantity < 1`이면 해당 주문은 보내지 않는다.

## 호가 단위

지정가 주문 가격은 아래 호가 단위를 따른다.

|                   가격 구간 | 호가 단위 |
| --------------------------: | --------: |
|                  2,000 미만 |         1 |
|     2,000 이상 ~ 5,000 미만 |         5 |
|    5,000 이상 ~ 20,000 미만 |        10 |
|   20,000 이상 ~ 50,000 미만 |        50 |
|  50,000 이상 ~ 200,000 미만 |       100 |
| 200,000 이상 ~ 500,000 미만 |       500 |
|                500,000 이상 |     1,000 |

시장가 주문은 새 지정가 가격을 만들지 않으므로 호가 단위 보정 대상이 아니다.

## 주문 전송 전 체크리스트

- `stockId`가 전체 종목 조회 결과에 존재한다.
- 주문 방향이 `BUY` 또는 `SELL`이다.
- 주문 타입이 `MARKET` 또는 `LIMIT`이다.
- 방향에 맞는 계좌번호를 사용한다.
- REST 주문 요청에 Bearer token을 붙인다.
- 수량은 1 이상의 정수다.
- 주문 금액은 1,000만원을 넘지 않는다.
- `LIMIT` 가격은 호가 단위에 맞는다.
- `MARKET` 주문의 기준 가격은 `lastPrice`다.
- 실패 또는 skip 사유는 JSONL 로그로 남긴다.

## 참고

더 많은 정보가 필요할 경우에는
kronex-server, kronex-realtime-server 폴더 참고 후 이 README에 기록한다.
