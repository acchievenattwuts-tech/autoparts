"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  /** Stagger delay in milliseconds (e.g. `index * 60`). Capped at 600ms internally. */
  delay?: number;
  /** Optional className merged with the wrapper (e.g. grid cell classes). */
  className?: string;
}

const REVEAL_DELAY_CAP_MS = 600;

/**
 * ScrollReveal — lightweight entrance animation helper.
 *
 * - Uses a single IntersectionObserver per instance, and unobserves the
 *   element immediately after the first reveal (no ongoing work).
 * - Respects `prefers-reduced-motion`: the element renders in its final state
 *   with no animation when the user opts out.
 * - Pure CSS transition (opacity + transform) so the main thread is free.
 * - Works with Server Components as children (this is the only client boundary).
 */
const ScrollReveal = ({ children, delay = 0, className = "" }: ScrollRevealProps) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect user's reduced-motion preference.
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      el.dataset.revealed = "true";
      return;
    }

    // Already in view on mount (e.g. above-the-fold content) → reveal immediately
    // so SSR users never see the pre-reveal state.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.style.transitionDelay = `${Math.min(delay, REVEAL_DELAY_CAP_MS)}ms`;
      el.dataset.revealed = "true";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.style.transitionDelay = `${Math.min(delay, REVEAL_DELAY_CAP_MS)}ms`;
            el.dataset.revealed = "true";
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      data-revealed="false"
      className={`translate-y-5 opacity-0 transition-all duration-700 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none data-[revealed=true]:translate-y-0 data-[revealed=true]:opacity-100 ${className}`}
    >
      {children}
    </div>
  );
};

export default ScrollReveal;
