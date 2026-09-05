const MAX_PRICE_DECIMALS = 12;

export function priceDecimalsForTick(tickSize: number) {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toString().toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const coefficientDecimals = coefficient.includes(".") ? coefficient.length - coefficient.indexOf(".") - 1 : 0;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Math.min(MAX_PRICE_DECIMALS, Math.max(0, coefficientDecimals - exponent));
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
