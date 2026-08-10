"use client";

import { Plus, FileText, MoreVertical, Search, Zap, Target, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface Campaign {
  id: string;
  name: string;
  asin: string;
  marketplace: string;
  daily_budget: number;
  tropes_keyword_count: number;
  comp_names_keyword_count: number;
  product_target_count: number;
  total_rows: number;
  created_at: string;
  status: "draft" | "uploaded" | "active" | "archived";
}

interface CampaignsDashboardProps {
  onCreateNew: () => void;
}

const statusConfig = {
  draft: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", badge: "bg-gray-100" },
  uploaded: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", badge: "bg-gray-100" },
  active: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", badge: "bg-gray-100" },
  archived: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", badge: "bg-gray-100" },
};

export default function CampaignsDashboard({ onCreateNew }: CampaignsDashboardProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    async function loadCampaigns() {
      try {
        setLoading(true);
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { data, error: err } = await supabase
          .from("campaigns")
          .select("*")
          .order("created_at", { ascending: false });

        if (err) {
          console.warn("Could not load campaigns:", err.message);
          setCampaigns([]);
        } else {
          setCampaigns(data || []);
        }
      } catch (err) {
        console.warn("Failed to load campaigns:", err);
        setCampaigns([]);
      } finally {
        setLoading(false);
      }
    }

    loadCampaigns();
  }, []);

  const filteredCampaigns = campaigns.filter((campaign) => {
    const matchesSearch =
      campaign.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      campaign.asin.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || campaign.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const isEmpty = campaigns.length === 0;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                All campaigns
              </h1>
              <p className="text-gray-600 mt-1">Manage your Amazon Ads campaigns</p>
            </div>
            <button
              onClick={onCreateNew}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white font-semibold rounded-lg hover:bg-gray-800 transition-all"
            >
              <Plus size={20} />
              New campaign
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-12">
        {isEmpty ? (
          // Empty State
          <div className="space-y-8">
            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button
                onClick={onCreateNew}
                className="bg-gray-900 rounded-lg p-8 text-white hover:bg-gray-800 transition-all flex flex-col items-center justify-center gap-3"
              >
                <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                  <FileText size={24} />
                </div>
                <span className="text-lg font-semibold">Create campaign</span>
                <span className="text-sm opacity-80">15+ keyword sources</span>
              </button>

              <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 flex flex-col items-center justify-center gap-3 opacity-50 hover:opacity-75 transition-opacity cursor-not-allowed">
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Sparkles size={24} className="text-gray-400" />
                </div>
                <span className="text-lg font-semibold text-gray-900">Template library</span>
                <span className="text-sm text-gray-600">Coming soon</span>
              </div>

              <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 flex flex-col items-center justify-center gap-3 opacity-50 hover:opacity-75 transition-opacity cursor-not-allowed">
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Target size={24} className="text-gray-400" />
                </div>
                <span className="text-lg font-semibold text-gray-900">AI optimizer</span>
                <span className="text-sm text-gray-600">Coming soon</span>
              </div>
            </div>

            {/* Features Overview */}
            <div className="bg-white rounded-lg border border-gray-200 p-12">
              <div className="max-w-3xl">
                <h2 className="text-2xl font-bold text-gray-900 mb-3">
                  Generate Amazon Ads Campaigns in Minutes
                </h2>
                <p className="text-gray-600 mb-8 leading-relaxed">
                  Create optimized Sponsored Products campaigns powered by 15+ data sources. Get budget-aware keyword selection, strategy recommendations, and ready-to-upload Excel bulksheets.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-gray-100">
                        <Zap className="h-6 w-6 text-gray-700" />
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">15+ Sources</h3>
                      <p className="text-sm text-gray-600 mt-1">Amazon APIs, Google Books, Goodreads & more</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-gray-100">
                        <Target className="h-6 w-6 text-gray-700" />
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">3 Strategies</h3>
                      <p className="text-sm text-gray-600 mt-1">Phrase-only, balanced, aggressive options</p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-gray-100">
                        <Sparkles className="h-6 w-6 text-gray-700" />
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Budget Control</h3>
                      <p className="text-sm text-gray-600 mt-1">100% budget-aware keyword capping</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Search and Filters */}
            <div className="mb-8 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-3.5 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Search campaigns, ASIN..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300 bg-white transition-all"
                  />
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-2 overflow-x-auto">
                {["all", "draft", "uploaded", "active"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                      filterStatus === status
                        ? "bg-gray-900 text-white"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Campaigns Table */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="animate-spin w-12 h-12 border-4 border-gray-200 border-t-gray-700 rounded-full mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading campaigns...</p>
                </div>
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
                <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-600">No campaigns found</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Campaign</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">ASIN</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Keywords</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Budget</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Created</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredCampaigns.map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <FileText size={20} className="text-gray-600" />
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 text-sm">{campaign.name}</p>
                              <p className="text-xs text-gray-500 mt-0.5">{campaign.id.slice(0, 8)}...</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm text-gray-600 bg-gray-50 px-3 py-1 rounded-lg">
                            {campaign.asin}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold border border-gray-200">
                            {campaign.total_rows} rows
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold text-gray-900">
                            ${campaign.daily_budget?.toFixed(2) || "0.00"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                              statusConfig[campaign.status].badge
                            } ${statusConfig[campaign.status].text}`}
                          >
                            {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-600">
                            {new Date(campaign.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg">
                            <MoreVertical size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
