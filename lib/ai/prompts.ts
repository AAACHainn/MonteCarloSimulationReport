import type { AiSettings, SkillKey } from "./schema";
import { copy } from "@/lib/i18n";
import defaultPrompts from "./prompt/default-skills.json";

export const DEFAULT_PROMPTS: Record<SkillKey, string> = defaultPrompts;

export function defaultSettings(): AiSettings {
  return { schemaVersion: 1, activeEndpointId: "", endpoints: [], personalization: { name: copy.ai.title }, skills: {
    globalAssistant: { enabled: true, prompt: DEFAULT_PROMPTS.globalAssistant },
    chartReading: { enabled: true, prompt: DEFAULT_PROMPTS.chartReading },
    reviewDraft: { enabled: true, prompt: DEFAULT_PROMPTS.reviewDraft },
    sessionReview: { enabled: true, prompt: DEFAULT_PROMPTS.sessionReview },
  } };
}
