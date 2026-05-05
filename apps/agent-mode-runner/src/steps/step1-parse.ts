import { metric } from "../observability/metrics.js";
import { builtinMarkdownParserAdapter } from "../parsers/builtin-markdown-parser.js";
import { doclingParserAdapter } from "../parsers/docling-parser.js";
import { markedMarkdownParserAdapter } from "../parsers/marked-markdown-parser.js";
import type { ParserAdapter } from "../parsers/parser-adapter.js";
import type { ParserProfile, PipelineState, StepMetric } from "../types.js";

const PARSER_ADAPTERS: Record<ParserProfile, ParserAdapter> = {
  builtin: builtinMarkdownParserAdapter,
  marked: markedMarkdownParserAdapter,
  docling: doclingParserAdapter,
};

export async function runStep1Parse(state: PipelineState): Promise<{
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
}> {
  const parseProfile = state.parse_profile ?? "builtin";
  const adapter = PARSER_ADAPTERS[parseProfile];
  const result = await adapter.parse({
    inputPath: state.input_path,
    docId: state.run_id,
    versionId: "v0",
  });
  const ir = result.ir;
  state.document_ir = result.ir;
  const headingCount = ir.blocks.filter((block) => block.block_type === "heading").length;
  const tableCount = ir.blocks.filter((block) => block.block_type === "table").length;
  const sourceSpanCount = ir.blocks.filter((block) => block.source_span).length;
  return {
    artifacts: {
      document_ir: ir,
      parse_diagnostics: result.diagnostics,
      ...(result.extraArtifacts ?? {}),
    },
    metrics: {
      parse_success_rate: metric(ir.blocks.length > 0 ? 1 : 0),
      block_integrity_rate: metric(result.metricHints?.block_integrity_rate ?? 0, "proxy"),
      heading_preservation_rate: metric(result.metricHints?.heading_preservation_rate ?? 0, "proxy"),
      table_preservation_rate: metric(result.metricHints?.table_preservation_rate ?? 0, "proxy"),
      source_span_completeness: metric(
        ir.blocks.length === 0 ? 0 : sourceSpanCount / ir.blocks.length,
        "measured",
      ),
      parse_duration_ms: metric(result.diagnostics.parse_duration_ms),
      block_count: metric(ir.blocks.length, "measured"),
      heading_count: metric(headingCount, "measured"),
      table_count: metric(tableCount, "measured"),
    },
  };
}
