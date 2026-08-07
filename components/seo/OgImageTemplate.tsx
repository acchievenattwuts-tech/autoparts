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
const CARD_PADDING_X = 90;
const LOGO_SIZE = 330;
// Satori does not constrain a text node to its flex parent's content box, so an
// unbreakable Thai run keeps painting past the card edge unless the node itself
// carries an explicit max width.
const TEXT_MAX_WIDTH = CARD_WIDTH - CARD_PADDING_X * 2;

// Real product and category names run far longer than the card can show (e.g.
// "Resistor DMAX 2003-19' /mu-7/Almera(แอร์ธรรมดา) /March (แอร์ธรรมดา) STAL
// STR-1008"). Satori does not clamp overflowing text — it just paints past the
// edge — so the strings are trimmed before layout.
const TITLE_MAX_CHARS = 64;
const META_MAX_CHARS = 46;

const clamp = (value: string, maxChars: number): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 1).trimEnd()}…`
    : normalized;
};

/**
 * The shared share-preview card: logo centred, page title beneath it.
 *
 * Facebook renders link previews in comments as a small square thumbnail, which
 * shrinks the whole 1200x630 card until side-by-side text is unreadable. A
 * logo-forward card survives that downscale, so `eyebrow` and `description` are
 * accepted (call sites still pass them, and they remain the page's og:title /
 * og:description text) but are deliberately not drawn. `meta` rides along on
 * the domain line, where it costs no visual weight.
 */
const OgImageTemplate = ({ title, meta }: OgImageTemplateProps) => {
  const logoSrc = getOgLogoDataUri();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26,
        padding: `0 ${CARD_PADDING_X}px`,
        background: "#ffffff",
        fontFamily: "Sarabun, sans-serif",
      }}
    >
      {logoSrc ? (
        // Satori renders this tree to a PNG at the edge — it implements a small
        // subset of HTML/CSS and has no React runtime, so next/image (which
        // needs the browser and the /_next/image optimizer) cannot work here.
        // A raw <img> with an explicit width/height is the required form.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} width={LOGO_SIZE} height={LOGO_SIZE} alt="" />
      ) : null}

      <div
        style={{
          display: "flex",
          fontFamily: "Kanit, sans-serif",
          fontSize: 52,
          lineHeight: 1.2,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          textAlign: "center",
          maxWidth: TEXT_MAX_WIDTH,
          // Thai has no inter-word spaces, so a long run has no break
          // opportunity and satori paints it straight off the card edge.
          wordBreak: "break-word",
          color: "#0f2140",
        }}
      >
        {clamp(title, TITLE_MAX_CHARS)}
      </div>

      <div
        style={{
          display: "flex",
          fontSize: 30,
          maxWidth: TEXT_MAX_WIDTH,
          color: "#7b8798",
        }}
      >
        {meta
          ? `www.sriwanparts.com · ${clamp(meta, META_MAX_CHARS)}`
          : "www.sriwanparts.com"}
      </div>
    </div>
  );
};

export default OgImageTemplate;
