import { Kanit, Sarabun } from "next/font/google";
import "./globals.css";
import { buildDefaultMetadataBase } from "@/lib/seo";

const kanit = Kanit({
  variable: "--font-kanit",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata = buildDefaultMetadataBase();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${kanit.variable} ${sarabun.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sarabun">{children}</body>
    </html>
  );
}
