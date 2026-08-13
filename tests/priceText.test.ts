import { describe, expect, it } from "vitest";
import { parsePriceText } from "../lib/priceText";

describe("parsePriceText", () => {
  it("reads anglophone prices (US, UK, CA)", () => {
    expect(parsePriceText("$12.50")).toBe(12.5);
    expect(parsePriceText("£12.50")).toBe(12.5);
    expect(parsePriceText("$1,234.56")).toBe(1234.56);
    expect(parsePriceText("12.50")).toBe(12.5);
  });

  // The regression: DE/FR/IT/ES write twelve-fifty as "12,50 €". scrape.ts
  // required a dot and found no price at all; serpApi.ts stripped the comma
  // as a thousands separator and read it as 1250.
  it("reads continental prices (DE, FR, IT, ES)", () => {
    expect(parsePriceText("12,50 €")).toBe(12.5);
    expect(parsePriceText("€12,50")).toBe(12.5);
    expect(parsePriceText("1.234,56 €")).toBe(1234.56);
    expect(parsePriceText("9,99")).toBe(9.99);
  });

  it("never reads a continental price as a hundred times itself", () => {
    expect(parsePriceText("12,50 €")).toBeLessThan(100);
    expect(parsePriceText("2,99 €")).toBe(2.99);
  });

  it("treats three trailing digits as a thousands group, not a fraction", () => {
    expect(parsePriceText("1,250")).toBe(1250);
    expect(parsePriceText("1.250")).toBe(1250);
  });

  it("handles whole numbers and no separator at all", () => {
    expect(parsePriceText("£12")).toBe(12);
    expect(parsePriceText("999")).toBe(999);
  });

  it("passes numbers through and rejects non-finite ones", () => {
    expect(parsePriceText(12.5)).toBe(12.5);
    expect(parsePriceText(NaN)).toBeUndefined();
    expect(parsePriceText(Infinity)).toBeUndefined();
  });

  it("returns undefined when there is no price, so 'missing' is not 'free'", () => {
    expect(parsePriceText("")).toBeUndefined();
    expect(parsePriceText("Currently unavailable")).toBeUndefined();
    expect(parsePriceText(null)).toBeUndefined();
    expect(parsePriceText(undefined)).toBeUndefined();
    expect(parsePriceText({})).toBeUndefined();
  });

  it("ignores trailing punctuation and surrounding words", () => {
    expect(parsePriceText("Price: £12.50 (paperback)")).toBe(12.5);
    expect(parsePriceText("£12.")).toBe(12);
  });

  // The price gate that actually depends on this: isRaceToBottom excludes
  // rivals under £2.99, and could never fire on a EUR marketplace before.
  it("puts a near-free continental price below the race-to-bottom floor", () => {
    expect(parsePriceText("0,99 €")).toBeLessThan(2.99);
  });
});
