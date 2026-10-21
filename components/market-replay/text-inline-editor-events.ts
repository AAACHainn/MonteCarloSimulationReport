/** Placement opens on pointerdown, so its later click must not close the new editor. */
export function listenForTextEditorOutside(panel: HTMLElement, finish: () => void) {
  let outsideDown = false;
  const down = (event: PointerEvent) => {
    outsideDown = !panel.contains(event.target as Node);
    if (!outsideDown) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const click = (event: MouseEvent) => {
    if (!outsideDown || panel.contains(event.target as Node)) return;
    outsideDown = false;
    event.preventDefault(); event.stopImmediatePropagation(); finish();
  };
  const cancel = () => { outsideDown = false; };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("click", click, true);
  document.addEventListener("pointercancel", cancel, true);
  return () => {
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("pointercancel", cancel, true);
  };
}
