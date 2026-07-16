import { copy } from "@/lib/i18n";

export const STRATEGY_CODE_PATTERN = /^[A-Z]+:[SABC](?: [A-Z]+:[SABC])*$/;

export type StrategyCodeGrade = "S" | "A" | "B" | "C";

export type StrategyCodeItem = {
  key: string;
  grade: StrategyCodeGrade;
};

export type StrategyCodeStatus = "PASS" | "FAIL" | "UNRATED";

export type StrategyCodeValidationResult =
  | {
      valid: true;
      normalized: string;
      items: StrategyCodeItem[];
      error: null;
    }
  | {
      valid: false;
      normalized: string;
      items: [];
      error: string;
    };

export type StrategyCodeEvaluation = {
  status: StrategyCodeStatus;
  bCount: number;
  cCount: number;
  cKeys: string[];
  reason: string;
};

export class StrategyCodeValidationError extends Error {}

export function normalizeStrategyCode(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function validateStrategyCode(value: unknown): StrategyCodeValidationResult {
  const normalized = normalizeStrategyCode(value);
  if (normalized === "") {
    return { valid: true, normalized, items: [], error: null };
  }

  if (/[,，;；]/.test(normalized)) {
    return {
      valid: false,
      normalized,
      items: [],
      error: copy.tradeJournals.strategyCodeErrors.separator,
    };
  }

  const items: StrategyCodeItem[] = [];
  const seenKeys = new Set<string>();

  for (const token of normalized.split(" ")) {
    const separatorIndex = token.indexOf(":");
    if (separatorIndex < 0 || separatorIndex !== token.lastIndexOf(":")) {
      return {
        valid: false,
        normalized,
        items: [],
        error: copy.tradeJournals.strategyCodeErrors.itemFormat,
      };
    }

    const key = token.slice(0, separatorIndex);
    const grade = token.slice(separatorIndex + 1);

    if (!/^[A-Z]+$/.test(key)) {
      return {
        valid: false,
        normalized,
        items: [],
        error: copy.tradeJournals.strategyCodeErrors.key,
      };
    }

    if (!/^[SABC]$/.test(grade)) {
      return {
        valid: false,
        normalized,
        items: [],
        error: copy.tradeJournals.strategyCodeErrors.grade,
      };
    }

    if (seenKeys.has(key)) {
      return {
        valid: false,
        normalized,
        items: [],
        error: copy.tradeJournals.strategyCodeErrors.duplicate.replace("{key}", key),
      };
    }

    seenKeys.add(key);
    items.push({ key, grade: grade as StrategyCodeGrade });
  }

  if (!STRATEGY_CODE_PATTERN.test(normalized)) {
    return {
      valid: false,
      normalized,
      items: [],
      error: copy.tradeJournals.strategyCodeErrors.itemFormat,
    };
  }

  return { valid: true, normalized, items, error: null };
}

export function parseStrategyCode(value: unknown) {
  const validation = validateStrategyCode(value);
  if (!validation.valid) {
    throw new StrategyCodeValidationError(validation.error);
  }
  return validation.items;
}

export function evaluateStrategyCode(value: unknown): StrategyCodeEvaluation {
  const items = parseStrategyCode(value);
  if (items.length === 0) {
    return {
      status: "UNRATED",
      bCount: 0,
      cCount: 0,
      cKeys: [],
      reason: copy.tradeJournals.strategyCodeEvaluation.unrated,
    };
  }

  const bCount = items.filter((item) => item.grade === "B").length;
  const cKeys = items.filter((item) => item.grade === "C").map((item) => item.key);
  const cCount = cKeys.length;

  if (cCount > 0) {
    return {
      status: "FAIL",
      bCount,
      cCount,
      cKeys,
      reason: copy.tradeJournals.strategyCodeEvaluation.hasC.replace("{keys}", cKeys.join("、")),
    };
  }

  if (bCount >= 2) {
    return {
      status: "FAIL",
      bCount,
      cCount,
      cKeys,
      reason: copy.tradeJournals.strategyCodeEvaluation.tooManyB.replace("{count}", String(bCount)),
    };
  }

  return {
    status: "PASS",
    bCount,
    cCount,
    cKeys,
    reason: bCount === 0
      ? copy.tradeJournals.strategyCodeEvaluation.noBOrC
      : copy.tradeJournals.strategyCodeEvaluation.oneBNoC,
  };
}

