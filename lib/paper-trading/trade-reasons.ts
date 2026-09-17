export const MAX_TRADE_REASON_NAME_LENGTH = 50;
export const MAX_TRADE_REASONS_PER_ENTRY = 20;

export type TradeReasonValue = {
  id: string;
  name: string;
};

export function normalizeTradeReasonName(value: string) {
  return value.normalize("NFKC").trim();
}

export function normalizeTradeReasonKey(value: string) {
  return normalizeTradeReasonName(value).toLocaleLowerCase("zh-CN");
}
