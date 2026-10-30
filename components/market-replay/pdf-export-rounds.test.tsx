import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyReplayJournalFilters } from "@/lib/paper-trading/journal-filters";
import { pdfPreferences, pdfSnapshot } from "@/lib/paper-trading/pdf-test-fixtures";
import { copy } from "@/lib/i18n";

const rt = vi.hoisted(() => ({
  index: 0, slots: [] as unknown[],
  session: { id: "replay-qa", mode: "TRAINING", propRoundNumber: undefined as number | undefined },
  task: { active: false, start: vi.fn() },
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = rt.index++, slots = rt.slots;
    if (!(slot in slots)) slots[slot] = initial;
    return [slots[slot], (value: unknown) => { slots[slot] = value; }];
  },
  useRef: (current: unknown) => {
    const slot = rt.index++;
    if (!(slot in rt.slots)) rt.slots[slot] = { current };
    return rt.slots[slot];
  },
  useEffect: () => {},
  useContext: () => rt.task,
}));
vi.mock("./replay-session-context", async importOriginal => ({
  ...await importOriginal<typeof import("./replay-session-context")>(),
  useReplaySession: () => rt.session,
}));
vi.mock("./use-replay-preferences", () => ({ capturePdfChartPreferences: () => pdfPreferences }));
import { PdfExportButton } from "./pdf-export-button";
import { PdfExportProvider } from "./pdf-export-provider";

type Element = { props: { children?: unknown; onClick?: () => void | Promise<void> } };
function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as Element;
  return element.props ? [element, ...elements(element.props.children)] : [];
}
function action(tree: unknown, label: string) {
  return elements(tree).find(element => element.props.onClick &&
    (element.props.children === label || Array.isArray(element.props.children) && element.props.children.includes(label)))!.props.onClick!;
}
function render<T>(work: () => T, slots: unknown[]) {
  rt.index = 0; rt.slots = slots;
  return work();
}
beforeEach(() => {
  rt.task.start.mockReset(); rt.task.active = false;
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe("PDF export follows the journal table round", () => {
  it.each([0, 1, 2, undefined])("keeps round %s through preview, generation and retry", async propRoundNumber => {
    rt.session = { ...rt.session, propRoundNumber };
    const preview = pdfSnapshot();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json({ error: "retry" }, { status: 503 }))
      // Stop before chart rendering; this test exercises the snapshot request chain.
      .mockResolvedValueOnce(Response.json(pdfSnapshot([])));
    vi.stubGlobal("fetch", fetchMock);
    const filters = createEmptyReplayJournalFilters(); filters.results = ["W"];
    const buttonSlots: unknown[] = [], providerSlots: unknown[] = [];
    const button = () => render(() => PdfExportButton({ datasetId: "dataset-qa", sessionId: "session-qa", filters, loading: false, count: 1 }), buttonSlots);
    const provider = () => render(() => PdfExportProvider({ children: null }), providerSlots);
    const task = provider().props.value;
    rt.task.start.mockImplementation(task.start);

    action(button(), copy.paperTrading.pdf.export)();
    await vi.waitFor(() => expect(buttonSlots[3]).toBe(false));
    action(button(), copy.paperTrading.pdf.start)();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(rt.task.start).toHaveBeenCalledWith(expect.objectContaining({ propRoundNumber, filters }));
    // Later page/filter changes must not alter the running task's saved scope.
    rt.session.propRoundNumber = 99; filters.results = ["L"];
    await vi.waitFor(() => expect(providerSlots[0]).toMatchObject({ phase: "error", message: "retry", fatal: false }));
    action(provider(), copy.paperTrading.pdf.retry)();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(input as string, "http://fixture");
      expect(url.searchParams.get("replaySessionId")).toBe("replay-qa");
      expect(url.searchParams.get("propRound")).toBe(propRoundNumber === undefined ? null : String(propRoundNumber));
      expect(url.searchParams.getAll("results")).toEqual(["W"]);
    }
  });
});
