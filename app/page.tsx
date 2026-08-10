"use client";

import { useState } from "react";
import { Home as HomeIcon, Folder, Lock, Share2, Trash2, Palette, Bell, Settings } from "lucide-react";
import CampaignGenerationForm from "@/components/CampaignGenerationForm";
import CampaignsDashboard from "@/components/CampaignsDashboard";

type Page = "dashboard" | "form";

export default function Home() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { icon: HomeIcon, label: "Home", section: "main" },
    { icon: Folder, label: "All campaigns", section: "main" },
    { icon: Lock, label: "Private campaigns", section: "main" },
    { icon: Share2, label: "Shared with me", section: "main" },
    { icon: Trash2, label: "Archived", section: "main" },
    { icon: Palette, label: "Design", section: "tools" },
    { icon: Bell, label: "Notifications", section: "tools" },
    { icon: Settings, label: "Settings", section: "tools" },
  ];

  const mainNavItems = navItems.filter((item) => item.section === "main");
  const toolsNavItems = navItems.filter((item) => item.section === "tools");

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-64" : "w-20"
        } bg-white border-r border-gray-200 transition-all duration-300 flex flex-col`}
      >
        {/* Logo/Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">📚</span>
            </div>
            {sidebarOpen && <span className="font-bold text-gray-900">Ads Assistant</span>}
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {mainNavItems.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.label === "All campaigns") {
                  setCurrentPage("dashboard");
                }
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                currentPage === "dashboard" && item.label === "All campaigns"
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <item.icon size={20} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Tools Navigation */}
        <nav className="p-4 border-t border-gray-200 space-y-2">
          {toolsNavItems.map((item) => (
            <button
              key={item.label}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <item.icon size={20} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        {currentPage === "dashboard" ? (
          <CampaignsDashboard onCreateNew={() => setCurrentPage("form")} />
        ) : (
          <CampaignGenerationForm onBack={() => setCurrentPage("dashboard")} />
        )}
      </div>
    </div>
  );
}
