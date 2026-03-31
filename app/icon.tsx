import { ImageResponse } from "next/og";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-dynamic";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default async function Icon() {
  const config = await getSiteConfig();
  const logoUrl = config.shopLogoUrl?.trim();
  const shopName = config.shopName?.trim() || "ศรีวรรณ อะไหล่แอร์";
  const initials =
    shopName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "ศว";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e3a5f",
          borderRadius: "14px",
          overflow: "hidden",
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={shopName}
            width={48}
            height={48}
            style={{
              objectFit: "contain",
              background: "white",
              borderRadius: "10px",
              padding: "6px",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 28,
              fontWeight: 700,
              background:
                "linear-gradient(135deg, #1e3a5f 0%, #345b87 60%, #f97316 100%)",
            }}
          >
            {initials}
          </div>
        )}
      </div>
    ),
    size
  );
}
