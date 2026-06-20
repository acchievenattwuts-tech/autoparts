"use client";

import { useLayoutEffect } from "react";

const liffThemeBootstrapScript = `
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var isPrint = params.has("printToken");
    var theme = isPrint ? "light" : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var root = document.documentElement;
    var body = document.body;
    root.dataset.liffTheme = theme;
    root.style.colorScheme = isPrint ? "only light" : theme;
    root.classList.toggle("dark", theme === "dark");
    if (body) {
      body.dataset.liffTheme = theme;
      body.style.colorScheme = isPrint ? "only light" : theme;
      body.style.backgroundColor = isPrint ? "#ffffff" : (theme === "dark" ? "#06162d" : "#eef7ff");
      body.classList.toggle("dark", theme === "dark");
    }
  } catch (error) {}
})();
`;

export default function LiffThemeBootstrap() {
  useLayoutEffect(() => {
    const script = document.createElement("script");
    script.textContent = liffThemeBootstrapScript;
    document.head.appendChild(script);
  }, []);

  return null;
}
