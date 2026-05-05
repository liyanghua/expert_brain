import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePlannerProviderConfig } from "../tools/key-config.js";
import type { DocumentIR, DocumentSynthesis } from "../types.js";
import type { ReviewExpertSummaryArtifact, ReviewWorkbenchPayload } from "./review-contract.js";

export type ExpertSummaryCompletion = (input: {
  system: string;
  user: string;
}) => Promise<string>;

function readJson<T>(runDir: string, fileName: string): T | null {
  const path = join(runDir, fileName);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function compact(text: string, limit = 260): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function pickRepresentativeBlocks(ir: DocumentIR): { block_id: string; text: string }[] {
  return ir.blocks
    .filter((block) => block.block_type === "heading" || block.text_content.length >= 12)
    .slice(0, 12)
    .map((block) => ({ block_id: block.block_id, text: compact(block.text_content) }));
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function splitListText(value: string): string[] {
  return value
    .split(/\r?\n|[；;]|(?:^|\s)(?:\d+[.、)]|[-*])\s+/)
    .map(cleanListItem)
    .filter(Boolean)
    .slice(0, 8);
}

function cleanListItem(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^\s*(?:\d+[.、)]|[-*])\s*/, "")
    .trim();
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(cleanListItem).filter(Boolean).slice(0, 8);
  }
  if (typeof value === "string") return splitListText(value);
  return [];
}

function parseSummaryResponse(text: string): Omit<
  ReviewExpertSummaryArtifact,
  "generated_at" | "provider" | "model" | "prompt_chars" | "response_chars"
> {
  const parsed = JSON.parse(stripJsonFence(text)) as Record<string, unknown>;
  return {
    core_idea: String(parsed.core_idea ?? "").trim(),
    method_spine: stringArray(parsed.method_spine),
    strengths: stringArray(parsed.strengths),
    gaps: stringArray(parsed.gaps),
    expert_commentary: String(parsed.expert_commentary ?? "").trim(),
  };
}

function withFallbacks(input: {
  summary: Omit<ReviewExpertSummaryArtifact, "generated_at" | "provider" | "model" | "prompt_chars" | "response_chars">;
  review: Partial<ReviewWorkbenchPayload> | null;
  synthesis: DocumentSynthesis | null;
}) {
  const documentSummary = input.review?.document_summary;
  return {
    core_idea: input.summary.core_idea || documentSummary?.core_idea || input.synthesis?.summary_for_agent || "",
    method_spine:
      input.summary.method_spine.length > 0
        ? input.summary.method_spine
        : (documentSummary?.method_spine ?? input.synthesis?.process_spine?.map((item) => item.role) ?? []),
    strengths:
      input.summary.strengths.length > 0
        ? input.summary.strengths
        : (documentSummary?.source_notes ?? ["已根据文档结构生成专家摘要。"]),
    gaps:
      input.summary.gaps.length > 0
        ? input.summary.gaps
        : (documentSummary?.review_focuses ?? input.synthesis?.likely_gaps ?? []),
    expert_commentary:
      input.summary.expert_commentary ||
      documentSummary?.expert_commentary ||
      "建议专家继续检查关键判断、执行动作和验证方式是否足够清楚。",
  };
}

function validateSummary(
  value: Omit<ReviewExpertSummaryArtifact, "generated_at" | "provider" | "model" | "prompt_chars" | "response_chars">,
) {
  if (!value.core_idea) throw new Error("expert summary missing core_idea");
  if (!value.expert_commentary) throw new Error("expert summary missing expert_commentary");
  if (value.method_spine.length === 0) throw new Error("expert summary missing method_spine");
}

function buildPrompt(input: {
  ir: DocumentIR;
  synthesis: DocumentSynthesis | null;
  review: Partial<ReviewWorkbenchPayload> | null;
}) {
  const focusFields =
    input.review?.hints?.map((hint) => `${hint.label}: ${hint.what_to_ask}`) ??
    input.synthesis?.likely_gaps ??
    [];
  const payload = {
    title:
      input.synthesis?.document_theme ??
      input.ir.blocks.find((block) => block.block_type === "heading")?.text_content ??
      "未命名文档",
    business_scene: input.synthesis?.business_scene,
    primary_goal: input.synthesis?.primary_goal,
    process_spine: input.synthesis?.process_spine?.map((item) => item.role).slice(0, 6),
    key_signals: input.synthesis?.key_signals?.slice(0, 10),
    review_focuses: focusFields.slice(0, 8),
    representative_blocks: pickRepresentativeBlocks(input.ir),
  };
  return {
    system:
      "你是业务文档批改专家。请用业务专家能看懂的中文，总结文档核心思想、方法主线、优点、缺口和批注意见。不要使用 Schema、Block、source_refs、artifact、coverage、pass、warn 等工程词。",
    user: `请基于以下材料输出 JSON，字段为 core_idea, method_spine, strengths, gaps, expert_commentary。\n${JSON.stringify(payload, null, 2)}`,
  };
}

async function defaultCompletion(input: { system: string; user: string }): Promise<string> {
  const mock = process.env.AGENT_MODE_RUNNER_LLM_EXPERT_SUMMARY_MOCK_RESPONSE;
  if (mock != null) return mock;
  const config = resolvePlannerProviderConfig({ provider: "deepseek" });
  const response = await fetch(`${config.base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Expert summary LLM HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Expert summary LLM returned empty content");
  return content;
}

export async function generateExpertSummaryArtifact(input: {
  runDir: string;
  completion?: ExpertSummaryCompletion;
}): Promise<ReviewExpertSummaryArtifact> {
  const ir = readJson<DocumentIR>(input.runDir, "document_ir.json");
  if (!ir) throw new Error("Missing document_ir.json");
  const synthesis = readJson<DocumentSynthesis>(input.runDir, "document_synthesis.json");
  const review = readJson<Partial<ReviewWorkbenchPayload>>(input.runDir, "review_workbench.json");
  const prompt = buildPrompt({ ir, synthesis, review });
  const completion = input.completion ?? defaultCompletion;
  const response = await completion(prompt);
  const summary = withFallbacks({
    summary: parseSummaryResponse(response),
    review,
    synthesis,
  });
  validateSummary(summary);
  const config = input.completion ? null : resolvePlannerProviderConfig({ provider: "deepseek" });
  const generatedAt = new Date().toISOString();
  const provider = config?.safeSummary.provider ?? "mock";
  const model = config?.safeSummary.model ?? "mock";
  const promptChars = prompt.system.length + prompt.user.length;
  const responseChars = response.length;
  const artifact: ReviewExpertSummaryArtifact = {
    generated_at: generatedAt,
    provider,
    model,
    prompt_chars: promptChars,
    response_chars: responseChars,
    ...summary,
    observability: {
      generated_at: generatedAt,
      provider,
      model,
      base_host: config?.safeSummary.baseHost,
      prompt,
      raw_response: response,
      parsed_result: summary,
      parsed_summary: summary,
      prompt_chars: promptChars,
      response_chars: responseChars,
    },
  };
  writeFileSync(join(input.runDir, "expert_summary.v0.json"), JSON.stringify(artifact, null, 2));
  return artifact;
}
