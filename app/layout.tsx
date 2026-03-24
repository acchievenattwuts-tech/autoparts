import type { Metadata } from "next";
import { Kanit, Sarabun } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "ศรีวรรณ อะไหล่แอร์ | อะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร",
  description:
    "ร้านอะไหล่แอร์และหม้อน้ำรถยนต์ทุกยี่ห้อ คอมเพรสเซอร์ หม้อน้ำ แผงคอนเดนเซอร์ ท่อแอร์ ราคายุติธรรม ส่งทั่วประเทศ สั่งซื้อผ่าน LINE OA ได้เลย",
};

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
      <body className="min-h-full flex flex-col font-sarabun">{children}</body>
    </html>
  );
}
