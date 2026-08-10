"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Download, Plus, Sparkles, Zap, Target } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  status: string;
  tropes_keyword_count: number;
  comp_names_keyword_count: number;
  product_target_count: number;
  total_rows: number;
  daily_budget: number;
  created_at: string;
  config_json?: { variant?: number } | null;
  hasBulksheet?: boolean;
}

interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  description?: string;
  campaign_count: number;
  total_keywords: number;
  total_spend: number;
  created_at: string;
  metadata_json?: any;
  campaigns: Campaign[];
}

interface BookDetailPageProps {
  bookId: string;
  onBack: () => void;
  onCreateCampaign: (bookId: string) => void;
}

const statusConfig = {
  draft: { bg: "bg-gray-50", text: "text-gray-700", badge: "bg-gray-100" },
  uploaded: { bg: "bg-gray-50", text: "text-gray-700", badge: "bg-gray-100" },
  active: { bg: "bg-gray-50", text: "text-gray-700", badge: "bg-gray-100" },
  archived: { bg: "bg-gray-50", text: "text-gray-700", badge: "bg-gray-100" },
};

export default function BookDetailPage({
  bookId,
  onBack,
  onCreateCampaign,
}: BookDetailPageProps) {
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBook() {
      try {
        setLoading(true);
        const res = await fetch(`/api/books/${bookId}`);
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          console.warn("Could not load book:", body.error);
          setBook(null);
        } else {
          setBook(body.book as Book);
        }
      } catch (err) {
        console.warn("Failed to load book:", err);
        setBook(null);
      } finally {
        setLoading(false);
      }
    }

    loadBook();
  }, [bookId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-gray-200 border-t-gray-700 rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading book...</p>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} />
            Back to Books
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600">Book not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} />
          Back to Books
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{book.title}</h1>
        <p className="text-sm text-gray-500 mt-1">by {book.author}</p>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-8 py-8">
        {/* Book Info Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 font-medium">ASIN</p>
            <p className="text-lg font-bold text-gray-900 font-mono mt-2">{book.asin}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 font-medium">Marketplace</p>
            <p className="text-lg font-bold text-gray-900 mt-2">{book.marketplace}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 font-medium">Campaigns</p>
            <p className="text-lg font-bold text-gray-900 mt-2">{book.campaign_count}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 font-medium">Total Keywords</p>
            <p className="text-lg font-bold text-gray-900 mt-2">{book.total_keywords}</p>
          </div>
        </div>

        {/* Campaigns Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Ad Campaigns</h2>
            <button
              onClick={() => onCreateCampaign(bookId)}
              className="btn-pill-dark px-4 py-2 text-sm"
            >
              <Plus size={16} className="inline mr-2" />
              New Campaign
            </button>
          </div>

          {book.campaigns && book.campaigns.length > 0 ? (
            <div className="space-y-2">
              {book.campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {campaign.name}
                      {campaign.config_json?.variant != null && (
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          v{campaign.config_json.variant}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {campaign.total_rows} rows · Created{" "}
                      {new Date(campaign.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <p className="text-gray-600">${campaign.daily_budget?.toFixed(2) || "0.00"}</p>
                      <p className="text-xs text-gray-500">daily budget</p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded text-xs font-medium ${
                        statusConfig[campaign.status as keyof typeof statusConfig]?.badge
                      } ${statusConfig[campaign.status as keyof typeof statusConfig]?.text}`}
                    >
                      {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                    </span>
                    <div className="text-right w-32">
                      <div className="space-y-1">
                        <div className="text-xs text-gray-600">
                          <Target size={14} className="inline mr-1" />
                          {campaign.tropes_keyword_count}
                        </div>
                        <div className="text-xs text-gray-600">
                          <Zap size={14} className="inline mr-1" />
                          {campaign.comp_names_keyword_count}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled
                        title="Improve — coming soon"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-400 cursor-not-allowed"
                      >
                        <Sparkles size={14} />
                        Improve
                      </button>
                      {campaign.hasBulksheet ? (
                        <a
                          href={`/api/campaigns/${campaign.id}/download`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <Download size={14} />
                          Download
                        </a>
                      ) : (
                        <button
                          type="button"
                          disabled
                          title="No bulksheet generated yet"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-400 cursor-not-allowed"
                        >
                          <Download size={14} />
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-gray-600 mb-4">No campaigns yet for this book</p>
              <button
                onClick={() => onCreateCampaign(bookId)}
                className="btn-pill-dark px-6 py-2"
              >
                Create Campaign
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
