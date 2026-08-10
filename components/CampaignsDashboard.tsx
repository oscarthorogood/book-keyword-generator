"use client";

import { Plus } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  bookTitle: string;
  author: string;
  asin: string;
  marketplace: string;
  dailyBudget: number;
  startDate: string;
  tropesKeywordCount: number;
  compNameKeywordCount: number;
  productTargetCount: number;
  createdAt: string;
  status: "draft" | "uploaded" | "active";
}

interface CampaignsDashboardProps {
  onCreateNew: () => void;
}

// Mock data for now — will be replaced with real data from Supabase
const MOCK_CAMPAIGNS: Campaign[] = [];

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const totalKeywords = campaign.tropesKeywordCount + campaign.compNameKeywordCount;
  const statusColors = {
    draft: "bg-yellow-100 text-yellow-800",
    uploaded: "bg-blue-100 text-blue-800",
    active: "bg-green-100 text-green-800",
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 text-lg mb-1">{campaign.bookTitle}</h3>
          <p className="text-sm text-gray-600">{campaign.author}</p>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[campaign.status]}`}>
          {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <p className="text-gray-600">ASIN</p>
          <p className="font-mono text-gray-900">{campaign.asin}</p>
        </div>
        <div>
          <p className="text-gray-600">Marketplace</p>
          <p className="font-semibold text-gray-900">{campaign.marketplace}</p>
        </div>
        <div>
          <p className="text-gray-600">Daily Budget</p>
          <p className="font-semibold text-gray-900">${campaign.dailyBudget.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-600">Start Date</p>
          <p className="font-semibold text-gray-900">{new Date(campaign.startDate).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-4 border-t border-gray-200">
        <div className="text-center">
          <p className="text-lg font-semibold text-blue-600">{campaign.tropesKeywordCount}</p>
          <p className="text-xs text-gray-600">Tropes Keywords</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-blue-600">{campaign.compNameKeywordCount}</p>
          <p className="text-xs text-gray-600">Comp Names</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-blue-600">{campaign.productTargetCount}</p>
          <p className="text-xs text-gray-600">Product Targets</p>
        </div>
      </div>

      <button className="w-full mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors">
        View Details
      </button>
    </div>
  );
}

export default function CampaignsDashboard({ onCreateNew }: CampaignsDashboardProps) {
  const campaigns = MOCK_CAMPAIGNS;
  const isEmpty = campaigns.length === 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
              <p className="text-gray-600 mt-1">Manage your Amazon Ads campaigns</p>
            </div>
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus size={20} />
              Create New Campaign
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        {isEmpty ? (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-12 text-center">
              <div className="mb-6">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-4">
                  <Plus size={40} className="text-blue-600" />
                </div>
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-3">Welcome to Campaign Generator</h2>
              <p className="text-gray-700 mb-8 max-w-2xl mx-auto text-lg leading-relaxed">
                Generate optimized Amazon Ads Sponsored Products campaigns in minutes. Simply enter your book's ASIN or ISBN, and we'll harvest keywords from 15+ sources and create a ready-to-upload bulksheet with cost-aware strategies.
              </p>
              <button
                onClick={onCreateNew}
                className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-lg"
              >
                <Plus size={24} />
                Create Your First Campaign
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                  <span className="text-xl font-bold text-blue-600">📚</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Multi-Source Keywords</h3>
                <p className="text-sm text-gray-600">Pulls from 15+ data sources: Amazon APIs, autocomplete, Google Books, Goodreads, Wikipedia, and more.</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                  <span className="text-xl font-bold text-green-600">💰</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Budget Optimization</h3>
                <p className="text-sm text-gray-600">Choose match-type strategies (phrase-only, balanced, or aggressive) to control costs and keyword coverage.</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                  <span className="text-xl font-bold text-purple-600">📊</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Ready to Upload</h3>
                <p className="text-sm text-gray-600">Download an Excel bulksheet formatted for Amazon's Sponsored Products bulk upload tool.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
