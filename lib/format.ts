import { defaultLocale } from "./i18n";

export function formatInteger(value: number) {
  return new Intl.NumberFormat(defaultLocale, { maximumFractionDigits: 0 }).format(value);
}

export function formatMoney(value: number, currency = "USD") {
  try { return new Intl.NumberFormat(defaultLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value); }
  catch { return `${formatNumber(value)} ${currency}`; }
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(defaultLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatQuantity(value: number) {
  return new Intl.NumberFormat(defaultLocale, { maximumFractionDigits: 8 }).format(value);
}

export function formatPercent(value: number) {
  return `${formatNumber(value)}%`;
}
