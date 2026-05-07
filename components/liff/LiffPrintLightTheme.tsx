"use client";

import { useEffect } from "react";

export default function LiffPrintLightTheme() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const previousHtmlClass = html.className;
    const previousHtmlColorScheme = html.style.colorScheme;
    const previousHtmlBackground = html.style.backgroundColor;
    const previousBodyColorScheme = body.style.colorScheme;
    const previousBodyBackground = body.style.backgroundColor;
    const previousBodyColor = body.style.color;

    html.classList.remove("dark");
    html.style.colorScheme = "light only";
    html.style.backgroundColor = "#ffffff";
    body.classList.remove("dark");
    body.style.colorScheme = "light only";
    body.style.backgroundColor = "#ffffff";
    body.style.color = "#111827";

    return () => {
      html.className = previousHtmlClass;
      html.style.colorScheme = previousHtmlColorScheme;
      html.style.backgroundColor = previousHtmlBackground;
      body.style.colorScheme = previousBodyColorScheme;
      body.style.backgroundColor = previousBodyBackground;
      body.style.color = previousBodyColor;
    };
  }, []);

  return null;
}
