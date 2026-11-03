import type { PaperOrderData, PaperOrderType } from "./types";

export type ProtectiveQuantityMode = "ALL" | "FIXED";
export type PartialExitInput = { sourceOrderId: string; price: number; quantity: number };

/** Generated brackets have an OCO group and cover the remaining net position.
 * Ungrouped protective orders are independent, fixed-quantity exits. This uses
 * the existing order contract; it does not attach an exit to a particular FIFO lot.
 */
export function protectiveQuantityMode(order: Pick<PaperOrderData, "ocoGroupId">): ProtectiveQuantityMode {
  return order.ocoGroupId === null ? "FIXED" : "ALL";
}

export function isValidProtectivePrice(netQuantity: number, type: PaperOrderType, price: number, currentPrice: number) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(currentPrice) || !Number.isFinite(netQuantity) || Math.abs(netQuantity) <= 1e-12) return false;
  if (type !== "LIMIT" && type !== "STOP") return false;
  return type === "STOP"
    ? netQuantity > 0 ? price < currentPrice : price > currentPrice
    : netQuantity > 0 ? price > currentPrice : price < currentPrice;
}

export function protectiveOrderLabel(order: Pick<PaperOrderData, "id" | "type">) {
  const prefix = order.type === "STOP" ? "SL" : "TP";
  const match = order.id.match(/(?:^|::)partial_(tp|sl)_(\d+)_/);
  return match ? prefix + match[2] : prefix;
}

export function nextPartialExitNumber(orders: Array<{ id: string }>) {
  return orders.reduce((max, order) => {
    const match = order.id.match(/(?:^|::)partial_(?:tp|sl)_(\d+)_/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
}

export function defaultPartialExitQuantity(netQuantity: number) {
  return Math.abs(netQuantity) / 2;
}
