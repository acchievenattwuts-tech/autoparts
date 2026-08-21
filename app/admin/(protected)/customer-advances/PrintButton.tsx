"use client";
import { Printer } from "lucide-react";
export default function PrintButton() { return <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600"><Printer size={14} /> พิมพ์</button>; }
