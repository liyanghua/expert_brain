import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runPipeline } from "./pipeline.js";
import type {
  ExtractionProfile,
  ParserProfile,
  PlannerProfile,
  SemanticCoherenceProfile,
  SemanticUnitEnhancementProfile,
  SemanticUnitMatchProfile,
  UnderstandingProfile,
} from "./types.js";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function stringArg(args: Record<string, string | boolean>, key: string, fallback?: string) {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function parseProfileArg(args: Record<string, string | boolean>): ParserProfile {
  const value = stringArg(args, "parse-profile", "builtin");
  if (value === "builtin" || value === "marked" || value === "docling") return value;
  throw new Error(`Unsupported --parse-profile: ${value}. Expected builtin, marked, or docling.`);
}

function understandingProfileArg(args: Record<string, string | boolean>): UnderstandingProfile {
  const value = stringArg(args, "understanding-profile", "baseline");
  if (value === "baseline" || value === "profile_table" || value === "structured_context") return value;
  throw new Error(
    `Unsupported --understanding-profile: ${value}. Expected baseline, profile_table, or structured_context.`,
  );
}

function semanticCoherenceProfileArg(args: Record<string, string | boolean>): SemanticCoherenceProfile {
  const value = stringArg(args, "semantic-coherence-profile", "rules");
  if (value === "rules" || value === "embedding") return value;
  throw new Error(`Unsupported --semantic-coherence-profile: ${value}. Expected rules or embedding.`);
}

function semanticUnitEnhancementProfileArg(args: Record<string, string | boolean>): SemanticUnitEnhancementProfile {
  const value = stringArg(args, "semantic-unit-enhancement-profile", "rule");
  if (value === "rule" || value === "llm") return value;
  throw new Error(`Unsupported --semantic-unit-enhancement-profile: ${value}. Expected rule or llm.`);
}

function semanticUnitMatchProfileArg(args: Record<string, string | boolean>): SemanticUnitMatchProfile {
  const value = stringArg(args, "semantic-unit-match-profile", "rule");
  if (value === "rule" || value === "llm") return value;
  throw new Error(`Unsupported --semantic-unit-match-profile: ${value}. Expected rule or llm.`);
}

function booleanArg(args: Record<string, string | boolean>, key: string, fallback: boolean) {
  const value = args[key];
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  return value !== "false" && value !== "0";
}

function extractionProfileArg(args: Record<string, string | boolean>): ExtractionProfile {
  const value = stringArg(args, "extraction-profile", "baseline");
  if (value === "baseline" || value === "hinted" || value === "schema_guided") return value;
  throw new Error(`Unsupported --extraction-profile: ${value}. Expected baseline, hinted, or schema_guided.`);
}

function plannerProfileArg(args: Record<string, string | boolean>): PlannerProfile {
  const value = stringArg(args, "planner-profile", "baseline");
  if (value === "baseline" || value === "deepseek" || value === "qwen_plus") return value;
  throw new Error(`Unsupported --planner-profile: ${value}. Expected baseline, deepseek, or qwen_plus.`);
}

async function main() {
  const [command = "smoke", ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === "smoke" || command === "resume" || command === "step") {
    const input = stringArg(args, "input");
    const outputRoot = stringArg(args, "output-root", "data/agent-mode-runs");
    const result = await runPipeline({
      input,
      sceneId: stringArg(args, "scene", "product_link_diagnosis"),
      parseProfile: parseProfileArg(args),
      understandingProfile: understandingProfileArg(args),
      semanticCoherenceProfile: semanticCoherenceProfileArg(args),
      semanticUnitEnhancementProfile: semanticUnitEnhancementProfileArg(args),
      semanticUnitMatchProfile: semanticUnitMatchProfileArg(args),
      semanticUnitEvalReport: booleanArg(args, "semantic-unit-eval-report", true),
      extractionProfile: extractionProfileArg(args),
      plannerProfile: plannerProfileArg(args),
      outputRoot,
      runId: stringArg(args, "run-id"),
      toolProfile: stringArg(args, "tool-profile", "builtin"),
      approvalMode: "auto",
      reviewMode: "mock",
    });
    console.log(
      JSON.stringify(
        {
          status: result.status,
          run_id: result.run_id,
          run_dir: result.run_dir,
          artifacts: result.artifacts.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "report") {
    const runId = stringArg(args, "run-id");
    if (!runId) throw new Error("report requires --run-id");
    const outputRoot = stringArg(args, "output-root", "data/agent-mode-runs")!;
    const path = resolve(join(outputRoot, runId, "run_summary.json"));
    console.log(readFileSync(path, "utf8"));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
