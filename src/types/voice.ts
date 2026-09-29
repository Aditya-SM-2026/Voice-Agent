// Shared types for the voice pipeline (STT -> LLM -> TTS).

export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export type AgentStatus = "idle" | "listening" | "thinking" | "speaking" | "error";

// Latency measurements for one exchange, in milliseconds (null = not measured).
export interface LatencyTimings {
  sttMs: number | null;
  firstTokenMs: number | null;
  completeMs: number | null;
  ttsStartMs: number | null;
}

// The DOM lib has no types for the (webkit-prefixed) SpeechRecognition API,
// so here is a minimal version of what we use.
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  error: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;