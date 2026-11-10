const MAX_PRICE_DECIMALS = 12;

function decimalPlaces(value: number) {
  const [coefficient, exponentText] = value.toString().split("e");
  const coefficientDecimals = coefficient.includes(".") ? coefficient.length - coefficient.indexOf(".") - 1 : 0;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Math.max(0, coefficientDecimals - exponent);
}

export function priceDecimalsForTick(tickSize: number) {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  return Math.min(MAX_PRICE_DECIMALS, decimalPlaces(tickSize));
}

export function offsetPriceByTicks(price: number, tickSize: number, ticks: number) {
  const sum = price + ticks * tickSize;
  // Geometry can use finer prices than the chart labels display. Very small
  // numbers can also exceed the 100 fractional digits supported by toFixed.
  const decimals = Math.max(decimalPlaces(price), decimalPlaces(tickSize));
  return decimals <= 100 ? Number(sum.toFixed(decimals)) : sum;
}

export function snapPriceToTick(price: number, tickSize: number) {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return price;
  const decimals = priceDecimalsForTick(tickSize);
  return Number((Math.round(price / tickSize) * tickSize).toFixed(decimals));
}

export function isPriceOnTick(price: number, tickSize: number) {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return false;
  const tolerance = Math.max(1e-12, Math.abs(price) * 1e-12);
  return Math.abs(price - snapPriceToTick(price, tickSize)) <= tolerance;
}

export function formatPriceForTick(price: number, tickSize: number) {
  if (!Number.isFinite(price)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: priceDecimalsForTick(tickSize),
    maximumFractionDigits: priceDecimalsForTick(tickSize),
  }).format(price);
}
