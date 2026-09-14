"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/** Disable viewport prefetch for DB-backed destinations, then warm the route as
 * soon as the user points at, touches, or focuses the link. */
const IntentPrefetchLink = ({
  onFocus,
  onPointerDown,
  onPointerEnter,
  ...props
}: IntentPrefetchLinkProps) => {
  const [shouldPrefetch, setShouldPrefetch] = useState(false);

  return (
    <Link
      {...props}
      prefetch={shouldPrefetch}
      onPointerEnter={(event) => {
        setShouldPrefetch(true);
        onPointerEnter?.(event);
      }}
      onPointerDown={(event) => {
        setShouldPrefetch(true);
        onPointerDown?.(event);
      }}
      onFocus={(event) => {
        setShouldPrefetch(true);
        onFocus?.(event);
      }}
    />
  );
};

export default IntentPrefetchLink;
