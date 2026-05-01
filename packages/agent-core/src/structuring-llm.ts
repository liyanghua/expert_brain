import type { DocumentIR } from "@ebs/document-ir";
import {
  GroundTruthDraftSchema,
  STRUCTURED_FIELD_KEYS,
  emptyGroundTruthDraft,
  type GroundTruthDraft,
  type StructuredFieldKey,
} from "@ebs/ground-truth-schema";
import { runStructuring } from "./agents.js";
import { chatCompletionText } from "./llm-client.js";
import {
  buildKnowledgeSkeletonSystemPrompt,
  buildKnowledgeSkeletonUserPrompt,
  buildStructuringSystemPrompt,
  buildStructuringUserPrompt,
} from "./structuring-prompt.js";

export type StructuringMode = "llm" | "rules" | "rules_fallback";
export type StructuringFailureReason =
  | "disabled"
  | "http_error"
  | "timeout"
  | "json_parse_error"
  | "schema_validation_error"
  | "quality_gate_failed"
  | "unknown_error";

export type StructuringDiagnostics = {
  attempts: {
    stage: "knowledge_skeleton" | "draft" | "strict_retry" | "rules";
    status: "ok" | "failed" | "skipped";
    reason?: StructuringFailureReason;
    message?: string;
  }[];
  llm_failure_reason?: StructuringFailureReason;
  llm_failure_message?: string;
  schema_issues?: string[];
  quality_issues: string[];
};

export function isLlmStructuringEnabled(): boolean {
  const v = process.env.EBS_LLM_STRUCTURING?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const ARRAY_STRUCTURED_FIELD_KEYS = [
  "required_inputs",
  "deliverables",
  "thinking_framework",
  "execution_steps",
  "execution_actions",
  "key_node_rationales",
  "page_screenshots",
  "faq_types",
  "judgment_basis",
  "judgment_criteria",
  "resolution_methods",
  "trigger_conditions",
  "termination_conditions",
  "validation_methods",
  "tool_templates",
  "exceptions_and_non_applicable_scope",
] as const satisfies readonly StructuredFieldKey[];

const ARRAY_STRUCTURED_FIELD_KEY_SET = new Set<string>(ARRAY_STRUCTURED_FIELD_KEYS);
const OBJECT_STRUCTURED_FIELD_KEY_SET = new Set<string>([
  "business_scenario",
  "scenario_goal",
  "process_flow_or_business_model",
]);

export function normalizeLlmStructuredFields(
  partial: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...partial };
  for (const key of OBJECT_STRUCTURED_FIELD_KEY_SET) {
    const v = normalized[key];
    if (Array.isArray(v) && v.length === 1) {
      normalized[key] = v[0];
    }
  }
  for (const key of ARRAY_STRUCTURED_FIELD_KEY_SET) {
    const v = normalized[key];
    if (v === undefined || v === null || Array.isArray(v)) continue;
    normalized[key] = [v];
  }
  if (
    typeof normalized.gaps === "string" &&
    normalized.gaps.trim() !== ""
  ) {
    normalized.gaps = [
      { field_key: "general", message: normalized.gaps.trim() },
    ];
  }
  if (Array.isArray(normalized.source_refs)) {
    normalized.source_refs = { general: normalized.source_refs };
  }
  return normalized;
}

function extractJsonObject(raw: string): unknown {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/im.exec(t);
  const body = fence ? fence[1]!.trim() : t;
  return JSON.parse(body) as unknown;
}

function mergeDraftFromLlm(
  ir: DocumentIR,
  partial: Record<string, unknown>,
): GroundTruthDraft {
  const normalized = normalizeLlmStructuredFields(partial);
  const base = emptyGroundTruthDraft(ir.doc_id, ir.version_id);
  const candidate: Record<string, unknown> = { ...base };

  for (const key of STRUCTURED_FIELD_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(normalized, key) &&
      normalized[key] !== undefined
    ) {
      candidate[key] = normalized[key];
    }
  }

  const metaKeys = [
    "document_meta",
    "gaps_structured",
    "global_scores",
    "gaps",
    "confidence_by_field",
    "source_refs",
    "schema_name",
    "schema_version",
  ] as const;
  for (const mk of metaKeys) {
    if (
      Object.prototype.hasOwnProperty.call(normalized, mk) &&
      normalized[mk] !== undefined
    ) {
      candidate[mk] = normalized[mk];
    }
  }

  candidate.doc_id = ir.doc_id;
  candidate.version_id = ir.version_id;
  candidate.schema_name = "BusinessDocStructuredDraft";

  return candidate as GroundTruthDraft;
}

function stringifyForQuality(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function collectDraftQualityIssues(
  draft: GroundTruthDraft,
  ir: DocumentIR,
): string[] {
  const issues: string[] = [];
  const placeholder = /to be confirmed|needs expert input|待专家确认/i;
  for (const key of STRUCTURED_FIELD_KEYS) {
    const text = stringifyForQuality(draft[key]);
    if (placeholder.test(text)) {
      issues.push(`placeholder content in ${key}`);
    }
  }

  const sourceText = ir.blocks.map((b) => b.text_content).join("\n");
  if (/商品诊断|生命周期|天猫|操盘手|店铺运营/.test(sourceText)) {
    const draftText = stringifyForQuality(draft);
    const required = [
      {
        label: "生命周期阶段",
        pattern: /生命周期|新品期|成长期|爆发期|衰退期|新品|成长品|爆品|衰退品/,
      },
      {
        label: "商品等级",
        pattern: /商品等级|S\/A\/B\/C|S\+|S：|A：|B：|C：|爆款|主力盈利款/,
      },
      {
        label: "诊断维度",
        pattern: /诊断维度|流量结构|转化链路|产品力|付费推广|人群诊断/,
      },
      {
        label: "指标标准",
        pattern: /判断标准|核心指标|加购率|转化率|退款率|费比|ROI|点击|GMV/,
      },
      {
        label: "排查方法",
        pattern: /排查|定位问题|问题解决|原因|诊断逻辑/,
      },
      {
        label: "执行动作",
        pattern: /执行动作|任务清单|优化|方案|动作/,
      },
      {
        label: "触发终止条件",
        pattern: /触发|终止|上架|下架|达标|预警|清仓/,
      },
    ];
    for (const item of required) {
      if (!item.pattern.test(draftText)) {
        issues.push(`missing core element: ${item.label}`);
      }
    }
  }
  return issues;
}

function classifyLlmError(err: unknown): {
  reason: StructuringFailureReason;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  if (/Timeout|aborted|AbortError/i.test(message)) {
    return { reason: "timeout", message };
  }
  if (/LLM HTTP/i.test(message)) {
    return { reason: "http_error", message };
  }
  return { reason: "unknown_error", message };
}

function fallbackResult(
  ir: DocumentIR,
  diagnostics: StructuringDiagnostics,
  reason: StructuringFailureReason,
  message: string,
): {
  draft: GroundTruthDraft;
  structuring_mode: StructuringMode;
  diagnostics: StructuringDiagnostics;
} {
  diagnostics.llm_failure_reason = reason;
  diagnostics.llm_failure_message = message;
  diagnostics.attempts.push({ stage: "rules", status: "ok" });
  return {
    draft: runStructuring(ir),
    structuring_mode: "rules_fallback",
    diagnostics,
  };
}

export async function runStructuringWithLlmOrFallback(ir: DocumentIR): Promise<{
  draft: GroundTruthDraft;
  structuring_mode: StructuringMode;
  diagnostics: StructuringDiagnostics;
}> {
  const diagnostics: StructuringDiagnostics = {
    attempts: [],
    quality_issues: [],
  };
  if (!isLlmStructuringEnabled()) {
    diagnostics.llm_failure_reason = "disabled";
    diagnostics.attempts.push({
      stage: "knowledge_skeleton",
      status: "skipped",
      reason: "disabled",
    });
    diagnostics.attempts.push({ stage: "rules", status: "ok" });
    return {
      draft: runStructuring(ir),
      structuring_mode: "rules",
      diagnostics,
    };
  }

  try {
    let knowledgeSkeleton: unknown;
    try {
      const skeletonRaw = await chatCompletionText({
        system: buildKnowledgeSkeletonSystemPrompt(),
        user: buildKnowledgeSkeletonUserPrompt(ir),
      });
      knowledgeSkeleton = extractJsonObject(skeletonRaw);
      diagnostics.attempts.push({ stage: "knowledge_skeleton", status: "ok" });
    } catch (err) {
      const { reason, message } =
        err instanceof SyntaxError
          ? { reason: "json_parse_error" as const, message: err.message }
          : classifyLlmError(err);
      diagnostics.attempts.push({
        stage: "knowledge_skeleton",
        status: "failed",
        reason,
        message,
      });
    }

    const system = buildStructuringSystemPrompt();
    const user = buildStructuringUserPrompt(ir, knowledgeSkeleton);
    const raw = await chatCompletionText({ system, user });
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject(raw) as Record<string, unknown>;
    } catch (err) {
      diagnostics.attempts.push({
        stage: "draft",
        status: "failed",
        reason: "json_parse_error",
        message: err instanceof Error ? err.message : String(err),
      });
      return fallbackResult(
        ir,
        diagnostics,
        "json_parse_error",
        err instanceof Error ? err.message : String(err),
      );
    }
    const merged = mergeDraftFromLlm(ir, parsed);
    const checked = GroundTruthDraftSchema.safeParse(merged);
    if (checked.success) {
      const qualityIssues = collectDraftQualityIssues(checked.data, ir);
      if (qualityIssues.length === 0) {
        diagnostics.attempts.push({ stage: "draft", status: "ok" });
        return { draft: checked.data, structuring_mode: "llm", diagnostics };
      }

      diagnostics.quality_issues = qualityIssues;
      diagnostics.attempts.push({
        stage: "draft",
        status: "failed",
        reason: "quality_gate_failed",
        message: qualityIssues.join("; "),
      });

      const retryRaw = await chatCompletionText({
        system: buildStructuringSystemPrompt({
          strict: true,
          qualityIssues,
        }),
        user: buildStructuringUserPrompt(ir, knowledgeSkeleton),
      });
      let retryParsed: Record<string, unknown>;
      try {
        retryParsed = extractJsonObject(retryRaw) as Record<string, unknown>;
      } catch (err) {
        diagnostics.attempts.push({
          stage: "strict_retry",
          status: "failed",
          reason: "json_parse_error",
          message: err instanceof Error ? err.message : String(err),
        });
        return fallbackResult(
          ir,
          diagnostics,
          "json_parse_error",
          err instanceof Error ? err.message : String(err),
        );
      }
      const retryMerged = mergeDraftFromLlm(ir, retryParsed);
      const retryChecked = GroundTruthDraftSchema.safeParse(retryMerged);
      if (!retryChecked.success) {
        const schemaIssues = retryChecked.error.issues
          .slice(0, 20)
          .map((i) => `${i.path.join(".")}: ${i.message}`);
        diagnostics.schema_issues = schemaIssues;
        diagnostics.attempts.push({
          stage: "strict_retry",
          status: "failed",
          reason: "schema_validation_error",
          message: schemaIssues.join("; "),
        });
        return fallbackResult(
          ir,
          diagnostics,
          "schema_validation_error",
          schemaIssues.join("; "),
        );
      }
      const retryQualityIssues = collectDraftQualityIssues(
        retryChecked.data,
        ir,
      );
      diagnostics.quality_issues = retryQualityIssues;
      if (retryQualityIssues.length === 0) {
        diagnostics.attempts.push({ stage: "strict_retry", status: "ok" });
        return {
          draft: retryChecked.data,
          structuring_mode: "llm",
          diagnostics,
        };
      }
      diagnostics.attempts.push({
        stage: "strict_retry",
        status: "failed",
        reason: "quality_gate_failed",
        message: retryQualityIssues.join("; "),
      });
      return fallbackResult(
        ir,
        diagnostics,
        "quality_gate_failed",
        retryQualityIssues.join("; "),
      );
    }

    const schemaIssues = checked.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join(".")}: ${i.message}`);
    diagnostics.schema_issues = schemaIssues;
    diagnostics.attempts.push({
      stage: "draft",
      status: "failed",
      reason: "schema_validation_error",
      message: schemaIssues.join("; "),
    });
    return fallbackResult(
      ir,
      diagnostics,
      "schema_validation_error",
      schemaIssues.join("; "),
    );
  } catch (err) {
    const { reason, message } = classifyLlmError(err);
    diagnostics.attempts.push({
      stage: "draft",
      status: "failed",
      reason,
      message,
    });
    return fallbackResult(ir, diagnostics, reason, message);
  }
}
