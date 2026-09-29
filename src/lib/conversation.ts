import type { ChatMessage } from "@/types/voice";

// Keep the prompt small: only the most recent turns are sent to the model.
export const MAX_HISTORY_MESSAGES = 12;

export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

// TTS should read plain sentences, not markdown symbols.
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[#*_>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Splits every complete sentence off the front of a growing text buffer,
// so TTS can start speaking before the whole response has arrived.
export function takeCompleteSentences(buffer: string): { spoken: string; rest: string } {
  const match = buffer.match(/^[\s\S]*[.!?…](\s|$)/);
  if (!match) return { spoken: "", rest: buffer };
  const spoken = buffer.slice(0, match[0].length).trim();
  return { spoken, rest: buffer.slice(match[0].length) };
}