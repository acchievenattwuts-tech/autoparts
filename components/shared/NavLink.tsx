"use client";

/**
 * Client-side navigation link with an immediate pending state.
 *
 * Use this in place of <Link> whenever the click triggers a *full route change*
 * that the user should see feedback for (filter pill removal, "clear filters",
 * etc.). For form submits use AdminSearchForm + AdminSearchSubmitButton instead.
 *
 * The element renders as a <button> so it can show a spinner while the
 * transition is pending, but it behaves like a link (no form submission).
 */

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode, type MouseEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  href: string;
  children: ReactNode;
  className?: string;
  /** Hide the spinner (e.g. for icon-only buttons where the icon is fine). */
  hideSpinner?: boolean;
  /** Replace the original icon while pending instead of appending the spinner. */
  pendingChildren?: ReactNode;
  ariaLabel?: string;
};

const NavLink = ({ href, children, className, hideSpinner, pendingChildren, ariaLabel }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    startTransition(() => {
      router.push(href);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={ariaLabel}
      className={cn(
        "disabled:cursor-wait disabled:opacity-80",
        className,
      )}
    >
      {isPending && pendingChildren !== undefined
        ? pendingChildren
        : (
          <>
            {isPending && !hideSpinner && (
              <LoaderCircle size={12} className="animate-spin" />
            )}
            {children}
          </>
        )}
    </button>
  );
};

export default NavLink;
