import systemPrompts from "./prompt/system.json";

export const ROUTING_PROMPT = systemPrompts.routing.join("\n");
export const EVIDENCE_RULES = systemPrompts.evidence.join("\n");
export const TOOL_RULES = systemPrompts.tools.join("\n");
