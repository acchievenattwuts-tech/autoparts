import { getOgLogoDataUri } from "@/lib/og-logo";

interface OgImageTemplateProps {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: string;
}

// Satori renders at exactly 1200x630, so the layout is expressed in absolute
// pixels rather than percentages — it never has to respond to another size.
const CARD_WIDTH = 1200;
const IMAGE_PANEL_WIDTH = 624;
const LOGO_SIZE = 260;
const TEXT_PANEL_PADDING_X = 54;
// Satori does not constrain a text node to its flex parent's content box, so an
// unbreakable Thai run keeps painting past the card edge unless the node itself
// carries an explicit max width.
const TEXT_MAX_WIDTH =
  CARD_WIDTH - IMAGE_PANEL_WIDTH - TEXT_PANEL_PADDING_X * 2;

// Real product names and category names run far longer than the text panel can
// show (e.g. "Resistor DMAX 2003-19' /mu-7/Almera(แอร์ธรรมดา) /March
// (แอร์ธรรมดา) STAL STR-1008"). Satori does not clamp overflowing text — it
// just paints past the panel — so the strings are trimmed before layout.
const EYEBROW_MAX_CHARS = 38;
const TITLE_MAX_CHARS = 62;
const DESCRIPTION_MAX_CHARS = 110;

const clamp = (value: string, maxChars: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 1).trimEnd()}…`
    : normalized;
};

const OgImageTemplate = ({
  eyebrow = "ศรีวรรณ อะไหล่แอร์",
  title,
  description,
  meta,
}: OgImageTemplateProps) => {
  const logoSrc = getOgLogoDataUri();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#ffffff",
        fontFamily: "Sarabun, sans-serif",
      }}
    >
      {/* Laid out in flow rather than absolutely: satori resolves `position:
          absolute` against the nearest flex line, not the card, so an absolute
          bar rendered across the right panel only. */}
      <div
        style={{
          display: "flex",
          width: CARD_WIDTH,
          height: 11,
          background: "#17335e",
        }}
      />

      <div style={{ display: "flex", width: CARD_WIDTH, flex: 1 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: IMAGE_PANEL_WIDTH,
          height: "100%",
          background: "#f4f6f9",
        }}
      >
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoSrc} width={LOGO_SIZE} height={LOGO_SIZE} alt="" />
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 20,
          width: CARD_WIDTH - IMAGE_PANEL_WIDTH,
          height: "100%",
          padding: `60px ${TEXT_PANEL_PADDING_X}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            padding: "8px 24px",
            borderRadius: 9999,
            background: "#f1f5fa",
            border: "1px solid #e2e8f0",
            fontSize: 24,
            fontWeight: 600,
            color: "#1e3a5f",
          }}
        >
          {clamp(eyebrow, EYEBROW_MAX_CHARS)}
        </div>

        <h1
          style={{
            margin: 0,
            fontFamily: "Kanit, sans-serif",
            fontSize: 36,
            lineHeight: 1.24,
            maxWidth: TEXT_MAX_WIDTH,
            // Thai has no inter-word spaces, so a long run has no break
            // opportunity and satori paints it straight off the panel edge.
            wordBreak: "break-word",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#0f2140",
          }}
        >
          {clamp(title, TITLE_MAX_CHARS)}
        </h1>

        {description ? (
          <p
            style={{
              margin: 0,
              fontSize: 24,
              lineHeight: 1.45,
              maxWidth: TEXT_MAX_WIDTH,
              wordBreak: "break-word",
              color: "#5b6b80",
            }}
          >
            {clamp(description, DESCRIPTION_MAX_CHARS)}
          </p>
        ) : null}

        <div
          style={{
            display: "flex",
            fontSize: 23,
            color: "#9aa5b3",
          }}
        >
          {meta ? `www.sriwanparts.com · ${meta}` : "www.sriwanparts.com"}
        </div>
      </div>
      </div>
    </div>
  );
};

export default OgImageTemplate;
