import { ImageResponse } from "next/og";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import { absoluteUrl } from "@/lib/seo";
import { getPublicSiteConfig } from "@/lib/site-config";

export const dynamic = "force-dynamic";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

// Fetch the logo ourselves and inline it as a data URL instead of letting
// Satori fetch it. Right after a re-upload the Vercel Blob CDN can briefly serve
// an empty/partial body, which Satori reports as "Unsupported image type:
// unknown" and the whole icon render fails. Here we validate the response and
// fall back to the initials badge on any failure, so the favicon never breaks.
async function loadLogoDataUrl(logoUrl: string): Promise<string | null> {
  try {
    const response = await fetch(logoUrl, { cache: "no-store" });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // A valid raster logo is never this small; an empty/partial CDN body is.
    if (buffer.byteLength < 100) return null;

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Icon() {
  const config = await getPublicSiteConfig();
  const rawLogoUrl = config.shopLogoUrl?.trim();
  const logoUrl = rawLogoUrl ? absoluteUrl(toPublicStorageCdnPath(rawLogoUrl) ?? rawLogoUrl) : null;
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null;
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
          background: "transparent",
        }}
      >
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt={shopName}
            width={64}
            height={64}
            style={{
              objectFit: "contain",
              width: "100%",
              height: "100%",
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
