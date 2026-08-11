import { describe, expect, it } from "vitest";
import { findAllowlistOverrides } from "../lib/filterAllowlist";

describe("findAllowlistOverrides", () => {
  it("promotes rejected/paused rows whose text is on the allowlist, case-insensitively", () => {
    const rows = [
      { text: "Cozy Kindle Store", status: "rejected" },
      { text: "barclaycard", status: "rejected" },
      { text: "already active term", status: "active" },
    ];
    const overrides = findAllowlistOverrides(rows, ["cozy kindle store"]);
    expect(overrides).toEqual([{ text: "Cozy Kindle Store", status: "rejected" }]);
  });

  it("returns nothing when the allowlist is empty", () => {
    const rows = [{ text: "term", status: "rejected" }];
    expect(findAllowlistOverrides(rows, [])).toEqual([]);
  });

  it("never touches an already-active row", () => {
    const rows = [{ text: "term", status: "active" }];
    expect(findAllowlistOverrides(rows, ["term"])).toEqual([]);
  });
});
