## 봇 로직 구현 문서

API, WEBSOCKET 요청 방법은 `BOT_REBUILD_REFERENCE.md` 문서 참조  
구현언어: TypeScript

봇들은 FairPrice라는 사용자는 모르지만 봇들만 참고하는 값을 중점으로 주문을 낸다.

FairPrice는 현재 가격과 관련이 없고 봇들이 판단하는 그 주식의 가치이다.

FairPrice는 일반 워커가 `BOT_FAIR_INTERVAL_MS`마다 이전 FairPrice 기준 **-0.56% ~ +0.56%** 사이의 랜덤한 비율만큼 변동한다.

FairPrice 이벤트 워커는 일반 FairPrice 워커와 별개로 작동하며, 기본 **30초마다** 기존 FairPrice를 **-40% ~ +40%** 범위 안에서 크게 변동시킨다.

FairPrice는 **최소 1원 미만으로 내려가지 않는다.**

FairPrice는 상한가/하한가 밖으로 움직일 수 있다.

종목별 FairPrice 워커와 FairPrice 이벤트 워커는 서로 독립된 랜덤 시드를 사용한다. `BOT_RANDOM_SEED`가 비어 있으면 실행할 때마다 새 시드를 만들고, 값이 있으면 같은 랜덤 흐름을 재현한다.

여러 종목이 같은 순간에 FairPrice를 바꾸지 않도록 첫 시작 시점에 `BOT_FAIR_START_JITTER_MS`, `BOT_FAIR_EVENT_START_JITTER_MS` 범위 안에서 종목별 지연을 적용한다.

아래 봇들은 이 값을 참고하여 주문을 낸다.

봇은 총 4가지의 종류로 구성되어 있고 각자 별도의 프로세스에서 작동된다. (실행 시 Root 프로세스를 실행하면 모든 봇이 함께 실행되어야 한다.)

각 봇 타입들은 종목별로 각각 한개의 프로세스를 실행한다.

여러 종목을 병렬로 실행할 경우 `.env`의 `BOT_STOCK_IDS`에 쉼표로 구분해 지정한다.

봇시작시 FairPrice는 현재가를 기준으로 초기화한다.

현재가는 WebSocket으로 수신한 가장 최근 체결가를 의미한다.

최근 체결가가 없으면 stock의 초기 현재가를 사용한다.

---

### 1. MarketMaker

**제출 가능한 주문종류:** 지정가

**역할:** 빈 호가가 생기지 않도록 지정가 주문을 넣어 호가를 채운다.

**내용:**

- 100ms마다 호가를 조회한다.
- 현재 체결가를 기준으로 아래 10호가, 위 10호가를 확인한다.
- 여러 호가가 비어있을 경우 150ms 간격으로 주문을 넣는다.
- MarketMaker는 100ms마다 호가 상태를 갱신하되, 실제 주문 생성은 마지막 주문 생성 시점으로부터 150ms 이상 지났을 때만 수행한다.
- 150ms마다 최대 1개의 지정가 주문만 생성한다.
- 해당 가격에 매수 또는 매도 주문이 하나도 존재하지 않으면 지정가 주문을 생성한다.
- 이미 주문이 존재하는 가격에는 주문을 생성하지 않는다.
- 매수 지정가는 현재가 이하의 비어있는 호가에만 생성한다.
- 매도 지정가는 현재가 이상의 비어있는 호가에만 생성한다.
- 매수 호가와 매도 호가는 각각 독립적으로 관리한다.
- 비어있는 매수 호가는 항상 매수 주문으로 채운다.
- 비어있는 매도 호가는 항상 매도 주문으로 채운다.
- FairPrice가 현재가보다 **0.5% 이상 높으면** 매수 호가를 우선적으로 채운다.
- FairPrice가 현재가보다 **0.5% 이상 낮으면** 매도 호가를 우선적으로 채운다.
- FairPrice와 현재가 차이가 **±0.5% 미만**이면 매수와 매도를 동일한 우선순위로 채운다.
- 기존 지정가 주문은 취소하거나 정정하지 않는다.
- 기준 주문금액은 `.env`의 `BOT_MM_MIN_ORDER_NOTIONAL`부터 `BOT_MM_MAX_ORDER_NOTIONAL` 사이에서 정한다.

---

### 2. NoiseTaker

**제출 가능한 주문종류:** 시장가

**역할:** 일반 투자자처럼 랜덤한 매수/매도 주문을 생성하여 실제 체결을 발생시킨다.

**내용:**

- **100~350ms** 사이의 랜덤한 간격으로 주문을 생성한다.
- 각 실행 주기마다 최대 1개의 시장가 주문만 생성한다.
- 괴리율은 아래 식을 사용한다.

```text
괴리율 = (FairPrice - 현재가) / FairPrice * 100
```

- 매수 확률은 아래 식을 사용하여 계산한다.

```text
편향비율 = clamp(괴리율 / BOT_NOISE_FULL_BIAS_DIVERGENCE_PCT, -1, 1)
매수 확률 = 편향비율 >= 0
  ? 50 + 편향비율 × (BOT_NOISE_MAX_SIDE_PROBABILITY_PCT - 50)
  : 50 + 편향비율 × (50 - BOT_NOISE_MIN_SIDE_PROBABILITY_PCT)
매수 확률 = clamp(매수 확률, BOT_NOISE_MIN_SIDE_PROBABILITY_PCT, BOT_NOISE_MAX_SIDE_PROBABILITY_PCT)
```

- 매도 확률은 아래 식을 사용하여 계산한다.

```text
매도 확률 = 100 - 매수 확률
```

- `clamp(value, min, max)`는 value가 min보다 작으면 min을, max보다 크면 max를 반환한다.
- 주문 방향은 계산된 매수/매도 확률에 따라 랜덤하게 결정한다.
- 기본값 기준 현재가와 FairPrice 차이가 없으면 매수/매도 확률은 50%/50%이다.
- 기본값 기준 현재가가 FairPrice보다 5% 이상 낮으면 매수 90%, 매도 10%이다.
- 기본값 기준 현재가가 FairPrice보다 5% 이상 높으면 매수 10%, 매도 90%이다.
- 그 사이는 괴리율에 따라 소수점 단위까지 점진적으로 변한다.
- 기준 주문금액은 `.env`의 `BOT_NOISE_MIN_ORDER_NOTIONAL`부터 `BOT_NOISE_MAX_ORDER_NOTIONAL` 사이에서 정한다.

---

### 3. Momentum Bot

**제출 가능한 주문종류:** 시장가

**역할:** 추세를 추종하는 역할을 한다.

**내용:**

- 최근 체결가 **31개**를 유지한다.
- 조건이 만족될 경우에 450ms 간격으로 주문을 생성한다.
- 각 실행 주기마다 최대 1개의 시장가 주문만 생성한다.
- 최근 체결가 **31개**를 비교하여 30회 연속 상승 또는 30회 연속 하락을 판단한다.
- 30회 연속 상승은 최근 체결가 31개가 `price1 <= price2 <= ... <= price31` 이고, 최소 1번 이상 실제 상승이 포함된 경우로 판단한다.
- 30회 연속 하락은 최근 체결가 31개가 `price1 >= price2 >= ... >= price31` 이고, 최소 1번 이상 실제 하락이 포함된 경우로 판단한다.
- 최근 체결가가 **30회 연속 상승**하면 시장가 매수 주문 생성을 시작한다.
- 최근 체결가가 **30회 연속 하락**하면 시장가 매도 주문 생성을 시작한다.
- 상승 또는 하락 조건이 유지되는 동안에만 450ms 간격으로 주문을 생성한다.
- 조건이 더 이상 만족되지 않으면 주문 생성을 중단한다.
- 동일 가격도 연속으로 판단한다.
- 상승 추세일 경우 FairPrice가 현재가보다 **0.5% 이상 높을 때만** 주문을 생성한다.
- 하락 추세일 경우 FairPrice가 현재가보다 **0.5% 이상 낮을 때만** 주문을 생성한다.
- 기준 주문금액은 `.env`의 `BOT_MOMENTUM_MIN_ORDER_NOTIONAL`부터 `BOT_MOMENTUM_MAX_ORDER_NOTIONAL` 사이에서 정한다.

---

### 4. MeanReversion Bot

**제출 가능한 주문종류:** 시장가

**역할:** 추세에 반대 주문을 내는 역할을 한다.

**내용:**

- 주문 생성 조건을 만족할 경우에 450-850ms 간격으로 주문을 생성한다.
- 각 실행 주기마다 최대 1개의 시장가 주문만 생성한다.
- 현재 체결가가 FairPrice보다 **5% 이상 높으면** 시장가 매도 주문을 생성한다.
- 현재 체결가가 FairPrice보다 **5% 이상 낮으면** 시장가 매수 주문을 생성한다.
- 괴리율의 절댓값이 **5% 미만**이면 주문을 생성하지 않는다.
- 괴리율 = `(현재가 - FairPrice) / FairPrice * 100`
- 기준 주문금액은 `.env`의 `BOT_REVERSION_MIN_ORDER_NOTIONAL`부터 `BOT_REVERSION_MAX_ORDER_NOTIONAL` 사이에서 정한다.

### 공통 봇 규칙

- 기준 주문금액은 `BOT_ORDER_REFERENCE_PRICE` 가격대에서의 주문금액을 의미한다.
- 실제 주문금액은 `기준주문금액 * ((주문가격 / BOT_ORDER_REFERENCE_PRICE) ^ BOT_ORDER_PRICE_DECAY_EXPONENT)`로 계산한다.
- 주가가 비싸질수록 주문금액은 완만하게 늘고, 주문 수량은 자연스럽게 줄어든다.
- 주문 수량은 `floor(주문금액 / 주문가격)`으로 계산한다.
- 계산된 주문 수량이 1주 미만일 경우 주문 금액을 해당 주식의 1주 가격으로 조정한 뒤 다시 수량을 계산한다.
- 시장가 주문의 주문가격은 현재가를 사용한다.
- 지정가 주문의 주문가격은 지정가 가격을 사용한다.
- `stockInfoUpdated` 이벤트의 `upperLimit`, `lowerLimit`은 수신할 때마다 현재 상한가/하한가로 갱신한다.
- 이벤트에 상한가/하한가 필드가 없으면 기존 값을 유지한다.
- 주문가격이 상한가보다 높거나 하한가보다 낮으면 주문을 생성하지 않는다.
- 현재가가 상한가에 도달하면 매수 주문을 생성하지 않는다.
- 현재가가 하한가에 도달하면 매도 주문을 생성하지 않는다.
- 상한가/하한가에서 한쪽 주문이 막힌 상태라도 허용 가능한 반대 주문은 생성할 수 있다.

### 환경변수 튜닝

- 봇별 주문 주기와 최소/최대 기준 주문금액은 `.env`에서 조정한다.
- 병렬 실행 종목: `BOT_STOCK_IDS`
- 랜덤 시드와 FairPrice 시작 지연: `BOT_RANDOM_SEED`, `BOT_FAIR_START_JITTER_MS`, `BOT_FAIR_EVENT_START_JITTER_MS`
- 공통 주문금액 스케일: `BOT_ORDER_REFERENCE_PRICE`, `BOT_ORDER_PRICE_DECAY_EXPONENT`, `BOT_MAX_ORDER_NOTIONAL`
- MarketMaker: `BOT_MM_CHECK_INTERVAL_MS`, `BOT_MM_ORDER_INTERVAL_MS`, `BOT_MM_MIN_ORDER_NOTIONAL`, `BOT_MM_MAX_ORDER_NOTIONAL`
- NoiseTaker: `BOT_NOISE_MIN_INTERVAL_MS`, `BOT_NOISE_MAX_INTERVAL_MS`, `BOT_NOISE_MIN_ORDER_NOTIONAL`, `BOT_NOISE_MAX_ORDER_NOTIONAL`, `BOT_NOISE_MIN_SIDE_PROBABILITY_PCT`, `BOT_NOISE_MAX_SIDE_PROBABILITY_PCT`, `BOT_NOISE_FULL_BIAS_DIVERGENCE_PCT`
- MomentumBot: `BOT_MOMENTUM_INTERVAL_MS`, `BOT_MOMENTUM_MIN_ORDER_NOTIONAL`, `BOT_MOMENTUM_MAX_ORDER_NOTIONAL`
- MeanReversionBot: `BOT_REVERSION_MIN_INTERVAL_MS`, `BOT_REVERSION_MAX_INTERVAL_MS`, `BOT_REVERSION_MIN_ORDER_NOTIONAL`, `BOT_REVERSION_MAX_ORDER_NOTIONAL`
- FairPrice: `BOT_FAIR_INTERVAL_MS`, `BOT_FAIR_RANDOM_DELTA_MIN`, `BOT_FAIR_RANDOM_DELTA_MAX`, `BOT_FAIR_EVENT_INTERVAL_MS`, `BOT_FAIR_EVENT_RATE_MIN_PCT`, `BOT_FAIR_EVENT_RATE_MAX_PCT`
- `BOT_MAX_ORDER_NOTIONAL`은 기준가격에서의 전체 주문 공통 최대금액이다.
