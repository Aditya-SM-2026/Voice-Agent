"use client";

import { useEffect, useRef } from "react";
import type { AgentStatus, ChatMessage } from "@/types/voice";

interface TranscriptProps {
  messages: ChatMessage[];
  interim: string;
  draft: string;
  status: AgentStatus;
  onClear: () => void;
}

// The right-hand conversation panel. It mirrors the pipeline live:
// dashed bubble = speech being recognized, caret = AI text still streaming,
// equalizer bars = the voice is actually speaking right now.
export default function Transcript({ messages, interim, draft, status, onClear }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, interim, draft]);

  const busy = status === "thinking" || status === "speaking";
  const hasContent = messages.length > 0 || interim.length > 0 || draft.length > 0;

  // While speaking after the stream has finished, the bars attach to the
  // final assistant message instead of the (now empty) draft row.
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-mist">Conversation</h2>
        <button
          type="button"
          onClick={onClear}
          disabled={busy || messages.length === 0}
          className="rounded-full border border-line px-3 py-1 text-xs text-mist transition-colors hover:border-glow/50 hover:text-paper disabled:pointer-events-none disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div
        ref={scrollRef}
        className="scroll-panel min-h-24 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-line bg-panel/50 p-4"
      >
        {!hasContent ? (
          <p className="text-sm leading-relaxed text-mist">Start talking and the conversation will appear here.</p>
        ) : null}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <UserRow key={index} text={message.content} />
          ) : (
            <AgentRow
              key={index}
              text={message.content}
              streaming={false}
              speaking={status === "speaking" && !draft && index === lastAssistantIndex}
            />
          ),
        )}
        {draft ? <AgentRow text={draft} streaming speaking={status === "speaking"} /> : null}
        {interim ? <UserRow text={interim} muted /> : null}
      </div>
    </section>
  );
}

function UserRow({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={
          muted
            ? "animate-pulse max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-mist/40 px-4 py-2.5 text-sm italic text-mist"
            : "max-w-[85%] rounded-2xl rounded-br-md border border-line bg-panel px-4 py-2.5 text-sm leading-relaxed text-paper/90"
        }
      >
        {text}
      </div>
    </div>
  );
}

function AgentRow({ text, streaming, speaking }: { text: string; streaming: boolean; speaking: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-glow">Voice Agent</span>
        {speaking ? <Equalizer /> : null}
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-line bg-panel/70 px-4 py-2.5 text-sm leading-relaxed text-paper">
        {text}
        {streaming ? <span className="caret" aria-hidden="true" /> : null}
      </div>
    </div>
  );
}

function Equalizer() {
  return (
    <span className="eq flex items-end gap-0.5" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}