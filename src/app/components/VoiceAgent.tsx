"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type {
  AgentStatus,
  ChatMessage,
  LatencyTimings,
  SpeechRecognitionConstructor,
  SpeechRecognitionLike,
} from "@/types/voice";
import { stripMarkdownForSpeech, takeCompleteSentences, trimHistory } from "@/lib/conversation";
import Status from "./Status";
import Transcript from "./Transcript";

// Latency numbers are a development aid only.
const isDev = process.env.NODE_ENV === "development";

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Prefer the most natural-sounding English voice the browser offers.
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.startsWith("en"));
  return (
    english.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ??
    english.find((v) => /google us english/i.test(v.name)) ??
    english.find((v) => v.lang === "en-US") ??
    english[0] ??
    null
  );
}

function ttsAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

// performance.now() is impure, so all timing calls go through this
// module-scope helper; it is only ever invoked from event handlers.
function nowMs(): number {
  return performance.now();
}

const subscribeNoop = () => () => {};
const getSttSupported = () => getSpeechRecognition() !== null;
const getSttSupportedOnServer = () => true;

export default function VoiceAgent() {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [timings, setTimings] = useState<LatencyTimings | null>(null);
  const [textDraft, setTextDraft] = useState("");

  // SpeechRecognition is browser-only; the server snapshot assumes yes so
  // the prerendered markup matches, then the client corrects after hydration.
  const sttSupported = useSyncExternalStore(subscribeNoop, getSttSupported, getSttSupportedOnServer);

  // Mutable mirrors so recognition/event callbacks never act on stale state.
  const statusRef = useRef<AgentStatus>("idle");
  const activeRef = useRef(false); // the user wants the assistant on
  const busyRef = useRef(false); // a request/response cycle is in progress
  const streamDoneRef = useRef(true);
  const pendingUtterancesRef = useRef(0); // utterances queued in speechSynthesis
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef(""); // incoming streamed text not yet handed to TTS
  const speechStartRef = useRef<number | null>(null);
  const restartsRef = useRef(0);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const setStatusSafe = (next: AgentStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  // Voice list loading (an external-system subscription; ref-only updates).
  useEffect(() => {
    if (!ttsAvailable()) return;
    const loadVoices = () => {
      voiceRef.current = pickVoice(window.speechSynthesis.getVoices());
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // ---------- TTS ----------

  // Called when every queued utterance has finished playing.
  const onSpeechFinished = () => {
    if (!streamDoneRef.current || busyRef.current) return;
    setStatusSafe(activeRef.current ? "listening" : "idle");
    startListening();
  };

  const speakText = (text: string) => {
    if (!ttsAvailable()) return;
    const clean = stripMarkdownForSpeech(text);
    if (!clean) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    if (voiceRef.current) {
      utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current.lang;
    }
    pendingUtterancesRef.current += 1;
    const finish = () => {
      pendingUtterancesRef.current = Math.max(0, pendingUtterancesRef.current - 1);
      if (pendingUtterancesRef.current === 0) onSpeechFinished();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    // speechSynthesis queues utterances in order, so sentence chunks
    // spoken one after another simply play back to back.
    window.speechSynthesis.speak(utterance);
  };

  // ---------- STT ----------

  const startListening = () => {
    if (!activeRef.current || busyRef.current || recognitionRef.current) return;
    const recognition = createRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
  };

  const createRecognition = (): SpeechRecognitionLike | null => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return null;
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      restartsRef.current = 0;
      if (speechStartRef.current === null) speechStartRef.current = nowMs();
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (interimText) {
        if (speechStartRef.current === null) speechStartRef.current = nowMs();
        setInterim(interimText);
      }
      const final = finalText.trim();
      if (final) {
        setInterim("");
        handleUtterance(final);
      }
    };

    recognition.onerror = (event) => {
      const kind = event.error;
      if (kind === "no-speech" || kind === "aborted") return; // harmless; onend restarts
      if (kind === "not-allowed") {
        activeRef.current = false;
        setError("Microphone access was denied. Allow microphone permission in your browser, then try again.");
        setStatusSafe("error");
      } else if (kind === "audio-capture") {
        activeRef.current = false;
        setError("No microphone was found. Connect one, or type your message below.");
        setStatusSafe("error");
      } else if (kind === "network") {
        setError("Speech recognition lost its network connection. Retrying…");
      } else {
        setError("Voice recognition hit a problem. Please try again.");
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setInterim("");
      if (!activeRef.current || busyRef.current) return;
      restartsRef.current += 1;
      if (restartsRef.current > 8) {
        activeRef.current = false;
        setError("Voice recognition keeps stopping. Press the button to try again.");
        setStatusSafe("error");
        return;
      }
      // Chrome ends sessions periodically; a short pause avoids a restart race.
      setTimeout(() => startListening(), 250);
    };

    return recognition;
  };

  // ---------- Conversation ----------

  const handleUtterance = async (text: string) => {
    if (busyRef.current || !text.trim()) return;
    busyRef.current = true;

    // Pause the microphone while thinking and speaking so the agent's own voice
    // is not transcribed back. Barge-in is done via the button / spacebar.
    recognitionRef.current?.stop();

    const sttMs = speechStartRef.current !== null ? Math.round(nowMs() - speechStartRef.current) : null;
    speechStartRef.current = null;
    setError(null);
    setInterim("");
    streamDoneRef.current = false;
    bufferRef.current = "";

    const userMessage: ChatMessage = { role: "user", content: text };
    const history = trimHistory([...messagesRef.current, userMessage]);
    setMessages((prev) => [...prev, userMessage]);
    setTimings({ sttMs, firstTokenMs: null, completeMs: null, ttsStartMs: null });
    setStatusSafe("thinking");

    const abort = new AbortController();
    abortRef.current = abort;
    const sentAt = nowMs();
    let firstTokenSeen = false;
    let ttsStarted = false;
    let fullResponse = "";

    const speakBuffered = (force: boolean) => {
      let chunk = "";
      if (force) {
        chunk = bufferRef.current;
        bufferRef.current = "";
      } else {
        const split = takeCompleteSentences(bufferRef.current);
        if (!split.spoken) return;
        chunk = split.spoken;
        bufferRef.current = split.rest;
      }
      if (!chunk.trim()) return;
      if (!ttsStarted) {
        ttsStarted = true;
        setStatusSafe("speaking");
        setTimings((prev) => (prev ? { ...prev, ttsStartMs: Math.round(nowMs() - sentAt) } : prev));
      }
      speakText(chunk);
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`The assistant service returned an error (${response.status}). Please try again.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let eventBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        eventBuffer += decoder.decode(value, { stream: true });
        const events = eventBuffer.split("\n\n");
        eventBuffer = events.pop() ?? "";
        for (const event of events) {
          const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const payload = dataLine.slice("data: ".length);
          if (payload === "[DONE]") continue;
          const parsed = JSON.parse(payload) as { delta?: string; error?: string };
          if (parsed.error) throw new Error(parsed.error);
          if (!parsed.delta) continue;
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            setTimings((prev) => (prev ? { ...prev, firstTokenMs: Math.round(nowMs() - sentAt) } : prev));
            // Without TTS there are no spoken chunks; stream text visually instead.
            if (!ttsAvailable()) {
              ttsStarted = true;
              setStatusSafe("speaking");
            }
          }
          fullResponse += parsed.delta;
          setDraft(fullResponse);
          bufferRef.current += parsed.delta;
          speakBuffered(false);
        }
      }

      speakBuffered(true);
      streamDoneRef.current = true;
      if (fullResponse) setMessages((prev) => [...prev, { role: "assistant", content: fullResponse }]);
      setDraft("");
      busyRef.current = false;
      setTimings((prev) => (prev ? { ...prev, completeMs: Math.round(nowMs() - sentAt) } : prev));
      onSpeechFinished();
    } catch (err) {
      streamDoneRef.current = true;
      busyRef.current = false;

      if (err instanceof DOMException && err.name === "AbortError") {
        // Stop or barge-in: keep whatever partial answer arrived in the transcript.
        if (fullResponse) setMessages((prev) => [...prev, { role: "assistant", content: fullResponse }]);
        setDraft("");
        bufferRef.current = "";
        pendingUtterancesRef.current = 0;
        setStatusSafe(activeRef.current ? "listening" : "idle");
        startListening();
        return;
      }

      setDraft("");
      bufferRef.current = "";
      pendingUtterancesRef.current = 0;
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatusSafe("error");
    }
  };

  // ---------- Controls ----------

  const start = () => {
    if (!getSpeechRecognition()) {
      setError("This browser doesn't support speech recognition. Use Chrome or Edge, or type your message below.");
      setStatusSafe("error");
      return;
    }
    setError(null);
    activeRef.current = true;
    // An inaudible utterance inside the click gesture unlocks TTS on strict browsers.
    if (ttsAvailable()) {
      const warmup = new SpeechSynthesisUtterance(" ");
      warmup.volume = 0;
      window.speechSynthesis.speak(warmup);
    }
    setStatusSafe("listening");
    speechStartRef.current = nowMs();
    startListening();
  };

  const stop = () => {
    activeRef.current = false;
    busyRef.current = false;
    streamDoneRef.current = true;
    pendingUtterancesRef.current = 0;
    abortRef.current?.abort();
    if (ttsAvailable()) window.speechSynthesis.cancel();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setInterim("");
    setDraft("");
    bufferRef.current = "";
    setStatusSafe("idle");
  };

  // Barge-in: while the agent speaks, cut it off and go back to listening.
  const interrupt = () => {
    if (statusRef.current !== "speaking") return;
    if (ttsAvailable()) window.speechSynthesis.cancel();
    pendingUtterancesRef.current = 0;
    bufferRef.current = "";
    // Aborting the stream is handled in handleUtterance's AbortError branch,
    // which keeps the partial answer and resumes listening.
    abortRef.current?.abort();
  };

  // Keep the latest interrupt available to the always-registered key listener.
  const interruptRef = useRef(interrupt);
  useEffect(() => {
    interruptRef.current = interrupt;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space" && statusRef.current === "speaking") {
        event.preventDefault();
        interruptRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onMicClick = () => {
    if (statusRef.current === "speaking") interrupt();
    else if (statusRef.current === "idle" || statusRef.current === "error") start();
    else stop();
  };

  const submitText = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = textDraft.trim();
    if (!text) return;
    setTextDraft("");
    handleUtterance(text);
  };

  const clearConversation = () => {
    if (busyRef.current) return;
    setMessages([]);
    setTimings(null);
  };

  // ---------- UI ----------

  const micLabel =
    status === "speaking" ? "Interrupt" : status === "listening" || status === "thinking" ? "Stop" : "Start talking";

  const orbClass =
    status === "speaking"
      ? "speaking-orb bg-glow text-ink"
      : status === "listening"
        ? "bg-glow/10 text-glow border border-glow/50"
        : status === "thinking"
          ? "bg-panel text-mist border border-line animate-pulse"
          : status === "error"
            ? "bg-danger/10 text-danger border border-danger/50"
            : "bg-panel text-mist border border-line hover:border-glow/40";

const fmt = (value: number | null) => (value === null ? "—" : `${value}ms`);

  return (
    <div className="flex h-[100dvh] min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      {/* Stage: mic, status and input. Fixed pane — it never scrolls. */}
      <section className="flex min-h-0 flex-col px-6 pb-10 pt-8 lg:w-[440px] lg:shrink-0 lg:border-r lg:border-line/70">
        <header className="text-center">
          <h1 className="text-3xl font-medium tracking-tight text-paper lg:text-4xl">Voice Agent</h1>
          <p className="mt-1.5 text-sm text-mist">Your AI voice assistant</p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 py-10">
          <div className="relative flex h-40 w-40 items-center justify-center">
            {status === "listening" || status === "speaking" ? (
              <span aria-hidden="true" className="absolute inset-2 rounded-full bg-glow/15 blur-2xl" />
            ) : null}
            {status === "listening" ? (
              <>
                <span className="animate-ring absolute inset-0 rounded-full border border-glow/50" />
                <span className="animate-ring absolute inset-0 rounded-full border border-glow/30" style={{ animationDelay: "0.8s" }} />
              </>
            ) : null}
            <button
              type="button"
              onClick={onMicClick}
              aria-label={micLabel}
              title={micLabel}
              className={`relative flex h-28 w-28 items-center justify-center  cursor-pointer rounded-full transition-all duration-300 ${orbClass}`}
            >
              <MicIcon />
            </button>
          </div>
          <Status status={status} error={error} />
          {status === "speaking" ? (
            <p className="text-xs text-mist">Press Space or click the mic to interrupt</p>
          ) : null}
          {isDev && timings ? (
            <p className="font-mono text-xs text-mist">
              STT {fmt(timings.sttMs)} · AI first {fmt(timings.firstTokenMs)} · AI done {fmt(timings.completeMs)} · TTS {fmt(timings.ttsStartMs)}
            </p>
          ) : null}
        </div>

        <form onSubmit={submitText} className="flex gap-2">
          <input
            value={textDraft}
            onChange={(event) => setTextDraft(event.target.value)}
            placeholder="Or type a message…"
            aria-label="Type a message"
            className="flex-1 rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-paper outline-none placeholder:text-mist/70 focus:border-glow/60"
          />
          <button
            type="submit"
            disabled={!textDraft.trim() || status === "thinking" || status === "speaking"}
            className="rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-paper transition-colors hover:border-glow/60 disabled:opacity-40"
          >
            Send
          </button>
        </form>
        {!sttSupported ? (
          <p className="mt-3 text-center text-xs text-mist">Speech recognition isn&apos;t available in this browser — use Chrome or Edge, or type above.</p>
        ) : null}
      </section>

      {/* Transcript: the conversation lives on the right. */}
      <section className="flex min-h-0 flex-1 flex-col px-6 pb-10 pt-6 lg:px-10 lg:py-10">
        <Transcript messages={messages} interim={interim} draft={draft} status={status} onClear={clearConversation} />
      </section>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-8 w-8" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}