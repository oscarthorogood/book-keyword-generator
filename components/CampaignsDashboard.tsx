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
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-gray-900">All campaigns</h1>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-8 py-8">
        {/* Quick Action Cards */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <button
            onClick={onCreateNew}
            className="group bg-gray-900 rounded-xl p-8 text-white hover:bg-gray-800 transition-all flex flex-col items-center justify-center gap-3 min-h-28"
          >
            <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <FileText size={24} />
            </div>
            <span className="text-base font-semibold">New campaign</span>
          </button>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 flex flex-col items-center justify-center gap-3 opacity-50 cursor-not-allowed min-h-28">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
              <Sparkles size={24} className="text-gray-400" />
            </div>
            <span className="text-base font-semibold text-gray-900">Templates</span>
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 flex flex-col items-center justify-center gap-3 opacity-50 cursor-not-allowed min-h-28">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
              <Target size={24} className="text-gray-400" />
            </div>
            <span className="text-base font-semibold text-gray-900">AI Optimizer</span>
          </div>
        </div>

        {/* Campaign Explorer */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Campaign explorer</h2>
        </div>

        {isEmpty ? (
          // Empty State
          <div className="text-center py-16 bg-gray-50 rounded-lg border border-gray-200">
            <FileText size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600">No campaigns yet. Create one to get started.</p>
          </div>
        ) : (
          <>
            {/* Filter Tabs and Search */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex gap-1">
                {["all", "draft", "uploaded", "active"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={`px-4 py-2 text-sm font-medium transition-all ${
                      filterStatus === status
                        ? "text-gray-900 border-b-2 border-gray-900"
                        : "text-gray-600 border-b-2 border-transparent hover:text-gray-900"
                    }`}
                  >
                    {status === "all" ? "View all" : status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
              <div className="relative w-64">
                <Search className="absolute right-3 top-2.5 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pr-10 pl-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 bg-white text-sm"
                />
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
              <div className="text-center py-16 bg-gray-50 rounded-lg border border-gray-200">
                <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-600">No campaigns found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCampaigns.map((campaign) => (
                  <div
                    key={campaign.id}
                    className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <input type="checkbox" className="text-gray-900 rounded" />
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText size={20} className="text-gray-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{campaign.name}</p>
                        <p className="text-xs text-gray-500">{campaign.total_rows} rows · {campaign.asin}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <p className="text-gray-600">${campaign.daily_budget?.toFixed(2) || "0.00"}</p>
                        <p className="text-xs text-gray-500">daily budget</p>
                      </div>
                      <span
                        className={`px-3 py-1 rounded text-xs font-medium ${
                          statusConfig[campaign.status].badge
                        } ${statusConfig[campaign.status].text}`}
                      >
                        {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                      </span>
                      <div className="text-right w-24">
                        <p className="text-gray-600 text-xs">
                          {new Date(campaign.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      <button className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-all p-2">
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
