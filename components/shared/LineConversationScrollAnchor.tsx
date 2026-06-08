"use client";

import { useEffect, useRef } from "react";

type LineConversationScrollAnchorProps = {
  messageCount: number;
};

export default function LineConversationScrollAnchor({ messageCount }: LineConversationScrollAnchorProps) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    anchorRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount]);

  return <div ref={anchorRef} aria-hidden="true" />;
}
