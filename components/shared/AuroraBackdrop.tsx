interface Blob {
  color: string;
  /** Inline Tailwind positioning classes (e.g. "-left-32 -top-32"). */
  position: string;
  /** Tailwind width/height classes (e.g. "h-[420px] w-[420px]"). */
  size: string;
  /** 0 – 100 opacity percent. */
  opacity?: number;
  /** Use the alternate (reverse / slower) animation variant. */
  alt?: boolean;
}

interface AuroraBackdropProps {
  blobs?: Blob[];
  className?: string;
}

const DEFAULT_BLOBS: Blob[] = [
  {
    color: "#4d6fba",
    position: "-left-32 -top-32",
    size: "h-[420px] w-[420px] sm:h-[520px] sm:w-[520px]",
    opacity: 30,
  },
  {
    color: "#f97316",
    position: "-right-24 top-24",
    size: "h-[360px] w-[360px] sm:h-[480px] sm:w-[480px]",
    opacity: 22,
    alt: true,
  },
];

/**
 * AuroraBackdrop — ambient animated gradient blobs.
 *
 * - Server Component (zero client JS).
 * - Purely decorative: `aria-hidden`, `pointer-events-none`.
 * - Blob sizes tuned for mobile (smaller default → larger on `sm:`).
 * - Animations + blur are disabled automatically via the `.sf-aurora-blob`
 *   rules in globals.css for users with `prefers-reduced-motion: reduce`.
 */
const AuroraBackdrop = ({ blobs = DEFAULT_BLOBS, className = "" }: AuroraBackdropProps) => (
  <div
    aria-hidden="true"
    className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
  >
    {blobs.map((blob, index) => (
      <div
        key={index}
        className={`sf-aurora-blob${blob.alt ? " sf-aurora-blob--alt" : ""} absolute rounded-full blur-3xl ${blob.position} ${blob.size}`}
        style={{
          background: `radial-gradient(circle, ${blob.color} 0%, transparent 62%)`,
          opacity: (blob.opacity ?? 30) / 100,
        }}
      />
    ))}
  </div>
);

export default AuroraBackdrop;
