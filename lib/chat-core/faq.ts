import {
  answerFromKnowledgeRag,
  type KnowledgeChatChannel,
  type KnowledgeCitation,
} from "@/lib/chat-core/knowledge-rag";

export type ChatFaqAnswer = {
  answered: boolean;
  reply: string;
  citations?: KnowledgeCitation[];
};

/**
 * Compatibility boundary used by both chat processors. General FAQ answers now
 * come from the separately indexed, approved Knowledge RAG corpus; product
 * search does not call this function and keeps its existing embedding model.
 */
export async function answerFromChatFaq(input: {
  text?: string | null;
  channel?: KnowledgeChatChannel;
}): Promise<ChatFaqAnswer> {
  const result = await answerFromKnowledgeRag({ text: input.text, channel: input.channel ?? "line" });
  return result.answered
    ? { answered: true, reply: result.reply, citations: result.citations }
    : { answered: false, reply: "" };
}
