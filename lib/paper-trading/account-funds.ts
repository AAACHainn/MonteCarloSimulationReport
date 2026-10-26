type Capital = { initialCapital: number; cashAdjustment?: number; realizedPnl: number; totalFees: number };
/** External cash flows affect spendable balance, never trading profit or drawdown. */
export function tradingBalance(account: Capital) { return account.initialCapital + account.realizedPnl - account.totalFees; }
export function accountBalance(account: Capital) { return tradingBalance(account) + (account.cashAdjustment ?? 0); }
