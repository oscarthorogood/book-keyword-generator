"use client";

import CompetitorPanel from "./CompetitorPanel";
import KeywordManager from "./KeywordManager";

export interface BookKeywordPanelProps {
  bookId: string;
  mode: "keywords" | "competitors";
  metadataCapturedAt?: string;
  metadataReady: boolean;
  genreTerms: string[];
  onKeywordsChanged?: () => void;
}

/**
 * Book-page toggle target (spec §6.1): the same slot on the book page shows
 * either the book's own keyword manager or its competitor-ASIN/keyword
 * panel, depending on `mode`. KeywordManager already implements every
 * behaviour §6.3 asks for (search, category/match-type/specificity
 * filtering, CSV export, per-keyword actions) for the "keywords" mode, so it
 * is reused as-is rather than duplicated; CompetitorPanel mirrors the same
 * shape of behaviour for competitor ASINs (competitor_asins) — there is no
 * competitor-keyword concept in this mode.
 */
export default function BookKeywordPanel({
  bookId,
  mode,
  metadataCapturedAt,
  metadataReady,
  genreTerms,
  onKeywordsChanged,
}: BookKeywordPanelProps) {
  if (mode === "competitors") {
    return <CompetitorPanel bookId={bookId} />;
  }

  return (
    <KeywordManager
      bookId={bookId}
      metadataCapturedAt={metadataCapturedAt}
      metadataReady={metadataReady}
      genreTerms={genreTerms}
      onKeywordsChanged={onKeywordsChanged}
    />
  );
}
