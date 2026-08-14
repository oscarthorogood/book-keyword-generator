import type { LucideIcon } from "lucide-react";

export interface StatTile {
  label: string;
  value: string | number;
  icon: LucideIcon;
}

/**
 * The 4-up KPI row atop every list page (Books, Book detail, Campaigns,
 * Keywords & ASINs, Presets) — an icon tile in the brand accent colour, a
 * label and a value. Grid rather than a fixed 4 columns so it still reads
 * on narrow viewports.
 */
export function StatTilesRow({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat-tile">
          <span className="stat-tile-icon">
            <tile.icon size={20} />
          </span>
          <div className="min-w-0">
            <p className="stat-tile-label">{tile.label}</p>
            <p className="stat-tile-value">{tile.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
