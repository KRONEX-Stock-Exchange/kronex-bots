const MINUTES_PER_DAY = 24 * 60;

/** 휴장 시작 시각(UTC 00:00, 포함). */
export const MARKET_CLOSE_START_UTC_MINUTE = 0;
/** 휴장 종료 시각(UTC 00:05, 미포함). */
export const MARKET_CLOSE_END_UTC_MINUTE = 5;

export function utcMinuteOfDay(now: number | Date): number {
  const date = now instanceof Date ? now : new Date(now);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/**
 * 휴장 시간 여부.
 * 휴장 중에는 주문만 나가지 않는다. FairPrice는 계속 움직인다.
 */
export function isMarketClosed(now: number | Date = Date.now()): boolean {
  const start = normalizeMinuteOfDay(MARKET_CLOSE_START_UTC_MINUTE);
  const end = normalizeMinuteOfDay(MARKET_CLOSE_END_UTC_MINUTE);
  if (start === end) {
    return false;
  }

  const minuteOfDay = utcMinuteOfDay(now);
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

function normalizeMinuteOfDay(value: number): number {
  return ((Math.trunc(value) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
