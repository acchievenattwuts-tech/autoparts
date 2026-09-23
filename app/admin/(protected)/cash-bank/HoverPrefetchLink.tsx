"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type HoverPrefetchLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/**
 * For long per-row link lists (ledger / payout tables): no viewport prefetch, so
 * scrolling hundreds of rows does not fire one prefetch request per row. When the
 * user points at, touches or focuses the link it switches back to the default
 * (auto) prefetch — the same partial prefetch a plain <Link> would have done —
 * so opening a document feels the same as before.
 */
const HoverPrefetchLink = ({
  onFocus,
  onPointerDown,
  onPointerEnter,
  ...props
}: HoverPrefetchLinkProps) => {
  const [intent, setIntent] = useState(false);

  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onPointerEnter={(event) => {
        setIntent(true);
        onPointerEnter?.(event);
      }}
      onPointerDown={(event) => {
        setIntent(true);
        onPointerDown?.(event);
      }}
      onFocus={(event) => {
        setIntent(true);
        onFocus?.(event);
      }}
    />
  );
};

export default HoverPrefetchLink;
