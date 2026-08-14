"use client";

import { useEffect, useState } from "react";
import { DollarSign, Megaphone, Star, Tag } from "lucide-react";
import { StatTilesRow } from "./StatTiles";

interface CampaignRow {
  daily_budget: number;
}

/** The Book detail page's 4-up stat row: Campaigns / Genre terms / Daily spend / Rating. */
export default function BookStatTiles({
  bookId,
  genreTermCount,
  rating,
}: {
  bookId: string;
  genreTermCount: number;
  rating?: number;
}) {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/books/${bookId}/campaigns`)
      .then((res) => (res.ok ? res.json() : { campaigns: [] }))
      .then((body) => {
        if (active) setCampaigns(Array.isArray(body.campaigns) ? body.campaigns : []);
      })
      .catch(() => active && setCampaigns([]));
    return () => {
      active = false;
    };
  }, [bookId]);

  const dailySpend = (campaigns ?? []).reduce((sum, c) => sum + (c.daily_budget ?? 0), 0);

  return (
    <StatTilesRow
      tiles={[
        { label: "Campaigns", value: campaigns === null ? "…" : campaigns.length, icon: Megaphone },
        { label: "Genre terms", value: genreTermCount, icon: Tag },
        { label: "Daily spend", value: campaigns === null ? "…" : `$${dailySpend.toFixed(2)}`, icon: DollarSign },
        { label: "Rating", value: rating !== undefined ? rating.toFixed(1) : "—", icon: Star },
      ]}
    />
  );
}
