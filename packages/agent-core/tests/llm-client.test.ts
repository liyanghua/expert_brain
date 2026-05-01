import { afterEach, describe, expect, it } from "vitest";
import { resolveLlmRequestConfig } from "../src/llm-client.js";

describe("resolveLlmRequestConfig", () => {
  afterEach(() => {
    delete process.env.EBS_LLM_PROVIDER;
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.EBS_LLM_MODEL;
    delete process.env.EBS_LLM_TIMEOUT_MS;
    delete process.env.EBS_LLM_RESPONSE_JSON;
    delete process.env.EBS_LLM_TRIAGE_MODEL;
    delete process.env.EBS_LLM_TRIAGE_TIMEOUT_MS;
    delete process.env.EBS_LLM_TRIAGE_RESPONSE_JSON;
    delete process.env.EBS_LLM_TRIAGE_MAX_TOKENS;
    delete process.env.EBS_LLM_REFINE_MODEL;
    delete process.env.EBS_LLM_REFINE_TIMEOUT_MS;
    delete process.env.EBS_LLM_REFINE_RESPONSE_JSON;
    delete process.env.EBS_LLM_QA_MODEL;
    delete process.env.EBS_LLM_QA_TIMEOUT_MS;
    delete process.env.EBS_LLM_QA_RESPONSE_JSON;
  });

  it("uses route-specific model, timeout and json config for global triage", () => {
    process.env.EBS_LLM_PROVIDER = "deepseek";
    process.env.EBS_LLM_MODEL = "deepseek-v4-pro";
    process.env.EBS_LLM_RESPONSE_JSON = "1";
    process.env.EBS_LLM_TRIAGE_MODEL = "deepseek-v4-flash";
    process.env.EBS_LLM_TRIAGE_TIMEOUT_MS = "15000";
    process.env.EBS_LLM_TRIAGE_RESPONSE_JSON = "0";
    process.env.EBS_LLM_TRIAGE_MAX_TOKENS = "500";

    const config = resolveLlmRequestConfig({
      label: "structuring.global_triage",
    });

    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-v4-flash");
    expect(config.timeoutMs).toBe(15000);
    expect(config.responseJson).toBe(false);
    expect(config.maxTokens).toBe(500);
  });

  it("uses separate route config for question refinement and QA answer", () => {
    process.env.EBS_LLM_PROVIDER = "deepseek";
    process.env.EBS_LLM_MODEL = "deepseek-v4-pro";
    process.env.EBS_LLM_REFINE_MODEL = "deepseek-v4-flash";
    process.env.EBS_LLM_REFINE_TIMEOUT_MS = "12000";
    process.env.EBS_LLM_QA_MODEL = "deepseek-v4-flash";
    process.env.EBS_LLM_QA_TIMEOUT_MS = "20000";

    expect(
      resolveLlmRequestConfig({ label: "qa.refine_question" }),
    ).toEqual(expect.objectContaining({
      model: "deepseek-v4-flash",
      timeoutMs: 12000,
    }));
    expect(resolveLlmRequestConfig({ label: "qa.answer" })).toEqual(
      expect.objectContaining({
        model: "deepseek-v4-flash",
        timeoutMs: 20000,
      }),
    );
  });
});
