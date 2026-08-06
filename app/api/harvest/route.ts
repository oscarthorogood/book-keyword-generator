import { NextRequest, NextResponse } from "next/server";
import { computeMaxCpc } from "@/lib/bidding";
import { buildBulksheet, SpmAdGroup } from "@/lib/bulksheet";
import {
  buildHarvestOutputs,
  classifySearchTerms,
  DEFAULT_HARVEST_THRESHOLDS,
  HarvestThresholds,
  parseSearchTermReport,
  summarizeHarvest,
} from "@/lib/harvest";
import { buildAdGroupName, buildCampaignName } from "@/lib/naming";
import { BidEconomics, CampaignIdentity, Marketplace } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MARKETPLACES: Marketplace[] = ["US", "UK", "CA", "DE", "FR", "IT", "ES"];
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

function readString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(form: FormData, key: string): number | undefined {
  const raw = readString(form, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Second half of the two-phase discovery-then-harvest workflow (learnings
 * doc, section 1): takes an Auto campaign's exported Search Term report and
 * returns a Manual (SPM) Bulksheet that promotes converting terms to exact
 * match, negative-matches spend-without-conversion terms, and routes bare
 * ASIN "search terms" to product targeting instead of dropping them.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Request must be multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a Search Term report (.xlsx or .csv)." }, { status: 400 });
  }

  const asin = readString(form, "asin")?.toUpperCase();
  if (!asin || !ASIN_PATTERN.test(asin)) {
    return NextResponse.json({ error: "ASIN must be a 10-character alphanumeric code." }, { status: 400 });
  }

  const marketplace = readString(form, "marketplace") as Marketplace | undefined;
  if (!marketplace || !MARKETPLACES.includes(marketplace)) {
    return NextResponse.json(
      { error: `Marketplace must be one of ${MARKETPLACES.join(", ")}.` },
      { status: 400 }
    );
  }

  const creatorInitials = readString(form, "creatorInitials");
  const authorName = readString(form, "authorName");
  const bookTitle = readString(form, "bookTitle");
  if (!creatorInitials || !authorName || !bookTitle) {
    return NextResponse.json(
      { error: "Creator Initials, Author Name, and Book Title are required — they're baked into the campaign name." },
      { status: 400 }
    );
  }
  const seriesName = readString(form, "seriesName");
  const variant = readNumber(form, "variant") ?? 1;

  const dailyBudget = readNumber(form, "dailyBudget");
  if (!dailyBudget || dailyBudget <= 0) {
    return NextResponse.json({ error: "Daily Budget must be a positive number." }, { status: 400 });
  }
  const startDate = readString(form, "startDate");
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: "Start Date must be in YYYY-MM-DD format." }, { status: 400 });
  }

  const rrp = readNumber(form, "rrp");
  const targetAcos = readNumber(form, "targetAcos");
  const estConversionRate = readNumber(form, "estConversionRate");
  const defaultBid = readNumber(form, "defaultBid");

  let bidEconomics: BidEconomics | undefined;
  if (rrp && targetAcos && estConversionRate) {
    bidEconomics = { rrp, targetAcos, estConversionRate };
  }
  if (!bidEconomics && !defaultBid) {
    return NextResponse.json(
      { error: "Provide RRP + target ACOS + expected conversion rate, or a manual Default Bid." },
      { status: 400 }
    );
  }
  const baseBid = bidEconomics ? computeMaxCpc(bidEconomics) : (defaultBid as number);

  const thresholds: HarvestThresholds = {
    minImpressionsForSignal:
      readNumber(form, "minImpressionsForSignal") ?? DEFAULT_HARVEST_THRESHOLDS.minImpressionsForSignal,
    minClicksToNegate: readNumber(form, "minClicksToNegate") ?? DEFAULT_HARVEST_THRESHOLDS.minClicksToNegate,
    minOrdersToPromote: readNumber(form, "minOrdersToPromote") ?? DEFAULT_HARVEST_THRESHOLDS.minOrdersToPromote,
    targetAcos: targetAcos ?? DEFAULT_HARVEST_THRESHOLDS.targetAcos,
  };

  const buffer = Buffer.from(await file.arrayBuffer());
  const rows = await parseSearchTermReport(buffer, file.name);
  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Couldn't find any search-term rows in that file. Check it's an unmodified Amazon Search Term report export (.xlsx or .csv).",
      },
      { status: 400 }
    );
  }

  const decisions = classifySearchTerms(rows, thresholds);
  const summary = summarizeHarvest(decisions);
  const { keywords, productTargets, negativeKeywords } = buildHarvestOutputs(decisions, baseBid);

  const identity: CampaignIdentity = {
    asin,
    marketplace,
    campaignType: "SPM",
    creatorInitials,
    authorName,
    bookTitle,
    seriesName,
    variant,
  };
  const campaignName = buildCampaignName(identity);

  if (keywords.length === 0 && productTargets.length === 0 && negativeKeywords.length === 0) {
    return NextResponse.json(
      {
        error: "Nothing in this report crossed the promote/negate thresholds — no bulksheet to generate.",
        summary,
      },
      { status: 502 }
    );
  }

  const adGroups: SpmAdGroup[] = [
    {
      name: buildAdGroupName(identity, "harvested"),
      defaultBid: baseBid,
      keywords,
      matchTypes: ["exact"],
    },
    {
      name: buildAdGroupName(identity, "product-targeting"),
      defaultBid: baseBid,
      productTargets,
    },
  ];

  const workbook = await buildBulksheet({
    campaignName,
    asin,
    campaignType: "SPM",
    dailyBudget,
    startDate,
    baseBid,
    adGroups,
    negativeKeywords,
  });

  const filename = `${campaignName.replace(/[^a-z0-9\-_]+/gi, "_")}-harvest-bulksheet.xlsx`;
  return new NextResponse(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Campaign-Name": encodeURIComponent(campaignName),
      "X-Harvest-Summary": encodeURIComponent(JSON.stringify(summary)),
    },
  });
}
