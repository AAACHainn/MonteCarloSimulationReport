import { createUuid } from "@/lib/uuid";

export const AI_SETTINGS_CHANGED_EVENT = "ai-settings-changed-v1";

export function notifyAiSettingsChanged() {
  window.dispatchEvent(new Event(AI_SETTINGS_CHANGED_EVENT));
  try { window.localStorage.setItem(AI_SETTINGS_CHANGED_EVENT, createUuid()); }
  catch { /* Returning focus to the chat also refreshes settings when storage is unavailable. */ }
}
