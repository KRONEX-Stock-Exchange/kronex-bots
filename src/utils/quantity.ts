import { BotConfig } from '../config/config.js';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function quantityForPrice(price: number, config: BotConfig): number {
  const baseQuantity = randomInt(config.quantityMinAtReference, config.quantityMaxAtReference);
  const scaled = baseQuantity * (config.quantityReferencePrice / Math.max(1, price));
  return Math.max(1, Math.round(scaled));
}
