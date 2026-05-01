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
 * - EBS_LLM_TRIAGE_MODEL / EBS_LLM_REFINE_MODEL / EBS_LLM_QA_MODEL — task-specific model overrides
 * - EBS_LLM_TIMEOUT_MS — ms (default 120000)
 * - EBS_LLM_TRIAGE_TIMEOUT_MS / EBS_LLM_REFINE_TIMEOUT_MS / EBS_LLM_QA_TIMEOUT_MS — task-specific timeout overrides
 * - EBS_LLM_TRIAGE_MAX_TOKENS / EBS_LLM_REFINE_MAX_TOKENS / EBS_LLM_QA_MAX_TOKENS — task-specific output budget
 * - EBS_LLM_TEMPERATURE — default 0.2
 * - EBS_LLM_RESPONSE_JSON=1 — set response_format json_object when supported
 * - EBS_LLM_TRIAGE_RESPONSE_JSON / EBS_LLM_REFINE_RESPONSE_JSON / EBS_LLM_QA_RESPONSE_JSON — task-specific JSON mode
 * - DASHSCOPE_API_KEY / DASHSCOPE_MODEL / DASHSCOPE_BASE_URL — DashScope fallback
 */
export type LlmProvider = "deepseek" | "dashscope" | "openai-compatible";

type LlmRoute = "triage" | "refine" | "qa" | "default";

export type LlmRequestConfig = {
  provider: LlmProvider;
  base: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens?: number;
  responseJson: boolean;
  label: string;
  route: LlmRoute;
};

function normalizeOpenAiV1Base(raw: string): string {
  const u = raw.trim().replace(/\/?$/, "");
  return u.endsWith("/v1") ? u : `${u}/v1`;
}

function defaultProvider(): LlmProvider {
  const p = process.env.EBS_LLM_PROVIDER?.trim().toLowerCase();
  if (p === "deepseek" || process.env.EBS_LLM_USE_DEEPSEEK?.trim() === "1") {
    return "deepseek";
  }
  if (p === "dashscope") return "dashscope";
  return "openai-compatible";
}

function routeForLabel(label?: string): LlmRoute {
  if (label === "structuring.global_triage") return "triage";
  if (label === "qa.refine_question") return "refine";
  if (label === "qa.answer") return "qa";
  return "default";
}

function envBool(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw == null || raw === "") return undefined;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return undefined;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function routeEnv(route: LlmRoute, suffix: "MODEL" | "TIMEOUT_MS" | "RESPONSE_JSON") {
  if (route === "triage") return process.env[`EBS_LLM_TRIAGE_${suffix}`];
  if (route === "refine") return process.env[`EBS_LLM_REFINE_${suffix}`];
  if (route === "qa") return process.env[`EBS_LLM_QA_${suffix}`];
  return undefined;
}

function routeNumberEnv(route: LlmRoute, suffix: "MAX_TOKENS"): number | undefined {
  const raw =
    route === "triage"
      ? process.env[`EBS_LLM_TRIAGE_${suffix}`]
      : route === "refine"
        ? process.env[`EBS_LLM_REFINE_${suffix}`]
        : route === "qa"
          ? process.env[`EBS_LLM_QA_${suffix}`]
          : undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveLlmRequestConfig(opts: {
  model?: string;
  timeoutMs?: number;
  label?: string;
  provider?: LlmProvider;
}): LlmRequestConfig {
  let base: string;
  let apiKey: string;
  let defaultModel: string;
  const label = opts.label ?? "chat.completions";
  const route = routeForLabel(label);
  const provider = opts.provider ?? defaultProvider();

  if (provider === "deepseek") {
    const baseRaw =
      process.env.EBS_LLM_API_BASE ??
      process.env.DEEPSEEK_BASE_URL ??
      "https://api.deepseek.com";
    base = normalizeOpenAiV1Base(baseRaw);
    apiKey =
      process.env.EBS_LLM_API_KEY ??
      process.env.DEEPSEEK_API_KEY ??
      "";
    defaultModel =
      process.env.EBS_LLM_MODEL ??
      process.env.DEEPSEEK_MODEL ??
      "deepseek-chat";
  } else if (provider === "dashscope") {
    const baseRaw =
      process.env.DASHSCOPE_BASE_URL ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1";
    base = normalizeOpenAiV1Base(baseRaw);
    apiKey = process.env.DASHSCOPE_API_KEY ?? "";
    defaultModel = process.env.DASHSCOPE_MODEL ?? "qwen-plus";
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
    defaultModel =
      process.env.EBS_LLM_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-4o-mini";
  }

  const defaultTimeoutMs = positiveNumber(process.env.EBS_LLM_TIMEOUT_MS, 120_000);
  return {
    provider,
    base,
    apiKey,
    model: opts.model ?? routeEnv(route, "MODEL") ?? defaultModel,
    timeoutMs:
      opts.timeoutMs ??
      positiveNumber(routeEnv(route, "TIMEOUT_MS"), defaultTimeoutMs),
    maxTokens: routeNumberEnv(route, "MAX_TOKENS"),
    responseJson:
      envBool(`EBS_LLM_${route === "default" ? "" : `${route.toUpperCase()}_`}RESPONSE_JSON`) ??
      envBool("EBS_LLM_RESPONSE_JSON") ??
      false,
    label,
    route,
  };
}

export async function chatCompletionText(opts: {
  system: string;
  user: string;
  model?: string;
  timeoutMs?: number;
  label?: string;
  provider?: LlmProvider;
  promptDiagnostics?: Record<string, unknown>;
}): Promise<string> {
  const config = resolveLlmRequestConfig(opts);
  const url = `${config.base}/chat/completions`;
  const startedAt = Date.now();
  const endpoint = new URL(url).origin;
  const responsePreviewChars = Number(
    process.env.EBS_LLM_LOG_RESPONSE_CHARS ?? 4000,
  );

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: Number(process.env.EBS_LLM_TEMPERATURE ?? 0.2),
  };
  if (config.responseJson) {
    body.response_format = { type: "json_object" };
  }
  if (config.maxTokens != null) {
    body.max_tokens = config.maxTokens;
  }

  console.info("[EBS LLM request]", {
    label: config.label,
    provider: config.provider,
    route: config.route,
    model: config.model,
    endpoint,
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    systemPromptChars: opts.system.length,
    userPromptChars: opts.user.length,
    promptDiagnostics: opts.promptDiagnostics,
    responseJson: config.responseJson,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    console.info("[EBS LLM error]", {
      label: config.label,
      provider: config.provider,
      model: config.model,
      elapsedMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text();
    console.info("[EBS LLM http_error]", {
      label: config.label,
      provider: config.provider,
      model: config.model,
      status: res.status,
      elapsedMs: Date.now() - startedAt,
      responsePreview: errText.slice(0, responsePreviewChars),
    });
    throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 2000)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (content == null || content === "") {
    console.info("[EBS LLM empty_response]", {
      label: config.label,
      provider: config.provider,
      model: config.model,
      elapsedMs: Date.now() - startedAt,
    });
    throw new Error("LLM returned empty message content");
  }
  console.info("[EBS LLM response]", {
    label: config.label,
    provider: config.provider,
    model: config.model,
    status: res.status,
    elapsedMs: Date.now() - startedAt,
    contentLength: content.length,
    responsePreview: content.slice(0, responsePreviewChars),
  });
  return content;
}
