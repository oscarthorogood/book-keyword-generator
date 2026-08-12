import { describe, expect, it } from "vitest";
import { marketplaceCurrency } from "../lib/marketplaceCurrency";

// Decision 3 (docs/CAMPAIGNS-PROGRESS.md): currency is derived per-book from
// books.marketplace at write time — campaigns.currency and
// campaign_results.currency have no schema default (sql/21, sql/23).

describe("marketplaceCurrency", () => {
  it("maps each supported marketplace to its currency", () => {
    expect(marketplaceCurrency("US")).toBe("USD");
    expect(marketplaceCurrency("UK")).toBe("GBP");
    expect(marketplaceCurrency("CA")).toBe("CAD");
    expect(marketplaceCurrency("DE")).toBe("EUR");
    expect(marketplaceCurrency("FR")).toBe("EUR");
    expect(marketplaceCurrency("IT")).toBe("EUR");
    expect(marketplaceCurrency("ES")).toBe("EUR");
  });
});
