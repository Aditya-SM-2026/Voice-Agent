"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types/voice";

interface TranscriptProps {
  messages: ChatMessage[];
  interim: string;
  draft: string;
}

// Shows the conversation so far, plus the live user transcript (interim)
// and the assistant reply while it is still streaming (draft).
export default function Transcript({ messages, interim, draft }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, interim, draft]);

  const hasContent = messages.length > 0 || interim.length > 0 || draft.length > 0;

  return (
    <section className="w-full">
      <h2 className="mb-3 text-sm font-medium text-mist">Conversation</h2>
      <div
        ref={scrollRef}
        className="scroll-panel max-h-80 min-h-24 space-y-4 overflow-y-auto rounded-2xl border border-line bg-panel/60 p-4"
      >
        {!hasContent ? (
          <p className="text-sm leading-relaxed text-mist">Start talking and the conversation will appear here.</p>
        ) : null}
        {messages.map((message, index) => (
          <Row key={index} role={message.role} text={message.content} />
        ))}
        {draft ? <Row role="assistant" text={draft} /> : null}
        {interim ? <Row role="user" text={interim} muted /> : null}
      </div>
    </section>
  );
}

function Row({ role, text, muted = false }: { role: "user" | "assistant"; text: string; muted?: boolean }) {
  const isUser = role === "user";
  const labelClass = isUser ? "text-mist" : "text-glow";
  const textClass = muted ? "italic text-mist" : isUser ? "text-paper/90" : "text-paper";
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-xs font-medium ${labelClass}`}>{isUser ? "You" : "Voice Agent"}</span>
      <p className={`text-sm leading-relaxed ${textClass}`}>{text}</p>
    </div>
  );
}