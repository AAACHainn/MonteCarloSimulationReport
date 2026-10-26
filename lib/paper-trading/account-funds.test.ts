import { describe, expect, it } from "vitest";
import { accountBalance, tradingBalance } from "@/lib/paper-trading/account-funds";

describe("separating trading results from external account cash flows", () => {
  it("adds deposits and withdrawals to spendable balance without changing net trading profit", () => {
    const before = { initialCapital: 1000, realizedPnl: 125, totalFees: 5, cashAdjustment: 0 };
    const afterDeposit = { ...before, cashAdjustment: 500 };
    const afterWithdrawal = { ...before, cashAdjustment: -300 };

    expect(accountBalance(before)).toBe(1120);
    expect(accountBalance(afterDeposit)).toBe(1620);
    expect(accountBalance(afterWithdrawal)).toBe(820);
    expect(tradingBalance(afterDeposit)).toBe(1120);
    expect(tradingBalance(afterWithdrawal)).toBe(1120);
  });

  it("keeps existing account records without cashAdjustment compatible", () => {
    const legacyAccount = { initialCapital: 10_000, realizedPnl: -10_050, totalFees: 50 };
    expect(accountBalance(legacyAccount)).toBe(-100);
    expect(tradingBalance(legacyAccount)).toBe(-100);
  });
});
