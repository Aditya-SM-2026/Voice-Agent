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

export default function Status({ status, error }: { status: AgentStatus; error: string | null }) {
  return (
    <div aria-live="polite" className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-2 text-sm text-mist">
        <span className={`h-2 w-2 rounded-full ${DOTS[status]}`} />
        <span>{LABELS[status]}</span>
      </div>
      {error ? <p className="max-w-sm text-center text-sm leading-snug text-danger">{error}</p> : null}
    </div>
  );
}