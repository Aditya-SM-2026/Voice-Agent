import type { AgentStatus } from "@/types/voice";

const LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Error",
};

const DOTS: Record<AgentStatus, string> = {
  idle: "bg-mist/60",
  listening: "bg-glow animate-pulse",
  thinking: "bg-paper animate-pulse",
  speaking: "bg-glow",
  error: "bg-danger",
};

const CHIPS: Record<AgentStatus, string> = {
  idle: "border-line text-mist",
  listening: "border-glow/40 text-glow",
  thinking: "border-line text-paper",
  speaking: "border-glow/40 text-glow",
  error: "border-danger/40 text-danger",
};

export default function Status({ status, error }: { status: AgentStatus; error: string | null }) {
  return (
    <div aria-live="polite" className="flex flex-col items-center gap-2">
      <div
        className={`flex items-center gap-2 rounded-full border bg-panel/70 px-3.5 py-1.5 text-xs font-medium ${CHIPS[status]}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${DOTS[status]}`} />
        <span>{LABELS[status]}</span>
      </div>
      {error ? <p className="max-w-xs text-center text-sm leading-snug text-danger">{error}</p> : null}
    </div>
  );
}