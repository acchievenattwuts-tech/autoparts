"use client";

import { useReportWebVitals } from "next/web-vitals";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

const endpoint = "/api/web-vitals";

const reportWebVitals: ReportWebVitalsCallback = (metric) => {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const payload = JSON.stringify({
    id: metric.id,
    name: metric.name,
    value: Number(metric.value.toFixed(metric.name === "CLS" ? 4 : 2)),
    delta: Number(metric.delta.toFixed(metric.name === "CLS" ? 4 : 2)),
    rating: metric.rating,
    navigationType: metric.navigationType,
    pathname: window.location.pathname,
    href: window.location.href,
    capturedAt: new Date().toISOString(),
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, payload);
    return;
  }

  void fetch(endpoint, {
    method: "POST",
    body: payload,
    headers: {
      "Content-Type": "application/json",
    },
    keepalive: true,
  });
};

export default function WebVitalsReporter() {
  useReportWebVitals(reportWebVitals);
  return null;
}
