"use client";

import { useEffect, useRef } from "react";

type LineConversationScrollAnchorProps = {
  messageCount: number;
};

export default function LineConversationScrollAnchor({ messageCount }: LineConversationScrollAnchorProps) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const findScrollParent = () => {
      let current: HTMLElement | null = anchor.parentElement;
      while (current) {
        if (current.scrollHeight > current.clientHeight) return current;
        current = current.parentElement;
      }
      return document.scrollingElement;
    };

    const scrollToLatest = () => {
      const scrollParent = findScrollParent();
      if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight;
    };

    scrollToLatest();
    const frame = window.requestAnimationFrame(scrollToLatest);
    const shortDelay = window.setTimeout(scrollToLatest, 120);
    const imageDelay = window.setTimeout(scrollToLatest, 600);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(shortDelay);
      window.clearTimeout(imageDelay);
    };
  }, [messageCount]);

  return <div ref={anchorRef} aria-hidden="true" />;
}
