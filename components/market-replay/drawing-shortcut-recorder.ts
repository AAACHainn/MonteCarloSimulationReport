let active: (() => void) | null = null;
export const isDrawingShortcutRecording = () => active !== null;

/** Window capture precedes all document/React menu handlers. */
export function recordDrawingShortcut(onKey: (event: KeyboardEvent) => void, onCancel: () => void) {
  active?.();
  const cancel = () => { stop(); onCancel(); };
  const key = (event: KeyboardEvent) => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (event.key === "Escape" || event.key === "Tab") { cancel(); return; }
    onKey(event);
  };
  const up = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const visibility = () => { if (document.visibilityState === "hidden") cancel(); };
  function stop() {
    window.removeEventListener("keydown", key, true); window.removeEventListener("keyup", up, true);
    window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", visibility);
    if (active === cancel) active = null;
  }
  active = cancel;
  window.addEventListener("keydown", key, true); window.addEventListener("keyup", up, true);
  window.addEventListener("blur", cancel); document.addEventListener("visibilitychange", visibility);
  return stop;
}
