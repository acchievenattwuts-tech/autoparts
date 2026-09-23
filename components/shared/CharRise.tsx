interface CharRiseProps {
  text: string;
  /** Delay between characters in milliseconds. Default 32ms. */
  stagger?: number;
  /** Initial delay before the first character animates. */
  startDelay?: number;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

const NON_BREAKING_SPACE = "\u00A0";
const MAX_TOTAL_DELAY_MS = 900;

let cachedGraphemeSegmenter: Intl.Segmenter | null | undefined;

const getGraphemeSegmenter = (): Intl.Segmenter | null => {
  if (cachedGraphemeSegmenter !== undefined) return cachedGraphemeSegmenter;
  try {
    cachedGraphemeSegmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter("th", { granularity: "grapheme" })
        : null;
  } catch {
    cachedGraphemeSegmenter = null;
  }
  return cachedGraphemeSegmenter;
};

/**
 * Split text into user-perceived characters (grapheme clusters), or `null`
 * when the runtime has no `Intl.Segmenter`.
 *
 * `Array.from` splits by code point, which tore Thai above/below vowels and
 * tone marks (\u0E34 \u0E35 \u0E38 \u0E39 \u0E48 \u0E49 \u0E4A \u0E4B \u0E47 \u0E4C \u0E33) away from their base consonant into separate
 * inline-block spans \u2014 the browser cannot shape a combining mark across boxes,
 * so e.g. "\u0E19\u0E49\u0E33" or "\u0E17\u0E35\u0E48" rendered with misplaced marks. A grapheme cluster keeps
 * the consonant and its marks in one span.
 */
export const splitGraphemes = (text: string): string[] | null => {
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return null;
  return Array.from(segmenter.segment(text), (part) => part.segment);
};

/**
 * CharRise — character-by-character entrance animation for headlines.
 *
 * - Server Component (zero client JS).
 * - CSS-only animation via `sf-char-rise` keyframes in globals.css.
 * - Caps total stagger time so long strings never feel sluggish.
 * - Falls back instantly (no animation) when user prefers reduced motion.
 * - Each character (grapheme cluster — a Thai consonant together with its
 *   vowel/tone marks) is wrapped in an inline-block span so layout stays intact
 *   while individual characters translate.
 */
const CharRise = ({
  text,
  stagger = 32,
  startDelay = 0,
  className = "",
}: CharRiseProps) => {
  const chars = splitGraphemes(text);

  // No grapheme segmenter: render the text as-is rather than risk splitting
  // combining marks from their base characters. Only the entrance animation is lost.
  if (!chars) {
    return <span className={`inline-block ${className}`}>{text}</span>;
  }

  return (
    <span className={`inline-block ${className}`}>
      {chars.map((char, index) => {
        const delay = Math.min(startDelay + index * stagger, startDelay + MAX_TOTAL_DELAY_MS);
        return (
          <span
            key={`${char}-${index}`}
            className="sf-char-rise"
            style={{ animationDelay: `${delay}ms` }}
          >
            {char === " " ? NON_BREAKING_SPACE : char}
          </span>
        );
      })}
    </span>
  );
};

export default CharRise;
