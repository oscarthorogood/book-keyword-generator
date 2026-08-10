"use client";

import { useState } from "react";
import { HomeIcon, Folder, Lock, Share2, Trash2, Palette, Bell, Settings, LogOut } from "lucide-react";
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
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-blue-50">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-72" : "w-20"
        } bg-white border-r border-slate-200 transition-all duration-300 flex flex-col fixed h-screen left-0 top-0 z-40 shadow-sm`}
      >
        {/* Logo/Header */}
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-lg">📚</span>
            </div>
            {sidebarOpen && (
              <div>
                <div className="font-bold text-slate-900 text-sm">Ads Assistant</div>
                <div className="text-xs text-slate-500">Campaign Manager</div>
              </div>
            )}
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {mainNavItems.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.label === "All campaigns") {
                  setCurrentPage("dashboard");
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                currentPage === "dashboard" && item.label === "All campaigns"
                  ? "bg-gradient-to-r from-purple-100 to-blue-100 text-purple-600 border border-purple-200"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <item.icon size={20} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Tools Navigation */}
        <nav className="p-4 border-t border-slate-200 space-y-1">
          {toolsNavItems.map((item) => (
            <button
              key={item.label}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 transition-all"
            >
              <item.icon size={20} className="flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}

          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-all border border-red-200">
            <LogOut size={20} className="flex-shrink-0" />
            {sidebarOpen && <span>Sign out</span>}
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${sidebarOpen ? "ml-72" : "ml-20"}`}>
        {currentPage === "dashboard" ? (
          <CampaignsDashboard onCreateNew={() => setCurrentPage("form")} />
        ) : (
          <CampaignGenerationForm onBack={() => setCurrentPage("dashboard")} />
        )}
      </div>

      {/* Sidebar Toggle Button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed bottom-8 left-8 w-12 h-12 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all shadow-lg z-50 flex items-center justify-center text-slate-600"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    </div>
  );
}
