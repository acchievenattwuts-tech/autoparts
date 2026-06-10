import type { ProfitDashboardFilters, ProfitSummary } from "@/lib/profit-dashboard";

export const PROFIT_EXPLANATION_PROMPT_VERSION = "profit-explanation-v1";
export const PROFIT_EXPLANATION_RETENTION_DAYS = 60;
export const PROFIT_EXPLANATION_MAX_ITEMS = 5;

export type ProfitExplanationEvidenceLink = {
  id: string;
  label: string;
  href?: string;
};

export type ProfitExplanationDriver = {
  title: string;
  detail: string;
  impact: "positive" | "negative" | "neutral";
  amount: number;
  marginPct?: number;
  evidenceRef: string;
};

export type ProfitExplanationAnomaly = {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  evidenceRef: string;
};

export type ProfitExplanationEvidence = {
  filters: ProfitDashboardFilters;
  selectedRange: ProfitSummary;
  previousRange: ProfitSummary;
  deltas: {
    salesAmount: number;
    costAmount: number;
    expenseAmount: number;
    grossProfit: number;
    netProfitAmount: number;
    marginPct: number;
  };
  topPositiveDrivers: ProfitExplanationDriver[];
  topNegativeDrivers: ProfitExplanationDriver[];
  anomalies: ProfitExplanationAnomaly[];
  evidenceLinks: ProfitExplanationEvidenceLink[];
};

export type ProfitExplanationResult = {
  summary: string;
  confidence: "high" | "medium" | "low";
  facts: Array<{
    label: string;
    value: string;
    source: "system";
  }>;
  drivers: Array<{
    title: string;
    explanation: string;
    impact: "positive" | "negative" | "neutral";
    amount?: number;
    evidenceRefs: string[];
  }>;
  anomalies: Array<{
    title: string;
    explanation: string;
    severity: "high" | "medium" | "low";
    evidenceRefs: string[];
  }>;
  recommendedChecks: Array<{
    label: string;
    reason: string;
    href?: string;
  }>;
  limitations: string[];
};
