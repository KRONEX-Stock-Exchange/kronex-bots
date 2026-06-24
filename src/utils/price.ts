export function getTickSize(price: number): number {
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

export function nextTickPrice(price: number): number {
  return price + getTickSize(price);
}

export function prevTickPrice(price: number): number {
  return Math.max(1, price - getTickSize(Math.max(1, price - 1)));
}

export function roundPrice(price: number, direction: 'down' | 'up'): number {
  const tick = getTickSize(price);
  return direction === 'down' ? Math.floor(price / tick) * tick : Math.ceil(price / tick) * tick;
}

export function pricesBelow(center: number, count: number): number[] {
  const prices: number[] = [];
  let price = center;
  for (let i = 0; i < count; i += 1) {
    price = prevTickPrice(price);
    prices.push(price);
  }
  return prices;
}

export function pricesAbove(center: number, count: number): number[] {
  const prices: number[] = [];
  let price = center;
  for (let i = 0; i < count; i += 1) {
    price = nextTickPrice(price);
    prices.push(price);
  }
  return prices;
}
