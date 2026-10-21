type TextPointer = { clientX: number; clientY: number; timeStamp: number };
export const textPointerMoved = (start: TextPointer, next: TextPointer) => Math.hypot(next.clientX - start.clientX, next.clientY - start.clientY) >= 4;

/** Preserve double-clicks across the canvas → textarea handoff, without delaying focus. */
export function createTextClickBridge() {
  let previous: { id: string; pointer: TextPointer } | null = null;
  return {
    clear() { previous = null; },
    released(id: string, pointer: TextPointer) { previous = { id, pointer: { clientX: pointer.clientX, clientY: pointer.clientY, timeStamp: pointer.timeStamp } }; },
    consume(id: string | null, pointer: TextPointer) {
      const click = previous; previous = null;
      return Boolean(click && click.id === id && pointer.timeStamp >= click.pointer.timeStamp
        && pointer.timeStamp - click.pointer.timeStamp <= 500 && !textPointerMoved(click.pointer, pointer));
    },
  };
}

/** Placement opens on pointerdown, so its later click must not close the new editor. */
export function listenForTextEditorOutside(panel: HTMLElement, finish: () => void) {
  let outsideDown = false;
  const down = (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    outsideDown = !panel.contains(target) && !target.closest?.("[data-text-settings],[data-text-delete]");
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
