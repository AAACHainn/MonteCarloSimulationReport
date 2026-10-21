import { DEFAULT_TEXT_STYLE, normalizeDrawingText, textGeometrySchema, textDrawingStyleSchema, type TextDrawing, type TextGeometry, type TextDrawingStyle } from "./chart-drawings";

export type TextDraft = { geometry: TextGeometry; style: TextDrawingStyle };
export type TextSaveState = { id: string | null; dirty: boolean; saving: boolean; error: boolean; valid: boolean };
export type TextPersist = (id: string | null, draft: TextDraft, clientId: string) => Promise<TextDrawing>;
const snapshot = (draft: TextDraft): TextDraft => ({ geometry: { anchor: { ...draft.geometry.anchor }, text: normalizeDrawingText(draft.geometry.text) }, style: { ...draft.style } });
const styleKeys = Object.keys(DEFAULT_TEXT_STYLE) as Array<keyof TextDrawingStyle>;
const key = (draft: TextDraft) => JSON.stringify([draft.geometry.anchor.timestamp, draft.geometry.anchor.sourceSequence,
  draft.geometry.anchor.price, draft.geometry.text, ...styleKeys.map(field => draft.style[field])]);

/** One editor, one in-flight write. Acknowledgements never replace the editable draft. */
export class TextAutosave {
  private draft: TextDraft;
  private saved: TextDraft | null;
  private id: string | null;
  private creation: TextDraft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<boolean> | null = null;
  private stopped = false;
  private failed = false;
  private holds = new Set<string>();
  constructor(initial: TextDraft, id: string | null, private readonly clientId: string, private readonly persist: TextPersist,
    private readonly changed: (state: TextSaveState) => void, private readonly adopted: (drawing: TextDrawing) => void,
    private readonly delay = 700) {
    this.draft = snapshot(initial); this.saved = id ? snapshot(initial) : null; this.id = id;
  }
  get current() { return snapshot(this.draft); }
  get baseline() { return this.saved ? snapshot(this.saved) : null; }
  get state(): TextSaveState {
    const valid = textGeometrySchema.safeParse(this.draft.geometry).success && textDrawingStyleSchema.safeParse(this.draft.style).success;
    const dirty = this.saved ? key(this.saved) !== key(this.draft) : this.creation !== null || Boolean(this.draft.geometry.text.trim());
    return { id: this.id, dirty, valid, saving: Boolean(this.flight), error: this.failed };
  }
  private notify() { if (!this.stopped) this.changed(this.state); }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  update(draft: TextDraft) {
    const next = snapshot(draft);
    if (key(next) === key(this.draft)) return;
    this.draft = next; this.failed = false; this.notify(); this.schedule();
  }
  suspend(reason: string, suspended: boolean) {
    if (suspended) { this.holds.add(reason); this.clearTimer(); }
    else { this.holds.delete(reason); this.schedule(); }
  }
  private schedule() {
    this.clearTimer(); const state = this.state;
    if (this.stopped || this.failed || this.holds.size || !state.dirty || !state.valid) return;
    this.timer = setTimeout(() => { this.timer = null; void this.commit(); }, this.delay);
  }
  private commit(): Promise<boolean> {
    if (this.flight) return this.flight;
    const state = this.state;
    const recoveringCreation = !this.id && this.creation !== null;
    if (this.stopped || this.holds.size || !state.valid && !recoveringCreation) return Promise.resolve(false);
    if (!state.dirty) return Promise.resolve(true);
    this.clearTimer();
    const sent = snapshot(this.draft);
    if (!this.id) this.creation ??= sent;
    const task = Promise.resolve().then(async () => {
      try {
        if (this.stopped) return false;
        const drawing = await this.persist(this.id, this.id ? sent : this.creation!, this.clientId);
        this.id = drawing.id; this.saved = snapshot(drawing); this.failed = false;
        if (!this.stopped) this.adopted(drawing);
        return true;
      } catch { this.failed = true; return false; }
    });
    this.flight = task; this.notify();
    void task.then(() => { this.flight = null; this.notify(); if (!this.failed) this.schedule(); });
    return task;
  }
  async flush() {
    this.clearTimer();
    if (!this.id && !this.creation && !this.draft.geometry.text.trim() && !this.flight) return true;
    while (!this.stopped) {
      // A lost POST may already exist on the server. Resolve its frozen creation before allowing exit.
      const recoveringCreation = !this.id && this.creation !== null;
      if (this.holds.size || !this.state.valid && !recoveringCreation) return false;
      if (!this.state.dirty && !this.flight) return true;
      if (!await this.commit()) return false;
      this.clearTimer();
    }
    return false;
  }
  async discard() { this.stopped = true; this.clearTimer(); await this.flight; return this.id; }
  activate() { this.stopped = false; this.schedule(); }
  dispose() { this.stopped = true; this.clearTimer(); }
}
