import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chatCompletionText,
  resolveLlmRequestConfig,
} from "../../packages/agent-core/src/llm-client.js";

function loadKeyConfig() {
  const configPath = join(process.cwd(), "key_config.md");
  const text = readFileSync(configPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = rest.join("=");
  }
}

const probes = [
  {
    label: "structuring.global_triage",
    system: "Return JSON only.",
    user: JSON.stringify({
      summary: "请只返回一个很短的质量诊断 JSON。",
      expected_keys: ["summary", "major_gaps", "recommended_tasks", "suggested_questions"],
    }),
  },
  {
    label: "qa.refine_question",
    system: "Return JSON only.",
    user: JSON.stringify({
      questionSeed: "这里应该如何判断异常？",
      evidence_blocks: [{ block_id: "probe-b1", text_content: "指标下降但缺少判断标准。" }],
    }),
  },
  {
    label: "qa.answer",
    system: "Return JSON only.",
    user: JSON.stringify({
      question: "这里应该如何判断异常？",
      evidence_blocks: [{ block_id: "probe-b1", text_content: "指标下降但缺少判断标准。" }],
    }),
  },
] as const;

async function main() {
  loadKeyConfig();
  for (const probe of probes) {
    const config = resolveLlmRequestConfig({ label: probe.label });
    const startedAt = Date.now();
    try {
      const response = await chatCompletionText({
        label: probe.label,
        system: probe.system,
        user: probe.user,
      });
      console.info("[EBS LLM probe ok]", {
        label: probe.label,
        provider: config.provider,
        model: config.model,
        timeoutMs: config.timeoutMs,
        responseJson: config.responseJson,
        elapsedMs: Date.now() - startedAt,
        responsePreview: response.slice(0, 500),
      });
    } catch (err) {
      console.info("[EBS LLM probe failed]", {
        label: probe.label,
        provider: config.provider,
        model: config.model,
        timeoutMs: config.timeoutMs,
        responseJson: config.responseJson,
        elapsedMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

void main();
