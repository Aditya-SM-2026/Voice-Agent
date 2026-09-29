import type { ChatMessage } from "@/types/voice";
import { formatKnowledge } from "@/lib/knowledge";

// Our own AI platform: an OpenAI-compatible Chat Completions API.
// Credentials live only here, on the server, and never reach the client.
const API_URL = "https://api.ominibot.com/v1/chat/completions";
const MODEL = process.env.VOICE_AGENT_MODEL ?? "ominibot/ominibot-helper";

function buildSystemPrompt(): string {
  return [
    "You are Voice Agent, a friendly, professional voice assistant. Your replies are spoken out loud.",
    "Voice style rules:",
    "- Keep replies short: one to three spoken sentences, answering only what was asked.",
    "- Even when the user asks for full detail or 'every' item, give a brief spoken summary drawn only from the facts, then offer to go deeper on one specific point.",
    "- Use plain conversational language. Never use markdown, bullet points, numbered lists, or emojis.",
    "- Do not repeat or restate the user's question.",
    "- Remember what was said earlier in the conversation; pronouns like 'it' refer to earlier context.",
    "",
    "AJAI is a fictional demo company; ignore any real company you recall with a similar name. The complete and only facts about AJAI:",
    formatKnowledge(),
    "",
    "Answer about AJAI using only the facts above; for anything not listed, say you don't have that information. For questions about anything other than AJAI, answer helpfully and briefly from general knowledge, and if you don't know something, say so plainly.",
  ].join("\n");
}

// The fast model grounds much better when the facts and the exact-name rule
// are repeated right before it answers, so streamChat appends this after the
// client's history on every request.
function buildGroundingNudge(): string {
  return [
    "Reminder: reply in at most three short spoken sentences, no markdown.",
    "The company's name is exactly AJAI — never call it Aequitas AI or any other name, and ignore your memory of any similarly named real company.",
    "The only true AJAI facts:",
    formatKnowledge(),
  ].join("\n");
}

interface PlatformStreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
}

// Calls the platform API with streaming and yields text deltas as they arrive.
// Reasoning tokens arrive on a separate field and are deliberately skipped.
export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const apiKey = process.env.VOICE_AGENT;
  if (!apiKey) {
    throw new Error("Server is missing the VOICE_AGENT API key. Add it to .env and restart the dev server.");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        ...messages,
        { role: "system", content: buildGroundingNudge() },
      ],
      stream: true,
      max_tokens: 300,
      reasoning_effort: "minimal",
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`AI request failed with status ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });

    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice("data: ".length);
      if (payload === "[DONE]") return;
      const chunk = JSON.parse(payload) as PlatformStreamChunk;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}