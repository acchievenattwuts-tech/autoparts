import { ImageResponse } from "next/og";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-dynamic";

export const size = {
  width: 128,
  height: 128,
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
          overflow: "hidden",
          background: "#ffffff",
          borderRadius: "24px",
        }}
      >
        {logoUrl ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "12px",
              background: "#ffffff",
            }}
          >
            <img
              src={logoUrl}
              alt={shopName}
              width={104}
              height={104}
              style={{
                objectFit: "contain",
                width: "100%",
                height: "100%",
              }}
            />
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 52,
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
