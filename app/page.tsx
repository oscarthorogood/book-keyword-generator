"use client";

import { useState } from "react";
import CampaignGenerationForm from "@/components/CampaignGenerationForm";
import CampaignsDashboard from "@/components/CampaignsDashboard";

type Page = "dashboard" | "form";

export default function Home() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");

  return (
    <div className="min-h-screen bg-gray-50">
      {currentPage === "dashboard" ? (
        <CampaignsDashboard onCreateNew={() => setCurrentPage("form")} />
      ) : (
        <CampaignGenerationForm onBack={() => setCurrentPage("dashboard")} />
      )}
    </div>
  );
}
