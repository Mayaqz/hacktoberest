import { env } from "../config.ts";

// Gemma 4 through an OpenAI-compatible Chat Completions endpoint: Ollama
// (http://localhost:11434/v1), a DigitalOcean GPU Droplet running vLLM/Ollama,
// or a hosted endpoint that serves Gemma. Every caller has a non-AI fallback,
// so the product keeps working when the model is offline.

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
};

const headers = () => ({
  "Content-Type": "application/json",
  ...(env.LLM_API_KEY ? { Authorization: `Bearer ${env.LLM_API_KEY}` } : {}),
});

const baseUrl = () => env.LLM_BASE_URL.replace(/\/+$/, "");

export const chat = async (messages: ChatMessage[], { json = false, maxTokens = 400 } = {}) => {
  if (!env.LLM_ENABLED) throw new Error("LLM disabled");

  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const data = (await response.json()) as ChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("LLM returned no content");
  return content;
};

/** Parses the first JSON object in a model reply (models sometimes wrap it in prose). */
export const extractJson = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in LLM reply");
  return JSON.parse(text.slice(start, end + 1));
};

let statusCache: { at: number; value: LlmStatus } | undefined;

export type LlmStatus = { enabled: boolean; reachable: boolean; model: string; modelFound: boolean };

/** Whether the endpoint answers and lists the configured model (cached 30 s). */
export const llmStatus = async (): Promise<LlmStatus> => {
  if (statusCache && Date.now() - statusCache.at < 30_000) return statusCache.value;

  const value: LlmStatus = {
    enabled: env.LLM_ENABLED,
    reachable: false,
    model: env.LLM_MODEL,
    modelFound: false,
  };

  if (env.LLM_ENABLED) {
    try {
      const response = await fetch(`${baseUrl()}/models`, {
        headers: headers(),
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        value.reachable = true;
        const data = (await response.json()) as { data?: { id?: string }[] };
        const ids = (data.data ?? []).map((m) => m.id ?? "");
        // Ollama resolves "gemma4" to "gemma4:latest"; other tags must be named exactly.
        value.modelFound = ids.some((id) => id === env.LLM_MODEL || id === `${env.LLM_MODEL}:latest`);
      }
    } catch {
      // unreachable: keep defaults
    }
  }

  statusCache = { at: Date.now(), value };
  return value;
};
