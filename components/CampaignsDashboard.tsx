"use client";

import { Plus, FileText, MoreVertical, Search } from "lucide-react";
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

const statusColors = {
  draft: "bg-yellow-50 text-yellow-700 border-yellow-200",
  uploaded: "bg-blue-50 text-blue-700 border-blue-200",
  active: "bg-green-50 text-green-700 border-green-200",
  archived: "bg-gray-50 text-gray-700 border-gray-200",
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <h1 className="text-2xl font-bold text-gray-900">All campaigns</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {isEmpty ? (
          // Empty State
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={onCreateNew}
                className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors"
              >
                <FileText size={32} />
                <span className="text-lg font-medium">New campaign</span>
              </button>
              <div className="bg-white border border-gray-200 rounded-lg p-8 flex flex-col items-center justify-center gap-3 opacity-40">
                <div className="text-3xl">📊</div>
                <span className="text-sm font-medium text-gray-600">Coming soon</span>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-8 flex flex-col items-center justify-center gap-3 opacity-40">
                <div className="text-3xl">📁</div>
                <span className="text-sm font-medium text-gray-600">Coming soon</span>
              </div>
            </div>

            {/* Feature Overview */}
            <div className="bg-white rounded-lg border border-gray-200 p-12">
              <div className="max-w-2xl mx-auto text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Generate Amazon Ads Campaigns</h2>
                <p className="text-gray-600 mb-8 leading-relaxed">
                  Create optimized Sponsored Products campaigns in minutes. Our system harvests keywords from 15+ sources, applies budget-aware strategies, and generates ready-to-upload Excel bulksheets.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-left">
                    <div className="text-2xl font-bold text-blue-600 mb-2">15+</div>
                    <p className="text-sm text-gray-600">Data sources for keywords</p>
                  </div>
                  <div className="text-left">
                    <div className="text-2xl font-bold text-green-600 mb-2">3</div>
                    <p className="text-sm text-gray-600">Match-type strategies</p>
                  </div>
                  <div className="text-left">
                    <div className="text-2xl font-bold text-purple-600 mb-2">100%</div>
                    <p className="text-sm text-gray-600">Budget-aware capping</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Search and Filters */}
            <div className="mb-6 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                  <input
                    type="text"
                    placeholder="Search campaigns..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 bg-white"
                  />
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setFilterStatus("all")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === "all"
                      ? "bg-gray-200 text-gray-900"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  View all
                </button>
                <button
                  onClick={() => setFilterStatus("draft")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === "draft"
                      ? "bg-yellow-100 text-yellow-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Draft
                </button>
                <button
                  onClick={() => setFilterStatus("uploaded")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === "uploaded"
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Uploaded
                </button>
                <button
                  onClick={() => setFilterStatus("active")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === "active"
                      ? "bg-green-100 text-green-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Active
                </button>
              </div>
            </div>

            {/* Campaigns Table */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin w-12 h-12 border-4 border-gray-200 border-t-gray-900 rounded-full mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading campaigns...</p>
                </div>
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-600">No campaigns found</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Campaign Name</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">ASIN</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Keywords</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Budget</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Created</th>
                      <th className="px-6 py-4 text-right text-sm font-semibold text-gray-900">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCampaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <FileText size={18} className="text-gray-400" />
                            <div>
                              <p className="font-medium text-gray-900">{campaign.name}</p>
                              <p className="text-xs text-gray-600 mt-1">{campaign.id.slice(0, 8)}...</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm text-gray-600">{campaign.asin}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-3 text-sm">
                            <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                              {campaign.total_rows} rows
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium text-gray-900">${campaign.daily_budget?.toFixed(2) || "0.00"}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${
                              statusColors[campaign.status]
                            }`}
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
                          <button className="text-gray-400 hover:text-gray-600 transition-colors">
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
