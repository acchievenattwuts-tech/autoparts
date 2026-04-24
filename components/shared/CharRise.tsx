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

/**
 * CharRise — character-by-character entrance animation for headlines.
 *
 * - Server Component (zero client JS).
 * - CSS-only animation via `sf-char-rise` keyframes in globals.css.
 * - Caps total stagger time so long strings never feel sluggish.
 * - Falls back instantly (no animation) when user prefers reduced motion.
 * - Each character is wrapped in an inline-block span so layout stays intact
 *   while individual characters translate.
 */
const CharRise = ({
  text,
  stagger = 32,
  startDelay = 0,
  className = "",
}: CharRiseProps) => {
  const chars = Array.from(text);

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
