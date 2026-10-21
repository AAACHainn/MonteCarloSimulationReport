import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextAutosave, type TextDraft, type TextPersist } from "./text-autosave";
import { DEFAULT_TEXT_STYLE, type TextDrawing } from "./chart-drawings";
import { runDrawingWrite } from "./drawing-write-queue";

const anchor = { timestamp: "2026-10-01T00:00:00Z", sourceSequence: 0, price: 100 };
const draft = (text: string, width = 240): TextDraft => ({ geometry: { anchor, text }, style: { ...DEFAULT_TEXT_STYLE, wrapWidth: width } });
const saved = (value: TextDraft, id = "saved"): TextDrawing => ({ ...value, id, type: "TEXT", datasetId: "test", createdAt: "", updatedAt: "" });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup(text = "", id: string | null = null) {
  const persist = vi.fn<TextPersist>(async (_id, value) => saved(value));
  const changed = vi.fn(), adopted = vi.fn();
  const controller = new TextAutosave(draft(text), id, "fixed-creation-id", persist, changed, adopted);
  return { controller, persist, changed, adopted };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("text autosave", () => {
  it("deduplicates equivalent payloads regardless of server property insertion order", async () => {
    const { controller, persist } = setup("saved", "id");
    controller.update({ geometry: draft("saved").geometry, style: Object.fromEntries(Object.entries(DEFAULT_TEXT_STYLE).reverse()) as TextDraft["style"] });
    expect(await controller.flush()).toBe(true); expect(persist).not.toHaveBeenCalled();
  });
  it("debounces normalized input, skips empty new objects and unchanged content", async () => {
    const { controller, persist } = setup();
    await vi.advanceTimersByTimeAsync(1000); expect(persist).not.toHaveBeenCalled();
    controller.update(draft("one")); await vi.advanceTimersByTimeAsync(400);
    controller.update(draft("two\r\n三")); await vi.advanceTimersByTimeAsync(699); expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][1].geometry.text).toBe("two\n三");
    controller.update(draft("two\n三")); await vi.advanceTimersByTimeAsync(1000); expect(persist).toHaveBeenCalledOnce();
  });
  it("keeps typing during slow creation and uses the acknowledged ID for only the latest follow-up PATCH", async () => {
    const { controller, persist } = setup(); const first = deferred<TextDrawing>();
    persist.mockImplementationOnce(() => first.promise);
    controller.update(draft("first")); await vi.advanceTimersByTimeAsync(700);
    controller.update(draft("second")); controller.update(draft("latest"));
    await vi.advanceTimersByTimeAsync(1500); expect(persist).toHaveBeenCalledOnce();
    expect(controller.current.geometry.text).toBe("latest");
    first.resolve(saved(draft("first"), "real-id")); await vi.advanceTimersByTimeAsync(700);
    expect(persist).toHaveBeenCalledTimes(2); expect(persist.mock.calls[1][0]).toBe("real-id");
    expect(persist.mock.calls[1][1].geometry.text).toBe("latest"); expect(controller.state.dirty).toBe(false);
  });
  it("flush waits for every version edited while saving instead of exiting after the first acknowledgement", async () => {
    const { controller, persist } = setup("old", "existing"); const pending = deferred<TextDrawing>();
    persist.mockImplementationOnce(() => pending.promise);
    controller.update(draft("one")); const finishing = controller.flush(); await Promise.resolve();
    controller.update(draft("two")); pending.resolve(saved(draft("one"), "existing"));
    expect(await finishing).toBe(true); expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][1].geometry.text).toBe("two");
  });
  it("retries an unknown POST with the same client identity and frozen snapshot, then patches the newest content", async () => {
    const { controller, persist } = setup(); persist.mockRejectedValueOnce(new Error("response lost"));
    controller.update(draft("original POST")); await vi.advanceTimersByTimeAsync(700);
    expect(controller.state.error).toBe(true); await vi.advanceTimersByTimeAsync(5000); expect(persist).toHaveBeenCalledOnce();
    controller.update(draft("latest input"));
    expect(await controller.flush()).toBe(true);
    expect(persist.mock.calls[1]).toEqual([null, draft("original POST"), "fixed-creation-id"]);
    expect(persist.mock.calls[2][0]).toBe("saved"); expect(persist.mock.calls[2][1].geometry.text).toBe("latest input");
  });
  it("uses the actual idempotent response as baseline without overwriting later server changes with the initial POST", async () => {
    const { controller, persist } = setup();
    persist.mockResolvedValueOnce(saved(draft("server actual"), "existing-client-id"));
    controller.update(draft("local latest")); expect(await controller.flush()).toBe(true);
    expect(persist.mock.calls[1][0]).toBe("existing-client-id"); expect(persist.mock.calls[1][1]).toEqual(draft("local latest"));
  });
  it("suspends IME and width gestures; cancellation restores width without losing previously typed content", async () => {
    const { controller, persist } = setup("old", "existing");
    controller.suspend("composition", true); controller.update(draft("中文输入中"));
    await vi.advanceTimersByTimeAsync(1000); expect(persist).not.toHaveBeenCalled();
    expect(await controller.flush()).toBe(false);
    controller.suspend("composition", false); controller.suspend("resize", true);
    controller.update(draft("中文输入中", 400)); await vi.advanceTimersByTimeAsync(1000); expect(persist).not.toHaveBeenCalled();
    controller.update(draft("中文输入中", 240)); controller.suspend("resize", false);
    await vi.advanceTimersByTimeAsync(700); expect(persist).toHaveBeenCalledOnce(); expect(persist.mock.calls[0][1]).toEqual(draft("中文输入中"));
  });
  it("keeps modal style changes transactional, restoring checkpoint on cancel", async () => {
    const { controller, persist } = setup("text", "existing");
    controller.update(draft("saved text")); expect(await controller.flush()).toBe(true);
    const checkpoint = controller.current; controller.suspend("settings", true);
    controller.update(draft("unsaved modal text", 400)); await vi.advanceTimersByTimeAsync(1000); expect(persist).toHaveBeenCalledOnce();
    controller.update(checkpoint); controller.suspend("settings", false); await vi.advanceTimersByTimeAsync(1000);
    expect(persist).toHaveBeenCalledOnce(); expect(controller.state.dirty).toBe(false);
    controller.suspend("settings", true); controller.update(draft("confirmed modal text", 320)); controller.suspend("settings", false);
    expect(await controller.flush()).toBe(true); expect(persist).toHaveBeenCalledTimes(2);
  });
  it("keeps an invalid or cleared existing object dirty without deleting or silently saving it", async () => {
    const { controller, persist } = setup("old", "existing"); controller.update(draft(" "));
    await vi.advanceTimersByTimeAsync(1000); expect(await controller.flush()).toBe(false); expect(persist).not.toHaveBeenCalled();
    controller.update(draft("x".repeat(2001))); expect(await controller.flush()).toBe(false);
    const empty = setup(); expect(await empty.controller.flush()).toBe(true); expect(empty.persist).not.toHaveBeenCalled();
  });
  it("discards pending versions, waits for the in-flight write and never emits late adoption after deletion", async () => {
    const { controller, persist, adopted } = setup(); const pending = deferred<TextDrawing>();
    persist.mockImplementationOnce(() => pending.promise);
    controller.update(draft("one")); await vi.advanceTimersByTimeAsync(700); controller.update(draft("never write"));
    const exiting = controller.discard(); pending.resolve(saved(draft("one"), "created-id"));
    expect(await exiting).toBe("created-id"); await vi.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledOnce(); expect(adopted).not.toHaveBeenCalled();
  });
  it("does not start a delayed request after the editor is disposed", async () => {
    const { controller, persist } = setup(); controller.update(draft("unsaved")); controller.dispose();
    await vi.advanceTimersByTimeAsync(1000); expect(persist).not.toHaveBeenCalled();
  });
});

it("serializes complete drawing writes across owners while isolating scopes and recovering from failure", async () => {
  const first = deferred<void>(), order: string[] = [];
  const a = runDrawingWrite("scope-a", async () => { order.push("a-start"); await first.promise; order.push("a-end"); throw new Error("failed"); });
  const handled = a.catch(() => undefined);
  const b = runDrawingWrite("scope-a", async () => { order.push("b"); });
  await runDrawingWrite("scope-b", async () => { order.push("independent"); }); expect(order).toEqual(["a-start", "independent"]);
  first.resolve(); await handled; await b; expect(order).toEqual(["a-start", "independent", "a-end", "b"]);
});
