import { z } from "zod";

export const datasetSchema = z.object({
  name: z.string().trim().min(1, "Dataset name is required").max(120),
  description: z.string().trim().max(500).optional().nullable(),
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
        message: "Step size is required for step compounding.",
      });
    }

    if (value.simulationCount * value.tradesPerSimulation > 5_000_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["simulationCount"],
        message: "simulationCount × tradesPerSimulation must be 5,000,000 or less for the MVP.",
      });
    }
  });
