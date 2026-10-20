"use client";

import { useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent, RefObject } from "react";

/**
 * Dropdowns with a search box focus it on open so desktop users can type at once.
 * On a phone or tablet that focus raises the on-screen keyboard, which covers the
 * list the user only wanted to tap — so a touch or pen tap opens without it.
 */

const COARSE_POINTER_QUERY = "(pointer: coarse)";

export const isTouchInteraction = (interaction: string): boolean =>
  interaction === "touch" || interaction === "pen";

export const shouldFocusSearchOnOpen = (interaction: string): boolean => !isTouchInteraction(interaction);

/**
 * A click with no known pointer type (an iOS tap that lands in the hit slop just
 * outside the element fires no pointerdown) is attributed to the device's primary
 * pointer.
 */
export const resolveOpenInteraction = (pointerType: string, primaryPointerIsCoarse: boolean): string => {
  if (pointerType) return pointerType;
  return primaryPointerIsCoarse ? "touch" : "mouse";
};

const readPrimaryPointerIsCoarse = (): boolean =>
  typeof window !== "undefined" && window.matchMedia(COARSE_POINTER_QUERY).matches;

/**
 * Chrome hands onClick a PointerEvent, but Safari and Firefox pass a plain
 * MouseEvent, so the pointer type is also captured on pointerdown and read back
 * on click.
 *
 * The hook also remembers whether the open dropdown is being used by finger: it
 * was opened by a tap, or its search box was tapped to type. That session decides
 * how the dropdown reacts to the page scrolling (see `useDropdownViewportChange`).
 */
export const useDropdownOpenInteraction = () => {
  const lastPointerTypeRef = useRef("");
  const touchSessionRef = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    lastPointerTypeRef.current = event.pointerType;
  };

  const readClickInteraction = (event: MouseEvent<HTMLElement>): string => {
    const recordedPointerType = lastPointerTypeRef.current;
    lastPointerTypeRef.current = "";
    const nativeEvent = event.nativeEvent;
    const clickPointerType =
      "pointerType" in nativeEvent && typeof nativeEvent.pointerType === "string"
        ? nativeEvent.pointerType
        : "";
    return resolveOpenInteraction(clickPointerType || recordedPointerType, readPrimaryPointerIsCoarse());
  };

  const startSession = (interaction: string): void => {
    touchSessionRef.current = isTouchInteraction(interaction);
  };

  /** A finger on the search box means the on-screen keyboard is about to open. */
  const onSearchPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (isTouchInteraction(event.pointerType)) touchSessionRef.current = true;
  };

  const isTouchSession = (): boolean => touchSessionRef.current;

  return { onPointerDown, readClickInteraction, startSession, onSearchPointerDown, isTouchSession };
};

/** The anchor has left the viewport, so a list pinned to it would float detached. */
export const isRectOutOfViewport = (rect: Pick<DOMRect, "top" | "bottom">, viewportHeight: number): boolean =>
  rect.bottom < 0 || rect.top > viewportHeight;

interface ViewportChangeOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  dropdownRef: RefObject<HTMLElement | null>;
  isTouchSession: () => boolean;
  onFollow: () => void;
  onClose: () => void;
}

/**
 * How an open dropdown answers a page scroll or resize. Scrolling inside the list
 * is ignored. With a mouse the dropdown closes, as it always has. In a touch
 * session the scroll is usually the browser lifting the page above the on-screen
 * keyboard, so the list follows its anchor instead — and closes only once the
 * anchor is off screen.
 */
export const useDropdownViewportChange = ({
  open,
  anchorRef,
  dropdownRef,
  isTouchSession,
  onFollow,
  onClose,
}: ViewportChangeOptions): void => {
  // Callbacks are recreated every render; read the latest ones from a ref so the
  // listeners subscribe once per open instead of on every render.
  const callbacksRef = useRef({ isTouchSession, onFollow, onClose });
  useEffect(() => {
    callbacksRef.current = { isTouchSession, onFollow, onClose };
  });

  useEffect(() => {
    if (!open) return;
    let frameId = 0;
    const handleChange = (event: Event) => {
      const target = event.target;
      // A resize event targets `window`, which is not a Node.
      if (target instanceof Node && dropdownRef.current?.contains(target)) return;
      if (!callbacksRef.current.isTouchSession()) {
        callbacksRef.current.onClose();
        return;
      }
      // Measure once the browser has finished moving the page in this frame.
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect || isRectOutOfViewport(rect, window.innerHeight)) callbacksRef.current.onClose();
        else callbacksRef.current.onFollow();
      });
    };
    window.addEventListener("scroll", handleChange, true);
    window.addEventListener("resize", handleChange);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", handleChange, true);
      window.removeEventListener("resize", handleChange);
    };
  }, [open, anchorRef, dropdownRef]);
};
