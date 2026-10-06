/**
 * D-030 item 2, D5-11: the coach's preselected stop option scrolls into view when the stop list opens.
 * On a phone (390 x 844) «pain» and the other reasons sit below the urgent group, under the inert STOP
 * of the walk; the list keeps the emergency options first (O43) and brings the preselected row to the
 * middle of the list's scroll area.
 */
import { describe, expect, it, vi } from "vitest";
import { scrollPreselected } from "../../src/features/focus/Screens";

describe("the preselected stop option", () => {
  it("is brought to the middle of the list", () => {
    const scrollIntoView = vi.fn();
    const selectors: string[] = [];
    const root = {
      querySelector: (sel: string) => {
        selectors.push(sel);
        return sel.includes('"pain"') ? { scrollIntoView } : null;
      },
    } as unknown as ParentNode;
    scrollPreselected(root, "pain");
    expect(selectors).toEqual(['.fx-stop-row[data-option="pain"]']);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("does nothing without the row or the list", () => {
    const root = { querySelector: () => null } as unknown as ParentNode;
    expect(() => scrollPreselected(root, "chest")).not.toThrow();
    expect(() => scrollPreselected(null, "chest")).not.toThrow();
  });
});
