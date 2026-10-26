import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rt = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], effects: [] as Array<() => unknown>, readers: [] as Array<{ result: string | null; onload: (() => void) | null; onerror: (() => void) | null; readAsDataURL: (file: File) => void }>, images: [] as Array<{ naturalWidth: number; naturalHeight: number; onload: (() => void) | null; onerror: (() => void) | null; src: string }> }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useRef: (value: unknown) => { const i = rt.index++; if (!(i in rt.slots)) rt.slots[i] = { current: value }; return rt.slots[i]; },
    useState: (value: unknown) => { const i = rt.index++; if (!(i in rt.slots)) rt.slots[i] = value; return [rt.slots[i], (next: unknown) => { rt.slots[i] = typeof next === "function" ? (next as (previous: unknown) => unknown)(rt.slots[i]) : next; }]; },
    useEffect: (effect: () => unknown) => { rt.effects.push(effect); },
  };
});
vi.mock("lucide-react", () => ({ Check: "check", Loader2: "loader" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: "dialog" }));
vi.mock("@/components/ui/input", () => ({ Input: "input" }));
vi.mock("@/components/ui/label", () => ({ Label: "label" }));
vi.mock("./user-avatar", () => ({ UserAvatar: "avatar" }));
import { copy } from "@/lib/i18n";
import { ProfileDialog } from "./profile-dialog";

type E = { type: unknown; props: Record<string, unknown> };
function all(n: unknown): E[] { if (n == null || typeof n !== "object") return []; if (Array.isArray(n)) return n.flatMap(all); const e = n as E; return [e, ...all(e.props?.children)]; }
function render() { rt.index = 0; return ProfileDialog({ onClose: vi.fn(), onSave: save }); }
const save = vi.fn(async () => null);
class Reader {
  result: string | null = "data:image/png;base64,preview"; onload: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor() { rt.readers.push(this); }
  readAsDataURL() {}
}
class PreviewImage {
  naturalWidth = 100; naturalHeight = 100; onload: (() => void) | null = null; onerror: (() => void) | null = null; src = "";
  constructor() { rt.images.push(this); }
}
beforeEach(() => { rt.index = 0; rt.slots = []; rt.effects = []; rt.readers = []; rt.images = []; save.mockReset(); save.mockResolvedValue(null); vi.stubGlobal("React", React); vi.stubGlobal("FileReader", Reader); vi.stubGlobal("Image", PreviewImage); });
afterEach(() => vi.unstubAllGlobals());

describe("avatar file preview races", () => {
  it("does not let a late file read replace a newer preset selection", async () => {
    let tree = render(); const uploadTab = all(tree).find(e => e.type === "button" && e.props["aria-pressed"] === false && e.props.children === copy.userGrowth.upload)!; (uploadTab.props.onClick as () => void)(); tree = render(); const fileInput = all(tree).find(e => e.type === "input" && e.props.type === "file")!;
    const inputElement: { value: string; files: File[] } = { value: "avatar.png", files: [] };
    (fileInput.props.onClick as (event: { currentTarget: typeof inputElement }) => void)({ currentTarget: inputElement });
    expect(inputElement.value).toBe("");
    inputElement.files = [new File(["image"], "avatar.png", { type: "image/png" })];
    inputElement.value = "avatar.png";
    (fileInput.props.onChange as (event: { target: typeof inputElement }) => void)({ target: inputElement });
    expect(inputElement.value).toBe("avatar.png");
    const reader = rt.readers[0]; reader.onload?.(); const preview = rt.images[0]; expect(preview).toBeDefined();
    let previewTree = render(); const presetTab = all(previewTree).find(e => e.type === "button" && e.props.children === copy.userGrowth.presets)!; (presetTab.props.onClick as () => void)(); previewTree = render(); expect(all(previewTree).some(e => e.type === "div" && e.props.className === "grid grid-cols-4 gap-3")).toBe(true); const preset = all(previewTree).find(e => e.type === "button" && e.props["aria-label"] === copy.userGrowth.presetNames[3])!;
    (preset.props.onClick as () => void)(); preview.onload?.();
    const editTree = render(), nickname = all(editTree).find(e => e.type === "input" && e.props.id === "growth-nickname")!; (nickname.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Tester" } }); const finalTree = render(), form = all(finalTree).find(e => e.type === "form")!;
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });
    expect(save).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledWith("Tester", expect.objectContaining({ preset: 3, zoom: 1, x: 50, y: 50 }), undefined);
  });
});
