import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PlannerProfile } from "../types.js";

export type KeyConfig = Record<string, string>;

export type PlannerProviderConfig = {
  provider: Exclude<PlannerProfile, "baseline">;
  base: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  safeSummary: {
    provider: Exclude<PlannerProfile, "baseline">;
    baseHost: string;
    model: string;
    timeoutMs: number;
    hasApiKey: boolean;
  };
};

export function parseKeyConfig(content: string): KeyConfig {
  const out: KeyConfig = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function loadKeyConfig(path = resolve(process.cwd(), "key_config.md")): KeyConfig {
  if (!existsSync(path)) return {};
  return parseKeyConfig(readFileSync(path, "utf8"));
}

function envOrConfig(input: {
  env: Record<string, string | undefined>;
  keyConfig: KeyConfig;
  key: string;
  fallback?: string;
}): string {
  return input.env[input.key] ?? input.keyConfig[input.key] ?? input.fallback ?? "";
}

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

function normalizeOpenAiV1Base(raw: string): string {
  const trimmed = raw.trim().replace(/\/?$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function resolvePlannerProviderConfig(input: {
  provider: Exclude<PlannerProfile, "baseline">;
  keyConfig?: KeyConfig;
  env?: Record<string, string | undefined>;
}): PlannerProviderConfig {
  const env = input.env ?? process.env;
  const keyConfig = input.keyConfig ?? loadKeyConfig();
  const provider = input.provider;
  const base =
    provider === "deepseek"
      ? normalizeOpenAiV1Base(
          envOrConfig({
            env,
            keyConfig,
            key: "DEEPSEEK_BASE_URL",
            fallback: "https://api.deepseek.com",
          }),
        )
      : normalizeOpenAiV1Base(
          envOrConfig({
            env,
            keyConfig,
            key: "DASHSCOPE_BASE_URL",
            fallback: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          }),
        );
  const apiKey =
    provider === "deepseek"
      ? envOrConfig({ env, keyConfig, key: "DEEPSEEK_API_KEY" })
      : envOrConfig({ env, keyConfig, key: "DASHSCOPE_API_KEY" });
  const model =
    provider === "deepseek"
      ? envOrConfig({
          env,
          keyConfig,
          key: "EBS_LLM_PLANNER_MODEL",
          fallback: envOrConfig({
            env,
            keyConfig,
            key: "EBS_LLM_TRIAGE_MODEL",
            fallback: envOrConfig({ env, keyConfig, key: "DEEPSEEK_MODEL", fallback: "deepseek-chat" }),
          }),
        })
      : envOrConfig({
          env,
          keyConfig,
          key: "EBS_LLM_PLANNER_QWEN_MODEL",
          fallback: envOrConfig({ env, keyConfig, key: "DASHSCOPE_MODEL", fallback: "qwen-plus" }),
        });
  const timeoutMs = Number(
    envOrConfig({
      env,
      keyConfig,
      key: "EBS_LLM_PLANNER_TIMEOUT_MS",
      fallback: "60000",
    }),
  );
  return {
    provider,
    base,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    safeSummary: {
      provider,
      baseHost: hostOf(base),
      model,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
      hasApiKey: Boolean(apiKey),
    },
  };
}
