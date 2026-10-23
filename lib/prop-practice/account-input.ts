import { z } from "zod";
import { paperSessionSchema } from "@/lib/validations";

/** Existing clients may omit the category when creating the default account. */
export const createPaperAccountSchema = z.union([
  paperSessionSchema.extend({ accountCategory: z.literal("STANDARD").optional() }),
  paperSessionSchema.omit({ initialCapital: true }).extend({
    accountCategory: z.literal("PROP_PRACTICE"),
    propTemplateVersionId: z.string().min(1),
  }),
]);
export type CreatePaperAccountInput = z.infer<typeof createPaperAccountSchema>;
