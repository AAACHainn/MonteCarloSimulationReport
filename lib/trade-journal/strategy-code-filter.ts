export const MAX_STRATEGY_CODE_REGEX_LENGTH = 500;
export const STRATEGY_CODE_FAIL_REGEX =
  "^(?:(?=.*\\b[A-Z]+:C\\b)|(?=(?:.*\\b[A-Z]+:B\\b){2})|(?=.*\\b[A-Z]+:B\\b)(?!.*\\b[A-Z]+:S\\b)).+$";
export const STRATEGY_CODE_PASS_REGEX =
  "^(?!$)(?!.*\\b[A-Z]+:C\\b)(?!(?:.*\\b[A-Z]+:B\\b){2})(?:(?!.*\\b[A-Z]+:B\\b)|(?=.*\\b[A-Z]+:S\\b)).+$";

export type StrategyCodeRegexFilter = {
  error: "INVALID_REGEX" | "TOO_LONG" | null;
  test: (strategyCode: string | null | undefined) => boolean;
};

export function compileStrategyCodeRegex(expression: string): StrategyCodeRegexFilter {
  const source = expression.trim();
  if (source === "") {
    return { error: null, test: () => true };
  }

  if (source.length > MAX_STRATEGY_CODE_REGEX_LENGTH) {
    return { error: "TOO_LONG", test: () => true };
  }

  try {
    const regex = new RegExp(source, "i");
    return {
      error: null,
      test: (strategyCode) => regex.test(strategyCode ?? ""),
    };
  } catch {
    return { error: "INVALID_REGEX", test: () => true };
  }
}
