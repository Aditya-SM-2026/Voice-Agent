import type { ChatMessage } from "@/types/voice";
import { streamChat } from "@/lib/llm";

// POST /api/chat
// Body: { messages: ChatMessage[] }  (conversation history, client-held)
// Response: text/event-stream with
//   data: {"delta":"..."}   one text chunk
//   data: {"error":"..."}   a user-readable failure
//   data: [DONE]            end of stream

const MAX_MESSAGES = 24;
const MAX_CONTENT_LENGTH = 4000;

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const cleaned: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      cleaned.push({ role, content: content.slice(0, MAX_CONTENT_LENGTH) });
    }
  }
  return cleaned.length > 0 ? cleaned.slice(-MAX_MESSAGES) : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  const messages = parseMessages(body?.messages);
  if (!messages) {
    return Response.json({ error: "Provide a messages array with user or assistant text." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        for await (const delta of streamChat(messages, request.signal)) {
          send({ delta });
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        // Client disconnected (stop / interrupt): nothing to report.
        if (!request.signal.aborted) {
          console.error("[api/chat]", err);
          const message =
            err instanceof Error && err.message.startsWith("Server")
              ? err.message
              : "The AI service could not answer right now. Please try again.";
          send({ error: message });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}