export type AppearanceMode = "light" | "dark";
export const APPEARANCE_STORAGE_KEY = "trading-workbench-appearance-v1";
export const DEFAULT_APPEARANCE: AppearanceMode = "light";

export function isAppearance(value: unknown): value is AppearanceMode {
  return value === "light" || value === "dark";
}

export function parseAppearance(value: unknown): AppearanceMode {
  return value === "dark" ? "dark" : "light";
}

export function readAppearance(storage: Pick<Storage, "getItem">): AppearanceMode {
  try {
    return parseAppearance(storage.getItem(APPEARANCE_STORAGE_KEY));
  } catch { return DEFAULT_APPEARANCE; }
}

export function saveAppearance(storage: Pick<Storage, "setItem">, mode: AppearanceMode) {
  try { storage.setItem(APPEARANCE_STORAGE_KEY, mode); } catch { /* The in-memory choice remains usable. */ }
}

// The bootstrap shares exactly the same parser and fallback as the provider.
export const APPEARANCE_BOOTSTRAP = `(()=>{let mode="light";try{mode=(${parseAppearance.toString()})(window.localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)}))}catch{}document.documentElement.classList.toggle("dark",mode==="dark");document.documentElement.style.colorScheme=mode})()`;
