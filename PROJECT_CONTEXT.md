# Kronex Bots 프로젝트 컨텍스트

이 문서는 다른 세션에서 프로젝트를 열었을 때 빠르게 이어받기 위한 요약이다. 상세 봇 규칙은 `BOT_BUILD.md`, API/웹소켓 규격은 `BOT_REBUILD_REFERENCE.md`를 먼저 확인한다.

## 프로젝트 개요

- TypeScript 기반 Kronex 주식 거래 봇이다.
- 루트 프로세스가 종목별 런타임을 만들고, 각 종목마다 4개 봇 프로세스를 실행한다.
- 실행 진입점은 `src/index.ts`, 자식 봇 프로세스 진입점은 `src/processes/botProcess.ts`다.
- 실행 명령은 `npm start`, 검증은 `npm test`다.
- `.env`에는 실제 토큰이 들어갈 수 있으므로 내용을 출력하지 말고, 필요한 키만 `rg`로 확인한다.

## 주요 구조

- `src/index.ts`
  - 전체 루트 프로세스.
  - `BOT_STOCK_IDS`에 지정된 종목마다 `StockRuntime`을 만든다.
  - 종목별 `MarketState`, `FairPriceWorker`, `FairPriceEventWorker`, WebSocket client, 봇 자식 프로세스를 관리한다.

- `src/processes/botProcess.ts`
  - 봇 자식 프로세스 진입점.
  - 부모가 넘긴 봇 종류와 종목 ID로 단일 봇을 실행한다.
  - 부모가 보낸 snapshot/fairPrice를 기준으로 주문을 판단한다.

- `src/market/MarketState.ts`
  - 현재가, 상한가, 하한가, 호가, 최근 체결가 히스토리를 관리한다.
  - `stockInfoUpdated` 이벤트를 받을 때마다 상하한가를 갱신한다.
  - 이벤트에 상하한가 필드가 없으면 기존 값을 유지한다.
  - 현재가가 저장된 제한 범위를 벗어나면 새 제한값이 함께 올 때까지 그 가격 갱신을 보류한다.
  - `orderBookUpdated`가 양쪽 빈 배열이면 기존 호가를 모두 비운다.

- `src/domain/priceLimits.ts`
  - 상하한가 상태, 주문가격 제한, 허용 주문 방향을 판단한다.
  - 현재가가 상한가면 `BUY` 금지, `SELL` 허용.
  - 현재가가 하한가면 `SELL` 금지, `BUY` 허용.

- `src/domain/random.ts`
  - 실행 시드, 종목별/봇별 파생 시드, seed 기반 RNG를 제공한다.
  - 여러 종목이 같은 랜덤 흐름이나 같은 FairPrice 타이밍을 공유하지 않게 한다.

- `src/io/OrderRouter.ts`
  - 최종 주문 검증 및 API 전송.
  - 주문가격 상하한가 초과, 막힌 방향, 수량, 계좌, 주문 타입을 최종 방어한다.

- `src/io/KronexApiClient.ts`
  - REST 조회 및 주문 요청을 전송한다.
  - `BOT_API_REQUEST_TIMEOUT_MS`가 지나면 요청을 중단해 봇의 `busy` 상태가 계속 고정되지 않게 한다.

## 봇 종류

- `MarketMakerBot`
  - 지정가만 사용.
  - 현재가 기준 아래 10호가, 위 10호가 중 빈 호가를 채운다.
  - 매수와 매도별로 한 가격에 한 번만 예약/주문하도록 `locallyReservedPrices`를 관리한다.
  - 같은 가격의 반대 방향 주문은 해당 방향 호가의 점유로 보지 않는다.
  - 상한가에서는 SELL 후보만, 하한가에서는 BUY 후보만 본다.

- `NoiseTakerBot`
  - 시장가만 사용.
  - FairPrice와 현재가 괴리에 따라 BUY/SELL 확률을 점진적으로 바꾼다.
  - 상한가/하한가에서 랜덤이 막힌 방향을 골라도 허용 가능한 반대 방향으로 fallback 할 수 있다.

- `MomentumBot`
  - 시장가만 사용.
  - 최근 체결가 31개로 30회 연속 상승/하락을 판단한다.
  - 조건이 유지되는 동안 주문하고, 조건이 깨지면 종료 로그를 남긴다.

- `MeanReversionBot`
  - 시장가만 사용.
  - 현재가가 FairPrice보다 5% 이상 높으면 SELL, 5% 이상 낮으면 BUY.
  - 시작/종료 로그를 남긴다.

## FairPrice 정책

- FairPrice는 봇 내부 가치 판단값이다.
- 일반 FairPrice 워커는 `BOT_FAIR_INTERVAL_MS`마다 이전 FairPrice 기준 랜덤 비율로 움직인다.
- 이벤트 FairPrice 워커는 `BOT_FAIR_EVENT_INTERVAL_MS`마다 더 큰 비율로 움직인다.
- FairPrice는 최소 1원 미만으로 내려가지 않는다.
- FairPrice는 상한가/하한가 밖으로 움직일 수 있다.
- FairPrice가 상한가 위에 있어도 SELL 주문은 나올 수 있다.
- FairPrice가 하한가 아래에 있어도 BUY 주문은 나올 수 있다.
- 실제 주문가격은 상한가/하한가 밖으로 나가면 안 된다.

## 휴장 시간

- 매일 UTC 00:00부터 00:05까지는 휴장 시간이다.
- 이 구간에는 어떤 봇도 주문을 내지 않는다.
- FairPrice 워커와 FairPrice 이벤트 워커는 그대로 돌아간다. 주문만 막힌다.
- 판정은 `src/domain/marketHours.ts`의 `isMarketClosed()`가 한다.
- 차단 지점은 두 곳이다.
  - `getReadyState()`: 봇 tick이 아예 주문 후보를 만들지 않는다.
  - `OrderRouter.validate()`: 최종 방어로 `market_closed` 사유로 거절한다.

## 멀티 종목 실행

- 공개 설정은 `BOT_STOCK_IDS`만 사용한다.
- `BOT_STOCK_ID`는 사용하지 않는다.
- 예시:

```env
BOT_STOCK_IDS=1,900002,900003,900004
```

- 종목별로 `StockRuntime`이 하나씩 생긴다.
- 각 종목마다 `MARKET_MAKER`, `NOISE_TAKER`, `MOMENTUM`, `MEAN_REVERSION` 자식 프로세스가 하나씩 생긴다.

## 랜덤 정책

- `BOT_RANDOM_SEED`가 비어 있으면 실행할 때마다 새 base seed를 만든다.
- `BOT_RANDOM_SEED`가 있으면 같은 랜덤 흐름을 재현할 수 있다.
- 종목별 FairPrice 워커, FairPrice 이벤트 워커, 봇 프로세스는 base seed에서 서로 다른 seed를 파생한다.
- FairPrice 첫 시작은 아래 env 범위 안에서 종목별로 지연된다.

```env
BOT_FAIR_START_JITTER_MS=500
BOT_FAIR_EVENT_START_JITTER_MS=3000
```

## 중요한 env

- API/인증
  - `KRONEX_API_BASE_URL`
  - `BOT_API_REQUEST_TIMEOUT_MS`
  - `KRONEX_WS_URL`
  - `BOT_ACCESS_TOKEN`

- 종목/로그
  - `BOT_STOCK_IDS`
  - `BOT_LOG_FILE`

- 주문금액 스케일
  - `BOT_ORDER_REFERENCE_PRICE`
  - `BOT_ORDER_PRICE_DECAY_EXPONENT`
  - `BOT_MAX_ORDER_NOTIONAL`

- FairPrice
  - `BOT_FAIR_INTERVAL_MS`
  - `BOT_FAIR_RANDOM_DELTA_MIN`
  - `BOT_FAIR_RANDOM_DELTA_MAX`
  - `BOT_FAIR_EVENT_INTERVAL_MS`
  - `BOT_FAIR_EVENT_RATE_MIN_PCT`
  - `BOT_FAIR_EVENT_RATE_MAX_PCT`
  - `BOT_RANDOM_SEED`
  - `BOT_FAIR_START_JITTER_MS`
  - `BOT_FAIR_EVENT_START_JITTER_MS`

- 봇별 주문 주기/금액
  - `BOT_MM_*`
  - `BOT_NOISE_*`
  - `BOT_MOMENTUM_*`
  - `BOT_REVERSION_*`

## 검증 방법

```bash
npm test
```

테스트는 TypeScript build 후 `node --test dist/test/*.js`를 실행한다.

## 작업 시 주의점

- `.env` 전체를 출력하지 않는다. 토큰이 들어 있다.
- 기존 JSONL 저장 호출은 일부 주석 처리되어 있다. 다시 켜기 전 의도 확인이 필요하다.
- 주문 API 400이 보이면 `OrderRouter` 검증을 통과한 뒤 서버에서 거절된 것이므로 `responseBody` 로그를 먼저 본다.
- 휴장 시간 정책은 `marketHours.ts`, `getReadyState()`, `OrderRouter.validate()` 세 군데가 함께 맞아야 한다.
- 상하한가 관련 정책은 `priceLimits.ts`, 봇 주문 생성, `OrderRouter.validate()` 세 군데가 함께 맞아야 한다.
- MarketMaker는 호가를 라이브로 받지만, 주문 생성 주기는 별도로 있다. `BOT_MM_CHECK_INTERVAL_MS`는 봇이 snapshot을 보고 주문 후보를 판단하는 주기다.
- 종목별 자식 봇 프로세스가 비정상 종료되면 루트가 1초 뒤 자동 재시작한다.
- `dist/`, `logs/`, `node_modules/`는 생성물이다.
