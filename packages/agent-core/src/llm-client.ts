/**
 * OpenAI-compatible Chat Completions client for LiteLLM Proxy or direct providers.
 *
 * Env:
 * - EBS_LLM_PROVIDER=deepseek or EBS_LLM_USE_DEEPSEEK=1 — use DEEPSEEK_* (and optional EBS_LLM_* overrides)
 * - DEEPSEEK_BASE_URL — host; `/v1` appended when missing (default https://api.deepseek.com)
 * - DEEPSEEK_API_KEY / DEEPSEEK_MODEL
 * - EBS_LLM_API_BASE / LITELLM_API_BASE / OPENAI_API_BASE / OPENAI_BASE_URL — base including `/v1` when not in DeepSeek mode
 * - EBS_LLM_API_KEY / LITELLM_API_KEY / OPENAI_API_KEY
 * - EBS_LLM_MODEL / OPENAI_MODEL — model id (default gpt-4o-mini or deepseek-chat in DeepSeek mode)
 * - EBS_LLM_TIMEOUT_MS — ms (default 120000)
 * - EBS_LLM_TEMPERATURE — default 0.2
 * - EBS_LLM_RESPONSE_JSON=1 — set response_format json_object when supported
 */
function normalizeOpenAiV1Base(raw: string): string {
  const u = raw.trim().replace(/\/?$/, "");
  return u.endsWith("/v1") ? u : `${u}/v1`;
}

function useDeepSeekProvider(): boolean {
  const p = process.env.EBS_LLM_PROVIDER?.trim().toLowerCase();
  return p === "deepseek" || process.env.EBS_LLM_USE_DEEPSEEK?.trim() === "1";
}

export async function chatCompletionText(opts: {
  system: string;
  user: string;
  model?: string;
  timeoutMs?: number;
}): Promise<string> {
  let base: string;
  let apiKey: string;
  let model: string;

  if (useDeepSeekProvider()) {
    const baseRaw =
      process.env.EBS_LLM_API_BASE ??
      process.env.DEEPSEEK_BASE_URL ??
      "https://api.deepseek.com";
    base = normalizeOpenAiV1Base(baseRaw);
    apiKey =
      process.env.EBS_LLM_API_KEY ??
      process.env.DEEPSEEK_API_KEY ??
      "";
    model =
      opts.model ??
      process.env.EBS_LLM_MODEL ??
      process.env.DEEPSEEK_MODEL ??
      "deepseek-chat";
  } else {
    const baseRaw =
      process.env.EBS_LLM_API_BASE ??
      process.env.LITELLM_API_BASE ??
      process.env.OPENAI_API_BASE ??
      process.env.OPENAI_BASE_URL ??
      "http://127.0.0.1:4000/v1";
    base = normalizeOpenAiV1Base(baseRaw);
    apiKey =
      process.env.EBS_LLM_API_KEY ??
      process.env.LITELLM_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "";
    model =
      opts.model ??
      process.env.EBS_LLM_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-4o-mini";
  }

  const timeoutMs =
    opts.timeoutMs ??
    Number(process.env.EBS_LLM_TIMEOUT_MS ?? 120_000);
  const url = `${base}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: Number(process.env.EBS_LLM_TEMPERATURE ?? 0.2),
  };
  if (process.env.EBS_LLM_RESPONSE_JSON?.trim() === "1") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 2000)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (content == null || content === "") {
    throw new Error("LLM returned empty message content");
  }
  return content;
}
