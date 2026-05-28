import { defaultLocale } from "./i18n";

export function formatMoney(value: number) {
  return new Intl.NumberFormat(defaultLocale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(defaultLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${formatNumber(value)}%`;
}
