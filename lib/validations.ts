import { z } from "zod";
import { copy } from "./i18n";
import {
  deduplicateTagNames,
  MAX_TAG_NAME_LENGTH,
  MAX_TAGS_PER_TRADE,
  normalizeTagName,
} from "./trade-journal/tags";
import { isReplayInterval } from "./market-replay/types";

export const SIMULATION_WORK_LIMIT = 50_000_000;

export const datasetSchema = z.object({
  name: z.string().trim().min(1, copy.api.datasetNameRequired).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export const tradeJournalSchema = z.object({
  name: z.string().trim().min(1, copy.api.journalNameRequired).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export const marketDatasetSchema = z.object({
  name: z.string().trim().min(1, copy.marketReplay.validation.datasetNameRequired).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  symbol: z.string().trim().min(1, copy.marketReplay.validation.symbolRequired).max(80),
  timeframe: z.string().trim().min(1, copy.marketReplay.validation.timeframeRequired).max(30),
  timezone: z.string().trim().min(1, copy.marketReplay.validation.timezoneRequired).max(100),
});

export const replayProgressSchema = z.object({
  startSequence: z.coerce.number().int().min(0),
  currentSequence: z.coerce.number().int().min(-1),
  intervalMs: z.coerce.number().int().refine(isReplayInterval, copy.marketReplay.validation.unsupportedSpeed),
});

export const paperSessionSchema = z.object({
  initialCapital: z.coerce.number().finite().positive().max(1_000_000_000_000),
  currency: z.string().trim().min(1).max(12),
  commissionBps: z.coerce.number().finite().min(0).max(10_000),
  slippageBps: z.coerce.number().finite().min(0).max(10_000),
});

export const paperOrderSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT", "STOP"]),
  quantity: z.coerce.number().finite().positive().max(1_000_000_000_000),
  price: z.coerce.number().finite().optional().nullable(),
  stopLoss: z.coerce.number().finite().optional().nullable(),
  takeProfit: z.coerce.number().finite().optional().nullable(),
  reduceOnly: z.boolean().optional().default(false),
  expectedVersion: z.coerce.number().int().positive(),
}).superRefine((value, ctx) => {
  if (value.type !== "MARKET" && value.price == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["price"], message: copy.paperTrading.priceRequired });
  }
});

export const paperOrderUpdateSchema = z.object({
  quantity: z.coerce.number().finite().positive().max(1_000_000_000_000).optional(),
  price: z.coerce.number().finite().optional(),
  expectedVersion: z.coerce.number().int().positive(),
}).refine((value) => value.quantity !== undefined || value.price !== undefined, copy.paperTrading.orderUpdateRequired);

export const paperAdvanceSchema = z.object({
  expectedCurrentSequence: z.coerce.number().int().min(-1),
  expectedVersion: z.coerce.number().int().positive().optional().nullable(),
});

export const paperResetSchema = z.object({ action: z.enum(["RESET", "CHANGE_START"]) });

export const tradeOptionSchema = z.object({
  type: z.enum(["INSTRUMENT", "STRATEGY"]),
  name: z.string().trim().min(1, copy.api.optionNameRequired).max(80),
});

export const tradeOptionUpdateSchema = z
  .object({
    name: z.string().trim().min(1, copy.api.optionNameRequired).max(80).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.active !== undefined, {
    message: copy.api.optionNameRequired,
  });

export const tradeTagNameSchema = z
  .string()
  .transform(normalizeTagName)
  .pipe(
    z
      .string()
      .min(1, copy.api.tagNameRequired)
      .max(MAX_TAG_NAME_LENGTH, copy.api.tagNameTooLong),
  );

export const tradeTagSchema = z.object({
  name: tradeTagNameSchema,
});

export const tradeTagUpdateSchema = tradeTagSchema;

export const tradeTagsReplaceSchema = z.object({
  tags: z
    .array(tradeTagNameSchema)
    .max(MAX_TAGS_PER_TRADE, copy.api.tooManyTradeTags)
    .transform(deduplicateTagNames),
});

export const simulationConfigSchema = z
  .object({
    datasetId: z.string().min(1),
    initialCapital: z.coerce.number().positive().max(1_000_000_000),
    riskPercent: z.coerce.number().positive().max(100),
    simulationCount: z.coerce.number().int().min(1).max(50_000),
    tradesPerSimulation: z.coerce.number().int().min(1).max(5_000),
    compoundingMode: z.enum(["SIMPLE_FIXED_RISK", "COMPOUND", "STEP_COMPOUND"]),
    stepSize: z.coerce.number().positive().optional().nullable(),
    ruinThreshold: z.coerce.number().min(0),
    samplingMethod: z.literal("BOOTSTRAP_WITH_REPLACEMENT"),
  })
  .superRefine((value, ctx) => {
    if (value.compoundingMode === "STEP_COMPOUND" && !value.stepSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stepSize"],
        message: copy.api.stepSizeRequired,
      });
    }

    if (value.simulationCount * value.tradesPerSimulation > SIMULATION_WORK_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulationCount"],
        message: copy.api.simulationLimit,
      });
    }
  });
