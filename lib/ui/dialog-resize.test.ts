import { describe, expect, it } from "vitest";
import { fitDialogBounds, moveDialogBounds } from "./dialog-resize";

describe("floating dialog movement", () => {
  it("moves the window without changing its size", () => {
    expect(moveDialogBounds({ left: 384, top: 150, width: 672, height: 600 }, 200, -40, { width: 1440, height: 900 }))
      .toEqual({ left: 584, top: 110, width: 672, height: 600 });
  });

  it.each([375, 1280, 1440, 1920])("keeps the title and content in the %ipx viewport", (width) => {
    const viewport = { width, height: 812 };
    const start = fitDialogBounds({ left: 400, top: 120, width: 672, height: 600 }, viewport);
    const topLeft = moveDialogBounds(start, -5000, -5000, viewport);
    expect(topLeft.left).toBe(16);
    expect(topLeft.top).toBe(16);
    const bottomRight = moveDialogBounds(start, 5000, 5000, viewport);
    expect(bottomRight.left + bottomRight.width).toBe(width - 16);
    expect(bottomRight.top + bottomRight.height).toBe(viewport.height - 16);
  });

  it("fits a previously moved desktop window into a narrow, short screen", () => {
    const bounds = fitDialogBounds({ left: 1100, top: 400, width: 672, height: 600 }, { width: 375, height: 400 });
    expect(bounds).toEqual({ left: 16, top: 16, width: 343, height: 368 });
  });
});
